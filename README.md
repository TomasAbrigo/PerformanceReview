# Performance Review

[![CI](https://github.com/TomasAbrigo/PerformanceReview/actions/workflows/ci.yml/badge.svg)](https://github.com/TomasAbrigo/PerformanceReview/actions/workflows/ci.yml)

Herramienta interna de evaluaciones de desempeño que reemplaza el módulo de performance de BambooHR. Los datos se ingestan desde Bamboo conservando sus IDs de origen.

**Stack:** Next.js (App Router, TypeScript estricto, Tailwind v4, shadcn/ui) · next-intl (`es` por defecto, `en`) · Supabase local · Drizzle ORM (postgres-js) · Vitest · Playwright.

> Solo desarrollo local. No hay deploy configurado.

## Estado del proyecto

Alcance y decisiones: [`docs/prd.md`](docs/prd.md) (issue [#1](https://github.com/TomasAbrigo/PerformanceReview/issues/1); la iteración 2, "Insights sobre Bamboo", es el issue [#53](https://github.com/TomasAbrigo/PerformanceReview/issues/53)); la investigación de respaldo está en `docs/research/`. El trabajo se sigue en los [issues del repo](https://github.com/TomasAbrigo/PerformanceReview/issues).

**Iteración 2: insights sobre Bamboo.** Bamboo sigue siendo donde se hacen las evaluaciones; esta app ingesta sus datos y los analiza. La poda ([#54](https://github.com/TomasAbrigo/PerformanceReview/issues/54)) dejó solo lo que usa el módulo de insights (solo local, con datos sintéticos):

- Datos: ingesta desde Bamboo (empleados, historial de puesto y manager, goals) con identidad "golden" y cola de conflictos, organigrama a una fecha, importación por archivo con perfiles de fuente (incluida la importación histórica de assessments y feedback desde los CSV de Bamboo), adaptador de lake sobre archivos, log de corridas, seed y fixtures.
- Modelo de evaluaciones como datos: escalas y templates, ciclos como contenedores de solo lectura con el snapshot organizacional y de goals de cada participante, pedidos, respuestas y preguntas congeladas, con una única regla de lectura (`canRead`).
- Análisis: dashboards, panel de calidad de datos, API JSON de solo lectura (incluidos los pedidos y respuestas) y exports CSV.

Se quitaron los flujos para hacer evaluaciones dentro de la app: asistente y fases de ciclo, autoevaluación y evaluación del manager, pares y upward, comparación, notas, acuse de recibo, calibración, operación del ciclo, notificaciones, cadencia por fecha de ingreso, `/me` y `/team`. Sus datos (tablas de pedidos, respuestas y `final_rating`) se conservan.

**Pendiente o fuera de alcance:**

- **Acceso real a Bamboo y decisiones de negocio** ([#23](https://github.com/TomasAbrigo/PerformanceReview/issues/23), tarea para una persona): conseguir una API key y grabar respuestas reales para compararlas con los fixtures, verificar el catálogo de datasets y los exports de Performance, y definir con People la clave confiable de empleado, las escalas históricas, los años de histórico y el anonimato de pares. Hasta entonces todo corre con fixtures (las columnas de los reportes de Bamboo siguen sin verificarse contra un export real).
- **Sin login:** modo administrador con el selector "Actuar como". Supabase Auth, roles reales y RLS quedan para más adelante (las variables `NEXT_PUBLIC_SUPABASE_*` están reservadas para eso).
- **Conectores reales al lake** (BigQuery, Snowflake, Databricks, Redshift, Postgres): hoy solo existe `DuckDbFileLake` sobre archivos, con la suite de contrato lista para los reales.
- **Sin deploy:** todo corre contra el Supabase local en Docker.

## Requisitos

- Node 24 y pnpm
- Docker corriendo
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Cómo correrlo

```bash
pnpm install
cp .env.example .env.local   # los valores locales por defecto sirven tal cual (ver "Variables de entorno")
supabase start               # levanta Postgres, Auth, Studio, etc. en Docker
pnpm db:migrate              # aplica las migraciones de Drizzle (carpeta drizzle/)
pnpm dev                     # http://localhost:3000 -> redirige a /es
```

Para apagar la base: `supabase stop`. Para recrearla desde cero: `pnpm db:reset` y luego `pnpm db:migrate`.

## Cómo probar la demo en 5 minutos

Con Docker corriendo (la primera vez `supabase start` descarga las imágenes y tarda):

```bash
pnpm install
cp .env.example .env.local
supabase start
pnpm db:migrate
pnpm db:seed --size demo   # 400 registros de Bamboo: 392 personas, 8 casos en la cola de identidad, 1399 goals
pnpm dev                   # http://localhost:3000 -> redirige a /es
```

Las escalas y los templates del sistema se crean solos cuando arranca el servidor. No hay login: empezás actuando como **People** (sin persona), que ve todo; el selector **"Actuar como"** (arriba) cambia el rol (People, Manager, Empleado o Dirección) y la persona (Dirección no tiene persona). Después:

1. **Mirar los datos.** `/es/people` (ficha con identificadores de origen e historial de puesto), `/es/org` (organigrama con selector de fecha), `/es/team/goals` (goals de los reportes de un manager), `/es/imports/runs` (las corridas del seed), `/es/imports/identity` (los 8 reingresos esperando resolución) y `/es/data-quality`.
2. **Importar la historia de evaluaciones.** En `/es/imports/upload` subí `fixtures/bamboo-reports/demo/employee-performance.csv` (perfil `bamboo-employee-performance`) e "Importar"; corre en un proceso aparte y con el tamaño demo puede tardar. El resultado (`/es/imports/history/<corrida>`) lista los ciclos 2023 a 2025, ya cerrados; quien no se pudo cruzar por nombre queda en la cola de identidad. Opcional: `feedback-status.csv` suma el feedback de pares.
3. **Ver un ciclo.** `/es/cycles` y el detalle de un ciclo: período, cantidad de preguntas y los participantes con su manager, área y puesto a la fecha del snapshot.
4. **Historial de una persona.** Desde su ficha, "Evaluaciones" (`/es/people/<id>/reviews`): cada ciclo con el manager y el puesto de ese momento y las respuestas que el actor puede leer.
5. **Dashboards.** Como People, `/es/dashboards`: avance del ciclo, distribución de ratings, goals vs rating y brecha self vs manager; "Trayectoria" por persona, "Ver equipo" (jerarquía "al momento de la review" o "actual"), la vista de dirección y los botones "Exportar CSV". Actuando como un manager, solo su equipo.
6. **API y exports.** `/api/v1/cycles`, `/api/v1/cycles/<id>/requests` y `/api/v1/export/answers.csv?cycle_id=<id>` devuelven los mismos datos en JSON y CSV.

## Variables de entorno

Viven en `.env.local` (ignorado por git); `.env.example` es la plantilla. Con la base local de Supabase, `DATABASE_URL` alcanza para casi todo.

| Variable                                                     | Para qué                                                                                                                                                                        | Por defecto                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                                               | Postgres que usan la app, las migraciones, el seed y los tests de DB.                                                                                                           | `postgresql://postgres:postgres@127.0.0.1:55322/postgres`                      |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Reservadas para Supabase Auth (v2): **no se usan aún** (v1 no tiene login). Se dejan en `.env.example` para no tener que sumarlas después; no hace falta completar la anon key. | `http://127.0.0.1:55321` / un valor de relleno                                 |
| `E2E_DATABASE_URL`                                           | Base propia de `pnpm test:e2e`, que la vacía y la resiembra en cada corrida (solo en un host local).                                                                            | `<DATABASE_URL>_e2e`: `DATABASE_URL` con `_e2e` al final del nombre de la base |
| `E2E_PORT`                                                   | Puerto del `next dev` que levanta Playwright.                                                                                                                                   | `3100`                                                                         |
| `BAMBOO_COMPANY_DOMAIN` / `BAMBOO_API_KEY`                   | Solo para `pnpm ingest <entidad> --source bamboo`.                                                                                                                              | sin definir                                                                    |
| `API_TOKEN`                                                  | Si está definido, `/api/v1` y los CSV piden `Authorization: Bearer <API_TOKEN>`.                                                                                                | vacío: API abierta (desarrollo local)                                          |
| `UPLOADS_DIR` / `PROFILES_DIR`                               | Carpetas de los archivos subidos en `/imports/upload` y de los perfiles guardados.                                                                                              | `var/uploads` / `var/profiles`                                                 |

## Funcionalidades

Qué hay en la app, dónde está en la UI y las reglas que conviene conocer. Las rutas van bajo `/es` (o `/en`); el inicio (`/es`) enlaza a las pantallas principales. Los detalles de ingesta, seed, lake y API están en las secciones siguientes.

### Personas, organigrama y goals

- **Dónde:** `/people` (búsqueda solo por nombre y sin email en la lista; la ficha muestra identificadores de origen, períodos de empleo, historial de puesto y manager, y los goals de la persona, y el email solo con el rol People, ver [Datos sensibles](#datos-sensibles)), `/org` (organigrama a una fecha elegida), `/team/goals` (goals de los reportes directos de un manager) y la cola de identidad `/imports/identity`.
- **Reglas:** los cruces usan el UUID interno y se conservan los IDs de Bamboo. Una persona dada de baja y reingresada es una sola persona con dos períodos de empleo y su reingreso siempre pasa por la cola de identidad. El manager y el área "de entonces" salen del historial de puesto con vigencias, no del dato actual.

### Configuración de insights (`/settings/insights`)

- **Dónde:** `/settings/insights`, solo People (los demás roles ven "Sin acceso"). Un formulario edita los valores de abajo; el servidor valida cada uno (y los cortes de semestre entre sí) y devuelve los errores campo por campo.
- **Cómo se guarda:** la tabla `app_setting` (clave, valor `jsonb`, quién y cuándo) solo guarda lo que People cambió; las claves, su validación y sus valores por defecto viven en el código (`src/modules/settings/definitions.ts`). `getSettings(db)`, `getSetting(db, clave)` y `setSetting(db, actor, clave, valor)` / `updateSettings(db, actor, cambios)` (todo o nada) están en `src/modules/settings`. Un valor guardado que ya no valida se ignora y vale el default.
- **Auditoría:** cada cambio efectivo escribe una fila en `admin_audit_log` (`action = setting.update`, `target_type = app_setting`, `target_key = <clave>`, `before` y `after` con el valor, y la persona con la que actuó People si había una). Un valor igual al actual no es un cambio y no audita. `pnpm db:seed --reset` no toca los valores de `app_setting` (sí vacía el log de auditoría, que cuelga de los ciclos).

| Clave                      | Para qué                                                                             | Por defecto | Valores válidos          |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------- | ------------------------ |
| `alerts.dropThreshold`     | Caída de retención o compromiso entre ciclos que dispara una alerta (puntos).        | `2`         | entero de 1 a 4          |
| `alerts.riskThreshold`     | Riesgo: retención y compromiso a la vez iguales o menores a este valor (escala 1-5). | `2`         | entero de 1 a 4          |
| `aggregation.minGroupSize` | Mínimo de personas (n) que Dirección y los exports anonimizados pueden mostrar.      | `5`         | entero de 2 a 100        |
| `semester.h1Start`         | Inicio del primer semestre (`MM-DD`).                                                | `01-01`     | día real, antes del H2   |
| `semester.h2Start`         | Inicio del segundo semestre (`MM-DD`).                                               | `07-01`     | día real, después del H1 |
| `semester.ambiguityDays`   | Margen en días de un corte de semestre dentro del cual un assessment es ambiguo.     | `15`        | entero de 0 a 60         |
| `analysis.provider`        | Proveedor del análisis cualitativo.                                                  | `mock`      | `mock` o `anthropic`     |

Hoy solo se lee el mínimo n (vista de dirección); los umbrales de alerta, los cortes de semestre y el proveedor los van a leer las pantallas e importaciones siguientes del módulo de insights.

### Escalas y templates (`/settings`)

- **Dónde:** `/settings/scales` (escalas de rating) y `/settings/templates` (lista y editor `/settings/templates/<id>`).
- **Escalas:** cada opción tiene un valor numérico, una etiqueta en español e inglés y un valor normalizado de 0 a 1, para comparar ratings aunque cambie la escala. Las del sistema (no se pueden borrar): "4 puntos descriptiva" (Necesita desarrollo, Cumple expectativas, Supera a menudo, Marca un nuevo estándar), "5 puntos" (de totalmente en desacuerdo a totalmente de acuerdo) y "Nunca…Siempre", más "Retención 1-5" (`retention_1_5`: de "Me aliviaría que se fuera" a "Haría todo por retenerlo") y "Compromiso 1-5" (`engagement_1_5`: de "Sin compromiso" a "Muy comprometido"), que reflejan las 5 opciones de Bamboo.
- **Templates:** secciones y preguntas (texto, calificación con escala u opción única) con texto en es/en. Cada pregunta define a quién aplica (autoevaluación, manager, par o upward), si la persona evaluada la ve, si es obligatoria y, opcionalmente, una función especial (`goals_rating`, `goals_comment`, `overall_rating`; ver "Ciclos"; y `retention` / `engagement`, que deben ser calificación, solo del manager y ocultas para la persona evaluada) y una **dimensión** para las abiertas (`strengths` Fortalezas, `improvement` Oportunidades de mejora, `custom_1..3`), que agrupa el análisis cualitativo. Los templates del sistema se crean al arrancar el servidor: "Evaluación de fin de año", "Ciclo de desarrollo de mitad de año" (sin ratings), "Feedback de pares", "Upward" (apagado en v1) y **"Evaluación semestral Santex"** (`santex_semester`: las 2 preguntas estándar de Bamboo para self y manager con dimensiones `strengths` / `improvement`, 3 custom marcadas como _placeholder_ hasta tener el texto real, y Retención y Compromiso del manager en Likert 1-5, ocultas para la persona evaluada). No se editan ni se borran: se clonan.
- **Versionado:** las preguntas de cada ciclo viven congeladas en revisiones inmutables (`question_revision`, con su escala copiada); editar un template no cambia el significado de lo ya respondido.

### Ciclos (`/cycles`)

- **Dónde:** la lista `/cycles` y el detalle `/cycles/<id>`, de solo lectura: período, fecha de snapshot, cantidad de preguntas y los participantes. Los ciclos llegan con la importación histórica (o el seed); la app ya no los crea ni les cambia la fase.
- **Estados:** el enum conserva las fases del flujo anterior (borrador, nominaciones, recolección, revisión del manager, calibración, compartir resultados, cerrado) porque los datos las tienen; los ciclos importados quedan cerrados.
- **Snapshot organizacional:** cada participante guarda el manager, el área, la división, el puesto y la ubicación a la fecha de snapshot (a partir del historial de puesto). Los análisis usan ese manager y esa área, no los actuales; un pedido del manager cuyo evaluador no coincide con el del snapshot queda marcado como `reviewer_mismatch` y se cuenta en `/data-quality`.
- **Goals:** cada participante tiene su snapshot de goals (`participant_goal_snapshot`: título, estado, progreso y fecha límite) con los goals que se solapan con el período o que están vinculados al ciclo (`cycle_goal_link`). El rating de goals y su comentario (`goals_rating`, `goals_comment`) se guardan aparte y nunca alimentan el rating general (`overall_rating`).
- **Rating final:** `final_rating` es un registro append-only con etapas (`computed`, `manager`, `calibrated`, `override`); la vista `v_current_rating` toma la de mayor precedencia y, dentro de ella, la más reciente. Los dashboards la leen.

### Actor y visibilidad

- **Selector "Actuar como":** como no hay login, la barra superior permite elegir un rol (People, Manager, Empleado o Dirección) y una persona; queda en la cookie `pr_actor`. Por defecto se actúa como "People (RR. HH.)", sin persona, que ve todo. **Dirección** no tiene persona (el selector la deshabilita y la cookie nunca guarda una): solo lee agregados.
- **Visibilidad:** una única función, `canRead` (`src/modules/review-core/visibility.ts`), decide quién lee cada pedido y cada respuesta: People todo; cada persona lo que escribió; el manager del snapshot la evaluación del manager y, ya enviadas, la autoevaluación (con double-blind) y el feedback de pares; la persona evaluada la evaluación del manager una vez compartida y solo las preguntas visibles para ella; el manager del manager y el manager actual lo ya compartido. El anonimato de pares lo decide `reviewerVisible`.
- **Reglas de autorización de los insights:** una función por concern en `src/modules/insights/authz.ts` (pura, sin servidor), que usan las consultas de los dashboards y las páginas:

| Rol                     | Alcance (`insightsScope`)                                          | Individuos | Indicadores sensibles (retención, compromiso, sentimiento) | Vista de dirección | `/imports`, `/data-quality`, `/settings` |
| ----------------------- | ------------------------------------------------------------------ | ---------- | ---------------------------------------------------------- | ------------------ | ---------------------------------------- |
| People (`hr`)           | `all`: todo, sin enmascarar                                        | sí         | sí                                                         | sí, sin enmascarar | sí                                       |
| Manager (`manager`)     | `directReports`: sus reportes directos del snapshot (no la cadena) | sí         | sobre otras personas, nunca sobre sí mismo                 | no                 | no                                       |
| Dirección (`direction`) | `aggregatesOnly`: agregados con n ≥ `aggregation.minGroupSize`     | no         | no (solo agregados)                                        | sí, enmascarada    | no                                       |
| Empleado (`employee`)   | `none`                                                             | no         | nunca, ni sobre sí mismo                                   | no                 | no                                       |

`canSeeIndividuals`, `canSeeSensitiveIndicators(actor, personaId)` y `canSeeExecutiveView` completan la función de alcance. Un manager sin persona no ve nada. Dirección tampoco lee pedidos ni respuestas (`canRead` siempre devuelve `false`) ni la API como persona.

- **Pantallas solo de People:** `/imports/*`, `/data-quality/*` y `/settings/*` (y sus server actions: subir e importar archivos, la cola de identidad, escalas, templates y la configuración de insights) responden "Sin acceso" a cualquier otro rol. Las páginas se envuelven en `HrOnly` (`src/components/access`) y las acciones en `onlyHr` / `requireHr(actor)` (`src/modules/actor`). La API (`/api/v1`) no cambia, salvo que `role=` acepta también `direction`.
- **Historial** `/people/<id>/reviews`: los ciclos cerrados o compartidos de una persona, con el manager, el puesto y el área de ese momento, el rating vigente y las respuestas que el actor puede leer.

### Dashboards (`/dashboards`)

- **Dónde:** `/dashboards` (filtros por ciclo, área, manager, ubicación y puesto), `/dashboards/team` (el equipo de un manager), `/dashboards/people/<id>` (trayectoria de una persona) y `/dashboards/executive` (vista de dirección).
- **Qué muestra:** avance del ciclo por tipo de evaluación; distribución de ratings normalizados (0 a 100 %) antes y después de calibrar, agrupada por área, manager, ubicación o puesto; goals del período contra el rating final; brecha entre autoevaluación y manager por pregunta y por persona; y la trayectoria de una persona con el rating, el manager y el puesto de cada ciclo.
- **Jerarquía:** el equipo de un manager se elige explícitamente "al momento de la review" (el snapshot del ciclo) o "actual".
- **Quién ve qué:** People ve todo; un manager, **sus reportes directos** del snapshot del ciclo (o los actuales, con la jerarquía "actual"), no toda la cadena: su equipo (`/dashboards/team`) lista solo a sus reportes directos y no puede abrir el de otro manager; una trayectoria se abre si la persona fue su reporte directo en el snapshot o lo es hoy. Un empleado es redirigido a su propia trayectoria, con solo lo publicado. **Dirección** va directo a `/dashboards/executive` (`/dashboards` la redirige) y no ve nada más.
- **Vista de dirección (`/dashboards/executive`):** para People y Dirección, agregados sin nombres ni ids. People la ve sin enmascarar; Dirección solo lo que llega al mínimo `aggregation.minGroupSize` (se lee una vez por pedido): las áreas con menos personas se agrupan en "Otros" y, si "Otros" tampoco llega, solo se cuenta cuántas personas quedaron afuera; un ciclo con menos participantes que el mínimo muestra solo el total de participantes.
- **CSV:** los botones "Exportar CSV" bajan avance, distribución, goals vs rating y brecha self vs manager (`dashboard-*.csv`, ver "Exports CSV").

### Calidad de datos y API (`/data-quality`, `/api/v1`)

- **Panel `/data-quality`:** un conteo por indicador (identidades sin resolver, personas o participantes sin manager, snapshots incompletos, historial de puesto con huecos o abierto tras la baja, `reviewer_mismatch`, corridas fallidas, etc.) con enlace a la lista de casos.
- **API JSON `/api/v1` y exports CSV:** de solo lectura, con los IDs internos y de Bamboo en cada objeto, paginación estable por cursor y errores `application/problem+json`. Incluye los pedidos de evaluación, sus respuestas y las preguntas congeladas de cada ciclo (con `requests.csv` y `answers.csv`), que nunca revelan quién escribió un feedback en un ciclo totalmente anónimo. Si `API_TOKEN` está definido, hace falta `Authorization: Bearer <API_TOKEN>`; vacío, queda abierta (desarrollo local).
- Los indicadores, los endpoints y los CSV están en [Calidad de datos, API JSON y exports CSV](#calidad-de-datos-api-json-y-exports-csv).

### Importación histórica

- **Dónde:** `/imports/upload` (elegir un archivo, previsualizar, elegir el perfil e importar; ver "Subir un archivo") y `/imports/history/<corrida>` (los ciclos que creó una corrida).
- **Perfiles de Bamboo:** subir el reporte _Employee Performance_ (perfil `bamboo-employee-performance`) crea un ciclo histórico **cerrado** por cada nombre de ciclo del archivo, con su período (de las fechas de assessment), los participantes, sus solicitudes y las respuestas. _Feedback Status_ (`bamboo-feedback-status`) suma el feedback de pares. Los otros perfiles (`bamboo-goal-status`, `bamboo-assessment-progress` y los de Fivetran o Airbyte) solo aterrizan en `raw_record`, igual que cuando se tilda "Solo aterrizar".
- **Reglas:** los reportes identifican a las personas solo por nombre; quien no se puede cruzar con nadie va a la cola de identidad. El snapshot de cada participante se calcula a la fecha de fin del período, y la solicitud del manager cuyo evaluador del archivo (el manager al exportar) no es el vigente en esa fecha queda marcada como `reviewer_mismatch`. Volver a subir el mismo archivo no crea nada nuevo. Las Q1/Q2 del manager se importan con rol `retention` / `engagement` y su letra se convierte a 1-5 (`option_value`, `normalized`) con la tabla de equivalencias `likert_mapping` (A-E: 5..1; A-D: 5, 4, 2, 1; ver [docs/likert-mapping.md](docs/likert-mapping.md)); una opción sin equivalencia se guarda igual (con la letra y sin puntaje) y aparece en `/data-quality` como `unmapped_answers`. Las Q3/Q4 llevan la dimensión `strengths` / `improvement` y las Custom Q<n> `custom_<n>`. Las columnas de los reportes siguen sin verificarse contra un export real de Bamboo (ver [Estado del proyecto](#estado-del-proyecto)).

## Tests y calidad

```bash
pnpm test:unit   # Vitest (jsdom) — *.test.ts(x)
pnpm test:db     # Vitest (node) contra DATABASE_URL — *.db.test.ts (requiere supabase start)
pnpm test:e2e    # Playwright (levanta next dev en E2E_PORT, 3100 por defecto)
pnpm test        # unit + db
pnpm check       # typecheck + lint + format:check + test:unit (como el job `checks` de CI)
pnpm check:sensitive  # falla si lo staged trae un CSV/XLSX fuera de fixtures/ o un email no sintético (--all: todo lo trackeado)
pnpm hooks:install    # activa .githooks/pre-commit (corre check:sensitive en cada commit)
pnpm typecheck
pnpm lint
pnpm format      # Prettier
```

Playwright baja su propio navegador, que se instala aparte: en local `pnpm exec playwright install chromium` (la primera vez); en CI, además de las librerías del sistema, `pnpm exec playwright install --with-deps chromium`.

`pnpm test:e2e` no toca tu base de desarrollo: corre contra una base propia, `E2E_DATABASE_URL` o, por defecto, `<DATABASE_URL>_e2e`, es decir `DATABASE_URL` con `_e2e` al final del nombre de la base (con la URL local de abajo, `postgres_e2e`). El global setup la crea si no existe (solo en un host local), le aplica las migraciones y la siembra con `pnpm db:seed --size small --reset`. El servidor de Next del e2e escucha en `E2E_PORT` (por defecto **3100**, para no chocar con `pnpm dev` en :3000) y usa esa misma base. Las dos variables son opcionales (ver "Variables de entorno").

## Datos sensibles

El repo solo guarda datos sintéticos. Los exports reales de Bamboo (CSV o XLSX de los reportes, respuestas de la API grabadas, cualquier archivo con datos de personas) van en **`data/private/`**. Toda la carpeta `data/` está ignorada por git (`.gitignore`), por Prettier (`.prettierignore`) y por ESLint, así que nada de lo que haya ahí se versiona ni se formatea; en un clon nuevo no existe y se crea a mano.

- **Check en CI y en local.** El test unitario `src/lib/sensitive-data.test.ts` (corre con `pnpm check` y en el job `checks`) recorre los archivos que git trackea y falla si encuentra (1) un `.csv`, `.xlsx`, `.xls` o `.parquet` fuera de `fixtures/` (se permiten también los de prueba de `src/modules/lake/__fixtures__/` y `src/modules/bamboo-client/__fixtures__/`), (2) cualquier cosa bajo `data/private/` (solo posible forzándola con `git add -f`) o (3) un email cuyo dominio no sea sintético. La lógica pura es `findSensitiveFiles` en `src/lib/sensitive-data.ts`; el mensaje nombra archivo, línea y dominio, pero nunca la dirección. Los archivos binarios no se leen, y se saltean `node_modules`, `pnpm-lock.yaml`, `drizzle/meta/` y `supabase/config.toml` (comentarios de la plantilla del CLI).
- **Dominio sintético.** `meridian-andina.example` (`SYNTHETIC_EMAIL_DOMAIN`, declarado una sola vez en `src/lib/sensitive-data.ts`): es el de todos los emails que genera `src/fixtures/company/identity.ts`, y por eso el de los fixtures y el seed. Además se aceptan `example.com`, `example.org`, `example.net` (y subdominios), los TLD reservados `.test`, `.example`, `.invalid` y `.localhost` (nunca son un buzón real) y las direcciones que no son un buzón: `noreply@github.com` y el usuario `git@` de los remotos SSH (`git@github.com`, `git@gitlab.com`, `git@bitbucket.org`). Si el check marca un email que es de prueba, usá uno de esos dominios; no lo agregues a la lista.
- **Hook pre-commit.** `pnpm hooks:install` (equivale a `git config core.hooksPath .githooks`) activa `.githooks/pre-commit`, que corre `pnpm check:sensitive` sobre lo que está en el índice (el contenido staged, no el del working tree) y cancela el commit con código 1 y un mensaje claro (también si `pnpm` no está en el `PATH`, donde el check no puede correr). `pnpm check:sensitive --all` revisa todo lo trackeado, como el test. `core.hooksPath` es una configuración del repositorio: la comparten todos sus worktrees.
- **El email es un dato personal y se muestra lo mínimo:**
  - No sale en las listas: `/people` no tiene columna de email y la búsqueda (`q`, también en `GET /api/v1/people` y `people.csv`) compara solo el nombre. La única búsqueda por email es la de candidatos de la cola de identidad (`/imports/identity`), donde People la necesita para resolver un caso.
  - La ficha de persona (`/people/<id>`) lo muestra, bajo el nombre y como identificador `work_email`, solo con el rol People (`hr`); con cualquier otro rol del selector "Actuar como" no aparece. La regla es una sola (`canSeeEmail`, `src/modules/actor/types.ts`).
  - `people.csv` no trae la columna `email`; se incluye con `?include_email=1` (ver [Exports CSV](#exports-csv)).
  - `GET /api/v1/people` y `GET /api/v1/people/{id}` leen como People por defecto (`work_email` incluido); con `?as_person=<id>&role=manager|employee` faltan `work_email` y el identificador de tipo `work_email` de `source_identities`.
  - Ningún log ni mensaje de error lleva emails: los errores inesperados se escriben con `logError` / `errorMessage` (`src/lib/log.ts`), que reemplazan cualquier dirección por `[email]` y las credenciales de una URL de conexión por `[credentials]` (un error del driver de Postgres puede traer la fila que falló). `src/lib/logging-sources.test.ts` hace un grep del código: ningún `console.*` con campos de email ni con un error crudo.
  - Pendiente: la cola de identidad y las listas del panel de calidad de datos siguen mostrando el email, porque es la clave con la que People cruza identidades; hay que revisarlo cuando existan roles reales.
- **Secretos.** `.env.example` solo trae valores locales de demo y variables vacías; los reales van en `.env.local` (ignorado por git).

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
- **Historial de puesto:** el manager de la fila vigente de cada persona sale de `supervisorEId`; el de las filas anteriores viene solo como nombre ("Apellido, Nombre") y se resuelve con `resolveManagerName` (`src/modules/ingest/job-history.ts`): (1) se pasa a "Nombre Apellido" y se compara con el nombre de las personas respetando el orden de las palabras, sin contar mayúsculas, acentos ni espacios (`orderedName`, `src/modules/identity/normalize.ts`: "Páez, Martín" es "Martin Paez", pero "López, María José" no es "José María López"); (2) si hay homónimos, gana el único que tenía un empleo vigente en la fecha de la fila (alguien que se fue y otro que entró después con el mismo nombre no se pisan); si siguen siendo varios, queda sin resolver; (3) solo si nadie tiene el nombre en ese orden se prueba con las mismas palabras en cualquier orden (`normalizeName`), exigiendo lo mismo, y esa coincidencia se cuenta aparte como `managerResolvedFuzzy`. Lo que no se resuelve queda con `manager_person_id` null y `manager_raw` intacto (se ve como "(sin resolver)") y se cuenta en `managerUnresolved` de la corrida de `job_history`. Con el seed `small` se resuelven todas las filas históricas (29 de 29; antes 0), con `demo` 163 de 163.
- **Desde código:** `seedFromFixtures({ size, db, lock? })` (`src/modules/ingest/seed.ts`) corre las pipelines y devuelve el resultado de cada una (con su `status`); `resetDomainTables(db)` vacía. Los usa `pnpm db:seed` y los tests. `e2e/global-setup.ts` llama a `pnpm db:seed --size small --reset` (y de nuevo sin `--reset`, para tener una corrida de `employee` sin cambios; `e2e/seed-data.ts` calcula lo que los specs esperan a partir del mismo generador). El caso de un reingreso que llega en una corrida posterior contra una base ya poblada lo cubren `e2e/identity.setup.ts` y `identity-later.spec.ts`.
- **`FixtureAdapter`** lee ese layout (`employees/list/page-NNN.json`, `employees/get/<id>.json`, `employees/tables/<tabla>/all.json`, `performance/goals/<id>.json`) y también el plano escrito a mano de `src/modules/bamboo-client/__fixtures__` (casos borde de los tests). Para ingestar el generado con la CLI genérica: `pnpm ingest --all --source fixture --dir fixtures/bamboo/small`.
- Los CSV de `fixtures/bamboo-reports/<size>` no los siembra `db:seed`: se importan a mano en `/es/imports/upload` (ver [Importación histórica](#importación-histórica)).

## Base de datos

- Esquema de Drizzle: `src/db/schema/*.ts`. Migraciones generadas en `drizzle/` (`pnpm db:generate`, `pnpm db:migrate`).
- `supabase/migrations/` no existe hoy: la carpeta `supabase/` solo tiene `config.toml`. Se crearía únicamente si hiciera falta SQL específico de Supabase (RLS, extensiones, funciones); nunca para tablas, que son de Drizzle.
- Vistas SQL (p. ej. `v_current_rating`): drizzle-kit no las genera; se mantienen a mano. El `CREATE VIEW` se agrega al final de la migración generada, la copia de referencia vive en `src/db/sql/` y la declaración para consultarla en `src/db/views.ts` (fuera de `src/db/schema/`). Ver `drizzle/custom/README.md`; un test de DB verifica la vista y sus columnas.
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
- `pnpm ingest:employees [--entity employee|job_history|goal] [--since <iso>]` queda como alias de `pnpm ingest <entidad>` (con `--entity employee` y `--source fixture` por defecto). `pnpm ingest:goals` es el mismo alias con `--entity goal`.

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
2. **Perfil.** Se elige un perfil incluido o uno guardado, o se define uno nuevo sobre las columnas detectadas (nombre, entidad, columnas clave, watermark y campo canónico de cada columna que se quiera mapear). El cliente indica el perfil como `{ builtin: nombre }`, `{ saved: nombre }` (el servidor lee su definición) o `{ custom: perfil, replace? }`. Un perfil nuevo se guarda como `var/profiles/<nombre>.json` (ignorado por git) solo cuando la importación terminó bien; no puede llamarse como uno incluido (`profile_exists`) ni pisar uno guardado salvo que se pida (`replace`). Si falta una columna del perfil o su tipo no encaja (`validateAgainstSchema`), se marca en la vista previa y no se puede importar; el servidor lo vuelve a comprobar y no escribe nada.
3. **Importar.** `FileSourceAdapter(profile, lake, table)` lee el archivo con `readOptionsFor` y `applyProfile` y `runIngest` lo aterriza en `raw_record` en **modo `landing`**: solo se escriben `raw_record` e `ingest_run`, sin mapeo a dominio, salvo los perfiles `bamboo-employee-performance` y `bamboo-feedback-status`, que crean ciclos históricos (ver [Importación histórica](#importación-histórica); la casilla "Solo aterrizar" fuerza el modo `landing`). El `payload` de cada fila es `{ fields, extra, deleted, watermark, raw }`. El `source_system` es `bamboo_export` solo para los perfiles incluidos `bamboo-*` y `lake` para el resto (el adaptador lo recibe como opción, no lo deduce del nombre). Las filas que el perfil no puede mapear (por ejemplo las de `No Goals Set` de `bamboo-goal-status`, con `Goal` vacío) cuentan como rechazadas, no frenan la corrida; cada rechazo guarda el motivo en inglés (`reason`) y datos estructurados (`code`, `column`, `values`) con los que la pantalla lo redacta en su idioma. La corrida guarda `params = { entity, fileName, profile, size, sha256 }`.
4. **Resultado.** Al terminar se abre la corrida (`/imports/runs/<id>`: conteos, rechazos y parámetros); mientras carga, la pantalla muestra las filas leídas, nuevas, sin cambios y rechazadas. Las corridas de archivo no avanzan `sync_state` (un archivo no es una fuente incremental). Volver a subir el mismo archivo da 0 registros nuevos (el hash del payload de cada fila no cambia).

Lo pesado no corre dentro de un request: las Server Actions solo guardan el archivo y lanzan `scripts/ingest-upload.ts` en un proceso aparte (`node --import tsx`, vía `runUploadWorker` en `src/modules/lake/upload-worker.ts`), que lee el archivo con DuckDB y hace la ingesta. Si tarda más del tiempo máximo se le manda SIGTERM: el worker corta en la fila siguiente y deja la corrida en `error` (si hubo que matarlo, la acción marca como `error` las corridas de ese archivo que quedaron en `running`). También se puede correr a mano (`echo '{"uploadId":"<sha256>.csv"}' | pnpm exec tsx scripts/ingest-upload.ts inspect`). Las carpetas se pueden cambiar con `UPLOADS_DIR` y `PROFILES_DIR`. Los límites de cuerpo de Server Actions y del proxy están subidos a 52 MB en `next.config.ts`.

### Tests y fixtures

- `runLakeAdapterContractTests(name, openAdapter)` (`src/modules/lake/contract.ts`) es la suite de contrato: `openAdapter(scenario)` debe devolver el adaptador abierto sobre la carpeta de `src/modules/lake/__fixtures__/<scenario>/` (o su equivalente en el lake real). Escenarios: `initial`, `delta-1` (update, insert y soft-delete), `schema-drift` (columna nueva y cambio de tipo) y `messy` (NULL, claves duplicadas, empates y watermark NULL, BIGINT mayor a 2^53). Los fixtures son CSV sintéticos escritos a mano; además hay `airbyte/` y `bamboo-reports/` para los perfiles (este último usa los encabezados reales de `fixtures/bamboo-reports/`, y `profiles.test.ts` valida cada perfil de Bamboo contra los CSV de `fixtures/bamboo-reports/small/`).
- `duckdb-file-lake.test.ts` corre la suite sobre CSV y `parquet.test.ts` sobre la variante Parquet, generada al vuelo con DuckDB `COPY`. Para obtener los archivos Parquet: `pnpm fixtures:parquet [carpetaDeSalida]` (por defecto `build/lake-parquet/<escenario>/`, ignorado por git).
- No pongas exports reales en los fixtures (contienen datos personales).

## Calidad de datos, API JSON y exports CSV

### Panel de calidad de datos

`/es/data-quality` (enlace en el inicio) muestra un conteo por indicador y un enlace a la lista de casos (`/es/data-quality/<indicador>`; las identidades sin resolver enlazan a la cola `/es/imports/identity`). Cada indicador es una consulta con nombre en `src/modules/analytics/data-quality.ts` que devuelve `{ key, count, items[] }`; el conteo es `items.length`, así que el número del panel y su lista no pueden diferir. "Activo" y "hoy" siguen la definición del resto de la app (`activeEmploymentCte`, `current_date`).

| Indicador (`key`)                  | Qué cuenta                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity_open`                    | Casos abiertos de la cola de identidad.                                                                                                                                                                                                      |
| `no_manager`                       | Activos con puesto vigente sin manager (el tope de la organización, con reportes, va con la insignia "Tope").                                                                                                                                |
| `participants_no_manager`          | Participantes de ciclos (no removidos) sin manager en el snapshot, agrupados por ciclo.                                                                                                                                                      |
| `participants_incomplete_snapshot` | Participantes cuyo snapshot no tiene área o puesto.                                                                                                                                                                                          |
| `job_history_overlap_gap`          | Filas del historial de puesto que se superponen con una anterior (aunque sea de otro empleo) o dejan un hueco respecto de la fila anterior del mismo empleo (el hueco de un reingreso no; filas sin empleo asociado no se comparan).         |
| `job_history_open_after_exit`      | Personas que no están activas (se fueron, o no tienen ningún empleo vigente) pero tienen una fila de puesto abierta (`valid_to` nulo).                                                                                                       |
| `active_without_job_history`       | Activos sin ninguna fila de historial de puesto.                                                                                                                                                                                             |
| `goals_without_employment`         | Goals (no borrados) cuyo dueño no tiene ningún empleo vigente.                                                                                                                                                                               |
| `duplicate_names`                  | Activos que comparten nombre (sin importar tildes, mayúsculas ni orden de palabras).                                                                                                                                                         |
| `failed_runs`                      | Corridas de importación con error en los últimos 7 días.                                                                                                                                                                                     |
| `reviewer_mismatch`                | Pedidos de evaluación que el módulo de revisión marcó con `review_request.reviewer_mismatch` (enviados por quien ya no es el manager del snapshot), no borrados y con el participante no removido.                                           |
| `unmapped_answers`                 | Respuestas importadas de retención o compromiso cuya opción no tiene equivalencia Likert (`answer_quality_issue` sin resolver): ciclo, columna y valor original, sin nombres de personas. Se resuelven al reimportar con un valor que mapea. |

### API JSON de solo lectura (`/api/v1`)

Handlers en `src/modules/api/handlers.ts`, rutas en `src/app/api/v1/**`. Todos los objetos llevan `id` (uuid interno) y, cuando vienen de una fuente, `source: { system, id }` (`null` para filas creadas en la app; en las personas es su ID de Bamboo vigente). Fechas `YYYY-MM-DD`, instantes ISO 8601 UTC con microsegundos, claves en `snake_case`.

| Endpoint                                                                 | Respuesta                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/people?q=&active=true\|false`                               | Personas con legajo, estado, puesto y manager vigentes (`q` busca por nombre; `work_email` solo para People, ver [Datos sensibles](#datos-sensibles)).                             |
| `GET /api/v1/people/{id}`                                                | Persona con `source_identities`, `employments` y `job_history` (más nueva primero).                                                                                                |
| `GET /api/v1/people/{id}/goals?status=`                                  | Goals de una persona.                                                                                                                                                              |
| `GET /api/v1/org/as-of?date=YYYY-MM-DD`                                  | Quién tenía puesto vigente esa fecha y con qué manager (hoy si falta `date`).                                                                                                      |
| `GET /api/v1/goals?person_id=&manager_id=&status=`                       | Goals con dueño, hitos y a quién se compartieron.                                                                                                                                  |
| `GET /api/v1/cycles` · `GET /api/v1/cycles/{id}`                         | Ciclos; el detalle trae los participantes (removidos incluidos) con su snapshot de org.                                                                                            |
| `GET /api/v1/ingest-runs?source=&entity=&status=` · `.../{id}`           | Corridas, de la más nueva a la más vieja; el detalle trae `params`, `rejects` y raw records.                                                                                       |
| `GET /api/v1/identity-issues?status=open\|resolved\|ignored`             | Casos de la cola de identidad con candidatos y payload.                                                                                                                            |
| `GET /api/v1/cycles/{id}/requests?relationship=&status=&participant_id=` | Pedidos de evaluación del ciclo (self, manager, par, upward): evaluado y evaluador con ids, snapshot de org del participante, estado, fechas y `shared_at`.                        |
| `GET /api/v1/requests/{id}`                                              | Un pedido, con su ciclo (nombre, fase y modos de anonimato).                                                                                                                       |
| `GET /api/v1/requests/{id}/answers`                                      | Respuestas del pedido, en el orden de las preguntas: la pregunta (revisión, texto es/en, tipo, rol, `visible_to_reviewee`), `option_value`, `option_label`, `normalized` y `text`. |
| `GET /api/v1/cycles/{id}/question-revisions`                             | Preguntas congeladas al lanzar el ciclo, con escala, opciones, a quién aplican y rol.                                                                                              |

- **Paginación:** `?limit=` (1-200, por defecto 50) y `?cursor=`. Las listas responden `{ data, next_cursor }`; `next_cursor` es `null` en la última página. Es keyset (no offset) sobre una clave inmutable: `(created_at, id)` (también los pedidos de evaluación), `(started_at desc, id desc)` para corridas, `id` para el org y `(sort, id)` para las respuestas y las preguntas congeladas (en el orden de las preguntas). Una fila nueva nunca corre ni repite las páginas ya leídas. Un cursor ajeno es un 400.
- **Errores:** `application/problem+json` (RFC 9457). 400 para parámetros inválidos (con `errors: [{ path, message }]`), 404 para ids desconocidos o mal formados (también un `as_person` que no es una persona), 401 sin token válido y 403 cuando, con `as_person`, esa persona no puede leer el pedido. Un cursor ajeno es un 400 antes que cualquier 404 o 403.
- **Auth:** sin sesión en v1. Si la variable `API_TOKEN` está definida, hace falta `Authorization: Bearer <API_TOKEN>` (comparación en tiempo constante); si está vacía o sin definir la API queda abierta (desarrollo local). Los botones "Exportar CSV" son enlaces del navegador y no pueden mandar el header: con `API_TOKEN` definido no se muestran (bajá los CSV con `curl -H "Authorization: Bearer $API_TOKEN"`) hasta que exista la sesión.
- **Datos de revisión: con qué ojos se lee.** La API no tiene sesión ni actor: es una superficie de integración (lake, analytics), así que por defecto lee como People (`scope=hr`): todos los pedidos y respuestas, borradores incluidos, con el token si `API_TOKEN` está definido. Para depurar o comprobar paridad con lo que ve una persona, `?as_person=<id de persona>&role=employee|manager|hr` (por defecto `employee`) aplica el mismo `canRead` que las pantallas (`src/modules/review-core/visibility.ts`): las listas omiten lo que esa persona no puede leer (las páginas se llenan igual), un pedido ajeno es un 403 y en las respuestas faltan las preguntas que el evaluado no ve (`visible_to_reviewee`) y `answer_count` cuenta solo las que esa persona puede leer. `role` sin `as_person`, o `scope=hr` junto con `as_person`, es un 400; una persona desconocida, un 404. Rige también para los CSV de revisión. Es solo para depurar: resuelve `canRead` pedido por pedido. En `GET /api/v1/people` y `/people/{id}` el mismo `as_person`/`role` decide el email: solo `hr` recibe `work_email` (ver [Datos sensibles](#datos-sensibles)).
- **Anonimato del evaluador, siempre.** En los pedidos par/upward de un ciclo `fully_anonymous` la API nunca dice quién escribió: `reviewer` es `null` y `reviewer_visible` `false` con cualquier alcance (HR incluido, y hasta el propio autor), y en los CSV quedan vacías las columnas del evaluador. Con `anonymous_to_employee` se nombra al evaluador salvo al evaluado (`as_person` = el evaluado). Los pedidos self y manager llevan siempre evaluador (`reviewer` es `null` solo si no tienen: `reviewer_missing`). No hay filtro por evaluador, a propósito; `decline_reason` (texto libre) no se expone.
- Los pedidos de participantes removidos aparecen (con `participant.removed_at`); los borrados, no. Los pedidos manager con `status=superseded` son historial de un evaluador reemplazado (no cuentes más de un pedido manager vigente por participante). El rating vigente del participante (`v_current_rating`: override > calibrado > manager > computado) viaja en `participant.current_rating` de cada pedido (`stage`, `option_value`, `option_label`, `normalized`, `created_at`; `null` si no hay) y como columnas `rating_*` de `requests.csv`, pero solo se lee como HR: con `as_person` de otro rol es `null`, porque un rating sin publicar no es para el evaluado, su manager ni los pares.

### Exports CSV

`GET /api/v1/export/<entidad>.csv` (mismo token y mismos filtros que la API), con "Exportar CSV" en las listas de personas, organigrama, goals, corridas y ciclos. Archivos UTF-8 con BOM (Excel), líneas `CRLF`, comillas RFC 4180 y un apóstrofe delante del texto que una planilla evaluaría como fórmula (`=`, `+`, `-`, `@`). Se arman página por página (streaming): un error antes de la primera fila es un 500 como cualquier otro; si falla una página posterior, el error se registra y el archivo termina con una línea `# EXPORT INTERRUPTED: ...`. Los encabezados salen en el idioma de `?locale=es|en` (por defecto `es`; los botones mandan el idioma de la página). `people.csv` y `GET /api/v1/people` listan a las mismas personas que la pantalla de personas (las que tienen al menos un empleo vigente). **El email no sale por defecto**: `people.csv` solo trae la columna `email` con `?include_email=1` (también `true`; `0` o `false` equivalen a omitirlo), y `q` busca solo por nombre (ver [Datos sensibles](#datos-sensibles)).

| Archivo                  | Una fila por…                    | Filtros                              |
| ------------------------ | -------------------------------- | ------------------------------------ |
| `people.csv`             | persona                          | `q`, `active`, `include_email`       |
| `org.csv`                | fila de puesto vigente en `date` | `date`                               |
| `goals.csv`              | goal                             | `person_id`, `manager_id`, `status`  |
| `ingest-runs.csv`        | corrida                          | `source`, `entity`, `status`         |
| `cycle-participants.csv` | participante de ciclo            | `cycle_id`                           |
| `requests.csv`           | pedido de evaluación             | `cycle_id`, `relationship`, `status` |
| `answers.csv`            | evaluador × pregunta (respuesta) | `cycle_id`, `relationship`, `status` |

Cada fila trae los ids internos (uuid) y los de Bamboo (`bamboo_id`, `legajo`, y el del manager o del manager del snapshot), más área, división, puesto y ubicación.

`requests.csv` y `answers.csv` usan los mismos filtros, alcance (`scope`, `as_person`, `role`) y reglas de anonimato que los endpoints de revisión (ver arriba). En `answers.csv` cada fila es una respuesta: ciclo (id, id de origen, nombre), participante, evaluado (ids interno y de Bamboo, legajo, nombre), manager, área, división, puesto y ubicación del snapshot, `tipo` (self, manager, peer, upward), `estado` del pedido, evaluador (ids y nombre; vacíos y `evaluador visible` en `false` cuando el anonimato lo oculta), la pregunta (`question_revision_id`, rol, tipo, texto en `pregunta (es)` y `pregunta (en)`: los datos no cambian con `?locale=`, solo los encabezados), `valor`, `etiqueta`, `rating normalizado` y `texto`, y `enviado` / `compartido` (`shared_at` del pedido manager). En las preguntas de opción única `etiqueta` guarda el valor de la opción elegida, tal cual se almacena. Una pregunta sin responder no tiene fila, así que el total es el de respuestas de los pedidos no borrados; los pedidos en borrador traen sus respuestas (filtrá por `status=submitted` para el análisis). Se arma pedido por pedido en páginas de 200 pedidos con sus respuestas.

## Puertos (Supabase local)

Se usan puertos propios para no chocar con otros proyectos locales.

| Servicio         | Puerto            |
| ---------------- | ----------------- |
| API              | 55321             |
| Postgres         | 55322             |
| Studio           | 55323             |
| Inbucket         | 55324             |
| Shadow DB        | 55320             |
| Analytics        | 55327             |
| Pooler (apagado) | 55329             |
| Next.js (dev)    | 3000              |
| Next.js (e2e)    | 3100 (`E2E_PORT`) |

Conexión local: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.

## Idiomas

Rutas bajo `/[locale]` (`/es`, `/en`). Los textos viven en `src/messages/{es,en}.json`; ambos archivos deben tener las mismas claves (hay un test que lo verifica).
