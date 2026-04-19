# cf-dns-action

GitHub Action that registers a custom domain in Netlify and creates/updates a matching Cloudflare CNAME record.

- Idempotent: safe to run on every push. Does nothing if the state is already correct.
- Single responsibility: attach domain in Netlify + upsert DNS in Cloudflare. No deploy logic — your existing Netlify git integration (or a separate deploy step) handles that.
- Scoped-token friendly: Cloudflare token only needs `Zone -> DNS -> Edit` on the target zone.

## Usage

Minimal workflow in a consuming repo:

```yaml
name: DNS sync
on:
  push:
    branches: [main]

jobs:
  dns:
    runs-on: ubuntu-latest
    steps:
      - uses: meidielo/cf-dns-action@v1
        with:
          subdomain: myapp
          netlify-site-id: ${{ secrets.NETLIFY_SITE_ID }}
          netlify-auth-token: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          cf-zone-id: ${{ secrets.CF_ZONE_ID }}
          cf-api-token: ${{ secrets.CF_API_TOKEN }}
```

Result: `myapp.mdpstudio.com.au` is attached as a custom domain on the Netlify site, a CNAME is created in Cloudflare pointing to `<site-name>.netlify.app`, and Let's Encrypt provisions a cert within a few minutes.

See `examples/project-workflow.yml` for a more complete example.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `subdomain` | yes | — | Subdomain label. Must match `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`. |
| `domain` | no | `mdpstudio.com.au` | Apex domain. |
| `netlify-site-id` | yes | — | Netlify site API ID (Site settings -> General -> Site details). |
| `netlify-auth-token` | yes | — | Netlify personal access token. |
| `cf-zone-id` | yes | — | Cloudflare Zone ID (32 hex chars). |
| `cf-api-token` | yes | — | Cloudflare API token scoped to `Zone -> DNS -> Edit` on the target zone. |
| `proxied` | no | `false` | Enable Cloudflare orange-cloud proxy. Keep `false` for Netlify. |
| `create-only` | no | `false` | Fail instead of updating an existing record with a different target. |
| `dry-run` | no | `false` | Log intended changes without writing. |
| `wait-for-cert` | no | `false` | Poll Netlify until the SSL cert is provisioned before returning. Use when a downstream step must hit the HTTPS URL. |
| `cert-timeout-seconds` | no | `180` | Max seconds to wait for cert (range 10–900). Ignored unless `wait-for-cert: true`. A timeout is logged as a warning, not a failure. |

## Outputs

| Output | Description |
|--------|-------------|
| `fqdn` | The full domain, e.g. `myapp.mdpstudio.com.au`. |
| `cf-record-id` | Cloudflare DNS record ID. |
| `cf-action` | One of: `created`, `updated`, `noop`, `skipped`. |
| `netlify-action` | One of: `attached`, `already-attached`, `skipped`. |
| `netlify-url` | `<site-name>.netlify.app`. |
| `ssl-state` | Final SSL cert state (e.g., `provisioned`). Empty unless `wait-for-cert: true`. |
| `ssl-provisioned` | `true` / `false`. Empty unless `wait-for-cert: true`. |

## One-time setup

### Cloudflare API token

1. Go to **My Profile -> API Tokens -> Create Token -> Custom token**.
2. Permissions: `Zone -> DNS -> Edit`.
3. Zone resources: `Include -> Specific zone -> <your apex domain>`.
4. Client IP filtering (optional but recommended): limit to GitHub Actions runners' IP ranges if you want belt-and-braces. Less practical because the ranges are large and change.
5. TTL: leave unset (non-expiring) or set to 1 year and rotate.

**Do NOT use the Global API Key.** If the token leaks, scoped access limits blast radius.

### Netlify auth token

1. **User settings -> OAuth -> Personal access tokens -> New access token**.
2. Netlify does not yet offer scoped tokens — this token has full account access. Treat as highly sensitive: use a dedicated token for CI, rotate regularly.
3. Optional: create this under a dedicated service/bot user if your Netlify team supports it.

### Netlify site ID

`Site settings -> General -> Site details -> Site ID` (a UUID).

### Cloudflare Zone ID

Right sidebar of the zone's overview page in the Cloudflare dashboard (32 hex chars).

### GitHub secrets

In each consuming repo:

- `NETLIFY_AUTH_TOKEN`
- `NETLIFY_SITE_ID`
- `CF_API_TOKEN`
- `CF_ZONE_ID`

If you'd rather centralise, put these in a GitHub **organisation** secret and restrict by repo.

## Why `proxied` defaults to `false`

Cloudflare's orange-cloud proxy terminates TLS at Cloudflare's edge. Netlify issues its own Let's Encrypt cert via the HTTP-01 challenge, which hits the origin directly. With the proxy on, the challenge traffic doesn't reach Netlify and cert issuance fails. Keep the record grey-cloud unless you have a specific reason and understand the tradeoffs (Full (strict) mode + self-configured origin cert, etc.).

## Idempotency contract

| Initial state | After run |
|---------------|-----------|
| No DNS record, domain not attached | DNS created, domain attached as primary (if none) or alias |
| DNS correct, domain attached | no-op (no writes, no errors) |
| DNS wrong target, domain attached | DNS updated (unless `create-only: true`) |
| DNS correct, domain not attached | domain attached |

All API calls use explicit `GET -> branch -> POST/PATCH/PUT` rather than "create or fail", so replays on the same commit or manual re-runs never error on "already exists".

## Development

```bash
npm install
npm run all   # lint + typecheck + vitest + ncc build
```

The bundled output lives in `dist/index.js` and must be committed. The CI workflow (`.github/workflows/ci.yml`) fails the build if `dist/` drifts from source. As a safety net, `.github/workflows/auto-build-dist.yml` rebuilds and commits `dist/` automatically when source changes land on `main` without a corresponding bundle update.

### Retry behaviour

Both Cloudflare and Netlify API calls retry up to 3 times with exponential backoff (500 ms → 1 s → 2 s) on `429`, `502`, `503`, `504`, and network errors. Non-retryable errors (4xx other than 429) fail immediately.

## Releasing

Push a semver tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow runs `npm run all`, creates a GitHub release, and moves the `v1` major tag to the new release. Consumers referencing `@v1` automatically pick up the latest patch/minor.

## Legacy

`legacy/cf-dns-add.sh` is the original bash script, kept for manual/local use. The GitHub Action supersedes it for CI flows.

## License

MIT — see [LICENSE](LICENSE).
