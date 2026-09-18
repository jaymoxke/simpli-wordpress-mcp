# WordPress Canary Deployment Admission

Status: prepared contract only. No live WordPress deployment is authorised or claimed by this file.

## Purpose

Define the exact bounded deployment contract required to install the first-party Simpli MCP canary runtime on the production WordPress site without widening the existing owner-VitePOS plugin-file bridge or taking over the production MCP route.

## Immutable candidate

Repository branch:

`v3-wordpress-canary-bootstrap`

Candidate plugin slug:

`simpli-mcp-canary`

Installable package:

`simpli-mcp-canary.zip`

Expected package tree:

```text
simpli-mcp-canary/
  simpli-mcp-canary-bootstrap.php
  includes/
    simpli-mcp-runtime.php
    lib/
      first-party-read-core.php
```

Expected isolated REST endpoint after activation:

`POST /wp-json/simpli-mcp-canary/v1/mcp`

The deployment capability must not accept an arbitrary plugin slug, arbitrary archive URL, arbitrary path, shell command, WP-CLI command or PHP source from the caller.

## Required deployment primitive

A future privileged operation may admit exactly these actions:

```text
wordpress_canary.install_activate
wordpress_canary.status
wordpress_canary.rollback
```

For this candidate, all targets are compile-time/policy constants:

```text
site                  https://www.simplicosmetics.co.ke
plugin_slug           simpli-mcp-canary
canary_route          /wp-json/simpli-mcp-canary/v1/mcp
protected_route       /wp-json/simpli-mcp/v1/mcp
mutation_surface      NONE
```

The operation must consume a hash-pinned package produced by accepted CI. The archive SHA-256 must be part of the signed deployment permit and read back from the staged bytes before extraction.

## Before-state capture

Before any installation attempt, record:

- whether `simpli-mcp-canary` directory exists;
- whether the plugin is installed;
- whether the plugin is active;
- exact response status/body fingerprint for the canary route;
- exact response status/body fingerprint for the protected production v1 route;
- current active plugin identity where safely obtainable;
- timestamp and deployment permit reference.

If any unexpected pre-existing `simpli-mcp-canary` installation is present, stop rather than overwrite it.

## Installation rules

The privileged executor must:

1. verify the exact package hash;
2. reject ZIP traversal, symlinks and paths outside `simpli-mcp-canary/`;
3. reject files not present in the admitted package manifest;
4. stage to a temporary directory first;
5. validate PHP syntax before activation where the hosting environment permits;
6. atomically install only the exact plugin directory;
7. activate only `simpli-mcp-canary`;
8. retain enough before-state for deterministic rollback;
9. never modify Novamira, Novamira Pro, the owner-VitePOS bridge or unrelated plugins;
10. never alter WordPress credentials, cPGuard, `.htaccess`, DNS or hosting security as part of this deployment.

## Post-install acceptance

Installation is not acceptance. Immediately verify all of the following:

1. `POST /wp-json/simpli-mcp-canary/v1/mcp` now resolves to the canary runtime rather than `rest_no_route`.
2. Unauthenticated access is rejected.
3. Authenticated `tools/list` succeeds.
4. `simpli_self_status` reports the expected first-party runtime identity.
5. Runtime reports `novamira_dependency=false`.
6. Runtime reports `execution_mode=READ_ONLY`.
7. Runtime reports `admitted_write_abilities=0` and `write_plane_ready=false`.
8. `simpli_catalog` exposes only the admitted A1/A2 read abilities.
9. A bounded product read matches current WooCommerce truth for one stable test product.
10. No order/customer live read is performed during the first canary acceptance unless the separately approved A2-sensitive path is explicitly included.
11. The protected production route `/wp-json/simpli-mcp/v1/mcp` has the same expected state as before installation.
12. Existing customer-facing website behavior and checkout remain unaffected.

Any failure triggers rollback.

## Rollback contract

Rollback must be one exact operation against the candidate plugin only:

1. deactivate `simpli-mcp-canary` if active;
2. remove only the exact installed `simpli-mcp-canary` directory created by the accepted operation;
3. restore any captured pre-existing state if one was explicitly admitted (default is fail-closed rather than overwrite);
4. re-probe the canary route and protected production route;
5. confirm the canary route returned to its pre-install state;
6. confirm the production route is unchanged;
7. record rollback evidence.

## Authority model

The deployment primitive is infrastructure deployment authority, not WooCommerce business-write authority. It must not mint or expose WordPress A3/A4/A5 semantic mutation permits.

The first-party canary runtime itself remains read-only. A6 remains blocked. A successful canary does not authorise production backend cutover or Novamira removal.

## Promotion gate

The canary may be promoted toward the production namespace only after:

- live canary acceptance passes;
- historical `simpli_whatsapp_read` behavior has a first-party equivalent with regression evidence;
- public OAuth/MCP client acceptance passes;
- signed transport is accepted on the live WordPress backend;
- the SuperComputer authority bridge is integrated for mutations without exposing permit secrets;
- representative governed write/read-back/rollback passes separately;
- Novamira-disabled observation shows no capability regression.
