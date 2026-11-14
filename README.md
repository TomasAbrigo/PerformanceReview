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

`pnpm test:e2e` no toca tu base de desarrollo: corre contra una base propia, `E2E_DATABASE_URL` o, por defecto, `DATABASE_URL` con `_e2e` al final del nombre (por ejemplo `postgres_e2e`). El global setup la crea si no existe (solo en un host local), le aplica las migraciones y la siembra con `pnpm db:seed --size small --reset`; el servidor de Next del e2e usa esa misma base.

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

Los esquemas zod de las respuestas de Bamboo viven en un único módulo, `src/modules/bamboo-client/schemas.ts`: lo usan el cliente, los adapters y los tests del generador (`src/fixtures/bamboo-schemas.ts` solo lo re-exporta, no define nada), así que lo generado y lo que lee el cliente no pueden divergir. Son tolerantes a propósito: los ids pueden llegar como número o string y se normalizan a string, y list-employees acepta `employeeId` (la API real) o `id`, siempre normalizado a `id`. Los campos de contenido están descritos (tipan lo que llega) pero no se validan: un valor raro en un campo que nadie necesita no tira abajo una página ni los goals de un empleado. Los valores (fechas, estados) se validan por registro en el staging de cada entidad, no acá; que el generador solo emita valores válidos (estados, rangos, ids numéricos, fechas ISO) lo verifica un test de convenciones sobre los JSON generados.

## Seed

Puebla la base local con la empresa sintética de `fixtures/bamboo/<size>` pasando por las mismas pipelines de ingesta que usa el cron (las del registro de `src/modules/ingest/registry.ts`, en su orden: `employee`, `job_history`, `goal`):

```bash
pnpm db:seed                       # --size small por defecto
pnpm db:seed --size small --reset  # vacía las tablas de dominio y siembra
pnpm db:seed --size demo           # 400 personas
```

