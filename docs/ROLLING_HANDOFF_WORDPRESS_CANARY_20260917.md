# ROLLING HANDOFF — SAFE CONTINUATION POINT

Date: 2026-09-17
Program: Simpli MCP v3 — Novamira elimination
Unit: First-party WordPress canary bootstrap
Branch: `v3-wordpress-canary-bootstrap`
Draft PR: `#38`
Current verified head: `4b3bca4afa1717fe8a7a71fb481a58349443d7dc`
Production deployment: **none**
Live WordPress mutation: **none**
Novamira production state: **unchanged**

## Objective

Create the smallest recoverable route to prove the first-party WordPress runtime on the live Simpli site without taking over the intended production endpoint or weakening the existing authority boundary.

## Verified state

The live SuperComputer WordPress gateway remains fail-closed:

- gateway service is running but reports `NOT_READY` / HTTP 503;
- machine identity is READY;
- authority issuer, crypto, public key, ledger and machine-attestation bridge are READY;
- `upstream_contract` is `UNAVAILABLE`;
- `ability_catalog` is `UNAVAILABLE`;
- read plane and write plane are not ready;
- admitted write abilities remain zero;
- A6 remains blocked;
- no private key or sealed authority signature is exposed.

The exact first-party production route is not currently accepted as live evidence. Prior exact-route diagnostics established `POST /wp-json/simpli-mcp/v1/mcp` returned WordPress `rest_no_route` HTTP 404 under both the production-style and Python-style User-Agents. Broad `/wp-json/` success is not treated as route availability.

The current SuperComputer plugin-file bridge is deliberately limited to:

- plugin key `owner-vitepos-bridge`;
- file `simpli-owner-vitepos-bridge.php`;
- abilities `system/plugin-file.patch` and `system/plugin-file.rollback`.

It is therefore not an authorised generic plugin installer and has not been widened for this work.

## Implemented repository unit

An isolated WordPress canary bootstrap now exists at:

`wordpress-runtime/canary/simpli-mcp-canary-bootstrap.php`

It packages the already-reviewed first-party read runtime, removes the packaged runtime's production `rest_api_init` registration before it fires, and registers only:

`POST /wp-json/simpli-mcp-canary/v1/mcp`

The canary reuses the same read-only dispatcher and permission callback. It does not add a mutation dispatcher or arbitrary PHP, WP-CLI, shell, filesystem or administrator-login capability.

## CI and artifact evidence

Exact-head workflow run:

`35239745406` — **SUCCESS**

Verified head:

`4b3bca4afa1717fe8a7a71fb481a58349443d7dc`

The run passed:

- deterministic dependency installation;
- TypeScript/static checks;
- all gateway tests;
- PHP syntax for the first-party runtime, read core and canary bootstrap;
- first-party read-core regression;
- isolated plugin packaging;
- package-content assertions;
- artifact upload.

Published GitHub Actions artifact:

- name: `simpli-mcp-canary-plugin`
- artifact id: `10505165297`
- GitHub artifact digest: `sha256:99a6410c1e302067088dd13e67176814ddc3997065c25ba7eb996cde945be2fd`
- not expired at verification time.

The downloaded artifact contains an inner installable `simpli-mcp-canary.zip`. Independent local inspection of that inner ZIP showed exactly the intended plugin tree and an inner ZIP SHA-256 of:

`29742223f2c36cf4ef9dfdd8f18ac53ba752170ade6699a9386c5a019b28e0a9`

Files in the installable ZIP:

- `simpli-mcp-canary/simpli-mcp-canary-bootstrap.php`
- `simpli-mcp-canary/includes/simpli-mcp-runtime.php`
- `simpli-mcp-canary/includes/lib/first-party-read-core.php`

## Authority and risk boundary

Current instruction authorises continued low-risk engineering and preparation. No live plugin installation, activation, customer-impacting route cutover, credential revocation, Novamira disable/removal or production write has been executed in this unit.

A canary installation is a consequential live WordPress change. Before it is executed, the deployment lane must provide a recoverable exact-target install/activate/rollback contract rather than abusing or widening the owner-VitePOS bridge.

## Preserved dependency

The production WhatsApp advisor still depends on the tightly restricted public MCP facade `simpli_whatsapp_read`, including current-state product lookup and governed Golden/sourcing operations. The new first-party runtime does not yet reproduce that facade. Therefore the production backend must not be switched wholesale to the new runtime yet.

## Next executable unit

Prepare a dedicated, exact-target deployment admission for the **canary plugin only**, with these minimum properties:

1. exact artifact/hash pin;
2. exact plugin slug `simpli-mcp-canary`;
3. no arbitrary plugin/path input;
4. capture pre-install plugin/route state;
5. install + activate as one bounded operation or fail closed;
6. immediate rollback/uninstall path;
7. verify production `/wp-json/simpli-mcp/v1/mcp` remains unchanged;
8. verify canary route appears only at `/wp-json/simpli-mcp-canary/v1/mcp`;
9. unauthenticated request rejected;
10. authenticated `tools/list` succeeds;
11. runtime reports `novamira_dependency=false`, read-only mode, zero write abilities;
12. bounded product read matches current WooCommerce truth;
13. no order/customer live read until the A2-sensitive scope path is separately accepted.

If the available SuperComputer control plane cannot express this exact WordPress plugin admission without a new privileged capability, stop at the prepared artifact/contract rather than weakening existing restrictions.

## Recovery

Repository rollback: abandon PR #38 / branch `v3-wordpress-canary-bootstrap`; no production effect exists.

Future live canary rollback requirement: deactivate/remove only `simpli-mcp-canary` and verify the pre-install route/plugin state is restored. Novamira and the existing production runtime must remain untouched during canary acceptance.
