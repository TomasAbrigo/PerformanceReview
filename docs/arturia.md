# Export para Arturía

Informe de desempeño de un ciclo para publicar como mini app en Arturía. Se genera localmente con `pnpm export:arturia` y se sube a mano.

## Flujo de actualización (manual)

1. **Exportar de Bamboo** los reportes del ciclo (Employee Performance, Assessment Progress, Goal Status, Feedback Status) y guardarlos en `data/private/` (nunca en el repo; ver README "Datos sensibles").
2. **Importar** cada archivo en `/imports/upload` (o con `pnpm ingest`), revisar la cola de identidad en `/imports/identity`.
3. **Analizar** los comentarios en `/insights/qualitative` (o `pnpm analysis:run`), corregir etiquetas si hace falta.
4. **Exportar**:
   - `pnpm export:arturia --cycle latest` → versión con datos personales (uso interno de People).
   - `pnpm export:arturia --cycle latest --anonymized` → versión anonimizada.
   - `--cycle` acepta el id, el nombre exacto del ciclo o `latest`; `--out <dir>` cambia la carpeta.
5. **Subir a Arturía** el archivo que corresponda (ver preguntas abiertas: cuál de las dos versiones y cómo).

El CLI imprime solo rutas y cantidades, nunca nombres. Código de salida: 0 ok, 1 falló, 2 argumentos inválidos.

## Archivos

Por defecto en `data/private/arturia/<ciclo-slug>/` (ignorado por git):

| Archivo                  | Contenido                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `report.json`            | Informe completo con la sección `people` (nombre, email, área, manager, estados, indicadores). Solo para People.                  |
| `report.html`            | El mismo informe como página única: CSS, JS, datos (`<script type="application/json" id="report">`) y gráficos SVG inline.        |
| `report.anonymized.json` | Sin `people`, sin emails, sin nombres; grupos con menos de `aggregation.minGroupSize` personas en "Otros"; equipos "Equipo 1..N". |
| `report.anonymized.html` | La página de la versión anonimizada.                                                                                              |

El HTML no hace ningún request externo (sin `http(s)://`, ni `src`/`href`/`url()` salvo anclas `#` y `data:`; lo verifica un test). Tiene un selector "Todo / Cuantitativo / Cualitativo" que muestra u oculta secciones con JS puro. Los textos están en español en un único objeto `labels` (`src/modules/arturia-report/labels.ts`).

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
