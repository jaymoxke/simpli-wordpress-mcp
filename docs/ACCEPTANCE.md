# Simpli MCP v3 acceptance checklist

Do not mark v3 complete or remove the legacy production path until every applicable hard gate passes with evidence.

## 1. Repository and release integrity

- [ ] CI type checks pass.
- [ ] CI tests pass.
- [ ] Production build succeeds.
- [ ] Runtime syntax check succeeds.
- [ ] Container build succeeds on the declared production runtime.
- [ ] Gateway `src/` contains no Novamira endpoint/package dependency.
- [ ] MCP server metadata, `/`, `/health`, `/ready.release`, and `/version` report the same canonical runtime release version.
- [ ] `/version` returns `novamiraGatewayDependency: false`.
- [ ] `/version` continues to report `wordpressBackendIndependence: "unverified"` until Section 6 has passed; it must not claim backend independence early.
- [ ] No secret appears in build logs, deploy logs, status responses, or MCP tool results.

## 2. Infrastructure

- [ ] HTTPS is valid on the final MCP origin.
- [ ] `PUBLIC_BASE_URL` exactly matches that final origin.
- [ ] `GET /health` returns HTTP 200 and process liveness only.
- [ ] `GET /ready` returns HTTP 200 only when the Simpli-owned WordPress backend catalog and required OAuth state are healthy.
- [ ] WordPress/backend outage causes `/ready` to fail closed.
- [ ] OAuth-state corruption/unavailability causes `/ready` to fail closed rather than silently accepting grants.
- [ ] MCP/OAuth remains reachable without depending on WordPress-hosted OAuth endpoints.
- [ ] The production `OAUTH_STATE_DB_PATH` is absolute and located on persistent storage that survives service/container restart.
- [ ] OAuth state backup/recovery has been tested on the actual production persistence mechanism.

## 3. OAuth and client identity

- [ ] `/.well-known/oauth-protected-resource` returns the `/mcp` resource URL.
- [ ] `/.well-known/oauth-authorization-server` advertises authorization, token, registration, revocation and PKCE S256.
- [ ] An unauthenticated `/mcp` request returns HTTP 401 with protected-resource metadata.
- [ ] The real ChatGPT callback completes authorization successfully.
- [ ] Any other approved production client completes authorization successfully.
- [ ] A wrong owner authorization credential is rejected.
- [ ] Authorization Code + PKCE returns a bounded opaque access token and rotating refresh token.
- [ ] Omitted scope defaults to `wordpress:read` only.
- [ ] Reusing an authorization code is rejected after process restart.
- [ ] Redirect URI mismatch is rejected.
- [ ] Resource mismatch is rejected.
- [ ] Refresh cannot increase granted scope.
- [ ] Every successful refresh rotates both the access token and refresh token.
- [ ] Reuse of an already-rotated refresh token revokes the full token family.
- [ ] Access-token revocation takes effect immediately.
- [ ] Client revocation survives process restart and invalidates its token state.
- [ ] Raw authorization codes, access tokens and refresh tokens are not stored in the OAuth database; only one-way hashes are persisted.
- [ ] Static full-privilege bearer credentials are absent from the public production deployment unless a separately approved machine integration requires them.

### Token-model rule

The current v3 architecture deliberately uses high-entropy opaque tokens because the authorization server and MCP resource server are co-located. JWT/JWKS/key rotation is **not** a required acceptance gate unless Simpli later separates those services or introduces another verified need for distributed token validation.

## 4. MCP protocol

- [ ] MCP SDK v2 dependencies install from the committed lockfile with `npm ci`.
- [ ] 2026-07-28 `server/discover` succeeds with the required per-request envelope and protocol headers.
- [ ] 2026-07-28 `tools/list` succeeds without `Mcp-Session-Id` state.
- [ ] Required legacy clients still succeed through the stateless compatibility path where retained.
- [ ] The real production MCP client matrix has been tested before protocol cutover.

## 5. Capability admission and write safety

- [ ] `tools/list` exposes only explicitly admitted Simpli-owned capabilities.
- [ ] `simpli_catalog`, `simpli_describe`, and `simpli_execute` behave according to the current backend contract where enabled.
- [ ] Installing an unrelated WordPress plugin does not automatically expose new privileged MCP tools.
- [ ] Legacy compatibility aliases, if retained, route only to explicit Simpli-owned equivalents.
- [ ] No normal MCP tool exposes arbitrary PHP execution.
- [ ] No normal MCP tool exposes arbitrary WP-CLI execution.
- [ ] No normal MCP tool creates administrator login links.
- [ ] No normal MCP tool permits unrestricted filesystem mutation or traversal.
- [ ] A read-only capability succeeds with read authority.
- [ ] A normal write is rejected without the required write authority.
- [ ] A high-impact write is rejected without its exact bounded approval/permit.
- [ ] A6/forbidden operations are always rejected.
- [ ] Schema validation errors return as bounded MCP errors without crashing the gateway.
- [ ] A write with an incorrect expected-before-state is rejected.
- [ ] Reusing an idempotency key cannot create a duplicate mutation.
- [ ] An unknown/timeout write outcome is inspected before any retry.
- [ ] A representative safe write is followed by read-back verification.
- [ ] The representative write is reverted or targets a disposable/sandbox object.
- [ ] Rollback evidence is retained for material reversible writes.

## 6. WordPress backend independence

- [ ] The Simpli WordPress backend responds at `/wp-json/simpli-mcp/v1/mcp` without Novamira enabled.
- [ ] `tools/list` returns the accepted Simpli capability set with Novamira disabled.
- [ ] Representative read operations pass with Novamira disabled.
- [ ] Representative governed write operations pass with Novamira disabled.
- [ ] Disabling Novamira and Novamira Pro does not reduce `/ready` below the accepted v3 scope.
- [ ] Re-enabling legacy plugins remains available as rollback during the observation window.
- [ ] Only after the preceding checks pass may release metadata promote `wordpressBackendIndependence` from `"unverified"` to a verified state.

## 7. Recovery and operations

- [ ] Pausing the Simpli MCP public service removes external MCP access without damaging WordPress.
- [ ] Restoring the previous known-good MCP release succeeds.
- [ ] Restoring OAuth state from the approved backup mechanism preserves expected revocation/replay controls.
- [ ] Replacing backend credentials restores readiness after intentional revocation.
- [ ] Audit records contain request/release/ability/authority/verification identifiers but no secrets.
- [ ] Monitoring distinguishes process liveness, OAuth-state health and backend readiness.
- [ ] The operating team can identify the currently running release from `/version` without inspecting source code.

## 8. Final Novamira retirement gate

Only after Sections 1-7 pass:

- [ ] Disable Novamira Core in production.
- [ ] Disable Novamira Pro in production.
- [ ] Re-run the complete accepted read/write smoke suite.
- [ ] Observe the Simpli-owned path through the agreed stability window.
- [ ] Confirm no production workflow, MCP client, skill, gateway, or automation still calls a Novamira route.
- [ ] Preserve backup and rollback evidence.
- [ ] Remove Novamira only after the observation window closes without unresolved dependency.

A successful MCP connection alone is not completion. Final acceptance requires independent capability, authority, verification, recovery, persistence, and dependency-elimination evidence.
