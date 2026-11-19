import type { ParsedYesNo } from "./analysis-text";

/** Spellings of yes/no answers and how they read (TS and SQL must agree). */
export const YES_NO_CASES: [string, ParsedYesNo][] = [
  ["Sí", { answer: "yes", detail: null }],
  ["Si", { answer: "yes", detail: null }],
  ["si,", { answer: "yes", detail: null }],
  ["Yes", { answer: "yes", detail: null }],
  ["No", { answer: "no", detail: null }],
  ["NO.", { answer: "no", detail: null }],
  ["No por ahora.", { answer: "no", detail: "por ahora." }],
  [
    "Sí, participé en la campaña.",
    { answer: "yes", detail: "participé en la campaña." },
  ],
  ["  sí - reciclando  ", { answer: "yes", detail: "reciclando" }],
  ["", { answer: null, detail: null }],
  ["Nosotros reciclamos.", { answer: null, detail: "Nosotros reciclamos." }],
  ["Siempre que puedo.", { answer: null, detail: "Siempre que puedo." }],
  ["Yesterday I helped.", { answer: null, detail: "Yesterday I helped." }],
  ["Nobody asked.", { answer: null, detail: "Nobody asked." }],
];
