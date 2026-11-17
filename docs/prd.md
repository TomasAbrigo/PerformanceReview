# PRD: Módulo de Performance Review (reemplazo de BambooHR Performance Management)

Investigación de respaldo: `docs/research/01..07`. Fecha: 2026-11-13.

## Problem Statement

La empresa (300-1000 personas) paga BambooHR pero su módulo de Performance Management casi no se usa: el proceso de evaluación está poco definido, las preguntas por defecto de Bamboo (retención, engagement, "qué hace bien / cómo mejorar") no se adaptan, no existe un rating general, los reportes son cinco vistas fijas sin IDs, y los datos salen incompletos e inconsistentes. Al intentar analizarlos, los cruces fallan: las evaluaciones quedan asociadas al manager y al área actuales en lugar de los del momento de la review, los exports mezclan nombres con IDs, y no existe API pública para leer assessments (solo goals). People no puede responder preguntas básicas como "¿cómo evolucionó esta persona en los últimos tres ciclos?" o "¿cómo se distribuyen los ratings por área y por manager?".

La dirección decidió reemplazar BambooHR por una herramienta propia, empezando por este módulo. El pedido de la reunión: poder acceder a los datos, exponer los datos que hoy están en Bamboo, relacionar correctamente los IDs de performance review con empleados, ciclos y evaluadores, y traer datos desde el data lake de la empresa.

## Solution

Una aplicación web propia (Next.js + Postgres en Supabase, solo local por ahora) que:

1. **Es dueña de los datos.** Importa de BambooHR lo que sí tiene API (empleados, historial de puesto y manager, goals) y acepta por archivo lo que no (exports de assessments y feedback, export oficial de Performance), conservando siempre los IDs de origen. Toda fuente entra por una misma interfaz de adaptadores, de modo que el data lake (tecnología aún no definida) se enchufa después sin rehacer nada.
2. **Cruza bien.** Mantiene una identidad "golden" por persona (match por id interno de Bamboo, legajo y email), un historial de puesto, manager y área con vigencias, y congela un snapshot organizacional por participante y ciclo. Cada review se analiza con el manager y el área que la persona tenía en ese momento; las inconsistencias se detectan y se muestran en lugar de ocultarse.
3. **Corre ciclos de evaluación completos**, mejores que los de Bamboo: templates configurables (preguntas de rating, texto, opción), autoevaluación reflexiva, evaluación del manager con rating general en escala descriptiva de 4 puntos, feedback de pares con nominación y aprobación, double-blind, goals del período como bloque de solo lectura con un rating propio, calibración con auditoría, publicación controlada y acuse de recibo.
4. **Expone todo para análisis**: dashboards (avance del ciclo, distribución de ratings, histórico por persona, equipo por manager "as of review" o actual, goals vs rating, panel de calidad de datos), exports CSV con IDs en cada fila y una API JSON interna para que el lake u otras herramientas consuman.
5. **Arranca con datos sintéticos** (empresa de ~400 personas, 5 niveles, 3 ciclos históricos, bajas, reingresos y cambios de manager) porque hoy no hay acceso a Bamboo; la forma de los datos replica exactamente la API de Bamboo para que el pasaje a datos reales sea solo configuración.

UI en español e inglés desde el inicio. Primera versión sin login: modo administrador con selector "actuar como" para recorrer los flujos de empleado, manager, par, calibrador y People.

## User Stories

### Datos y sincronización

1. Como People, quiero importar el padrón completo de empleados desde BambooHR (id interno, legajo, email, nombre, puesto, área, división, ubicación, manager, fecha de ingreso, estado), para tener la base organizacional sin cargarla a mano.
2. Como People, quiero que el sistema traiga el historial de puesto y manager de cada persona (tabla jobInfo y employmentStatus) con fechas de vigencia, para saber quién era el manager en cualquier fecha.
3. Como People, quiero que las sincronizaciones posteriores sean incrementales (feed de cambios de Bamboo con watermark), para no recargar todo cada vez.
4. Como People, quiero importar los goals de cada empleado desde Bamboo (título, descripción, progreso, estado, fecha límite, milestones, comentarios, alineación), para usarlos en las reviews.
5. Como People, quiero subir un archivo CSV/XLSX/Parquet con assessments o feedback exportados de Bamboo (reportes estándar o export oficial), para incorporar el histórico aunque no exista API.
6. Como People, quiero mapear las columnas de un archivo a las entidades del sistema con un perfil de fuente reutilizable, para repetir importaciones del mismo formato sin reconfigurar.
7. Como People, quiero que toda importación conserve el registro crudo (JSON) y el ID de origen de cada fila, para auditar y reprocesar sin volver a pedir los datos.
8. Como People, quiero que una importación repetida con los mismos datos no genere duplicados ni cambios, para poder reejecutar con confianza.
9. Como People, quiero ver un log de cada corrida de importación (fuente, inicio, fin, leídos, insertados, actualizados, sin cambios, rechazados, errores), para saber qué pasó.
10. Como People, quiero que las filas que no se pueden relacionar con una persona vayan a una cola de conflictos en vez de descartarse, para resolverlas a mano.
11. Como People, quiero resolver un conflicto de identidad eligiendo la persona correcta o creando una nueva, para que los datos queden bien relacionados.
12. Como People, quiero que una persona dada de baja y reingresada sea una sola persona con dos períodos de empleo, para no perder su historial.
13. Como ingeniero de datos, quiero una interfaz única de adaptador de fuente (listar tablas, describir esquema, leer por lotes con watermark), para conectar el data lake real cuando se defina su tecnología.
14. Como ingeniero de datos, quiero una implementación del adaptador sobre archivos locales (DuckDB) que se comporte igual que un lake real, para desarrollar y testear sin acceso a producción.
15. Como ingeniero de datos, quiero una API JSON interna de solo lectura con las entidades del dominio y sus IDs de origen, para alimentar el lake u otras herramientas.
16. Como People, quiero exportar cualquier tabla o reporte a CSV con id de persona, legajo, id de manager, área y ciclo en cada fila, para analizarlo fuera del sistema.

### Personas y organización

