# Simpli MCP v3 Architecture

Status: foundation candidate. This document defines the target architecture and migration invariants. It does not assert that the production cutover is complete.

## Objective

Remove Novamira and Novamira Pro from the Simpli control path while preserving the useful engineering patterns: typed capability discovery, OAuth-protected remote MCP access, safety annotations, bounded diagnostics, reversible change workflows, and modular domain integrations.

Simpli MCP v3 is a first-party control plane. WordPress is an execution backend, not the public MCP/OAuth server.

## Target request path

```text
ChatGPT / Claude / Codex / approved MCP clients
                  |
                  | HTTPS + OAuth
                  v
        Simpli MCP public edge
                  |
                  v
        Simpli governance kernel
                  |
      exact ability + authority
                  |
                  v
        Simpli WordPress runtime
                  |
                  v
        WordPress / WooCommerce
```

The public OAuth/MCP origin must be independent of the WordPress hosting edge. cPGuard, LiteSpeed, or another WordPress-side WAF must not be required for MCP client discovery or authorization.

## Trust boundaries

### Public MCP edge

Responsibilities:

- MCP protocol handling;
- OAuth protected-resource and authorization-server metadata;
- client identity and token validation;
- rate limiting and request-size limits;
- stable capability catalogue surface;
- request/trace identifiers;
- output limits and redaction.

The public edge must not contain WordPress administrator credentials in client-visible state or logs.

### Governance kernel

OAuth answers: `may this client enter this broad scope?`

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

The kernel must fail closed. Access to a tool never implies authority to use it.

### WordPress runtime

The WordPress component exposes only explicitly admitted first-party Simpli capabilities. Installing another plugin must never automatically expose its administrative API to MCP.

Normal MCP operation must not expose:

- arbitrary PHP execution;
- arbitrary WP-CLI;
- arbitrary filesystem mutation;
- temporary administrator-login creation;
- unbounded SQL execution;
- generic shell/root execution.

Narrow maintenance capabilities may exist only behind explicit policy, exact input schemas, authority classification, and verification.

## Stable public tool surface

Prefer a small public surface:

- `simpli_catalog`
- `simpli_describe`
- `simpli_execute`

Domain abilities remain internal registry entries, for example:

- WordPress content/media;
- WooCommerce catalogue/inventory;
- order and fulfilment reads;
- Rank Math SEO;
- forms;
- storefront-owned configuration;
- shipping/POS bridge;
- bounded performance diagnostics;
- browser QA;
- narrow maintenance.

A capability becomes MCP-visible only after implementation, schema validation, security review, authority assignment, tests, and explicit registry admission.

## Write contract

Every material mutation should implement this sequence:

```text
READ
 -> record before-state/revision/hash
 -> VALIDATE
 -> PREVIEW
 -> AUTHORITY CHECK
 -> IDEMPOTENCY CHECK
 -> WRITE
 -> READ BACK
 -> VERIFY
 -> AUDIT
```

If a write response is uncertain, inspect state before retrying. Never blindly retry a mutation after an unknown outcome.

A future signed WordPress execution envelope should bind at minimum:

- ability name;
- authority class;
- object reference;
- timestamp and expiry;
- nonce;
- idempotency key;
- expected-before-state digest;
- payload digest;
- policy/release identity;
- one-use permit/signature where required.

WordPress should hold verification material, not the SuperComputer private signing key.

## Authentication target

Foundation compatibility may retain the existing OAuth implementation while migration is tested. The target is:

- OAuth Authorization Code + PKCE S256;
- protected-resource metadata;
- resource/audience binding;
- issuer validation;
- Client ID Metadata Documents where supported;
- DCR compatibility only where required by real clients;
- asymmetric signing with key IDs and rotation;
- durable authorization-code replay prevention;
- refresh-token rotation and family reuse detection;
- durable client/token revocation;
- no production static super-token unless an explicitly isolated integration requires one.

## Protocol migration

The existing gateway uses the MCP TypeScript SDK v1 line and session-oriented Streamable HTTP. v3 will migrate to the stable v2 SDK / 2026-07-28 protocol only after compatibility tests for required clients pass. The migration must be staged; a protocol upgrade must not be coupled to the Novamira removal cutover if doing so increases rollback risk.

## Release identity

One canonical release identity must be used by MCP metadata, `/health`, `/ready`, `/version`, logs, and audit evidence:

- semantic version;
- release ID;
- git SHA when available;
- build timestamp when available;
- schema digest;
- policy digest.

`src/version.ts` is the beginning of this consolidation. No endpoint should carry a separately hard-coded product version after the migration is complete.

## Observability

Required endpoints:

- `/health`: process liveness only;
- `/ready`: required dependencies usable;
- `/version`: immutable release identity;
- owner-only bounded diagnostics.

Every consequential operation should emit non-secret evidence including request/trace ID, client identity reference, ability, authority class, object reference, idempotency key, policy/release identity, result, verification state, and latency.

Never log access tokens, refresh tokens, passwords, private keys, or unnecessary customer records.

## Durable security state

Security-sensitive replay/revocation/idempotency state must not rely only on process memory. Initial durable storage may be SQLite WAL on the SuperComputer if operational evidence does not yet justify Postgres. Persistence technology is subordinate to correctness, backup, locking, and recovery tests.

## Migration invariants

1. Production WordPress writes remain single-path; shadow testing must never duplicate a live mutation.
2. Novamira stays available as rollback until first-party parity for required capabilities is proven.
3. No production Novamira removal occurs before read/write acceptance and rollback tests pass.
4. Existing functioning Simpli MCP/SuperComputer services are preserved during foundation work.
5. Every migration step is reversible or has an explicit recovery procedure.
6. Capability count is not a success metric; useful, governed capability coverage is.

## Definition of Novamira-free

The migration is complete only when:

- no public MCP or OAuth request depends on Novamira;
- no admitted Simpli ability dispatches into Novamira/Novamira Pro code;
- required business capabilities have first-party implementations;
- Novamira and Pro can be disabled with all acceptance tests still passing;
- rollback evidence exists;
- an observation period passes without a material dependency being discovered;
- the plugins can then be removed without changing MCP client configuration.
