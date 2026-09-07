import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiagnosticMcpApi } from '../worker/diagnostics-mcp-stateless.ts';

const context = {
  props: { githubUserId: '90955191', login: 'shgnaka', displayName: 'owner', aiRead: true },
};

function mcpRequest(body: unknown): Request {
  return new Request('https://worker.example.test/mcp', {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(request: Request) {
  return createDiagnosticMcpApi(context).fetch(request);
}

test('stateless MCP exposes only read-only dummy tools for an aiRead-approved context', async () => {
  const response = await call(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /gaze-caret-diagnostics/);
});

test('stateless MCP returns no diagnostic data without aiRead consent', async () => {
  const response = await createDiagnosticMcpApi({ props: { githubUserId: '90955191', login: 'shgnaka', displayName: 'owner', aiRead: false } }).fetch(
    mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_diagnostic_summary', arguments: { sessionId: 'session-1' } } }),
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /ai-read-consent-required/);
  assert.doesNotMatch(body, /private-r2-not-connected/);
});
