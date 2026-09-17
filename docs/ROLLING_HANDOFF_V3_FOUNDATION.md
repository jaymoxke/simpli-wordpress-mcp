# ROLLING HANDOFF — SAFE CONTINUATION POINT

## Objective

Build the Simpli MCP v3 foundation that removes runtime dependence on Novamira while preserving production until independent acceptance evidence exists.

## Authority

James approved the v3 foundation implementation and authorized continuation on the isolated GitHub branch. No production deployment, plugin disablement, DNS change, or destructive WordPress action is authorized by this branch work alone.

## Verified state

- Repository: `jaymoxke/simpli-wordpress-mcp`
- Production branch: `main`
- Isolated implementation branch: `v3-foundation-novamira-free`
- `main` remains the deployment baseline until a separate reviewed merge/deployment decision.
- Existing gateway already calls the Simpli-owned backend `/wp-json/simpli-mcp/v1/mcp` using `tools/list` and `tools/call`.
- Existing OAuth/MCP implementation remains in compatibility mode during Phase 1.
- No production Novamira plugin has been disabled or removed.

## Implemented on the branch

- canonical runtime release identity in `src/version.ts`;
- MCP server metadata uses the canonical release version;
- `/`, `/health`, `/ready`, and new `/version` expose the canonical release identity;
- `/version` is `Cache-Control: no-store`;
- runtime documentation no longer describes Novamira as an architectural dependency;
- regression test prevents Novamira endpoint/package dependencies from entering `src/`;
- v3 acceptance gates added;
- v3 architecture and migration records added;
- security policy updated for a first-party control plane.

## Explicitly not yet implemented

- MCP TypeScript SDK v2 migration;
- 2026-07-28 protocol cutover;
- durable OAuth replay/revocation state;
- asymmetric OAuth signing/JWKS/key rotation;
- refresh-token rotation/family reuse detection;
- signed one-use WordPress execution envelopes;
- complete explicit capability registry enforcement inside the WordPress runtime;
- production cutover;
- Novamira disablement/removal.

## Verification required next

1. Open/inspect the draft PR against `main`.
2. Run GitHub Actions CI: type check, tests, build, runtime syntax check.
3. Repair any CI failure without touching production.
4. Review the complete diff for hidden dependency or unsafe scope expansion.
5. Only after Phase 1 passes should Phase 2 protocol modernization begin.

## Rollback/recovery

The work is isolated to `v3-foundation-novamira-free`. Production recovery is currently trivial: leave `main` and the deployed release unchanged. No WordPress rollback is required because this phase performs no production WordPress mutation.

## Completion rule

Phase 1 is not complete merely because files are committed. It closes only after branch CI/build/test evidence passes and the reviewed diff contains no material defect.
