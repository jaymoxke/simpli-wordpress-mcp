# Simpli WhatsApp Intelligence Gateway

Production control plane for Simpli Cosmetics Kenya after-hours WhatsApp support.

## Boundaries
- YCloud = WhatsApp transport/shared inbox.
- Simpli MCP = governed current business truth. The agent is restricted to read-only use.
- OpenAI Responses API = reasoning/orchestration.
- PostgreSQL = conversation, ownership, escalation and audit state.
- Support contact never becomes marketing consent.

## Release modes
- `SHADOW` (default): classify/draft/log; never send AI replies.
- `AFTER_HOURS`: AI can send low-risk replies only when configured business hours say Simpli is closed.
- `AI_ALWAYS`: low-risk AI send regardless of hours.
- `HUMAN_ONLY`: never send AI replies.

Safety, payment uncertainty, authenticity concern, service-recovery issue, privacy request, non-text media, group messages, model handoffs, tool approval requests and pre-send QA failures are blocked from normal autonomous answering and routed to human review.

## Endpoints
- `GET /health`
- `GET /ready`
- `POST /webhooks/ycloud`
- `GET /admin`

## Activation sequence
1. Deploy in `SHADOW` mode.
2. Attach PostgreSQL and set encryption/admin secrets.
3. Configure an approved read-only Simpli MCP connection.
4. Set the OpenAI API key.
5. Configure YCloud API key, webhook signing secret and sending number.
6. Configure business hours in Africa/Nairobi.
7. Point YCloud `whatsapp.inbound_message.received` events to `/webhooks/ycloud`.
8. Run shadow/regression acceptance.
9. Switch to `AFTER_HOURS` only after acceptance.

The webhook acknowledges valid signed/idempotent events immediately and processes conversation intelligence asynchronously.
