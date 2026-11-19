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

| Sección       | Módulo                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `executive`   | `analytics/dashboards` (`executiveSummary`: participantes y distribución de calificaciones) y `analytics/completion` (el avance de `self` y `manager`) |
| `completion`  | `analytics/completion` (`completionOverview`, `completionSummary`): Assessment Progress, si no las solicitudes                                         |
| `indicators`  | `analytics/indicators`                                                                                                                                 |
| `goals`       | `analytics/goals-insights` (`goalInsights`, `goalKpis`): KPIs por área y equipo, tramos, casos atípicos                                                |
| `qualitative` | `qualitative-analysis`                                                                                                                                 |

**Fecha de corte de los vencidos:** "vencido" es un objetivo en curso con fecha límite anterior a `goals.asOf`: hoy mientras el período del ciclo corre, el último día del período una vez que el ciclo está cerrado (la foto de objetivos queda congelada ahí; la regla única está en `src/modules/goals/state.ts`, `goalAsOf`). El informe lleva esa fecha y el HTML la muestra.

Anonimizado, los temas cualitativos no llevan citas textuales (`quotes` vacío, #129): un texto puede delatar a quien lo escribió aunque se reemplacen los nombres.

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

El HTML no hace ningún request externo (sin `http(s)://`, ni `src`/`href`/`url()` salvo anclas `#` y `data:`; lo verifica un test). Tiene un selector "Todo / Cuantitativo / Cualitativo" que muestra u oculta secciones con JS puro. Los textos salen del namespace `Arturia` de `src/messages/{es,en}.json`.

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
