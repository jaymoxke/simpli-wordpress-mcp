import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { URL } from 'node:url';
import { createDb } from './db.mjs';
import { stableCustomerRef, verifyYCloudSignature, signSession, verifySession } from './crypto.mjs';
import { preflightRisk, safeEscalationReply, qaCustomerReply, isClosedNow, shouldAutoSend } from './policy.mjs';
import { sendText } from './ycloud.mjs';
import { runAdvisor } from './openai.mjs';
import { applyGreetingPolicy } from './greeting-policy.mjs';

const env = process.env;
const PORT = Number(env.PORT || 3000);
const db = createDb(env.DATABASE_PATH || env.DATABASE_URL || '/data/simpli-whatsapp.sqlite', env.DATA_ENCRYPTION_KEY);
const retentionDays = Math.max(1, Math.min(365, Number(env.RETENTION_DAYS || 30)));
const defaultMode = env.DEFAULT_MODE || 'SHADOW';
const mcpUrl = env.SIMPLI_MCP_URL || '';
const adminJs = fs.readFileSync(new URL('./admin.js', import.meta.url), 'utf8');
const adminHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function json(res, status, body, headers = {}) { const b = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), ...headers }); res.end(b); }
function html(res, status, body, headers = {}) { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(body); }
function javascript(res, status, body, headers = {}) { res.writeHead(status, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers }); res.end(body); }
async function readBody(req, max = 1024 * 1024) { const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > max) throw new Error('BODY_TOO_LARGE'); chunks.push(c); } return Buffer.concat(chunks).toString('utf8'); }
function cookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; })); }
function isAdmin(req) { const token = cookies(req).simpli_wa_admin; return !!verifySession(token, env.ADMIN_SESSION_SECRET); }

