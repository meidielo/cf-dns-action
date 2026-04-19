import * as core from '@actions/core';
import { fetchWithRetry, RetryOpts } from './http';

const API = 'https://api.cloudflare.com/client/v4';

export type CfAction = 'created' | 'updated' | 'noop' | 'skipped';

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

export interface UpsertOpts {
  fqdn: string;
  target: string;
  proxied: boolean;
  createOnly: boolean;
  dryRun: boolean;
}

export interface UpsertResult {
  record: DnsRecord | null;
  action: CfAction;
}

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly zoneId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryOpts: RetryOpts = {},
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<CfResponse<T>> {
    const res = await fetchWithRetry(
      this.fetchImpl,
      `${API}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      this.retryOpts,
    );
    // Try to parse JSON even on error; CF returns structured errors.
    let json: CfResponse<T> | undefined;
    try {
      json = (await res.json()) as CfResponse<T>;
    } catch {
      // ignore
    }
    if (!res.ok || !json?.success) {
      const errs = (json?.errors ?? []).map((e) => `[${e.code}] ${e.message}`).join('; ');
      throw new Error(
        `Cloudflare API ${method} ${path} failed (HTTP ${res.status}): ${errs || 'unknown error'}`,
      );
    }
    return json;
  }

  async verifyToken(): Promise<void> {
    type TokenInfo = { id: string; status: string };
    const r = await this.request<TokenInfo>('GET', '/user/tokens/verify');
    if (r.result.status !== 'active') {
      throw new Error(`Cloudflare token status is "${r.result.status}" (expected "active")`);
    }
  }

  async findCname(fqdn: string): Promise<DnsRecord | null> {
    const q = new URLSearchParams({ type: 'CNAME', name: fqdn });
    const r = await this.request<DnsRecord[]>(
      'GET',
      `/zones/${this.zoneId}/dns_records?${q.toString()}`,
    );
    return r.result[0] ?? null;
  }

  async createCname(fqdn: string, target: string, proxied: boolean): Promise<DnsRecord> {
    const r = await this.request<DnsRecord>('POST', `/zones/${this.zoneId}/dns_records`, {
      type: 'CNAME',
      name: fqdn,
      content: target,
      ttl: 1, // auto
      proxied,
    });
    return r.result;
  }

  async updateCname(
    id: string,
    fqdn: string,
    target: string,
    proxied: boolean,
  ): Promise<DnsRecord> {
    const r = await this.request<DnsRecord>(
      'PUT',
      `/zones/${this.zoneId}/dns_records/${id}`,
      { type: 'CNAME', name: fqdn, content: target, ttl: 1, proxied },
    );
    return r.result;
  }

  async upsertCname(opts: UpsertOpts): Promise<UpsertResult> {
    const { fqdn, target, proxied, createOnly, dryRun } = opts;
    const existing = await this.findCname(fqdn);

    if (existing && existing.content === target && existing.proxied === proxied) {
      core.info(`CF: ${fqdn} already -> ${target} (noop)`);
      return { record: existing, action: 'noop' };
    }

    if (existing && createOnly) {
      throw new Error(
        `CF record ${fqdn} exists pointing to ${existing.content}; refusing to update because create-only=true.`,
      );
    }

    if (dryRun) {
      core.info(
        `CF DRY-RUN: would ${existing ? 'update' : 'create'} ${fqdn} -> ${target} (proxied=${proxied})`,
      );
      return { record: existing, action: 'skipped' };
    }

    if (existing) {
      const updated = await this.updateCname(existing.id, fqdn, target, proxied);
      core.info(`CF: updated ${fqdn} -> ${target}`);
      return { record: updated, action: 'updated' };
    }

    const created = await this.createCname(fqdn, target, proxied);
    core.info(`CF: created ${fqdn} -> ${target}`);
    return { record: created, action: 'created' };
  }
}
