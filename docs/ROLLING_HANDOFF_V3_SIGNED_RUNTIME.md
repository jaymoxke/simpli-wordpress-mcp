# ROLLING HANDOFF — SAFE CONTINUATION POINT

Date: 2026-09-17
Program: Simpli MCP v3 — Novamira elimination
Phase: 4 — signed WordPress runtime transport / authority alignment
Branch: `v3-signed-wordpress-runtime`
Base: `v3-oauth-durable`
Production mutation: **none**
Novamira production state: **unchanged**

## Objective

Replace reusable WordPress backend credential trust with a first-party, short-lived, replay-resistant Ed25519 machine transport while preserving the existing Simpli/SuperComputer semantic authority model as a separate and stronger control.

## Authorizing instruction

James explicitly approved the v3 migration and subsequently instructed `proceed` / `continue`. Current execution is limited to the previously approved isolated repository migration and verification scope. Production deployment, live WordPress mutation and Novamira disable/removal remain excluded until their acceptance gates are separately satisfied.

## Verified repository state

Phase 4 branch contains:

- `simpli-wp-request-v1` TypeScript Ed25519 signer;
- exact method/path/audience/body/release/time/nonce binding;
- `basic | dual | signed` gateway rollout modes;
- WordPress-independent PHP/libsodium verifier core;
- WordPress sidecar with `disabled | observe | enforce` modes;
- durable nonce-hash replay protection in enforce mode;
- per-request `is_verified_request()` state for future signed-only route permission integration;
- overlapping admitted public verifier keys for rotation;
- safe private-key generator (private key written mode 0600 and not printed);
- TypeScript signature/tamper tests;
- dual/signed outbound transport tests;
- Node-to-PHP Ed25519 cross-language test;
- Phase 4 CI workflow with Node 24, PHP 8.2+sodium, tests/build/lint/cross-language/container checks;
- release identity `3.0.0-rc.4` / architecture `v3-signed-wordpress-runtime`;
- migration/security/architecture/acceptance documentation aligned to the three separate trust layers.

The committed dependency lock was automatically regenerated and committed for rc.4 by GitHub Actions. Exact-head CI after the final documentation/handoff commit is still required before repository-level Phase 4 acceptance can be claimed.

## Live SuperComputer evidence retrieved 2026-09-17

`simpli_wordpress_gateway_status()`:

```text
state                         BLOCKED
service                       simpli-wordpress-mcp-cleanroom
version                       v1.2.1-cleanroom-full-governed-attestation-r1
machine_identity              READY
private_key_exported          false
upstream_contract             UNAVAILABLE
read_plane_ready              false
write_plane_ready             false
admitted_abilities            181
admitted_write_abilities      69
authority crypto/public/ledger READY
authority writes_ready        true
ability_catalog               UNAVAILABLE
machine_attestation_bridge    READY
caller_execution_metadata     BLOCKED
source                         VERIFIED_SIGNED_PERMIT_ONLY
A6                             BLOCKED_ALWAYS
```

`simpli_phase3_write_status()`:

```text
state                         PHASE3_GOVERNED_WRITE_BLOCKED
gateway_write_plane_ready     false
authority_writes_ready        true
catalog_state                 UNAVAILABLE
machine_attestation_bridge    READY
default                       DENY
A3/A4                          EXACT_SCOPE_ONE_USE_HUMAN_APPROVED
A5                             DUAL_CONTROL_TARGET_SPECIFIC
A6                             BLOCKED_ALWAYS
sealed_signature_exposure     false
blind_retry_after_unknown      false
```

The durable idempotency ledger is present on the SuperComputer. No private signing material was retrieved or exposed.

## Key architectural decision

Do not create a second business-authority issuer in the public MCP gateway.

The repository's Ed25519 signed transport answers only:

```text
Did an admitted Simpli gateway send these exact request bytes to this exact WordPress origin/route within a valid one-use request window?
```

The existing SuperComputer authority service answers:

```text
May this exact business action execute against this exact target now?
```

The final runtime should compose those controls, not merge them.

## Current blockers / unresolved acceptance

1. Live WordPress clean-room gateway upstream contract/catalog is `UNAVAILABLE`; read/write planes remain blocked.
2. Phase 4 verifier is not installed on production WordPress.
3. Signed-only route permission callback is not yet integrated into the live first-party WordPress runtime.
4. No real `dual + observe` / `dual + enforce` production acceptance has been executed.
5. WordPress Application Password remains the compatibility path; it must not be revoked yet.
6. No production WordPress write has been executed through this Phase 4 branch.
7. Novamira/Pro remain in place and must not be disabled yet.
8. `wordpressBackendIndependence` remains `unverified`.

## Recovery posture

Repository work is isolated on a feature branch. Production remains on the current known-good path.

For eventual transport rollout:

```text
basic/disabled
-> install verifier disabled
-> dual/observe
-> dual/enforce
-> signed/enforce only after permission integration
-> revoke Application Password only after acceptance
```

Rollback before credential retirement is configuration reversal to `dual/basic`. After final credential retirement, a tested key-rotation/recovery path must exist before declaring the old credential permanently unnecessary.

## Next executable unit

1. Verify latest exact branch head CI, including container and Node→PHP contract test.
2. Open a draft Phase 4 PR against `v3-oauth-durable`.
3. Review the full Phase 4 diff and keep PR draft while real-runtime acceptance is still open.
4. Inspect the existing SuperComputer/WordPress authority contract through read-only status/code evidence to identify the smallest integration point for signed transport + sealed semantic permits.
5. Repair the upstream contract/catalog blocker independently; do not try to solve it by weakening authority/security controls.
6. Only after read-plane readiness returns, plan a reversible verifier deployment in `disabled/observe` mode. No production write in this unit.

## Completion language

Repository commits: `ACTION_EXECUTED`.

Live gateway/authority status: `EVIDENCE_RETRIEVED`.

Phase 4 overall: `PARTIAL` until exact-head CI plus real WordPress runtime acceptance and rollback evidence are complete.

Novamira elimination: `PARTIAL` / not yet eligible for production retirement.
