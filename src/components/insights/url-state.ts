// Helpers to read URL params (filters live in the URL, never in state).
export const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
export const pick = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(v as T) ? (v as T) : fallback);
