# Incident record — U02 WordPress route diagnostic interpretation

Date: 2026-09-17
Status: corrected and bounded
Cause category: evidence-interpretation defect
Production mutation: none

## Incident

During the Novamira-elimination investigation, an older SuperComputer gateway release (`v0.4.6r1-code-read-bridge-r1`) was temporarily activated as a read-only canary. Its status reported the WordPress upstream as `READY` with HTTP 200, and a local `wordpress_intelligence/contract.get` call returned a cached 10-tool upstream contract.

That evidence was initially interpreted as proof that the live `/wp-json/simpli-mcp/v1/mcp` route still returned HTTP 200 under the older machine-auth path.

That interpretation was wrong.

## Correct evidence

Source inspection shows the old gateway's `upstream_probe()` checks:

```text
https://simplicosmetics.co.ke/wp-json/
```

not the MCP execution route. Its `READY / HTTP 200` status therefore proves only that the WordPress REST index is reachable.

The successful `wordpress_intelligence/contract.get` result is also a local cached contract observation from the prior accepted baseline. It is not a live call to the WordPress MCP route.

The bounded U02 signed POST diagnostic remains the authoritative current route evidence:

```text
POST https://simplicosmetics.co.ke/wp-json/simpli-mcp/v1/mcp
production-style service UA -> HTTP 404
Python-style UA             -> HTTP 404
body length                 -> 114 bytes
body SHA-256                 -> 321227fe038fc2f282fd904a174fbaf931eb5d763ce64eded0e6a3f31d32119f
UA differential             -> SAME_CLASS
```

The exact 114-byte body/hash corresponds to WordPress core's standard REST no-route response:

```json
{"code":"rest_no_route","message":"No route was found matching the URL and request method.","data":{"status":404}}
```

Therefore the current evidence supports:

> The first-party `POST /wp-json/simpli-mcp/v1/mcp` route is not currently registered for the tested live WordPress request. The failure is not a demonstrated User-Agent-specific cPGuard decision.

It does **not** prove why the route disappeared or which plugin/module previously registered it.

## Historical evidence

The accepted contract baseline and prior gateway records prove that a first-party Simpli MCP contract was observed previously, including `simpli_catalog`, `simpli_describe`, `simpli_execute`, code-maintenance tools, `simpli_self_status`, and `simpli_whatsapp_read`.

Historical availability is not current availability.

## Recovery and production state

The diagnostic `v0.4.6r1` canary was rolled back to:

```text
v1.2.1-cleanroom-full-governed-attestation-r1
```

The post-rollback gateway returned to its prior fail-closed state:

```text
upstream_contract  UNAVAILABLE
ability_catalog    UNAVAILABLE
read_plane_ready   false
write_plane_ready  false
```

No WordPress business mutation or credential change occurred.

## Failed gate

The failed reasoning gate was treating a broad REST-index health probe plus cached metadata as direct evidence for the narrower MCP POST route.

## Procedure change

For route-availability claims, acceptance now requires evidence from the **exact HTTP method + exact path + current response**. A parent REST-index probe or cached contract may support diagnosis but cannot substitute for the exact route.

No further HTTP canary is required to re-prove this same 404. The next useful work is to establish a governed bootstrap/deployment path for the first-party runtime while preserving current safe facade capabilities.
