export class UpstreamError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export interface JsonFetchResult<T> {
  status: number;
  ok: boolean;
  body: T;
}

const PER_ATTEMPT_TIMEOUT_MS = 10_000;

const lastHealthy = new Map<string, number>();

export function resetFailoverState() {
  lastHealthy.clear();
}

function isRetriableStatus(status: number) {
  // 401/403 from keyless public providers means provider misconfig, not data
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/**
 * Fetches and parses JSON from the first responsive base URL, rotating on
 * network errors, per-attempt timeouts, unparseable bodies, 401/403/429,
 * and 5xx. Other statuses (incl. 404) are real answers and are returned
 * with their body. Later calls start from the last URL that worked.
 * Retrying POSTs is safe while every method is read-only; guard
 * sendTransaction before it ever goes through this path.
 */
export async function fetchJsonWithFailover<T>(
  baseUrls: string[],
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<JsonFetchResult<T>> {
  const key = baseUrls.join();
  const start = lastHealthy.get(key) ?? 0;
  let lastError: unknown;

  for (let attempt = 0; attempt < baseUrls.length; attempt++) {
    const index = (start + attempt) % baseUrls.length;
    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
      : AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(baseUrls[index] + path, {
        ...init,
        signal: attemptSignal,
      });
      if (isRetriableStatus(response.status)) {
        lastError = new UpstreamError(
          `${baseUrls[index]} responded ${response.status}`,
          response.status,
        );
        await response.body?.cancel();
        continue;
      }
      const body = (await response.json()) as T;
      lastHealthy.set(key, index);
      return { status: response.status, ok: response.ok, body };
    } catch (error) {
      if (signal?.aborted) {
        throw error; // the caller cancelled; rotating would waste requests
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new UpstreamError("all upstream providers failed");
}
