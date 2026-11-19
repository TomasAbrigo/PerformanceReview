import { type SQL, sql } from "drizzle-orm";
import type { YesNo } from "./constants";

/**
 * What counts as part of a word right after a yes/no token: "Siempre" is not
 * a "Sí" and "Nosotros" is not a "No". Spelled out (both cases, Spanish
 * accents) so JavaScript and Postgres read it the same whatever the locale.
 */
const WORD = "a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ";
/** The yes/no token: Sí / Si / Yes / No, any case. */
const TOKEN = "[sS][iIíÍ]|[yY][eE][sS]|[nN][oO]";
/** What may separate the token from the "how": spaces and punctuation. */
const SEP = " \\t\\r\\n.,;:!¡?¿()–—-";

/** JS: group 1 the token, group 2 the rest (the "how"). */
const YES_NO_JS = new RegExp(
  `^\\s*(${TOKEN})(?![${WORD}])[${SEP}]*([\\s\\S]*)$`,
);
/** Postgres ARE twin: the text starts with a yes/no token. */
export const YES_NO_START_SQL = `^[[:space:]]*(${TOKEN})([^${WORD}]|$)`;
/** Postgres ARE twin: the token and what separates it from the "how". */
const YES_NO_PREFIX_SQL = `^[[:space:]]*(${TOKEN})[${SEP}]*`;
const HAS_WORD = new RegExp(`[${WORD}]`);

/** A bare yes or no, in Spanish or English, with or without a final mark. */
export const YES_NO = "^\\s*(s[ií]|no|yes)\\s*[.!]?\\s*$";

/** Whether an answer is only a yes or a no (see `YES_NO`). */
export const isYesNo = (text: string): boolean =>
  new RegExp(YES_NO, "i").test(text);

export type ParsedYesNo = { answer: YesNo | null; detail: string | null };

/**
 * Reads the answer to a yes/no question: "Sí, participé en…" →
 * {answer: "yes", detail: "participé en…"}; "No por ahora." → {answer: "no",
 * detail: "por ahora."}; "NO." → {answer: "no", detail: null}. A text that
 * does not start with a yes/no token ("Nosotros…", "Siempre…") is all
 * detail. Its SQL twins are yesNoTokenSql / yesNoDetailSql (a test keeps
 * them in agreement).
 */
export function parseYesNo(text: string | null | undefined): ParsedYesNo {
  const raw = text ?? "";
  const m = YES_NO_JS.exec(raw);
  if (!m) {
    const t = raw.trim();
    return { answer: null, detail: t && HAS_WORD.test(t) ? t : null };
  }
  const answer: YesNo = /^[nN]/.test(m[1]) ? "no" : "yes";
  const rest = m[2].trim();
  return { answer, detail: rest && HAS_WORD.test(rest) ? rest : null };
}

/** SQL: 'yes' | 'no' | null, the yes/no token a text starts with. */
export function yesNoTokenSql(text: SQL): SQL {
  return sql`(case when ${text} ~ ${YES_NO_START_SQL}
    then case when ${text} ~ '^[[:space:]]*[nN]' then 'no' else 'yes' end end)`;
}

/** SQL: the "how" after the yes/no token (null when it has no word). */
export function yesNoDetailSql(text: SQL): SQL {
  const rest = sql`btrim(case when ${text} ~ ${YES_NO_START_SQL}
    then regexp_replace(${text}, ${YES_NO_PREFIX_SQL}, '') else ${text} end)`;
  return sql`(case when ${rest} ~ ${`[${WORD}]`} then ${rest} end)`;
}

/**
 * SQL (public contract for the screens, #129): the yes/no answer of answer
 * `a` to question revision `q`: 'yes' | 'no', null when the question is not
 * a yes/no one or the answer says neither. A closed yes/no question (the
 * template's) stores the chosen option ('yes'/'no') in option_label; an
 * imported one stores the text ("Sí, …").
 */
export function yesNoAnswerSql(a = "a", q = "q"): SQL {
  const A = sql.raw(a);
  const Q = sql.raw(q);
  return sql`(case when ${Q}.yes_no then coalesce(
    case when ${A}.option_label in ('yes', 'no') then ${A}.option_label end,
    ${yesNoTokenSql(sql`${A}.text_value`)}) end)`;
}

/**
 * SQL expression: the text the qualitative analysis reads for answer `a` of
 * question revision `q` (aliases of the surrounding query), null when there
 * is nothing to read. Only free text is read (#128):
 *
 * - A yes/no question: the "how" after the yes/no ("Sí, con el
 *   voluntariado…" → "con el voluntariado…"); a bare yes/no is nothing.
 * - Any other question: the text as typed (an open answer, or the text typed
 *   next to a closed option, "Other: …"), unless it is a bare yes or no.
 * - The chosen option of a closed question is never read.
 *
 * Its md5 keys the stale check of a label.
 */
export function analysisTextSql(a = "a", q = "q"): SQL {
  const A = sql.raw(a);
  const Q = sql.raw(q);
  const typed = sql`case when btrim(${A}.text_value) <> ''
    and btrim(${A}.text_value) !~* ${YES_NO} then ${A}.text_value end`;
  return sql`(case when ${Q}.yes_no then ${yesNoDetailSql(sql`${A}.text_value`)}
    else ${typed} end)`;
}

/** SQL predicate: the answer has free text to read (analysisTextSql). */
export function analyzableSql(a = "a", q = "q"): SQL {
  return sql`(${analysisTextSql(a, q)} is not null)`;
}
