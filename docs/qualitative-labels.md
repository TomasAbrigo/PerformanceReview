# Importar etiquetas cualitativas (CSV)

Etiquetas de sentimiento y temas hechas fuera de la app (una planilla, otra herramienta) se importan como proveedor `import` desde `/insights/qualitative` (People) o con:

```bash
pnpm analysis:import-labels fixtures/qualitative-labels/small.csv
```

## Formato

CSV UTF-8 (con o sin BOM), separador coma, comillas RFC 4180, primera fila con los encabezados (sin importar mayúsculas). Una fila por comentario.

| Columna         | Obligatoria                             | Qué es                                                                                                                                           |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `employee_name` | una de las dos                          | Nombre de la persona evaluada, como en la app (sin importar tildes ni mayúsculas).                                                               |
| `bamboo_id`     | una de las dos                          | Id de empleado de Bamboo; si viene, gana sobre el nombre.                                                                                        |
| `review_cycle`  | sí                                      | Nombre del ciclo, como en la app.                                                                                                                |
| `text`          | una de `text`, `text_hash`, o dimensión | El comentario, tal cual (se compara por hash normalizado: minúsculas, sin tildes, espacios colapsados).                                          |
| `text_hash`     |                                         | sha256 hex del texto normalizado, en vez de `text` (para no mover el contenido).                                                                 |
| `dimension`     |                                         | Clave de la dimensión de la pregunta (`strengths`, `improvement`, `valued`, `best_work`, `custom_<n>`, `other`...). Se usa si el texto no cruza. |
| `question`      |                                         | Texto de la pregunta, en vez de `dimension` (se deriva la dimensión).                                                                            |
| `sentiment`     | sí                                      | Uno de los cinco: positivo, constructivo, neutral, mixto o negativo (ver abajo).                                                                 |
| `confidence`    | no                                      | 0 a 1.                                                                                                                                           |
| `themes`        | no                                      | Temas separados por `;` (se normalizan: minúsculas, sin tildes).                                                                                 |

### Sentimientos

Se aceptan en español o inglés, sin importar mayúsculas ni tildes:

| Valor guardado | Se acepta como                 |
| -------------- | ------------------------------ |
| `positive`     | `positive`, `Positivo`         |
| `constructive` | `constructive`, `Constructivo` |
| `neutral`      | `neutral`, `Neutro`            |
| `mixed`        | `mixed`, `Mixto`               |
| `negative`     | `negative`, `Negativo`         |

Cualquier otro texto deja la fila sin cruzar (`invalid_sentiment`).

## Cómo cruza

1. Se buscan los comentarios sobre esa persona (como evaluada) en ese ciclo: los abiertos y las respuestas a preguntas cerradas con dimensión (su texto es la etiqueta de la opción elegida), salvo que el setting `analysis.includeClosed` esté apagado.
2. Entre ellos, el que tiene el mismo hash de texto normalizado.
3. Si ninguno coincide, el único comentario de esa dimensión; si hay más de uno, la fila queda **sin cruzar** (`ambiguous`): nunca se adivina.

Las filas que no cruzan (`missing_fields`, `invalid_sentiment`, `unknown_person`, `unknown_cycle`, `no_match`, `ambiguous`) se devuelven con su número de fila y se muestran en pantalla o en la consola. Cada importación deja una corrida en `analysis_run` (proveedor `import`, filas totales y cruzadas). Reimportar el mismo archivo actualiza las mismas etiquetas. Una corrección humana posterior siempre gana sobre lo importado.

## Ejemplo

`fixtures/qualitative-labels/small.csv` (datos sintéticos del fixture `small`):

```csv
employee_name,review_cycle,dimension,text,sentiment,confidence,themes
Adrián Bustos,Evaluación semestral 2024-H1,improvement,Quiero delegar más y no cargar con todo.,constructive,0.85,liderazgo;planificacion
```
