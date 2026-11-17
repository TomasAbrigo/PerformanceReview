# Equivalencias Likert (retención y compromiso)

Las dos preguntas cerradas del manager en Bamboo (Q1 "If [Employee] got a job offer elsewhere, I would..." y Q2 "How engaged is [Employee] at work?") se exportan en el reporte _Employee Performance_ como **letras** (A = la mejor opción). En la app son preguntas con rol `retention` y `engagement`, calificaciones Likert de 1 a 5 (escalas de sistema `retention_1_5` y `engagement_1_5`), solo del manager y nunca visibles para la persona evaluada. Este documento explica cómo una respuesta histórica se convierte a 1-5.

## Valores por defecto

Por rol (`retention` y `engagement` usan la misma tabla) y por cantidad de opciones de la pregunta original:

| Opción | 5 opciones (A-E) | 4 opciones (A-D)   |
| ------ | ---------------- | ------------------ |
| A      | 5                | 5                  |
| B      | 4                | 4                  |
| C      | 3                | 2                  |
| D      | 2                | 1                  |
| E      | 1                | (sin equivalencia) |

Con 4 opciones no hay punto medio: se saltea el 3 (supuesto provisorio del PRD, Iteración 2).

Además de las letras, `mapLikert` acepta:

- **Números** `1`..`5`: pasan tal cual.
- **Texto de la opción** de Bamboo en inglés o español (y las etiquetas de nuestras escalas), sin importar mayúsculas ni tildes. Retención, de 5 a 1: "Do everything to keep them" / "Haría todo para retenerlo", "Try to convince them to stay" / "Intentaría convencerlo de quedarse", "Need to think about it" / "Tendría que pensarlo", "Wish them well" / "Le desearía lo mejor", "Be relieved" / "Me sentiría aliviado". Compromiso, de 5 a 1: "Highly engaged" / "Muy comprometido", "Engaged" / "Comprometido", "Somewhat engaged" / "Algo comprometido", "Not very engaged" / "Poco comprometido", "No engagement, checked out" / "Sin compromiso, desconectado".

El valor normalizado es `(valor - 1) / 4` (0 a 1), igual que en el resto de las escalas.

## Dónde vive

- **Código (puro):** `src/modules/likert/index.ts`: `defaultLikertMappings`, `LIKERT_LABELS` y `mapLikert({ role, optionCount | options, raw }, overrides?)`, que devuelve `{ value, normalized }` o `{ unmapped: true }`.
- **Tabla `likert_mapping`:** `role`, `source_option` (la letra), `option_count`, `value`, `source` (`default` | `custom`), `updated_by`, `updated_at`; única por `(role, option_count, source_option)`. Al arrancar el servidor (`src/instrumentation.ts`) se insertan las filas por defecto que falten (`seedLikertMappings`, idempotente): nunca pisa una fila existente, así que una edición (`custom`) se conserva. El seed de la base (`pnpm db:seed --reset`) no la vacía.
- **Importación:** `src/modules/import-history` lee la tabla una vez por corrida (`loadLikertOverrides`) y se la pasa a `mapLikert` como overrides. Si la tabla está vacía rigen los valores por defecto del código.

## Cómo cambiar una equivalencia

Hasta que exista la pantalla de settings (otra issue), se edita la tabla directamente en la base local:

```sql
-- Con 4 opciones, que C valga 3 para compromiso
update likert_mapping
set value = 3, source = 'custom', updated_by = 'people', updated_at = now()
where role = 'engagement' and option_count = 4 and source_option = 'C';

-- Una letra nueva (p. ej. F en preguntas de 5 opciones de retención)
insert into likert_mapping (role, source_option, option_count, value, source, updated_by)
values ('retention', 'F', 5, 1, 'custom', 'people');
```

Los overrides en código tienen la forma `Record<role, Record<string, number>>`: la clave es `"<cantidad>:<opción>"` (la que genera la tabla, p. ej. `"4:C"`) o solo `"<opción>"` (cualquier cantidad); la primera gana. Un valor fuera de 1..5 cuenta como sin equivalencia.

Los cambios valen para las importaciones siguientes. Una fila del reporte que no cambió (mismo hash) no se reescribe: para recalcular respuestas ya importadas hay que reimportar el archivo con las filas modificadas o reprocesar la corrida.

## Opciones sin equivalencia

Una respuesta cuya opción no mapea **no se descarta ni rechaza la fila**: se guarda la respuesta con `option_label` = el valor original y `option_value` / `normalized` nulos, y se registra en `answer_quality_issue` (`answer_id`, `request_id`, `question_revision_id`, `cycle_id`, `column_key`, `raw_value`, `reason` = `unmapped_option` | `invalid_value`, `run_id`, `created_at`, `resolved_at`). El indicador `unmapped_answers` de `/data-quality` las lista (ciclo, columna, valor original, motivo; sin nombres de personas). Cuando una importación posterior mapea esa respuesta, el caso queda con `resolved_at` y sale del indicador.
