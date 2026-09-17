# Simpli MCP v3 acceptance checklist

Do not mark v3 complete or remove the legacy production path until every applicable hard gate passes with evidence.

## 1. Repository and release integrity

- [ ] CI type checks pass.
- [ ] CI tests pass.
- [ ] Production build succeeds.
- [ ] Runtime syntax check succeeds.
- [ ] Gateway `src/` contains no Novamira endpoint/package dependency.
- [ ] MCP server metadata, `/`, `/health`, `/ready.release`, and `/version` report the same canonical runtime release version.
- [ ] `/version` returns `novamiraGatewayDependency: false`.
- [ ] `/version` continues to report `wordpressBackendIndependence: "unverified"` until Section 6 has passed; it must not claim backend independence early.
- [ ] No secret appears in build logs, deploy logs, status responses, or MCP tool results.

## 2. Infrastructure

- [ ] HTTPS is valid on the final MCP origin.
- [ ] `PUBLIC_BASE_URL` exactly matches that final origin.
- [ ] `GET /health` returns HTTP 200 and process liveness only.
- [ ] `GET /ready` returns HTTP 200 only when the Simpli-owned WordPress backend catalog is available.
- [ ] WordPress/backend outage causes `/ready` to fail closed.
- [ ] MCP/OAuth remains reachable without depending on WordPress-hosted OAuth endpoints.

## 3. OAuth and client identity

- [ ] `/.well-known/oauth-protected-resource` returns the `/mcp` resource URL.
- [ ] `/.well-known/oauth-authorization-server` advertises the active authorization/token/client-registration mechanism and PKCE S256.
- [ ] An unauthenticated `/mcp` request returns HTTP 401 with protected-resource metadata.
- [ ] The real ChatGPT callback completes authorization successfully.
- [ ] Any other approved production client completes authorization successfully.
- [ ] A wrong owner authorization credential is rejected.
- [ ] Authorization Code + PKCE returns a bounded access token.
- [ ] Reusing an authorization code is rejected.
- [ ] Resource/audience mismatch is rejected.
- [ ] Redirect URI mismatch is rejected.
- [ ] Refresh cannot increase granted scope.

### v3 security hardening gates before final cutover

- [ ] Authorization-code replay prevention survives process restart.
- [ ] Refresh-token rotation is enabled.
- [ ] Refresh-token family reuse is detected and revoked.
- [ ] Client/token revocation is durable.
- [ ] Signing-key rotation can occur without accepting tokens from an unknown key.
- [ ] Static full-privilege bearer credentials are absent from the public production deployment unless a separately approved machine integration requires them.

## 4. Capability admission

- [ ] MCP initialization succeeds.
- [ ] `tools/list` exposes only explicitly admitted Simpli-owned capabilities.
- [ ] `simpli_catalog`, `simpli_describe`, and `simpli_execute` behave according to the current backend contract where enabled.
- [ ] Installing an unrelated WordPress plugin does not automatically expose new privileged MCP tools.
- [ ] Legacy compatibility aliases, if retained, route only to explicit Simpli-owned equivalents.
- [ ] No normal MCP tool exposes arbitrary PHP execution.
- [ ] No normal MCP tool exposes arbitrary WP-CLI execution.
- [ ] No normal MCP tool creates administrator login links.
- [ ] No normal MCP tool permits unrestricted filesystem mutation or traversal.

## 5. Authority and write safety

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
- [ ] Replacing backend credentials/keys restores readiness after intentional revocation.
- [ ] Audit records contain request/release/ability/authority/verification identifiers but no secrets.
- [ ] Monitoring distinguishes process liveness from backend readiness.
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

A successful MCP connection alone is not completion. Final acceptance requires independent capability, authority, verification, recovery, and dependency-elimination evidence.
