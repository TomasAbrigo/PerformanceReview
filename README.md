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

## Fixtures

Empresa sintética y determinista con la forma exacta de lo que devuelve Bamboo, para desarrollar y testear sin API key. Cuando haya credenciales reales, el primer paso es grabar respuestas reales y compararlas con estos archivos.

```bash
pnpm fixtures:build   # regenera fixtures/bamboo/{small,demo} y fixtures/bamboo-reports/{small,demo}
```

El generador (`src/fixtures/company/`) es puro y usa una semilla fija (`1001` para small y `2002` para demo, en `src/fixtures/write.ts`): misma semilla, mismos archivos byte a byte. Un test unitario falla si lo commiteado no coincide con lo que genera el código; si tocás el generador, corré `pnpm fixtures:build` y commiteá el resultado.

| Tamaño | Registros Bamboo | Bajas | Reingresos | Cambios de manager | Goals | Assessments | Pedidos de feedback |
| ------ | ---------------- | ----- | ---------- | ------------------ | ----- | ----------- | ------------------- |
| small  | 40               | 10    | 4          | 24                 | 143   | 80          | 220                 |
| demo   | 400              | 30    | 8          | 71                 | 1484  | 915         | 2801                |

Ambos tienen 5 niveles (CEO, VP de división, gerente de área, líder de equipo, individual), varias divisiones, áreas y ubicaciones, una sola persona sin manager (el CEO) y 3 ciclos históricos anuales (2023, 2024 y 2025).

**`fixtures/bamboo/<size>/`**: respuestas JSON de la API pública (ids siempre string, fechas ISO, `null` en vez de `0000-00-00`).

- `employees/list/page-NNN.json`: list-employees paginado por cursor (`data`, `meta.page.nextCursor`, `_links`).
- `employees/get/<id>.json`: get-employee con `supervisorEId`, `supervisorId` y `supervisor`.
- `employees/tables/jobInfo/all.json` y `employees/tables/employmentStatus/all.json`: historial completo.
- `employees/changed.json`: feed de cambios (full load).
- `performance/goals/<id>.json`: goals aggregate v1_2 por empleado (milestones, comments).
- `manifest.json`: semilla y conteos.

**`fixtures/bamboo-reports/<size>/`**: CSV con la forma de los reportes estándar de Performance de Bamboo (`employee-performance`, `feedback-status`, `goal-status`, `assessment-progress`) para los 3 ciclos. Identifican personas solo por nombre ("Nombre Apellido"). Las columnas exactas de Bamboo no están verificadas (ver `docs/research/07`); se replicaron las documentadas.

Trampas intencionales (las que va a tener que resolver la ingesta):

- `reportsTo` (jobInfo) y `supervisor` son el nombre ("Apellido, Nombre"), no el id; `supervisorEId` es el id interno y `supervisorId` es el legajo del manager.
- Reingresos: mismo legajo y mismo email (o email nuevo en algunos), id de Bamboo nuevo.
- Los CSV muestran el manager y el área **actuales**, no los del momento de la review; el manager de entonces solo se recupera del historial de jobInfo.
- Nombres sucios en los CSV: personas renombradas (el CSV de ciclos viejos tiene el nombre anterior), nombres mal escritos en un ciclo, dos personas distintas con el mismo nombre y filas de personas que no existen en el HRIS.

La verdad de base de esas trampas está en `company.identity` (`persons`, `renames`, `duplicateNames`, `misspellings`, `outsiders`).

Desde código:

```ts
import { generateCompany } from "@/fixtures/company";
import { serializeBambooApi } from "@/fixtures/serialize/bamboo-api";

const company = generateCompany({ size: "small", seed: 1001 });
const files = serializeBambooApi(company); // [{ path, content }]
```

Los esquemas zod de cada respuesta están en `src/fixtures/bamboo-schemas.ts` (los tests validan los JSON generados contra ellos y el cliente real los va a reutilizar).

**Sembrar la base:** todavía no. Las tablas de personas llegan con los issues #3 y #4; este slice solo genera archivos y datos en memoria. Cuando existan, el comando que resetea y siembra la base local (`pnpm db:reset` + `pnpm db:migrate` + seed) va a leer esta misma generación.

## Base de datos

- Esquema de Drizzle: `src/db/schema/*.ts`. Migraciones generadas en `drizzle/` (`pnpm db:generate`, `pnpm db:migrate`).
- `supabase/migrations/` queda reservado para SQL específico de Supabase (RLS, extensiones, funciones).
- `pnpm db:studio` abre Drizzle Studio.

