# Atributos organizacionales (cuenta, proyecto, DM, Santex Lead)

People mantiene un archivo con la **cuenta**, el **proyecto**, el **DM** (delivery manager) y el **Santex Lead** de cada persona, con vigencia. Bamboo no tiene esos datos: el archivo es la fuente y esta app, el sistema de registro después de importarlo. Con él, todas las vistas de insights pueden **filtrar y agrupar** por esos cortes y existe la vista **Análisis 360** por DM (`/insights/360`).

## El archivo

CSV o XLSX, una fila por persona y tramo de vigencia. Se sube en `/imports/upload` (el perfil `org-attributes` se elige solo cuando el archivo tiene la columna `EEID` y no es uno de los reportes de Bamboo) o por código con `importReportFile(db, { path, profile: "org-attributes" })`.

| Columna       | Alias en inglés | Obligatoria | Qué es                                                                                                                                           |
| ------------- | --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EEID`        |                 | sí          | Id de Bamboo de la persona (el `bamboo_id` de la identidad). Es la clave: una fila sin EEID se rechaza.                                          |
| `Nombre`      | `Name`          | no          | Solo para proponer candidatos en la cola de identidad cuando el EEID no coincide con nadie.                                                      |
| `Cuenta`      | `Account`       | no          | Texto libre (se agrupa y filtra por el texto exacto, sin espacios sobrantes).                                                                    |
| `Proyecto`    | `Project`       | no          | Idem.                                                                                                                                            |
| `DM`          |                 | no          | Nombre ("Nombre Apellido" o "Apellido, Nombre"), EEID, legajo o email de quien es DM de la persona.                                              |
| `Santex Lead` |                 | no          | Idem.                                                                                                                                            |
| `Desde`       | `From`          | no          | Primer día en que vale (ISO `2025-03-29`, o `29/03/2025` día primero: el perfil lleva `dateFormat: dmy`). Vacío: "desde siempre" (`1900-01-01`). |
| `Hasta`       | `To`            | no          | Último día en que vale, **inclusive**. Vacío: sigue vigente.                                                                                     |

Una fila necesita al menos un valor entre Cuenta, Proyecto, DM y Santex Lead (si no, se rechaza con el motivo). Las columnas que el archivo no trae simplemente no aportan ese corte.

Ejemplo (persona que cambió de cuenta el 1/4/2025):

```csv
EEID,Nombre,Cuenta,Proyecto,DM,Santex Lead,Desde,Hasta
11,Ana Prieto,Cuenta A,Proyecto A1,Marta Quiroga,Nora Salas,2024-01-01,2025-03-31
11,Ana Prieto,Cuenta B,Proyecto B1,"Salas, Nora",Nora Salas,2025-04-01,
```

### Mapeo configurable

Los encabezados son la configuración del perfil: `src/modules/lake/profiles.ts` (`ORG_ATTRIBUTE_COLUMNS`) mapea cada encabezado al campo canónico (`employee_bamboo_id`, `employee_name`, `account`, `project`, `dm`, `santex_lead`, `valid_from`, `valid_to`). Si el archivo de People usa otros encabezados, en el paso de vista previa se parte del perfil `org-attributes` y se guarda uno propio con otro mapeo (los perfiles guardados viven en la carpeta de perfiles, ver el README, "Perfiles de fuente"): no hace falta tocar código.

## Qué hace la importación

- **Idempotente.** Una fila del archivo son hasta cuatro atributos (uno por cuenta, proyecto, DM y Santex Lead). La clave de cada uno es (persona, tipo, `Desde`): el mismo archivo otra vez no cambia nada (`Sin cambios`), corregir un valor o un `Hasta` lo actualiza, y una fila con otro `Desde` es un tramo nuevo. Una celda que se vacía da de baja ese atributo (`deleted_at`) y si vuelve se reactiva. Las filas que dejan de venir en un archivo no se borran: para cerrar un tramo se pone su `Hasta`.
- **Identidad por EEID.** El EEID se busca entre los `bamboo_id` de las personas. Si no coincide con nadie, la fila va a la **cola de identidad** (`/imports/identity`, entidad "Atributos organizacionales") y no se pierde: vincularla a una persona la aplica a esa persona y en importaciones posteriores se reconoce sola; si la persona llega después, la próxima importación la aplica y cierra el caso.
- **DM y Santex Lead como personas.** Además del texto, se guarda a qué persona resuelve (`ref_person_id`): por EEID, legajo o email, o por nombre en cualquier orden de "Nombre Apellido" / "Apellido, Nombre" si hay una sola persona con ese nombre. Si no se puede resolver (o hay homónimos) el texto igual agrupa y filtra; lo que se pierde es "Todo el árbol" y que ese DM vea su tarjeta como manager.
- La tabla es `person_org_attribute` (migración 0026): `person_id`, `kind` (`account` | `project` | `dm` | `santex_lead`), `value`, `valid_from`, `valid_to`, `ref_person_id` y las columnas de origen de toda tabla (`source_system` = `lake`, `source_id` = `[EEID, Desde]#tipo`, corrida y hash). Única por (`person_id`, `kind`, `valid_from`).

