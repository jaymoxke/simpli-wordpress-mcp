# Simpli MCP v3 acceptance checklist

Do not mark v3 complete or remove the legacy production path until every applicable hard gate passes with evidence.

## 1. Repository and release integrity

- [ ] CI type checks pass on the exact candidate head.
- [ ] CI tests pass on the exact candidate head.
- [ ] Production build succeeds.
- [ ] Runtime syntax check succeeds.
- [ ] Container build succeeds on the declared production runtime.
- [ ] PHP signed-transport verifier syntax passes.
- [ ] Node-to-PHP Ed25519 canonical-request verification passes.
- [ ] Gateway `src/` contains no Novamira endpoint/package dependency.
- [ ] MCP server metadata, `/`, `/health`, `/ready.release`, and `/version` report the same canonical runtime release version.
- [ ] `/version` returns `novamiraGatewayDependency: false`.
- [ ] `/version` reports `wordpressBackendIndependence: "unverified"` until backend-independence gates pass.
- [ ] No secret appears in build logs, deploy logs, status responses or MCP outputs.

## 2. Infrastructure and readiness

- [ ] HTTPS is valid on the final MCP origin.
- [ ] `PUBLIC_BASE_URL` exactly matches that origin.
- [ ] `GET /health` returns process liveness only.
- [ ] `GET /ready` returns HTTP 200 only when required OAuth state and accepted WordPress backend/catalog dependencies are healthy.
- [ ] WordPress/backend outage causes `/ready` to fail closed.
- [ ] OAuth-state corruption/unavailability causes `/ready` to fail closed.
- [ ] MCP/OAuth remains reachable without WordPress-hosted OAuth endpoints.
- [ ] Production `OAUTH_STATE_DB_PATH` is absolute and persistent across restart.
- [ ] OAuth state backup/recovery is tested on the actual production mechanism.

## 3. OAuth and external client identity

- [ ] `/.well-known/oauth-protected-resource` returns the `/mcp` resource URL.
- [ ] Authorization-server metadata advertises the actual authorization/token/registration/revocation mechanisms and PKCE S256.
- [ ] Unauthenticated `/mcp` returns HTTP 401 with protected-resource metadata.
- [ ] Real ChatGPT authorization completes successfully.
- [ ] Every other approved production client completes authorization successfully.
- [ ] Wrong owner authorization credential is rejected.
- [ ] Authorization Code + PKCE returns a bounded opaque access token and rotating refresh token.
- [ ] Omitted scope defaults to `wordpress:read` only.
- [ ] Authorization-code reuse is rejected after process restart.
- [ ] Redirect/resource mismatch is rejected.
- [ ] Refresh cannot increase scope.
- [ ] Every successful refresh rotates access + refresh tokens.
- [ ] Rotated refresh-token reuse revokes the full token family.
- [ ] Access-token revocation takes effect immediately.
- [ ] Client revocation survives restart and invalidates its token state.
- [ ] Raw OAuth bearer values are not persisted; only one-way hashes are stored.
- [ ] Public production has no static full-privilege bearer token unless separately approved.

### OAuth token-model rule

The current co-located authorization/resource-server design intentionally uses high-entropy opaque tokens. JWT/JWKS/key rotation is not an acceptance requirement unless the services are later separated or another verified distributed-validation need arises.

## 4. MCP protocol

- [ ] SDK v2 dependencies install from committed lockfile with `npm ci`.
- [ ] 2026-07-28 `server/discover` succeeds with required per-request envelope/headers.
- [ ] 2026-07-28 `tools/list` succeeds without server-side `Mcp-Session-Id` dependency.
- [ ] Required legacy clients succeed through the retained stateless compatibility path.
- [ ] Real production MCP client matrix is tested before protocol cutover.

## 5. Signed WordPress machine transport

### Repository/cross-language contract

- [ ] `simpli-wp-request-v1` TypeScript signer and PHP/libsodium verifier agree on the canonical message.
- [ ] The signed contract binds method, fixed path, WordPress audience, key ID, issue/expiry time, nonce, exact body SHA-256 and release ID.
- [ ] Tampering with the body invalidates verification.
- [ ] Non-Ed25519 private keys are rejected by the gateway signer.
- [ ] Attestation TTL is constrained to 10–300 seconds.
- [ ] Private signing key is never committed or printed by repository tooling.
- [ ] WordPress stores public verifier material only.
- [ ] Multiple admitted public keys can overlap for controlled key rotation.

### Staged real-runtime acceptance

