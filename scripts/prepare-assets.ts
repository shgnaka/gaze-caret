const root = new URL('../', import.meta.url);
const model = new URL('public/models/face_landmarker.task', root);
const expected = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
await Deno.mkdir(new URL('public/models/', root), { recursive: true });
let bytes: Uint8Array;
try {
  bytes = await Deno.readFile(model);
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  bytes = new Uint8Array(await response.arrayBuffer());
}
const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== expected) {
  throw new Error('Unexpected model checksum');
}
await Deno.writeFile(model, bytes);
async function copyDirectory(source: URL, destination: URL): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const suffix = entry.isDirectory ? `${entry.name}/` : entry.name;
    if (entry.isDirectory) await copyDirectory(new URL(suffix, source), new URL(suffix, destination));
    else if (entry.isFile) await Deno.copyFile(new URL(suffix, source), new URL(suffix, destination));
  }
}
await copyDirectory(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('public/wasm/', root));
console.log('Verified model v1 and copied the locked WASM runtime.');
