# Security policy and operator controls

Simpli MCP is an administrative control plane. Compromise can expose or change WordPress data, products, orders, SEO settings, storefront configuration and connected operational state.

The v3 security objective is to minimize exposed power while preserving useful business capability.

## Core production principles

1. The public OAuth/MCP edge is Simpli-owned and does not rely on WordPress for client authentication.
2. WordPress is a bounded execution backend, not the public authorization authority.
3. OAuth identity, machine transport identity and business execution authority are three different controls.
4. Capability visibility is not business authority.
5. Every privileged capability must be explicitly admitted and classified.
6. Material writes require read-before-write, exact authority and read-back verification.
7. Unknown write outcomes must be inspected before retry.
8. Secrets must never appear in repository content, logs, health responses, MCP outputs or issue bodies.
9. A6/forbidden operations remain unavailable regardless of model request, client scope or valid transport signature.
10. Fail closed when policy, catalog, before-state, token state, transport identity or authorization evidence required for the operation is unavailable.

## Runtime surfaces that must not exist in normal MCP production

The normal Simpli MCP surface must not expose:

- arbitrary PHP execution;
- arbitrary WP-CLI execution;
- unrestricted filesystem traversal/mutation;
- temporary administrator-login generation;
- automatic privileged tool exposure from unrelated plugin installation;
- arbitrary upstream host selection;
- a reusable caller-supplied field that can manufacture or broaden execution authority.

Any exceptional maintenance path must be separately bounded, auditable, explicitly authorized and unavailable to ordinary MCP credentials.

## Three independent trust gates

### 1. OAuth client identity

OAuth answers: **which external client is authenticated and what broad scope may it request?**

Current broad scopes are:

| OAuth scope | Broad purpose |
| --- | --- |
| `wordpress:read` | Read-only governed access |
| `wordpress:write` | Normal bounded writes |
| `wordpress:dangerous` | High-impact compatibility operations requiring additional authority |

If a client omits `scope`, v3 defaults to `wordpress:read`.

### 2. Signed machine transport

The `simpli-wp-request-v1` Ed25519 contract answers: **did the admitted Simpli gateway send these exact request bytes to this exact WordPress origin/route within this short validity window, and has this nonce already been consumed?**

It does not answer whether a product, order, price, stock quantity or configuration may be changed.

The gateway binds:

```text
method
path
audience
key_id
issued_at
expires_at
nonce
body_sha256
release_id
```

The WordPress verifier stores only public verification keys and nonce hashes. The private transport key remains outside WordPress.

### 3. Business/execution authority

The Simpli authority layer answers: **may this exact action execute against this exact object now?**

The existing SuperComputer model uses bounded authority classes and sealed/one-use authority. A valid OAuth token and a valid transport signature are still insufficient for a material write when the authority layer requires a permit, exact scope, expected state, dual control or other gate.

The intended order is:

```text
OAuth identity/scope
-> governance route
-> exact authority / one-use permit
-> signed machine transport
-> WordPress capability policy
-> expected-before-state / idempotency
-> mutation
-> read-back verification
-> audit evidence
```

## OAuth v3 token model

The v3 OAuth tranche deliberately uses **opaque high-entropy tokens** rather than self-contained JWT bearer tokens.

This is the simpler and stronger design for the current co-located authorization/resource-server architecture because it provides immediate revocation and durable replay controls without adding a distributed token-verification key lifecycle that is not currently needed.

Properties:

- authorization codes, access tokens and refresh tokens contain high cryptographic entropy;
- raw authorization codes and OAuth tokens are never stored in the SQLite state database;
- only SHA-256 hashes of bearer values are persisted;
- authorization-code consumption is atomic and durable across restart;
- refresh tokens rotate on every successful refresh;
- reuse of an already-rotated refresh token revokes the full token family;
- access tokens and clients can be revoked durably;
- resource binding is checked during authorization-code exchange, refresh and access-token verification;
- refresh requests cannot increase scope;
- SQLite uses durable file-backed state in production.

