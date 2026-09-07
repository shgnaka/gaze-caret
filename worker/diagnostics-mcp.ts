import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { DiagnosticReaderEnv } from './private-diagnostics.ts';
import { handlePrivateDiagnosticRequest } from './private-diagnostics.ts';

export const MCP_DIAGNOSTIC_TOOL_NAMES = ['list_diagnostic_sessions', 'get_diagnostic_summary'] as const;

type McpEnv = DiagnosticReaderEnv;

interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, Session>();

function unauthorized(request: Request, env: McpEnv): Response | null {
  const expected = env.READ_BEARER_TOKEN?.trim() ?? '';
  if (!expected) return new Response(JSON.stringify({ error: 'reader-not-configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const header = request.headers.get('Authorization') ?? '';
  const supplied = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? '';
  if (supplied !== expected) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' } });
  return null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function toolText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

async function readerGet(path: string, env: McpEnv): Promise<Record<string, unknown>> {
  const token = env.READ_BEARER_TOKEN ?? '';
  const response = await handlePrivateDiagnosticRequest(new Request(`https://internal.invalid${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
  return readJson(response);
}

export function createDiagnosticMcpServer(env: McpEnv): McpServer {
  const server = new McpServer({ name: 'gaze-caret-diagnostics', version: '0.1.0' });
  server.registerTool('list_diagnostic_sessions', {
    description: 'List basic, privacy-filtered gaze diagnostic sessions.',
    inputSchema: { limit: z.number().int().min(1).max(20).optional(), cursor: z.string().max(200).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ limit, cursor }) => toolText(await readerGet(`/v2/diagnostics?limit=${limit ?? 20}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, env)));
  server.registerTool('get_diagnostic_summary', {
    description: 'Read one privacy-filtered basic gaze diagnostic summary by session ID.',
    inputSchema: { sessionId: z.string().regex(/^[A-Za-z0-9-]+$/).max(100) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ sessionId }) => toolText(await readerGet(`/v2/diagnostics/${sessionId}`, env)));
  return server;
}

async function newSession(env: McpEnv, sessionId: string): Promise<Session> {
  const server = createDiagnosticMcpServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
  await server.connect(transport);
  const session = { server, transport };
  sessions.set(sessionId, session);
  return session;
}

export async function handleDiagnosticMcpRequest(request: Request, env: McpEnv): Promise<Response> {
  const authenticationError = unauthorized(request, env);
  if (authenticationError) return authenticationError;
  const sessionId = request.headers.get('Mcp-Session-Id');
  if (request.method === 'DELETE' && sessionId) {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session) await session.server.close();
    return new Response(null, { status: 204 });
  }
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return new Response(JSON.stringify({ error: 'session-not-found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return session.transport.handleRequest(request);
  }
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method-not-allowed' }), { status: 405, headers: { Allow: 'POST, DELETE' } });
  const id = crypto.randomUUID();
  const session = await newSession(env, id);
  return session.transport.handleRequest(request);
}
