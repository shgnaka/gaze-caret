/** Pages REST deployment, equivalent to the create/poll/cancel boundary in actions/deploy-pages v4. */
function required(name: string): string {
  const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}.`); return value;
}

async function main(): Promise<void> {
  if (Deno.args.length !== 1 || !/^[1-9]\d*$/.test(Deno.args[0]!)) throw new Error('Usage: ci-pages.ts ARTIFACT_ID');
  const artifactId = Number(Deno.args[0]);
  if (!Number.isSafeInteger(artifactId)) throw new Error('Artifact ID exceeds the supported integer range.');
  const token = required('GITHUB_TOKEN'), repository = required('GITHUB_REPOSITORY');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository.');
  const api = new URL(required('GITHUB_API_URL'));
  if (api.protocol !== 'https:') throw new Error('GitHub API requires HTTPS.');
  const request = async (path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetch(new URL(`/repos/${repository}/${path}`, api), {
        method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000), redirect: 'error',
      });
    } catch { throw new Error(`Pages ${method} request failed.`); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Pages ${method} returned HTTP ${response.status}.`); }
    if (response.status === 204) return {};
    return await response.json() as Record<string, unknown>;
  };
  const site = await request('pages');
  if (site.build_type !== 'workflow') throw new Error('Enable GitHub Pages with GitHub Actions as its source before publishing.');
  const oidcUrl = new URL(required('ACTIONS_ID_TOKEN_REQUEST_URL'));
  if (oidcUrl.protocol !== 'https:') throw new Error('OIDC endpoint requires HTTPS.');
  let oidcResponse: Response;
  try { oidcResponse = await fetch(oidcUrl, { headers: { Authorization: `Bearer ${required('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` }, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
  catch { throw new Error('Pages OIDC request failed.'); }
  if (!oidcResponse.ok) throw new Error(`Pages OIDC returned HTTP ${oidcResponse.status}.`);
  const oidc = await oidcResponse.json() as { value?: unknown };
  if (typeof oidc.value !== 'string' || !oidc.value) throw new Error('OIDC response has no token.');
  console.log(`::add-mask::${oidc.value}`);
  const deployment = await request('pages/deployments', 'POST', { artifact_id: artifactId, pages_build_version: required('GITHUB_SHA'), oidc_token: oidc.value });
  const id = String(deployment.id || String(deployment.status_url || '').split('/').at(-1) || '');
  if (!/^[\w-]+$/.test(id)) throw new Error('Pages returned an invalid deployment ID.');
  const path = `pages/deployments/${encodeURIComponent(id)}`;
  let pending = true;
  const cancel = async (): Promise<void> => { if (pending) { try { await request(`${path}/cancel`, 'POST'); } catch { console.error('Pages cancellation request failed.'); } } };
  const onSignal = (): void => { void cancel().finally(() => Deno.exit(1)); };
  Deno.addSignalListener('SIGTERM', onSignal); Deno.addSignalListener('SIGINT', onSignal);
  try {
    const deadline = Date.now() + 8 * 60 * 1000;
    const failures = new Set(['deployment_failed', 'deployment_perms_error', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
    let transientErrors = 0;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      let status: Record<string, unknown>;
      try { status = await request(path); transientErrors = 0; }
      catch (error) { if (++transientErrors >= 3) throw error; continue; }
      if (status.status === 'succeed') {
        pending = false;
        if (typeof deployment.page_url !== 'string' || !deployment.page_url.startsWith('https://')) throw new Error('Successful deployment has no HTTPS Pages URL.');
        await Deno.writeTextFile(required('GITHUB_OUTPUT'), `page_url=${deployment.page_url}\n`, { append: true });
        console.log(`Published ${deployment.page_url}`); return;
      }
      if (typeof status.status === 'string' && failures.has(status.status)) { pending = false; throw new Error(`Pages ${status.status}.`); }
    }
    throw new Error('Pages deployment exceeded the eight-minute polling limit.');
  } finally {
    Deno.removeSignalListener('SIGTERM', onSignal); Deno.removeSignalListener('SIGINT', onSignal);
    await cancel();
  }
}

if (import.meta.main) {
  try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : 'Pages deployment failed.'); Deno.exit(1); }
}
