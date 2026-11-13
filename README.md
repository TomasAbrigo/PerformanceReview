# Performance Review

[![CI](https://github.com/TomasAbrigo/PerformanceReview/actions/workflows/ci.yml/badge.svg)](https://github.com/TomasAbrigo/PerformanceReview/actions/workflows/ci.yml)

Herramienta interna de evaluaciones de desempeño que reemplaza el módulo de performance de BambooHR. Los datos se ingestan desde Bamboo conservando sus IDs de origen.

**Stack:** Next.js (App Router, TypeScript estricto, Tailwind v4, shadcn/ui) · next-intl (`es` por defecto, `en`) · Supabase local · Drizzle ORM (postgres-js) · Vitest · Playwright.

> Solo desarrollo local. No hay deploy configurado.

## Requisitos

- Node 24 y pnpm
- Docker corriendo
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Cómo correrlo

```bash
pnpm install
cp .env.example .env.local   # completar la anon key con la salida de `supabase status`
supabase start               # levanta Postgres, Auth, Studio, etc. en Docker
pnpm db:migrate              # aplica las migraciones de Drizzle (carpeta drizzle/)
pnpm dev                     # http://localhost:3000 -> redirige a /es
```

Para apagar la base: `supabase stop`. Para recrearla desde cero: `pnpm db:reset` y luego `pnpm db:migrate`.

## Tests y calidad

```bash
pnpm test:unit   # Vitest (jsdom) — *.test.ts(x)
pnpm test:db     # Vitest (node) contra DATABASE_URL — *.db.test.ts (requiere supabase start)
pnpm test:e2e    # Playwright (levanta next dev en :3100); la primera vez: pnpm exec playwright install chromium
pnpm test        # unit + db
pnpm check       # typecheck + lint + format:check + test:unit (como el job `checks` de CI)
pnpm typecheck
pnpm lint
pnpm format      # Prettier
```

## Base de datos

- Esquema de Drizzle: `src/db/schema/*.ts`. Migraciones generadas en `drizzle/` (`pnpm db:generate`, `pnpm db:migrate`).
- `supabase/migrations/` queda reservado para SQL específico de Supabase (RLS, extensiones, funciones).
- `pnpm db:studio` abre Drizzle Studio.

## Lake adapter

`src/modules/lake/` lee tablas de un data lake (o de una carpeta de archivos que hace de lake) detrás de una interfaz única, `LakeAdapter` (`listTables`, `describeTable`, `readBatches`, `close`). Hoy hay una implementación, `DuckDbFileLake`; los conectores reales (BigQuery, Snowflake, Databricks, Redshift, Postgres) tendrán que pasar la misma suite de contrato.

### Apuntarlo a una carpeta

```ts
import { DuckDbFileLake } from "@/modules/lake";

const lake = await DuckDbFileLake.open("/ruta/a/la/carpeta");
await lake.listTables(); // una tabla por archivo

for await (const { rows, watermark } of lake.readBatches("employee", {
  keyColumns: ["id"],
  watermarkColumn: "_fivetran_synced",
  since: ultimoWatermarkCommiteado, // null/undefined = lectura completa
  batchSize: 500,
})) {
  // guardar rows y, recién después del commit, persistir `watermark`
}
await lake.close();
```

- **Formatos:** `csv`, `parquet`, `json`, `ndjson`/`jsonl` y `xlsx` (primera hoja; se convierte a CSV en una carpeta temporal que `close()` borra). El nombre de la tabla es el del archivo sin extensión (los nombres salen solo del listado del directorio); dos archivos con el mismo nombre dan error. Se ignoran archivos ocultos y `~$` de Office.
- **Paginación estable:** orden por (watermark, claves) con paginado keyset. Cada fila sale exactamente una vez por pasada, aunque haya empates de watermark, claves duplicadas, filas idénticas o NULL (los NULL salen al final).
- **`since` es at-least-once:** se leen las filas con `watermark >= since` (el consumidor hace upsert, así que releer el borde es inocuo). Las filas con watermark NULL se leen siempre porque no se puede probar que sean viejas. `batch.watermark` es el mayor no nulo del lote.
- **Valores JSON-safe:** BIGINT y DECIMAL llegan como string (sin perder dígitos), los timestamps en UTC (`2026-01-10 10:00:00+00`) sin depender de la zona horaria de la máquina, y los faltantes como `null`.
- **Tipos de CSV:** DuckDB infiere los tipos leyendo todo el archivo. Ojo: columnas con `yes`/`no`/`true`/`false` pasan a booleano y los decimales a `DOUBLE`.
- **Rendimiento:** cada página vuelve a escanear el archivo; está pensado para archivos de miles o pocos cientos de miles de filas, no para cargas masivas.
- **Dónde corre:** solo en CLI/worker, nunca dentro de un request handler. `@duckdb/node-api` está pineado en `devDependencies` y en `serverExternalPackages` de `next.config.ts` (si se necesita en producción hay que pasarlo a `dependencies`).

### Perfiles de fuente

Un perfil (`SourceProfile`, esquema zod en `src/modules/lake/profiles.ts`) dice cómo una tabla del lake se convierte en registros canónicos:

| Campo              | Qué es                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `name`             | Identificador del perfil (por ejemplo `bamboo-employee-performance`).                                                    |
| `table`            | Tabla del lake. Para un archivo subido es el nombre del archivo sin extensión.                                           |
| `keyColumns`       | Columnas que identifican la fila en el origen (una o varias).                                                            |
| `watermarkColumn`  | Columna de cambio para lecturas incrementales (opcional).                                                                |
| `softDeleteColumn` | Columna cuyo valor verdadero (o una fecha) marca la fila como borrada en el origen.                                      |
| `entity`           | `employee`, `job_history`, `goal`, `assessment` o `feedback`.                                                            |
| `columnMap`        | Columna del origen → nombre canónico del campo.                                                                          |
| `columnTypes`      | Opcional: familia de tipo esperada por columna (`string`, `number`, `boolean`, `date`, `timestamp`) para detectar drift. |

```ts
import {
  applyProfile,
  getBuiltinProfile,
  readOptionsFor,
  validateAgainstSchema,
} from "@/modules/lake";

const profile = getBuiltinProfile("fivetran-bamboohr-employee")!;

// 1. Antes de ingestar: ¿el archivo/tabla tiene lo que el perfil necesita?
const issues = validateAgainstSchema(
  profile,
  await lake.describeTable(profile.table),
);
// [] si está todo; si no, { kind: "missing_column" | "type_mismatch", column, message, ... }

// 2. Leer y convertir
for await (const { rows } of lake.readBatches(
  profile.table,
  readOptionsFor(profile, { since }),
)) {
  const records = rows.map((row) => applyProfile(profile, row));
  // { entity, sourceId, fields, extra, deleted, watermark }
}
```

- `validateAgainstSchema` informa columnas **faltantes** (con el rol: clave, watermark, soft-delete o mapeada, y una sugerencia si solo cambia mayúsculas o espacios) y **tipos incompatibles** (el watermark debe ser fecha, timestamp o número; `columnTypes` fija las demás). Una columna nueva que el perfil no menciona no es un problema. Los mensajes son para logs; la UI debe mapear `kind` a claves i18n.
- `applyProfile` arma `sourceId` con el valor de la clave (si hay varias, un arreglo JSON, que no es ambiguo), pone en `fields` las columnas mapeadas con su nombre canónico y deja el resto intacto en `extra` (así las preguntas custom de los reportes de Bamboo no se pierden). Falla con un mensaje claro si una clave viene vacía.
- **Perfiles incluidos** (`builtinProfiles`): `fivetran-bamboohr-employee`, `-goal`, `-employee-goal`, `-milestone` (watermark `_fivetran_synced`, soft-delete `_fivetran_deleted`), `airbyte-bamboohr-employees` (watermark `_airbyte_extracted_at`) y los reportes estándar de Bamboo: `bamboo-employee-performance`, `bamboo-feedback-status`, `bamboo-goal-status`, `bamboo-assessment-progress`. Los reportes de Bamboo no traen ids (ver `docs/research/02`), así que se identifican por columnas naturales (por ejemplo empleado + ciclo) y son snapshots completos, sin watermark. Los nombres de columnas son los documentados: confirmar contra un export real.
- Para otra fuente, crear un perfil propio con el mismo esquema (o copiar uno incluido y ajustar `columnMap`).

### Tests y fixtures

- `runLakeAdapterContractTests(name, openAdapter)` (`src/modules/lake/contract.ts`) es la suite de contrato: `openAdapter(scenario)` debe devolver el adaptador abierto sobre la carpeta de `src/modules/lake/__fixtures__/<scenario>/` (o su equivalente en el lake real). Escenarios: `initial`, `delta-1` (update, insert y soft-delete), `schema-drift` (columna nueva y cambio de tipo) y `messy` (NULL, claves duplicadas, empates y watermark NULL, BIGINT mayor a 2^53). Los fixtures son CSV sintéticos escritos a mano; además hay `airbyte/` y `bamboo-reports/` para los perfiles.
- `duckdb-file-lake.test.ts` corre la suite sobre CSV y `parquet.test.ts` sobre la variante Parquet, generada al vuelo con DuckDB `COPY`. Para obtener los archivos Parquet: `pnpm fixtures:parquet [carpetaDeSalida]` (por defecto `build/lake-parquet/<escenario>/`, ignorado por git).
- No pongas exports reales en los fixtures (contienen datos personales).

## Puertos (Supabase local)

Se usan puertos propios para no chocar con otros proyectos locales.

| Servicio         | Puerto |
| ---------------- | ------ |
| API              | 55321  |
| Postgres         | 55322  |
| Studio           | 55323  |
| Inbucket         | 55324  |
| Shadow DB        | 55320  |
| Analytics        | 55327  |
| Pooler (apagado) | 55329  |
| Next.js (dev)    | 3000   |
| Next.js (e2e)    | 3100   |

Conexión local: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.

## Idiomas

Rutas bajo `/[locale]` (`/es`, `/en`). Los textos viven en `src/messages/{es,en}.json`; ambos archivos deben tener las mismas claves (hay un test que lo verifica).
