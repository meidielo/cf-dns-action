# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [1.0.2] - 2026-04-21

### Changed
- Action runtime `node20` → `node24` (`action.yml`). GitHub is retiring Node 20 for JavaScript actions; consumers on `@v1` / `@v1.0.2` move automatically on the next run.
- `engines.node` `>=20` → `>=24`; `@types/node` `^20.14.0` → `^24.0.0`.
- CI, release, and auto-build-dist workflows pin `actions/setup-node` to Node 24 so the `dist/` bundle is produced on the same runtime it executes on.
- Dependabot comment updated to track `engines.node` = 24.

### Note
- Consumers can validate on Node 24 ahead of the GitHub rollout by running a workflow with `env: FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` — this forces the runner to execute JS actions on Node 24 regardless of the `using:` declaration.
- Deadline for Node 20 action runtime retirement: 2026-06-02.

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
