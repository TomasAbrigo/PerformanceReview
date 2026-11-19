// Pure: the report as JSON and as one self-contained HTML page (inline CSS,
// JS, data and server-side SVG; no external request of any kind).
import {
  fill,
  humanize,
  type Labels,
  labelsFor,
  questionLabel,
  readingNames,
  type ReportLocale,
  signalLabel,
  substanceLabel,
  themeLabel,
} from "./labels";
import type {
  ArturiaReport,
  CompletionSection,
  EngagementMonthlySection,
  ExecutiveSection,
  GoalsSection,
  IndicatorsSection,
  QualitativeSection,
} from "./schema";

/**
 * Labels (and language) of the render in progress: set by renderHtml for its
 * (synchronous) duration, so the helpers below need not thread them through.
 */
let L: Labels = labelsFor("es");
let LOCALE: ReportLocale = "es";

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
/** Longest label drawn in full; longer ones end in "…" and keep the whole text in a <title>. */
const MAX_LABEL = 40;
const clip = (label: string) =>
  label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
/** Room for the longest (clipped) label, about 6.3 units a character at 12px, within bounds. */
const labelWidth = (labels: readonly string[]) =>
  Math.min(
    320,
    Math.max(
      LABEL_W,
      Math.ceil(Math.max(0, ...labels.map((l) => clip(l).length)) * 6.3) + 16,
    ),
  );
/** The text of a row's label, right-aligned against the bars. */
const labelText = (label: string, x: number, y: number) =>
  `<text x="${x}" y="${y}" text-anchor="end">${esc(clip(label))}${label.length > MAX_LABEL ? `<title>${esc(label)}</title>` : ""}</text>`;

