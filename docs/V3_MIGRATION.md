# Simpli MCP v3 migration record

## Objective

Replace runtime dependency on Novamira/Novamira Pro with a first-party Simpli MCP control plane while preserving useful architectural ideas through clean-room implementation.

The target state is a stable public MCP/OAuth edge owned by Simpli, a bounded Simpli-owned WordPress runtime, and deterministic authority/verification controls between AI clients and production mutations.

## Non-negotiable design rules

1. WordPress is an execution backend, not the public OAuth/MCP authority surface.
2. MCP/OAuth remains available if WordPress is unavailable; execution readiness fails closed.
3. OAuth identity, signed machine transport and business execution authority are separate layers.
4. Tool visibility is not business authority.
5. Capabilities are explicitly admitted; installing a plugin must never automatically expose privileged AI operations.
6. No normal MCP surface exposes arbitrary PHP, arbitrary WP-CLI, administrator-login generation or unrestricted filesystem mutation.
7. Material writes require read-before-write, bounded authority, idempotency, read-back verification and recoverability where practical.
8. Unknown write outcomes are inspected before retry.
9. Novamira source code is not copied into the Simpli implementation. Useful concepts are reimplemented from requirements and observed behavior.
10. Production remains on the known-good path until acceptance evidence is complete.

## Useful patterns retained conceptually

- OAuth protected-resource discovery;
- Authorization Code + PKCE;
- scoped access and durable revocation;
- JSON Schema inputs/outputs and safety annotations;
- modular capability registration;
- self-diagnostics/readiness;
- pending/reviewable change workflows where they reduce risk;
- fail-closed permission, schema and authority validation.

## Deliberately not retained

- third-party runtime dependency;
- WordPress-hosted public OAuth as the required client path;
- arbitrary PHP/WP-CLI/file editing;
- temporary administrator login links;
- automatic exposure of every installed ability;
- one broad permission treated as authority for all production actions.

## Repository migration chain

```text
v3-foundation-novamira-free
  -> v3-protocol-mcp-v2
  -> v3-oauth-durable
  -> v3-signed-wordpress-runtime
```

Production `main` is not changed merely because an isolated phase branch builds.

## Phase 0 — freeze legacy growth

- no new Novamira-dependent capability;
- Novamira/Pro treated as rollback-only dependencies during migration;
- migrate capabilities by actual business value/risk, not numeric parity.

## Phase 1 — foundation

Implemented on `v3-foundation-novamira-free`:

- canonical runtime release identity and `/version`;
- public gateway source free of direct Novamira route/package dependency;
- acceptance, architecture, security and rollback records;
- regression checks preventing direct Novamira gateway dependency.

Repository/CI evidence exists. Production acceptance remains separate.

## Phase 2 — protocol modernization

Implemented on `v3-protocol-mcp-v2`:

- stable MCP TypeScript SDK v2 split packages;
- per-request HTTP handling;
- explicit 2026-07-28 protocol support;
- stateless legacy fallback;
- removal of gateway MCP session-map dependency;
- protocol/auth/WhatsApp compatibility tests.

Branch CI is verified. Real-client production acceptance remains a later gate.

## Phase 3 — durable OAuth

Implemented on `v3-oauth-durable`:

- Node 24 + SQLite durable security state;
- high-entropy opaque OAuth bearer tokens stored only as SHA-256 hashes;
- durable one-time authorization-code consumption;
- refresh-token rotation and family-reuse containment;
- durable access-token/client revocation;
- restart-persistence tests;
- production requirement for a persistent absolute OAuth DB path.

The OAuth/resource server is currently co-located, so JWT/JWKS was deliberately not introduced. An asymmetric OAuth token-signing layer is not required unless the architecture later needs distributed token verification.

Branch CI is verified. Actual production persistence/restore and real-client acceptance remain open.

## Phase 4 — signed WordPress transport and authority alignment

Current implementation branch: `v3-signed-wordpress-runtime`.

### 4A. Machine transport contract

Implemented candidate contract `simpli-wp-request-v1`:

- Ed25519 detached signature;
- fixed WordPress origin and route;
- exact body SHA-256 binding;
- key ID;
- issued/expiry timestamps;
- one-use nonce;
- Simpli MCP release ID;
- short bounded lifetime;
- TypeScript signer + PHP/libsodium verifier;
- durable WordPress nonce-claim table in enforce mode;
- overlapping public verifier keys for safe rotation;
- Node-to-PHP cross-language verification test.

Gateway rollout modes:

