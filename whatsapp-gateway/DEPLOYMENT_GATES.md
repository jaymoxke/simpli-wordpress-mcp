# Deployment gates

- Default mode: SHADOW
- Persistent volume mounted at /data
- YCloud webhook signature verification enabled
- YCloud inbound event idempotency enabled
- OpenAI key present through secret storage only
- Simpli MCP connection is read-only for the WhatsApp advisor
- Business hours configured before AFTER_HOURS mode
- Human takeover disables AI sends for that conversation
- Safety/payment/authenticity/service/privacy signals route to human review
- Pre-send QA blocks unsupported certainty, meta-text and payment-repeat risk
- 30-day default transcript-body retention; audit/workflow metadata retained separately
