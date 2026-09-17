# ROLLING HANDOFF — SAFE CONTINUATION POINT

Date: 2026-09-17
Program: Simpli MCP v3 — Novamira elimination
Unit: Phase 4D — WordPress backend-edge compatibility
Branch: `v3-backend-edge-compat`
Base: `v3-authority-gate-fail-closed`
Draft PR: `#35`
Production deployment: **none**
Live WordPress mutation: **none**
Novamira production state: **unchanged**

## Objective

Move the public MCP/OAuth edge out of WordPress/Novamira and make the Simpli-owned gateway-to-WordPress hop stable across the current shared-hosting security edge without weakening cryptographic identity or semantic mutation authority.

## Verified repository state

Candidate release:

```text
version       3.0.0-rc.6
branch        v3-backend-edge-compat
prior head    b656c207493e44d07d34adfdb9e0ca53e1e5467d
```

The branch is 13 commits ahead of `v3-authority-gate-fail-closed` and was created from exact base head `4c95aedaa53f2f83090b90e424d24e5f17da8df6`.

Implemented in this unit:

- `WORDPRESS_URL` is constrained to an exact origin rather than an arbitrary URL/path;
- the backend route remains fixed at `/wp-json/simpli-mcp/v1/mcp`;
- upstream redirects remain rejected;
- the gateway can use a browser-compatible hosting-edge User-Agent without treating User-Agent as security identity;
- `X-Simpli-Client` and release metadata retain truthful first-party identity;
- custom User-Agent CR/LF/header injection is rejected;
- Ed25519 signed transport remains the machine identity/integrity/freshness/replay mechanism;
- public gateway execution ceiling remains `A2_PROPOSE`;
- direct backend writes remain disabled;
- caller-supplied authority remains rejected;
- mutation authority remains `supercomputer-sealed-permit` and is not reimplemented in the public gateway;
- rc.6 dependency lock is committed.

## Verified pre-checkpoint CI evidence

The most recent substantive backend-edge workflow completed all engineering checks before its final branch self-push step:

```text
TypeScript/static checks             PASS
Simpli MCP tests                     46 / 46 PASS
WhatsApp gateway tests               75 / 75 PASS
production build                     PASS
runtime syntax                       PASS
PHP signed-transport syntax          PASS
Node -> PHP Ed25519 vector            PASS
container build                      PASS
```

The workflow's final lockfile push failed because the branch advanced concurrently. This was a Git branch race, not a test/build failure. The deterministic rc.6 `package-lock.json` was subsequently committed by GitHub Actions at `b656c207493e44d07d34adfdb9e0ca53e1e5467d`.

This checkpoint commit intentionally creates a fresh PR/push head so CI can validate the committed lockfile and full candidate state without relying on the raced run.

## Current live SuperComputer evidence

Observed 2026-09-17 after resumption:

```text
simpli-mcp service                   RUNNING / health ok
simpli-mcp release                   v0.2.1-rc25r6r4-whatsapp-phone-r2
WordPress gateway                    BLOCKED / HTTP 503
WordPress gateway runtime            v1.2.1-cleanroom-full-governed-attestation-r1
machine identity                     READY
upstream_contract                    UNAVAILABLE
ability_catalog                      UNAVAILABLE
read_plane_ready                     false
write_plane_ready                    false
authority crypto/public key/ledger   READY
authority writes_ready               true
machine attestation bridge           READY
caller execution metadata            BLOCKED
A3/A4                                EXACT_SCOPE_ONE_USE_HUMAN_APPROVED
A5                                   DUAL_CONTROL_TARGET_SPECIFIC
A6                                   BLOCKED_ALWAYS
blind retry after unknown            false
```

The failure is therefore still upstream of business execution: the local gateway and authority infrastructure are alive, but the live first-party WordPress upstream contract/catalog cannot currently be obtained.

## Evidence classification

Verified:

- the public v3 repository path has no direct Novamira gateway dependency;
- repository-side backend-edge hardening exists in the isolated rc.6 branch;
- the live SuperComputer control service and authority issuer are healthy;
- the live WordPress gateway is fail-closed because upstream contract/catalog are unavailable.

Not yet verified:

- exact live canonical WordPress origin serving `/wp-json/simpli-mcp/v1/mcp` with no redirect;
- whether the current 403/timeout is entirely caused by cPGuard, a canonical-host mismatch, undeployed first-party runtime, or another hosting-edge condition;
- Novamira-disabled WordPress backend independence;
- production signed-only transport acceptance;
- production write acceptance.

## Authority scope

James approved continuing the Simpli MCP v3 migration and Novamira-elimination work. Routine reversible repository preparation, diagnostics and read-only inspection remain in scope.

Do not perform a live commerce mutation, revoke current WordPress credentials, disable/remove Novamira, or cut production traffic until the applicable acceptance evidence exists.

## Next executable unit

1. Obtain a clean exact-head CI result for this checkpoint head.
2. Diagnose the live `upstream_contract = UNAVAILABLE` condition using read-only evidence first.
3. Identify the exact canonical WordPress origin and whether the first-party `/wp-json/simpli-mcp/v1/mcp` route is deployed and reachable from the SuperComputer.
4. Repair the smallest proven blocker without weakening the WAF or semantic authority model.
5. Re-run `simpli_wordpress_gateway_status` and require `upstream_contract = CURRENT`, ability catalog available, and bounded reads passing before any production cutover discussion.

## Recovery

- Production has not been changed by this branch.
- PR `#35` remains draft.
- Base recovery point remains `v3-authority-gate-fail-closed` at `4c95aedaa53f2f83090b90e424d24e5f17da8df6`.
- The existing live WordPress gateway/runtime and Novamira state are unchanged.
- If backend-edge rc.6 fails acceptance, abandon or revert this branch rather than weakening the live security boundary.
