# Simpli MCP v3 Architecture

Status: staged migration candidate. This document defines the target architecture and migration invariants; it does not assert production cutover is complete.

## Objective

Remove Novamira and Novamira Pro from the Simpli control path while preserving useful engineering patterns through clean-room implementation: typed capability discovery, OAuth-protected remote MCP access, safety annotations, bounded diagnostics, reversible workflows and modular domain integrations.

Simpli MCP v3 is a first-party control plane. WordPress is an execution backend, not the public MCP/OAuth server.

## Target request path

```text
ChatGPT / Claude / Codex / approved MCP clients
                  |
                  | HTTPS + OAuth/PKCE
                  v
        Simpli MCP public edge
                  |
                  v
        Simpli governance kernel
                  |
        exact business authority
                  |
                  v
      Ed25519 signed backend transport
                  |
                  v
        Simpli WordPress runtime
                  |
                  v
        WordPress / WooCommerce
```

The public OAuth/MCP origin is independent of WordPress-hosted OAuth. cPGuard/LiteSpeed on the WordPress host therefore cannot block ChatGPT/Claude OAuth discovery by User-Agent.

## Trust boundaries

### Public MCP edge

Responsibilities:

- MCP protocol handling;
- OAuth protected-resource/authorization metadata;
- external client identity and token validation;
- rate/request-size controls;
- stable public tool surface;
- request/trace identifiers;
- output limits and redaction.

The public edge must not expose WordPress credentials, private transport keys or authority permits to clients/logs.

### OAuth service

The current authorization/resource server is co-located. It uses durable high-entropy opaque tokens whose raw values are not persisted; only SHA-256 hashes are stored.

The OAuth layer provides broad client identity/scope, not business-mutation authority.

Current requirements include Authorization Code + PKCE S256, protected-resource metadata, resource binding, durable authorization-code replay protection, refresh rotation/reuse containment and durable revocation.

JWT/JWKS is not required while token validation remains local to the co-located resource server. It becomes relevant only if distributed validation is later justified.

### Governance/authority kernel

Governance answers: `may this exact action execute against this exact object now?`

Authority classes remain separate from OAuth scopes:

| Class | Meaning |
| --- | --- |
| A1 | Read/analyse |
| A2 | Propose/prepare |
| A3 | Exact controlled operation |
| A4 | Bounded mutation with verification |
| A5 | High-impact, target-specific dual control |
| A6 | Always blocked from autonomous execution |

The live SuperComputer already contains a sealed one-use authority lane, durable idempotency and a machine-attestation bridge. v3 should integrate with that source of authority instead of minting a competing authority model inside the public gateway.

### Signed backend transport

The `simpli-wp-request-v1` contract authenticates the Simpli gateway to WordPress and binds the exact HTTP request with Ed25519.

It covers:

```text
method
fixed path
WordPress audience/origin
transport key ID
issued-at
expires-at
one-use nonce
exact body SHA-256
Simpli MCP release ID
```

This layer proves machine identity, integrity, freshness and replay status. It **does not** grant business authority.

Private signing material remains outside WordPress. WordPress stores only admitted public verifier keys and durable nonce hashes.

### WordPress runtime

The WordPress component exposes only explicitly admitted first-party Simpli capabilities. Installing another plugin must not automatically expose its administrative API to MCP.

Normal operation must not expose:

- arbitrary PHP/WP-CLI;
- arbitrary filesystem mutation;
- temporary administrator-login creation;
- unbounded SQL;
- generic shell/root execution.

The first-party route permission layer must distinguish verified machine transport from semantic execution authority.

## Stable public tool surface

Prefer a small public interface:

```text
simpli_catalog
simpli_describe
simpli_execute
```

Domain abilities remain internal registry entries across WordPress/WooCommerce/SEO/storefront/shipping/POS/forms/performance/browser-QA and tightly bounded maintenance.