/** Horizontal bars: one per item, value labelled at the end. */
export function svgBars(items: { label: string; value: number }[]): string {
  if (!items.length) return `<p class="muted">${esc(L.noData)}</p>`;
  const max = Math.max(1, ...items.map((i) => i.value));
  const labelW = labelWidth(items.map((i) => i.label));
  const span = W - labelW - 60;
  const rows = items
    .map((it, i) => {
      const y = i * ROW;
      const w = Math.round((it.value / max) * span);
      return `${labelText(it.label, labelW - 8, y + 17)}<rect x="${labelW}" y="${y + 5}" width="${w}" height="16" class="c0"/><text x="${labelW + w + 6}" y="${y + 17}">${esc(it.value)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${items.length * ROW}" role="img" class="chart">${rows}</svg>`;
}

/** 100% stacked horizontal bars; parts share the classes c0..cN (legend apart). */
export function svgStacked(
  rows: { label: string; parts: number[] }[],
  legend: string[],
  /** Class of the segment colors: `c0..` (categorical) or `s0..` (sentiments). */
  prefix: "c" | "s" = "c",
  /** The color index of each part (default: its own position), e.g. a scale that skips the middle sentiments. */
  palette?: readonly number[],
): string {
  if (!rows.length) return `<p class="muted">${esc(L.noData)}</p>`;
  const labelW = labelWidth(rows.map((r) => r.label));
  const span = W - labelW - 60;
  const color = (k: number) => `${prefix}${palette?.[k] ?? k}`;
  const body = rows
    .map((r, i) => {
      const y = i * ROW;
      const total = r.parts.reduce((a, b) => a + b, 0);
      let x = labelW;
      const rects = r.parts
        .map((p, k) => {
          const w = total ? (p / total) * span : 0;
          const label =
            w >= 34
              ? `<text x="${(x + w / 2).toFixed(1)}" y="${y + 17}" text-anchor="middle" class="in">${pct(p, total)}</text>`
              : "";
          const rect = `<rect x="${x.toFixed(1)}" y="${y + 5}" width="${w.toFixed(1)}" height="16" class="${color(k)} seg"><title>${esc(r.label)} · ${esc(legend[k] ?? "")}: ${p} (${pct(p, total)})</title></rect>${label}`;
          x += w;
          return rect;
        })
        .join("");
      return `${labelText(r.label, labelW - 8, y + 17)}${rects}<text x="${labelW + span + 6}" y="${y + 17}" class="n">n = ${total}</text>`;
    })
    .join("");
  const keys = legend
    .map(
      (l, k) => `<span class="key"><i class="${color(k)}"></i>${esc(l)}</span>`,
    )
    .join("");
  return `<div class="legend">${keys}</div><svg viewBox="0 0 ${W} ${rows.length * ROW}" role="img" class="chart">${body}</svg>`;
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
  const last = points.length - 1;
  const marks = xy
    .map(
      ([x, y], i) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="c0"><title>${esc(points[i].label)}: ${pct(points[i].value, 1)}</title></circle><text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="n">${esc(points[i].label)}</text><text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle"${i === last ? ' class="last"' : ' class="n"'}>${pct(points[i].value, 1)}</text>`,
    )
    .join("");
  const grid = [0, 0.5, 1]
    .map((g) => {
      const y = (H - pad - g * (H - 2 * pad)).toFixed(1);
      return `<line x1="${pad}" x2="${W - pad}" y1="${y}" y2="${y}" class="grid"/><text x="${pad - 4}" y="${y}" text-anchor="end" class="n">${pct(g, 1)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" class="chart">${grid}<polyline points="${path}" class="line"/>${marks}</svg>`;
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
        return `<rect x="${x}" y="${y}" width="${S - 4}" height="${S - 4}" class="${cell?.risk ? "risk" : "cell"}"/>${cell?.risk ? `<text x="${x + S / 2 - 2}" y="${y + 16}" text-anchor="middle" class="n">${esc(L.indicators.riskLabel)}</text>` : ""}<text x="${x + S / 2 - 2}" y="${y + S / 2 + 6}" text-anchor="middle" class="count">${cell?.count ?? "–"}</text>`;
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
  return `<svg viewBox="0 0 ${off + 3 * S + 10} ${3 * S + 40}" role="img" class="chart matrix">${body}${rowLabels}${colLabels}<text x="${off + 1.5 * S}" y="${3 * S + 34}" text-anchor="middle" class="axis">${esc(L.indicators.engagement)} →</text><text x="10" y="12" class="axis">↑ ${esc(L.indicators.retention)}</text></svg>`;
}

/**
 * The names of cycles without what they all start with ("Evaluación semestral
 * 2024-04-15 – 2024-09-28" next to its siblings is "2024-04-15 – 2024-09-28"),
 * so a clipped chart label still tells them apart. One name stays whole.
 */
export function shortCycleNames(names: readonly string[]): string[] {
  if (new Set(names).size < 2) return [...names];
  let prefix = names[0];
  for (const n of names) {
    while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cut = prefix.lastIndexOf(" ") + 1;
  return names.map((n) => n.slice(cut) || n);
}

// ---------------------------------------------------------------- sections

const binLabel = (b: { from: number; to: number }) =>
  `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`;
const rel = (r: string) => (L.relationships as Record<string, string>)[r] ?? r;

const section = (
  id: string,
  kind: "quantitative" | "qualitative",
  title: string,
  body: string,
) =>
  `<section id="${id}" data-kind="${kind}"><h2>${esc(title)}</h2>${body}</section>`;

const unavailable = () => `<p class="muted">${esc(L.notAvailable)}</p>`;
const hiddenTotal = () => `<p class="muted">${esc(L.hiddenTotal)}</p>`;
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
  // A cycle with no final ratings has no distribution: "no data", never a row
  // of zeros (which would read as "everybody rated 0").
  if (e.distributionStatus === "no_data") {
    return `<div class="tiles">${tiles}</div>
<h3>${esc(L.executive.distribution)}</h3><p class="muted">${esc(L.executive.noRatings)}</p>`;
  }
  return `<div class="tiles">${tiles}</div>
<h3>${esc(L.executive.distribution)}</h3>${e.distribution ? svgBars(e.bins.map((b, i) => ({ label: binLabel(b), value: e.distribution![i] ?? 0 }))) : hiddenTotal()}
<h3>${esc(L.executive.byDepartment)}</h3>${svgStacked(
    e.byDepartment.map((d) => ({
      label: `${d.label} (n=${d.n}, ${L.executive.mean} ${num(d.mean)})`,
      parts: d.counts,
    })),
    e.bins.map(binLabel),
  )}${suppressedNote(e.suppressed)}`;
}

/** Percentage points with a sign; "–" without a rate to compare. */
const signed = (x: number | null) =>
  x === null ? "–" : `${x > 0 ? "+" : ""}${x}`;

function completionDeltaHtml(d: NonNullable<CompletionSection["delta"]>) {
  const row = (
    label: string,
    p: { self: number | null; manager: number | null },
  ) =>
    `<tr><td>${esc(label)}</td><td>${signed(p.self)}</td><td>${signed(p.manager)}</td></tr>`;
  const rows = [
    ...(d.total ? [row(L.completion.total, d.total)] : []),
    ...d.byDepartment.map((x) => row(x.label, x)),
  ].join("");
  return `<h3>${esc(L.completion.delta)} (${esc(d.previousCycleName)}, ${esc(L.completion.points)})</h3><table><thead><tr><th></th><th>${esc(rel("self"))}</th><th>${esc(rel("manager"))}</th></tr></thead><tbody>${rows}</tbody></table>${d.total ? "" : hiddenTotal()}`;
}

function completionHtml(c: CompletionSection | null): string {
  if (!c) return unavailable();
  const legend = [L.completion.submitted, L.completion.pending];
  const rows = (rs: CompletionSection["byDepartment"]) =>
    svgStacked(
      rs.map((r) => ({
        label: `${r.label} · ${rel(r.relationship)}${r.applicable ? "" : ` (${L.completion.notApplicable})`}`,
        parts: [r.submitted, r.total - r.submitted],
      })),
      legend,
    );
  const totals = c.byRelationship
    ? `<table><thead><tr><th></th><th>${esc(L.completion.total)}</th><th>${esc(L.completion.submitted)}</th><th>${esc(L.completion.pending)}</th><th>${esc(L.completion.rate)}</th></tr></thead><tbody>${c.byRelationship
        .map(
          (r) =>
            `<tr><td>${esc(rel(r.relationship))}</td><td>${r.total}</td><td>${r.submitted}</td><td>${r.total - r.submitted}</td><td>${r.applicable ? pct(r.submitted, r.total) : esc(L.completion.notApplicable)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : hiddenTotal();
  return `<h3>${esc(L.completion.byRelationship)}</h3>${totals}
<h3>${esc(L.completion.byDepartment)}</h3>${rows(c.byDepartment)}${suppressedNote(c.suppressed.byDepartment)}
<h3>${esc(L.completion.byManager)}</h3>${rows(c.byManager)}${suppressedNote(c.suppressed.byManager)}
${c.byAccount ? `<h3>${esc(L.completion.byAccount)}</h3>${rows(c.byAccount)}${suppressedNote(c.suppressed.byAccount ?? 0)}` : ""}
${c.byDm ? `<h3>${esc(L.completion.byDm)}</h3>${rows(c.byDm)}${suppressedNote(c.suppressed.byDm ?? 0)}` : ""}
${c.delta ? completionDeltaHtml(c.delta) : ""}`;
}

function indicatorsHtml(s: IndicatorsSection | null): string {
  if (!s) return unavailable();
  const dist = s.distribution
    .map((d) => {
      const name = esc(
        L.indicators[d.indicator as "retention" | "engagement"] ?? d.indicator,
      );
      const chart = (groups: typeof d.groups) =>
        svgStacked(
          groups.map((g) => ({
            label: `${g.label} (n=${g.n}, ${L.executive.mean} ${num(g.mean)})`,
            parts: g.counts,
          })),
          ["1", "2", "3", "4", "5"],
        );
      const cut = (
        title: string,
        groups: typeof d.groups | undefined,
        left: number | undefined,
      ) =>
        groups
          ? `<h3>${esc(title)} · ${name}</h3>${chart(groups)}${suppressedNote(left ?? 0)}`
          : "";
      return `<h3>${esc(L.indicators.distribution)} · ${name}</h3>${chart(d.groups)}${suppressedNote(d.suppressed)}${cut(L.indicators.byAccount, d.byAccount, d.suppressedBy?.account)}${cut(L.indicators.byDm, d.byDm, d.suppressedBy?.dm)}`;
    })
    .join("");
  const matrix = s.riskMatrix
    ? `<h3>${esc(L.indicators.riskMatrix)}</h3>${svgMatrix(s.riskMatrix.cells)}`
    : "";
  const alerts = s.alerts.length
    ? `<h3>${esc(L.indicators.alerts)}</h3><ul>${s.alerts.map((a) => `<li>${esc(a.kind === "risk" ? L.indicators.risk : a.kind === "drop" ? L.indicators.drop : a.kind)}${a.indicator ? ` · ${esc(a.indicator)}` : ""}: ${a.count}</li>`).join("")}</ul>`
    : "";
  return dist + matrix + alerts;
}

/** The tone's five sentiments, in the order of the stacked bars and their colors. */
const SENTIMENTS = [
  "positive",
  "constructive",
  "neutral",
  "mixed",
  "negative",
] as const;
/** Substance, best first; colored green, gray, red (the sentiment palette). */
const SUBSTANCES = ["specific", "generic", "none"] as const;

/**
 * Rows whose parts are all published are drawn as bars; the rest (some cell
 * is not published) go in a table below, where the cells that are published
 * stay and the others read "–".
 */
function stackedRows(
  rows: { label: string; people: number; parts: (number | null)[] }[],
  legend: string[],
  prefix: "c" | "s",
  palette: readonly number[] | undefined,
  hiddenNote: string,
  head: string[],
): string {
  if (!rows.length) return `<p class="muted">${esc(L.noData)}</p>`;
  const drawn = rows.flatMap((r) =>
    r.parts.every((p) => p !== null)
      ? [{ label: r.label, parts: r.parts as number[] }]
      : [],
  );
  const partial = rows.filter((r) => r.parts.some((p) => p === null));
  const rest = partial.length
    ? `<p class="muted">${esc(hiddenNote)}</p><div class="scroll"><table><thead><tr>${[...head, ...legend].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${partial
        .map(
          (r) =>
            `<tr><td>${esc(r.label)}</td><td>${r.people}</td>${r.parts.map((p) => `<td>${p === null ? "–" : p}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`
    : "";
  return `${drawn.length ? svgStacked(drawn, legend, prefix, palette) : ""}${rest}`;
}

function qualitativeHtml(q: QualitativeSection | null): string {
  if (!q) return unavailable();
  const T = readingNames(LOCALE);
  const X = T.text;
  const side = (s: string) => (T.sides as Record<string, string>)[s] ?? s;
  const names = new Map(q.questions.map((x) => [x.dimension, x.label]));
  const question = (d: string) =>
    names.get(d) ?? questionLabel(d, undefined, LOCALE);
  const cell = (v: number | null) => (v === null ? T.hiddenCell : String(v));
  const share = (part: number | null, total: number | null) =>
    part === null || total === null ? T.hiddenCell : pct(part, total);
  const both = (part: number | null, total: number | null) =>
    part === null ? T.hiddenCell : `${part} (${share(part, total)})`;
  const tile = (value: string | number, label: string) =>
    `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  const table = (head: string[], rows: string[][]) =>
    `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;

  // --- provenance
  const p = q.provenance;
  const readBy = p.providers.length
    ? fill(X.readBy, {
        list: p.providers
          .map((x) => (x.model ? `${x.provider} (${x.model})` : x.provider))
          .join(", "),
      })
    : X.noMachine;
  const provenance = `<div class="note${p.demo ? " demo" : ""}" data-demo="${p.demo ? "1" : "0"}"><b>${esc(X.provenanceTitle)}</b>${p.demo ? `<p><b>${esc(X.demo)}</b></p>` : ""}<p>${esc(readBy)}${p.lastRun ? ` · ${esc(fill(X.lastRun, { date: p.lastRun.finishedAt.slice(0, 10) }))}` : ""}</p><p class="muted">${esc(
    fill(X.counts, {
      labels: p.labels,
      corrected:
        p.correctedShare === null
          ? T.hiddenCell
          : `${Math.round(p.correctedShare * 100)}%`,
      human: p.human,
      imported: p.imported,
    }),
  )}</p></div>`;

  const v = q.closed.valued;
  const tiles = `<div class="tiles">${[
    tile(q.people, X.people),
    tile(
      share(q.signals?.withAny ?? null, q.signals?.people ?? null),
      X.withSignal,
    ),
    tile(share(v?.notValued ?? null, v?.people ?? null), X.notValued),
  ].join("")}</div><p class="muted">${esc(X.unit)}</p>`;

  // --- substance
  const substanceLegend = SUBSTANCES.map((k) => substanceLabel(k, LOCALE));
  const substance = `<h3>${esc(X.substanceTitle)}</h3><p class="muted">${esc(X.substanceHint)}</p>${stackedRows(
    q.substance.map((r) => ({
      label: `${question(r.dimension)} · ${side(r.side)}`,
      people: r.people,
      parts: [r.specific, r.generic, r.none],
    })),
    substanceLegend,
    "s",
    [0, 2, 4],
    X.hiddenRows,
    [X.question, X.people],
  )}`;
  const cuts = [
    [X.cutDepartment, q.managerFeedback.byDepartment],
    [X.cutAccount, q.managerFeedback.byAccount],
    [X.cutDm, q.managerFeedback.byDm],
  ] as const;
  const feedback = `<h3>${esc(X.managerFeedbackTitle)}</h3><p class="muted">${esc(X.managerFeedbackHint)}</p>${cuts
    .map(
      ([title, c]) =>
        `<h4>${esc(title)}</h4>${stackedRows(
          c.groups.map((g) => ({
            label: g.label,
            people: g.people,
            parts: [g.specific, g.generic, g.none],
          })),
          substanceLegend,
          "s",
          [0, 2, 4],
          X.hiddenRows,
          [X.group, X.people],
        )}${suppressedNote(c.suppressed)}`,
    )
    .join("")}`;

  // --- themes of strengths and of improvement, side by side
  const themes = q.themes
    .map((t) => {
      const quotes = t.rows.filter(
        (r) => r.quotes.self.length || r.quotes.manager.length,
      );
      const head = [
        X.theme,
        fill(X.sideOf, { side: side("self"), n: cell(t.people.self) }),
        fill(X.sideOf, { side: side("manager"), n: cell(t.people.manager) }),
      ];
      return `<h3>${esc(fill(X.themesOf, { question: question(t.dimension) }))}</h3><p class="muted">${esc(X.themesHint)}</p>${
        t.rows.length
          ? table(
              head,
              t.rows.map((r) => [
                esc(themeLabel(r.theme, LOCALE)),
                esc(both(r.self, t.people.self)),
                esc(both(r.manager, t.people.manager)),
              ]),
            )
          : `<p class="muted">${esc(X.empty)}</p>`
      }${
        quotes.length
          ? `<h4>${esc(X.quotes)}</h4><ul class="quotes">${quotes
              .map(
                (r) =>
                  `<li><b>${esc(themeLabel(r.theme, LOCALE))}</b>${(
                    ["self", "manager"] as const
                  )
                    .flatMap((s) =>
                      r.quotes[s].map(
                        (x) => `<br>${esc(side(s))}: “${esc(x)}”`,
                      ),
                    )
                    .join("")}</li>`,
              )
              .join("")}</ul>`
          : ""
      }`;
    })
    .join("");

  // --- agreement and blind spots
  const a = q.agreement;
  const agreement = `<h3>${esc(X.agreementTitle)}</h3><p class="muted">${esc(X.agreementHint)}</p>${
    a.rows.length
      ? table(
          [X.question, X.both, X.shared],
          a.rows.map((r) => [
            esc(fill(X.agreementOf, { question: question(r.dimension) })),
            String(r.both),
            esc(both(r.shared, r.both)),
          ]),
        )
      : `<p class="muted">${esc(X.empty)}</p>`
  }<p>${esc(X.blindPeople)}: <b>${esc(both(a.blindPeople, a.improvementBoth))}</b></p>${
    a.blindSpots.length
      ? `<h4>${esc(X.blindSpots)}</h4><ol>${a.blindSpots
          .map(
            (b) =>
              `<li>${esc(themeLabel(b.theme, LOCALE))} · ${esc(fill(X.ofPeople, { n: b.people, of: a.improvementBoth ?? "–" }))}</li>`,
          )
          .join("")}</ol>`
      : ""
  }`;

  // --- signals
  const sig = q.signals;
  const signalKeys = sig
    ? [
        ...new Set([
          ...sig.rows.map((r) => r.signal),
          ...[sig.byDepartment, sig.byAccount, sig.byDm].flatMap((c) =>
            c.groups.flatMap((g) => Object.keys(g.counts)),
          ),
        ]),
      ]
    : [];
  // The signals crossed with the manager's retention / engagement answer.
  const byIndicator = sig?.byIndicator.length
    ? `<h4>${esc(X.signalsByIndicator)}</h4><p class="muted">${esc(X.signalsByIndicatorHint)}</p>${(
        ["retention", "engagement"] as const
      )
        .map((role) => {
          const rows = sig.byIndicator.filter((r) => r.indicator === role);
          return rows.length
            ? `<h4>${esc(L.indicators[role])}</h4>${table(
                [X.answer, X.people, X.withSignal],
                rows.map((r) => [
                  esc(r.label ? `${r.value} · ${r.label}` : String(r.value)),
                  String(r.people),
                  esc(both(r.withSignal, r.people)),
                ]),
              )}`
            : "";
        })
        .join("")}`
    : "";
  const signalsBase = `<h3>${esc(X.signalsTitle)}</h3><p class="muted">${esc(X.signalsHint)}</p>${
    sig
      ? `${tile(share(sig.withAny, sig.people), X.withSignal)}${
          sig.rows.length
            ? table(
                [X.signal, X.people, X.inOwn, X.inManager],
                sig.rows.map((r) => [
                  esc(signalLabel(r.signal, LOCALE)),
                  esc(both(r.people, sig.people)),
                  esc(cell(r.self)),
                  esc(cell(r.manager)),
                ]),
              )
            : `<p class="muted">${esc(X.noSignals)}</p>`
        }${(
          [
            [X.cutDepartment, sig.byDepartment],
            [X.cutAccount, sig.byAccount],
            [X.cutDm, sig.byDm],
          ] as const
        )
          .map(
            ([title, c]) =>
              `<h4>${esc(X.signalsTitle)} · ${esc(title)}</h4>${table(
                [
                  X.group,
                  X.people,
                  X.withSignal,
                  ...signalKeys.map((s) => signalLabel(s, LOCALE)),
                ],
                c.groups.map((g) => [
                  esc(g.label),
                  String(g.people),
                  esc(cell(g.withAny)),
                  // a hidden count (null) reads "–", never 0
                  ...signalKeys.map((s) =>
                    esc(cell(s in g.counts ? g.counts[s] : 0)),
                  ),
                ]),
              )}${suppressedNote(c.suppressed)}`,
          )
          .join("")}`
      : `<p class="muted">${esc(X.noSignals)}</p>`
  }`;
  const signals = `${signalsBase}${byIndicator}`;

  // --- yes / no
  // By group: one table per question, a row per group of each cut.
  const yesNoByGroup = q.yesNo.byGroup
    .map((d) => {
      const groups = (
        [
          [X.cutDepartment, d.byDepartment],
          [X.cutAccount, d.byAccount],
          [X.cutDm, d.byDm],
        ] as const
      ).flatMap(([title, c]) => c.groups.map((g) => ({ title, g })));
      // A group with neither figure published says nothing here: counted, not listed.
      const shown = groups.filter(({ g }) => g.yes !== null || g.no !== null);
      const none = groups.length - shown.length;
      return groups.length
        ? `<h4>${esc(question(d.dimension))}</h4>${
            shown.length
              ? table(
                  [X.cut, X.group, X.people, T.yes, T.no],
                  shown.map(({ title, g }) => [
                    esc(title),
                    esc(g.label),
                    String(g.people),
                    esc(both(g.yes, g.people)),
                    esc(both(g.no, g.people)),
                  ]),
                )
              : ""
          }${none ? `<p class="muted">${esc(none === 1 ? X.groupHidden : fill(X.groupsHidden, { n: none }))}</p>` : ""}`
        : "";
    })
    .join("");
  // By cycle: the No of every question, a row per cycle (oldest first).
  const cycles = new Map<string, { name: string; end: string }>();
  for (const d of q.yesNo.byCycle) {
    for (const c of d.cycles) {
      cycles.set(c.cycleId, { name: c.cycleName, end: c.periodEnd });
    }
  }
  const cycleOrder = [...cycles].sort(
    ([, a], [, b]) =>
      a.end.localeCompare(b.end) || a.name.localeCompare(b.name),
  );
  const yesNoByCycle = cycleOrder.length
    ? `<h4>${esc(X.yesNoByCycle)}</h4><p class="muted">${esc(X.yesNoByCycleHint)}</p>${table(
        [X.cycle, ...q.yesNo.byCycle.map((d) => question(d.dimension))],
        cycleOrder.map(([id, c]) => [
          esc(c.name),
          ...q.yesNo.byCycle.map((d) => {
            const x = d.cycles.find((y) => y.cycleId === id);
            if (!x) return esc(T.hiddenCell);
            return esc(
              x.no === null
                ? `${T.hiddenCell} / ${x.people}`
                : `${T.no} ${x.no} / ${x.people} (${pct(x.no, x.people)})`,
            );
          }),
        ]),
      )}`
    : "";
  const alerts = q.yesNo.rows.filter((r) => r.alert);
  const yesNo = `<h3>${esc(X.yesNoTitle)}</h3><p class="muted">${esc(X.yesNoHint)}</p>${
    alerts.length
      ? `<ul class="alerts">${alerts
          .map((r) =>
            esc(
              fill(
                r.kind === "security" ? X.alertSecurity : X.alertConversations,
                { n: r.no ?? 0, of: r.people, share: share(r.no, r.people) },
              ),
            ),
          )
          .map((t) => `<li>${t}</li>`)
          .join("")}</ul>`
      : ""
  }${
    q.yesNo.rows.length
      ? table(
          [X.question, X.side, X.people, T.yes, T.no],
          q.yesNo.rows.map((r) => [
            esc(question(r.dimension)),
            esc(side(r.side)),
            String(r.people),
            esc(both(r.yes, r.people)),
            esc(both(r.no, r.people)),
          ]),
        )
      : `<p class="muted">${esc(X.empty)}</p>`
  }${
    q.yesNo.initiatives.length
      ? `<h4>${esc(X.initiatives)}</h4>${q.yesNo.initiatives
          .map(
            (i) =>
              `<p><b>${esc(fill(X.initiativesOf, { question: question(i.dimension), n: i.people }))}</b></p>${
                i.rows.length
                  ? `<ul>${i.rows.map((r) => `<li>${esc(themeLabel(r.theme, LOCALE))} · ${esc(fill(X.ofPeople, { n: r.people, of: i.people }))}</li>`).join("")}</ul>`
                  : ""
              }`,
          )
          .join("")}`
      : ""
  }${yesNoByGroup ? `<h4>${esc(X.yesNoByGroup)}</h4>${yesNoByGroup}` : ""}${yesNoByCycle}`;

  // --- closed questions: a scale and a distribution of options, never a sentiment
  const valuedLegend = v
    ? v.labels.map((l, i) => `${i + 1}${l ? ` · ${l}` : ""}`)
    : [];
  // The scale by group and by cycle: best (4) first, as the total bar.
  const valuedColors = [0, 1, 3, 4] as const;
  const valuedBars = (
    rows: { label: string; people: number; counts: (number | null)[] }[],
    head: string,
  ) =>
    stackedRows(
      rows.map((r) => ({
        label: r.label,
        people: r.people,
        parts: [...r.counts].reverse(),
      })),
      [...valuedLegend].reverse(),
      "s",
      valuedColors,
      X.hiddenRows,
      [head, X.people],
    );
  const valuedExtra = v
    ? (
        [
          [X.cutDepartment, v.byDepartment],
          [X.cutAccount, v.byAccount],
          [X.cutDm, v.byDm],
        ] as const
      )
        .filter(([, c]) => c.groups.length)
        .map(
          ([title, c]) =>
            `<h4>${esc(X.valuedByGroup)} · ${esc(title)}</h4>${valuedBars(c.groups, X.group)}${suppressedNote(c.suppressed)}`,
        )
        .join("") +
      (v.byCycle.length
        ? `<h4>${esc(X.valuedByCycle)}</h4>${valuedBars(
            v.byCycle.map((c, i) => ({
              ...c,
              label: shortCycleNames(v.byCycle.map((x) => x.cycleName))[i],
            })),
            X.cycle,
          )}`
        : "")
    : "";
  const bw = q.closed.bestWork;
  const closed = `<h3>${esc(X.closedTitle)}</h3><p class="muted">${esc(X.closedHint)}</p>${
    v
      ? `<h4>${esc(X.valuedTitle)}</h4>${
          v.counts.every((c) => c !== null)
            ? svgStacked(
                [
                  {
                    label: `${X.valuedTotal}`,
                    // best (4) first, so the bar reads from valued to not valued
                    parts: [...(v.counts as number[])].reverse(),
                  },
                ],
                [...valuedLegend].reverse(),
                "s",
                [0, 1, 3, 4],
              )
            : table(valuedLegend, [v.counts.map((c) => esc(cell(c)))])
        }<p class="muted">${esc(X.notValued)}: <b>${esc(both(v.notValued, v.people))}</b></p>${valuedExtra}`
      : ""
  }${
    bw
      ? `<h4>${esc(fill(X.bestWorkTitle, { n: bw.people }))}</h4>${svgBars(
          bw.options.flatMap((o) =>
            o.people === null
              ? []
              : [{ label: o.label ?? humanize(o.option), value: o.people }],
          ),
        )}${
          bw.options.some((o) => o.people === null)
            ? `<p class="muted">${esc(X.hiddenRows)}: ${esc(
                bw.options
                  .filter((o) => o.people === null)
                  .map((o) => o.label ?? humanize(o.option))
                  .join("; "),
              )}</p>`
            : ""
        }`
      : ""
  }`;

  // --- tone (secondary)
  const sentimentLegend = SENTIMENTS.map((k) => L.qualitative.sentiments[k]);
  const tone = `<h3>${esc(X.toneTitle)}</h3><p class="muted">${esc(X.toneHint)}</p>${stackedRows(
    q.tone.map((r) => ({
      label: `${question(r.dimension)} · ${side(r.side)}`,
      people: r.people,
      parts: SENTIMENTS.map((k) => r[k]),
    })),
    sentimentLegend,
    "s",
    undefined,
    X.hiddenRows,
    [X.question, X.people],
  )}`;

  return [
    provenance,
    tiles,
    substance,
    feedback,
    themes,
    agreement,
    signals,
    yesNo,
    closed,
    tone,
  ].join("\n");
}

function goalsHtml(g: GoalsSection | null): string {
  if (!g) return unavailable();
  const G = L.goals;
  const tile = (value: string | number, label: string) =>
    `<div class="tile"><b>${value}</b><span>${esc(label)}</span></div>`;
  const tiles =
    g.goals === null
      ? hiddenTotal()
      : `<div class="tiles">${[
          tile(g.participantsWithGoals ?? "–", G.participantsWithGoals),
          tile(g.goals, G.goals),
          tile(pct(g.completed ?? 0, g.goals), G.completed),
          tile(
            g.avgProgress === null ? "–" : `${Math.round(g.avgProgress)}%`,
            G.avgProgress,
          ),
          ...(g.withoutGoals === null
            ? []
            : [tile(g.withoutGoals, G.withoutGoals)]),
        ].join("")}</div>`;
  // Goals by status per group: completed, in progress, overdue and closed:
  // a partition (in progress leaves out the overdue), so the parts add up to
  // the goals.
  const status = (rows: GoalsSection["byDepartment"]) =>
    svgStacked(
      rows.map((r) => ({
        label: `${r.label} (n=${r.n})`,
        parts: [r.completed, r.inProgress, r.overdue, r.closed],
      })),
      [G.completed, G.inProgress, G.overdue, G.closed],
    );
  const hiddenBucket = g.buckets.some((b) => b.hidden);
  const buckets = `<div class="scroll"><table><thead><tr><th>${esc(G.bucket)}</th><th>${esc(G.people)}</th><th>${esc(G.meanRetention)}</th><th>${esc(G.meanEngagement)}</th><th>${esc(G.positiveShare)}</th></tr></thead><tbody>${g.buckets
    .map(
      (b) =>
        `<tr><td>${b.from}–${b.to}%</td><td>${b.people ?? "–"}</td><td>${num(b.meanRetention)}</td><td>${num(b.meanEngagement)}</td><td>${b.meanPositiveShare === null ? "–" : pct(b.meanPositiveShare, 1)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div>${hiddenBucket ? `<p class="muted">${esc(G.underMinimum)}</p>` : ""}${suppressedNote(g.suppressed.buckets)}`;

  const groups = [
    [G.doneButLow, g.outliers.doneButLow],
    [G.behindButHigh, g.outliers.behindButHigh],
  ] as const;
  const named = (title: string, o: (typeof groups)[number][1]) =>
    o.people.length
      ? `<h4>${esc(title)}</h4><div class="scroll"><table><thead><tr><th>${esc(L.people.name)}</th><th>${esc(L.people.department)}</th><th>${esc(L.people.manager)}</th><th>${esc(G.goals)}</th><th>${esc(G.completedPct)}</th><th>${esc(L.indicators.retention)}</th><th>${esc(L.indicators.engagement)}</th></tr></thead><tbody>${o.people
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td>${p.department === null ? "–" : esc(p.department)}</td><td>${p.manager === null ? "–" : esc(p.manager)}</td><td>${p.completed}/${p.goals}</td><td>${Math.round(p.completedPct)}%</td><td>${p.retention ?? "–"}</td><td>${p.engagement ?? "–"}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : "";
  const outliers = `<ul>${groups
    .map(([title, o]) => `<li>${esc(title)}: <b>${o.count ?? "–"}</b></li>`)
    .join(
      "",
    )}</ul>${groups.some(([, o]) => o.count === null) ? `<p class="muted">${esc(G.underMinimum)}</p>` : ""}${groups.map(([title, o]) => named(title, o)).join("")}`;

  const asOf = g.asOf
    ? `<p class="muted">${esc(G.asOf)}: ${esc(g.asOf)}</p>`
    : "";
  return `${tiles}${asOf}
<h3>${esc(G.byDepartment)} · ${esc(G.status)}</h3>${status(g.byDepartment)}${suppressedNote(g.suppressed.byDepartment)}
<h3>${esc(G.byManager)} · ${esc(G.status)}</h3>${status(g.byManager)}${suppressedNote(g.suppressed.byManager)}
${g.byAccount ? `<h3>${esc(G.byAccount)} · ${esc(G.status)}</h3>${status(g.byAccount)}${suppressedNote(g.suppressed.byAccount ?? 0)}` : ""}
${g.byDm ? `<h3>${esc(G.byDm)} · ${esc(G.status)}</h3>${status(g.byDm)}${suppressedNote(g.suppressed.byDm ?? 0)}` : ""}
<h3>${esc(G.buckets)}</h3>${buckets}
<h3>${esc(G.outliers)}</h3>${outliers}`;
}

const SEGMENTS = ["alto", "medio", "regular", "bajo", "falta"] as const;

/** The monthly engagement: the mean score by month, the segments by month and the table. */
function engagementMonthlyHtml(
  e: EngagementMonthlySection | null | undefined,
): string {
  if (!e) return unavailable();
  const E = L.engagement;
  const shown = e.months.filter((m) => !m.hidden);
  const scored = e.months.flatMap((m) =>
    m.meanScore === null ? [] : [{ label: m.month, value: m.meanScore }],
  );
  const stacked = e.months.flatMap((m) =>
    m.segments === null
      ? []
      : [
          {
            label: m.month,
            parts: SEGMENTS.map((s) => m.segments![s]),
          },
        ],
  );
  const cell = (v: number | null) => (v === null ? "–" : v);
  const table = `<div class="scroll"><table><thead><tr><th>${esc(E.month)}</th><th>${esc(E.people)}</th><th>${esc(E.respondents)}</th><th>${esc(E.participation)}</th><th>${esc(E.meanScore)}</th>${SEGMENTS.map((s) => `<th>${esc(E.segments[s])}</th>`).join("")}</tr></thead><tbody>${e.months
    .map((m) =>
      m.hidden
        ? `<tr><td>${esc(m.month)}</td><td colspan="${4 + SEGMENTS.length}" class="muted">${esc(E.underMinimum)}</td></tr>`
        : `<tr><td>${esc(m.month)}</td><td>${cell(m.people)}</td><td>${cell(m.respondents)}</td><td>${m.participation === null ? "–" : pct(m.participation, 1)}</td><td>${num(m.meanScore)}</td>${SEGMENTS.map((s) => `<td>${m.segments ? m.segments[s] : "–"}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
  return `<h3>${esc(E.evolution)}</h3>${svgLine(scored)}
<h3>${esc(E.bySegment)}</h3>${
    shown.length
      ? svgStacked(
          stacked,
          SEGMENTS.map((s) => E.segments[s]),
        )
      : `<p class="muted">${esc(L.noData)}</p>`
  }${table}${suppressedNote(e.suppressedMonths)}`;
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
  // The side statuses in words (the JSON keeps the module's keys).
  const statuses = P.statuses as Record<string, string>;
  const side = (v: string | null) =>
    cell(v === null ? null : (statuses[v] ?? v));
  const body = people
    .map(
      (p) =>
        `<tr>${cell(p.displayName)}${cell(p.email)}${cell(p.department)}${cell(p.manager)}${side(p.selfStatus)}${side(p.managerStatus)}${cell(p.retention)}${cell(p.engagement)}${cell(p.positiveShare === null ? null : pct(p.positiveShare, 1))}</tr>`,
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
:root{--bg:#fff;--fg:#0f2826;--muted:#5a706e;--line:#c3e1e0;--c0:#006060;--c1:#c7892a;--c2:#a13a3a;--c3:#1e7a4c;--c4:#76b3b4;--s0:#1e7a4c;--s1:#27a7a7;--s2:#d9dcdc;--s3:#c7892a;--s4:#a13a3a}
@media (prefers-color-scheme:dark){:root{--bg:#000d0e;--fg:#f4f9f9;--muted:#b2b6b6;--line:#1b3a3a;--c0:#27a7a7}}
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
.s0{fill:var(--s0);background:var(--s0)}.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}.s4{fill:var(--s4);background:var(--s4)}
.line{fill:none;stroke:var(--c0);stroke-width:2}.cell{fill:var(--line)}.risk{fill:var(--c2);fill-opacity:.25;stroke:var(--c2);stroke-width:2}
.seg{stroke:var(--bg);stroke-width:2}.in{fill:#fff;font-weight:600}.s1+.in,.s2+.in,.c4+.in{fill:#0f2826}.n{fill:var(--muted)}.last{font-weight:700}.grid{stroke:var(--line);stroke-opacity:.6}.count{font-size:18px;font-weight:600}.axis{font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:.85em}.key i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}
table{border-collapse:collapse;width:100%;font-size:.9em}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left}
.scroll{overflow-x:auto}.quotes{color:var(--muted);font-style:italic}[hidden]{display:none!important}
.note{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}.note p{margin:.3em 0}.note.demo{border-color:var(--c1);border-width:2px}
.alerts li{color:var(--c2);font-weight:600}h4{font-size:.95rem;margin:1em 0 .3em}
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
export function renderHtml(
  report: ArturiaReport,
  labels: Labels = labelsFor(report.locale),
): string {
  const previous = [L, LOCALE] as const;
  L = labels;
  LOCALE = report.locale;
  try {
    return page(report);
  } finally {
    [L, LOCALE] = previous;
  }
}

function page(report: ArturiaReport): string {
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
<html lang="${report.locale}">
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
${s.engagementMonthly === undefined ? "" : section("engagement-monthly", "quantitative", L.engagement.title, engagementMonthlyHtml(s.engagementMonthly))}
${peopleHtml(s.people)}
</main>
<script type="application/json" id="report">${scriptJson(report)}</script>
<script>${JS}</script>
</body>
</html>
`;
}
