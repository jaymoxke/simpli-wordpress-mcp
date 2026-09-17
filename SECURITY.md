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
9. Fail closed when policy, catalog, signature, before-state or authorization evidence is unavailable.

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

Current compatibility scopes are:

| OAuth scope | Broad compatibility purpose |
| --- | --- |
| `wordpress:read` | Read-only governed access |
| `wordpress:write` | Normal bounded writes |
| `wordpress:dangerous` | High-impact compatibility operations requiring additional authority |

The v3 target progressively replaces coarse dangerous access with exact authority classes and one-use permits.

## Current compatibility credentials

During the migration, the gateway still supports a dedicated WordPress account/Application Password and an HMAC-based OAuth compatibility implementation.

These are transitional controls, not the final v3 trust model.

Required while they remain active:

1. Use a dedicated WordPress account and dedicated Application Password.
2. Never reuse a human WordPress password.
3. Store credentials only in the deployment secret store.
4. Keep `MCP_STATIC_TOKEN` absent from the public deployment unless a separately approved integration requires it.
5. Keep machine-specific credentials distinct from owner/full-access credentials.
6. Revoke and rotate credentials after suspected exposure.

## v3 target trust model

Before final Novamira retirement and unrestricted v3 production use, implement and verify:

- asymmetric signing for public OAuth tokens or an equivalently strong standards-based authorization service;
- key IDs and controlled signing-key rotation;
- durable authorization-code replay prevention;
- refresh-token rotation;
- refresh-token family reuse detection;
- durable token/client revocation;
- exact issuer/resource/audience binding;
- durable idempotency records for writes;
- signed backend execution envelopes;
- replay nonce protection;
- explicit capability registry/policy digest;
- expected-before-state checks for mutable operations;
- read-back verification evidence for material writes.

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

The private signing key must remain outside WordPress. WordPress receives only the verification material required to authenticate bounded requests.

## Incident containment

If compromise or unauthorized behavior is suspected:

1. pause external MCP ingress;
2. revoke affected OAuth/static/backend credentials;
3. revoke or rotate signing keys as appropriate;
4. fail the affected capability/policy lane closed;
5. inspect audit records and authoritative WordPress state before retrying any uncertain action;
6. restore affected state from revisions/backups where required;
7. replace credentials only after the cause is contained;
8. verify `/version`, `/health`, `/ready`, authentication and representative read/write controls before restoring production access.

## Recovery

Production changes must preserve a known-good release and rollback path. Prefer release/service/DNS rollback over emergency code edits on WordPress.

Do not remove legacy plugins until the first-party accepted capability set is proven independently and the observation window has closed.

## Reporting

Do not include credentials, authorization codes, access tokens, refresh tokens, WordPress Application Passwords, private keys or one-use permits in issue bodies, pull requests, chat messages or diagnostic screenshots.

Share only redacted logs, hashes, request identifiers, rule/policy identifiers and reproducible non-secret metadata.
