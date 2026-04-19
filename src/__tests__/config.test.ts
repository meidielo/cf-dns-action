import { describe, it, expect } from 'vitest';
import { __internal, buildFqdn } from '../config';

const { InputsSchema, subdomainRegex, zoneIdRegex, parseBool } = __internal;

describe('subdomain regex', () => {
  it.each([
    ['myapp', true],
    ['my-app', true],
    ['a', true],
    ['a1', true],
    ['abc-123-xyz', true],
  ])('accepts %s', (s, ok) => {
    expect(subdomainRegex.test(s)).toBe(ok);
  });

  it.each([
    ['-myapp', false], // leading hyphen
    ['myapp-', false], // trailing hyphen
    ['My-App', false], // uppercase
    ['my_app', false], // underscore
    ['a.b', false], // dot
    ['', false],
    ['a'.repeat(64), false], // too long
  ])('rejects %s', (s, ok) => {
    expect(subdomainRegex.test(s)).toBe(ok);
  });
});

describe('zone id regex', () => {
  it('accepts 32 lowercase hex', () => {
    expect(zoneIdRegex.test('0123456789abcdef0123456789abcdef')).toBe(true);
  });
  it('rejects uppercase', () => {
    expect(zoneIdRegex.test('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(zoneIdRegex.test('deadbeef')).toBe(false);
  });
});

describe('parseBool', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['TRUE', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', false],
    ['anything-else', false],
  ])('parses %s as %s', (input, expected) => {
    expect(parseBool(input)).toBe(expected);
  });

  it('uses fallback when empty', () => {
    expect(parseBool('', true)).toBe(true);
    expect(parseBool(undefined, true)).toBe(true);
  });
});

describe('InputsSchema', () => {
  const valid = {
    subdomain: 'myapp',
    domain: 'mdpstudio.com.au',
    netlifySiteId: 'abc-123',
    netlifyAuthToken: 'nfp_xxx',
    cfZoneId: '0123456789abcdef0123456789abcdef',
    cfApiToken: 'cf_xxx',
    proxied: false,
    createOnly: false,
    dryRun: false,
    waitForCert: false,
    certTimeoutSeconds: 180,
  };

  it('accepts valid inputs', () => {
    expect(InputsSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects bad subdomain', () => {
    const r = InputsSchema.safeParse({ ...valid, subdomain: 'Bad_Name' });
    expect(r.success).toBe(false);
  });

  it('rejects bad zone id', () => {
    const r = InputsSchema.safeParse({ ...valid, cfZoneId: 'not-hex' });
    expect(r.success).toBe(false);
  });

  it('rejects missing tokens', () => {
    const r = InputsSchema.safeParse({ ...valid, cfApiToken: '' });
    expect(r.success).toBe(false);
  });

  it('rejects cert-timeout below min', () => {
    const r = InputsSchema.safeParse({ ...valid, certTimeoutSeconds: 5 });
    expect(r.success).toBe(false);
  });

  it('rejects cert-timeout above max', () => {
    const r = InputsSchema.safeParse({ ...valid, certTimeoutSeconds: 10_000 });
    expect(r.success).toBe(false);
  });
});

describe('parseInt10', () => {
  const { parseInt10 } = __internal;
  it('returns fallback for empty/undefined', () => {
    expect(parseInt10('', 42)).toBe(42);
    expect(parseInt10(undefined, 42)).toBe(42);
  });
  it('parses valid integers', () => {
    expect(parseInt10('180', 0)).toBe(180);
    expect(parseInt10(' 30 ', 0)).toBe(30);
  });
  it('returns fallback for non-numeric', () => {
    expect(parseInt10('abc', 99)).toBe(99);
  });
});

describe('buildFqdn', () => {
  it('joins subdomain and domain with a dot', () => {
    expect(buildFqdn('myapp', 'mdpstudio.com.au')).toBe('myapp.mdpstudio.com.au');
  });
});
