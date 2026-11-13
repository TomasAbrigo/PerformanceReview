export type BambooConfig = {
  companyDomain: string;
  apiKey: string;
  /** Defaults to https://{companyDomain}.bamboohr.com */
  baseUrl?: string;
  /** Max in-flight requests (default 4). */
  concurrency?: number;
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Max attempts per request including the first (default 6). */
  maxAttempts?: number;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
};

export class BambooError extends Error {
  readonly name = "BambooError";
  constructor(
    message: string,
    readonly status: number | null,
    readonly bambooMessage: string | null,
    readonly url: string,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503]);

/** Seconds or HTTP-date → ms; null if absent/invalid. */
export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  return Math.min(30_000, base) * (0.5 + Math.random() / 2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

export type HttpGet = (
  path: string,
  query?: Record<string, string | undefined>,
) => Promise<unknown>;

export function createHttp(config: BambooConfig): HttpGet {
  const doFetch = config.fetch ?? fetch;
  const baseUrl = (
    config.baseUrl ?? `https://${config.companyDomain}.bamboohr.com`
  ).replace(/\/$/, "");
  const auth = `Basic ${Buffer.from(`${config.apiKey}:x`).toString("base64")}`;
  const timeoutMs = config.timeoutMs ?? 30_000;
  const maxAttempts = config.maxAttempts ?? 6;
  const limit = createLimiter(config.concurrency ?? 4);

  return async function get(path, query = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    // `url` never contains the key; errors only ever reference it.
    const where = `GET ${url.pathname}`;

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await limit(() =>
          doFetch(url, {
            method: "GET",
            headers: { Accept: "application/json", Authorization: auth },
            signal: AbortSignal.timeout(timeoutMs),
          }),
        );
      } catch (err) {
        if (attempt >= maxAttempts) {
          throw new BambooError(
            `${where} failed: ${(err as Error).message}`,
            null,
            null,
            url.toString(),
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      if (res.ok) return res.json();

      if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
        await res.body?.cancel();
        const wait =
          parseRetryAfter(res.headers.get("retry-after")) ?? backoffMs(attempt);
        await sleep(wait);
        continue;
      }

      const bambooMessage = res.headers.get("x-bamboohr-error-message");
      throw new BambooError(
        `${where} → ${res.status}${bambooMessage ? `: ${bambooMessage}` : ""}`,
        res.status,
        bambooMessage,
        url.toString(),
      );
    }
  };
}
