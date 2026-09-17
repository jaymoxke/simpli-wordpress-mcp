# ROLLING HANDOFF — SAFE CONTINUATION POINT

Date: 2026-09-17
Program: Simpli MCP v3 — Novamira elimination
Unit: Phase 4E — first-party WordPress read runtime
Branch: `v3-wordpress-read-runtime`
Base head: `7759bdbf7ca49116854ca19386f760ab4b7f296d`
Production deployment: **none**
Live WordPress mutation: **none**
Novamira production state: **unchanged**

## Objective

Provide the missing first-party WordPress REST/MCP route at `/wp-json/simpli-mcp/v1/mcp` with a deliberately read-only A1/A2 capability set, preserving staged Basic/dual/signed transport and keeping all mutations behind the existing SuperComputer authority boundary.

## Verified diagnosis that triggered this unit

A bounded production-host diagnostic proved:

```text
simplicosmetics.co.ke/             service UA -> 200
simplicosmetics.co.ke/wp-json/     service UA -> 200
first-party MCP POST, service UA   -> 404
first-party MCP POST, Python UA    -> 404
UA differential                    -> SAME_CLASS
```

The first-party backend route is therefore unavailable at the live WordPress origin. The exact 404 is not a User-Agent-specific failure.

Both diagnostic canaries were rolled back to `v1.2.1-cleanroom-full-governed-attestation-r1`, and the live gateway returned to its prior fail-closed `upstream_contract=UNAVAILABLE` state.

## Repository changes in this unit

Created:

- `wordpress-runtime/lib/first-party-read-core.php`
  - exact five-ability A1/A2 admission set;
  - strict bounded input contracts;
  - stable schema/concurrency hashing helpers;
  - four stable first-party top-level read tools;
  - no mutation dispatcher.

- `wordpress-runtime/simpli-mcp-runtime.php`
  - registers `POST /wp-json/simpli-mcp/v1/mcp`;
  - default WordPress capability authentication;
  - optional explicit signed-only mode after separate Ed25519 verification;
  - `tools/list` and `tools/call` only;
  - bounded WordPress site-info read;
  - bounded WooCommerce product/order reads;
  - customer identity opt-in only;
  - fixed response-size limit;
  - no Novamira dependency.

- `tests/php/verify-first-party-read-core.php`
  - admission-set regression;
  - A1/A2-only assertions;
  - schema-boundary negatives;
  - deterministic hash regression;
  - forbidden execution-primitive scan.

- `docs/PHASE4E_FIRST_PARTY_WORDPRESS_READ_RUNTIME.md`
  - architecture, evidence, safety and acceptance gates.

Release candidate identity moved to:

```text
version       3.0.0-rc.7
architecture  v3-wordpress-first-party-read-runtime
```

## Authority and safety state

Unchanged:

```text
public gateway ceiling       A2_PROPOSE
mutation authority source    supercomputer-sealed-permit
direct backend writes        false
caller authority accepted    false
A6                           blocked
```

No production plugin installation has occurred. No WordPress write or customer-data query has been executed during this repository work.

## Remaining repository acceptance

Pending:

1. add/run dedicated rc.7 CI;
2. lint both new PHP runtime files;
3. execute pure-PHP read-core regression;
4. retain all Node/MCP/OAuth/authority/signed-transport/WhatsApp/container regressions;
5. obtain a committed rc.7 dependency lock;
6. open a draft PR onto `v3-backend-edge-compat` after exact-head CI is green.

## Production blocker after repository acceptance

A governed WordPress plugin deployment path still needs to be identified and verified. Do not infer deployment capability from repository success.

Before asking James for manual work, inspect the existing SuperComputer `wp-pluginfile-*` control surface and any already-authorised WordPress code-maintenance/deployment path.

## Recovery

The repository branch is isolated. Production remains on the prior live WordPress gateway/runtime and current WordPress plugin set. If rc.7 fails acceptance, abandon/revert this branch; no production rollback is required because this unit has not been deployed.
