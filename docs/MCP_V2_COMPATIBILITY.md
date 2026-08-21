# MCP v2 compatibility transition

The Simpli WordPress MCP v2 backend is first-party and exposes a compact Simpli-owned tool surface. During the transition, an already-connected ChatGPT client may retain the pre-v2 generated WordPress ability manifest until the connector is re-imported.

The Railway gateway must therefore treat stale client tool names as a transport-compatibility concern only. Compatibility aliases must not restore a second source of authority or bypass the Simpli backend governance model. All execution remains routed through the Simpli-owned backend and its current safety, authority, confirmation, before-state, rollback, and verification controls.

Acceptance requires both current Simpli tool discovery for newly connected clients and a verified read-only legacy-call canary for already-connected clients before any compatibility layer is promoted to production.

Railway deployment health uses the local `/health` liveness endpoint. Deep WordPress readiness remains available at `/ready`; its backend probe is deduplicated and successful readiness is cached briefly so concurrent infrastructure checks cannot stampede the WordPress MCP backend.
