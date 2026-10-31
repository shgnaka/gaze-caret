
import { build, createServer, preview } from 'vite';
import type { InlineConfig } from 'vite';

const [command, ...args] = Deno.args;
if (command !== 'build' && command !== 'dev' && command !== 'preview') {
  throw new RangeError('Expected build, dev, or preview');
}

let port: number | undefined;
let strictPort = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--strictPort') strictPort = true;
  else if (args[i] === '--port') {
    const value = args[++i];
    if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
      throw new RangeError('Expected --port followed by an integer from 1 to 65535');
    }
    port = Number(value);
  } else throw new RangeError(`Unsupported Vite argument: ${args[i]}`);
}

// Deno loads the TypeScript config itself. A numeric loopback host avoids DNS
// requests while resolving Vite configuration, including during offline builds.
const localServer = { host: '127.0.0.1', strictPort, ...(port === undefined ? {} : { port }) };
const config: InlineConfig = { configLoader: 'native', server: localServer, preview: localServer };
function requireLoopback(address: string | { address: string } | null | undefined): void {
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    throw new Error(`Vite must listen on loopback: ${JSON.stringify(address)}`);
  }
}
if (command === 'build') await build(config);
else if (command === 'dev') {
  const server = await createServer(config);
  await server.listen();
  requireLoopback(server.httpServer?.address());
  server.printUrls();
} else {
  const server = await preview(config);
  requireLoopback(server.httpServer.address());
  server.printUrls();
}
