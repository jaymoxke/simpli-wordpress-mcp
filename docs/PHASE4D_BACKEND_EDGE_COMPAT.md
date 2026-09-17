# Phase 4D — WordPress Backend Edge Compatibility

Status: isolated repository candidate. **Not deployed to production.**

## Objective

Make the Simpli-owned gateway-to-WordPress hop predictable across a shared-hosting security edge without weakening Simpli's cryptographic trust model or depending on AI/server-style User-Agent whitelisting.

This phase addresses transport compatibility only. It does not grant business mutation authority, bypass the authority gate, or claim the current live WordPress catalog problem is solved.

## Current evidence

Read-only inspection of the current SuperComputer clean-room gateway shows its WordPress upstream client currently sends a non-browser User-Agent derived from the clean-room service/version. The prepared upstream diagnostic also explicitly compares that current identity with Python-style client identities because the hosting edge has previously treated User-Agent as a security signal.

Current live status remains:

```text
upstream_contract   UNAVAILABLE
ability_catalog     UNAVAILABLE
read_plane_ready    false
write_plane_ready   false
```

The exact remaining failure cause is not proven by this repository change. It may involve the hosting edge, the configured WordPress origin/alias, the deployed WordPress runtime contract, or another upstream condition. Production evidence is still required.

## Design

### 1. Exact WordPress origin

`WORDPRESS_URL` is now required to be an **origin only**:

```text
https://host.example
```

not:

```text
https://host.example/path
```

The client derives exactly:

```text
/wp-json/simpli-mcp/v1/mcp
```

from that origin.

This matters because the signed transport binds the WordPress audience/origin and the exact path.

### 2. Redirects remain rejected

The gateway continues to use:

```text
redirect: error
```

A WordPress hostname that redirects to another hostname is therefore a configuration error, not something the gateway follows automatically.

This is intentional. POST redirects can alter method/body semantics, and following a redirect after signing the original origin/path would weaken the meaning of the attestation.

Production must therefore configure the exact canonical WordPress origin that serves the REST route directly.

### 3. Browser-compatible User-Agent

The upstream request uses a configurable browser-compatible User-Agent by default.

The User-Agent is treated only as a **hosting-edge compatibility signal**. It is not used as Simpli authentication or authorization.

The gateway simultaneously sends explicit non-secret identity metadata:

```text
X-Simpli-Client: simpli-wordpress-mcp/<release>
X-Simpli-Release-Id: <release-id>
```

Actual machine identity/integrity remains the Phase 4 Ed25519 signed transport:

```text
X-Simpli-Auth-Version
X-Simpli-Key-Id
X-Simpli-Issued-At
X-Simpli-Expires-At
X-Simpli-Nonce
X-Simpli-Body-Sha256
X-Simpli-Audience
X-Simpli-Signature
```

Therefore compatibility with a User-Agent-sensitive hosting edge does not become a security dependency.

### 4. Header-injection protection

A custom `WORDPRESS_USER_AGENT` is allowed for future hosting/browser compatibility, but configuration rejects CR/LF characters and constrains the value length.

### 5. Operator-visible readiness metadata

WordPress readiness now reports:

```text
endpointOrigin
redirectPolicy: reject
userAgentMode: browser-compatible | custom
```

Release metadata reports:

```text
wordpressOriginPolicy: exact-origin-no-redirect
wordpressUserAgentPosture: browser-compatible-configurable
wordpressIdentityHeader: X-Simpli-Client
```

This makes the transport posture inspectable without exposing secrets.

## Security boundary

A browser-compatible User-Agent is **not** a WAF bypass credential and must never be treated as one.

The security stack remains:

```text
external OAuth identity
-> Simpli semantic authority gate
-> Ed25519 machine transport
-> fixed WordPress origin/path
-> first-party WordPress verifier/capability policy
-> mutation controls/read-back where applicable
```

The public gateway still has execution ceiling `A2_PROPOSE` and direct writes remain blocked until the existing SuperComputer sealed-permit authority/execution lane is integrated.

## Acceptance

Repository acceptance requires:

- configuration rejects path-bearing WordPress origins;
- custom User-Agent header injection is rejected;
- default upstream identity is browser-compatible;
- exact `X-Simpli-Client` identity is sent separately;
- redirects remain rejected;
- signed transport still verifies the exact body/origin/path contract;
- existing authority-gate, OAuth, MCP protocol, PHP verifier and container regressions stay green.

Production acceptance additionally requires:

- identify the canonical Simpli WordPress origin that serves the REST route with no redirect;
- deploy the accepted first-party WordPress runtime/verifier safely;
- verify `tools/list` and `simpli_self_status` through the real hosting edge;
- prove the current upstream/catalog blocker is actually removed;
- retain write blocking until the private SuperComputer authority bridge is live and accepted.

## Non-claims

This phase does not claim:

- that cPGuard is the sole remaining cause of the current live catalog failure;
- that changing User-Agent alone repairs production;
- that the current legacy clean-room gateway has been modified;
- that a production WordPress route has been tested with this rc.6 build;
- that any live WordPress write is allowed;
- that Novamira can yet be disabled.
