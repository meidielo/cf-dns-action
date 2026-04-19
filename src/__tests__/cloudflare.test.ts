import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareClient, type DnsRecord } from '../cloudflare';

const ZONE = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf_test_token';

function makeRecord(overrides: Partial<DnsRecord> = {}): DnsRecord {
  return {
    id: 'rec-1',
    type: 'CNAME',
    name: 'myapp.mdpstudio.com.au',
    content: 'site.netlify.app',
    ttl: 1,
    proxied: false,
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(typeof input === 'string' ? input : input.toString(), init ?? {})),
  ) as unknown as typeof fetch;
}

function ok<T>(result: T): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(status: number, errors: Array<{ code: number; message: string }>): Response {
  return new Response(
    JSON.stringify({ success: false, errors, messages: [], result: null }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('CloudflareClient', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('verifyToken', () => {
    it('passes when status is active', async () => {
      const f = mockFetch(() => ok({ id: 't', status: 'active' }));
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      await expect(cf.verifyToken()).resolves.toBeUndefined();
    });

    it('fails when status is not active', async () => {
      const f = mockFetch(() => ok({ id: 't', status: 'disabled' }));
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      await expect(cf.verifyToken()).rejects.toThrow(/disabled/);
    });

    it('surfaces API errors with code + message', async () => {
      const f = mockFetch(() => fail(401, [{ code: 10000, message: 'Unauthorized' }]));
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      await expect(cf.verifyToken()).rejects.toThrow(/\[10000\].*Unauthorized/);
    });
  });

  describe('upsertCname', () => {
    it('noop when record matches target + proxied', async () => {
      const existing = makeRecord({ content: 'site.netlify.app', proxied: false });
      const f = mockFetch((url) => {
        if (url.includes('/dns_records?')) return ok([existing]);
        throw new Error(`Unexpected call to ${url}`);
      });
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      const r = await cf.upsertCname({
        fqdn: 'myapp.mdpstudio.com.au',
        target: 'site.netlify.app',
        proxied: false,
        createOnly: false,
        dryRun: false,
      });
      expect(r.action).toBe('noop');
      expect(r.record).toEqual(existing);
    });

    it('creates when record does not exist', async () => {
      const created = makeRecord({ id: 'new-id' });
      const f = mockFetch((url, init) => {
        if (init.method === 'GET' && url.includes('/dns_records?')) return ok([]);
        if (init.method === 'POST' && url.endsWith('/dns_records')) return ok(created);
        throw new Error(`Unexpected call ${init.method} ${url}`);
      });
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      const r = await cf.upsertCname({
        fqdn: 'myapp.mdpstudio.com.au',
        target: 'site.netlify.app',
        proxied: false,
        createOnly: false,
        dryRun: false,
      });
      expect(r.action).toBe('created');
      expect(r.record?.id).toBe('new-id');
    });

    it('updates when record exists with different target', async () => {
      const existing = makeRecord({ content: 'old.netlify.app' });
      const updated = makeRecord({ content: 'new.netlify.app' });
      const f = mockFetch((url, init) => {
        if (init.method === 'GET') return ok([existing]);
        if (init.method === 'PUT') return ok(updated);
        throw new Error(`Unexpected call ${init.method} ${url}`);
      });
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      const r = await cf.upsertCname({
        fqdn: 'myapp.mdpstudio.com.au',
        target: 'new.netlify.app',
        proxied: false,
        createOnly: false,
        dryRun: false,
      });
      expect(r.action).toBe('updated');
      expect(r.record?.content).toBe('new.netlify.app');
    });

    it('refuses to update when create-only is true', async () => {
      const existing = makeRecord({ content: 'old.netlify.app' });
      const f = mockFetch(() => ok([existing]));
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      await expect(
        cf.upsertCname({
          fqdn: 'myapp.mdpstudio.com.au',
          target: 'new.netlify.app',
          proxied: false,
          createOnly: true,
          dryRun: false,
        }),
      ).rejects.toThrow(/create-only=true/);
    });

    it('dry-run: does not write, returns "skipped"', async () => {
      const existing = makeRecord({ content: 'old.netlify.app' });
      const f = mockFetch((_url, init) => {
        if (init.method === 'GET') return ok([existing]);
        throw new Error(`Unexpected ${init.method} in dry-run`);
      });
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      const r = await cf.upsertCname({
        fqdn: 'myapp.mdpstudio.com.au',
        target: 'new.netlify.app',
        proxied: false,
        createOnly: false,
        dryRun: true,
      });
      expect(r.action).toBe('skipped');
    });

    it('retries on 503 and eventually succeeds', async () => {
      const existing = makeRecord();
      const responses = [
        new Response('', { status: 503 }),
        new Response('', { status: 503 }),
        ok([existing]),
      ];
      const f = vi.fn(() =>
        Promise.resolve(responses.shift()!),
      ) as unknown as typeof fetch;
      const cf = new CloudflareClient(TOKEN, ZONE, f, {
        sleep: () => Promise.resolve(),
      });
      const r = await cf.upsertCname({
        fqdn: 'myapp.mdpstudio.com.au',
        target: 'site.netlify.app',
        proxied: false,
        createOnly: false,
        dryRun: false,
      });
      expect(r.action).toBe('noop');
      expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(3);
    });

    it('updates when proxied flag differs', async () => {
      const existing = makeRecord({ content: 'site.netlify.app', proxied: true });
      const updated = makeRecord({ content: 'site.netlify.app', proxied: false });
      const f = mockFetch((_url, init) => {
        if (init.method === 'GET') return ok([existing]);
        if (init.method === 'PUT') return ok(updated);
        throw new Error(`Unexpected ${init.method}`);
      });
      const cf = new CloudflareClient(TOKEN, ZONE, f);
      const r = await cf.upsertCname({
        fqdn: 'myapp.mdpstudio.com.au',
        target: 'site.netlify.app',
        proxied: false,
        createOnly: false,
        dryRun: false,
      });
      expect(r.action).toBe('updated');
    });
  });
});
