# Equivalencias Likert (valoración, retención y compromiso)

Las preguntas cerradas de Bamboo se importan con tres roles: `valued` (valoración, del lado self, 1 a 4), `retention` (retención, del manager, 1 a 5) y `engagement` (compromiso, del manager, 1 a 5; escalas de sistema `retention_1_5` y `engagement_1_5`). Retención y compromiso son solo del manager y nunca visibles para la persona evaluada. El reporte real (`assessments-report.csv`, perfil `bamboo-assessments-report`) las exporta con la **etiqueta** de la opción en inglés; el export anterior (_Employee Performance_) las traía como **letras** (A = la mejor opción). Este documento explica cómo una respuesta histórica se convierte a su valor.

## Etiquetas del reporte real

Una etiqueta cruda se compara por **etiqueta exacta** (sin mayúsculas, tildes ni puntuación final) y, si no coincide, por **palabras clave**. Por eso un nombre dentro de la etiqueta (la de retención dice "<Nombre> would be difficult to replace") no importa. Tablas (etiqueta exacta y, entre paréntesis, la palabra clave):

**`valued`** (`Employee - How well does [Company] recognize my value?`):

| Valor | Etiqueta                      | Palabra clave                |
| ----- | ----------------------------- | ---------------------------- |
| 4     | I feel I am highly valued.    | "highly valued"              |
| 3     | I sometimes feel valued.      | "sometimes"                  |
| 2     | I'm not sure others value me. | "not sure"                   |
| 1     | I don't feel valued.          | "don't / do not feel valued" |

**`retention`** (`Manager - Does [Employee] feel valued? (Performance Score)`):

| Valor | Etiqueta                                                                     | Palabra clave                      |
| ----- | ---------------------------------------------------------------------------- | ---------------------------------- |
| 5     | I would do everything I can to keep them                                     | "everything"                       |
| 4     | I would try to convince them to stay. <Nombre> would be difficult to replace | "convince", "difficult to replace" |
| 3     | I would think about it, but I would be okay either way.                      | "think about", "either way"        |
| 2     | I would wish them well.                                                      | "wish them well", "let them go"    |
| 1     | I would be relieved.                                                         | "relieved"                         |

**`engagement`** (`Manager - How engaged is [Employee]? (Engagement Score)`):

| Valor | Etiqueta                                    | Palabra clave (al principio)                    |
| ----- | ------------------------------------------- | ----------------------------------------------- |
| 5     | Highly engaged and a great attitude.        | "highly engaged"                                |
| 4     | Engaged and a good attitude.                | "engaged"                                       |
| 3     | Medium engagement and an okay attitude.     | "medium engagement", "somewhat engaged"         |
| 2     | Low engagement and a poor attitude.         | "low engagement", "not very engaged"            |
| 1     | Not engaged at all and a negative attitude. | "not engaged", "no engagement" (o "disengaged") |

De todas, el PRD solo confirma: "I feel I am highly valued." = 4, "I sometimes feel valued.", "… convince them to stay. <Nombre> would be difficult to replace" = 4, "Highly engaged…" = 5 y "Medium engagement and an okay attitude." = 3. Las demás etiquetas de valoración (1 a 3) y de retención y compromiso son **derivadas**: hay que contrastarlas con un export real con `pnpm reports:inspect <archivo> --values`, que imprime los valores distintos (con su conteo) de las columnas cerradas. Una etiqueta que no mapea se guarda cruda y se registra en `answer_quality_issue` (ver "Opciones sin equivalencia").

`Employee - What would help me do my best work?` **no es Likert**: es una pregunta de opción única. Cada opción se guarda con un código que es el slug de la etiqueta (`nothing_i_have_all_i_need`, `the_company_direction_or_purpose_was_bett…`, etc.). Una opción "Other" (o "Other Comentario:") conserva el texto que sigue.

## Letras (export anterior)

Por rol y por cantidad de opciones de la pregunta original:

| Opción | Retención y compromiso, 5 opciones (A-E) | Retención y compromiso, 4 opciones (A-D) | Valoración, 4 opciones (A-D) |
| ------ | ---------------------------------------- | ---------------------------------------- | ---------------------------- |
| A      | 5                                        | 5                                        | 4                            |
| B      | 4                                        | 4                                        | 3                            |
| C      | 3                                        | 2                                        | 2                            |
| D      | 2                                        | 1                                        | 1                            |
| E      | 1                                        | (sin equivalencia)                       | (sin equivalencia)           |

Con 4 opciones, retención y compromiso no tienen punto medio: se saltea el 3 (supuesto provisorio del PRD, Iteración 2). La valoración tiene 4 valores (1 a 4), sin salto.

