import { createHash } from "node:crypto";
import { fold } from "./dimension";

/** Text as hashed: folded case/accents, collapsed whitespace, trimmed. */
export const normalizeText = (text: string) =>
  fold(text).replace(/\s+/g, " ").trim();

/** sha256 (hex) of the normalized text: the cache and import key. */
export const textHash = (text: string) =>
  createHash("sha256").update(normalizeText(text)).digest("hex");
