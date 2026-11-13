export type BambooConfig = {
  companyDomain: string;
  apiKey: string;
  /** Defaults to https://{companyDomain}.bamboohr.com */
  baseUrl?: string;
  /** Max in-flight requests (default 4). */
  concurrency?: number;
  /** Per-request timeout in ms, covering headers and body (default 30s). */
  timeoutMs?: number;
  /** Max attempts per request including the first (default 6). */
  maxAttempts?: number;
  /** Longest Retry-After we honor; longer values fall back to backoff (default 60s). */
  maxRetryAfterMs?: number;
  /** Aborts in-flight requests and retry waits (e.g. on CLI shutdown). */
  signal?: AbortSignal;
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

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The operation was aborted");
}

/** setTimeout that rejects as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reads the body as JSON, cancelling the stream if `signal` aborts first. */
async function readJson(res: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    await res.body?.cancel().catch(() => {});
    throw abortError(signal);
  }
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      res.body?.cancel().catch(() => {});
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([res.json(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * At most `max` tasks run at once. A finishing task hands its slot directly
 * to the next waiter (no decrement/increment gap a newcomer could slip into).
 */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) active++;
    else await new Promise<void>((r) => queue.push(r));
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
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
  const maxRetryAfterMs = config.maxRetryAfterMs ?? 60_000;
  const limit = createLimiter(config.concurrency ?? 4);
  const outer = config.signal;

  return async function get(path, query = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    // `url` never contains the key; errors only ever reference it.
    const where = `GET ${url.pathname}`;
    const fail = (message: string, status: number | null = null) =>
      new BambooError(message, status, null, url.toString());

    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
      let res: Response;
      let body: unknown;
      try {
        res = await limit(async () => {
          const r = await doFetch(url, {
            method: "GET",
            headers: { Accept: "application/json", Authorization: auth },
            signal,
          });
          // Body is read under the same signal so a stalled stream times out.
          if (r.ok) body = await readJson(r, signal);
          return r;
        });
      } catch (err) {
        if (outer?.aborted || attempt >= maxAttempts) {
          throw fail(`${where} failed: ${(err as Error).message}`);
        }
        try {
          await sleep(backoffMs(attempt), outer);
        } catch (abort) {
          throw fail(`${where} aborted: ${(abort as Error).message}`);
        }
        continue;
      }

      if (res.ok) return body;
      await res.body?.cancel().catch(() => {});

      if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const wait =
          retryAfter !== null && retryAfter <= maxRetryAfterMs
            ? retryAfter
            : backoffMs(attempt);
        try {
          await sleep(wait, outer);
        } catch (abort) {
          throw fail(`${where} aborted: ${(abort as Error).message}`);
        }
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
