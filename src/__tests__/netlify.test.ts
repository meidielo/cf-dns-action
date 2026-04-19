import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetlifyClient, type NetlifySite } from '../netlify';

const TOKEN = 'nfp_test';

function site(overrides: Partial<NetlifySite> = {}): NetlifySite {
  return {
    id: 'site-1',
    name: 'silly-horse-123',
    url: 'https://silly-horse-123.netlify.app',
    custom_domain: null,
    domain_aliases: [],
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(typeof input === 'string' ? input : input.toString(), init ?? {})),
  ) as unknown as typeof fetch;
}

function jsonOk<T>(body: T): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NetlifyClient.attachCustomDomain', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sets as primary custom_domain when site has none', async () => {
    const base = site({ custom_domain: null, domain_aliases: [] });
    const after = site({ custom_domain: 'myapp.mdpstudio.com.au' });
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const f = mockFetch((url, init) => {
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      if (init.method === 'GET') return jsonOk(base);
      if (init.method === 'PATCH') return jsonOk(after);
      throw new Error(`Unexpected ${init.method} ${url}`);
    });
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.attachCustomDomain({
      siteId: 'site-1',
      fqdn: 'myapp.mdpstudio.com.au',
      dryRun: false,
    });
    expect(r.action).toBe('attached');
    expect(r.netlifyUrl).toBe('silly-horse-123.netlify.app');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ custom_domain: 'myapp.mdpstudio.com.au' });
  });

  it('adds to domain_aliases when a primary already exists', async () => {
    const base = site({
      custom_domain: 'primary.example.com',
      domain_aliases: ['other.example.com'],
    });
    const after = site({
      custom_domain: 'primary.example.com',
      domain_aliases: ['other.example.com', 'myapp.mdpstudio.com.au'],
    });
    const calls: Array<{ method: string; body: unknown }> = [];
    const f = mockFetch((_url, init) => {
      calls.push({
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      if (init.method === 'GET') return jsonOk(base);
      if (init.method === 'PATCH') return jsonOk(after);
      throw new Error(`Unexpected ${init.method}`);
    });
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.attachCustomDomain({
      siteId: 'site-1',
      fqdn: 'myapp.mdpstudio.com.au',
      dryRun: false,
    });
    expect(r.action).toBe('attached');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      domain_aliases: ['other.example.com', 'myapp.mdpstudio.com.au'],
    });
  });

  it('noop when fqdn already primary', async () => {
    const base = site({ custom_domain: 'myapp.mdpstudio.com.au' });
    let patchCalled = false;
    const f = mockFetch((_url, init) => {
      if (init.method === 'PATCH') {
        patchCalled = true;
      }
      return jsonOk(base);
    });
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.attachCustomDomain({
      siteId: 'site-1',
      fqdn: 'myapp.mdpstudio.com.au',
      dryRun: false,
    });
    expect(r.action).toBe('already-attached');
    expect(patchCalled).toBe(false);
  });

  it('noop when fqdn already in aliases', async () => {
    const base = site({
      custom_domain: 'primary.example.com',
      domain_aliases: ['myapp.mdpstudio.com.au'],
    });
    const f = mockFetch(() => jsonOk(base));
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.attachCustomDomain({
      siteId: 'site-1',
      fqdn: 'myapp.mdpstudio.com.au',
      dryRun: false,
    });
    expect(r.action).toBe('already-attached');
  });

  it('dry-run: does not PATCH', async () => {
    const base = site();
    let patchCalled = false;
    const f = mockFetch((_url, init) => {
      if (init.method === 'PATCH') patchCalled = true;
      return jsonOk(base);
    });
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.attachCustomDomain({
      siteId: 'site-1',
      fqdn: 'myapp.mdpstudio.com.au',
      dryRun: true,
    });
    expect(r.action).toBe('skipped');
    expect(patchCalled).toBe(false);
  });

  it('surfaces HTTP errors', async () => {
    const f = mockFetch(
      () => new Response('unauthorized', { status: 401 }),
    );
    const nl = new NetlifyClient(TOKEN, f);
    await expect(
      nl.attachCustomDomain({
        siteId: 'site-1',
        fqdn: 'myapp.mdpstudio.com.au',
        dryRun: false,
      }),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe('NetlifyClient.waitForSslProvisioned', () => {
  beforeEach(() => vi.restoreAllMocks());

  const noSleep = (_ms: number): Promise<void> => Promise.resolve();

  it('returns provisioned on first poll when already ready', async () => {
    const f = mockFetch(() => jsonOk({ state: 'provisioned', domains: [] }));
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.waitForSslProvisioned('site-1', {
      timeoutMs: 10_000,
      sleep: noSleep,
    });
    expect(r.provisioned).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.attempts).toBe(1);
  });

  it('polls until provisioned', async () => {
    const states = ['provisioning', 'provisioning', 'provisioned'];
    const f = mockFetch(() => jsonOk({ state: states.shift(), domains: [] }));
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.waitForSslProvisioned('site-1', {
      timeoutMs: 60_000,
      pollIntervalMs: 100,
      sleep: noSleep,
    });
    expect(r.provisioned).toBe(true);
    expect(r.attempts).toBe(3);
  });

  it('throws on failed state', async () => {
    const f = mockFetch(() => jsonOk({ state: 'failed', domains: [] }));
    const nl = new NetlifyClient(TOKEN, f);
    await expect(
      nl.waitForSslProvisioned('site-1', { timeoutMs: 10_000, sleep: noSleep }),
    ).rejects.toThrow(/provisioning failed/);
  });

  it('times out when never provisioned', async () => {
    const f = mockFetch(() => jsonOk({ state: 'provisioning', domains: [] }));
    let clock = 0;
    const now = () => clock;
    const sleep = (ms: number): Promise<void> => {
      clock += ms;
      return Promise.resolve();
    };
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.waitForSslProvisioned('site-1', {
      timeoutMs: 1000,
      pollIntervalMs: 400,
      sleep,
      now,
    });
    expect(r.provisioned).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.state).toBe('provisioning');
  });

  it('case-insensitive on state values', async () => {
    const f = mockFetch(() => jsonOk({ state: 'PROVISIONED', domains: [] }));
    const nl = new NetlifyClient(TOKEN, f);
    const r = await nl.waitForSslProvisioned('site-1', {
      timeoutMs: 10_000,
      sleep: noSleep,
    });
    expect(r.provisioned).toBe(true);
  });
});
