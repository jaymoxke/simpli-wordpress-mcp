# Acceptance checklist

Do not mark the deployment complete until every applicable check passes.

## 1. Infrastructure

- [ ] Railway deployment is active.
- [ ] `GET /health` returns HTTP 200 and `{ "status": "ok" }`.
- [ ] `GET /ready` returns HTTP 200, `ready: true`, and a non-zero ability count.
- [ ] HTTPS is valid on the final MCP origin.
- [ ] `PUBLIC_BASE_URL` exactly matches that final origin.
- [ ] No secret appears in deploy logs, health responses, or MCP tool results.

## 2. OAuth

- [ ] `/.well-known/oauth-protected-resource` returns the `/mcp` resource URL.
- [ ] `/.well-known/oauth-authorization-server` advertises authorization, token, registration, PKCE S256, and the three WordPress scopes.
- [ ] An unauthenticated `/mcp` request returns HTTP 401 with a `WWW-Authenticate` resource metadata link.
- [ ] Dynamic client registration succeeds for the real MCP client callback.
- [ ] A wrong owner password is rejected.
- [ ] Authorization Code + PKCE returns an access token and refresh token.
- [ ] Reusing an authorization code is rejected.

## 3. Capability parity

- [ ] MCP initialization succeeds over Streamable HTTP.
- [ ] `tools/list` includes `wordpress_discover_abilities`, `wordpress_get_ability`, and the dynamic WordPress tools.
- [ ] The catalog count matches `/ready`.
- [ ] The catalog includes all core Novamira abilities: PHP, files, upload/admin links, WP-CLI, Gutenberg, memory, posts, and skills.
- [ ] Installed Pro abilities appear for WooCommerce, Elementor, ACF, Rank Math, and WPForms.
- [ ] A forced catalog refresh discovers any newly installed ability without a new Railway build.

## 4. Safety and execution

- [ ] A read-only ability succeeds with `wordpress:read`.
- [ ] A normal write ability is rejected without `wordpress:write`.
- [ ] A destructive ability is rejected without `wordpress:dangerous`.
- [ ] A destructive ability is rejected when `_confirm` is absent or incorrect.
- [ ] WordPress schema validation errors return as MCP tool errors without crashing the gateway.
- [ ] A representative safe write is followed by a read that verifies the resulting state.
- [ ] The representative write is reverted or was made only to a disposable draft/sandbox item.

## 5. Recovery

- [ ] Revoking the dedicated WordPress Application Password makes `/ready` fail without exposing credentials.
- [ ] Restoring a replacement Application Password recovers readiness.
- [ ] Pausing the Railway service removes external MCP access without affecting WordPress or Novamira.
