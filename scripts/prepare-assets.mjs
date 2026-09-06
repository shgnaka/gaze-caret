import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const path = new URL('public/models/face_landmarker.task', root);
const expected = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
await mkdir(new URL('public/models/', root), { recursive: true });
let bytes;
try { bytes = await readFile(path); } catch {
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Unexpected model checksum');
await writeFile(path, bytes);
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/',root), new URL('public/wasm/',root), { recursive: true });
console.log('Verified model v1 and copied the locked WASM runtime.');
