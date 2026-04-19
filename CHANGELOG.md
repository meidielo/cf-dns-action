# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [1.0.0] - 2026-04-19

### Added
- `CloudflareClient.upsertCname` — idempotent CNAME create/update.
- `NetlifyClient.attachCustomDomain` — attach as primary `custom_domain` if none exists, otherwise append to `domain_aliases`.
- `NetlifyClient.waitForSslProvisioned` — optional polling loop for Let's Encrypt cert readiness. Gated by `wait-for-cert` input; configurable timeout via `cert-timeout-seconds` (10–900, default 180). New `ssl-state` and `ssl-provisioned` outputs.
- Shared `fetchWithRetry` HTTP helper — 3 retries with exponential backoff (500 ms → 1 s → 2 s, capped at 4 s) on `429`, `502`, `503`, `504`, and network errors. Used by both clients.
- Pre-flight token verification for both Cloudflare and Netlify.
- `dry-run` and `create-only` safety modes.
- Input validation via zod (subdomain regex, zone-id format, required fields).
- Secret masking for tokens.
- CI workflow with lint, typecheck, vitest, ncc build, and `dist/` drift check.
- Auto-rebuild-dist workflow — rebuilds and commits `dist/` when source lands on `main` without a matching bundle (safety net for the CI drift check).
- Release workflow with auto-moving major tag (`v1`).
