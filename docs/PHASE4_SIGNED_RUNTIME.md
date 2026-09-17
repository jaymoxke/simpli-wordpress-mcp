# Phase 4 — Signed WordPress Runtime Transport

Status: isolated implementation candidate. **Not deployed to production.**

## Objective

Reduce the WordPress trust boundary from a reusable WordPress Application Password to a short-lived, body-bound, replay-resistant machine attestation while preserving Simpli's separate business-authority controls.

This phase does not make a transport signature equivalent to permission to mutate WordPress. It authenticates the calling Simpli gateway and the exact request bytes only.

## Contract

Contract version:

```text
simpli-wp-request-v1
```

Algorithm:

```text
Ed25519 detached signature
```

The canonical signed message binds, in order:

```text
SIMPLI-WP-REQUEST-V1
HTTP method
fixed request path
WordPress origin/audience
key ID
issued-at epoch seconds
expires-at epoch seconds
one-use nonce
SHA-256 body digest (base64url)
Simpli MCP release ID
```

The current gateway emits:

```text
X-Simpli-Auth-Version
X-Simpli-Key-Id
X-Simpli-Issued-At
X-Simpli-Expires-At
X-Simpli-Nonce
X-Simpli-Body-Sha256
X-Simpli-Release-Id
X-Simpli-Audience
X-Simpli-Signature
```

The request destination remains fixed at:

```text
/wp-json/simpli-mcp/v1/mcp
```

A caller cannot select another upstream host or route.

## Key custody

The private Ed25519 key belongs outside WordPress and must be mounted into the Simpli MCP gateway from deployment secret storage.

WordPress receives only public verification material. The repository includes a generator that:

- creates an Ed25519 PKCS#8 private key with file mode `0600`;
- refuses to overwrite an existing private key;
- outputs the key ID, raw public key and SHA-256 public-key fingerprint;
- never prints the private key.

The WordPress verifier can admit a small overlapping public-key set for rotation. This permits:

1. add new public key alongside old;
2. deploy gateway using new private key/key ID;
3. verify traffic on the new key;
4. remove old public key after the overlap window.

No private key is stored in WordPress.

## Replay and freshness controls

Gateway signatures are short-lived. The configured lifetime is constrained to 10–300 seconds; the example/default is 60 seconds.

In `enforce` mode the WordPress verifier:

- rejects missing signed-transport fields;
- rejects unknown key IDs;
- rejects malformed timestamps;
- rejects excessive lifetimes;
- rejects future/expired requests outside bounded clock skew;
- rejects audience mismatch;
- rejects body-digest mismatch;
- rejects invalid Ed25519 signatures;
- atomically claims a hash of `key_id + nonce` in a WordPress table;
- rejects a second use of the same nonce.

Only the nonce hash is stored. Old nonce rows are pruned after their validity window.

## Staged cutover

The gateway supports three explicit modes:

| Mode | Gateway sends | Purpose |
| --- | --- | --- |
| `basic` | WordPress Basic/Application Password | Current compatibility path |
| `dual` | Basic + signed attestation | Safe verifier observation/acceptance |
| `signed` | Signed attestation only | Target after WordPress permission integration is proven |

The WordPress sidecar supports:

| Mode | Behavior |
| --- | --- |
| `disabled` | No signed-transport enforcement |
| `observe` | Verify when possible and log only bounded failure codes; do not block |
| `enforce` | Reject unsigned/invalid/replayed requests before capability dispatch |

Recommended sequence:

```text
Gateway basic + verifier disabled
-> install verifier disabled
-> verifier observe + gateway dual
-> inspect acceptance evidence
-> verifier enforce + gateway dual
-> verify reads and governed write path
-> integrate first-party runtime permission callback with verified-request state
-> gateway signed + verifier enforce
-> revoke WordPress Application Password
```

Do not jump directly from `basic` to `signed` in production.

## Transport identity is not execution authority

`Simpli_MCP_Signed_Transport_Guard::is_verified_request($request)` proves only that the current REST request passed the machine-identity, integrity, freshness and replay checks.

It must **not** independently authorize a product/order/settings mutation.

The intended control stack remains:

```text
OAuth client identity/scope
-> Simpli governance decision
-> exact authority class / one-use permit where required
-> signed machine transport
-> WordPress capability policy
-> expected-before-state / idempotency controls
-> mutation
-> read-back verification
-> audit evidence
```

A6 remains blocked regardless of transport identity.

## Alignment with the live SuperComputer authority model

Current read-only evidence on 17 September 2026 shows the existing SuperComputer clean-room WordPress control plane already has:

- machine identity `READY`;
- authority crypto/public-key/ledger `READY`;
- a machine attestation bridge `READY`;
- caller-supplied execution metadata blocked;
- source restricted to verified signed permits;
- A3/A4 exact-scope one-use approval;
- A5 target-specific dual control;
- A6 always blocked;
- a durable idempotency ledger;
- sealed signature exposure disabled.

However the live WordPress gateway remains `BLOCKED` because its upstream contract/catalog is unavailable. Therefore this repository phase must align with that authority service rather than create a second independent business-authority issuer.

## Cross-language verification

CI generates an ephemeral Ed25519 keypair and signs a request with the TypeScript implementation. PHP/libsodium then verifies the same canonical message and rejects a tampered body.

The ephemeral private test key is not persisted as an artifact or repository secret.

## Acceptance gates

Before Phase 4 can be called accepted:

- exact-head TypeScript checks/tests pass;
- PHP verifier syntax passes;
- Node-to-PHP Ed25519 test passes;
- container build passes;
- committed dependency lock is aligned to the exact release;
- verifier can be installed without changing existing route behavior in `disabled` mode;
- `observe + dual` shows valid signatures reaching WordPress;
- `enforce + dual` rejects unsigned, expired, wrong-audience, tampered and replayed requests;
- existing reads still match authoritative WordPress state;
- governed writes remain controlled by the authority layer, not by transport identity alone;
- signed-only permission handling is explicitly integrated and tested;
- the Application Password is not revoked until signed-only reads and a bounded write/read-back test pass;
- rollback to Basic transport is demonstrated before the compatibility credential is finally retired.

## Explicit non-claims

This phase does **not** currently prove:

- that the signed verifier is installed on production WordPress;
- that signed-only mode works on the production WordPress runtime;
- that the WordPress Application Password has been removed;
- that the SuperComputer upstream catalog issue is repaired;
- that Novamira/Novamira Pro can be disabled safely;
- that WordPress backend independence is verified;
- that a production write was executed.

Those remain separate acceptance gates.
