import * as core from '@actions/core';

export interface RetryOpts {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thin fetch wrapper. Retries retryable HTTP status codes and network errors
 * with exponential backoff. First-call success is zero-overhead so existing
 * tests with single-call mocks continue to pass.
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: RetryOpts = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const initialDelay = opts.initialDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 4000;
  const retryOn = opts.retryOn ?? DEFAULT_RETRY_STATUSES;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (res.ok || !retryOn.includes(res.status) || attempt === retries) {
        return res;
      }
      core.debug(`HTTP ${res.status} on ${init.method ?? 'GET'} ${url}; retry ${attempt + 1}/${retries}`);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
      core.debug(`Network error on ${init.method ?? 'GET'} ${url}: ${String(err)}; retry ${attempt + 1}/${retries}`);
    }
    const delay = Math.min(initialDelay * 2 ** attempt, maxDelay);
    await sleep(delay);
  }
  // Unreachable: loop either returns or throws. Keep TS happy.
  throw lastErr ?? new Error('fetchWithRetry: exhausted without response');
}
