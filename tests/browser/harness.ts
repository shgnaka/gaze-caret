import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

export { expect };
const baseURL = 'http://127.0.0.1:4173';
type Scenario = (fixtures: { page: Page }) => Promise<void>;

async function startServer(): Promise<{ stop: () => Promise<void> }> {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
    throw new Error('Browser test port 4173 is already in use');
  } catch (error) {
    if (error instanceof Error && error.message.includes('already in use')) throw error;
  }

  // Launch the server itself rather than a task shell: cleanup then owns the
  // single Deno child and cannot leave a grandchild listening on the test port.
  const server = new Deno.Command(Deno.execPath(), {
    cwd: new URL('../../', import.meta.url),
    args: [
      'run', '--no-prompt', '--allow-read', '--allow-env', '--allow-sys',
      '--allow-write=node_modules/.vite', '--allow-ffi=node_modules', '--allow-net=127.0.0.1,0.0.0.0:4173,[::]:4173',
      'scripts/deno-vite.ts', 'dev', '--port', '4173', '--strictPort',
    ],
    stdout: 'piped', stderr: 'piped',
  }).spawn();
  const output = server.output();
  let exited = false;
  void server.status.then(() => { exited = true; });
  const stop = async (): Promise<void> => {
    if (!exited) server.kill('SIGTERM');
    await output;
  };
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (exited) {
        const result = await output;
        throw new Error('Deno dev server exited: ' + new TextDecoder().decode(result.stderr));
      }
      try {
        const response = await fetch(baseURL, { signal: AbortSignal.timeout(500) });
        await response.body?.cancel();
        if (response.ok) return { stop };
      } catch { /* The server is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Deno dev server did not become ready within 30 seconds');
  } catch (error) {
    await stop();
    throw error;
  }
}

export function test(name: string, scenario: Scenario): void;
export function test(name: string, timeout: number, scenario: Scenario): void;
export function test(name: string, timeoutOrScenario: number | Scenario, scenario?: Scenario): void {
  const timeout = typeof timeoutOrScenario === 'number' ? timeoutOrScenario : 30_000;
  const run = typeof timeoutOrScenario === 'function' ? timeoutOrScenario : scenario!;
  const definition = {
    name, timeout,
    async fn() {
      const server = await startServer();
      let browser: Browser | undefined;
      try {
        const executablePath = Deno.env.get('GAZE_CHROMIUM_PATH');
        browser = await chromium.launch({
          headless: true,
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
          ...(executablePath ? { executablePath } : {}),
        });
        const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        try { await run({ page }); }
        finally { await context.close(); }
      } finally {
        await browser?.close();
        await server.stop();
      }
    },
  };
  Deno.test(definition);
}
