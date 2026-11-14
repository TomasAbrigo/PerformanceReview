# Performance Review

[![CI](https://github.com/TomasAbrigo/PerformanceReview/actions/workflows/ci.yml/badge.svg)](https://github.com/TomasAbrigo/PerformanceReview/actions/workflows/ci.yml)

Herramienta interna de evaluaciones de desempeño que reemplaza el módulo de performance de BambooHR. Los datos se ingestan desde Bamboo conservando sus IDs de origen.

**Stack:** Next.js (App Router, TypeScript estricto, Tailwind v4, shadcn/ui) · next-intl (`es` por defecto, `en`) · Supabase local · Drizzle ORM (postgres-js) · Vitest · Playwright.

> Solo desarrollo local. No hay deploy configurado.

## Estado del proyecto

Alcance y decisiones: [`docs/prd.md`](docs/prd.md) (issue [#1](https://github.com/TomasAbrigo/PerformanceReview/issues/1)); la investigación de respaldo está en `docs/research/`. El trabajo se sigue en los [issues del repo](https://github.com/TomasAbrigo/PerformanceReview/issues).

**v1, hecho (solo local, con datos sintéticos):**

- Datos: ingesta desde Bamboo (empleados, historial de puesto y manager, goals) con identidad "golden" y cola de conflictos, organigrama a una fecha, importación por archivo con perfiles de fuente, adaptador de lake sobre archivos, log de corridas, seed y fixtures.
- Proceso de evaluación completo: escalas y templates, ciclos (asistente, snapshot, grupos, cadencia por fecha de ingreso, duplicar), autoevaluación, evaluación del manager con double-blind, pares, goals en el ciclo, comparación con acuse de recibo e historial, calibración, operación del ciclo e importación histórica de assessments desde CSV de Bamboo.
- Análisis: notificaciones internas, dashboards, panel de calidad de datos, API JSON de solo lectura y exports CSV.

**Pendiente o fuera de v1:**

- **Acceso real a Bamboo y decisiones de negocio** ([#23](https://github.com/TomasAbrigo/PerformanceReview/issues/23), tarea para una persona): conseguir una API key y grabar respuestas reales para compararlas con los fixtures, verificar el catálogo de datasets y los exports de Performance, y definir con People la clave confiable de empleado, las escalas históricas, la calibración actual, los años de histórico, el anonimato de pares y el sistema de registro tras Bamboo. Hasta entonces todo corre con fixtures (las columnas de los reportes de Bamboo siguen sin verificarse contra un export real).
- **Sin login:** modo administrador con el selector "Actuar como". Supabase Auth, roles reales y RLS son v2 (las variables `NEXT_PUBLIC_SUPABASE_*` están reservadas para eso).
- **Sin envío de emails:** las notificaciones son internas (bandeja `/inbox`); ver "Email (fuera de alcance)" en Notificaciones.
- **Conectores reales al lake** (BigQuery, Snowflake, Databricks, Redshift, Postgres) en v2: hoy solo existe `DuckDbFileLake` sobre archivos, con la suite de contrato lista para los reales.
- **API de datos de revisión** (pedidos, respuestas, export de respuestas): parte 2 de [#20](https://github.com/TomasAbrigo/PerformanceReview/issues/20), en curso en el PR [#51](https://github.com/TomasAbrigo/PerformanceReview/pull/51).
- **Otros v2 del PRD** (sección "Out of Scope"): upward agregado, autoevaluación con rating, goals nativos editables, 9-box, paquetes PDF, API pública y webhooks salientes.
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

Las escalas y los templates del sistema se crean solos cuando arranca el servidor. No hay login: empezás actuando como **People** (sin persona), que ve y puede todo; el selector **"Actuar como"** (arriba) cambia el rol y la persona. Después:

1. **Mirar los datos.** `/es/people` (ficha con identificadores de origen e historial de puesto), `/es/org` (organigrama con selector de fecha), `/es/imports/runs` (las corridas del seed), `/es/imports/identity` (los 8 reingresos esperando resolución) y `/es/data-quality`.
2. **Crear y lanzar un ciclo.** `/es/cycles/new`: para que sea manejable, elegí "Por filtro" con un área; dejá los componentes (autoevaluación, manager, pares y calibración), el template "Evaluación de fin de año", la escala final "4 puntos descriptiva" y las fechas, y pulsá "Crear y lanzar". El ciclo arranca en **Nominaciones** y el detalle lista a cada participante con su manager del snapshot.
3. **Nominar pares (actuar como un empleado).** Rol Empleado + una persona participante, y en `/es/me` entrá a "Nominar pares".
4. **Aprobar (actuar como su manager).** Rol Manager + el manager del snapshot de esa persona: aprobá las nominaciones en `/es/cycles/<id>/peers`. Como People, pasá el ciclo a **Recolección** con el botón "Pasar a …" del detalle.
5. **Recolección.** El empleado completa y envía su autoevaluación desde `/es/me`; cada par nominado (rol Par) responde en "Feedback para dar".
6. **Revisión del manager.** People pasa el ciclo a **Revisión del manager**; el manager abre `/es/team` y pulsa "Evaluar" (califica los goals, completa las preguntas y el rating general) y envía. "Comparar" muestra su evaluación contra la autoevaluación.
7. **Calibración.** People pasa a **Calibración** (`/es/cycles/<id>/calibration`): creá un grupo (por área), proponé un cambio de rating con su motivo, mirá el histograma antes/después y "Publicar calibración".
8. **Compartir y acusar recibo.** People pasa a **Compartir resultados**; el manager comparte la evaluación (o "Compartir todas"), y el empleado la lee en `/es/me` y acusa recibo.
9. **Dashboards.** Como People, `/es/dashboards`: avance del ciclo, distribución de ratings pre y post calibración, goals vs rating y brecha self vs manager; "Trayectoria" por persona, "Ver equipo" (jerarquía "al momento de la review" o "actual"), la vista de dirección y los botones "Exportar CSV". De yapa, `/api/v1/people` devuelve las mismas personas en JSON.

Opcional, para tener historia en los dashboards: subí `fixtures/bamboo-reports/demo/employee-performance.csv` en `/es/imports/upload` (ver "Importación histórica"); crea los ciclos 2023 a 2025 ya cerrados. Corre en un proceso aparte y con el tamaño demo puede tardar.

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

Qué hay en la app, dónde está en la UI y las reglas que conviene conocer. Las rutas van bajo `/es` (o `/en`); el inicio (`/es`) enlaza a las pantallas principales. Los detalles de ingesta, seed, lake, notificaciones y API están en las secciones siguientes.

### Personas, organigrama y goals

- **Dónde:** `/people` (búsqueda por nombre o email; la ficha muestra identificadores de origen, períodos de empleo, historial de puesto y manager, y los goals de la persona), `/org` (organigrama a una fecha elegida), `/team/goals` (goals de los reportes directos de un manager) y la cola de identidad `/imports/identity`.
- **Reglas:** los cruces usan el UUID interno y se conservan los IDs de Bamboo. Una persona dada de baja y reingresada es una sola persona con dos períodos de empleo y su reingreso siempre pasa por la cola de identidad. El manager y el área "de entonces" salen del historial de puesto con vigencias, no del dato actual.

### Escalas y templates (`/settings`)

- **Dónde:** `/settings/scales` (escalas de rating) y `/settings/templates` (lista y editor `/settings/templates/<id>`).
- **Escalas:** cada opción tiene un valor numérico, una etiqueta en español e inglés y un valor normalizado de 0 a 1, para comparar ratings aunque cambie la escala. Las del sistema (no se pueden borrar): "4 puntos descriptiva" (Necesita desarrollo, Cumple expectativas, Supera a menudo, Marca un nuevo estándar), "5 puntos" (de totalmente en desacuerdo a totalmente de acuerdo) y "Nunca…Siempre".
- **Templates:** secciones y preguntas (texto, calificación con escala u opción única) con texto en es/en. Cada pregunta define a quién aplica (autoevaluación, manager, par o upward), si la persona evaluada la ve, si es obligatoria y, opcionalmente, una función especial (`goals_rating`, `goals_comment`, `overall_rating`; ver "Goals en el ciclo"). Los templates del sistema se crean al arrancar el servidor: "Evaluación de fin de año", "Ciclo de desarrollo de mitad de año" (sin ratings), "Feedback de pares" y "Upward" (apagado en v1). No se editan ni se borran: se clonan.
- **Versionado:** al lanzar un ciclo, sus preguntas y escalas se congelan en revisiones inmutables; editar un template después no cambia el significado de lo ya respondido.

### Ciclos (`/cycles`)

- **Dónde:** la lista y el detalle (`/cycles`, `/cycles/<id>`) y el asistente `/cycles/new`, de 5 pasos: **Personas** (todas las activas, por filtro de área, división, ubicación, puesto o estado, o individuales; más la fecha de snapshot organizacional), **Componentes y anonimato** (autoevaluación, manager, pares, upward y calibración; modo de anonimato de pares y de upward; template y escala final), **Grupos** (opcional), **Fechas por fase** y **Revisar y lanzar** (también se puede guardar como borrador).
- **Estados:** borrador, nominaciones (solo con pares), recolección, revisión del manager, calibración (solo si está activada), compartir resultados y cerrado. Desde una fase activa se avanza o se retrocede una, y cada cambio queda registrado con quién, cuándo y una nota. Cerrado es terminal.
- **Snapshot organizacional:** al lanzar se congela, por participante, el manager, el área, la división, el puesto y la ubicación a la fecha de snapshot (a partir del historial de puesto), y se crean sus solicitudes pendientes. Los análisis usan ese manager y esa área, no los actuales; si la persona cambia de manager después, el sistema lo marca (ver "Operación del ciclo"). Tras el lanzamiento solo se editan el nombre y las fechas límite.
- **Extras** (detalle en [Ciclos: duplicar, plantillas por grupo y cadencia por fecha de ingreso](#ciclos-duplicar-plantillas-por-grupo-y-cadencia-por-fecha-de-ingreso)): **grupos de templates** (cada persona usa el template del primer grupo cuyo filtro la incluye), **cadencia por fecha de ingreso** (hitos de 30, 60, 90, 180 o 365 días con una ventana de 1 a 4 semanas; cada persona entra al ciclo con su propia fecha límite y el comando `pnpm cycles:enroll` hace la incorporación diaria) y **duplicar** un ciclo como borrador.

### Autoevaluación y bandeja de tareas (`/me`)

- **Selector "Actuar como":** como v1 no tiene login, la barra superior permite elegir un rol (People, Manager, Empleado, Par o Calibrador) y una persona; queda en la cookie `pr_actor`. Por defecto se actúa como "People (RR. HH.)", sin persona, que ve y puede todo. Toda lectura y escritura de evaluaciones recibe ese actor, de modo que Supabase Auth pueda enchufarse después sin tocar el modelo.
- **Bandeja de tareas `/me`** ("Mis tareas", de la persona elegida): autoevaluaciones pendientes con su fecha límite, nominaciones de pares, feedback para dar, evaluaciones ya compartidas y las últimas notificaciones sin leer.
- **Autoevaluación `/cycles/<id>/self`:** las preguntas del template para la relación `self` y el bloque de goals del período en solo lectura. El borrador se guarda al salir de cada campo; las preguntas obligatorias se validan al enviar. Solo se escribe en la fase de recolección. Una vez enviada no se edita: solo People la puede desbloquear, con un motivo.

### Evaluación del manager (`/team`)

- **Dónde:** `/team` ("Mi equipo") lista a los reportes directos en ciclos activos con el estado de su autoevaluación y de la evaluación del manager, si ya está compartida, y los botones "Evaluar" y "Recordar". El formulario es `/cycles/<id>/manager/<participante>`: goals en solo lectura con su calificación y comentario, las preguntas del template y la calificación general en la escala final.
- **Double-blind** (activo por defecto, se puede apagar por ciclo): el manager no ve la autoevaluación hasta haber enviado su evaluación, y el empleado no ve la del manager hasta que se comparte.
- **Compartir:** una evaluación enviada se comparte en la fase "Compartir resultados" (y, con calibración activada, recién después de publicarla). La comparten el manager o People, de a una o con "Compartir todas las evaluaciones enviadas"; se puede des-compartir, y una evaluación compartida no se edita sin des-compartirla antes. El empleado la lee en `/cycles/<id>/result` y solo ve las preguntas marcadas como visibles para la persona evaluada.
- **Visibilidad:** una única función, `canRead` (`src/modules/review-core/visibility.ts`), decide quién lee cada evaluación y cada respuesta.

### Pares y upward

- **Nominaciones** (`/cycles/<id>/peers`): en la fase de nominaciones cada empleado nomina hasta N pares (5 por defecto) y su manager aprueba o rechaza, de a una o en bloque; el ciclo también puede configurarse sin aprobación. El máximo de nominaciones, la aprobación y el umbral de carga se fijan en el asistente y se bloquean al lanzar. Cada nominación aprobada genera la solicitud de feedback; se avisa ("Mucha carga") cuando alguien acumula solicitudes abiertas por encima del umbral (5 por defecto).
- **Feedback:** en recolección el par responde las preguntas `peer` del template, con borrador, o declina la solicitud con un motivo. Antes de escribir ve cómo se mostrará su nombre. Lo recibido se ve en `/cycles/<id>/peers/feedback/<participante>` (el manager lo ve para su equipo).
- **Anonimato** (por ciclo, se fija al lanzar): _transparente_ (el nombre lo ven la persona evaluada, su manager y People), _anónimo para la persona evaluada_ (ve "Par"; el manager y People sí ven el nombre) o _totalmente anónimo_ (nadie ve el nombre, tampoco People). La persona evaluada lee el feedback solo cuando se comparte, y solo las preguntas marcadas como visibles para ella (la pregunta "solo para su manager" del template de sistema queda fuera).
- **Upward:** el componente existe (los reportes directos de un participante que también participen del ciclo reciben una solicitud de feedback sobre él, con su propio modo de anonimato), pero el template de sistema "Upward" viene apagado y la vista agregada con mínimo de respuestas es v2.

### Goals en el ciclo

- **Snapshot:** al lanzar el ciclo (o al agregar a un participante) se copian los goals de cada persona a `participant_goal_snapshot`, con título, estado, progreso y fecha límite a ese momento; los que se crean después no aparecen. Un goal pertenece al ciclo por solapamiento con el período o por un vínculo explícito ("Vincular objetivo"); "Actualizar progreso" refresca las cifras de los goals listados y marca como "Ya no aplica" a los que se borraron.
- **Dónde:** el bloque de solo lectura se muestra en la autoevaluación y en la evaluación del manager.
- **Rating de goals:** una sola calificación para todos los goals, con su comentario, son preguntas del template del manager con función especial (`goals_rating`, `goals_comment`). La calificación general es la pregunta `overall_rating`. El rating de goals nunca alimenta el rating final ni la calibración.

### Comparación, notas, acuse e historial

- **Comparación** `/cycles/<id>/compare/<participante>`: autoevaluación y evaluación del manager lado a lado, pregunta por pregunta, con la diferencia resaltada en las de rating. Está disponible cuando ambas están enviadas; "Vista del empleado" oculta lo que el empleado no va a ver (útil al compartir pantalla).
- **Notas de seguimiento:** el manager (o People) registra acuerdos después de la conversación; el empleado las ve cuando la evaluación está compartida.
- **Acuse de recibo:** el empleado acusa recibo, con una nota opcional, hasta 7 días después de que se compartió (o hasta la fecha límite de "Acuse de recibo" del ciclo, si es posterior). Pasado el plazo ya no puede; el manager ve en qué estado está.
- **Historial** `/people/<id>/reviews`: los ciclos con evaluaciones finalizadas o compartidas de una persona, con el manager, el puesto y el área de ese momento, el rating vigente y el estado de compartida y acuse. Lo ven People, la propia persona (solo los ciclos cuya evaluación se le compartió, y sin el rating original), su manager actual (todos los ciclos, aun los que no gestionó) y quien fue su manager en cada ciclo.

### Calibración (`/cycles/<id>/calibration`)

- **Grupos:** People crea grupos de calibración (por área, por manager o manual) e invita calibradores, de solo lectura o con permiso de proponer cambios.
- **Tabla por grupo:** empleado, manager del snapshot, rating del manager, rating vigente, un cambio propuesto con **motivo obligatorio** y la marca "Discutir". El valor propuesto tiene que ser una opción de la escala final del ciclo.
- **Distribución:** histograma de ratings antes (manager) y después (vigente) por área o por manager, con vista de tabla; sin curva forzada.
- **`final_rating` append-only:** cada rating queda en un registro que nunca se edita (quién, cuándo, valor y motivo) con una etapa (`computed`, `manager`, `calibrated`, `override`). La vista `v_current_rating` toma la de mayor precedencia y, dentro de ella, la más reciente.
- **Publicar:** "Publicar calibración" deja la calibración como definitiva, la audita y avisa a los managers. Los cambios posteriores se guardan como `override`, también auditados. El empleado ve solo el rating final, y solo cuando su evaluación está compartida y la calibración publicada: nunca el rating original, la etapa ni los motivos.

### Operación del ciclo (`/cycles/<id>/participants`, `/cycles/<id>/audit`)

- **Dónde:** solo People. `/cycles/<id>/participants` ("Participantes y evaluadores") y `/cycles/<id>/audit` (registro de auditoría); la fecha límite se extiende desde el detalle del ciclo.
- **Qué se puede hacer:** agregar un participante (se toma su snapshot hoy y se crean sus evaluaciones pendientes), quitarlo (sus evaluaciones y respuestas se conservan como historial pero ya no se escriben), extender la fecha límite de una fase, desbloquear una evaluación enviada y completar una evaluación en nombre de otro (queda marcada).
- **Evaluadores alternos:** se puede asignar otro evaluador a una persona, que _reemplaza_ a la evaluación del manager (p. ej. manager con licencia, o el CEO sin manager) o es _adicional_. Cuando una persona cambia de manager durante el ciclo, la tabla lo marca ("Ahora reporta a X (snapshot: Y)") y sugiere reasignar o sumar un evaluador; el pedido que no coincide con el manager del snapshot queda marcado como `reviewer_mismatch` y se cuenta en `/data-quality`.
- **Auditoría:** cada acción administrativa escribe una fila en `admin_audit_log` con quién, cuándo, el estado anterior y el nuevo y una nota opcional.

### Notificaciones (`/inbox`)

- **Dónde:** la campana del header (con el contador de no leídas), la bandeja `/inbox` y las últimas no leídas en `/me`. Son internas: **no se envían emails** en v1.
- **Qué avisa:** cambio de fase del ciclo, evaluación compartida, feedback recibido, calibración publicada, recordatorios de fecha límite y recordatorios manuales ("Recordar") de un manager o de People.
- **Recordatorios automáticos:** `pnpm notifications:run`, una vez por día (cron); ver [Notificaciones](#notificaciones) más abajo.

### Dashboards (`/dashboards`)

- **Dónde:** `/dashboards` (filtros por ciclo, área, manager, ubicación y puesto), `/dashboards/team` (el equipo de un manager), `/dashboards/people/<id>` (trayectoria de una persona) y `/dashboards/executive` (vista de dirección).
- **Qué muestra:** avance del ciclo por tipo de evaluación; distribución de ratings normalizados (0 a 100 %) antes y después de calibrar, agrupada por área, manager, ubicación o puesto; goals del período contra el rating final; brecha entre autoevaluación y manager por pregunta y por persona; y la trayectoria de una persona con el rating, el manager y el puesto de cada ciclo.
- **Jerarquía:** el equipo de un manager se elige explícitamente "al momento de la review" (el snapshot del ciclo) o "actual".
- **Quién ve qué:** People ve todo; un manager, su equipo; el resto es redirigido a su propia trayectoria, con solo lo publicado. La vista de dirección es solo de People: agregados sin nombres ni ids, y las áreas con menos de 3 personas no se desglosan.
- **CSV:** los botones "Exportar CSV" bajan avance, distribución, goals vs rating y brecha self vs manager (`dashboard-*.csv`, ver "Exports CSV").

### Calidad de datos y API (`/data-quality`, `/api/v1`)

- **Panel `/data-quality`:** un conteo por indicador (identidades sin resolver, personas o participantes sin manager, snapshots incompletos, historial de puesto con huecos o abierto tras la baja, `reviewer_mismatch`, corridas fallidas, etc.) con enlace a la lista de casos.
- **API JSON `/api/v1` y exports CSV:** de solo lectura, con los IDs internos y de Bamboo en cada objeto, paginación estable por cursor y errores `application/problem+json`. Si `API_TOKEN` está definido, hace falta `Authorization: Bearer <API_TOKEN>`; vacío, queda abierta (desarrollo local).
- Los indicadores, los endpoints y los CSV están en [Calidad de datos, API JSON y exports CSV](#calidad-de-datos-api-json-y-exports-csv).

### Importación histórica

- **Dónde:** `/imports/upload` (elegir un archivo, previsualizar, elegir el perfil e importar; ver "Subir un archivo") y `/imports/history/<corrida>` (los ciclos que creó una corrida).
- **Perfiles de Bamboo:** subir el reporte _Employee Performance_ (perfil `bamboo-employee-performance`) crea un ciclo histórico **cerrado** por cada nombre de ciclo del archivo, con su período (de las fechas de assessment), los participantes, sus solicitudes y las respuestas. _Feedback Status_ (`bamboo-feedback-status`) suma el feedback de pares. Los otros perfiles (`bamboo-goal-status`, `bamboo-assessment-progress` y los de Fivetran o Airbyte) solo aterrizan en `raw_record`, igual que cuando se tilda "Solo aterrizar".
- **Reglas:** los reportes identifican a las personas solo por nombre; quien no se puede cruzar con nadie va a la cola de identidad. El snapshot de cada participante se calcula a la fecha de fin del período, y la solicitud del manager cuyo evaluador del archivo (el manager al exportar) no es el vigente en esa fecha queda marcada como `reviewer_mismatch`. Volver a subir el mismo archivo no crea nada nuevo. Las columnas de los reportes siguen sin verificarse contra un export real de Bamboo (ver [Estado del proyecto](#estado-del-proyecto)).

## Tests y calidad

```bash
pnpm test:unit   # Vitest (jsdom) — *.test.ts(x)
pnpm test:db     # Vitest (node) contra DATABASE_URL — *.db.test.ts (requiere supabase start)
pnpm test:e2e    # Playwright (levanta next dev en E2E_PORT, 3100 por defecto)
pnpm test        # unit + db
pnpm check       # typecheck + lint + format:check + test:unit (como el job `checks` de CI)
pnpm typecheck
pnpm lint
pnpm format      # Prettier
```

Playwright baja su propio navegador, que se instala aparte: en local `pnpm exec playwright install chromium` (la primera vez); en CI, además de las librerías del sistema, `pnpm exec playwright install --with-deps chromium`.

`pnpm test:e2e` no toca tu base de desarrollo: corre contra una base propia, `E2E_DATABASE_URL` o, por defecto, `<DATABASE_URL>_e2e`, es decir `DATABASE_URL` con `_e2e` al final del nombre de la base (con la URL local de abajo, `postgres_e2e`). El global setup la crea si no existe (solo en un host local), le aplica las migraciones y la siembra con `pnpm db:seed --size small --reset`. El servidor de Next del e2e escucha en `E2E_PORT` (por defecto **3100**, para no chocar con `pnpm dev` en :3000) y usa esa misma base. Las dos variables son opcionales (ver "Variables de entorno").

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

## Ciclos: duplicar, plantillas por grupo y cadencia por fecha de ingreso

- **Duplicar:** el botón "Duplicar ciclo" del detalle (en cualquier estado) crea un borrador "<nombre> (Copia)" con componentes, anonimato, plantilla, escala final, filtro de participantes, programación, fechas límite (tal cual: hay que editarlas) y grupos. No copia participantes ni preguntas congeladas, y la copia no comparte nada con el original. Una plantilla que ya no está disponible (borrada o apagada) no se copia: la copia queda sin plantilla (o sin ese grupo) y el botón lo avisa antes de abrirla.
- **Plantillas por grupo:** el paso opcional "Grupos" del asistente define grupos (nombre, filtro y plantilla). Cada persona usa la plantilla del **primer** grupo (por orden) cuyo filtro la incluya, evaluado a la fecha de snapshot; quien no entra en ninguno usa la plantilla del ciclo. Al lanzar, las preguntas de cada grupo se congelan con su `group_id` y cada participante guarda su `template_group_id`; los formularios (autoevaluación, manager y pares) leen las preguntas con `questionsFor(db, cycleId, participant.templateGroupId, relationship)`, el único lector de revisiones.
- **Cadencia por fecha de ingreso:** en el paso "Fechas" se elige "Por fecha de ingreso", un hito (30, 60, 90, 180 o 365 días) y una ventana (1 a 4 semanas). Al lanzar el ciclo no tiene participantes: cada persona entra cuando `fecha de ingreso + hito` cae dentro de la ventana (`[hoy - ventana, hoy]`), con su snapshot a esa fecha y su propia fecha límite (`ingreso + hito + ventana`, para autoevaluación y manager, en `cycle_participant.due_dates`). Quien fue quitado del ciclo no vuelve a entrar.

La incorporación la hace un comando idempotente que conviene correr **una vez por día** (la ventana más corta es de una semana: si el cron falla varios días seguidos puede perderse a alguien; se puede recuperar con `--as-of`):

```bash
pnpm cycles:enroll                                 # todos los ciclos activos por fecha de ingreso, a hoy (zona horaria de la empresa)
pnpm cycles:enroll --cycle <id> --as-of 2026-03-10 # un ciclo, a una fecha dada
```

```cron
0 6 * * * cd /srv/performance-review && pnpm cycles:enroll >> /var/log/pr-enroll.log 2>&1
```

Solo se incorpora a quien sigue empleado a esa fecha (sin baja anterior), aunque su historial de puestos aún no se haya cerrado. Quien cumple el hito pero todavía no tiene historial de puestos (la ingesta no lo trajo) no se puede incorporar: el comando lo lista como `skipped ... no_job_history` y cada corrida lo reintenta mientras dure su ventana. Para recuperar a quien ya se pasó de la ventana (por ejemplo después de una caída del cron), `--lookback-days N` (0 a 365) amplía el rango N días hacia atrás; la fecha límite sigue siendo hito + ventana.

Código de salida `0` si todo salió bien, `1` si algún ciclo falló y `2` si los argumentos son inválidos.

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
| `notifyReviewShared` / `notifyFeedbackReceived` / `notifyCalibrationPublished` | Eventos que llaman compartir, el envío de feedback y la publicación de la calibración. Idempotentes. El de feedback nunca incluye al autor (puede ser anónimo).                                                                                                                  |
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

| Indicador (`key`)                  | Qué cuenta                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `identity_open`                    | Casos abiertos de la cola de identidad.                                                                                                                                                                                              |
| `no_manager`                       | Activos con puesto vigente sin manager (el tope de la organización, con reportes, va con la insignia "Tope").                                                                                                                        |
| `participants_no_manager`          | Participantes de ciclos (no removidos) sin manager en el snapshot, agrupados por ciclo.                                                                                                                                              |
| `participants_incomplete_snapshot` | Participantes cuyo snapshot no tiene área o puesto.                                                                                                                                                                                  |
| `job_history_overlap_gap`          | Filas del historial de puesto que se superponen con una anterior (aunque sea de otro empleo) o dejan un hueco respecto de la fila anterior del mismo empleo (el hueco de un reingreso no; filas sin empleo asociado no se comparan). |
| `job_history_open_after_exit`      | Personas que no están activas (se fueron, o no tienen ningún empleo vigente) pero tienen una fila de puesto abierta (`valid_to` nulo).                                                                                               |
| `active_without_job_history`       | Activos sin ninguna fila de historial de puesto.                                                                                                                                                                                     |
| `goals_without_employment`         | Goals (no borrados) cuyo dueño no tiene ningún empleo vigente.                                                                                                                                                                       |
| `duplicate_names`                  | Activos que comparten nombre (sin importar tildes, mayúsculas ni orden de palabras).                                                                                                                                                 |
| `failed_runs`                      | Corridas de importación con error en los últimos 7 días.                                                                                                                                                                             |
| `reviewer_mismatch`                | Pedidos de evaluación que el módulo de revisión marcó con `review_request.reviewer_mismatch` (enviados por quien ya no es el manager del snapshot), no borrados y con el participante no removido.                                   |

### API JSON de solo lectura (`/api/v1`)

Handlers en `src/modules/api/handlers.ts`, rutas en `src/app/api/v1/**`. Todos los objetos llevan `id` (uuid interno) y, cuando vienen de una fuente, `source: { system, id }` (`null` para filas creadas en la app; en las personas es su ID de Bamboo vigente). Fechas `YYYY-MM-DD`, instantes ISO 8601 UTC con microsegundos, claves en `snake_case`.

| Endpoint                                                       | Respuesta                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/v1/people?q=&active=true\|false`                     | Personas con legajo, estado, puesto y manager vigentes.                                      |
| `GET /api/v1/people/{id}`                                      | Persona con `source_identities`, `employments` y `job_history` (más nueva primero).          |
| `GET /api/v1/people/{id}/goals?status=`                        | Goals de una persona.                                                                        |
| `GET /api/v1/org/as-of?date=YYYY-MM-DD`                        | Quién tenía puesto vigente esa fecha y con qué manager (hoy si falta `date`).                |
| `GET /api/v1/goals?person_id=&manager_id=&status=`             | Goals con dueño, hitos y a quién se compartieron.                                            |
| `GET /api/v1/cycles` · `GET /api/v1/cycles/{id}`               | Ciclos; el detalle trae los participantes (removidos incluidos) con su snapshot de org.      |
| `GET /api/v1/ingest-runs?source=&entity=&status=` · `.../{id}` | Corridas, de la más nueva a la más vieja; el detalle trae `params`, `rejects` y raw records. |
| `GET /api/v1/identity-issues?status=open\|resolved\|ignored`   | Casos de la cola de identidad con candidatos y payload.                                      |

- **Paginación:** `?limit=` (1-200, por defecto 50) y `?cursor=`. Las listas responden `{ data, next_cursor }`; `next_cursor` es `null` en la última página. Es keyset (no offset) sobre una clave inmutable: `(created_at, id)`, `(started_at desc, id desc)` para corridas e `id` para el org. Una fila nueva nunca corre ni repite las páginas ya leídas. Un cursor ajeno es un 400.
- **Errores:** `application/problem+json` (RFC 9457). 400 para parámetros inválidos (con `errors: [{ path, message }]`), 404 para ids desconocidos o mal formados, 401 sin token válido.
- **Auth:** sin sesión en v1. Si la variable `API_TOKEN` está definida, hace falta `Authorization: Bearer <API_TOKEN>` (comparación en tiempo constante); si está vacía o sin definir la API queda abierta (desarrollo local). Los botones "Exportar CSV" son enlaces del navegador y no pueden mandar el header: con `API_TOKEN` definido no se muestran (bajá los CSV con `curl -H "Authorization: Bearer $API_TOKEN"`) hasta que exista la sesión.
- Todavía no expone datos de revisión (pedidos, respuestas, ratings): van a pasar por `canRead` del actor y quedan para cuando estén cerradas las reglas de visibilidad de la revisión del manager (#12).

### Exports CSV

`GET /api/v1/export/<entidad>.csv` (mismo token y mismos filtros que la API), con "Exportar CSV" en las listas de personas, organigrama, goals, corridas y ciclos. Archivos UTF-8 con BOM (Excel), líneas `CRLF`, comillas RFC 4180 y un apóstrofe delante del texto que una planilla evaluaría como fórmula (`=`, `+`, `-`, `@`). Se arman página por página (streaming): un error antes de la primera fila es un 500 como cualquier otro; si falla una página posterior, el error se registra y el archivo termina con una línea `# EXPORT INTERRUPTED: ...`. Los encabezados salen en el idioma de `?locale=es|en` (por defecto `es`; los botones mandan el idioma de la página). `people.csv` y `GET /api/v1/people` listan a las mismas personas que la pantalla de personas (las que tienen al menos un empleo vigente).

| Archivo                  | Una fila por…                    | Filtros                             |
| ------------------------ | -------------------------------- | ----------------------------------- |
| `people.csv`             | persona                          | `q`, `active`                       |
| `org.csv`                | fila de puesto vigente en `date` | `date`                              |
| `goals.csv`              | goal                             | `person_id`, `manager_id`, `status` |
| `ingest-runs.csv`        | corrida                          | `source`, `entity`, `status`        |
| `cycle-participants.csv` | participante de ciclo            | `cycle_id`                          |

Cada fila trae los ids internos (uuid) y los de Bamboo (`bamboo_id`, `legajo`, y el del manager o del manager del snapshot), más área, división, puesto y ubicación. Falta el export de respuestas (una fila por evaluador × pregunta), que también depende de las reglas de visibilidad (#12).

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
