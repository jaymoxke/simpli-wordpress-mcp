# Phase 4E — First-Party WordPress Read Runtime

Status: isolated release candidate. **Not deployed to production.**

## Why this phase exists

The live SuperComputer diagnostics on 2026-09-17 changed the failure diagnosis materially.

From the exact SuperComputer egress:

```text
GET https://simplicosmetics.co.ke/                 service UA -> HTTP 200
GET https://simplicosmetics.co.ke/                 browser UA -> HTTP 200
GET https://simplicosmetics.co.ke/robots.txt       service UA -> HTTP 200
GET https://simplicosmetics.co.ke/wp-json/         service UA -> HTTP 200
```

A second bounded diagnostic then sent only a signed JSON-RPC `tools/list` request to the intended first-party backend route:

```text
POST https://simplicosmetics.co.ke/wp-json/simpli-mcp/v1/mcp
```

Both tested User-Agent classes returned the same result:

```text
production-style service UA -> HTTP 404
Python-style UA             -> HTTP 404
response body hash           321227fe038fc2f282fd904a174fbaf931eb5d763ce64eded0e6a3f31d32119f
UA differential              SAME_CLASS
```

The exact current blocker is therefore not proven to be a User-Agent/WAF rejection. The first-party WordPress REST route is not currently available at the intended origin.

The existing `Simpli MCP Signed Transport` WordPress component verifies a request *to* `/simpli-mcp/v1/mcp`; it deliberately does not register or implement that route. Phase 4E fills that missing runtime layer.

## Candidate architecture

```text
Simpli public MCP/OAuth gateway
        |
        | fixed origin + fixed path
        | Basic/dual/signed staged transport
        v
/wp-json/simpli-mcp/v1/mcp
        |
        v
Simpli MCP First-Party Read Runtime
        |
        +-- simpli_self_status
        +-- simpli_catalog
        +-- simpli_describe
        +-- simpli_execute  (A1/A2 READS ONLY)
        |
        v
WordPress / WooCommerce read APIs
```

There is no mutation dispatcher in this runtime.

## Admitted ability set

The initial first-party runtime admits exactly five bounded reads:

| Ability | Class | Purpose |
| --- | --- | --- |
| `wordpress/site-info.get` | A1 | Minimal site/runtime identity |
| `woocommerce/product.get` | A1 | One exact product with price/stock/content/taxonomy IDs and concurrency hash |
| `woocommerce/products.query` | A1 | Bounded product search/query |
| `woocommerce/order.get` | A2 | One exact order; customer identity is opt-in |
| `woocommerce/orders.query` | A2 | Bounded order query; customer and line items are opt-in |

All input schemas use `additionalProperties=false` and enforce explicit bounds.

## Authentication boundary

Default/staged runtime mode requires WordPress authentication (including Application Password authentication) plus either:

```text
manage_woocommerce
or
manage_options
```

This supports the existing staged gateway rollout:

```text
basic -> dual -> signed
```

Signed-only WordPress permission is not enabled by default. It requires an explicit `SIMPLI_MCP_RUNTIME_SIGNED_ONLY=true` configuration and a request already verified by `Simpli_MCP_Signed_Transport_Guard`.

A signed machine request proves transport identity/integrity/freshness/replay state. It does not grant A3/A4/A5 mutation authority.

## Data minimisation

The runtime intentionally does not expose:

- WordPress credentials or secrets;
- user/admin account lists;
- arbitrary post meta;
- arbitrary options;
- arbitrary filesystem access;
- PHP evaluation;
- WP-CLI;
- shell execution;
- admin-login generation;
- mutations of any kind.

Order customer identity fields are absent unless `include_customer=true`. The initial fields are limited to customer ID, billing first/last name, email and phone. Full addresses are not returned.

## Concurrency evidence

Product and order records include deterministic `concurrency_hash` values derived from the mutable operational snapshot. These hashes are evidence primitives for later governed read-before-write contracts; this phase does not consume them for mutations.

## Failure posture

The runtime fails closed when:

- the WordPress permission check fails;
- signed-only mode is configured but the transport guard did not verify the exact request;
- WooCommerce is unavailable;
- the JSON-RPC method/tool/ability is not admitted;
- input contains unsupported fields or exceeds bounds;
- an ability is outside A1/A2;
- output exceeds the runtime safety limit.

Unknown or mutation abilities are not forwarded elsewhere.

## Repository acceptance

Phase 4E repository acceptance requires:

- Node/TypeScript regression suite from the existing v3 gateway;
- WhatsApp gateway regression suite;
- production build and container build;
- PHP syntax checks for signed transport and first-party read runtime;
- pure-PHP first-party read contract regression;
- Node-to-PHP signed transport contract regression;
- exact committed rc.7 dependency lock;
- no new direct Novamira gateway dependency.

## Production acceptance — later gate

Repository success is not production acceptance.

Before this runtime can support Novamira removal, production must demonstrate:

1. the plugin is installed through a governed/recoverable deployment route;
2. `/wp-json/simpli-mcp/v1/mcp` no longer returns 404;
3. unauthenticated requests are rejected;
4. authenticated `tools/list` returns only the admitted first-party tools;
5. `simpli_self_status` reports the expected first-party runtime identity;
6. bounded product and order reads agree with live WooCommerce truth;
7. signed transport passes staged `dual + observe`, then `dual + enforce` acceptance;
8. rollback restores the prior WordPress plugin/runtime state;
9. the public gateway remains fail-closed for mutations;
10. Novamira-disabled acceptance is proven before Novamira is removed.

## Non-goals

This phase does not:

- deploy to production;
- execute a WordPress mutation;
- disable Novamira or Novamira Pro;
- revoke the WordPress Application Password;
- enable public signed-only WordPress access;
- claim WordPress backend independence;
- create a second authority issuer.
