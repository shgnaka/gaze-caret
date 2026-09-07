# GitHub identity setup for diagnostics

Status: draft implementation is present; Cloudflare bindings, deployment, and ChatGPT Work connectivity are not yet verified. This branch returns dummy data only and must not be used for real diagnostics.

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
The OAuth App has been registered with the values above. Store the Client ID and generated Client Secret directly in the existing Cloudflare Worker's Settings > Variables and Secrets as secrets named `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Never paste secrets into chat, repository files, frontend variables, or CI artifacts.

The Worker also needs the following Cloudflare resources and values before deployment:

| Name | Type | Value / purpose |
| --- | --- | --- |
| `OAUTH_KV` | KV namespace binding | Stores short-lived OAuth state and provider grants; use the namespace ID in `wrangler.toml` |
| `COOKIE_ENCRYPTION_KEY` | Secret | Generate a fresh random key locally; used by the OAuth provider to encrypt token properties |
| `ALLOWED_GITHUB_USER_ID` | Environment variable | `90955191`; authorization is bound to this immutable numeric ID, not only `shgnaka` |

The current implementation uses `/oauth/github/callback` exactly as registered. Do not replace it with the shorter `/callback` example from older Cloudflare templates.

Create `OAUTH_KV` in Cloudflare Dashboard → Workers & Pages → KV → Create namespace, then add its ID as the `OAUTH_KV` binding in the Worker configuration. The namespace ID is safe to share with the implementation agent; Client Secret and `COOKIE_ENCRYPTION_KEY` are not.

For the secret, generate locally with a command such as `openssl rand -base64 32`, then paste the result only into Cloudflare's secret field. Do not put it in GitHub Actions variables or `VITE_*` frontend variables.

## Current implementation boundary

- The downstream MCP OAuth protocol is handled by `@cloudflare/workers-oauth-provider`.
- GitHub authenticates the human; the Worker issues a separate provider token. The GitHub access token is not stored in MCP props or returned to the client.
- The callback state is short-lived, stored in KV, bound to a secure browser cookie, and deleted before exchanging the GitHub code.
- The authorization screen requires an explicit `aiRead` checkbox. Without it, MCP tools return no diagnostic data.
- The MCP server is read-only and currently returns a dummy summary and 1 × 1 PNG only. It does not read R2 yet.
- The old static Bearer-only MCP route is removed from the Worker entrypoint; no OAuth bypass is retained.

## Implementation requirements

- Prefer maintained `@cloudflare/workers-oauth-provider` for the downstream MCP OAuth protocol; verify the exact version and integration before adoption.
- GitHub authenticates the human; the Worker issues a separate audience-bound MCP credential. Never pass the GitHub token through as an MCP token.
- Initial owner is the confirmed GitHub account `shgnaka`; resolve and pin the immutable numeric GitHub user ID before enabling access. A matching user-supplied login string is insufficient.
- Request only the identity access needed, not repository or email scopes.
- Bind the upstream callback to a short-lived browser transaction, validate state and PKCE where supported, reject replay, and show explicit downstream client approval.
- Validate downstream redirect URI, resource/audience, scope, expiry, and revocation; implement no unauthenticated bypass.
- Do not use eventually consistent state alone for atomic consent revocation or upload commit decisions.
- First remote test uses dummy summary and image data only. Verify successful Work retrieval and rejection after token revocation before connecting real R2 diagnostics.

References: https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/ and https://docs.github.com/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
