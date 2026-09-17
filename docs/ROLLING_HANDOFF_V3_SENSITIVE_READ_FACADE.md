# ROLLING HANDOFF — SAFE CONTINUATION POINT

Date: 2026-09-17
Program: Simpli MCP v3 — Novamira elimination
Unit: Phase 4F — A2 sensitive-read facade
Branch: `v3-sensitive-read-facade`
Base: `v3-wordpress-read-runtime`
Production deployment: **none**
Live WordPress mutation: **none**
Novamira production state: **unchanged**

## Objective

Prevent ordinary `wordpress:read` OAuth grants from becoming a path to A2 order/customer information while preserving A1 reads, the dedicated WhatsApp safe facade, and the existing fail-closed mutation boundary.

## Verified repository state

Candidate release:

```text
version       3.0.0-rc.8
architecture  v3-sensitive-read-facade
lock head     af5b79fe4d9d3ad899118631e759bf79b7b8bb71
```

The committed dependency lock is rc.8 and matches the package release identity.

Implemented:

- new OAuth scope `wordpress:sensitive`;
- omitted OAuth scopes still default only to `wordpress:read`;
- A1 reads use `wordpress:read`;
- A2 sensitive reads require explicit `wordpress:sensitive`;
- read-only `simpli_execute` performs a nested `simpli_describe` authority check before execution;
- nested A3/A4/A5/A6 or unknown non-read classes cannot use the read dispatcher to bypass the mutation authority broker;
- caller `authority_ref`, `_confirm` or other extra dispatcher metadata is rejected before forwarding;
- public mutation authority remains `supercomputer-sealed-permit`;
- direct backend writes remain disabled;
- dedicated WhatsApp credentials remain restricted to `simpli_whatsapp_read`;
- route-diagnostic evidence correction is recorded in `docs/INCIDENT_U02_ROUTE_DIAGNOSTIC_20260917.md`.

## CI evidence before committed-lock exact-head run

Run `35235249576` completed successfully and passed:

```text
rc.8 lock generation/install       PASS
TypeScript/static checks           PASS
gateway tests                      PASS
WhatsApp gateway checks/tests      PASS
production build                   PASS
runtime syntax                     PASS
PHP runtime syntax                 PASS
first-party read-core regression   PASS
Node -> PHP Ed25519 regression     PASS
container build                    PASS
lockfile commit                    PASS
```

That workflow then committed the deterministic rc.8 lockfile as `af5b79fe4d9d3ad899118631e759bf79b7b8bb71` with `[skip ci]`.

This checkpoint is deliberately committed after that lock commit. The CI run triggered by this commit is the required exact-head verification: because the rc.8 lock is already current, the workflow must not create another bot lock commit.

## Live production state

Production is intentionally unchanged. After bounded diagnostics/canaries, the SuperComputer WordPress gateway was restored to:

```text
v1.2.1-cleanroom-full-governed-attestation-r1
```

Its current first-party upstream remains fail-closed because the exact WordPress MCP POST route is not registered at the tested live origin. No live commerce/customer mutation or credential change occurred.

## Authority scope

James has approved continuation of the first-party Simpli MCP migration. Repository work, read-only diagnostics and bounded reversible canaries remain in scope.

Do not:

- expose A2 customer/order data under ordinary read scope;
- treat OAuth scope as mutation authority;
- widen the existing VitePOS-only plugin-file bridge;
- install the new WordPress runtime through an ungoverned path;
- disable/remove Novamira before live first-party acceptance;
- revoke existing WordPress credentials before signed-only acceptance.

## Acceptance for this unit

Phase 4F repository acceptance requires the fresh CI run on this checkpoint head to pass with the committed rc.8 lockfile and no subsequent branch mutation from lock generation.

If green, open a draft PR from `v3-sensitive-read-facade` to `v3-wordpress-read-runtime` and classify Phase 4F repository work as verified done.

Production acceptance remains separate.

## Next executable unit

After exact-head CI:

1. inspect the existing SuperComputer/WordPress deployment controls for a recoverable exact admission for the new first-party runtime;
2. preserve and reproduce the historical `simpli_whatsapp_read` safe facade before any backend replacement;
3. prepare a deployment admission packet with exact plugin identity/path/hash, before-state, rollback, and no authority widening;
4. only then consider a bounded plugin bootstrap canary.

## Recovery

The branch is isolated and production is unchanged. If rc.8 fails exact-head acceptance, repair or abandon this branch; no production rollback is required.