17. Como People, quiero ver la ficha de una persona con sus identificadores de origen, períodos de empleo e historial de puesto/manager, para verificar que el cruce es correcto.
18. Como People, quiero ver el organigrama a una fecha dada (manager de cada persona en esa fecha), para reconstruir el contexto de un ciclo pasado.
19. Como People, quiero un panel de calidad de datos (personas sin manager, reviews cuyo evaluador no coincide con el manager del snapshot, identidades sin resolver, snapshots incompletos), para corregir problemas antes de analizar.
20. Como People, quiero asignar un evaluador alternativo o adicional a una persona en un ciclo (manager con licencia, línea punteada, CEO sin manager), para que nadie quede sin evaluar.

### Templates y configuración

21. Como People, quiero crear templates de evaluación con secciones y preguntas de tipo texto, rating con escala y opción única, para adaptar el proceso a la empresa.
22. Como People, quiero definir para cada pregunta a quién aplica (self, manager, par, upward) y si el evaluado la ve, para controlar la visibilidad por pregunta.
23. Como People, quiero una biblioteca de escalas de rating (default 4 puntos descriptiva: Necesita desarrollo / Cumple expectativas / Supera a menudo / Marca un nuevo estándar; además 5 puntos y Nunca…Siempre) con valores numéricos y normalizados, para comparar entre ciclos aunque cambie la escala.
24. Como People, quiero partir de templates del sistema (evaluación de fin de año, ciclo de desarrollo de mitad de año, feedback de pares, upward) y clonarlos, para no empezar de cero.
25. Como People, quiero que las preguntas y escalas usadas en un ciclo queden versionadas e inmutables una vez lanzado, para que las respuestas históricas no cambien de significado si edito el template.
26. Como People, quiero traducir cada pregunta y etiqueta de escala al español y al inglés, para que cada persona la vea en su idioma.
27. Como People, quiero templates distintos por grupo de participantes dentro de un mismo ciclo, para no tener que crear un ciclo por área como en Bamboo.

### Ciclos

28. Como People, quiero crear un ciclo con nombre, período evaluado, template, participantes (todos, por filtro de área/división/ubicación/puesto/estado/equipo, o individuales) y fechas límite por fase, para lanzar una evaluación.
29. Como People, quiero elegir qué componentes incluye el ciclo (autoevaluación, evaluación del manager, feedback de pares, upward, calibración) y los modos de anonimato, para configurar desde un ciclo simple hasta un 360.
30. Como People, quiero que al lanzar el ciclo se congele un snapshot de manager, área, división, puesto y ubicación de cada participante, para que los análisis no cambien cuando alguien se mueve de equipo.
31. Como People, quiero que al lanzar el ciclo se tome un snapshot de los goals del período de cada participante (estado y progreso a esa fecha), para evaluarlos como estaban y no como quedaron después.
32. Como People, quiero ver y recorrer el estado del ciclo (borrador, nominaciones, recolección, evaluación del manager, calibración, publicación, cerrado) y avanzar o retroceder fases con registro de quién lo hizo, para operar el proceso.
33. Como People, quiero duplicar un ciclo (preguntas, escalas, configuración) como borrador, para repetir el proceso el próximo semestre.
34. Como People, quiero agregar o quitar participantes de un ciclo activo, para contemplar ingresos y egresos; al agregar se toma su snapshot en ese momento.
35. Como People, quiero extender fechas límite de una fase, para dar más tiempo sin recrear el ciclo.
36. Como People, quiero que al cambiar de manager una persona durante el ciclo, el sistema marque la diferencia entre manager del snapshot y evaluador real, para decidir quién completa la evaluación.
37. Como People, quiero que el ciclo soporte una cadencia por fecha de ingreso (30/60/90 días, 6 meses, 1 año) además de fechas fijas, para evaluaciones de período de prueba.

### Autoevaluación (empleado)

38. Como empleado, quiero ver mis tareas pendientes del ciclo (autoevaluación, nominar pares, feedback a dar, acuse de recibo) con sus fechas límite, para saber qué me falta.
39. Como empleado, quiero completar mi autoevaluación reflexiva (progreso en goals e impacto, bloqueos, cómo me desarrollé, habilidades a desarrollar) guardando borradores, para enviarla cuando esté lista.
40. Como empleado, quiero ver mis goals del período como bloque de solo lectura dentro de la autoevaluación, para apoyar mis respuestas en datos.
41. Como empleado, quiero nominar hasta N pares (configurable, default 5) para que me den feedback, y ver cuáles aprobó mi manager, para elegir a quienes me conocen.
42. Como empleado, quiero que una vez enviada mi autoevaluación no pueda editarla salvo que People la desbloquee, para que el proceso sea confiable.
43. Como empleado, quiero ver la evaluación de mi manager solo cuando la comparta y únicamente las preguntas marcadas como visibles, para que la publicación sea controlada.
44. Como empleado, quiero acusar recibo de mi evaluación con una nota opcional dentro de los 7 días, para dejar constancia de que la leí.
45. Como empleado, quiero ver mi historial de evaluaciones finalizadas (ciclo, manager en ese momento, rating final, respuestas compartidas), para seguir mi evolución.

### Evaluación del manager

46. Como manager, quiero ver el estado de mi equipo en el ciclo (quién completó qué, quién está atrasado) y enviar recordatorios, para cumplir los plazos.
47. Como manager, quiero aprobar o rechazar las nominaciones de pares de cada reporte directo, individualmente o en bloque, para asegurar feedback relevante.
48. Como manager, quiero completar la evaluación de cada reporte (rating de goals con comentario, logros, oportunidades de mejora con próximos pasos, foco del próximo período, rating general), para evaluar con estructura.
49. Como manager, quiero que con double-blind activo no vea la autoevaluación hasta haber enviado la mía, y viceversa, para evitar anclaje.
50. Como manager, quiero ver la autoevaluación y el feedback de pares recibido al escribir mi evaluación cuando double-blind está apagado o ya envié, para tener contexto.
51. Como manager, quiero ver la comparación lado a lado de autoevaluación y mi evaluación por pregunta, con la diferencia resaltada en preguntas de rating, para preparar la conversación.
52. Como manager, quiero compartir la evaluación con el empleado cuando esté lista (y People en bloque), para controlar el momento de la conversación.
53. Como manager, quiero cargar notas de seguimiento posteriores a la conversación, para registrar acuerdos.
54. Como manager, quiero ver el historial de ciclos de cada reporte directo, incluyendo los ciclos en que no era su manager, para conocer su trayectoria.

### Feedback de pares y upward

