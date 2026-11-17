# Schema `arturia-report.v1`

Contrato del JSON que genera `pnpm export:arturia` (zod: `arturiaReportV1` en `src/modules/arturia-report/schema.ts`). El HTML embebe exactamente este JSON.

## Versionado

- `schemaVersion` es siempre `"arturia-report.v1"` en esta versión.
- `schemaMinor` (entero) sube con cada **cambio aditivo**: campo opcional nuevo, sección nueva, valor nuevo en un campo de texto libre. Un consumidor de v1 debe ignorar campos que no conoce.
- Un **cambio incompatible** (renombrar o quitar un campo, cambiar su tipo o significado) es `arturia-report.v2`.
- Una sección `null` significa "no disponible en este build" (el dato todavía no se calcula), no "cero".

## Raíz

| Campo           | Tipo                                 | Descripción                                                                     |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `schemaVersion` | `"arturia-report.v1"`                | Versión mayor del formato.                                                      |
| `schemaMinor`   | entero ≥ 0                           | Versión menor (cambios aditivos). Hoy `0`.                                      |
| `generatedAt`   | ISO 8601 (UTC)                       | Momento de generación.                                                          |
| `cycle`         | `{id, name, periodStart, periodEnd}` | Ciclo: uuid, nombre, fechas `YYYY-MM-DD`.                                       |
| `anonymized`    | boolean                              | `true`: versión anonimizada (sin `people`, sin emails ni nombres).              |
| `minGroupSize`  | entero > 0                           | Setting `aggregation.minGroupSize` vigente. Solo se aplica cuando `anonymized`. |
| `sections`      | objeto                               | Ver abajo.                                                                      |

Regla de anonimización: en toda serie agrupada, los grupos con `n < minGroupSize` (y el grupo sin nombre, p. ej. sin área) se juntan en uno `"Otros"` (`other: true`); si "Otros" sigue bajo el mínimo se omite y sus personas se cuentan en `suppressed`. Para grupos que se solapan (dimensiones, temas) el `n` de "Otros" es el máximo de los grupos (cota conservadora). Los managers se rotulan `"Equipo 1..N"` (orden estable por id dentro del informe). En la versión con nombres el mínimo es 1.

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

| Campo            | Tipo                                                  | Descripción                                                   |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `byRelationship` | `[{relationship, total, submitted, draft, declined}]` | Totales por tipo de evaluación.                               |
| `byDepartment`   | `[{label, relationship, n, total, submitted, other}]` | Por área y tipo; `n` = solicitudes de ese tipo en el grupo.   |
| `byManager`      | idem                                                  | Por equipo (manager del snapshot); "Equipo N" si anonimizado. |
| `suppressed`     | entero                                                | Solicitudes fuera del desglose.                               |

## `sections.indicators` (nullable)

| Campo          | Tipo                                                                             | Descripción                                                                                |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `distribution` | `[{indicator, groups: [{label, n, mean, counts[5], other}], total, suppressed}]` | Retención y compromiso (Likert 1-5) por área; `total` null bajo el mínimo.                 |
| `riskMatrix`   | `{cells: [{retention, engagement, count, risk}], total, riskCount}` o null       | 9 celdas, bandas `low/mid/high`; `count` null bajo el mínimo.                              |
| `alerts`       | `[{kind, indicator, count}]`                                                     | Alertas contadas (`drop` por indicador, `risk`); nunca personas. Bajo el mínimo se omiten. |

## `sections.qualitative` (nullable)

| Campo                  | Tipo                                                                         | Descripción                                                             |
| ---------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `sentimentByDimension` | `[{dimension, positive, constructive, negative, total, other}]`              | Comentarios por dimensión y sentimiento.                                |
| `trend`                | `[{cycleId, cycleName, periodEnd, positive, constructive, negative, total}]` | Todos los ciclos; anonimizado: solo ciclos con ≥ mínimo de personas.    |
| `topThemes`            | `[{theme, count, other, quotes[]}]`                                          | Temas más frecuentes con hasta 3 citas seudonimizadas (`[P1]`, `[E1]`). |
| `suppressed`           | entero                                                                       | Comentarios fuera del desglose.                                         |

## `sections.goals` (nullable)

| Campo                   | Tipo                                                 | Descripción              |
| ----------------------- | ---------------------------------------------------- | ------------------------ |
| `participantsWithGoals` | entero                                               | Personas con objetivos.  |
| `goals` / `completed`   | entero                                               | Objetivos y completados. |
| `avgProgress`           | número (0-100) o null                                | Avance promedio.         |
| `byDepartment`          | `[{label, n, goals, completed, avgProgress, other}]` | Por área.                |

Hoy siempre `null` (pendiente de #62).

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
