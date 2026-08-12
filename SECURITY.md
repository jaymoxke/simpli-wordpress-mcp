# Security policy and operator controls

This service is an administrative control plane. Compromise can expose or change WordPress code, data, products, orders, SEO settings, and configuration.

## Required production controls

1. Use a dedicated WordPress account and a dedicated Application Password.
2. Store all credentials only as Railway secret variables.
3. Enable OAuth and leave `MCP_STATIC_TOKEN` blank unless a specific server-to-server integration requires it.
4. Use a unique `OAUTH_SIGNING_SECRET` and `OAUTH_ADMIN_PASSWORD`; never reuse the WordPress password.
5. Keep Railway project access limited and require account MFA.
6. Retain WordPress/database backups and test high-risk changes on staging first.
7. Revoke and rotate the WordPress Application Password after any suspected exposure.

## Privilege classes

| Class | OAuth scope | Examples |
| --- | --- | --- |
| Read-only | `wordpress:read` | site info, file reads, product queries, schema inspection |
| Write | `wordpress:write` | post updates, product edits, SEO updates, form changes |
| Dangerous | `wordpress:dangerous` | PHP execution, WP-CLI, admin links, deletes, high-blast-radius replacements |

Dangerous tools also require `_confirm: "RUN <ability-name>"`. This is an accidental-execution barrier; it does not replace client-side user approval or WordPress authorization.

## Incident containment

1. Revoke the gateway Application Password in WordPress.
2. Pause the Railway service.
3. Rotate `OAUTH_SIGNING_SECRET`, `OAUTH_ADMIN_PASSWORD`, and any static token.
4. Review Railway logs and WordPress audit/history data for unexpected calls.
5. Restore affected WordPress state from revisions or backups.
6. Issue a new dedicated Application Password only after the cause is contained.

## Reporting

Do not include credentials, authorization codes, access tokens, or WordPress Application Passwords in issue bodies or chat messages. Share only redacted logs and reproducible request metadata.