55. Como par, quiero recibir solicitudes de feedback con las preguntas del ciclo y poder guardar borrador, para responder con tiempo.
56. Como par, quiero saber si mi feedback será visible con nombre para el evaluado, para el manager, o anónimo, antes de escribirlo.
57. Como par, quiero poder declinar una solicitud con un motivo, para no bloquear el proceso.
58. Como People, quiero configurar por ciclo el modo de anonimato del feedback (transparente, anónimo para el evaluado, totalmente anónimo) y que quede bloqueado al lanzar, para proteger a quienes responden.
59. Como People, quiero ver cuántas solicitudes de feedback tiene cada persona y una alerta al superar un umbral, para no sobrecargar a nadie.
60. Como reporte directo, quiero dar feedback upward a mi manager de forma anónima, y que el resultado se muestre al manager solo agregado y con un mínimo de respuestas, para hablar con libertad (v2).

### Calibración

61. Como People, quiero crear grupos de calibración (por área, por manager o manual) e invitar calibradores con acceso de solo lectura, para revisar ratings en conjunto.
62. Como People, quiero una tabla de calibración por grupo con empleado, manager, rating original, rating propuesto, motivo obligatorio y marca, para ajustar con criterio.
63. Como People, quiero un histograma de distribución de ratings por área y por manager, sin curva forzada, para detectar sesgos.
64. Como People, quiero que cada cambio de rating quede en un registro append-only (quién, cuándo, valor anterior, valor nuevo, motivo), para auditar la calibración.
65. Como People, quiero publicar la calibración escribiendo los ratings calibrados en las evaluaciones, con notificación opcional a los managers, para cerrar la fase.
66. Como People, quiero que el empleado vea solo el rating final y nunca el original ni las notas de calibración, para proteger el proceso.
67. Como People, quiero exigir que una evaluación ya compartida se des-comparta antes de poder editarla, para que el empleado no vea cambios silenciosos.

### Dashboards y análisis

68. Como People, quiero un dashboard del ciclo con avance por fase, por área, por manager y por tipo de evaluación, para seguir la ejecución.
69. Como People, quiero ver la distribución de ratings por ciclo (pre y post calibración), agrupada por área, manager, ubicación o puesto, para comparar.
70. Como People, quiero ver la evolución de una persona a lo largo de los ciclos con rating normalizado, manager y puesto de cada momento, para analizar trayectorias.
71. Como People, quiero el equipo de un manager eligiendo explícitamente "jerarquía al momento de la review" o "jerarquía actual", para que el cruce sea el que necesito.
72. Como People, quiero cruzar cumplimiento de goals del período con el rating final, para ver si la evaluación es consistente con los resultados.
73. Como People, quiero ver la brecha entre autoevaluación y evaluación del manager por pregunta y por persona, para detectar desalineaciones.
74. Como People, quiero el panel de calidad de datos con conteos y acceso directo a cada caso, para corregir antes de reportar.
75. Como dirección, quiero vistas agregadas sin individuos (distribución por área, participación, brecha self vs manager), para seguir el proceso sin ver datos personales.

### Goals

76. Como empleado, quiero ver mis goals (importados o nativos) con progreso, milestones y comentarios, para seguirlos en el mismo lugar que la evaluación.
77. Como manager, quiero ver los goals de mi equipo y su estado, para preparar 1:1 y evaluaciones.
78. Como People, quiero relacionar goals con ciclos por período (automático) o con vínculo explícito, para alimentar el bloque de goals de cada review.
79. Como empleado, quiero crear y actualizar goals nativos con milestones cuando ya no usemos Bamboo, para que el módulo sea autosuficiente (v2).

### Operación, notificaciones y administración

80. Como People, quiero que el sistema envíe recordatorios automáticos antes de cada fecha límite (7 y 1 días) y permita enviar uno manual, para sostener la participación.
81. Como People, quiero completar o editar una evaluación en nombre de otro con registro de auditoría, para resolver bloqueos.
82. Como People, quiero desbloquear una evaluación enviada para que se corrija y reenvíe, para arreglar errores sin romper el historial.
83. Como People, quiero un registro de auditoría de acciones administrativas (cambios de fase, desbloqueos, ediciones en nombre de otro, cambios de participantes), para rendir cuentas.
84. Como administrador, quiero un selector "actuar como" (People, manager X, empleado Y, par, calibrador) sin login, para probar todos los flujos en la primera versión.
85. Como administrador, quiero cambiar el idioma de la interfaz entre español e inglés, para que todos la usen cómodos.
86. Como administrador, quiero poblar el sistema con una empresa sintética realista (~400 personas, 5 niveles, 3 ciclos históricos, bajas, reingresos, cambios de manager, goals), para desarrollar y demostrar sin datos reales.
87. Como administrador, quiero correr las importaciones desde línea de comandos o tarea programada además de la UI, para automatizarlas.

## Implementation Decisions

**Arquitectura general**

- Monolito Next.js (App Router) con Server Components y Server Actions; la lógica de dominio vive en módulos TypeScript puros fuera de la capa web, invocables desde la UI, desde una CLI y desde tests.
- Postgres en Supabase local como única base; Drizzle como ORM "SQL-first" (CTEs, vistas, upserts). Sin login en v1; roles simulados por el selector "actuar como", pero toda consulta de dominio recibe un contexto de actor con rol y persona para que agregar Supabase Auth después no toque el modelo.
- i18n con next-intl, locales es (default) y en; cada string de UI tiene clave; preguntas, secciones y etiquetas de escala guardan texto por locale en el modelo.

**Módulos (profundos, interfaz chica)**