A capability becomes usable only after implementation, schemas, security review, authority assignment, tests, verification contract and explicit registry admission.

## Material write contract

Every material mutation should follow:

```text
READ
 -> record before-state/revision/hash
 -> VALIDATE
 -> PREVIEW
 -> AUTHORITY CHECK
 -> IDEMPOTENCY CHECK
 -> SIGNED TRANSPORT
 -> WRITE
 -> READ BACK
 -> VERIFY
 -> AUDIT
```

If a write result is uncertain, inspect authoritative state before retry. Never blindly replay a mutation after an unknown outcome.

The semantic authority/execution contract should bind or validate, as applicable:

```text
ability
object_ref
authority_class
issued_at / expires_at
one-use permit / nonce
idempotency_key
expected_before_state
payload_digest
policy_digest
release_id
verification_read
```

This semantic contract is distinct from the machine transport signature.

## Signed transport rollout

Gateway modes:

```text
basic -> dual -> signed
```

WordPress verifier modes:

```text
disabled -> observe -> enforce
```

Production order is deliberately reversible:

```text
basic/disabled
-> install verifier disabled
-> dual/observe
-> dual/enforce
-> signed/enforce after permission integration + acceptance
-> revoke Application Password
```

The verifier supports overlapping admitted public keys for rotation. Unknown key IDs fail closed in enforcement mode.

## Protocol architecture

v3 uses the stable MCP TypeScript SDK v2 split packages. The HTTP server is per-request/stateless at the protocol layer, explicitly supports the 2026-07-28 era and retains a stateless legacy fallback only for required older clients.

Protocol compatibility is tested independently from Novamira-removal cutover so rollback remains manageable.

## Release identity

One canonical runtime identity is used by MCP metadata, `/health`, `/ready`, `/version`, logs and evidence:

- semantic version/release ID;
- git SHA/build timestamp where available;
- protocol/runtime posture;
- OAuth token model;
- signed transport contract/algorithm;
- independence evidence state.

`wordpressBackendIndependence` remains `unverified` until Novamira-disabled read/write acceptance passes.

## Observability

Required endpoints:

- `/health`: process liveness only;
- `/ready`: required security/backend dependencies usable;
- `/version`: canonical release/dependency posture;
- owner-only bounded diagnostics.

Consequential operations should emit non-secret evidence such as request/trace ID, client reference, ability, authority class, object reference, idempotency key, policy/release identity, result, verification state and latency.

Never log access/refresh tokens, passwords, Application Passwords, private signing keys, one-use permits or unnecessary customer data.

## Durable state

Security-sensitive state must not depend only on process memory.

Current durable areas include OAuth SQLite state. WordPress signed-transport enforcement uses a durable nonce-claim table. The SuperComputer authority lane has its own durable idempotency ledger.

Persistence technology is subordinate to correctness, backup, locking, recovery and replay behavior.

## Migration invariants

1. Production WordPress writes remain single-path; shadow testing never duplicates a live mutation.
2. Machine transport identity never substitutes for business authority.
3. Novamira remains rollback-capable until first-party required workflows pass acceptance.
4. No Novamira removal occurs before read/write + rollback evidence.
5. Existing functioning Simpli/SuperComputer services are preserved during staged work.
6. Every migration step is reversible or has an explicit recovery path.
7. Capability count is not a success metric; governed business-workflow coverage is.
8. No completion claim is based solely on HTTP success, signature success or CI success.

## Definition of Novamira-free

The migration is complete only when:

- no public MCP/OAuth request depends on Novamira;
- no admitted first-party ability dispatches into Novamira/Pro code;
- required business capabilities have first-party implementations;
- signed-only backend transport and governed authority work without reusable WordPress backend credentials where accepted;
- Novamira and Pro can be disabled with all accepted tests passing;
- rollback evidence exists;
- an observation period completes without a material hidden dependency;
- the plugins can then be removed without changing MCP client configuration.
