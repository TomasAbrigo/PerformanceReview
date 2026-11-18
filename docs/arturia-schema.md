# Schema `arturia-report.v1`

Contrato del JSON que genera `pnpm export:arturia` (zod: `arturiaReportV1` en `src/modules/arturia-report/schema.ts`). El HTML embebe exactamente este JSON.

## Versionado

- `schemaVersion` es siempre `"arturia-report.v1"` en esta versión.
- `schemaMinor` (entero) sube con cada **cambio aditivo**: campo opcional nuevo, sección nueva, valor nuevo en un campo de texto libre. Un consumidor de v1 debe ignorar campos que no conoce.
- Un **cambio incompatible** (renombrar o quitar un campo, cambiar su tipo o significado) es `arturia-report.v2`.
- Una sección `null` significa "no disponible en este build" (el dato todavía no se calcula), no "cero".

### Historial de `schemaMinor`

- **0**: primera versión (ejecutivo, completitud propia, indicadores, cualitativo, personas; `goals` siempre `null`).
- **1**: `completion` pasa a calcularse con el módulo de completitud (#59) y `goals` con el de objetivos (#62). Agrega `completion.participants`, `completion.delta`, `applicable` en cada fila de `completion`, `goals.byManager`, `goals.buckets`, `goals.withoutGoals`, `goals.outliers`, `goals.suppressed` y los conteos extra de `goals.byDepartment`. Dos formas cambian y se dejan asentadas porque el contrato todavía no tiene consumidores (Arturía no recibió ningún informe y `goals` nunca salió con datos): `completion.byRelationship[].draft`/`declined` pasan a `int | null` (siempre `null`: el módulo cuenta enviadas contra aplicables y no distingue borrador de rechazada; la fila suma `applicable`) y los cuatro totales de `goals` pasan a ser nulleables (regla "sin reconstrucción por diferencia"). `completion` ya no cuenta solicitudes sino participantes (solo `self` y `manager`; pares y ascendente siguen en `executive.progress`).

- **2**: el cualitativo pasa a **cinco sentimientos** y se parte por quién escribe (#84). Agrega `neutral` y `mixed` a todo conteo de sentimiento (`sentimentByDimension[]`, `trend[]`, y los nuevos `totals` y `sentiment`; un informe anterior sin ellos se lee con 0, que es correcto porque entonces solo había tres), `qualitative.totals`, `topThemes[].sentiment` y `qualitative.bySide` (`{self, manager}`, cada uno con `totals`, `sentimentByDimension`, `topThemes` y `suppressed`). Las respuestas a preguntas cerradas con dimensión también cuentan como comentarios cuando el setting `analysis.includeClosed` está activo. No cambia ningún campo existente. `people[].positiveShare` y `goals[].positiveShare` siguen contando solo comentarios abiertos.

- **3**: cortes organizacionales (#85): cuenta y DM, de los atributos que People carga por archivo (ver [org-attributes.md](org-attributes.md)). Agrega `completion.byAccount` / `completion.byDm` (mismas filas que `byDepartment`), `completion.suppressed.byAccount` / `byDm`, `goals.byAccount` / `goals.byDm` (mismas filas que `goals.byDepartment`), `goals.suppressed.byAccount` / `byDm`, y en cada `indicators.distribution[]` `byAccount`, `byDm` (mismos grupos que `groups`) y `suppressedBy: {account, dm}`. Cada corte tiene además su propio total (`completion.byAccountTotal` / `byDmTotal`, `goals.byAccountTotal` / `byDmTotal`, `indicators.distribution[].byAccountTotal` / `byDmTotal`), `null` si en la versión anonimizada algún grupo de ese corte quedó suprimido. Todos opcionales: un informe de un minor anterior sigue siendo válido. No cambia ningún campo existente. Sin atributos cargados los desgloses salen con un solo grupo "Otros" (las personas sin cuenta ni DM).

## Raíz

| Campo           | Tipo                                 | Descripción                                                                                          |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `"arturia-report.v1"`                | Versión mayor del formato.                                                                           |
| `schemaMinor`   | entero ≥ 0                           | Versión menor (cambios aditivos). Hoy `3`.                                                           |
| `generatedAt`   | ISO 8601 (UTC)                       | Momento de generación.                                                                               |
| `cycle`         | `{id, name, periodStart, periodEnd}` | Ciclo: uuid, nombre, fechas `YYYY-MM-DD`.                                                            |
| `anonymized`    | boolean                              | `true`: versión anonimizada (sin `people`, sin emails ni nombres, sin personas en `goals.outliers`). |
| `minGroupSize`  | entero > 0                           | Setting `aggregation.minGroupSize` vigente. Solo se aplica cuando `anonymized`.                      |
| `sections`      | objeto                               | Ver abajo.                                                                                           |

Regla de anonimización: en toda serie agrupada, los grupos con `n < minGroupSize` (y el grupo sin nombre, p. ej. sin área) se juntan en uno `"Otros"` (`other: true`); si "Otros" sigue bajo el mínimo se omite y sus personas se cuentan en `suppressed`. Para grupos que se solapan (dimensiones, temas) el `n` de "Otros" es el máximo de los grupos (cota conservadora). Los managers se rotulan `"Equipo 1..N"` (orden estable por id dentro del informe). En la versión con nombres el mínimo es 1.

**Sin reconstrucción por diferencia:** en la versión anonimizada, cuando un desglose tiene algún grupo suprimido, el total que lo acompaña se publica como `null` (`executive.distribution`, `completion.byRelationship` y `completion.delta.total`, los cuatro totales de `goals`, `indicators.distribution[].total`, `indicators.riskMatrix.total`), así no se puede restar lo visible del total para obtener el grupo oculto. Para `completion` y `goals` basta con que cualquiera de sus desgloses (áreas, equipos, tramos) tenga un grupo suprimido.

**Por corte:** los totales de arriba (`executive.distribution`, `completion.byRelationship`, los cuatro de `goals`, `indicators.distribution[].total`) los deciden el corte por área, el de equipos y los tramos, como siempre: un corte por cuenta o por DM con grupos suprimidos no los oculta. Cada corte por cuenta o DM lleva su propio total (`byAccountTotal`, `byDmTotal`) y la misma regla dentro de él: `null` si alguno de sus grupos está suprimido.

**Quién calcula qué:** la versión con nombres se calcula como People (`hr`) y la anonimizada como "dirección" con el mínimo del informe (que se pasa a los módulos y reemplaza el setting en esa llamada). Todo el enmascarado de las secciones salvo el cualitativo lo hacen los módulos de analytics (`completionDelta`/`completionSummary`, `goalInsights`, indicadores, resumen ejecutivo): grupos bajo el mínimo plegados en "Otros" u ocultos y, porque un manager es una persona, equipos con su `key` pero sin nombre (`label` null). El export solo rotula esos equipos "Equipo N" (por id del manager del snapshot, calculado una vez por informe: el mismo número en completitud y objetivos), no deja totales junto a un grupo suprimido y arma el cualitativo.

## `sections.executive`

| Campo          | Tipo                                 | Descripción                                                  |
| -------------- | ------------------------------------ | ------------------------------------------------------------ |
| `participants` | entero                               | Participantes activos del ciclo.                             |
| `progress`     | `[{relationship, total, submitted}]` | Evaluaciones por tipo (`self`, `manager`, `peer`, `upward`). |
| `bins`         | `[{from, to}]`                       | Rangos (0-1) de la calificación normalizada.                 |
| `distribution` | `int[]`                              | Personas por rango (todos ceros si quedan bajo el mínimo).   |
| `byDepartment` | `[{label, n, mean, counts, other}]`  | Por área: n, media normalizada, conteo por rango.            |
| `suppressed`   | entero                               | Personas fuera del desglose.                                 |

## `sections.completion` (nullable)

Quién envió su autoevaluación y la evaluación de su manager, según el módulo de completitud (#59): el estado sale del reporte Assessment Progress de cada participante y, si no tiene, de sus solicitudes de evaluación. Un lado que no aplica (no hay tal evaluación en el ciclo) no cuenta ni como enviado ni como pendiente. `null` si el ciclo no tiene participantes o a nadie le aplica ninguna de las dos evaluaciones.

| Campo            | Tipo                                                         | Descripción                                                                                                                 |
| ---------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `participants`   | entero                                                       | Participantes del ciclo (se publica aunque los grupos queden ocultos).                                                      |
| `byRelationship` | `[{relationship, total, submitted, draft, declined}]` o null | `self` y `manager`: `total` = participantes a los que aplica, `submitted` = enviadas. `draft` y `declined` siempre `null`.  |
| `byDepartment`   | `[{label, relationship, n, total, submitted, other}]`        | Por área y lado (`self`/`manager`, solo los que aplican); `n` = participantes del grupo, `total` y `submitted` como arriba. |
| `byManager`      | idem                                                         | Por equipo (manager del snapshot); "Equipo N" si anonimizado.                                                               |
| `byAccount`      | idem (minor 3, opcional)                                     | Por cuenta (atributo organizacional a la fecha del snapshot); sin cuenta: "Otros".                                          |
| `byDm`           | idem (minor 3, opcional)                                     | Por DM; "DM N" si anonimizado (un DM es una persona: equipo sin nombre, orden estable por clave dentro del informe).        |
| `suppressed`     | `{byDepartment, byManager, byAccount?, byDm?}`               | Participantes fuera de cada desglose.                                                                                       |
| `delta`          | `{previousCycleName, total, byDepartment[]}` o null          | Cambio en puntos porcentuales de la tasa de enviadas contra el semestre anterior; null si no hay ciclo anterior.            |

`delta.total` es `{self, manager}` (null si anonimizado y hay un grupo suprimido) y `delta.byDepartment` `[{label, other, self, manager}]`; un valor es `null` cuando el otro ciclo no tiene ese grupo o no hay tasa que comparar.

## `sections.indicators` (nullable)

| Campo                                                                            | Tipo                                                                             | Descripción                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distribution`                                                                   | `[{indicator, groups: [{label, n, mean, counts[5], other}], total, suppressed}]` | Retención y compromiso (Likert 1-5) por área; `total` null bajo el mínimo.                                                                                                                               |
| `distribution[].byAccount`, `distribution[].byDm`, `distribution[].suppressedBy` | mismos grupos que `groups`; `{account, dm}`                                      | Minor 3, opcionales. La misma distribución por cuenta y por DM ("DM N" si anonimizado); `suppressedBy` son las personas fuera de cada corte. Con un grupo suprimido en cualquier corte, `total` es null. |
| `riskMatrix`                                                                     | `{cells: [{retention, engagement, count, risk}], total, riskCount}` o null       | 9 celdas, bandas `low/mid/high`; `count` null bajo el mínimo.                                                                                                                                            |
| `alerts`                                                                         | `[{kind, indicator, count}]`                                                     | Alertas contadas (`drop` por indicador, `risk`); nunca personas. Bajo el mínimo se omiten.                                                                                                               |

## `sections.qualitative` (nullable)

Los **cinco sentimientos**, en este orden: `positive`, `constructive`, `neutral`, `mixed`, `negative`. Todo "conteo de sentimiento" es `{positive, constructive, neutral, mixed, negative, total}` (`total` es la suma de los cinco).

| Campo                  | Tipo                                                                                       | Descripción                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `totals`               | conteo de sentimiento o null                                                               | Todo el ciclo, los dos lados. `null` si anonimizado y hay algo suprimido (los grupos visibles sumarían todo menos lo oculto). Opcional (minor 2).                                                                                                                                           |
| `sentimentByDimension` | `[{dimension, ...conteo, other}]`                                                          | Comentarios por dimensión (clave de `question_revision.dimension`: `strengths`, `improvement`, `valued`, `best_work`, `custom_<n>`...) y sentimiento.                                                                                                                                       |
| `trend`                | `[{cycleId, cycleName, periodEnd, ...conteo}]`                                             | Todos los ciclos; anonimizado: solo ciclos con ≥ mínimo de personas.                                                                                                                                                                                                                        |
| `topThemes`            | `[{theme, count, other, sentiment, quotes[]}]`                                             | Temas más frecuentes con hasta 3 citas seudonimizadas (`[P1]`, `[E1]`); `sentiment` es el conteo de sus comentarios (`total` = `count`; opcional, minor 2). Vocabulario inicial: `proyecto`, `equipo`, `comunicacion`, `crecimiento`, `cultura`, `procesos`, `bienestar`, `reconocimiento`. |
| `suppressed`           | entero                                                                                     | Comentarios fuera del desglose.                                                                                                                                                                                                                                                             |
| `bySide`               | `{self, manager}`, cada uno `{totals, sentimentByDimension, topThemes, suppressed}` o null | El mismo corte por quién escribió (relación de la evaluación `self` o `manager`, como el selector Propios / Manager de la app); `null` si ese lado no tiene comentarios etiquetados. Mismas reglas de anonimización por lado. Opcional (minor 2).                                           |

## `sections.goals` (nullable)

Los objetivos del período del ciclo (la foto de objetivos del ciclo, sin los "ya no aplica") junto a los indicadores del assessment, según el módulo de insights de objetivos (#62). `null` si el ciclo no tiene participantes. "Atrasado" (`overdue`) = en curso con fecha límite anterior al fin del período; un objetivo cerrado nunca lo es.

| Campo                   | Tipo                                                                             | Descripción                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `participantsWithGoals` | entero o null                                                                    | Personas con al menos un objetivo.                                                                                                                                                      |
| `goals` / `completed`   | entero o null                                                                    | Objetivos y completados.                                                                                                                                                                |
| `avgProgress`           | número (0-100) o null                                                            | Avance promedio de los objetivos (un decimal).                                                                                                                                          |
| `byDepartment`          | `[goalRow]`                                                                      | Por área (manager y área del snapshot).                                                                                                                                                 |
| `byManager`             | `[goalRow]`                                                                      | Por equipo; "Equipo N" si anonimizado (mismo número que en `completion.byManager`).                                                                                                     |
| `byAccount`             | `[goalRow]`                                                                      | Minor 3, opcional. Por cuenta.                                                                                                                                                          |
| `byDm`                  | `[goalRow]`                                                                      | Minor 3, opcional. Por DM; "DM N" si anonimizado (mismo número que en `completion.byDm`).                                                                                               |
| `buckets`               | `[{from, to, people, meanRetention, meanEngagement, meanPositiveShare, hidden}]` | Cinco tramos de 20 puntos del porcentaje de objetivos completados; promedio de retención y compromiso (1-5, dos decimales) y de la proporción de comentarios positivos de sus personas. |
| `withoutGoals`          | entero o null                                                                    | Personas sin objetivos en el período (no tienen tramo). `null` si anonimizado.                                                                                                          |
| `outliers`              | `{thresholds, doneButLow, behindButHigh}`                                        | Casos donde objetivos e indicadores no coinciden (ver abajo).                                                                                                                           |
| `suppressed`            | `{byDepartment, byManager, byAccount?, byDm?, buckets}`                          | Personas fuera de cada desglose (sus grupos o tramos quedan bajo el mínimo).                                                                                                            |

Los cuatro totales (`participantsWithGoals`, `goals`, `completed`, `avgProgress`) son `null` cuando la versión es anonimizada y algún desglose (`suppressed.*` > 0) tiene un grupo oculto.

`goalRow`: `{label, n, other, peopleWithGoals, goals, completed, inProgress, closed, overdue, avgProgress}`; `n` = personas (participantes) del grupo, `avgProgress` 0-100 o null sin objetivos. Anonimizado, `n` es al menos el mínimo (los grupos menores van a "Otros" o se omiten).

`buckets`: `from`-`to` en porcentaje (0-20, 20-40, ...); `people` y los promedios son `null` y `hidden` es `true` cuando anonimizado y el tramo tiene menos personas que el mínimo (un tramo vacío no oculta a nadie y queda en 0).

`outliers`: `thresholds` = `{goalsHigh, goalsLow, riskThreshold, indicatorHigh}` (porcentajes de objetivos y escala 1-5 usados). `doneButLow`: objetivos cumplidos (`>= goalsHigh`) pero retención o compromiso bajos (`<= riskThreshold`); `behindButHigh`: objetivos atrasados (`<= goalsLow`) pero ambos indicadores altos (`>= indicatorHigh`). Cada uno es `{count, people}`: con nombres, `people` lista `{personId, name, department, manager, goals, completed, completedPct, retention, engagement}` (sin emails); anonimizado, `people` está siempre vacío (el schema lo exige) y `count` es `null` si hay menos personas que el mínimo.

## `sections.people` (nullable)

`null` siempre que `anonymized` es `true` (el schema lo exige). En la versión con nombres, una fila por participante:

| Campo                          | Tipo         | Descripción                                           |
| ------------------------------ | ------------ | ----------------------------------------------------- |
| `personId`                     | uuid         | Id interno de la persona.                             |
| `displayName` / `email`        | texto        | Nombre y email laboral (puede ser null).              |
| `department` / `manager`       | texto o null | Área y nombre del manager del snapshot del ciclo.     |
| `selfStatus` / `managerStatus` | texto o null | Estado de la autoevaluación / evaluación del manager. |
| `retention` / `engagement`     | texto o null | Respuesta del manager a cada indicador (etiqueta).    |
| `positiveShare`                | 0-1 o null   | Proporción de comentarios positivos de la persona.    |
| `comments`                     | entero       | Comentarios etiquetados.                              |