- [ ] Verifier can be installed in `disabled` mode without changing current route behavior.
- [ ] `gateway=dual + verifier=observe` shows valid signatures reaching the first-party WordPress route.
- [ ] Observation logs expose bounded failure codes only, no signature/credential/private-key material.
- [ ] `gateway=dual + verifier=enforce` accepts a correctly signed request.
- [ ] Enforce mode rejects a request with no signature.
- [ ] Enforce mode rejects an unknown key ID.
- [ ] Enforce mode rejects wrong audience.
- [ ] Enforce mode rejects expired/future/excessive-lifetime requests.
- [ ] Enforce mode rejects modified body/signature.
- [ ] Enforce mode durably rejects reuse of a consumed nonce.
- [ ] Replay protection still works after PHP/WordPress process restart.
- [ ] Public-key rotation succeeds through overlap without opening acceptance to unknown keys.
- [ ] Signed-only route permission is explicitly integrated using verified per-request machine identity.
- [ ] `gateway=signed + verifier=enforce` succeeds without a WordPress Basic/Application Password.
- [ ] Dedicated WordPress Application Password is revoked only after signed-only read/write acceptance and rollback proof.

### Control separation

- [ ] A valid transport signature alone cannot authorize a material mutation.
- [ ] Transport verification state is not caller-supplied business authority.
- [ ] A6 remains blocked even for a valid signed request.

## 6. Capability admission and write authority

- [ ] `tools/list` exposes only explicitly admitted Simpli-owned capabilities.
- [ ] `simpli_catalog`, `simpli_describe`, `simpli_execute` conform to the accepted backend contract where enabled.
- [ ] Installing unrelated WordPress code cannot automatically expose a privileged MCP tool.
- [ ] Legacy aliases route only to explicit first-party equivalents.
- [ ] No normal MCP tool exposes arbitrary PHP/WP-CLI/admin-login generation/unrestricted filesystem mutation.
- [ ] Read-only capability succeeds with read authority.
- [ ] Normal write is rejected without required write authority.
- [ ] High-impact write is rejected without exact bounded approval/permit.
- [ ] A6 is always rejected.
- [ ] Caller cannot fabricate/override signed execution metadata or authority class.
- [ ] Existing SuperComputer authority service remains the authoritative mutation gate rather than a new public-gateway issuer.
- [ ] Schema validation errors return bounded errors without crashing.
- [ ] Incorrect expected-before-state rejects the write.
- [ ] Duplicate idempotency key cannot create a duplicate mutation.
- [ ] Unknown/timeout write result is inspected before retry.
- [ ] Representative safe write is followed by authoritative read-back verification.
- [ ] Representative write is reverted or targets a disposable/sandbox object.
- [ ] Rollback/recovery evidence is retained for material reversible writes.

## 7. WordPress backend independence

- [ ] Simpli backend responds at `/wp-json/simpli-mcp/v1/mcp` without Novamira enabled.
- [ ] `tools/list` returns the accepted first-party capability set with Novamira disabled.
- [ ] Representative reads pass with Novamira disabled.
- [ ] Representative governed writes pass with Novamira disabled.
- [ ] Disabling Novamira + Pro does not reduce `/ready` below accepted v3 scope.
- [ ] Re-enabling legacy plugins remains available as rollback during observation.
- [ ] Only after these pass may `wordpressBackendIndependence` be promoted from `"unverified"`.

## 8. Recovery and operations

- [ ] Pausing public Simpli MCP removes external MCP access without damaging WordPress.
- [ ] Previous known-good MCP release restores successfully.
- [ ] OAuth state restore preserves expected revocation/replay controls.
- [ ] Signed transport can roll back from `signed` to `dual/basic` while the compatibility credential remains valid during the planned transition.
- [ ] Transport-key replacement/rotation restores verified traffic after intentional key revocation.
- [ ] Audit records contain request/release/ability/authority/verification identifiers but no secrets.
- [ ] Monitoring distinguishes liveness, OAuth state, transport verification and backend readiness.
- [ ] Running release can be identified from `/version` without source inspection.

## 9. Final Novamira retirement gate

Only after Sections 1–8 pass:

- [ ] Disable Novamira Core in production.
- [ ] Disable Novamira Pro in production.
- [ ] Re-run complete accepted read/write smoke suite.
- [ ] Observe first-party path through the agreed stability window.
- [ ] Confirm no production workflow, MCP client, skill, gateway or automation calls a Novamira route.
- [ ] Preserve backup and rollback evidence.
- [ ] Remove Novamira only after observation closes without unresolved dependency.

A successful MCP connection, signature verification or CI run alone is not completion. Final acceptance requires independent client identity, machine transport integrity, business authority, capability controls, state verification, recovery and dependency-elimination evidence.
