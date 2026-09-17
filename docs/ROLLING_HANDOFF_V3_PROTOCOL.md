# ROLLING HANDOFF — SAFE CONTINUATION POINT

## Objective

Modernize the isolated Simpli MCP gateway to the stable MCP TypeScript SDK v2 serving model while preserving legacy stateless compatibility and keeping production unchanged.

## Authority and production boundary

James approved the v3 implementation program and instructed continuation. This tranche is repository-only. No production deployment, DNS change, live WordPress mutation, credential rotation, or Novamira disable/removal has occurred.

## Verified state

- Foundation branch: `v3-foundation-novamira-free`
- Protocol branch: `v3-protocol-mcp-v2`
- Draft PR: `#31`, based on the foundation branch
- Runtime version: `3.0.0-rc.2`
- MCP SDK packages: `@modelcontextprotocol/server`, `@modelcontextprotocol/express`, `@modelcontextprotocol/node` at `2.0.0`
- Exact dependency lock is committed and installs with `npm ci`.
- Server-side MCP protocol session map and `Mcp-Session-Id` dependency have been removed from the protocol branch.
- `createMcpHandler` serves modern per-request MCP and a stateless legacy fallback.
- Modern tests explicitly exercise `server/discover` and `tools/list` with the 2026-07-28 per-request `_meta` envelope and standard MCP headers.
- WordPress-backend independence remains `unverified` by design.

## Verification evidence

Executable head `907936f5958becfd5e7dfefe31ed4aecd12b6efa` passed V3 Protocol Migration CI run `35207968512` / #14.

After README and verification-record closeout, branch head `a0ed3ebc2892bfc14bbb5d7d51f8686ad5b55533` passed latest-head CI run `35208125896` with:

- committed-lock `npm ci` — PASS;
- TypeScript/static checks — PASS;
- unit tests — PASS;
- WhatsApp gateway checks/tests — PASS;
- production build — PASS;
- runtime syntax check — PASS.

This handoff file itself is documentation-only and must also pass the branch CI before the protocol tranche is treated as latest-head clean.

## What remains intentionally unresolved

1. Real ChatGPT/Claude production-client acceptance against the v3 release.
2. Durable OAuth authorization-code replay state across process restart.
3. Refresh-token rotation and family reuse detection.
4. Durable client/token revocation.
5. Asymmetric signing, JWKS and signing-key rotation.
6. Signed one-use WordPress execution envelopes.
7. Explicit backend capability-registry proof.
8. Novamira-disabled WordPress backend acceptance.
9. Production deployment/cutover and observation window.

## Next executable node

Begin the OAuth durability/key-management tranche on a new branch based on the verified protocol branch. Keep the protocol PR draft and production unchanged. The OAuth tranche must preserve the current passing OAuth/PKCE behavior while adding durable replay/revocation/rotation controls, then obtain independent CI evidence before any deployment discussion.

## Rollback

No live rollback is required because the work is not deployed. Repository rollback is to retain the foundation/protocol parent branch or `main`; no WordPress state has changed.
