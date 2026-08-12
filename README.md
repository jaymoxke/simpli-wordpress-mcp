# Simpli WordPress MCP

A Railway-hosted, OAuth-protected remote MCP gateway for the WordPress Abilities API. It dynamically mirrors the existing Novamira and Novamira Pro abilities on one configured WordPress site instead of duplicating privileged WordPress code.

## Verified scope

The Simpli Cosmetics production site was inspected on 12 August 2026. It currently exposes 187 REST abilities:

| Namespace | Live abilities |
| --- | ---: |
| `novamira/*` | 157 |
| `rank-math/*` | 13 |
| `wpforms/*` | 8 |
| `woocommerce/*` | 7 |
| `core/*` | 2 |
| **Total** | **187** |

The mirrored surface includes:

- PHP execution in the loaded WordPress runtime;
- file read, write, edit, delete, enable/disable, and directory traversal;
- temporary upload links and one-time administrator access links;
- synchronous and background WP-CLI jobs;
- Gutenberg read/write and pending-change batches;
- WordPress posts, memory, and Markdown skills;
- WooCommerce products, variations, orders, categories, tags, attributes, stock, and store settings;
- Elementor documents, elements, styles, variables, classes, dynamic tags, and interactions;
- ACF field groups, values, post types, taxonomies, and options pages;
- Rank Math metadata, schema, audits, scores, links, keywords, and AI visibility;
- WPForms forms, fields, notifications, confirmations, settings, duplication, and statistics.

The gateway refreshes the catalog from WordPress every five minutes by default. New REST-exposed abilities installed later are automatically added to MCP with their original JSON input schema and safety annotations.

## Architecture

```mermaid
flowchart LR
    C["ChatGPT / Codex"] -->|"OAuth 2.1 + MCP"| R["Railway gateway"]
    R -->|"Dedicated Application Password"| W["WordPress Abilities API"]
    W --> N["Novamira + Pro"]
```

Only the gateway is deployed to Railway. WordPress already contains Novamira, Novamira Pro, the MCP Adapter, and WP-CLI; no second control plugin is required.

## Security model

- OAuth 2.1 Authorization Code flow with PKCE, dynamic client registration, protected-resource discovery, short-lived access tokens, and refresh tokens.
- A separate owner authorization password protects OAuth consent.
- A dedicated, revocable WordPress Application Password is stored only as a Railway secret.
- The target WordPress origin is fixed in server configuration; tools cannot redirect the gateway to an arbitrary host.
- WordPress remains the authority for each ability's permission callback and schema validation.
- Read, write, and dangerous scopes are enforced server-side.
- Novamira's PHP, WP-CLI, admin-link, and destructive abilities always require `wordpress:dangerous` and an exact `_confirm` value.
- MCP safety annotations are generated from the live WordPress annotations so clients can apply approval controls.
- Tool output is capped, request timeouts are enforced, redirects are rejected, credentials are never logged, and OAuth/MCP endpoints are rate-limited.
- Railway's `/health` endpoint is liveness only. `/ready` verifies that the WordPress ability catalog is available.

## Local verification

Requirements: Node.js 22 or later.

```bash
npm ci
npm run check
npm test
npm run build
```

Copy `.env.example` to `.env`, fill the required values, then run:

```bash
npm run dev
```

Inspect `http://localhost:3000/mcp` with MCP Inspector using the optional `MCP_STATIC_TOKEN` as a Bearer token. Leave `MCP_STATIC_TOKEN` unset in the public production deployment unless a separate API integration specifically needs it.

## Railway deployment

1. Create a dedicated WordPress administrator account for the gateway. Generate one Application Password named `Railway Simpli MCP`. Do not reuse a human password.
2. Create a Railway service from this repository or run `railway up` from this directory.
3. Add the variables shown in `.env.example`. Generate secrets locally:

   ```bash
   openssl rand -base64 48
   openssl rand -base64 48
   ```

4. Set `PUBLIC_BASE_URL` to the final HTTPS origin. If using a Railway-generated domain first, use that origin. If using `mcp.simplicosmetics.co.ke`, add it as a Railway custom domain and point the Cloudflare DNS record to the Railway target before changing this variable.
5. Confirm Railway reports `/health` as HTTP 200.
6. Open `/ready`; it must report `ready: true` and the expected ability count.
7. Add the complete `/mcp` URL as a remote MCP connection. The client will discover OAuth, dynamically register, and open the owner authorization page.
8. Run the acceptance checks in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) before enabling live write tools.

Railway injects `PORT`; the service listens on it automatically. The included `railway.json` configures Docker builds, `/health`, and restart-on-failure.

## Operational rollback

Rollback is immediate and does not change WordPress code:

1. revoke the `Railway Simpli MCP` Application Password in WordPress;
2. pause or remove the Railway service;
3. remove its custom DNS record if one was created.

Existing Novamira functionality inside WordPress remains untouched.

## Primary technical references

- [WordPress Abilities API REST endpoints](https://developer.wordpress.org/apis/abilities-api/rest-api-endpoints/)
- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: MCP authentication](https://developers.openai.com/plugins/build/auth)
- [Railway health checks](https://docs.railway.com/deployments/healthchecks)
- [Novamira capability overview](https://novamira.ai/tools/)