```text
basic -> dual -> signed
```

WordPress verifier modes:

```text
disabled -> observe -> enforce
```

### 4B. Signed-only WordPress route permission

Still required before Application Password retirement:

- install first-party verifier safely;
- prove `dual + observe`;
- prove `dual + enforce` including negative cases;
- make the first-party WordPress route permission callback accept only the verifier's per-request machine-identity state when using signed-only mode;
- prove representative reads;
- preserve Basic rollback until signed-only acceptance completes.

A valid machine signature is not business authority.

### 4C. Semantic execution authority

Do **not** create a second competing authority issuer inside the public gateway.

Current SuperComputer evidence already shows a stronger authority lane with:

- sealed one-use authority;
- A3/A4/A5 policy and A6 hard block;
- durable idempotency;
- machine-attestation bridge;
- caller-supplied execution metadata blocked.

Phase 4 semantic mutation work should align the first-party WordPress runtime with that existing authority service and bind the exact operation/target/state, rather than infer authority from OAuth scope or the transport signature.

Target semantic fields include, as applicable:

```text
ability
object_ref
authority_class
issued_at
expires_at
one-use permit / nonce
idempotency_key
expected_before_state
payload_digest
policy_digest
release_id
verification_read
```

### Phase 4 done criteria

Phase 4 is not complete until:

- exact-head branch CI passes;
- cross-language signature verification passes;
- WordPress observe/enforce behavior is tested on the real first-party runtime;
- replay/expired/tampered/wrong-audience/unknown-key requests fail closed in enforcement;
- signed-only route permission works without a WordPress Application Password;
- the SuperComputer authority lane remains the authoritative mutation gate;
- a bounded representative write passes authority, before-state/idempotency and read-back verification;
- rollback is demonstrated.

## Phase 5 — explicit capability admission

Move from broad/dynamic exposure to a first-party allowlisted registry.

Admission requires Simpli-owned implementation, schemas, authority class, annotations, tests, verification contract, recovery rule and explicit registry admission.

**Done when:** unrelated WordPress code installation cannot create a new MCP-visible privileged tool.

## Phase 6 — capability migration

Port in business-value/risk order:

1. read-only product/catalog/store state;
2. bounded WooCommerce product/variation/inventory writes;
3. Rank Math/SEO;
4. storefront-owned components;
5. shipping/POS bridge;
6. forms/business integrations;
7. bounded maintenance/repair;
8. only remaining capabilities justified by actual workflow evidence.

Do not port legacy power to achieve tool-count parity.

## Phase 7 — shadow verification

- compare first-party reads with authoritative WordPress truth;
- use disposable/sandbox objects for write acceptance;
- never duplicate the same production mutation through two paths;
- run real-client OAuth/MCP acceptance;
- prove rollback.

## Phase 8 — production cutover

- deploy accepted v3 release;
- verify `/version`, `/health`, `/ready`;
- run read-only smoke suite;
- run one bounded representative write + read-back;
- monitor errors, latency, authority failures and backend readiness;
- maintain rollback through the observation window.

## Phase 9 — Novamira retirement

- disable Novamira Core and Pro;
- re-run accepted workflow suite;
- verify no client/skill/automation/backend route depends on Novamira;
- maintain rollback during observation;
- remove legacy plugins only after dependency checks stay clean.

## Rollback strategy

Every production migration step must preserve a known-good target until final retirement. Prefer release/service/configuration/DNS reversal over emergency WordPress modification.

During Phase 4, retain Basic transport until signed-only acceptance passes. During Novamira retirement, retain re-enable/restore capability through the observation window.

## Evidence required for completion claims

A phase is not complete because code exists or CI is green. Depending on the phase, completion evidence includes:

- exact commit SHA and CI result;
- runtime `/version` read-back;
- OAuth protocol/client acceptance;
- backend readiness and catalog evidence;
- signed-transport positive/negative evidence;
- capability/authority evidence;
- representative operation before/after state;
- idempotency/replay evidence;
- rollback evidence;
- dependency scan.

## Current execution order

1. close Phase 4 repository/CI candidate with exact-head evidence;
2. integrate/verify signed transport against the first-party WordPress runtime without removing Basic rollback;
3. align semantic write authority with the existing SuperComputer sealed-permit model;
4. repair the current live upstream contract/catalog blocker independently;
5. proceed to explicit capability admission and business-priority capability migration;
6. perform real-client/shadow acceptance before production cutover;
7. retire Novamira only after the complete accepted workflow set remains healthy with it disabled.