Además de las letras, `mapLikert` acepta:

- **Números** `1`..`<cantidad de opciones>`: pasan por los mismos overrides (clave `"5:3"` o `"3"`) y, sin override, valen lo que dicen; un número fuera de `1..cantidad` queda sin equivalencia.
- **Texto de la opción** de Bamboo en inglés o español (y las etiquetas de nuestras escalas), sin importar mayúsculas ni tildes: las etiquetas del reporte real de arriba y las del texto corto. Retención, de 5 a 1: "Do everything to keep them" / "Haría todo para retenerlo", "Try to convince them to stay" / "Intentaría convencerlo de quedarse", "Need to think about it" / "Tendría que pensarlo", "Wish them well" / "Le desearía lo mejor", "Be relieved" / "Me sentiría aliviado". Compromiso, de 5 a 1: "Highly engaged" / "Muy comprometido", "Engaged" / "Comprometido", "Somewhat engaged" / "Algo comprometido", "Not very engaged" / "Poco comprometido", "No engagement, checked out" / "Sin compromiso, desconectado". Valoración, de 4 a 1: "I feel highly valued" / "Me siento muy valorado", "I sometimes feel valued" / "A veces me siento valorado", "I am not sure others value me" / "No estoy seguro de que me valoren", "I do not feel valued" / "No me siento valorado".

El valor normalizado es `(valor - 1) / (máximo - 1)` (0 a 1: `/ 4` en retención y compromiso, `/ 3` en valoración), igual que en el resto de las escalas.

## Dónde vive

- **Código (puro):** `src/modules/likert/index.ts`: `defaultLikertMappings`, `LIKERT_LABELS` y `mapLikert({ role, optionCount | options, raw }, overrides?)`, que devuelve `{ value, normalized }` o `{ unmapped: true }`.
- **Tabla `likert_mapping`:** `role`, `source_option` (la letra), `option_count`, `value`, `source` (`default` | `custom`), `updated_by`, `updated_at`; única por `(role, option_count, source_option)`. Al arrancar el servidor (`src/instrumentation.ts`) se insertan las filas por defecto que falten (`seedLikertMappings`, idempotente): nunca pisa una fila existente, así que una edición (`custom`) se conserva. El seed de la base (`pnpm db:seed --reset`) no la vacía.
- **Importación:** `src/modules/import-history` lee la tabla una vez por corrida (`loadLikertOverrides`) y se la pasa a `mapLikert` como overrides. Si la tabla está vacía rigen los valores por defecto del código.
- **Cantidad de opciones:** Bamboo no la exporta, y no se infiere de las respuestas (#132): una columna de 5 opciones donde nadie eligió E sigue siendo A-E (leerla como A-D correría la escala, C 3→2, D 2→1). Al terminar la corrida (`finishHistoryImport`) `reapplyLikertMappings` recalcula cada columna con la cantidad que declara la pregunta (`choices` de su revisión; 5 si no declara). Una pregunta de 4 opciones se declara con 4 opciones en la revisión, o se corrige con overrides en `likert_mapping`.

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

Después de cambiar la tabla, en `/data-quality/unmapped_answers` el botón **"Reaplicar equivalencias"** (solo People; `reapplyLikertMappings` en `src/modules/import-history/likert-reapply.ts`) recalcula todas las respuestas Likert ya importadas a partir de su `option_label`, sin reimportar nada: las que ahora mapean reciben valor y su caso se resuelve; las que dejan de mapear pierden el valor y abren un caso. Lo mismo se corre automáticamente al final de cada importación para los ciclos que tocó (aunque las filas no hayan cambiado).

## Opciones sin equivalencia

Una respuesta cuya opción no mapea **no se descarta ni rechaza la fila**: se guarda la respuesta con `option_label` = el valor original y `option_value` / `normalized` nulos, y se registra en `answer_quality_issue` (motivo `unmapped_option`) (`answer_id`, `request_id`, `question_revision_id`, `cycle_id`, `column_key`, `raw_value`, `reason` = `unmapped_option` | `invalid_value`, `run_id`, `created_at`, `resolved_at`). El indicador `unmapped_answers` de `/data-quality` las lista (ciclo, columna, valor original, motivo; sin nombres de personas). Cuando una importación posterior o "Reaplicar equivalencias" mapea esa respuesta, el caso queda con `resolved_at` y sale del indicador.

Una celda que la pregunta no puede tomar (por ejemplo un rating custom `7` en una escala 1-5) sigue rechazándose en la corrida como antes, y además queda registrada con motivo `invalid_value` (sin respuesta asociada, `answer_id` nulo); se resuelve cuando una importación posterior trae un valor válido.
