# Engagement mensual

El engagement mensual (score de 0 a 1 y segmento por persona y mes) **no viene de Bamboo**: People lo recibe de otra fuente, por archivo. Esta app lo importa, es el sistema de registro después de importarlo y lo muestra en `/insights/engagement` y en el bloque "Engagement mensual" de la vista ejecutiva (`/insights/executive`, modos cuantitativo y ambos). El informe para Arturía lo incluye desde `schemaMinor` 4 (ver [arturia-schema.md](arturia-schema.md)).

No confundir con el **compromiso (engagement) de Bamboo** (`Manager - How engaged is [Employee]? (Engagement Score)`, escala 1-5, una vez por ciclo): son indicadores distintos que conviven en la app.

## El archivo

CSV o XLSX, una fila por persona y mes. Se sube en `/imports/upload` con el perfil incorporado `engagement-monthly`, o por código con `importReportFile(db, { path, profile: "engagement-monthly" })`. Hay un ejemplo sintético en `fixtures/engagement/{small,demo}/engagement-monthly.csv`.

| Columna    | Obligatoria    | Qué es                                                                                                                                                           |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EEID`     | sí             | Id de Bamboo de la persona (el `bamboo_id` de la identidad). Una fila sin EEID se rechaza.                                                                       |
| `Mes`      | sí             | `YYYY-MM` (`2026-03`) o `MM/YYYY` (`03/2026`); también se acepta una fecha completa y se toma su mes. Una fila sin mes, o con algo que no es un mes, se rechaza. |
| `Score`    | una de las dos | Número de 0 a 1 (`0.73`, o `0,73` como lo escribe una planilla en español). Fuera de 0-1 o no numérico: la fila se rechaza.                                      |
| `Segmento` | una de las dos | `Alto`, `Medio`, `Regular`, `Bajo` o `Falta` (cualquier mayúscula; también `High`, `Medium`, `Low` y `Missing`).                                                 |
| `Nombre`   | no             | Solo para proponer candidatos en la cola de identidad cuando el EEID no coincide con nadie.                                                                      |

Cada fila necesita `Score` o `Segmento` (o ambos); si no trae ninguno se rechaza. Ejemplo:

```csv
EEID,Nombre,Mes,Score,Segmento
11,Ana Prieto,2026-01,0.85,Alto
11,Ana Prieto,2026-02,0.55,Regular
12,Bruno Soler,2026-01,,Falta
```

### Segmento: el del archivo, o calculado

- Si la fila trae `Segmento`, **ese es el segmento** (el archivo manda, aunque no coincida con los cortes).
- Si no lo trae, se **calcula del score** con los cortes de la configuración de insights (`/settings/insights`, sección "Engagement mensual", solo People): `Alto` desde `engagement.cutoffAlto` (80), `Medio` desde `engagement.cutoffMedio` (60), `Regular` desde `engagement.cutoffRegular` (40), por debajo `Bajo`. Son porcentajes del score (0,80 = 80) y tienen que bajar de Alto a Medio y de Medio a Regular. Cambiar los cortes aplica a lo que se importe después: para recalcular meses ya importados hay que volver a subir el archivo (una fila con un segmento distinto se actualiza).
- `Falta` es quien no respondió ese mes: **no tiene score** aunque la celda diga otra cosa (se guarda `null`). Una fila con solo `Segmento` (sin score) se guarda con ese segmento y sin score.

### Mapeo configurable

Los encabezados son la configuración del perfil: `src/modules/lake/profiles.ts` (`ENGAGEMENT_COLUMNS`). Si la fuente usa otros encabezados, en la vista previa de `/imports/upload` se parte del perfil `engagement-monthly` y se guarda uno propio con otro mapeo.

## Qué hace la importación

- **Idempotente.** La clave de una fila es (persona, mes): el mismo archivo otra vez no cambia nada (`Sin cambios`), corregir un score o un segmento lo actualiza, y un mes escrito de dos maneras (`03/2026` y `2026-03`) es la misma fila.
- **El archivo agrega y corrige meses, nunca borra.** A diferencia del archivo de atributos organizacionales, lo que un archivo posterior no lista se queda como estaba: se puede subir el mes nuevo solo.
- **Identidad por EEID.** El EEID se busca entre los `bamboo_id` de las personas. Si no coincide con nadie, la fila va a la **cola de identidad** (`/imports/identity`, entidad "Engagement mensual") y no se pierde: vincularla a una persona la aplica a esa persona y en importaciones posteriores se reconoce sola; si la persona llega después, la próxima importación la aplica y cierra el caso.
- La tabla es `engagement_monthly` (migración 0027): `person_id`, `month` (el día 1 del mes), `score` (`numeric(5,4)`, 0 a 1, null para `falta`), `segment` (`alto`, `medio`, `regular`, `bajo`, `falta`) y las columnas de origen de toda tabla. Única por (`person_id`, `month`).

## Cómo se lee

`/insights/engagement` muestra, mes a mes, dentro del rango elegido (por defecto los últimos 12 meses con datos):

- **Score promedio**: media de los scores de quienes respondieron.
- **Participación**: respondieron (cualquier segmento menos `Falta`) sobre las personas con una fila ese mes. El denominador son las personas **del archivo** ese mes, no el padrón completo de la empresa.
- **Segmentos**: cuántas personas hay en cada uno (barras apiladas al 100 %) y la tabla con todos los números.

Filtros (URL): rango de meses (`from`, `to`), área, y los cortes organizacionales (`account`, `project`, `dm`, `santexLead`). El área, la ubicación, el título y el manager de cada persona, y la cuenta/proyecto/DM/Santex Lead, se toman **al último día de cada mes** (la jerarquía y los atributos de ese momento, no los de hoy).

### Quién ve qué

| Rol       | Qué ve                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| People    | Todo, con todos los filtros.                                                                                                                    |
| Manager   | Solo sus reportes directos **de cada mes** (nunca a sí mismo ni a otros equipos), sin importar el filtro.                                       |
| Dirección | Solo agregados (ver abajo), sin filtros por DM ni Santex Lead (los selectores no se ofrecen y un parámetro de la URL que los traiga se ignora). |
| Empleado  | Nada.                                                                                                                                           |

Reglas de Dirección (`aggregation.minGroupSize`, 5 por defecto), para que ninguna celda de menos personas se pueda leer:

1. Un mes con menos personas, o menos scores, que el mínimo **no se muestra** (solo el mes, y se cuenta aparte).
2. La participación se omite cuando daría una celda chica: menos respondientes que el mínimo, o una celda `Falta` distinta de cero y por debajo del mínimo (la participación la delata).
3. Los segmentos se omiten cuando alguna celda no vacía queda bajo el mínimo. Una celda en cero no es un grupo chico.

El tile de la vista ejecutiva muestra el **último mes con datos** (score promedio con la variación en puntos frente al mes anterior, participación y segmentos) con las mismas reglas, y un enlace a la evolución.

## Pendientes y preguntas abiertas

- **De dónde sale el archivo y con qué cadencia** (quién lo genera, si trae un mes o toda la historia, si trae el segmento o solo el score): por ahora es por archivo y a mano.
- **Cortes de segmento reales**: los 80/60/40 son un supuesto; se ajustan en la configuración sin tocar código.
- **Participación**: si debe medirse contra el padrón activo del mes (y no contra las personas del archivo) hace falta decidir de dónde sale la lista de invitados.
