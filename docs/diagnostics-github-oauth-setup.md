# GitHub identity setup for diagnostics

Status: implementation contract; OAuth and Work connectivity are not yet implemented or verified. Do not merge or deploy the MCP spike for real diagnostics.

## Fixed endpoints

- Worker origin: `https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev`
- GitHub callback: `https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev/oauth/github/callback`
- Intended MCP endpoint: `/mcp`

## Owner setup

Create an OAuth App at https://github.com/settings/applications/new:

| Field | Value |
| --- | --- |
| Application name | gaze-caret Diagnostics |
| Homepage URL | https://shgnaka.github.io/gaze-caret/ |
| Authorization callback URL | https://gaze-caret-diagnostics.shogonakamurawppt.workers.dev/oauth/github/callback |

Do not enable Device Flow or wildcard callbacks for this flow.
Record the Client ID and generate a Client Secret. Store both directly in the existing Cloudflare Worker's Settings > Variables and Secrets as secrets named `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Never paste secrets into chat, repository files, frontend variables, or CI artifacts. This setup alone does not implement OAuth.

## Implementation requirements

- Prefer maintained `@cloudflare/workers-oauth-provider` for the downstream MCP OAuth protocol; verify the exact version and integration before adoption.
- GitHub authenticates the human; the Worker issues a separate audience-bound MCP credential. Never pass the GitHub token through as an MCP token.
- Initial owner is the confirmed GitHub account `shgnaka`; resolve and pin the immutable numeric GitHub user ID before enabling access. A matching user-supplied login string is insufficient.
- Request only the identity access needed, not repository or email scopes.
- Bind the upstream callback to a short-lived browser transaction, validate state and PKCE where supported, reject replay, and show explicit downstream client approval.
- Validate downstream redirect URI, resource/audience, scope, expiry, and revocation; implement no unauthenticated bypass.
- Do not use eventually consistent state alone for atomic consent revocation or upload commit decisions.
- First remote test uses dummy summary and image data only. Verify successful Work retrieval and rejection after revocation before connecting real R2 diagnostics.

References: https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/ and https://docs.github.com/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