- **Qué deja:** `small` lee 40 registros de Bamboo y deja **36 personas** (las del generador: `company.identity.persons`), 65 filas de historial de puesto y 109 goals. Los 4 reingresos (misma persona, legajo y casi siempre email, con un id de Bamboo nuevo) quedan **en la cola de identidad** (`/es/imports/identity`, ver `--unmatched` más arriba): el módulo de identidad nunca los une solo. Hasta que alguien los resuelva, ese id no es una persona, no tiene historial ni goals (`job_history` los rechaza: "unknown employee") y no aparece en el organigrama. `demo` lee 400 registros y deja 392 personas, 8 casos en la cola, 555 filas de historial y 1399 goals. Los goals son los de los empleados activos (la pipeline de goals solo lee a esos, ver #6), no los 143 / 1484 del fixture. Los comentarios de goals traen el conteo pero no el texto (los fixtures no tienen cuerpos).
- **`--reset`** hace `TRUNCATE` (no `DROP`) de las tablas que llena la ingesta y de lo que cuelga de ellas, hijas primero: `person`, `source_identity`, `employment`, historiales, `identity_match_issue`, `goal*`, los ciclos de evaluación (`review_cycle`, `cycle_*`, `question_revision`: apuntan a personas), `raw_record`, `ingest_run` y `sync_state` (lista en `RESET_TABLES`, `src/modules/ingest/seed.ts`). No toca lo que es de la app (escalas y plantillas de evaluación). Solo corre contra una base local: si `DATABASE_URL` no apunta a `localhost`/`127.0.0.1` se niega. Un test falla si aparece una tabla nueva que no esté clasificada en `RESET_TABLES` o `KEPT_TABLES`.
- **Idempotente:** una segunda corrida no inserta ni actualiza nada: lo aplicado da `unchanged` y lo que espera en la cola sigue esperando (`issues`, `rejected` de `job_history`). Imprime la misma tabla que `pnpm ingest` (entidad, adaptador, estado, leídos, insertados, actualizados, sin cambios, eliminados, rechazados, en cola, ignorados, duración y el id de la corrida) y los totales; las corridas quedan en `/es/imports/runs`.
- **Igual que la CLI de ingesta:** `seedFromFixtures` usa el mismo ciclo que `pnpm ingest --all` (`runEntities`, `src/modules/ingest/cli.ts`) y cada entidad corre bajo el mismo lock advisory (`ingest:<entidad>`), así que no se pisa con un cron. Si una pipeline falla, sigue con la siguiente, la tabla la muestra como `error` con el id de su corrida, el detalle sale por stderr y el comando termina con código `1` (`2` si los argumentos o la configuración son inválidos).
- **`--reset` mientras hay una corrida:** se niega. Antes de truncar intenta tomar el lock de cada entidad (el que una corrida en curso tiene tomado todo el tiempo que dura) y si alguno está tomado aborta sin tocar nada. Se usa el lock y no el estado `running` de `ingest_run` porque un proceso que murió deja esa fila para siempre y bloquearía el reset; el lock se libera solo.
- **Historial de puesto:** el manager actual de cada persona se resuelve (sale de `supervisorEId`); el de las filas anteriores viene como nombre ("Apellido, Nombre") y queda sin resolver (se ve como "(sin resolver)") hasta que el módulo de identidad matchee nombres.
- **Desde código:** `seedFromFixtures({ size, db, lock? })` (`src/modules/ingest/seed.ts`) corre las pipelines y devuelve el resultado de cada una (con su `status`); `resetDomainTables(db)` vacía. Los usa `pnpm db:seed` y los tests. `e2e/global-setup.ts` llama a `pnpm db:seed --size small --reset` (y de nuevo sin `--reset`, para tener una corrida de `employee` sin cambios; `e2e/seed-data.ts` calcula lo que los specs esperan a partir del mismo generador). El caso de un reingreso que llega en una corrida posterior contra una base ya poblada lo cubren `e2e/identity.setup.ts` y `identity-later.spec.ts`.
- **`FixtureAdapter`** lee ese layout (`employees/list/page-NNN.json`, `employees/get/<id>.json`, `employees/tables/<tabla>/all.json`, `performance/goals/<id>.json`) y también el plano escrito a mano de `src/modules/bamboo-client/__fixtures__` (casos borde de los tests). Para ingestar el generado con la CLI genérica: `pnpm ingest --all --source fixture --dir fixtures/bamboo/small`.
- Los CSV de `fixtures/bamboo-reports/<size>` todavía no se siembran (llegan con #22).

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
- **`--source fixture`** lee respuestas de Bamboo guardadas en `--dir` (por defecto `src/modules/bamboo-client/__fixtures__`, tres empleados escritos a mano; también entiende el layout generado de `fixtures/bamboo/<size>`, ver Seed). **`--source bamboo`** llama a la API y necesita `BAMBOO_COMPANY_DOMAIN` y `BAMBOO_API_KEY` (en `.env.local` o en el entorno).
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

## Notificaciones

Las notificaciones de v1 son **internas**: se guardan en la tabla `notification` y se ven en la bandeja `/es/inbox` (campana con el contador de no leídas en el header y las 3 últimas no leídas en `/es/me`). **No se envían emails** (fuera de alcance del PRD en v1).

Cada notificación guarda `kind`, el destinatario, el ciclo y el request (si aplica) y un `payload` con las variables del texto (`cycleName`, `dueDate`, `daysLeft`, `senderName`, ...). El texto nunca se guarda: se arma al mostrarla, en el idioma de quien la lee, con las claves `Notifications.messages.<kind>` de `src/messages/{es,en}.json` (y el destino del botón "Abrir" sale de `notificationHref`, `src/modules/notifications/href.ts`). Para sumar un tipo: agregarlo a `src/modules/notifications/kinds.ts`, generar la migración del enum, escribir su mensaje en es/en y, si tiene página propia, su destino en `href.ts`.

**Idempotencia:** `dedupe_key` es único y toda creación pasa por `createNotification`/`createNotifications` (`ON CONFLICT DO NOTHING`), así que repetir un evento, o correr dos procesos a la vez, no duplica nada.

### Recordatorios automáticos

```bash
pnpm notifications:run                        # recordatorios de hoy (zona horaria de la empresa)
pnpm notifications:run --as-of 2026-07-08     # como si hoy fuera esa fecha
pnpm notifications:run --offsets 7,3,1,0      # otros días de anticipación
pnpm notifications:run --help
```

Crea un `reminder_due` para cada tarea **pendiente** (request en borrador, participante todavía en el ciclo, ciclo no cerrado ni borrado y en una fase en la que ese tipo de evaluación se puede escribir) cuya fecha límite (`due_dates` del ciclo) sea exactamente `--as-of` + 7, + 1 o + 0 días (por defecto `7,1,0`, las cadencias de `docs/research/06`). La fecha límite de cada tipo sale de su fase: `self` → `self`, `manager` → `manager`, `peer` y `upward` → `peer`. Quien ya envió, rechazó o salió del ciclo no recibe nada, y un día en que el comando no corre no se recupera (no hay recordatorios atrasados). La clave de deduplicación es `reminder_due:<requestId>:<díasAntes>:<fechaLímite>`: correr el comando varias veces el mismo día no duplica, y si People mueve la fecha límite, el nuevo día de aviso genera un recordatorio nuevo. `--as-of` por defecto es `todayLocal()` (America/Argentina/Buenos_Aires), no la zona del servidor. Código de salida `0` (ok) o `2` (argumentos o `DATABASE_URL` inválidos).

Ejemplo de cron (una vez por día, a las 7 AM hora de Buenos Aires como los emails de Bamboo; el servidor está en UTC, de ahí las 10):

```cron
0 10 * * * cd /srv/performance-review && pnpm notifications:run >> /var/log/pr-notifications.log 2>&1
```

### Desde el código

Todo está en `@/modules/notifications`:

| Función                                                                        | Para qué                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateDueReminders(db, { asOf?, offsets? })`                                | Lo que corre el CLI. Devuelve `{ asOf, offsets, candidates, created }`.                                                                                                                                                                                                          |
| `remind(db, actor, requestId, { asOf? })`                                      | Recordatorio manual ("Recordar") de un request pendiente: lo puede enviar el manager del snapshot del participante o HR (`NotificationError`: `not_found`, `forbidden`, `not_pending`). Máximo uno por remitente, request y día: devuelve `{ created: false }` en la repetición. |
| `createNotification(db, input)` / `createNotifications(db, inputs)`            | Punto de escritura estable: idempotente por `dedupeKey`; devuelve si se creó (o cuántas).                                                                                                                                                                                        |
| `notifyPhaseChanged(db, cycleId, from, to)`                                    | Avisa a los participantes activos del cambio de fase. Lo llaman `launchCycle` y `transition` de review-core dentro de su transacción.                                                                                                                                            |
| `notifyReviewShared` / `notifyFeedbackReceived` / `notifyCalibrationPublished` | Eventos para que los llamen los slices de compartir (#12), feedback (#14) y calibración (#16). Idempotentes. El de feedback nunca incluye al autor (puede ser anónimo).                                                                                                          |
| `listNotifications(db, actor, { unreadOnly?, limit?, cursor? })`               | Bandeja del actor: no leídas primero, luego leídas, más nuevas primero; paginado por cursor (`nextCursor`).                                                                                                                                                                      |
| `markRead(db, actor, ids)` / `markAllRead(db, actor)` / `unreadCount`          | Solo tocan las notificaciones propias; los ids ajenos se ignoran. Sin persona (People actuando como equipo) no hay bandeja.                                                                                                                                                      |

### Email (fuera de alcance)

Hoy `createNotifications` (`src/modules/notifications/service.ts`) es el único punto por el que se crea una notificación. Un adaptador de email se enchufaría ahí: devolver las filas nuevas (`RETURNING`) y pasarlas a un canal que arme el texto con las mismas claves de i18n en el idioma del destinatario; o un worker aparte que lea las notificaciones sin marca de envío. Nada de eso existe todavía.

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
2. **Perfil.** Se elige un perfil incluido o uno guardado, o se define uno nuevo sobre las columnas detectadas (nombre, entidad, columnas clave, watermark y campo canónico de cada columna que se quiera mapear). El cliente indica el perfil como `{ builtin: nombre }`, `{ saved: nombre }` (el servidor lee su definición) o `{ custom: perfil, replace? }`. Un perfil nuevo se guarda como `var/profiles/<nombre>.json` (ignorado por git) solo cuando la importación terminó bien; no puede llamarse como uno incluido (`profile_exists`) ni pisar uno guardado salvo que se pida (`replace`). Si falta una columna del perfil o su tipo no encaja (`validateAgainstSchema`), se marca en la vista previa y no se puede importar; el servidor lo vuelve a comprobar y no escribe nada.
3. **Importar.** `FileSourceAdapter(profile, lake, table)` lee el archivo con `readOptionsFor` y `applyProfile` y `runIngest` lo aterriza en `raw_record` en **modo `landing`**: solo se escriben `raw_record` e `ingest_run`, sin mapeo a dominio (el de evaluaciones y feedback es el issue #22; el de empleados, historial y metas desde archivo, el #29). El `payload` de cada fila es `{ fields, extra, deleted, watermark, raw }`. El `source_system` es `bamboo_export` solo para los perfiles incluidos `bamboo-*` y `lake` para el resto (el adaptador lo recibe como opción, no lo deduce del nombre). Las filas que el perfil no puede mapear (por ejemplo las de `No Goals Set` de `bamboo-goal-status`, con `Goal` vacío) cuentan como rechazadas, no frenan la corrida; cada rechazo guarda el motivo en inglés (`reason`) y datos estructurados (`code`, `column`, `values`) con los que la pantalla lo redacta en su idioma. La corrida guarda `params = { entity, fileName, profile, size, sha256 }`.
4. **Resultado.** Al terminar se abre la corrida (`/imports/runs/<id>`: conteos, rechazos y parámetros); mientras carga, la pantalla muestra las filas leídas, nuevas, sin cambios y rechazadas. Las corridas de archivo no avanzan `sync_state` (un archivo no es una fuente incremental). Volver a subir el mismo archivo da 0 registros nuevos (el hash del payload de cada fila no cambia).

Lo pesado no corre dentro de un request: las Server Actions solo guardan el archivo y lanzan `scripts/ingest-upload.ts` en un proceso aparte (`node --import tsx`, vía `runUploadWorker` en `src/modules/lake/upload-worker.ts`), que lee el archivo con DuckDB y hace la ingesta. Si tarda más del tiempo máximo se le manda SIGTERM: el worker corta en la fila siguiente y deja la corrida en `error` (si hubo que matarlo, la acción marca como `error` las corridas de ese archivo que quedaron en `running`). También se puede correr a mano (`echo '{"uploadId":"<sha256>.csv"}' | pnpm exec tsx scripts/ingest-upload.ts inspect`). Las carpetas se pueden cambiar con `UPLOADS_DIR` y `PROFILES_DIR`. Los límites de cuerpo de Server Actions y del proxy están subidos a 52 MB en `next.config.ts`.

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
