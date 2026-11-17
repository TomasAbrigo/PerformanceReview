// Pure: the report as JSON and as one self-contained HTML page (inline CSS,
// JS, data and server-side SVG; no external request of any kind).
import { labels as L } from "./labels";
import type {
  ArturiaReport,
  CompletionSection,
  ExecutiveSection,
  GoalsSection,
  IndicatorsSection,
  QualitativeSection,
} from "./schema";

export function renderJson(report: ArturiaReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** HTML-escaped text; "://" is broken too so no text can become a URL. */
export const esc = (s: string | number): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/:\/\//g, ":&#47;&#47;");

/** JSON safe inside a <script> element (no "</script>", no "//"). */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\//g, "\\u002f")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const pct = (part: number, total: number) =>
  total ? `${Math.round((part / total) * 100)}%` : "–";
const num = (x: number | null, digits = 2) =>
  x === null ? "–" : x.toFixed(digits);

// ------------------------------------------------------------- SVG charts

const W = 640;
const ROW = 26;
const LABEL_W = 180;

/** Horizontal bars: one per item, value labelled at the end. */
export function svgBars(items: { label: string; value: number }[]): string {
  if (!items.length) return `<p class="muted">${esc(L.noData)}</p>`;
  const max = Math.max(1, ...items.map((i) => i.value));
  const span = W - LABEL_W - 60;
  const rows = items
    .map((it, i) => {
      const y = i * ROW;
      const w = Math.round((it.value / max) * span);
      return `<text x="${LABEL_W - 8}" y="${y + 17}" text-anchor="end">${esc(it.label)}</text><rect x="${LABEL_W}" y="${y + 5}" width="${w}" height="16" class="c0"/><text x="${LABEL_W + w + 6}" y="${y + 17}">${esc(it.value)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${items.length * ROW}" role="img" class="chart">${rows}</svg>`;
}

/** 100% stacked horizontal bars; parts share the classes c0..cN (legend apart). */
export function svgStacked(
  rows: { label: string; parts: number[] }[],
  legend: string[],
): string {
  if (!rows.length) return `<p class="muted">${esc(L.noData)}</p>`;
  const span = W - LABEL_W - 60;
  const body = rows
    .map((r, i) => {
      const y = i * ROW;
      const total = r.parts.reduce((a, b) => a + b, 0);
      let x = LABEL_W;
      const rects = r.parts
        .map((p, k) => {
          const w = total ? (p / total) * span : 0;
          const rect = `<rect x="${x.toFixed(1)}" y="${y + 5}" width="${w.toFixed(1)}" height="16" class="c${k}"><title>${esc(legend[k] ?? "")}: ${p}</title></rect>`;
          x += w;
          return rect;
        })
        .join("");
      return `<text x="${LABEL_W - 8}" y="${y + 17}" text-anchor="end">${esc(r.label)}</text>${rects}<text x="${LABEL_W + span + 6}" y="${y + 17}">${total}</text>`;
    })
    .join("");
  const keys = legend
    .map((l, k) => `<span class="key"><i class="c${k}"></i>${esc(l)}</span>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${rows.length * ROW}" role="img" class="chart">${body}</svg><div class="legend">${keys}</div>`;
}

/** Simple line (values 0-1) over labelled points. */
export function svgLine(points: { label: string; value: number }[]): string {
  if (points.length < 2) return `<p class="muted">${esc(L.noData)}</p>`;
  const H = 160;
  const pad = 30;
  const step = (W - 2 * pad) / (points.length - 1);
  const xy = points.map((p, i) => [
    pad + i * step,
    H - pad - p.value * (H - 2 * pad),
  ]);
  const path = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const marks = xy
    .map(
      ([x, y], i) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="c0"/><text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(points[i].label)}</text><text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle">${pct(points[i].value, 1)}</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" class="chart"><polyline points="${path}" class="line"/>${marks}</svg>`;
}

/** 3x3 matrix, retention (rows, high on top) × engagement (columns). */
export function svgMatrix(
  cells: NonNullable<IndicatorsSection["riskMatrix"]>["cells"],
): string {
  const bands = ["low", "mid", "high"] as const;
  const S = 70;
  const off = 90;
  const body = bands
    .flatMap((ret, r) =>
      bands.map((eng, c) => {
        const cell = cells.find(
          (x) => x.retention === ret && x.engagement === eng,
        );
        const x = off + c * S;
        const y = (2 - r) * S;
        return `<rect x="${x}" y="${y}" width="${S - 4}" height="${S - 4}" class="${cell?.risk ? "risk" : "cell"}"/><text x="${x + S / 2 - 2}" y="${y + S / 2 + 4}" text-anchor="middle">${cell?.count ?? "–"}</text>`;
      }),
    )
    .join("");
  const rowLabels = bands
    .map(
      (b, r) =>
        `<text x="${off - 8}" y="${(2 - r) * S + S / 2}" text-anchor="end">${esc(L.indicators.bands[b])}</text>`,
    )
    .join("");
  const colLabels = bands
    .map(
      (b, c) =>
        `<text x="${off + c * S + S / 2 - 2}" y="${3 * S + 14}" text-anchor="middle">${esc(L.indicators.bands[b])}</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${off + 3 * S + 10} ${3 * S + 40}" role="img" class="chart matrix">${body}${rowLabels}${colLabels}<text x="${off + 1.5 * S}" y="${3 * S + 34}" text-anchor="middle">${esc(L.indicators.engagement)}</text><text x="10" y="12">${esc(L.indicators.retention)}</text></svg>`;
}

// ---------------------------------------------------------------- sections

const binLabel = (b: { from: number; to: number }) =>
  `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`;
const rel = (r: string) => L.relationships[r] ?? r;

const section = (
  id: string,
  kind: "quantitative" | "qualitative",
  title: string,
  body: string,
) =>
  `<section id="${id}" data-kind="${kind}"><h2>${esc(title)}</h2>${body}</section>`;

const unavailable = `<p class="muted">${esc(L.notAvailable)}</p>`;
const suppressedNote = (n: number) =>
  n ? `<p class="muted">${esc(L.suppressed)}: ${n}</p>` : "";

function executiveHtml(e: ExecutiveSection): string {
  const tiles = [
    `<div class="tile"><b>${e.participants}</b><span>${esc(L.executive.participants)}</span></div>`,
    ...e.progress.map(
      (p) =>
        `<div class="tile"><b>${pct(p.submitted, p.total)}</b><span>${esc(rel(p.relationship))} (${p.submitted}/${p.total})</span></div>`,
    ),
  ].join("");
  return `<div class="tiles">${tiles}</div>
<h3>${esc(L.executive.distribution)}</h3>${svgBars(e.bins.map((b, i) => ({ label: binLabel(b), value: e.distribution[i] ?? 0 })))}
<h3>${esc(L.executive.byDepartment)}</h3>${svgStacked(
    e.byDepartment.map((d) => ({
      label: `${d.label} (n=${d.n}, ${L.executive.mean} ${num(d.mean)})`,
      parts: d.counts,
    })),
    e.bins.map(binLabel),
  )}${suppressedNote(e.suppressed)}`;
}

function completionHtml(c: CompletionSection | null): string {
  if (!c) return unavailable;
  const legend = [L.completion.submitted, L.completion.pending];
  const rows = (rs: CompletionSection["byDepartment"]) =>
    svgStacked(
      rs.map((r) => ({
        label: `${r.label} · ${rel(r.relationship)}`,
        parts: [r.submitted, r.total - r.submitted],
      })),
      legend,
    );
  const table = c.byRelationship
    .map(
      (r) =>
        `<tr><td>${esc(rel(r.relationship))}</td><td>${r.total}</td><td>${r.submitted}</td><td>${r.draft}</td><td>${r.declined}</td><td>${pct(r.submitted, r.total)}</td></tr>`,
    )
    .join("");
  return `<h3>${esc(L.completion.byRelationship)}</h3><table><thead><tr><th></th><th>${esc(L.completion.total)}</th><th>${esc(L.completion.submitted)}</th><th>${esc(L.completion.draft)}</th><th>${esc(L.completion.declined)}</th><th>%</th></tr></thead><tbody>${table}</tbody></table>
<h3>${esc(L.completion.byDepartment)}</h3>${rows(c.byDepartment)}
<h3>${esc(L.completion.byManager)}</h3>${rows(c.byManager)}${suppressedNote(c.suppressed)}`;
}

function indicatorsHtml(s: IndicatorsSection | null): string {
  if (!s) return unavailable;
  const dist = s.distribution
    .map(
      (d) =>
        `<h3>${esc(L.indicators.distribution)} · ${esc(L.indicators[d.indicator as "retention" | "engagement"] ?? d.indicator)}</h3>${svgStacked(
          d.groups.map((g) => ({
            label: `${g.label} (n=${g.n}, ${L.executive.mean} ${num(g.mean)})`,
            parts: g.counts,
          })),
          ["1", "2", "3", "4", "5"],
        )}${suppressedNote(d.suppressed)}`,
    )
    .join("");
  const matrix = s.riskMatrix
    ? `<h3>${esc(L.indicators.riskMatrix)}</h3>${svgMatrix(s.riskMatrix.cells)}`
    : "";
  const alerts = s.alerts.length
    ? `<h3>${esc(L.indicators.alerts)}</h3><ul>${s.alerts.map((a) => `<li>${esc(a.kind)}${a.indicator ? ` · ${esc(a.indicator)}` : ""}: ${a.count}</li>`).join("")}</ul>`
    : "";
  return dist + matrix + alerts;
}

function qualitativeHtml(q: QualitativeSection | null): string {
  if (!q) return unavailable;
  const S = L.qualitative.sentiments;
  const themes = q.topThemes
    .map(
      (t) =>
        `<li><b>${esc(t.theme)}</b> (${t.count})${t.quotes.length ? `<ul class="quotes">${t.quotes.map((x) => `<li>“${esc(x)}”</li>`).join("")}</ul>` : ""}</li>`,
    )
    .join("");
  return `<h3>${esc(L.qualitative.byDimension)}</h3>${svgStacked(
    q.sentimentByDimension.map((d) => ({
      label: d.dimension,
      parts: [d.positive, d.constructive, d.negative],
    })),
    [S.positive, S.constructive, S.negative],
  )}
<h3>${esc(L.qualitative.trend)} (${esc(S.positive)})</h3>${svgLine(
    q.trend.map((t) => ({
      label: t.cycleName,
      value: t.total ? t.positive / t.total : 0,
    })),
  )}
<h3>${esc(L.qualitative.themes)}</h3><ol>${themes}</ol>${suppressedNote(q.suppressed)}`;
}

function goalsHtml(g: GoalsSection | null): string {
  if (!g) return unavailable;
  return `<div class="tiles"><div class="tile"><b>${g.participantsWithGoals}</b><span>${esc(L.goals.participantsWithGoals)}</span></div><div class="tile"><b>${g.goals}</b><span>${esc(L.goals.goals)}</span></div><div class="tile"><b>${pct(g.completed, g.goals)}</b><span>${esc(L.goals.completed)}</span></div><div class="tile"><b>${g.avgProgress === null ? "–" : `${Math.round(g.avgProgress)}%`}</b><span>${esc(L.goals.avgProgress)}</span></div></div>${svgBars(g.byDepartment.map((d) => ({ label: `${d.label} (n=${d.n})`, value: d.completed })))}`;
}

function peopleHtml(people: ArturiaReport["sections"]["people"]): string {
  if (!people) return "";
  const P = L.people;
  const head = [
    P.name,
    P.email,
    P.department,
    P.manager,
    P.self,
    P.managerReview,
    P.retention,
    P.engagement,
    P.positiveShare,
  ]
    .map((h) => `<th>${esc(h)}</th>`)
    .join("");
  const cell = (v: string | null) => `<td>${v === null ? "–" : esc(v)}</td>`;
  const body = people
    .map(
      (p) =>
        `<tr>${cell(p.displayName)}${cell(p.email)}${cell(p.department)}${cell(p.manager)}${cell(p.selfStatus)}${cell(p.managerStatus)}${cell(p.retention)}${cell(p.engagement)}${cell(p.positiveShare === null ? null : pct(p.positiveShare, 1))}</tr>`,
    )
    .join("");
  return section(
    "people",
    "quantitative",
    P.title,
    `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
  );
}

const CSS = `
:root{--bg:#fff;--fg:#1d2329;--muted:#66707a;--line:#d9dee3;--c0:#2f6fb3;--c1:#e0a43a;--c2:#c8553d;--c3:#6a9f58;--c4:#7d5ba6}
@media (prefers-color-scheme:dark){:root{--bg:#15191d;--fg:#e8ecef;--muted:#9aa4ad;--line:#333b42}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}header{border-bottom:1px solid var(--line);margin-bottom:16px}
h1{font-size:1.5rem;margin:.2em 0}h2{font-size:1.2rem;margin-top:2em;border-bottom:1px solid var(--line)}h3{font-size:1rem;margin-bottom:.3em}
.muted{color:var(--muted)}.badge{display:inline-block;padding:2px 8px;border-radius:10px;border:1px solid var(--line);font-size:.85em}
nav.toggle{display:flex;gap:6px;margin:12px 0}nav.toggle button{font:inherit;padding:4px 12px;border:1px solid var(--line);background:transparent;color:inherit;border-radius:6px;cursor:pointer}
nav.toggle button[aria-pressed=true]{background:var(--c0);color:#fff;border-color:var(--c0)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{border:1px solid var(--line);border-radius:8px;padding:10px}
.tile b{display:block;font-size:1.6rem}.tile span{color:var(--muted);font-size:.9em}
svg.chart{width:100%;height:auto;font-size:12px;fill:var(--fg)}svg.matrix{max-width:340px}
.c0{fill:var(--c0);background:var(--c0)}.c1{fill:var(--c1);background:var(--c1)}.c2{fill:var(--c2);background:var(--c2)}.c3{fill:var(--c3);background:var(--c3)}.c4{fill:var(--c4);background:var(--c4)}
.line{fill:none;stroke:var(--c0);stroke-width:2}.cell{fill:var(--line)}.risk{fill:var(--c2)}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:.85em}.key i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}
table{border-collapse:collapse;width:100%;font-size:.9em}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left}
.scroll{overflow-x:auto}.quotes{color:var(--muted);font-style:italic}[hidden]{display:none!important}
`;

const JS = `
(function(){
  var buttons=document.querySelectorAll("nav.toggle button");
  function show(kind){
    document.querySelectorAll("section[data-kind]").forEach(function(s){
      s.hidden = kind!=="all" && s.getAttribute("data-kind")!==kind;
    });
    buttons.forEach(function(b){b.setAttribute("aria-pressed", String(b.getAttribute("data-show")===kind));});
  }
  buttons.forEach(function(b){b.addEventListener("click",function(){show(b.getAttribute("data-show"));});});
  show("all");
})();
`;

/** The whole report as one HTML page, with the report JSON embedded. */
export function renderHtml(report: ArturiaReport): string {
  const s = report.sections;
  const c = report.cycle;
  const mode = report.anonymized
    ? `${L.anonymized} · ${L.minGroupSize}: ${report.minGroupSize}`
    : L.named;
  const toggle = [
    ["all", L.viewAll],
    ["quantitative", L.viewQuantitative],
    ["qualitative", L.viewQualitative],
  ]
    .map(
      ([k, l]) =>
        `<button type="button" data-show="${k}" aria-pressed="false">${esc(l)}</button>`,
    )
    .join("");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${L.title} · ${c.name}`)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${esc(L.title)} · ${esc(c.name)}</h1>
<p class="muted">${esc(L.period)}: ${esc(c.periodStart)} – ${esc(c.periodEnd)} · ${esc(L.generatedAt)}: ${esc(report.generatedAt)} · <span class="badge">${esc(mode)}</span></p>
<nav class="toggle" aria-label="${esc(L.view)}">${toggle}</nav>
</header>
${section("executive", "quantitative", L.executive.title, executiveHtml(s.executive))}
${section("completion", "quantitative", L.completion.title, completionHtml(s.completion))}
${section("indicators", "quantitative", L.indicators.title, indicatorsHtml(s.indicators))}
${section("qualitative", "qualitative", L.qualitative.title, qualitativeHtml(s.qualitative))}
${section("goals", "quantitative", L.goals.title, goalsHtml(s.goals))}
${peopleHtml(s.people)}
</main>
<script type="application/json" id="report">${scriptJson(report)}</script>
<script>${JS}</script>
</body>
</html>
`;
}
