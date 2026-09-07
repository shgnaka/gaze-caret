import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleDiagnosticMcpRequest } from '../worker/diagnostics-mcp.ts';
import type { DiagnosticReaderEnv } from '../worker/private-diagnostics.ts';

function env(token = 'reader-secret'): DiagnosticReaderEnv {
  return {
    READ_BEARER_TOKEN: token,
    DIAGNOSTICS: {
      list: async () => ({ objects: [], truncated: false }),
      get: async () => null,
    },
  };
}

function initialize(token = 'reader-secret'): Request {
  return new Request('https://worker.example.test/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
  });
}

test('MCP endpoint fails closed before touching the diagnostic store', async () => {
  let calls = 0;
  const reader = env();
  reader.DIAGNOSTICS.list = async () => { calls++; return { objects: [], truncated: false }; };
  assert.equal((await handleDiagnosticMcpRequest(new Request('https://worker.example.test/mcp', { method: 'POST' }), reader)).status, 401);
  assert.equal((await handleDiagnosticMcpRequest(new Request('https://worker.example.test/mcp', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }), reader)).status, 401);
  assert.equal(calls, 0);
});

test('MCP rejects credentials without the Bearer scheme', async () => {
  const request = initialize();
  request.headers.set('Authorization', 'reader-secret');
  const response = await handleDiagnosticMcpRequest(request, env());
  assert.equal(response.status, 401);
});

test('MCP endpoint exposes an authenticated read-only session', async () => {
  const response = await handleDiagnosticMcpRequest(initialize(), env());
  assert.equal(response.status, 200);
  const sessionId = response.headers.get('Mcp-Session-Id');
  assert.ok(sessionId);
  const body = await response.text();
  assert.match(body, /serverInfo|gaze-caret-diagnostics/);

  const toolsResponse = await handleDiagnosticMcpRequest(new Request('https://worker.example.test/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer reader-secret', Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  }), env());
  assert.equal(toolsResponse.status, 200);
  assert.match(await toolsResponse.text(), /list_diagnostic_sessions/);
});