function adminPage() {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simpli WhatsApp Intelligence</title>
<style>
body{font-family:system-ui;margin:0;background:#f6f7f8;color:#171717}.wrap{max-width:1400px;margin:auto;padding:24px}.bar{display:flex;justify-content:space-between;align-items:center;gap:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0}.card,.panel{background:white;border:1px solid #e3e5e7;border-radius:14px;padding:16px;margin-bottom:16px}.metric{font-size:28px;font-weight:700}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #eee;font-size:14px}th{white-space:nowrap}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#eee;font-size:12px}.ok{background:#e8f6ed}.bad{background:#fbe9e9}.shadow{background:#eef2ff}.draft{white-space:pre-wrap;min-width:280px;max-width:520px;line-height:1.45}.basis{max-width:360px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}button,select,input{padding:9px 12px;border:1px solid #cfd3d7;border-radius:9px;background:white}button{cursor:pointer}.danger{background:#111;color:white}.muted{color:#666;font-size:13px}h2{margin-top:0}
</style>
<div class="wrap"><div class="bar"><div><h1>Simpli WhatsApp Intelligence</h1><div class="muted">After-hours support control plane · encrypted SHADOW review</div></div><button id="logoutBtn">Sign out</button></div>
<div id="statusPanel"></div>
<div class="panel"><b>Operating mode</b> <select id="modeSelect"><option>SHADOW</option><option>AFTER_HOURS</option><option>AI_ALWAYS</option><option>HUMAN_ONLY</option></select> <button class="danger" id="setModeBtn">Update</button><span id="modeMsg" class="muted"></span></div>
<div class="cards" id="cards"></div>
<div class="panel"><h2>SHADOW draft review</h2><div class="muted">Draft text and answer basis are encrypted at rest. This view is review-only and cannot send a message.</div><div class="tablewrap"><table><thead><tr><th>Time</th><th>Customer ref</th><th>Model</th><th>Intent / action</th><th>Control</th><th>QA</th><th>Live tools</th><th>Decision</th><th>Draft</th><th>Answer basis</th></tr></thead><tbody id="draftRows"></tbody></table></div></div>
<div class="panel"><h2>Conversations</h2><div class="tablewrap"><table><thead><tr><th>Customer ref</th><th>Owner</th><th>State</th><th>Intent</th><th>Risk</th><th>Escalations</th><th>Last activity</th><th>Control</th></tr></thead><tbody id="rows"></tbody></table></div></div></div>
<script src="/admin/app.js" defer></script>`;
}

function loginPage(error = '') { return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simpli WhatsApp Login</title><style>body{font-family:system-ui;background:#f6f7f8}.box{max-width:380px;margin:12vh auto;background:white;padding:28px;border:1px solid #ddd;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border:1px solid #ccc;border-radius:9px}button{background:#111;color:white}</style><div class="box"><h1>Simpli WhatsApp</h1><p>Administrator access</p>${error ? '<p>' + error + '</p>' : ''}<form method="post"><input type="password" name="password" required autocomplete="current-password"><button>Sign in</button></form></div>`; }
function parseForm(raw) { return Object.fromEntries(new URLSearchParams(raw)); }

async function processInbound(event) {
  const msg = event.whatsappInboundMessage;
  if (!msg) return;
  const external = msg.fromUserId || msg.fromParentUserId || msg.from;
  const customerRef = stableCustomerRef(external, env.CUSTOMER_REF_SECRET);
  const conv = await db.getOrCreateConversation({ id: crypto.randomUUID(), customerRef, externalUserId: msg.fromUserId || msg.fromParentUserId || null, phone: msg.from || null });
  const text = msg.type === 'text' ? msg.text?.body || '' : '';
  await db.addMessage({ conversationId: conv.id, providerMessageId: msg.wamid || msg.id, direction: 'INBOUND', type: msg.type, body: text || null, status: 'received', sentAt: msg.sendTime || null });
  if (msg.groupId) { await db.escalate(conv.id, 'GROUP_MESSAGE_UNSUPPORTED', ['GROUP']); await db.updateConversation(conv.id, { owner: 'HUMAN', state: 'ESCALATED', risk_flags: ['GROUP'] }); return; }
  if (msg.type !== 'text') { await db.escalate(conv.id, 'NON_TEXT_REVIEW', [msg.type.toUpperCase()]); await db.updateConversation(conv.id, { owner: 'HUMAN', state: 'ESCALATED', risk_flags: [msg.type.toUpperCase()] }); return; }
  const risk = preflightRisk(text);
  const mode = await db.getSetting('mode', { value: defaultMode });
  const modeValue = typeof mode === 'string' ? mode : (mode.value || defaultMode);
  const hours = await db.getSetting('business_hours', { configured: false });
  const hoursResult = isClosedNow(hours, new Date());
  const current = await db.getConversation(conv.id);
  if (risk.blocking) {
    await db.escalate(conv.id, 'PRE_SEND_RISK_GATE', risk.flags);
    await db.updateConversation(conv.id, { owner: 'HUMAN', state: 'ESCALATED', risk_flags: risk.flags, control_state: risk.controlState || 'QA_BLOCK' });
    const decision = shouldAutoSend({ mode: modeValue, owner: current.owner, riskBlocking: false, hoursResult });
    if (decision.send && env.YCLOUD_API_KEY && env.YCLOUD_FROM) {
      const reply = safeEscalationReply(risk.flags); const out = await sendText({ apiKey: env.YCLOUD_API_KEY, from: env.YCLOUD_FROM, to: msg.from, recipient: msg.fromUserId || msg.fromParentUserId, text: reply });
      await db.addMessage({ conversationId: conv.id, providerMessageId: out?.wamid || out?.id || `local-${crypto.randomUUID()}`, direction: 'OUTBOUND', type: 'text', body: reply, status: 'sent' });
    }
    await db.audit(conv.id, 'RISK_ESCALATED', 'SYSTEM', { flags: risk.flags, control_state: risk.controlState || 'QA_BLOCK', safe_ack_decision: decision.reason });
    console.log(JSON.stringify({ event: 'RISK_ESCALATED', flags: risk.flags, control_state: risk.controlState || 'QA_BLOCK', safe_ack_decision: decision.reason }));
    return;
  }
  const sendDecision = shouldAutoSend({ mode: modeValue, owner: current.owner, riskBlocking: false, hoursResult });
  const recent = await db.recentMessages(conv.id, 10);
  let advisor;
  try { advisor = await runAdvisor({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-5.6', mcpUrl, mcpToken: env.SIMPLI_MCP_TOKEN, messages: recent, conversationId: conv.id, previousResponseId: current.last_response_id }); }
  catch (err) { await db.escalate(conv.id, 'AI_RUNTIME_FAILURE', ['AI']); await db.audit(conv.id, 'AI_FAILURE', 'SYSTEM', { message: String(err.message).slice(0, 300) }); await db.updateConversation(conv.id, { state: 'WAITING_FOR_SIMPLI', control_state: 'QA_BLOCK' }); return; }
  if (advisor.blocked) { await db.escalate(conv.id, advisor.blockReason, ['TOOL_WRITE_ATTEMPT']); await db.updateConversation(conv.id, { owner: 'HUMAN', state: 'ESCALATED', control_state: 'QA_BLOCK', last_response_id: advisor.responseId }); return; }
  const p = applyGreetingPolicy({ text, messages: recent, packet: advisor.packet });
  const qa = qaCustomerReply(p.response_text);
  const modelRisk = (p.risk_flags || []).length > 0 || p.handoff_required;

  if (modeValue === 'SHADOW') {
    try {
      const toolCalls = (advisor.toolCalls || []).map(x => x?.name).filter(Boolean);
      const draftId = await db.addShadowDraft({
        conversationId: conv.id,
        responseId: advisor.responseId,
        model: env.OPENAI_MODEL || 'gpt-5.6',
        primaryIntent: p.primary_intent || null,
        advisorAction: p.advisor_action || null,
        controlState: p.control_state || 'NONE',
        riskFlags: p.risk_flags || [],
        handoffRequired: !!p.handoff_required,
        answerBasis: p.answer_basis || [],
        toolCalls,
        qaPass: qa.pass,
        qaReasons: qa.reasons || [],
        sendDecision: modelRisk ? 'MODEL_HANDOFF' : sendDecision.reason,
        responseText: p.response_text,
      });
      await db.audit(conv.id, 'SHADOW_DRAFT_CAPTURED', 'AI', { draft_id: draftId, configuration_id: advisor.configurationId || null, intent: p.primary_intent || null, specialist_route: p.specialist_route || null, evidence_state: p.evidence_state || null, customer_decision: p.customer_decision || null, grounding_kind: advisor.grounding?.kind || 'NONE', qa_pass: qa.pass, tool_calls: toolCalls });
      console.log(JSON.stringify({
        event: 'SHADOW_DRAFT_CAPTURED', draft_id: draftId, configuration_id: advisor.configurationId || null, model: env.OPENAI_MODEL || 'gpt-5.6',
        grounding_kind: advisor.grounding?.kind || 'NONE', primary_intent: p.primary_intent || null, advisor_action: p.advisor_action || null,
        specialist_route: p.specialist_route || null, evidence_state: p.evidence_state || null, customer_decision: p.customer_decision || null,
        control_state: p.control_state || 'NONE', risk_flags: p.risk_flags || [], handoff_required: !!p.handoff_required,
        questions_needed_count: Array.isArray(p.questions_needed) ? p.questions_needed.length : 0,
        tool_calls: toolCalls, qa_pass: qa.pass, qa_reasons: qa.reasons || [],
        send_decision: modelRisk ? 'MODEL_HANDOFF' : sendDecision.reason,
        encrypted_draft: true, encrypted_answer_basis: true,
        draft_chars: String(p.response_text || '').length, answer_basis_count: Array.isArray(p.answer_basis) ? p.answer_basis.length : 0,
      }));
    } catch (err) {
      await db.escalate(conv.id, 'SHADOW_DRAFT_PERSISTENCE_FAILURE', ['OBSERVABILITY']);
      await db.audit(conv.id, 'SHADOW_DRAFT_FAILURE', 'SYSTEM', { message: String(err.message).slice(0, 300) });
      await db.updateConversation(conv.id, { state: 'WAITING_FOR_SIMPLI', control_state: 'QA_BLOCK' });
      return;
    }
  }

  await db.updateConversation(conv.id, { primary_intent: p.primary_intent || null, risk_flags: p.risk_flags || [], control_state: p.control_state || 'NONE', last_response_id: advisor.responseId, state: modelRisk ? 'ESCALATED' : 'OPEN' });
  if (modelRisk) { await db.escalate(conv.id, 'MODEL_HANDOFF', p.risk_flags || []); }
  if (!qa.pass) { await db.escalate(conv.id, 'PRE_SEND_QA_FAILURE', qa.reasons); await db.updateConversation(conv.id, { owner: 'HUMAN', state: 'ESCALATED', control_state: 'QA_BLOCK' }); await db.audit(conv.id, 'QA_BLOCK', 'SYSTEM', { reasons: qa.reasons }); return; }
  if (sendDecision.send && !modelRisk) {
    if (!env.YCLOUD_API_KEY || !env.YCLOUD_FROM) { await db.escalate(conv.id, 'YCLOUD_NOT_CONFIGURED', ['CONFIG']); return; }
    const out = await sendText({ apiKey: env.YCLOUD_API_KEY, from: env.YCLOUD_FROM, to: msg.from, recipient: msg.fromUserId || msg.fromParentUserId, text: p.response_text });
    await db.addMessage({ conversationId: conv.id, providerMessageId: out?.wamid || out?.id || `local-${crypto.randomUUID()}`, direction: 'OUTBOUND', type: 'text', body: p.response_text, status: 'sent' });
    await db.audit(conv.id, 'AI_REPLY_SENT', 'AI', { intent: p.primary_intent, decision: sendDecision.reason, answer_basis: p.answer_basis || [] });
  } else {
    await db.audit(conv.id, 'AI_DRAFT_NOT_SENT', 'AI', { intent: p.primary_intent, reason: modelRisk ? 'MODEL_HANDOFF' : sendDecision.reason });
    if (modeValue === 'SHADOW') console.log(JSON.stringify({ event: 'SHADOW_SEND_SUPPRESSED', reason: modelRisk ? 'MODEL_HANDOFF' : sendDecision.reason }));
  }
}

await db.migrate();
if (!(await db.getSetting('mode', null))) await db.setSetting('mode', { value: defaultMode });
const latestShadow = (await db.listShadowDrafts(1))[0] || null;
if (latestShadow) {
  console.log(JSON.stringify({
    event: 'SHADOW_DRAFT_LATEST', draft_id: latestShadow.id, created_at: latestShadow.created_at,
    model: latestShadow.model, primary_intent: latestShadow.primary_intent, advisor_action: latestShadow.advisor_action,
    control_state: latestShadow.control_state, risk_flags: latestShadow.risk_flags || [], handoff_required: !!latestShadow.handoff_required,
    tool_calls: latestShadow.tool_calls || [], qa_pass: !!latestShadow.qa_pass, qa_reasons: latestShadow.qa_reasons || [],
    send_decision: latestShadow.send_decision, encrypted_draft: !!latestShadow.response_text,
    encrypted_answer_basis: Array.isArray(latestShadow.answer_basis), draft_chars: String(latestShadow.response_text || '').length,
    answer_basis_count: Array.isArray(latestShadow.answer_basis) ? latestShadow.answer_basis.length : 0,
  }));
}
setInterval(() => db.cleanup(retentionDays).catch(() => {}), 6 * 60 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'simpli-whatsapp-intelligence' });
    if (req.method === 'GET' && url.pathname === '/ready') {
      const checks = { db: await db.ping(), openai: !!env.OPENAI_API_KEY, ycloud_key: !!env.YCLOUD_API_KEY, ycloud_webhook_secret: !!env.YCLOUD_WEBHOOK_SECRET, ycloud_from: !!env.YCLOUD_FROM, mcp: !!(mcpUrl && env.SIMPLI_MCP_TOKEN), hours: (await db.getSetting('business_hours', { configured: false })).configured === true };
      return json(res, Object.values(checks).every(Boolean) ? 200 : 503, { ready: Object.values(checks).every(Boolean), checks });
    }
    if (req.method === 'POST' && url.pathname === '/webhooks/ycloud') {
      const raw = await readBody(req);
      if (!verifyYCloudSignature(raw, req.headers['ycloud-signature'], env.YCLOUD_WEBHOOK_SECRET)) return json(res, 401, { ok: false, error: 'invalid_signature' });
      const event = JSON.parse(raw);
      const claimed = await db.claimEvent(event.id, event.type || 'unknown');
      json(res, 200, { ok: true, duplicate: !claimed });
      if (claimed) { setImmediate(async () => { try { if (event.type === 'whatsapp.inbound.message' || event.type === 'whatsapp.inbound_message.received') await processInbound(event); await db.finishEvent(event.id); } catch (e) { await db.finishEvent(event.id, 'FAILED', String(e.message).slice(0, 500)); } }); }
      return;
    }
    if (url.pathname === '/admin/login') {
      if (req.method === 'GET') return html(res, 200, loginPage(), adminHeaders);
      if (req.method === 'POST') { const form = parseForm(await readBody(req, 16384)); if (!env.ADMIN_PASSWORD || form.password !== env.ADMIN_PASSWORD) return html(res, 401, loginPage('Invalid password'), adminHeaders);
        const token = signSession({ role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 }, env.ADMIN_SESSION_SECRET); return html(res, 303, '', { ...adminHeaders, 'set-cookie': `simpli_wa_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`, location: '/admin' }); }
    }
    if (req.method === 'POST' && url.pathname === '/admin/logout') { return html(res, 200, '', { ...adminHeaders, 'set-cookie': 'simpli_wa_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' }); }
    if (url.pathname.startsWith('/admin') && !isAdmin(req)) return html(res, 302, '', { ...adminHeaders, location: '/admin/login' });
    if (req.method === 'GET' && url.pathname === '/admin/app.js') return javascript(res, 200, adminJs, adminHeaders);
    if (req.method === 'GET' && url.pathname === '/admin') return html(res, 200, adminPage(), adminHeaders);
    if (req.method === 'GET' && url.pathname === '/admin/api/summary') { const metrics = await db.summary(); const mode = await db.getSetting('mode', { value: defaultMode }); const hours = await db.getSetting('business_hours', { configured: false }); const ready = !!(env.OPENAI_API_KEY && env.YCLOUD_API_KEY && env.YCLOUD_WEBHOOK_SECRET && env.YCLOUD_FROM && mcpUrl && env.SIMPLI_MCP_TOKEN && hours.configured); return json(res, 200, { metrics, mode: typeof mode === 'string' ? mode : mode.value, ready }, adminHeaders); }
    if (req.method === 'GET' && url.pathname === '/admin/api/conversations') return json(res, 200, { items: await db.listConversations(Number(url.searchParams.get('limit') || 100)) }, adminHeaders);
    if (req.method === 'GET' && url.pathname === '/admin/api/shadow-drafts') return json(res, 200, { items: await db.listShadowDrafts(Number(url.searchParams.get('limit') || 50)) }, adminHeaders);
    if (req.method === 'POST' && url.pathname === '/admin/api/mode') { const b = JSON.parse(await readBody(req, 16384)); if (!['SHADOW', 'AFTER_HOURS', 'AI_ALWAYS', 'HUMAN_ONLY'].includes(b.mode)) return json(res, 400, { error: 'invalid_mode' }, adminHeaders); await db.setSetting('mode', { value: b.mode }); await db.audit(null, 'MODE_CHANGED', 'HUMAN', { mode: b.mode }); return json(res, 200, { ok: true, mode: b.mode }, adminHeaders); }
    if (req.method === 'POST' && url.pathname === '/admin/api/hours') { const b = JSON.parse(await readBody(req, 65536)); if (!b || b.configured !== true || !b.week) return json(res, 400, { error: 'invalid_hours' }); b.timezone = b.timezone || 'Africa/Nairobi'; await db.setSetting('business_hours', b); await db.audit(null, 'HOURS_CHANGED', 'HUMAN', { timezone: b.timezone }); return json(res, 200, { ok: true }); }
    const m = url.pathname.match(/^\/admin\/api\/conversations\/([0-9a-f-]+)\/(takeover|release)$/i);
    if (req.method === 'POST' && m) { const id = m[1], action = m[2]; const c = await db.getConversation(id); if (!c) return json(res, 404, { error: 'not_found' }, adminHeaders); if (action === 'takeover') { await db.updateConversation(id, { owner: 'HUMAN', state: 'OPEN' }); await db.audit(id, 'HUMAN_TAKEOVER', 'HUMAN', {}); } else { await db.updateConversation(id, { owner: 'AI', state: 'OPEN', control_state: 'NONE' }); await db.resolveEscalations(id); await db.audit(id, 'RETURN_TO_AI', 'HUMAN', {}); } return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'not_found' });
  } catch (e) { return json(res, e.message === 'BODY_TOO_LARGE' ? 413 : 500, { error: 'request_failed', message: String(e.message).slice(0, 300) }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(JSON.stringify({ level: 'info', message: 'listening', port: PORT })));
