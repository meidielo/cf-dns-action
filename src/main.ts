import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { parseInputs, buildFqdn } from './config';
import { CloudflareClient } from './cloudflare';
import { NetlifyClient } from './netlify';

export async function run(): Promise<void> {
  try {
    const inputs = parseInputs();
    const fqdn = buildFqdn(inputs.subdomain, inputs.domain);

    core.info(`Target FQDN:  ${fqdn}`);
    core.info(
      `Flags:        dry-run=${inputs.dryRun} create-only=${inputs.createOnly} proxied=${inputs.proxied}`,
    );

    const cf = new CloudflareClient(inputs.cfApiToken, inputs.cfZoneId);
    const nl = new NetlifyClient(inputs.netlifyAuthToken);

    core.startGroup('Pre-flight: verify API tokens');
    await Promise.all([cf.verifyToken(), nl.verifyToken()]);
    core.info('Cloudflare token: active');
    core.info('Netlify token:    valid');
    core.endGroup();

    core.startGroup('Netlify: attach custom domain');
    const nlResult = await nl.attachCustomDomain({
      siteId: inputs.netlifySiteId,
      fqdn,
      dryRun: inputs.dryRun,
    });
    core.endGroup();

    core.startGroup('Cloudflare: upsert CNAME');
    const cfResult = await cf.upsertCname({
      fqdn,
      target: nlResult.netlifyUrl,
      proxied: inputs.proxied,
      createOnly: inputs.createOnly,
      dryRun: inputs.dryRun,
    });
    core.endGroup();

    let sslState = '';
    let sslProvisioned = '';
    if (inputs.waitForCert && !inputs.dryRun) {
      core.startGroup('Netlify: wait for SSL cert');
      const ssl = await nl.waitForSslProvisioned(inputs.netlifySiteId, {
        timeoutMs: inputs.certTimeoutSeconds * 1000,
      });
      sslState = ssl.state;
      sslProvisioned = String(ssl.provisioned);
      if (ssl.timedOut) {
        core.warning(
          `SSL not provisioned within ${inputs.certTimeoutSeconds}s (last state: ${ssl.state}). Cert usually finalizes shortly after; this is not a hard failure.`,
        );
      } else {
        core.info(`SSL provisioned after ${ssl.attempts} poll(s)`);
      }
      core.endGroup();
    }

    core.setOutput('fqdn', fqdn);
    core.setOutput('cf-record-id', cfResult.record?.id ?? '');
    core.setOutput('cf-action', cfResult.action);
    core.setOutput('netlify-action', nlResult.action);
    core.setOutput('netlify-url', nlResult.netlifyUrl);
    core.setOutput('ssl-state', sslState);
    core.setOutput('ssl-provisioned', sslProvisioned);

    core.notice(
      `${fqdn} -> ${nlResult.netlifyUrl} | cf=${cfResult.action} netlify=${nlResult.action}`,
      { title: 'cf-dns-action' },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(msg);
  }
}

// Only auto-run when this file is the entrypoint (matters for tests + ncc bundling).
// ESM equivalent of the CJS `require.main === module` idiom; the latter gets
// transpiled to eval('__filename') by ncc, which ReferenceErrors in ESM scope.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  void run();
}
