# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [1.0.1] - 2026-04-19

### Security
- Bump `@actions/core` `^1.11.1` → `^2.0.3`. Transitively patches `@actions/http-client` to `^3.0.2` and `undici` to `^6.23.0`, resolving 1 high + 1 moderate runtime advisories (HTTP Request Smuggling, unbounded decompression, WebSocket memory consumption, CRLF injection — all in `undici`).
- Bump `vitest` `^2.0.5` → `^4.1.4`. Transitively patches `vite`, `vite-node`, `@vitest/mocker`, `esbuild` — 5 dev-only moderate advisories (all clear after upgrade).
- Post-upgrade `npm audit` reports 0 vulnerabilities.

### Added
- `.github/dependabot.yml` — weekly npm + github-actions updates, grouped by prod vs dev for cleaner review.

### Note
- `@actions/core@3.x` is ESM-only and incompatible with the current `ncc` CJS bundler config. Staying on `2.x` for the CJS bundle; revisit when migrating the bundle to ESM.
- The bundled `dist/index.js` grew ~8.5% due to the newer `undici` ESM-via-interop code path. Consumers pinning `@v1.0.0` will keep the old (vulnerable) bundle; `@v1` and `@v1.0.1` get the patched one.

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