## Ingesta

La ingesta corre fuera de la app (CLI o cron), nunca dentro de un request. Cada corrida queda registrada en `ingest_run` y se ve en `/es/imports/runs` (lista con conteos y detalle con rechazos).

```bash
pnpm ingest <entidad> --source fixture|bamboo [--dir <ruta>] [--since <iso>|last]
pnpm ingest --all --source bamboo        # todas las entidades registradas, en orden
pnpm ingest --help
```

- **Entidades:** las del registro `src/modules/ingest/registry.ts`: `employee`, `job_history` y `goal`, en ese orden (el de `--all`: las dos últimas resuelven personas a través de `employee`). Las que `runIngest` ya sabe procesar salen de `entityHandlers` (`src/modules/ingest/handlers.ts`): para sumar otra basta con agregar su handler y el CLI, el log de corridas y `sync_state` la toman sin más cambios. Una con pipeline propio, como `goal` (`runGoalIngest`, que lee los goals de los empleados activos), se registra con un `run` a medida que debe dejar un `ingest_run` (con su `entity`), avanzar `sync_state` en la transacción que lo marca `succeeded` y lanzar `IngestRunError` si termina en `error`. Con `--all` una falla no frena a las siguientes.
- **`--source fixture`** lee respuestas de Bamboo guardadas en `--dir` (por defecto `src/modules/bamboo-client/__fixtures__`). **`--source bamboo`** llama a la API y necesita `BAMBOO_COMPANY_DOMAIN` y `BAMBOO_API_KEY` (en `.env.local` o en el entorno).
- **`--since`** acota la extracción a lo cambiado desde ese instante, en ISO 8601 estricto (`2026-11-01`, o con hora y zona: `2026-11-01T10:00:00Z`, `2026-11-01T10:00:00-03:00`; `5` o `2026-02-30` se rechazan con código 2); `last` usa el watermark guardado para esa fuente, adaptador y entidad (si no hay, la corrida es completa). Una corrida con `--since` es incremental y nunca da de baja lo que no devolvió. El adaptador de Bamboo lo aprovecha en `job_history` (solo empleados con cambios); `employee` lee la lista completa (la reingesta es idempotente) y `goal` siempre lee los goals de todos los empleados activos (detecta cambios por hash) e ignora `--since`.
- **Watermark:** `sync_state` guarda, por (fuente, adaptador, entidad), el inicio de la última corrida exitosa; los fixtures (adaptador `fixture`) no mueven el watermark de la API real (`bamboo`). Solo avanza en la misma transacción que marca la corrida como `succeeded`; una corrida que falla queda en `error` (con `finished_at` y el mensaje) y deja el watermark anterior intacto.
- **Salida:** una tabla resumen (leídos, insertados, actualizados, sin cambios, eliminados, rechazados, duración e id de corrida). Código de salida `0` si todo salió bien, `1` si alguna corrida falló y `2` si los argumentos o la configuración son inválidos (falta `BAMBOO_*` o `DATABASE_URL`, `--since` mal formado): en ese caso no se intenta ninguna corrida.
- Dos corridas de la misma entidad nunca se pisan: la segunda espera a la primera (`pg_advisory_xact_lock` por entidad, tomado en una transacción que queda abierta durante la corrida, así que sirve también detrás de un pooler en modo transacción; si el servidor define `idle_in_transaction_session_timeout`, debe superar la corrida más larga).
- **`--unmatched create|queue`** (solo `employee`, por defecto `create`) decide qué pasa con un registro que no coincide con nadie ni se parece a nadie: crear la persona o dejarlo en la cola de identidad (`/es/imports/identity`). Un registro con legajo o email conocidos bajo un id nuevo (un reingreso) o con un identificador que ya tiene otra persona siempre va a la cola, y el conteo `issues` de la corrida lo refleja (`ignored`: casos que alguien ya decidió ignorar y Bamboo reenvía igual).
- `pnpm ingest:employees [--entity employee|job_history] [--since <iso>]` queda como alias de `pnpm ingest <entidad>` (con `--source fixture` por defecto).

Ejemplo de cron (crontab del servidor): cada 15 minutos lo incremental barato (`employee` completo y `job_history` solo lo cambiado) y de noche una corrida completa de todo, incluidos los goals (un pedido por empleado) y la baja de quien ya no está en Bamboo:

