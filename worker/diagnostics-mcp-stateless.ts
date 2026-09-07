import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { z } from 'zod';

const DUMMY_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

interface DiagnosticMcpProps {
  githubUserId: string;
  login: string;
  displayName: string;
  aiRead: boolean;
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function permittedProps(): DiagnosticMcpProps | null {
  const props = getMcpAuthContext()?.props as Partial<DiagnosticMcpProps> | undefined;
  if (!props || typeof props.githubUserId !== 'string' || typeof props.login !== 'string' || typeof props.displayName !== 'string' || props.aiRead !== true) {
    return null;
  }
  return {
    githubUserId: props.githubUserId,
    login: props.login,
    displayName: props.displayName,
    aiRead: true,
  };
}

function permissionError() {
  return textResult({ code: 'ai-read-consent-required' }, true);
}

export function createDiagnosticMcpServer(): McpServer {
  const server = new McpServer({ name: 'gaze-caret-diagnostics', version: '0.2.0' });

  server.registerTool('list_diagnostic_sessions', {
    description: 'List the authenticated owner\'s privacy-filtered gaze diagnostic sessions. S0 returns a dummy result until private R2 access is connected.',
    inputSchema: {
      limit: z.number().int().min(1).max(20).optional(),
      cursor: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ limit, cursor }) => {
    if (!permittedProps()) return permissionError();
    return textResult({
      schemaVersion: 1,
      source: 's0-dummy',
      reports: [],
      truncated: false,
      nextCursor: null,
      requestedLimit: limit ?? 20,
      requestedCursor: cursor ?? null,
    });
  });

  server.registerTool('get_diagnostic_summary', {
    description: 'Read one authenticated owner diagnostic summary. S0 returns a dummy summary until private R2 access is connected.',
    inputSchema: { sessionId: z.string().regex(/^[A-Za-z0-9-]+$/).max(100) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ sessionId }) => {
    const props = permittedProps();
    if (!props) return permissionError();
    return textResult({
      schemaVersion: 1,
      source: 's0-dummy',
      sessionId,
      owner: props.githubUserId,
      status: 'private-r2-not-connected',
      note: 'This is a dummy response for the authenticated MCP spike; no diagnostic data was read.',
    });
  });

  server.registerTool('get_diagnostic_image', {
    description: 'Return a small dummy image to prove that authenticated MCP image content reaches the client. It is not a camera frame.',
    inputSchema: {
      sessionId: z.string().regex(/^[A-Za-z0-9-]+$/).max(100),
      artifactId: z.string().regex(/^[A-Za-z0-9-]+$/).max(100),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ sessionId, artifactId }) => {
    const props = permittedProps();
    if (!props) return permissionError();
    return {
      content: [
        { type: 'image' as const, data: DUMMY_IMAGE_BASE64, mimeType: 'image/png' },
        { type: 'text' as const, text: JSON.stringify({ schemaVersion: 1, source: 's0-dummy', sessionId, artifactId, owner: props.githubUserId }) },
      ],
    };
  });

  return server;
}

export function createDiagnosticMcpApi(authContext?: { props: Record<string, unknown> }) {
  return createMcpHandler(createDiagnosticMcpServer, {
    route: '/mcp',
    ...(authContext ? { authContext } : {}),
  });
}

export const diagnosticMcpApi = createDiagnosticMcpApi();
