# Phase 2 protocol verification record

## Scope

This record applies to the isolated `v3-protocol-mcp-v2` branch. It verifies source-level protocol modernization only. It does not authorize or claim production deployment, real-client production acceptance, WordPress-backend independence, or Novamira retirement.

## Verified executable head

GitHub Actions run `35207968512` / V3 Protocol Migration CI run `#14` completed successfully against executable commit:

```text
907936f5958becfd5e7dfefe31ed4aecd12b6efa
```

The run used the committed `package-lock.json` and passed:

- `npm ci` from the committed lock;
- TypeScript/static checks;
- unit tests;
- WhatsApp gateway static checks;
- WhatsApp gateway tests;
- production build;
- runtime syntax check.

## Protocol evidence in the passing suite

The passing suite includes explicit checks for:

1. **2026-07-28 discovery** — `server/discover` with the required per-request `_meta` envelope and standard MCP protocol/method headers returns the modern supported-version set and Simpli server identity.
2. **2026-07-28 tool dispatch** — modern `tools/list` succeeds per request without `Mcp-Session-Id`.
3. **Legacy compatibility** — 2025-era stateless `tools/list` continues to work without server-side protocol session state.
4. **OAuth bridge** — a token obtained through the existing Authorization Code + PKCE flow can access the stateless MCP endpoint.
5. **Credential isolation** — the dedicated WhatsApp credential remains restricted to `simpli_whatsapp_read`.
6. **Governed backend routing** — existing Simpli dispatcher and write-guard forwarding behavior remains covered.
7. **Fail-closed legacy behavior** — stale privileged tools without an admitted Simpli equivalent remain rejected.

## Dependency evidence

The v2 dependency lock was generated on CI with npm 11.6.0, installed with `npm ci`, and only then persisted to the isolated branch. The committed root lock identifies:

```text
@modelcontextprotocol/server  2.0.0
@modelcontextprotocol/express 2.0.0
@modelcontextprotocol/node    2.0.0
```

Runtime package version and canonical release version are aligned to `3.0.0-rc.2` for this tranche.

## What remains deliberately unverified

- real ChatGPT connection against this branch/release;
- real Claude/other-client connection where required;
- production deployment behavior;
- durable OAuth replay/revocation state across restart;
- refresh-token rotation/reuse detection;
- asymmetric signing/JWKS/key rotation;
- signed one-use WordPress execution envelope;
- WordPress-backend operation with Novamira Core/Pro disabled;
- production Novamira retirement.

## Status

`PHASE2_CODE_VERIFIED_BRANCH_ONLY`

Any later executable change requires fresh CI. Documentation-only branch commits are still subject to the PR's latest-head CI gate before merge.