1. `bamboo-client`: cliente tipado de la API pública de Bamboo (API key o OAuth), con reintentos por 429/5xx respetando Retry-After, límite de concurrencia, tres iteradores de paginación (cursor, página/page_size, página en body), normalización de IDs a string y fechas a ISO. Cubre employees (list, get, directory, tables, changed), goals (aggregate v1_2, list, comments), datasets (list, fields, data v2), custom reports, meta y webhooks. Tipos generados desde el OpenAPI oficial.
2. `source-adapters`: interfaz `SourceAdapter` (fuente, entidades, extract por entidad como iterable asíncrono de {sourceId, payload, extractedAt}) e interfaz `LakeAdapter` (listTables, describeTable, readBatches con keyColumns/watermark/since/batchSize). Implementaciones v1: `BambooApiAdapter`, `FileAdapter` (CSV/XLSX/Parquet/NDJSON vía DuckDB en proceso), `FixtureAdapter` (tests). `LakeSqlAdapter` para BigQuery/Snowflake/Databricks/Redshift/Postgres en v2 con la misma suite de contrato. Perfiles de fuente en configuración: tabla, claves, columna watermark, soft-delete, mapeo de columnas.
3. `ingest`: pipeline raw → staged → dominio. Tabla `raw_record` (fuente, entidad, source_id, payload jsonb, hash, extracted_at; única por fuente+entidad+source_id+hash), validación con zod en staging, upsert por (source_system, source_id) solo cuando cambia el hash, SCD2 para historial, soft-delete cuando una entidad falta en una extracción completa, `ingest_run` con conteos y rechazos. Watermark se avanza solo tras commit. Corre fuera de request handlers (CLI/worker).
4. `identity`: `person` golden + `source_identity` (kind: bamboo_id, employee_number, work_email, lake_key; con vigencias). Orden de match: bamboo_id → legajo → email normalizado; coincidencia por nombre+fecha de ingreso solo propone, nunca auto-vincula. Lo no resuelto va a `identity_match_issue` con resolución manual. Empleo (`employment`) separado de persona para bajas y reingresos.
5. `org-history`: `employee_job_history` SCD2 (valid_from, valid_to, manager_person_id, manager_raw, department, division, job_title, location) construido desde jobInfo; función "as of date" para manager/área de una persona; snapshot por participante al lanzar ciclo.
6. `review-core`: `review_cycle` (nombre, período, snapshot_date, estado, componentes habilitados, modo de anonimato por tipo, escala final, fechas límite por fase, cadencia fija o por fecha de ingreso), `review_template` → `template_section` → `question` (tipo, escala, relación a quien aplica, visible al evaluado, texto por locale) con `question_revision` inmutable por ciclo, `rating_scale` → `rating_scale_option` (value, label por locale, normalized 0..1), `cycle_participant` (reviewee + snapshot org + goal snapshot + shared_at, acknowledged_at, nota de acuse), `peer_nomination` (estado pending/approved/declined/removed), `review_request` (participante, evaluador, relación self/manager/peer/upward, estado draft/submitted/declined, anonimato, reviewer_mismatch), `answer` (request, question_revision, option, numeric, text), `final_rating` append-only (stage computed/manager/calibrated/override, actor, reason) con vista "rating vigente", `calibration_group` y `calibration_change`. Máquina de estados del ciclo con transiciones registradas. Reglas de visibilidad (double-blind, visible al evaluado, compartido, anonimato) implementadas en una sola función de autorización de lectura.
7. `goals`: `goal`, `goal_milestone`, `goal_comment`, `goal_share` con source_system; `participant_goal_snapshot` por ciclo; relación con ciclo por solapamiento de período o vínculo explícito.
8. `analytics`: consultas SQL nombradas (avance del ciclo, distribución pre/post calibración, historial por persona, equipo as-of vs actual con CTE recursivo, goals vs rating, brecha self vs manager, calidad de datos) expuestas como funciones tipadas y como endpoints JSON de solo lectura; exports CSV con IDs en cada fila.
9. `web`: rutas por locale: inicio/tareas, personas y organigrama, importaciones (fuentes, corridas, conflictos), templates y escalas, ciclos (lista, configuración, estado, participantes), evaluación (self, manager, par), calibración, dashboards, calidad de datos, configuración (actuar como, idioma). Componentes shadcn/ui; formularios con validación zod compartida con el dominio.
10. `fixtures/seed`: generador determinista (semilla fija) de empresa sintética con la forma exacta de las respuestas de la API de Bamboo (employees list/get, tables jobInfo/employmentStatus, goals aggregate) y archivos CSV con la forma de los reportes estándar de Bamboo; incluye 3 ciclos históricos, bajas, reingresos, cambios de manager, personas sin manager y datos sucios para la cola de identidad. Dos tamaños: chico para tests, ~400 para demo.

**Convenciones de datos**

- Toda tabla de dominio lleva source_system (bamboo_api | bamboo_export | lake | native), source_id, ingest_run_id, payload_hash, created_at, updated_at, deleted_at; único por (source_system, source_id). Las joins usan solo el UUID interno.
- Nunca se usa el legajo (employeeNumber) como clave; el id interno de Bamboo es la clave de origen.
- Las respuestas de rating guardan valor numérico, etiqueta y valor normalizado en el momento de responder.
- Nada se borra físicamente: soft-delete y tablas append-only para ratings finales y cambios de calibración.

**Proceso default (templates del sistema)**

- Ciclo evaluativo de fin de año: autoevaluación reflexiva (4 preguntas de texto), evaluación del manager (rating de goals + comentario, logros, mejora y próximos pasos, foco próximo período, rating general 4 puntos), feedback de pares (3 preguntas, hasta 5 pares, aprobación del manager, anónimo para el evaluado), calibración lite, publicación, acuse 7 días. Cronograma sugerido 6 semanas.
- Ciclo de desarrollo de mitad de año: sin rating ni calibración.
- Upward y autoevaluación con rating existen como opciones apagadas.

**Decisiones explícitas**

- Sin deploy ni ambientes compartidos hasta que el módulo esté listo; sin Jira por ahora; tracker = GitHub Issues del repo.
- Rating final de una sola fuente (manager) pasando por calibración; el empleado ve solo el valor final.
- Sin curva de distribución forzada; sin decisiones de compensación dentro del módulo.
- Snapshot organizacional al lanzar ciclo y SCD2 como mecanismo para "manager al momento de la review"; las vistas eligen explícitamente as-of o actual.

