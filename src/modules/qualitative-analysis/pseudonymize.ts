import { fold } from "./dimension";

export type PseudonymSources = {
  /** Person display names ("First Last"); parts are matched too. */
  knownNames: string[];
  emails?: string[];
  employeeNumbers?: string[];
};

/** token ("[P1]") -> original value, to restore themes and quotes. */
export type PseudonymMap = Map<string, string>;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** "legajo 123", "leg. 123", "employee number 123", "employee #123". */
const LEGAJO =
  /\b(?:legajo|leg\.|employee\s+(?:number|no\.?|#)|nro\.?\s+de\s+legajo)\s*[:#]?\s*[\p{L}]{0,3}-?\d[\d-]*/giu;
const MIN_PART = 3;
/**
 * Name parts that are also common es/en words: replaced only when written
 * capitalised and at least 4 letters long ("Bueno", not "muy bueno").
 */
const COMMON_WORDS = new Set([
  "bueno",
  "buena",
  "mora",
  "paz",
  "luz",
  "sol",
  "rosa",
  "cruz",
  "rey",
  "mar",
  "alba",
  "victoria",
  "leal",
  "blanco",
  "blanca",
  "rubio",
  "campos",
  "prado",
  "santos",
  "flores",
  "vega",
  "rico",
  "bravo",
  "franco",
  "nieves",
  "cielo",
  "angel",
  "rocio",
  "pilar",
  "dolores",
  "amparo",
  "esperanza",
  "consuelo",
  "gracia",
  "sierra",
  "monte",
  "rivera",
  "costa",
  "rio",
  "pino",
  "olivo",
  "grant",
  "may",
  "will",
  "mark",
  "hope",
  "joy",
  "faith",
  "rose",
  "young",
  "king",
  "white",
  "black",
  "brown",
  "green",
  "long",
  "short",
  "page",
  "bell",
]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (body: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "gu");

/** Per-character fold that keeps indexes aligned with the original. */
const foldAligned = (s: string) =>
  Array.from(s, (c) => fold(c).charAt(0) || c).join("");

/**
 * Replaces known people (full name, and first/last names separately,
 * accent/case-insensitive), any email and legajo patterns / known employee
 * numbers with stable tokens [P1], [E1], [N1] for the whole run. The returned
 * map restores them (depseudonymize).
 */
export function pseudonymize(
  texts: string[],
  sources: PseudonymSources,
): { texts: string[]; map: PseudonymMap } {
  const map: PseudonymMap = new Map();
  const byValue = new Map<string, string>();
  const counters = { P: 0, E: 0, N: 0 };
  const tokenFor = (kind: "P" | "E" | "N", key: string, original: string) => {
    let token = byValue.get(`${kind}:${key}`);
    if (!token) {
      token = `[${kind}${++counters[kind]}]`;
      byValue.set(`${kind}:${key}`, token);
      map.set(token, original);
    }
    return token;
  };

  // Name patterns: full names first, then parts (longest first).
  const people = sources.knownNames
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name, i) => ({ name, id: String(i), folded: fold(name) }));
  const patterns: {
    folded: string;
    person: (typeof people)[number];
    common: boolean;
  }[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    if (!seen.has(p.folded)) {
      seen.add(p.folded);
      patterns.push({ folded: p.folded, person: p, common: false });
    }
  }
  for (const p of people) {
    for (const part of p.folded.split(/\s+/)) {
      if (part.length < MIN_PART || seen.has(part)) continue;
      seen.add(part);
      const common = COMMON_WORDS.has(part);
      if (common && part.length < 4) continue;
      patterns.push({ folded: part, person: p, common });
    }
  }
  patterns.sort((a, b) => b.folded.length - a.folded.length);
  const nameRe = patterns.length
    ? bounded(
        patterns.map((p) => escape(p.folded).replace(/\s+/g, "\\s+")).join("|"),
      )
    : null;
  const byPattern = new Map(patterns.map((p) => [p.folded, p]));
  const numbers = (sources.employeeNumbers ?? []).filter(Boolean);
  const numberRe = numbers.length
    ? bounded(numbers.map((n) => escape(fold(n))).join("|"))
    : null;

  const out = texts.map((text) => {
    let t = text.replace(EMAIL, (m) => tokenFor("E", m.toLowerCase(), m));
    t = t.replace(LEGAJO, (m) => tokenFor("N", fold(m), m));
    if (numberRe) {
      t = replaceFolded(t, numberRe, (m) => tokenFor("N", m, m));
    }
    if (nameRe) {
      t = replaceFolded(t, nameRe, (m, original) => {
        const p = byPattern.get(m.replace(/\s+/g, " "))!;
        // A common word stands for a name only when capitalised.
        if (p.common && original[0] === original[0].toLowerCase()) {
          return original;
        }
        return tokenFor("P", p.person.id, p.person.name);
      });
    }
    return t;
  });
  return { texts: out, map };
}

/** Replace matches of `re` (run on the folded text) in the original text. */
function replaceFolded(
  text: string,
  re: RegExp,
  token: (foldedMatch: string, original: string) => string,
): string {
  const chars = Array.from(text);
  const folded = foldAligned(text);
  const foldedChars = Array.from(folded);
  let result = "";
  let last = 0;
  // Work on code-point arrays: rebuild the folded string to index by code point.
  const joined = foldedChars.join("");
  re.lastIndex = 0;
  for (const m of joined.matchAll(re)) {
    const start = Array.from(joined.slice(0, m.index)).length;
    const len = Array.from(m[0]).length;
    result +=
      chars.slice(last, start).join("") +
      token(m[0], chars.slice(start, start + len).join(""));
    last = start + len;
  }
  return result + chars.slice(last).join("");
}

/** Restores the tokens of `map` in a text (themes, quotes). */
export function depseudonymize(text: string, map: PseudonymMap): string {
  return text.replace(/\[[PEN]\d+\]/g, (t) => map.get(t) ?? t);
}