## Cómo se leen: a la fecha del snapshot

Cada participante lleva los atributos **vigentes en la fecha de snapshot de su ciclo** (`cycle_participant.snapshot_as_of`; con la jerarquía "actual", hoy): `valid_from <= fecha` y (`valid_to` vacío o `>= fecha`). Si dos tramos se solapan gana el que empezó más tarde. Eso vive en un solo lugar, `scopedCtes` (`src/modules/analytics/dashboards/scope.ts`, con `orgAttributeJoins` de `src/modules/org-attributes/sql.ts`): `scoped` trae `account`, `project`, `dm`, `santex_lead` y las personas a las que resuelven DM y Santex Lead, y todos los módulos los heredan.

## Cortes en las vistas

| Vista                                                       | Filtros (parámetros de la URL)           | Agrupar por (`groupBy`)                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Completitud (`/insights/completion`), indicadores, goals    | `account`, `project`, `dm`, `santexLead` | `account`, `project`, `dm`, `santex_lead`                                                                 |
| Cualitativo (`/insights/qualitative`)                       | los mismos                               | panel "Sentimiento por grupo": área, cuenta, proyecto, DM, Santex Lead                                    |
| Vista ejecutiva (`/insights/executive`)                     | los mismos (solo People)                 | no aplica: cada bloque ya tiene su propio desglose                                                        |
| Exports CSV (`insights-*.csv`, `insights-sentiment-by.csv`) | los mismos parámetros                    | `groupBy` con los mismos valores                                                                          |
| Informe para Arturía (`pnpm export:arturia`)                | no aplica                                | `byAccount` y `byDm` en completitud, indicadores y objetivos (ver [arturia-schema.md](arturia-schema.md)) |

Los selectores salen de un solo componente (`src/components/org/org-filter-fields.tsx`): solo muestra los cortes que tienen valores, así una instalación sin archivo cargado no ve nada nuevo.

### Quién ve qué (autorización y mínimo n intactos)

- **People:** todo, con nombres.
- **Manager:** solo sus reportes directos del snapshot, también al cortar por un atributo.
- **Dirección:** solo agregados. Los grupos con menos de `aggregation.minGroupSize` personas se pliegan en "Otros" (o se ocultan y se cuentan aparte si "Otros" también queda bajo el mínimo). Un DM o Santex Lead es una persona: dirección ve **equipos** con una clave opaca estable y sin nombre (como los managers), nunca el nombre; los selectores de dirección no ofrecen DM ni Santex Lead. Cuenta y proyecto no son personas y se ven con su nombre. En completitud y en la vista ejecutiva dirección no filtra: ve el ciclo entero (en indicadores, goals y cualitativo sí puede filtrar, siempre con el mínimo aplicado).
- Empleados: sin acceso.

## Análisis 360 (`/insights/360`)

Una tarjeta por DM con las personas a su cargo en el ciclo elegido:

- cantidad de personas, **retención** y **compromiso** medios (los que puso el manager, sobre cuántas personas), **% en riesgo** (ambos indicadores en el umbral de riesgo o menos, sobre quienes tienen los dos), **sentimiento** de los comentarios abiertos (cinco sentimientos, % de cada uno) y cuántos comentarios, % de **autoevaluaciones y evaluaciones del manager completas** y una **evolución por ciclo** (sparkline SVG de retención y compromiso de los últimos ocho ciclos);
- una **lectura** en texto, por reglas fijas y sin modelo (`insightsOf`, `src/modules/analytics/dm-360/derive.ts`): caída de retención o compromiso de al menos `alerts.dropThreshold` puntos contra el último ciclo que tuvo media, comentarios negativos desde el 30 % (con al menos 3 comentarios), personas en riesgo desde el 25 % (con al menos 3 con ambos indicadores), evaluaciones del manager completas por debajo del 50 %, o "sin alertas" / "sin datos suficientes". Los textos son claves de mensajes (`Insights360.insight.*`); el riesgo usa el setting `alerts.riskThreshold`.
- **Alcance:** "Reportes directos" (personas cuyo DM del archivo es ese DM) o "Todo el árbol" (además, todos los que están debajo del DM en el organigrama a la fecha de snapshot del ciclo; el DM tiene que resolver a una persona).
- **Quién la ve:** People todas las tarjetas; un **manager** solo la suya, si figura como DM en el archivo (con sus reportes directos del snapshot que el archivo pone bajo su nombre); dirección los agregados descriptos arriba, con cada cifra oculta si se apoya en menos personas que el mínimo (también los puntos de la evolución); empleados nada.

## Fixtures y seed

`pnpm fixtures:build` genera `fixtures/org/{small,demo}/org-attributes.csv` a partir de la empresa sintética (determinista): algunas cuentas con dos proyectos, un DM (un manager de la empresa) y un Santex Lead por cuenta, la gente en la cuenta de su manager cuando es DM, y alrededor de uno de cada seis cambia de cuenta (dos filas con `Hasta`). `pnpm db:seed` lo importa después de los reportes (se saltea con `--no-reports`) y `--reset` vacía la tabla (`RESET_TABLES`).