- **Poda realizada (#54):** se quitaron el asistente y las fases de ciclo, la cadencia por fecha de ingreso, la autoevaluación y la evaluación del manager, pares y nominaciones, comparación, notas, acuse de recibo, calibración (grupos, propuestas, publicación), operación del ciclo, notificaciones, `/me`, `/team` y los roles `peer` y `calibrator`. La migración `0019_prune` borra las tablas `calibration_group*`, `cycle_transition`, `review_audit`, `follow_up_note`, `peer_nomination` y `notification`, sus columnas propias y los enums `calibration_group_kind`, `schedule_kind`, `review_audit_action`, `peer_nomination_status` y `notification_kind`. Se conservan los enums `cycle_status`, `review_relationship`, `review_request_status` y `final_rating_stage` (sacar valores obliga a reescribir filas), además de `final_rating` y `v_current_rating`, que leen los dashboards, la API y los exports.

## Testing Decisions

- Un buen test verifica comportamiento observable a través de la interfaz pública del módulo (entradas → salidas, filas en la base, estados), nunca detalles internos. Los tests de dominio corren contra Postgres real (Supabase local vía Vitest proyecto `db`) y se escriben antes del código (rojo → verde → refactor).
- Se testean todos los módulos:
  - `bamboo-client`: contra un servidor HTTP simulado con fixtures con la forma del OpenAPI; casos de paginación, 429 con Retry-After, campos restringidos, normalización de IDs.
  - `source-adapters`: suite de contrato compartida (batchSize 1 con empates de watermark, overlap de since, drift de esquema, NULLs, BIGINT como string, zonas horarias) ejecutada sobre FileAdapter y FixtureAdapter; la misma suite se usará para los adaptadores reales.
  - `ingest`: idempotencia de re-corridas, corte a mitad de lote sin avanzar watermark, lo viejo nunca pisa lo nuevo, soft-deletes, conteos de corrida, rechazos.
  - `identity`: orden de match, reingresos, cambios de email, conflictos a la cola, resolución manual.
  - `org-history`: construcción SCD2 desde jobInfo, manager as-of en fechas de borde, snapshot al lanzar.
  - `review-core`: máquina de estados, double-blind, visibilidad por pregunta y por fase, inmutabilidad tras envío, desbloqueo, calibración append-only y publicación, acuse de recibo, mismatch de evaluador.
  - `goals`: snapshot por participante, relación por período.
  - `analytics`: resultados de cada consulta sobre el seed chico con valores esperados calculados a mano.
  - `web`: tests de componentes (Testing Library) para cada pantalla y formulario, incluidos estados vacíos, errores y ambos idiomas; e2e Playwright por flujo completo (importar → lanzar ciclo → self → manager → calibrar → compartir → acusar recibo → dashboard) con el selector "actuar como".
- Prior art en el repo: `src/db/ingest-run.db.test.ts` (test de base con migraciones aplicadas por globalSetup), test de paridad de claves de mensajes es/en, `e2e/smoke.spec.ts`.

## Out of Scope

- Login, roles reales y RLS (Supabase Auth) — el modelo los contempla, la v1 no los implementa.
- Deploy, dominios, ambientes compartidos, Vercel.
- Conectores reales al lake (BigQuery, Snowflake, Databricks, Redshift) — solo la interfaz y la implementación sobre archivos; los reales son v2 con la misma suite de contrato.
- Extracción de assessments directamente desde Bamboo: no existe API; entran por archivo (export de reportes o export oficial de Performance).
- Upward feedback agregado, autoevaluación con rating, competencias y valores, fórmula de score ponderado, ratings por goal, 9-box, Ratings Preview, evaluación privada del manager, paquetes PDF, redacción asistida por IA, ciclos de ciclo de vida automáticos, API pública/webhooks salientes, goals nativos editables y 1:1s — todos v2.
- Otros módulos de BambooHR (time off, payroll, onboarding, ATS).
- Envío real de emails: en v1 las notificaciones se registran en una bandeja interna y se visualizan en la UI.

## Further Notes

- Riesgo principal: cómo obtener el histórico de assessments. Caminos por confiabilidad: (1) export oficial de Performance por soporte de Bamboo (150 USD, incluye assessments, feedback, goals y adjuntos; pedir formato e IDs antes de pagar y antes de dar de baja el módulo), (2) exports CSV/Excel de los reportes estándar más goals por API, (3) verificar con API key si el dataset "Performance" de Datasets v2 trae algo más que goals, y preguntar a Bamboo por los scopes OAuth performance:assessments / performance:feedback que existen pero no tienen endpoint público.
- Hasta tener API key, todo corre con fixtures con la forma exacta de la API; el primer paso con credenciales reales es un smoke test que grabe respuestas reales y las compare con los fixtures.
- Preguntas abiertas al negocio: clave confiable de empleado (id, legajo, email) y casos de reingreso; escalas históricas y su significado; si hoy existe calibración en planillas; cuántos años de histórico migrar; sistema de registro de la organización una vez reemplazado Bamboo; quién puede ver feedback de pares y con qué anonimato.
- Hallazgos de Bamboo a replicar que no están en el proceso default pero el modelo soporta: cadencia por fecha de ingreso, publicación diferida de la evaluación del manager, "vista del empleado" para compartir pantalla, assessments impromptu y salteo, reglas de cambio de manager a mitad de ciclo.

---

# Iteración 2: Insights sobre Bamboo

Fecha: 2026-11-17. Reemplaza la prioridad de la v1: el reemplazo total de Bamboo sigue siendo el norte, pero lo urgente es sacar valor de los datos que ya existen en Bamboo y presentárselos a People. La app pasa a ser **solo este módulo**: se conserva todo lo que el módulo usa (identidad, historial de puesto, personas, organigrama, ingesta y carga de archivos, goals, templates y escalas, ciclos como contenedores con participantes y snapshot, pedidos y respuestas, visibilidad de lectura, analítica, exports, API, selector "Actuar como") y se elimina lo que no usa (correr ciclos dentro de la app: autoevaluación y evaluación del manager como formularios, pares y upward, nominaciones, calibración, compartir y acuse de recibo, notas de seguimiento, notificaciones e inbox, cadencia por fecha de ingreso, asistente de ciclos). Las tablas que quedan sin uso se eliminan por migración.

## Problem Statement

People corre dos veces por año un proceso de evaluación en Bamboo con dos etapas desconectadas: Goals y Assessments. La evaluación tiene 5 preguntas abiertas y 2 cerradas (retención y compromiso, Likert 1-5, respondidas por el manager y ocultas al empleado). Bamboo sólo ofrece dos reportes nativos exportables (Assessment Progress y el reporte crudo de respuestas, que es Employee Performance), sin IDs ni cruce con la organización del momento. Hoy existe un dashboard HTML armado a mano con completitud y análisis cualitativo (etiquetas de sentimiento y temas por comentario) que nunca se compartió. People necesita ver completitud, quién falta, distribución y evolución de retención y compromiso, el análisis cualitativo y la relación con los goals, con permisos por rol y un export para una mini app de Arturía, todo sin exponer datos sensibles.

## Solution

Sobre el pipeline existente (ingesta, perfiles de fuente, historial de importación, identidad golden, snapshot organizacional por participante):

1. **Importar los dos reportes nativos** con CSV y XLSX, mapeo de columnas configurable por perfil, detección del ciclo semestral (nombre de ciclo primero, fecha como respaldo, ambigüedad resuelta en la UI), idempotencia por archivo y actualización por ciclo, cola de identidad para lo que no cruza, y un comando `reports:inspect` que imprime sólo encabezados y conteos.
2. **Modelar las preguntas de Santex** en un template de sistema "Evaluación semestral Santex": 2 estándar de Bamboo (self y manager), 3 custom (placeholders), y las 2 cerradas del manager (Retención, Compromiso) en Likert 1-5 no visibles para el evaluado. Cada pregunta abierta lleva una dimensión. Las codificaciones históricas con letra se normalizan a 1-5 con una tabla de equivalencias configurable; lo que no mapea va a calidad de datos.
3. **Dashboards**: completitud (global, por área, por manager, quién falta, CSV, comparación con el ciclo anterior); indicadores de retención y compromiso (distribución, evolución por persona y equipo, matriz de cuadrantes con lista de riesgo, alertas con umbrales configurables); análisis cualitativo (sentimiento por dimensión, temas, evolución, sentimiento vs. indicadores); goals vs. indicadores e indicadores por objetivo; reporte de autoevaluación; sección de health check preparada; vista ejecutiva con selector cualitativo / cuantitativo.
4. **Módulo `qualitative-analysis`** con interfaz `AnalysisProvider`: `MockProvider` determinista (tests y seed) y `AnthropicProvider` apagado por defecto (flag explícita, lotes, seudonimización testeada, caché por hash de texto y versión de prompt, registro de corridas sin contenido). Importación de etiquetas ya existentes desde CSV documentado. Corrección humana auditada que nunca se pisa.
5. **Export para Arturía** (`pnpm export:arturia --cycle <id> [--anonymized]`): HTML autocontenido y JSON con contrato versionado. Por defecto con todos los datos (nombres y email) en `data/private/`; `--anonymized` deja sólo agregados con mínimo n = 5 por celda.
6. **Permisos**: nuevo rol `direction`; People ve todo, Manager sólo sus reportes directos del snapshot y agregados de su equipo, Dirección sólo agregados con n ≥ 5, Empleado nunca ve retención, compromiso ni etiquetas sobre sí mismo.
7. **Datos sensibles**: `data/private/` ignorado por git, check que falla si se commitea un CSV/XLSX fuera de `fixtures/` o un archivo con emails fuera del dominio sintético del seed; el email no se muestra salvo en la ficha de persona para People, no sale en exports por defecto (opción explícita), no se loguea ni se manda a servicios externos.

## User Stories

### Poda y datos sensibles

1. Como People, quiero que la app contenga sólo el módulo de insights y lo que éste necesita, para que la herramienta sea clara y mantenible.
2. Como desarrollador, quiero que los exports reales de Bamboo vivan en `data/private/` ignorado por git, para no filtrar datos.
3. Como desarrollador, quiero un check que falle si se intenta commitear un CSV/XLSX fuera de `fixtures/` o un archivo con emails que no sean del dominio sintético, para que ningún dato real llegue al repo.
4. Como People, quiero que el email sólo se muestre en la ficha de persona y no en listados ni exports por defecto, para minimizar exposición.
5. Como People, quiero poder incluir el email en un export con una opción explícita, para cruzar con otras fuentes cuando haga falta.

### Importación de reportes

6. Como People, quiero subir el reporte Assessment Progress (CSV o XLSX) y que alimente la completitud por persona y manager de un ciclo, para saber quién falta.
7. Como People, quiero subir el reporte crudo de respuestas (Employee Performance) y que cree o actualice el ciclo semestral correspondiente con participantes, pedidos y respuestas, para tener el histórico.
8. Como People, quiero que el sistema detecte el ciclo semestral de cada fila por el nombre del ciclo y, si no hay, por la fecha de assessment con cortes configurables, para no clasificar a mano.
9. Como People, quiero que cuando el ciclo sea ambiguo la UI me pregunte a qué ciclo va cada grupo de filas, en vez de adivinar.
10. Como People, quiero que reimportar el mismo archivo no duplique ni cambie nada, para repetir con confianza.
11. Como People, quiero que un archivo nuevo del mismo ciclo actualice los datos existentes, porque la carga es manual y se repite.
12. Como People, quiero que las personas que no cruzan con la identidad golden vayan a la cola de conflictos, para resolverlas a mano.
13. Como People, quiero que el mapeo de columnas de cada reporte sea configurable (nombre de columna, tipo de pregunta, dimensión, lado self/manager), para ajustarlo cuando vea las columnas reales.
14. Como desarrollador, quiero `pnpm reports:inspect <archivo>` que imprima sólo encabezados y conteos, nunca valores, para ajustar el perfil contra un export real sin exponer datos.
15. Como desarrollador, quiero fixtures sintéticos de ambos reportes en `fixtures/bamboo-reports/`, para desarrollar y testear.
16. Como People, quiero que los ciclos importados tengan snapshot de goals por solapamiento de fechas, para relacionar assessments con goals históricos.

### Modelo de preguntas

17. Como People, quiero un template de sistema "Evaluación semestral Santex" con las 2 preguntas estándar (self y manager), 3 custom y las 2 cerradas del manager, para que la evaluación refleje el proceso real.
18. Como People, quiero que Retención y Compromiso sean Likert 1-5 y no visibles para el evaluado, para proteger la información.
19. Como People, quiero que las respuestas históricas con letra (A-D o A-E) se normalicen a 1-5 con una tabla de equivalencias configurable y documentada, para comparar entre ciclos.
20. Como People, quiero que una opción que no mapea aparezca en calidad de datos en lugar de descartarse, para corregir el mapeo.
21. Como People, quiero que cada pregunta abierta tenga una dimensión (Fortalezas, Oportunidades de mejora, una por custom), para agrupar el análisis cualitativo.
22. Como People, quiero que un evaluador importado que no es el manager directo del snapshot quede marcado como mismatch y aparezca en calidad de datos, para auditar quién evaluó.

### Completitud

23. Como People, quiero ver el % de completitud de autoevaluación y de evaluación del manager, global, por área y por manager, para seguir el ciclo.
24. Como People, quiero el detalle de quién falta por persona y por manager, filtrable y exportable a CSV sin email por defecto, para reclamar.
25. Como People, quiero comparar la completitud con el ciclo anterior, para ver tendencias.
26. Como Manager, quiero ver la completitud de mis reportes directos del snapshot, para gestionar a mi equipo.

### Retención y compromiso

27. Como People, quiero la distribución de retención y de compromiso por ciclo, área y manager del snapshot, para detectar focos.
28. Como People, quiero la evolución de ambos indicadores por persona y por equipo a lo largo de los ciclos, para ver trayectorias.
29. Como People, quiero la matriz retención × compromiso por cuadrantes con la lista de personas del cuadrante de riesgo, para actuar.
30. Como People, quiero alertas por caída de 2 o más puntos entre ciclos o por retención y compromiso ≤ 2 a la vez, con umbrales configurables, para no revisar todo a mano.
31. Como People, quiero editar umbrales, mínimo n y cortes de semestre en una pantalla de configuración auditada, para ajustar sin tocar código.
32. Como Empleado, no quiero ver nunca mi retención, compromiso ni etiquetas de sentimiento, para que el proceso sea confiable.

### Análisis cualitativo

33. Como People, quiero que cada respuesta abierta tenga sentimiento (positivo, constructivo, negativo) por dimensión con confianza, para medir el clima.
34. Como People, quiero los temas principales por dimensión, ciclo, área y manager con frecuencia y 2-3 citas seudonimizadas, para entender qué dice la gente.
35. Como People, quiero correr el análisis con un proveedor determinista (Mock) para demos y tests, para validar el enfoque sin costo.
36. Como People, quiero que el proveedor Anthropic esté apagado por defecto y sólo se active con una flag explícita, para decidir yo cuándo usarlo.
37. Como People, quiero que todo texto enviado a un LLM externo esté seudonimizado (sin nombres, emails, legajos; IDs reemplazados por tokens) y re-asociado al volver, con tests, para proteger a las personas.
38. Como People, quiero que el análisis se cachee por hash del texto y versión del prompt, para no reprocesar ni gastar de más.
39. Como People, quiero un registro de cada corrida (cuántos textos, modelo, versión de prompt, nunca el contenido), para auditar.
40. Como People, quiero importar etiquetas ya hechas desde un CSV documentado, para reaprovechar el análisis existente.
41. Como People, quiero corregir la etiqueta de un comentario, que quede auditado y que ninguna corrida posterior la pise, para mantener la calidad.
42. Como People, quiero ver sentimiento por dimensión en barras apiladas, evolución entre ciclos, ranking de temas y sentimiento vs. retención/compromiso, para presentar hallazgos.

### Goals ↔ Assessments

43. Como People, quiero ver, por assessment importado, los goals de la persona en ese período con estado y progreso, para conectar las dos etapas.
44. Como People, quiero el avance de goals vs. retención, compromiso y sentimiento, y las personas con goals cumplidos pero indicadores bajos y viceversa, para detectar incoherencias.
45. Como People, quiero indicadores por objetivo (% completados, en curso y vencidos por persona, equipo y área) y su relación con los indicadores del assessment, para evaluar el enfoque cuantitativo.

### Reportes y vista ejecutiva

46. Como People, quiero un reporte de autoevaluación con completitud, temas, sentimiento y brecha self vs. manager, para la presentación.
47. Como People, quiero un perfil de importación genérico y una sección preparada para el health check de CAP, para enchufarlo cuando conozca el formato.
48. Como People, quiero una vista ejecutiva de una página con completitud, retención, compromiso, sentimiento y top temas, con selector cualitativo / cuantitativo, para elegir enfoque.
49. Como Dirección, quiero ver sólo agregados con mínimo n = 5 por celda (celdas menores ocultas o agrupadas en "Otros"), para seguir sin ver datos personales.

### Export para Arturía

50. Como People, quiero `pnpm export:arturia --cycle <id>` que genere un HTML autocontenido sin requests externos y un JSON con contrato versionado, para subirlo a la mini app.
51. Como People, quiero que el export salga por defecto con todos los datos (nombres y email) en `data/private/`, y con `--anonymized` sólo agregados n ≥ 5, para controlar qué comparto.
52. Como People, quiero `docs/arturia.md` con el flujo de actualización manual y las preguntas abiertas sobre restricciones técnicas, sin respuestas inventadas.

### Demo y calidad

53. Como People, quiero que `pnpm db:seed --size demo` deje todo lo anterior visible con datos sintéticos en 5 minutos, para demostrar.
54. Como desarrollador, quiero un e2e que importe los dos reportes sintéticos, vea completitud y quién falta, retención/compromiso, corra el análisis con Mock, vea la vista ejecutiva y genere el export verificando que no contiene emails ni nombres reales (en modo anonimizado), para proteger el flujo completo.
55. Como desarrollador, quiero tests de autorización para cada vista nueva por rol, para que los permisos no se rompan.

## Implementation Decisions

**Poda.** Se elimina el código, las rutas, los componentes, los tests, los mensajes y las tablas de: nominaciones de pares, feedback de pares y upward, calibración (grupos, cambios, publicación; se conserva `final_rating` sólo si alguna analítica la usa, de lo contrario se elimina), compartir y acuse de recibo, notas de seguimiento, notificaciones e inbox, cadencia por fecha de ingreso, asistente de creación de ciclos, formularios de autoevaluación y de evaluación del manager, operación del ciclo (evaluadores alternos, en nombre de otro). Se conservan los pedidos y respuestas como datos importados, las revisiones de pregunta, el snapshot organizacional y de goals, el estado del ciclo (reducido a `closed` para importados), la función de visibilidad de lectura (simplificada) y el registro de auditoría administrativa (reutilizado para settings y correcciones). Una migración elimina tablas y enums sin uso.

**Configuración.** Tabla `app_setting` (clave, valor jsonb, actualizado por, fecha) con defaults en código y pantalla `/settings/insights`. Claves: umbrales de alerta (caída ≥ 2, riesgo ≤ 2), mínimo n (5), cortes de semestre (H1 1/1-30/6, H2 1/7-31/12, margen de ambigüedad 15 días), proveedor de análisis. Cada cambio escribe auditoría.

**Roles.** Se agrega `direction` a los roles del actor; `peer` y `calibrator` se eliminan. Una única función de autorización por vista decide: People todo; Manager sus reportes directos del snapshot (no toda la cadena) y agregados de su equipo; Dirección sólo agregados con n ≥ 5; Empleado nunca retención, compromiso ni sentimiento sobre sí mismo. Las rutas de importación, calidad de datos y settings quedan restringidas a People.

**Importación.** El perfil de fuente gana un mapeo de preguntas configurable por columna: lado (self/manager), tipo (texto, Likert, opción con letra), dimensión, clave estable y tabla de equivalencias de opciones a 1-5. El perfil `bamboo-employee-performance` se extiende con esa configuración por defecto; `bamboo-assessment-progress` pasa a dominio escribiendo una tabla de completitud por participante y ciclo (estado self, estado manager, notas, fuente) y requiere un ciclo destino existente o elegido. Detección de ciclo: el nombre crea o actualiza un ciclo semestral; sin nombre, la fecha de assessment decide el semestre; a menos de N días del corte o con nombre que no coincide, la corrida se detiene en estado "requiere decisión" y la UI pide el ciclo destino antes de continuar. La idempotencia se mantiene con las claves actuales (raw_record por hash, pedidos por source_id y hash, respuestas por pedido y revisión). Al finalizar la importación se toma el snapshot de goals de cada participante por solapamiento con el período del ciclo. Las opciones sin equivalencia se guardan en una tabla de problemas de respuesta visible en calidad de datos. `reports:inspect` lee CSV/XLSX con el lector existente y escribe sólo encabezados, cantidad de filas y cantidad de celdas no vacías por columna.

**Template Santex.** Nuevo template de sistema con clave propia, preguntas con `dimension`, dos preguntas Likert 1-5 con rol `retention` y `engagement` (roles nuevos) y `visibleToReviewee=false`, escala de sistema nueva de 1 a 5 con etiquetas de retención y de compromiso. Las revisiones de pregunta importadas se vinculan a estos roles y dimensiones por el mapeo del perfil, de modo que la analítica consulta por rol y dimensión y no por texto.

**Analítica.** Consultas SQL nombradas, por rol de pregunta y dimensión, siempre con el manager y el área del snapshot: completitud (desde la tabla de completitud y desde pedidos enviados), distribución y evolución de indicadores, cuadrantes, alertas, goals vs. indicadores, indicadores por objetivo, brecha self vs. manager, resumen ejecutivo. La supresión por mínimo n se aplica en la consulta cuando el actor es Dirección o el export es anonimizado.

**Análisis cualitativo.** Módulo con interfaz `AnalysisProvider { analyze(batch: PseudonymizedText[]): Promise<AnalysisResult[]>; name; promptVersion }`. Tablas: `qualitative_analysis` (respuesta, dimensión, sentimiento, confianza, temas, proveedor, versión de prompt, hash del texto, corrida), `analysis_run` (proveedor, modelo, versión, cantidad de textos, inicio, fin, estado; nunca contenido), `analysis_correction` (append-only: respuesta, etiqueta anterior, nueva, quién, cuándo, motivo), `theme` (nombre normalizado por dimensión). La seudonimización reemplaza nombres de personas conocidas, emails y legajos por tokens estables por corrida y revierte al volver; se testea con fixtures. El proveedor Anthropic usa la Claude API, se activa sólo con `ANALYSIS_PROVIDER=anthropic` y `ANTHROPIC_API_KEY`, procesa por lotes y respeta la caché. La corrección humana tiene precedencia sobre cualquier corrida. La importación de etiquetas acepta un CSV documentado (persona, ciclo, dimensión o pregunta, texto o hash, sentimiento, confianza, temas) y cruza por hash normalizado del texto.

**Export Arturía.** Módulo de export que arma un objeto `ArturiaReport` (schema versionado `arturia-report.v1`, documentado en `docs/`) a partir de las mismas consultas de analítica, lo serializa a JSON y a un HTML autocontenido (CSS y JS inline, gráficos SVG propios, sin requests externos). El comando escribe en `data/private/<ciclo>/` por defecto, y en modo anonimizado aplica la supresión n ≥ 5 y elimina nombres y emails; un test verifica la ausencia de emails y de nombres del seed en la salida anonimizada.

**Datos sensibles.** `data/private/` en `.gitignore` y `.prettierignore`. Un test unitario recorre los archivos trackeados por git y falla si hay CSV/XLSX fuera de `fixtures/` o emails con dominio distinto del sintético; un hook pre-commit opcional (`.githooks/pre-commit`, `git config core.hooksPath`) corre el mismo check. El dominio sintético del seed queda declarado en un único lugar.

## Testing Decisions

- Un buen test verifica comportamiento observable por la interfaz pública del módulo: entradas, filas en la base, salidas; nunca detalles internos. TDD rojo → verde → refactor.
- Unitarios (jsdom): mapeo de columnas y equivalencias Likert, detección de semestre y ambigüedad, seudonimización y reversión, MockProvider determinista, caché por hash, serialización del export, check de datos sensibles, `reports:inspect`, componentes de cada vista nueva en ambos idiomas, paridad de mensajes es/en.
- DB (Postgres local): importación de ambos reportes desde fixtures (idempotencia, actualización por ciclo, cola de identidad, mismatch, problemas de respuesta), snapshot de goals en históricos, cada consulta de analítica con valores calculados a mano sobre el seed chico, autorización por rol en cada consulta, corrección humana que sobrevive a una corrida, settings auditados, migración de poda sobre una base con datos.
- e2e (Playwright): el flujo completo del pedido: importar los dos reportes sintéticos → completitud y quién falta → retención y compromiso → análisis con Mock → vista ejecutiva → export anonimizado sin emails ni nombres.
- Prior art: tests de importación histórica desde fixtures, tests de dashboards con seed y actores, tests de exports CSV, test de paridad de mensajes, e2e de importación histórica.

## Out of Scope

- Deploy, login real, envío de emails, conectores reales al lake, escritura en Bamboo.
- Activar el AnthropicProvider contra datos reales (decisión del owner tras aprobación de People).
- Correr ciclos de evaluación dentro de la app (se elimina en esta iteración; el reemplazo total de Bamboo queda para después).
- Formato real del health check de CAP y restricciones técnicas de Arturía: quedan como preguntas en la documentación.

## Further Notes

Preguntas abiertas para el owner y People, que no se asumen: texto exacto y dimensión de las 3 preguntas custom; columnas reales de los dos reportes (tras `reports:inspect`); formato del health check de CAP; restricciones de las mini apps de Arturía (tamaño, scripts, auth); preferencia de People por el enfoque cualitativo, cuantitativo o ambos. Supuestos provisorios: equivalencias Retención A=5…E=1 y Compromiso A=5…E=1 (variante de 4 opciones A=5, B=4, C=2, D=1); semestres calendario; custom como placeholders "Custom 1..3".
