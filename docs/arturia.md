# Export para Arturía

Informe de desempeño de un ciclo para publicar como mini app en Arturía. Se genera localmente con `pnpm export:arturia` y se sube a mano.

## Flujo de actualización (manual)

1. **Exportar de Bamboo** los reportes del ciclo (Employee Performance, Assessment Progress, Feedback Status) y guardarlos en `data/private/` (nunca en el repo; ver README "Datos sensibles").
2. **Importar** cada archivo en `/imports/upload` (o con `pnpm ingest`), revisar la cola de identidad en `/imports/identity`. Los goals entran por la ingesta de la API de Bamboo (`pnpm ingest:goals`), antes de importar el Employee Performance: el ciclo toma el snapshot de goals de cada participante cuando se crea (el reporte Goal Status solo aterriza en `raw_record`).
3. **Analizar** los comentarios en `/insights/qualitative` (o `pnpm analysis:run`), corregir etiquetas si hace falta.
4. **Exportar**:
   - `pnpm export:arturia --cycle latest` → versión con datos personales (uso interno de People).
   - `pnpm export:arturia --cycle latest --anonymized` → versión anonimizada.
   - `--cycle` acepta el id, el nombre exacto del ciclo o `latest`; `--out <dir>` cambia la carpeta; `--locale es|en` el idioma (default `es`).
5. **Subir a Arturía** el archivo que corresponda (ver preguntas abiertas: cuál de las dos versiones y cómo).

De dónde sale cada sección (el informe reusa los módulos de analytics: la versión con nombres corre como People y la anonimizada como dirección con el mínimo del informe, ver [arturia-schema.md](arturia-schema.md)):

| Sección       | Módulo                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executive`   | `analytics/dashboards` (`executiveSummary`: participantes y distribución de calificaciones) y `analytics/completion` (el avance de `self` y `manager`)   |
| `completion`  | `analytics/completion` (`completionOverview`, `completionSummary`): Assessment Progress, si no las solicitudes                                           |
| `indicators`  | `analytics/indicators`                                                                                                                                   |
| `goals`       | `analytics/goals-insights` (`goalInsights`, `goalKpis`): KPIs por área y equipo, tramos, casos atípicos                                                  |
| `qualitative` | `qualitative-analysis/reading.ts` (las mismas funciones que `/insights/qualitative`): lectura por persona, procedencia, sustancia, temas, señales, Sí/No |

**Fecha de corte de los vencidos:** "vencido" es un objetivo en curso con fecha límite anterior a `goals.asOf`: hoy mientras el período del ciclo corre, el último día del período una vez que el ciclo está cerrado (la foto de objetivos queda congelada ahí; la regla única está en `src/modules/goals/state.ts`, `goalAsOf`). El informe lleva esa fecha y el HTML la muestra.

**El cualitativo** (#129) es la lectura de las respuestas abiertas por **persona** (no por respuesta; la autoevaluación y el manager nunca se mezclan) y dice lo mismo que `/insights/qualitative` para ese ciclo: procedencia de las etiquetas (proveedor, modelo, última corrida, % corregido por personas; si son del mock, el informe dice «Lectura de demostración»), sustancia del feedback, temas de fortalezas y de mejora, coincidencia persona–manager y puntos ciegos, señales (con cortes por área, cuenta y DM, y cruzadas con la retención y el compromiso que respondió el manager), preguntas Sí/No (por pregunta, por grupo y por ciclo; seguridad de la información = No y conversaciones frecuentes = No como alerta), preguntas cerradas (valoración 1–4, por grupo y por ciclo, y «mejor trabajo») y, aparte y como secundario, el tono. Cada bloque lleva su n en personas. El HTML nombra preguntas, temas y señales en el idioma del informe; nunca muestra una clave cruda. Si el ciclo todavía no se analizó (`pnpm analysis:run`), la sección sale `null`.

Anonimizado, el cualitativo trae solo agregados: ninguna cita textual (`quotes` siempre vacío, #129: un texto puede delatar a quien lo escribió aunque se reemplacen los nombres), ninguna cifra de menos personas que `minGroupSize` ni que se pueda despejar de las demás (por ejemplo, un «No» de 3 personas no se publica, ni el «Sí» que lo daría), y los grupos chicos de los cortes por área, cuenta y DM se juntan en «Otros» (una tabla grupo × respuesta que ni así se puede proteger sale sin grupos). El detalle está en [arturia-schema.md](arturia-schema.md).

Anonimizado, los casos atípicos de objetivos solo se cuentan (y solo desde el mínimo); con nombres se listan con sus valores en `goals.outliers`.

El CLI imprime solo rutas y cantidades, nunca nombres. Código de salida: 0 ok, 1 falló, 2 argumentos inválidos.

## Archivos

Por defecto en `data/private/arturia/<ciclo-slug>/` (ignorado por git):

| Archivo                  | Contenido                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `report.json`            | Informe completo con la sección `people` (nombre, email, área, manager, estados, indicadores). Solo para People.                  |
| `report.html`            | El mismo informe como página única: CSS, JS, datos (`<script type="application/json" id="report">`) y gráficos SVG inline.        |
| `report.anonymized.json` | Sin `people`, sin emails, sin nombres; grupos con menos de `aggregation.minGroupSize` personas en "Otros"; equipos "Equipo 1..N". |
| `report.anonymized.html` | La página de la versión anonimizada.                                                                                              |

El HTML no hace ningún request externo (sin `http(s)://`, ni `src`/`href`/`url()` salvo anclas `#` y `data:`; lo verifica un test). Tiene un selector "Todo / Cuantitativo / Cualitativo" que muestra u oculta secciones con JS puro. Los textos salen del namespace `Arturia` de `src/messages/{es,en}.json` y, los de la lectura cualitativa (nombres de preguntas, temas, señales, sustancia y sus títulos), de `src/modules/arturia-report/labels.ts` (es y en, con un test de paridad).

El formato del JSON está documentado en [arturia-schema.md](arturia-schema.md).

## Preguntas abiertas

Sin respuesta todavía; no asumir nada hasta confirmarlo con el equipo de Arturía:

- **Tamaño máximo** del archivo/paquete de una mini app.
- **Scripts y CSP**: ¿se permite JS inline? ¿hay Content-Security-Policy que bloquee `<script>` o `<style>` inline o SVG inline?
- **Formato de entrega**: ¿un HTML único, un zip, o la mini app consume el JSON?
- **Autenticación y acceso**: ¿quién puede ver la mini app? ¿se puede restringir por rol (People vs. dirección)? ¿Se puede subir la versión con datos personales o solo la anonimizada?
- **Hosting y retención**: dónde quedan alojados los datos, por cuánto tiempo, y cómo se borra una versión.
- **Cadencia de actualización**: cada cuánto se espera un informe nuevo (por ciclo, semestral, mensual) y si se reemplaza o se acumula historial.
- **Idioma**: ¿solo español o también inglés?
