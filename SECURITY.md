# Security policy and operator controls

Simpli MCP is an administrative control plane. Compromise can expose or change WordPress data, products, orders, SEO settings, storefront configuration and connected operational state.

The v3 security objective is to minimize exposed power while preserving useful business capability.

## Core production principles

1. The public OAuth/MCP edge is Simpli-owned and must not depend on a WordPress plugin for client authentication.
2. WordPress is a bounded execution backend, not the public authorization authority.
3. Capability visibility is not business authority.
4. Every privileged capability must be explicitly admitted and classified.
5. Material writes require read-before-write and read-back verification.
6. Unknown write outcomes must be inspected before retry.
7. Secrets must never appear in repository content, logs, health responses, MCP outputs or issue bodies.
8. A6/forbidden operations remain unavailable regardless of model request or client scope.
9. Fail closed when policy, catalog, before-state, token state or authorization evidence is unavailable.

## Runtime surfaces that must not exist in normal MCP production

The normal Simpli MCP surface must not expose:

- arbitrary PHP execution;
- arbitrary WP-CLI execution;
- unrestricted filesystem traversal/mutation;
- temporary administrator-login generation;
- automatic privileged tool exposure from unrelated plugin installation;
- arbitrary upstream host selection.

Any exceptional maintenance path must be separately bounded, auditable, explicitly authorized and unavailable to ordinary MCP credentials.

## Authentication versus execution authority

OAuth answers: **who is the client and what broad access class may it request?**

The Simpli authority layer answers: **may this exact action be executed on this exact target now?**

Those are separate controls. An OAuth scope alone must never be treated as sufficient authority for a material production mutation.

Current broad scopes are:

| OAuth scope | Broad purpose |
| --- | --- |
| `wordpress:read` | Read-only governed access |
| `wordpress:write` | Normal bounded writes |
| `wordpress:dangerous` | High-impact compatibility operations requiring additional authority |

If a client omits `scope`, v3 defaults to `wordpress:read`; it does not silently grant write/dangerous access.

## OAuth v3 token model

The v3 OAuth tranche deliberately uses **opaque high-entropy tokens** rather than self-contained JWT bearer tokens.

This is the stronger/simpler design for the current architecture because the authorization server and MCP resource server are co-located. The service does not need to distribute token-verification keys to another resource server, while it does need immediate revocation and durable replay controls.

### Properties

- authorization codes, access tokens and refresh tokens contain at least 256 bits of cryptographic randomness;
- raw authorization codes and OAuth tokens are never stored in the SQLite state database;
- only SHA-256 hashes of those bearer values are persisted;
- authorization-code consumption is atomic and durable across process restart;
- refresh tokens rotate on every successful refresh;
- reuse of an already-rotated refresh token revokes the full token family, including newer access tokens;
- access tokens can be revoked immediately;
- client revocation durably revokes the client's token state;
- resource binding is checked during authorization-code exchange, refresh and access-token verification;
- refresh requests cannot increase scope;
- SQLite uses WAL mode and full synchronous durability for file-backed production state.

An asymmetric JWT/JWKS layer should be introduced only if Simpli later separates authorization and resource servers or another verified requirement makes distributed token validation materially useful. Adding signing keys merely to imitate a more complex architecture is not a security improvement.

## OAuth state storage requirements

Production OAuth requires `OAUTH_STATE_DB_PATH` to be an absolute persistent filesystem path. `:memory:` is test-only and is rejected by production configuration validation.

The production state path must:

1. live on persistent storage that survives process/container restart;
2. be writable only by the MCP runtime identity and required operators;
3. be included in the service backup/recovery design;
4. never be copied into source control or build artifacts;
5. be restored/replicated only through an approved operational process.

The database intentionally stores no raw bearer tokens. It still contains client metadata, token hashes, scopes and revocation/replay state and must therefore be treated as operational security state.

## Remaining transitional backend credential

The gateway currently still supports a dedicated WordPress account/Application Password for the Simpli-owned backend channel. That credential is transitional until the signed WordPress execution-envelope tranche is accepted.

Required while it remains active:

1. Use a dedicated WordPress account and dedicated Application Password.
2. Never reuse a human WordPress password.
3. Store credentials only in the deployment secret store.
4. Keep `MCP_STATIC_TOKEN` absent from the public deployment unless a separately approved integration requires it.
5. Keep machine-specific credentials distinct from owner/full-access credentials.
6. Revoke and rotate credentials after suspected exposure.

## Remaining v3 trust-model gates

Before final Novamira retirement and unrestricted v3 production use, implement and verify:

- durable OAuth state on the actual production persistence mount;
- real-client OAuth/MCP acceptance;
- durable idempotency records for writes;
- signed backend execution envelopes;
- replay nonce protection for backend mutations;
- explicit capability registry/policy digest;
- expected-before-state checks for mutable operations;
- read-back verification evidence for material writes;
- Novamira-disabled backend acceptance.

## Signed WordPress execution envelope

The target backend contract should bind, at minimum:

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

The private execution-signing key must remain outside WordPress. WordPress receives only the verification material required to authenticate bounded requests.

## Incident containment

If compromise or unauthorized behavior is suspected:

1. pause external MCP ingress;
2. revoke affected OAuth/static/backend credentials or OAuth clients;
3. revoke the affected token family where refresh-token reuse is suspected;
4. fail the affected capability/policy lane closed;
5. inspect audit records and authoritative WordPress state before retrying any uncertain action;
6. restore affected state from revisions/backups where required;
7. replace credentials only after the cause is contained;
8. verify `/version`, `/health`, `/ready`, authentication and representative read/write controls before restoring production access.

## Recovery

Production changes must preserve a known-good release and rollback path. Prefer release/service/DNS rollback over emergency code edits on WordPress.

Do not remove legacy plugins until the first-party accepted capability set is proven independently and the observation window has closed.

## Reporting

Do not include credentials, authorization codes, access tokens, refresh tokens, WordPress Application Passwords, private execution keys or one-use permits in issue bodies, pull requests, chat messages or diagnostic screenshots.

Share only redacted logs, hashes, request identifiers, rule/policy identifiers and reproducible non-secret metadata.
