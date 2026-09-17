# ROLLING HANDOFF — SAFE CONTINUATION POINT

Date: 2026-09-17
Program: Simpli MCP v3 — Novamira elimination
Unit: Phase 4C — public-gateway semantic authority boundary
Branch: `v3-authority-gate-fail-closed`
Base: `v3-signed-wordpress-runtime`
Draft PR: `#34`
Production deployment: **none**
Live WordPress mutation: **none**
Novamira production state: **unchanged**

## Intended finished state of this unit

The public Simpli MCP gateway may execute direct read operations but must not execute a WordPress mutation until a real private bridge to the existing SuperComputer sealed one-use authority/execution lane is available and accepted.

No OAuth scope, valid Ed25519 transport signature, backend write-tool advertisement, caller `authority_ref`, `_confirm` or similar field may substitute for that authority.

## Current repository state

Release candidate:

```text
version       3.0.0-rc.5
architecture  v3-authority-gate-fail-closed
```

Implemented:

- `src/authority-gate.ts` with public ceiling `A2_PROPOSE`;
- mutation authority source `supercomputer-sealed-permit`;
- mutation state `BLOCKED_UNTIL_AUTHORITY_BRIDGE`;
- direct backend writes false;
- caller-supplied authority accepted false;
- read-only direct `tools/list` exposure;
- direct native writes blocked before WordPress forwarding;
- mapped legacy writes blocked before dispatcher forwarding;
- fixed read-only legacy mapping remains usable but strips caller authority metadata;
- Browser QA write/interact path blocked by the same authority gate;
- `/version` and `/ready` expose authority posture;
- `/ready` distinguishes `readExecutionReady` from `writeExecutionReady: false`;
- pure authority-gate tests;
- MCP integration tests proving mutation tools are hidden and cannot be executed/forwarded;
- dedicated full-regression CI preserving protocol/OAuth/signed-transport/PHP/container tests.

## Evidence already obtained

Initial authority-gate CI on pre-lock head:

```text
run       35218874068
head      a99947767b6d0a5dbb0f766330e8b04207157c96
result    SUCCESS
```

The run also generated/committed the rc.5 lockfile as:

```text
7c91bd38131e02d0038a6af0a43d87083a90bee2
```

A subsequent documentation commit `274ecd3dbdc8b0997b218dc9ea61c4fad7a5ccab` triggered exact committed-lock verification. This handoff commit creates the final repository head, so exact-head CI for this final head remains the next required repository acceptance evidence.

## Current live authority evidence

Read-only SuperComputer checks show:

```text
authority issuer / crypto / public key / ledger   READY
machine attestation bridge                        READY
caller execution metadata                         BLOCKED
source                                              VERIFIED_SIGNED_PERMIT_ONLY
A3/A4                                               EXACT_SCOPE_ONE_USE_HUMAN_APPROVED
A5                                                  DUAL_CONTROL_TARGET_SPECIFIC
A6                                                  BLOCKED_ALWAYS
authority writes_ready                              true
gateway read/write plane                            false
ability catalog                                     UNAVAILABLE
blind retry after unknown                           false
sealed signature exposure                           false
```

Design-only routing for a representative product metadata mutation returned `EVIDENCE_REQUIRED` / `A2_PROPOSE` and executed nothing. That is compatible with the public gateway ceiling introduced here.

## Architectural decision

Do not mint or expose business authority in the public gateway.

Preferred final mutation path:

```text
external client
  -> public Simpli MCP proposal
  -> private SuperComputer authority/execution broker
     -> governance + exact approval
     -> sealed one-use permit internally
     -> governed WordPress execution
     -> mandatory read-back
  <- bounded verified result
```

The public gateway should not receive the authority issuer private key or the one-use permit signature.

## Current blockers

1. No deployable private authority/execution broker endpoint has been verified for the public gateway runtime.
2. Live WordPress clean-room upstream contract/catalog remains unavailable, so current read/write planes are blocked.
3. Signed WordPress verifier is not installed/accepted on production.
4. No production `dual+observe` / `dual+enforce` test has been performed.
5. No live WordPress write is authorized in this unit.
6. WordPress Application Password remains the rollback compatibility credential.
7. Novamira/Pro remain present and are not eligible for retirement.

## Recovery / reversibility

This unit is isolated on a child branch and draft PR. Production is unchanged.

If the design is rejected, discard the child branch/PR; Phase 4 signed-transport branch remains the prior repository checkpoint. No WordPress state requires rollback because no production mutation occurred.

## Next executable unit

1. Obtain exact-head CI success for this handoff head.
2. Keep PR #34 draft and record repository acceptance evidence.
3. Identify the actual private deployment surface for a SuperComputer authority/execution broker without exposing sealed permit material.
4. Implement the broker as a separate, private authority-owned service or existing supported local route — not as caller-supplied fields in the public gateway.
5. Repair the live WordPress upstream contract/catalog blocker independently.
6. Only after current read-plane truth returns, plan a reversible production verifier observation step; still no live write until explicit governed acceptance conditions are met.

## Completion language

Repository authority-gate implementation: `ACTION_EXECUTED`.

Initial CI/evidence: `EVIDENCE_RETRIEVED` / successful on pre-final head.

Phase 4C repository outcome: `PARTIAL` until exact-head CI for this handoff head is green.

Production authority integration: `BLOCKED` pending an actual private broker and live backend readiness.

Novamira elimination: `PARTIAL`; production retirement remains prohibited by the current acceptance state.