```cron
*/15 * * * * cd /srv/performance-review && (pnpm ingest employee --source bamboo && pnpm ingest job_history --source bamboo --since last) >> /var/log/pr-ingest.log 2>&1
0 3 * * *    cd /srv/performance-review && pnpm ingest --all --source bamboo >> /var/log/pr-ingest.log 2>&1
```

El código de salida distinto de cero permite alertar desde el propio cron (por ejemplo con `MAILTO` o un wrapper que avise a un canal).

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

- **Formatos:** `csv`, `parquet`, `json`, `ndjson`/`jsonl` y `xlsx` (primera hoja; se convierte a CSV en una carpeta temporal que `close()` borra y se lee **como texto**, sin inferir tipos: cada celda llega tal como está escrita, con las fechas en ISO 8601 UTC). El nombre de la tabla es el del archivo sin extensión (los nombres salen solo del listado del directorio); dos archivos con el mismo nombre dan error. Solo cuentan los archivos regulares: se ignoran carpetas, archivos ocultos y `~$` de Office.
- **Snapshot por tabla:** la primera vez que se usa una tabla (`describeTable` o `readBatches`) se carga una sola vez en una tabla temporal en memoria y se pagina desde esa copia; los cambios posteriores del archivo no se ven hasta volver a abrir el lake. La columna `__lake_row_position` está reservada (si un archivo la trae, se rechaza con un error claro).
- **Paginación estable:** orden por (watermark, claves) con paginado keyset. Cada fila sale exactamente una vez por pasada, aunque haya empates de watermark, claves duplicadas, filas idénticas o NULL (los NULL salen al final).
- **`since` es at-least-once:** se leen las filas con `watermark >= since` (el consumidor hace upsert, así que releer el borde es inocuo). Las filas con watermark NULL se leen siempre porque no se puede probar que sean viejas. `batch.watermark` es el mayor no nulo del lote. `since` es un instante: acepta offset (`2026-01-10T07:05:00-03:00`), y en columnas sin zona horaria (`TIMESTAMP`, `DATE`) se interpreta y compara en UTC.
- **Valores JSON-safe:** BIGINT y DECIMAL llegan como string (sin perder dígitos), los timestamps en UTC (`2026-01-10 10:00:00+00`) sin depender de la zona horaria de la máquina, y los faltantes como `null`.
- **Tipos de CSV:** DuckDB infiere los tipos leyendo todo el archivo (no aplica a `xlsx`, que va como texto). Ojo: columnas con `yes`/`no`/`true`/`false` pasan a booleano y los decimales a `DOUBLE`.
- **Rendimiento:** el archivo se lee una sola vez, pero cada página es un top-N sobre toda la copia en memoria y toda la tabla vive en memoria; está pensado para archivos de miles o pocos cientos de miles de filas, no para cargas masivas.
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
- **Perfiles incluidos** (`builtinProfiles`): `fivetran-bamboohr-employee`, `-goal`, `-employee-goal`, `-milestone` (watermark `_fivetran_synced`, soft-delete `_fivetran_deleted`), `airbyte-bamboohr-employees` (watermark `_airbyte_extracted_at`) y los reportes estándar de Bamboo: `bamboo-employee-performance`, `bamboo-feedback-status`, `bamboo-goal-status`, `bamboo-assessment-progress`. Los reportes de Bamboo no traen ids (ver `docs/research/02`) e identifican a las personas solo por nombre, así que se identifican por columnas naturales y son snapshots completos, sin watermark. Sus columnas son las de `fixtures/bamboo-reports/<tamaño>/` (el generador de #2; siguen sin estar verificadas contra un export real de Bamboo):
  - `bamboo-employee-performance`: clave `Employee Name` + `Review Cycle` + `Assessment Date` (la fecha separa a dos personas con el mismo nombre en un ciclo). Las columnas de preguntas (`Employee Q1: ...`, `Manager Custom Q2: ...`) no se mapean: su encabezado incluye el texto de la pregunta y el nombre de la empresa, y las preguntas custom cambian por cuenta, así que quedan en `extra` con el encabezado exacto.
  - `bamboo-feedback-status`: clave `Employee Name` + `Receiving Feedback From` + `Review Cycle`.
  - `bamboo-goal-status`: clave `Employee Name` + `Goal` + `Due Date`. Quien no tiene metas aparece en una sola fila con estado `No Goals Set` y `Goal`/`Due Date` vacíos; esa fila no tiene clave, así que `applyProfile` falla y el consumidor tiene que descartar las filas con `Goal` vacío antes de aplicar el perfil.
  - `bamboo-assessment-progress`: clave `Employee Name` + `Review Cycle` + `Department` (`Manager` puede venir vacío, así que no sirve como clave).
  - `Manager` y `Department` son los vigentes al momento del export, no los del ciclo: por eso solo entran en una clave donde no hay otra forma de separar homónimos.
- Para otra fuente, crear un perfil propio con el mismo esquema (o copiar uno incluido y ajustar `columnMap`).

### Subir un archivo (`/imports/upload`)

La pantalla `/[locale]/imports/upload` importa un archivo CSV, XLSX, Parquet o NDJSON (hasta 50 MB) a `raw_record`:

1. **Elegir y previsualizar.** Se guarda el archivo como `var/uploads/<sha256>.<ext>` (ignorado por git; el mismo contenido se guarda una sola vez, con el nombre que tenga) y se muestran las columnas detectadas (con su tipo) y las primeras 20 filas (ordenadas por la primera columna).
2. **Perfil.** Se elige un perfil incluido o uno guardado, o se define uno nuevo sobre las columnas detectadas (nombre, entidad, columnas clave, watermark y campo canónico de cada columna que se quiera mapear). Los perfiles nuevos se guardan como `var/profiles/<nombre>.json` (ignorado por git) una vez que el archivo coincide con ellos. Si falta una columna del perfil o su tipo no encaja (`validateAgainstSchema`), se marca en la vista previa y no se puede importar; el servidor lo vuelve a comprobar y no escribe nada.
3. **Importar.** `FileSourceAdapter(profile, lake, table)` lee el archivo con `readOptionsFor` y `applyProfile` y `runIngest` lo aterriza en `raw_record` en **modo `landing`**: solo se escriben `raw_record` e `ingest_run`, sin mapeo a dominio (el de evaluaciones y feedback es el issue #22; el de empleados, historial y metas desde archivo, el #29). El `payload` de cada fila es `{ fields, extra, deleted, watermark, raw }`. Las filas que el perfil no puede mapear (por ejemplo las de `No Goals Set` de `bamboo-goal-status`, con `Goal` vacío) cuentan como rechazadas con su motivo, no frenan la corrida. La corrida guarda `params = { entity, fileName, profile, size, sha256 }`.
4. **Resultado.** Al terminar se abre la corrida (`/imports/runs/<id>`: conteos, rechazos y parámetros); mientras carga, la pantalla muestra las filas leídas, nuevas, sin cambios y rechazadas. Las corridas de archivo no avanzan `sync_state` (un archivo no es una fuente incremental). Volver a subir el mismo archivo da 0 registros nuevos (el hash del payload de cada fila no cambia).

Lo pesado no corre dentro de un request: las Server Actions solo guardan el archivo y lanzan `scripts/ingest-upload.ts` en un proceso aparte (`node --import tsx`, vía `runUploadWorker` en `src/modules/lake/upload-worker.ts`), que lee el archivo con DuckDB y hace la ingesta; también se puede correr a mano (`echo '{"uploadId":"<sha256>.csv"}' | pnpm exec tsx scripts/ingest-upload.ts inspect`). Las carpetas se pueden cambiar con `UPLOADS_DIR` y `PROFILES_DIR`. Los límites de cuerpo de Server Actions y del proxy están subidos a 52 MB en `next.config.ts`.

### Tests y fixtures

- `runLakeAdapterContractTests(name, openAdapter)` (`src/modules/lake/contract.ts`) es la suite de contrato: `openAdapter(scenario)` debe devolver el adaptador abierto sobre la carpeta de `src/modules/lake/__fixtures__/<scenario>/` (o su equivalente en el lake real). Escenarios: `initial`, `delta-1` (update, insert y soft-delete), `schema-drift` (columna nueva y cambio de tipo) y `messy` (NULL, claves duplicadas, empates y watermark NULL, BIGINT mayor a 2^53). Los fixtures son CSV sintéticos escritos a mano; además hay `airbyte/` y `bamboo-reports/` para los perfiles (este último usa los encabezados reales de `fixtures/bamboo-reports/`, y `profiles.test.ts` valida cada perfil de Bamboo contra los CSV de `fixtures/bamboo-reports/small/`).
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
