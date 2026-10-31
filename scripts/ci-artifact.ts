/**
 * Deno-only implementation of the ZIP artifact protocol used by upload-artifact v4.
 * Run inside a Docker Action: GitHub's runner injects the runtime credentials into
 * Docker Actions, but does not expose them to ordinary shell steps.
 * Protocol reference: actions/toolkit commit 1e0c16f0dc67246ccb8005965c289aba4114bd56,
 * packages/artifact/src/{generated/results/api/v1,internal/upload,internal/shared}.
 */
type JsonObject = Record<string, unknown>;

export function artifactBackendIds(token: string): { workflow_run_backend_id: string; workflow_job_run_backend_id: string } {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Artifact runtime token has no payload.');
  let claims: JsonObject;
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
  } catch { throw new Error('Artifact runtime token has an invalid payload.'); }
  const scope = typeof claims.scp === 'string' ? claims.scp.split(' ').find(part => part.startsWith('Actions.Results:')) : undefined;
  const parts = scope?.split(':');
  if (parts?.length !== 3 || !parts[1] || !parts[2]) throw new Error('Artifact runtime token has no Results scope.');
  return { workflow_run_backend_id: parts[1], workflow_job_run_backend_id: parts[2] };
}

export function artifactCreation(token: string, name: string, days: number, at: number): JsonObject {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('Invalid artifact name.');
  if (!Number.isSafeInteger(days) || days < 1 || days > 90 || !Number.isFinite(at)) throw new Error('Invalid artifact retention.');
  return { ...artifactBackendIds(token), name, version: 4, expires_at: new Date(at + days * 86400000).toISOString() };
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}. Artifact upload requires a Docker Action.`);
  return value;
}

async function request(url: URL, init: RequestInit, label: string): Promise<Response> {
  if (url.protocol !== 'https:') throw new Error(`${label} requires HTTPS.`);
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(120000), redirect: 'error' }); }
    catch {
      if (attempt === 2) throw new Error(`${label} request failed.`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); continue;
    }
    if (response.ok) return response;
    await response.body?.cancel();
    if ((response.status !== 429 && response.status < 500) || attempt === 2) throw new Error(`${label} returned HTTP ${response.status}.`);
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${label} failed.`);
}

async function main(): Promise<void> {
  const [name, path, retention] = Deno.args;
  if (!name || !path || !retention || Deno.args.length !== 3) throw new Error('Usage: ci-artifact.ts NAME ZIP RETENTION_DAYS');
  const token = requiredEnv('ACTIONS_RUNTIME_TOKEN');
  console.log(`::add-mask::${token}`);
  const results = new URL(requiredEnv('ACTIONS_RESULTS_URL'));
  const backendIds = artifactBackendIds(token);
  const maximum = Number(Deno.env.get('GITHUB_RETENTION_DAYS') || 90);
  const days = Math.min(Number(retention), maximum);
  const bytes = await Deno.readFile(path);
  if (bytes.length === 0 || bytes.length > 256 * 1024 * 1024) throw new Error('Artifact ZIP must contain between 1 byte and 256 MiB.');
  const rpc = async (method: string, body: JsonObject): Promise<JsonObject> => {
    const url = new URL(`/twirp/github.actions.results.api.v1.ArtifactService/${method}`, results);
    const response = await request(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, method);
    const result = await response.json() as JsonObject;
    if (result.ok !== true) throw new Error(`${method} was not accepted.`);
    return result;
  };
  const created = await rpc('CreateArtifact', artifactCreation(token, name, days, Date.now()));
  const signedUploadUrl = created.signedUploadUrl ?? created.signed_upload_url;
  if (typeof signedUploadUrl !== 'string') throw new Error('Artifact service did not return an upload URL.');
  const uploadUrl = new URL(signedUploadUrl);
  const signature = uploadUrl.searchParams.get('sig');
  if (signature) { console.log(`::add-mask::${signature}`); console.log(`::add-mask::${encodeURIComponent(signature)}`); }
  const uploaded = await request(uploadUrl, {
    method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2020-10-02', 'Content-Type': 'application/zip' }, body: bytes,
  }, 'Artifact storage');
  await uploaded.body?.cancel();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const finalized = await rpc('FinalizeArtifact', { ...backendIds, name, size: String(bytes.length), hash: `sha256:${digest}` });
  const id = String(finalized.artifactId ?? finalized.artifact_id ?? '');
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Artifact service returned an invalid artifact ID.');
  await Deno.writeTextFile(requiredEnv('GITHUB_OUTPUT'), `artifact-id=${id}\nartifact-digest=${digest}\n`, { append: true });
  console.log(`Uploaded ${name}: ${bytes.length} bytes, artifact ${id}, sha256:${digest}`);
}

if (import.meta.main) {
  try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : 'Artifact upload failed.'); Deno.exit(1); }
}
