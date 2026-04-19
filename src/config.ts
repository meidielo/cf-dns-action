import * as core from '@actions/core';
import { z } from 'zod';

// RFC 1035-ish label: 1-63 chars, alphanumeric + hyphens, not leading/trailing hyphen.
const subdomainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Cloudflare zone IDs are 32 lowercase hex chars.
const zoneIdRegex = /^[a-f0-9]{32}$/;

const InputsSchema = z.object({
  subdomain: z
    .string()
    .regex(subdomainRegex, 'Invalid subdomain: must be 1-63 chars, [a-z0-9-], no leading/trailing hyphen.'),
  domain: z.string().min(3, 'Domain cannot be empty'),
  netlifySiteId: z.string().min(1, 'Netlify site ID is required'),
  netlifyAuthToken: z.string().min(1, 'Netlify auth token is required'),
  cfZoneId: z.string().regex(zoneIdRegex, 'Cloudflare zone ID must be 32 hex chars (lowercase)'),
  cfApiToken: z.string().min(1, 'Cloudflare API token is required'),
  proxied: z.boolean(),
  createOnly: z.boolean(),
  dryRun: z.boolean(),
  waitForCert: z.boolean(),
  certTimeoutSeconds: z.number().int().min(10).max(900),
});

export type ActionInputs = z.infer<typeof InputsSchema>;

function parseBool(v: string | undefined, fallback = false): boolean {
  if (!v) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function parseInt10(v: string | undefined, fallback: number): number {
  if (!v || !v.trim()) return fallback;
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function parseInputs(): ActionInputs {
  const raw = {
    subdomain: core.getInput('subdomain', { required: true }).trim().toLowerCase(),
    domain: (core.getInput('domain') || 'mdpstudio.com.au').trim().toLowerCase(),
    netlifySiteId: core.getInput('netlify-site-id', { required: true }).trim(),
    netlifyAuthToken: core.getInput('netlify-auth-token', { required: true }).trim(),
    cfZoneId: core.getInput('cf-zone-id', { required: true }).trim().toLowerCase(),
    cfApiToken: core.getInput('cf-api-token', { required: true }).trim(),
    proxied: parseBool(core.getInput('proxied'), false),
    createOnly: parseBool(core.getInput('create-only'), false),
    dryRun: parseBool(core.getInput('dry-run'), false),
    waitForCert: parseBool(core.getInput('wait-for-cert'), false),
    certTimeoutSeconds: parseInt10(core.getInput('cert-timeout-seconds'), 180),
  };

  // Mask secrets before anything can log them (e.g., a thrown zod error echoing raw input).
  if (raw.netlifyAuthToken) core.setSecret(raw.netlifyAuthToken);
  if (raw.cfApiToken) core.setSecret(raw.cfApiToken);

  const result = InputsSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid inputs: ${issues}`);
  }
  return result.data;
}

export function buildFqdn(subdomain: string, domain: string): string {
  return `${subdomain}.${domain}`;
}

// Exposed for tests.
export const __internal = { subdomainRegex, zoneIdRegex, parseBool, parseInt10, InputsSchema };
