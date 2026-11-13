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