An OAuth JWT/JWKS layer should be added only if authorization and resource servers are separated or another verified requirement justifies distributed token validation.

## OAuth state storage requirements

Production OAuth requires `OAUTH_STATE_DB_PATH` to be an absolute persistent filesystem path. `:memory:` is test-only and is rejected by production configuration validation.

The production state path must survive restart, be writable only by the MCP runtime/operators who require it, be covered by backup/recovery, and never be copied into source control or build artifacts.

## Signed WordPress transport

The gateway supports staged backend authentication:

```text
basic -> dual -> signed
```

- `basic`: WordPress Application Password only.
- `dual`: Basic plus Ed25519 request attestation.
- `signed`: Ed25519 request attestation only.

WordPress enforcement is separately staged:

```text
disabled -> observe -> enforce
```

Production must first prove `dual + observe`, then `dual + enforce`. Signed-only mode is not allowed until the WordPress route permission layer explicitly accepts the verifier's per-request verified state and representative reads/writes pass acceptance.

### Signed transport requirements

- private Ed25519 key mounted from deployment secret storage;
- WordPress stores public verification material only;
- validity window limited to at most 300 seconds;
- exact body digest verified before dispatch;
- audience/route binding enforced;
- unknown key IDs rejected;
- replay nonces durably claimed in enforce mode;
- overlapping public verifier keys permitted for controlled rotation;
- no private key or full signature/credential logged.

## Transitional WordPress Application Password

The Application Password remains a compatibility credential until signed-only acceptance passes.

While present:

1. use a dedicated WordPress account/Application Password;
2. never reuse a human password;
3. store it only in deployment secret storage;
4. use `dual` mode during signed-verifier acceptance;
5. revoke it only after signed-only permission handling, representative reads, one bounded governed write/read-back, and rollback are verified.

## Authority and write safety

The signed transport is intentionally **not** the semantic execution envelope.

For material writes, the authority layer should bind or verify, as applicable:

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

The live SuperComputer authority service already implements important parts of this model, including sealed one-use authority, authority classes, durable idempotency and a machine-attestation bridge. Phase 4 must integrate with that existing authority source rather than create a second competing issuer in the public gateway.

## Remaining trust-model gates

Before final Novamira retirement and unrestricted v3 production use, verify:

- durable OAuth on the actual production persistence mount;
- real-client OAuth/MCP acceptance;
- signed WordPress transport in `dual + observe` and `dual + enforce`;
- signed-only WordPress permission handling;
- existing SuperComputer one-use authority aligned with the first-party WordPress runtime;
- explicit capability registry/policy digest;
- expected-before-state and idempotency for mutable operations;
- mandatory read-back verification evidence for material writes;
- Novamira-disabled backend acceptance.

## Incident containment

If compromise or unauthorized behavior is suspected:

1. pause external MCP ingress;
2. revoke affected OAuth/static/backend credentials or OAuth clients;
3. revoke the affected OAuth token family where refresh-token reuse is suspected;
4. remove/revoke an affected transport public key ID and rotate the gateway private key if transport-key compromise is suspected;
5. fail the affected capability/authority lane closed;
6. inspect audit records and authoritative WordPress state before retrying any uncertain action;
7. restore affected state from revisions/backups where required;
8. replace credentials/keys only after the cause is contained;
9. verify `/version`, `/health`, `/ready`, authentication, transport verification and representative read/write controls before restoring production access.

## Recovery

Production changes must preserve a known-good release and rollback path. Prefer release/service/configuration rollback over emergency code edits on WordPress.

During the Phase 4 transition, Basic transport remains the rollback path until signed-only mode is accepted. Do not revoke the Application Password early. Do not remove Novamira/Pro until the first-party accepted capability set is proven independently and the observation window has closed.

## Reporting

Do not include credentials, authorization codes, access tokens, refresh tokens, WordPress Application Passwords, private signing keys or one-use permits in issue bodies, pull requests, chat messages or diagnostic screenshots.

Share only redacted logs, public-key fingerprints, request identifiers, rule/policy identifiers and reproducible non-secret metadata.
