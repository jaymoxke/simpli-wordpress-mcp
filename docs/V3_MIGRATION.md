# Simpli MCP v3 migration record

## Objective

Replace all runtime dependency on Novamira/Novamira Pro with a first-party Simpli MCP control plane while preserving only useful architectural ideas through clean-room implementation.

The target state is a stable public MCP/OAuth edge owned by Simpli, a bounded Simpli-owned WordPress runtime, and deterministic authority/verification controls between AI clients and production mutations.

## Non-negotiable design rules

1. WordPress is an execution backend, not the public OAuth/MCP authority surface.
2. MCP/OAuth remains available even when WordPress is unavailable; readiness must fail closed when backend execution is unavailable.
3. Tool visibility is not business authority.
4. Capabilities are explicitly admitted; installing a plugin must never automatically expose privileged AI operations.
5. No normal MCP surface exposes arbitrary PHP, arbitrary WP-CLI, administrator-login generation, or unrestricted filesystem mutation.
6. Material writes require read-before-write, bounded authority, idempotency, read-back verification and recoverability where practical.
7. Unknown write outcomes are inspected before retry.
8. Novamira source code is not copied into the Simpli implementation. Useful concepts are reimplemented from requirements and observed behaviour.
9. Production remains on the known-good path until acceptance evidence is complete.

## What is retained conceptually

Useful patterns to preserve through Simpli-owned implementation:

- OAuth protected-resource discovery;
- Authorization Code + PKCE;
- short-lived access credentials;
- scoped access;
- JSON Schema inputs and outputs;
- read-only/destructive/idempotent/open-world annotations;
- modular capability registration;
- self-diagnostics and readiness;
- pending/reviewable change workflows where they materially reduce risk;
- fail-closed permission and schema validation.

## What is deliberately not retained

- third-party runtime dependency;
- WordPress-hosted public OAuth as the required client path;
- arbitrary PHP execution;
- arbitrary WP-CLI execution;
- unrestricted file editing/traversal;
- temporary administrator login links;
- automatic exposure of every installed ability;
- one broad permission treated as authority for all production actions.

## Current verified repository baseline

The current TypeScript gateway already calls the Simpli-owned WordPress backend at:

```text
/wp-json/simpli-mcp/v1/mcp
```

using `tools/list` and `tools/call` JSON-RPC requests. This is the foundation for removing the remaining legacy assumptions rather than rebuilding the public gateway from zero.

The v3 foundation branch is:

```text
v3-foundation-novamira-free
```

Production `main` remains unchanged until a reviewed merge and separate deployment decision.

## Migration phases

### Phase 0 - Freeze legacy growth

- Do not add new Novamira-dependent capabilities.
- Treat Novamira/Pro as rollback-only legacy dependencies during migration.
- Inventory actual capabilities needed by current workflows.

**Done when:** no new feature requires a Novamira namespace or route.

### Phase 1 - v3 foundation

- establish one canonical release identity;
- expose `/version`;
- eliminate Novamira-centric documentation;
- add regression tests preventing Novamira runtime endpoint/package dependencies;
- define final acceptance and rollback gates;
- retain current transport/auth compatibility while changing no production state.

**Done when:** CI passes on the isolated branch and the branch can build without introducing production changes.

### Phase 2 - protocol modernization

- migrate from the v1 SDK compatibility line to the current stable MCP v2 packages;
- support the current protocol revision required by production clients;
- remove protocol-state assumptions no longer required by the current spec;
- preserve compatibility only where real clients still require it;
- run official/conformance tests where applicable.

**Done when:** target clients connect and the compatibility matrix is verified.

### Phase 3 - OAuth durability and key management

Replace process-memory and shared-secret security state with durable, rotatable controls:

- durable authorization-code replay prevention;
- asymmetric signing;
- key IDs and JWKS;
- signing-key rotation;
- refresh-token rotation;
- refresh-token-family reuse detection;
- durable client/token revocation;
- exact audience/resource/issuer enforcement;
- current preferred client-registration mechanism with compatibility fallback where required.

**Done when:** replay/revocation/rotation tests survive process restart.

### Phase 4 - signed WordPress runtime contract

Replace broad backend credential trust with a bounded signed execution envelope.

Each mutating request should bind at least:

```text
ability
object_ref
authority_class
issued_at
expires_at
nonce
idempotency_key
expected_before_state
payload_hash
policy_digest
release_id
signature
```

The private execution key remains outside WordPress. WordPress stores only the corresponding verification key/material needed to validate requests.

**Done when:** unsigned, expired, replayed, wrong-before-state and unauthorized requests fail closed.

### Phase 5 - explicit capability admission

Move from broad dynamic exposure to an allowlisted capability registry.

Admission requires:

1. Simpli-owned implementation;
2. input/output schema;
3. explicit authority class;
4. read/write/destructive/idempotent annotations;
5. tests;
6. verification contract;
7. rollback/recovery rule where applicable;
8. registry approval.

**Done when:** installing unrelated WordPress code cannot create a new MCP-visible privileged tool.

### Phase 6 - capability migration

Port capabilities in commercial-value/risk order:

1. read-only product/catalog/store state;
2. WooCommerce bounded product/variation/inventory writes;
3. Rank Math/SEO writes;
4. storefront-owned components;
5. shipping and POS bridge operations;
6. forms and other business integrations;
7. bounded maintenance/repair operations;
8. only then any remaining legacy capability shown by real usage evidence to be necessary.

Do not port legacy power merely to achieve numeric parity.

**Done when:** the accepted business workflow set has first-party equivalents and no accepted workflow needs Novamira.

### Phase 7 - shadow verification

- compare first-party reads against authoritative WordPress truth;
- use disposable/sandbox objects for write tests;
- never duplicate the same production mutation through both legacy and v3 paths;
- verify rollback;
- run real-client OAuth/MCP tests.

**Done when:** the acceptance suite has evidence, not only transport success.

### Phase 8 - production cutover

- deploy the accepted v3 release;
- confirm `/version`, `/health`, `/ready`;
- run read-only smoke tests;
- run one bounded representative write and read-back verification;
- monitor error rate, latency, authority failures and backend readiness.

**Done when:** the agreed observation window completes without an unresolved material defect.

### Phase 9 - Novamira retirement

- disable Novamira Core and Pro;
- re-run the accepted workflow suite;
- verify no client, skill, automation or backend route calls a Novamira endpoint;
- retain rollback through the observation window;
- remove legacy plugins only after the dependency check remains clean.

## Rollback strategy

Until Phase 9 closes, every production migration step must preserve a known-good rollback target.

Rollback should prefer release/service/DNS reversal over emergency WordPress modification. Do not delete legacy plugins merely because the new gateway connects successfully.

## Evidence required for completion claims

A phase is not complete because code was written or a CI job passed. Depending on the phase, completion evidence includes:

- commit SHA;
- CI/build/test result;
- runtime `/version` read-back;
- OAuth protocol test;
- backend readiness read-back;
- tool catalog evidence;
- representative operation evidence;
- before/after state;
- idempotency/replay evidence;
- rollback evidence;
- dependency scan.

## Immediate implementation order

1. Complete Phase 1 on the isolated branch.
2. Open a draft PR to trigger CI and obtain reviewable diff/evidence.
3. Repair any CI failure before merging.
4. Keep production unchanged.
5. Begin Phase 2 only after the Phase 1 branch is verified.
