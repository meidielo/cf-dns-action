import * as core from '@actions/core';
import { fetchWithRetry, RetryOpts } from './http';

const API = 'https://api.netlify.com/api/v1';

export type NetlifyAction = 'attached' | 'already-attached' | 'skipped';

export interface NetlifySslInfo {
  state: string;
  domains: string[];
  expires_at?: string;
}

export interface WaitForSslResult {
  state: string;
  provisioned: boolean;
  timedOut: boolean;
  attempts: number;
}

export interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url?: string;
  custom_domain: string | null;
  domain_aliases: string[] | null;
}

export interface AttachOpts {
  siteId: string;
  fqdn: string;
  dryRun: boolean;
}

export interface AttachResult {
  site: NetlifySite;
  action: NetlifyAction;
  netlifyUrl: string; // <site-name>.netlify.app — CNAME target for Cloudflare
}

export class NetlifyClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryOpts: RetryOpts = {},
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        // ignore
      }
      throw new Error(
        `Netlify API ${method} ${path} failed (HTTP ${res.status}): ${detail || 'no body'}`,
      );
    }
    // DELETE returns 204 with empty body.
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  async verifyToken(): Promise<void> {
    await this.request<{ id: string; email: string }>('GET', '/user');
  }

  async getSite(siteId: string): Promise<NetlifySite> {
    return this.request<NetlifySite>('GET', `/sites/${siteId}`);
  }

  async patchSite(siteId: string, patch: Partial<NetlifySite>): Promise<NetlifySite> {
    return this.request<NetlifySite>('PATCH', `/sites/${siteId}`, patch);
  }

  async attachCustomDomain(opts: AttachOpts): Promise<AttachResult> {
    const { siteId, fqdn, dryRun } = opts;
    const site = await this.getSite(siteId);
    const netlifyUrl = `${site.name}.netlify.app`;
    const aliases = site.domain_aliases ?? [];

    const already = site.custom_domain === fqdn || aliases.includes(fqdn);
    if (already) {
      core.info(`Netlify: ${fqdn} already attached to site "${site.name}"`);
      return { site, action: 'already-attached', netlifyUrl };
    }

    if (dryRun) {
      core.info(`Netlify DRY-RUN: would attach ${fqdn} to site "${site.name}"`);
      return { site, action: 'skipped', netlifyUrl };
    }

    // If the site has no primary custom domain yet, claim this as primary.
    // Otherwise add as an alias. (Netlify allows exactly one primary + many aliases.)
    const patch: Partial<NetlifySite> = !site.custom_domain
      ? { custom_domain: fqdn }
      : { domain_aliases: [...aliases, fqdn] };

    const updated = await this.patchSite(siteId, patch);
    core.info(
      `Netlify: attached ${fqdn} to site "${site.name}" as ${
        !site.custom_domain ? 'primary custom_domain' : 'alias'
      }`,
    );
    return { site: updated, action: 'attached', netlifyUrl };
  }

  async getSsl(siteId: string): Promise<NetlifySslInfo> {
    return this.request<NetlifySslInfo>('GET', `/sites/${siteId}/ssl`);
  }

  /**
   * Poll Netlify's SSL endpoint until the cert is provisioned, timeout fires,
   * or the state transitions to `failed`. Cold-start provisioning typically
   * completes in 30-90 seconds.
   */
  async waitForSslProvisioned(
    siteId: string,
    opts: {
      timeoutMs: number;
      pollIntervalMs?: number;
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    },
  ): Promise<WaitForSslResult> {
    const pollInterval = opts.pollIntervalMs ?? 5000;
    const sleep =
      opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = opts.now ?? Date.now;
    const deadline = now() + opts.timeoutMs;

    let attempts = 0;
    let lastState = 'unknown';
    while (now() < deadline) {
      attempts++;
      const info = await this.getSsl(siteId);
      lastState = (info.state || '').toLowerCase();
      core.info(`Netlify SSL state (attempt ${attempts}): ${lastState}`);
      if (lastState === 'provisioned') {
        return { state: lastState, provisioned: true, timedOut: false, attempts };
      }
      if (lastState === 'failed') {
        throw new Error(`Netlify SSL provisioning failed after ${attempts} poll(s)`);
      }
      if (now() + pollInterval >= deadline) break;
      await sleep(pollInterval);
    }
    return { state: lastState, provisioned: false, timedOut: true, attempts };
  }
}
