# Phase 4C — Fail-Closed Mutation Authority Gate

Status: isolated repository candidate. **No production deployment or WordPress mutation.**

## Objective

Prevent the public Simpli MCP gateway from executing any WordPress mutation merely because:

- an external client has an OAuth write/dangerous scope;
- the caller supplies `authority_ref`, `_confirm` or similar fields;
- the request is correctly signed by the Simpli gateway transport key;
- the backend advertises a write-capable tool.

The existing SuperComputer sealed one-use authority service is the intended source of semantic mutation authority.

## Current execution ceiling

The public gateway is deliberately constrained to:

```text
A2_PROPOSE
```

Direct execution behavior:

```text
wordpress:read       -> may execute through the direct first-party read path
wordpress:write      -> BLOCKED_UNTIL_AUTHORITY_BRIDGE
wordpress:dangerous  -> BLOCKED_UNTIL_AUTHORITY_BRIDGE
```

A blocked mutation returns the bounded error:

```text
SIMPLI_AUTHORITY_BROKER_REQUIRED
```

and is not forwarded to WordPress.

## Why this is necessary

The Phase 4 Ed25519 transport signature establishes machine identity, request integrity, freshness and replay status. It does not prove that a business mutation was approved.

OAuth scopes also remain broad client-access scopes rather than exact execution authority.

The required separation is:

```text
OAuth identity/scope
-> governance decision
-> exact semantic authority / one-use permit
-> signed machine transport
-> WordPress capability policy
-> expected-before-state + idempotency
-> mutation
-> read-back verification
-> audit evidence
```

Until the semantic authority bridge is real and verified, the safe state is read-only direct execution.

## Implementation

### `src/authority-gate.ts`

Defines operator-visible policy:

```text
publicGatewayExecutionCeiling = A2_PROPOSE
mutationAuthoritySource       = supercomputer-sealed-permit
mutationExecutionState        = BLOCKED_UNTIL_AUTHORITY_BRIDGE
directBackendWrites           = false
callerSuppliedAuthorityAccepted = false
```

`assertGatewayExecutionAllowed()` permits only `wordpress:read`.

### MCP catalogue and dispatch

The public `tools/list` now exposes only backend tools explicitly annotated read-only.

Mutation tools are not merely hidden. If a caller attempts a known write tool directly, dispatch performs the authority check before calling WordPress and fails closed.

Legacy aliases follow the same rule. Fixed read-only legacy aliases may route to a fixed first-party read ability, but caller-supplied authority metadata is not forwarded.

Browser QA read operations remain available. Browser interactions classified as write/operational actions are blocked until the authority bridge exists.

### Operator visibility

`/version` and `/ready` expose the mutation-authority posture. `/ready` distinguishes:

```text
readExecutionReady
writeExecutionReady: false
```

A healthy read plane therefore does not falsely imply write readiness.

Release candidate:

```text
version      3.0.0-rc.5
architecture v3-authority-gate-fail-closed
```

## Existing SuperComputer authority evidence

Current read-only status evidence shows the existing clean-room authority lane already has:

- authority issuer/key/ledger readiness;
- machine-attestation bridge readiness;
- caller execution metadata blocked;
- source restricted to verified signed permits;
- A3/A4 exact-scope one-use human approval;
- A5 target-specific dual control;
- A6 hard blocked;
- durable idempotency;
- no sealed signature exposure;
- no blind retry after unknown mutation outcomes.

The live WordPress gateway remains blocked because the upstream contract/catalog is unavailable. This phase does not weaken that fail-closed condition.

## Tests

The authority-gate tests prove:

- read scope is allowed by the public direct path;
- write/dangerous scopes throw `SIMPLI_AUTHORITY_BROKER_REQUIRED`;
- direct backend writes are declared disabled;
- caller-supplied authority is declared unacceptable;
- modern and legacy tool lists omit mutation tools;
- direct mutation calls are rejected before WordPress forwarding;
- fake caller `authority_ref` / confirmation fields cannot unblock execution;
- a mapped read-only compatibility call strips caller authority metadata before forwarding;
- a mapped legacy mutation is rejected before the internal dispatcher;
- existing Phase 4 OAuth/protocol/signed-transport/WhatsApp/build/container regressions continue to run.

## What this phase deliberately does not implement

This phase does **not** invent a fake HTTP authority broker or copy permit issuance into the public gateway.

It does not:

- issue SuperComputer authority permits;
- expose permit signatures to the public gateway;
- execute a live WordPress write;
- deploy the signed WordPress verifier;
- revoke the WordPress Application Password;
- disable Novamira/Novamira Pro;
- claim WordPress backend independence.

## Next trust-boundary step

The next implementation must use an actually available private integration with the existing SuperComputer authority/execution service. Preferred final shape:

```text
public Simpli MCP
  -> proposes exact mutation contract
  -> private SuperComputer authority/execution broker
     -> governance / approval / sealed one-use authority
     -> WordPress execution through governed lane
     -> mandatory read-back
  <- bounded verified outcome only
```

The public gateway should never receive the private issuer key or reusable authority secret. If no deployable private broker exists yet, mutations remain blocked rather than falling back to OAuth scope or caller-provided authority fields.

## Acceptance

Repository acceptance requires exact-head CI from the committed rc.5 lockfile, including full protocol/OAuth/signed-transport regression, tests, PHP verifier checks, Node-to-PHP signature verification and container build.

Production mutation acceptance remains a later gate and requires the real authority bridge, current backend catalogue/readiness, a bounded authorized test write, read-back verification and rollback evidence.
