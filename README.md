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

- **Entidades:** las del registro `src/modules/ingest/registry.ts` (hoy `employee`). Para sumar una (job_history, goal, ...) se agrega una entrada `{ adapters: { fixture, bamboo }, run }` al `Map`; el CLI, el log de corridas y `sync_state` la toman sin más cambios. Con `--all` se ejecutan en el orden del registro y una falla no frena a las siguientes.
- **`--source fixture`** lee respuestas de Bamboo guardadas en `--dir` (por defecto `src/modules/bamboo-client/__fixtures__`). **`--source bamboo`** llama a la API y necesita `BAMBOO_COMPANY_DOMAIN` y `BAMBOO_API_KEY` (en `.env.local` o en el entorno).
- **`--since`** acota la extracción a lo cambiado desde ese instante (ISO 8601); `last` usa el watermark guardado para esa fuente y entidad (si no hay, la corrida es completa). Una corrida con `--since` es incremental y nunca da de baja lo que no devolvió. Hoy el adaptador de Bamboo igual lee la lista completa (la reingesta es idempotente); el feed de cambios lo aprovechará sin cambiar el CLI.
- **Watermark:** `sync_state` guarda, por (fuente, entidad), el inicio de la última corrida exitosa. Solo avanza en la misma transacción que marca la corrida como `succeeded`; una corrida que falla queda en `error` (con `finished_at` y el mensaje) y deja el watermark anterior intacto.
- **Salida:** una tabla resumen (leídos, insertados, actualizados, sin cambios, eliminados, rechazados, duración e id de corrida). Código de salida `0` si todo salió bien, `1` si alguna corrida falló y `2` si los argumentos son inválidos.
- Dos corridas de la misma entidad nunca se pisan: la segunda espera a la primera (lock de Postgres por entidad).
- `pnpm ingest:employees` queda como alias de `pnpm ingest employee` (con `--source fixture` por defecto).

Ejemplo de cron (crontab del servidor; cada 15 minutos incremental y una completa por la noche, que es la que da de baja a quien ya no está en Bamboo):

```cron
*/15 * * * * cd /srv/performance-review && pnpm ingest --all --source bamboo --since last >> /var/log/pr-ingest.log 2>&1
0 3 * * *    cd /srv/performance-review && pnpm ingest --all --source bamboo >> /var/log/pr-ingest.log 2>&1
```

El código de salida distinto de cero permite alertar desde el propio cron (por ejemplo con `MAILTO` o un wrapper que avise a un canal).

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
