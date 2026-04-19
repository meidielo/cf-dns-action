import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry } from '../http';

function mkResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

describe('fetchWithRetry', () => {
  it('returns first response when 2xx (no retry)', async () => {
    const f = vi.fn(() => Promise.resolve(mkResponse(200, 'ok')));
    const res = await fetchWithRetry(f as unknown as typeof fetch, 'http://x', {}, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    const responses = [mkResponse(503), mkResponse(503), mkResponse(200, 'ok')];
    const f = vi.fn(() => Promise.resolve(responses.shift()!));
    const res = await fetchWithRetry(f as unknown as typeof fetch, 'http://x', {}, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('retries on 429', async () => {
    const responses = [mkResponse(429), mkResponse(200, 'ok')];
    const f = vi.fn(() => Promise.resolve(responses.shift()!));
    const res = await fetchWithRetry(f as unknown as typeof fetch, 'http://x', {}, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 400', async () => {
    const f = vi.fn(() => Promise.resolve(mkResponse(400)));
    const res = await fetchWithRetry(f as unknown as typeof fetch, 'http://x', {}, { sleep: noSleep });
    expect(res.status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns last response after exhausting retries', async () => {
    const f = vi.fn(() => Promise.resolve(mkResponse(503)));
    const res = await fetchWithRetry(
      f as unknown as typeof fetch,
      'http://x',
      {},
      { sleep: noSleep, retries: 2 },
    );
    expect(res.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('retries on network error then succeeds', async () => {
    let calls = 0;
    const f = vi.fn(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve(mkResponse(200, 'ok'));
    });
    const res = await fetchWithRetry(f as unknown as typeof fetch, 'http://x', {}, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('throws network error after exhausting retries', async () => {
    const f = vi.fn(() => Promise.reject(new Error('ECONNRESET')));
    await expect(
      fetchWithRetry(f as unknown as typeof fetch, 'http://x', {}, { sleep: noSleep, retries: 1 }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('applies exponential backoff delays', async () => {
    const delays: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
    const responses = [mkResponse(503), mkResponse(503), mkResponse(503), mkResponse(200)];
    const f = vi.fn(() => Promise.resolve(responses.shift()!));
    await fetchWithRetry(
      f as unknown as typeof fetch,
      'http://x',
      {},
      { sleep, initialDelayMs: 100, maxDelayMs: 10000 },
    );
    expect(delays).toEqual([100, 200, 400]);
  });
});
