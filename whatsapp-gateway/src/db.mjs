import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encryptText, decryptText } from './crypto.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ''); } catch { return fallback; }
}

export function createDb(databasePath, encryptionKey) {
  if (!databasePath) throw new Error('DATABASE_PATH is required');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const exec = (sql, ...p) => db.prepare(sql).run(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  return {
    db,
    async migrate() {
      db.exec(`
        create table if not exists wa_settings(
          key text primary key,
          value text not null,
          updated_at text not null default (datetime('now'))
        );
        create table if not exists wa_conversations(
          id text primary key,
          customer_ref text not null unique,
          external_user_id text,
          phone_enc text,
          source_context text not null default 'ORGANIC_WHATSAPP',
          owner text not null default 'AI',
          state text not null default 'OPEN',
          primary_intent text,
          risk_flags text not null default '[]',
          control_state text not null default 'NONE',
          last_response_id text,
          last_activity_at text not null default (datetime('now')),
          created_at text not null default (datetime('now')),
          updated_at text not null default (datetime('now'))
        );
        create table if not exists wa_messages(
          id integer primary key autoincrement,
          conversation_id text not null references wa_conversations(id) on delete cascade,
          provider_message_id text unique,
          direction text not null,
          message_type text not null,
          body_enc text,
          status text,
          sent_at text,
          created_at text not null default (datetime('now'))
        );
        create index if not exists wa_messages_conv_created on wa_messages(conversation_id,created_at desc);
        create table if not exists wa_events(
          event_id text primary key,
          event_type text not null,
          received_at text not null default (datetime('now')),
          processed_at text,
          state text not null default 'RECEIVED',
          error text
        );
        create table if not exists wa_escalations(
          id integer primary key autoincrement,
          conversation_id text not null references wa_conversations(id) on delete cascade,
          reason text not null,
          flags text not null default '[]',
          status text not null default 'OPEN',
          created_at text not null default (datetime('now')),
          resolved_at text
        );
        create table if not exists wa_audit(
          id integer primary key autoincrement,
          conversation_id text,
          action text not null,
          actor text not null,
          details text not null default '{}',
          created_at text not null default (datetime('now'))
        );
        create table if not exists wa_shadow_drafts(
          id integer primary key autoincrement,
          conversation_id text not null references wa_conversations(id) on delete cascade,
          response_id text,
          model text not null,
          primary_intent text,
          advisor_action text,
          control_state text not null default 'NONE',
          risk_flags text not null default '[]',
          handoff_required integer not null default 0,
          answer_basis_enc text,
          tool_calls text not null default '[]',
          qa_pass integer not null,
          qa_reasons text not null default '[]',
          send_decision text,
          draft_enc text not null,
          created_at text not null default (datetime('now'))
        );
        create index if not exists wa_shadow_drafts_created on wa_shadow_drafts(created_at desc);
        create index if not exists wa_shadow_drafts_conversation on wa_shadow_drafts(conversation_id,created_at desc);
      `);
    },
    async ping() { return Number(get('select 1 as ok')?.ok) === 1; },
    async claimEvent(id, type) { return Number(exec('insert or ignore into wa_events(event_id,event_type) values(?,?)', id, type).changes) === 1; },
    async finishEvent(id, state = 'PROCESSED', error = null) { exec("update wa_events set processed_at=datetime('now'),state=?,error=? where event_id=?", state, error, id); },
    async getSetting(key, fallback = null) { const r = get('select value from wa_settings where key=?', key); return r ? JSON.parse(r.value) : fallback; },
    async setSetting(key, value) { exec("insert into wa_settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value,updated_at=datetime('now')", key, JSON.stringify(value)); },
    async getOrCreateConversation({ id, customerRef, externalUserId, phone }) {
      const phoneEnc = phone ? encryptText(phone, encryptionKey) : null;
      exec(`insert into wa_conversations(id,customer_ref,external_user_id,phone_enc) values(?,?,?,?)
        on conflict(customer_ref) do update set
          external_user_id=coalesce(excluded.external_user_id,wa_conversations.external_user_id),
          phone_enc=coalesce(excluded.phone_enc,wa_conversations.phone_enc),
          last_activity_at=datetime('now'),updated_at=datetime('now')`, id, customerRef, externalUserId || null, phoneEnc);
      return get('select * from wa_conversations where customer_ref=?', customerRef);
    },
    async addMessage({ conversationId, providerMessageId, direction, type, body, status, sentAt }) {
      const enc = body ? encryptText(body, encryptionKey) : null;
      exec('insert or ignore into wa_messages(conversation_id,provider_message_id,direction,message_type,body_enc,status,sent_at) values(?,?,?,?,?,?,?)', conversationId, providerMessageId || null, direction, type, enc, status || null, sentAt || null);
      exec("update wa_conversations set last_activity_at=datetime('now'),updated_at=datetime('now') where id=?", conversationId);
    },
    async recentMessages(conversationId, limit = 10) {
      return all('select direction,message_type,body_enc,created_at from wa_messages where conversation_id=? order by created_at desc limit ?', conversationId, Math.min(limit, 20))
        .reverse()
        .map(x => ({ ...x, body: x.body_enc ? decryptText(x.body_enc, encryptionKey) : null, body_enc: undefined }));
    },
    async addShadowDraft({ conversationId, responseId, model, primaryIntent, advisorAction, controlState, riskFlags, handoffRequired, answerBasis, toolCalls, qaPass, qaReasons, sendDecision, responseText }) {
      if (!conversationId || !responseText) throw new Error('Shadow draft requires conversationId and responseText');
      const answerBasisEnc = encryptText(JSON.stringify(Array.isArray(answerBasis) ? answerBasis : []), encryptionKey);
      const draftEnc = encryptText(responseText, encryptionKey);
      const result = exec(`insert into wa_shadow_drafts(
        conversation_id,response_id,model,primary_intent,advisor_action,control_state,risk_flags,handoff_required,
        answer_basis_enc,tool_calls,qa_pass,qa_reasons,send_decision,draft_enc
      ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      conversationId, responseId || null, model || 'unknown', primaryIntent || null, advisorAction || null, controlState || 'NONE',
      JSON.stringify(Array.isArray(riskFlags) ? riskFlags : []), handoffRequired ? 1 : 0, answerBasisEnc,
      JSON.stringify(Array.isArray(toolCalls) ? toolCalls : []), qaPass ? 1 : 0,
      JSON.stringify(Array.isArray(qaReasons) ? qaReasons : []), sendDecision || null, draftEnc);
      return Number(result.lastInsertRowid);
    },
    async listShadowDrafts(limit = 50) {
      return all(`select d.id,d.conversation_id,c.customer_ref,d.response_id,d.model,d.primary_intent,d.advisor_action,
        d.control_state,d.risk_flags,d.handoff_required,d.answer_basis_enc,d.tool_calls,d.qa_pass,d.qa_reasons,
        d.send_decision,d.draft_enc,d.created_at
        from wa_shadow_drafts d join wa_conversations c on c.id=d.conversation_id
        order by datetime(d.created_at) desc,d.id desc limit ?`, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .map(x => ({
          id: Number(x.id),
          conversation_id: x.conversation_id,
          customer_ref: x.customer_ref,
          response_id: x.response_id,
          model: x.model,
          primary_intent: x.primary_intent,
          advisor_action: x.advisor_action,
          control_state: x.control_state,
          risk_flags: parseJson(x.risk_flags, []),
          handoff_required: Number(x.handoff_required) === 1,
          answer_basis: parseJson(x.answer_basis_enc ? decryptText(x.answer_basis_enc, encryptionKey) : '[]', []),
          tool_calls: parseJson(x.tool_calls, []),
          qa_pass: Number(x.qa_pass) === 1,
          qa_reasons: parseJson(x.qa_reasons, []),
          send_decision: x.send_decision,
          response_text: x.draft_enc ? decryptText(x.draft_enc, encryptionKey) : null,
          created_at: x.created_at,
        }));
    },
    async updateConversation(id, patch) {
      for (const [k, v] of Object.entries(patch).filter(([k]) => ['owner', 'state', 'primary_intent', 'risk_flags', 'control_state', 'last_response_id'].includes(k))) {
        exec(`update wa_conversations set ${k}=?,updated_at=datetime('now') where id=?`, k === 'risk_flags' ? JSON.stringify(v) : v, id);
      }
    },
    async escalate(conversationId, reason, flags = []) { exec('insert into wa_escalations(conversation_id,reason,flags) values(?,?,?)', conversationId, reason, JSON.stringify(flags)); },
    async audit(conversationId, action, actor, details = {}) { exec('insert into wa_audit(conversation_id,action,actor,details) values(?,?,?,?)', conversationId || null, action, actor, JSON.stringify(details)); },
    async summary() {
      const c = get("select count(*) total,sum(case when owner='HUMAN' then 1 else 0 end) human_owned,sum(case when state='OPEN' then 1 else 0 end) open from wa_conversations") || {};
      const e = get("select count(*) open from wa_escalations where status='OPEN'") || {};
      const m = get("select count(*) last_24h from wa_messages where datetime(created_at)>datetime('now','-24 hours')") || {};
      const d = get("select count(*) last_24h,sum(case when qa_pass=0 then 1 else 0 end) qa_blocked_24h from wa_shadow_drafts where datetime(created_at)>datetime('now','-24 hours')") || {};
      return {
        total: Number(c.total || 0), human_owned: Number(c.human_owned || 0), open: Number(c.open || 0),
        escalations: Number(e.open || 0), messages_24h: Number(m.last_24h || 0),
        shadow_drafts_24h: Number(d.last_24h || 0), qa_blocked_24h: Number(d.qa_blocked_24h || 0),
      };
    },
    async listConversations(limit = 100) {
      return all(`select c.id,c.customer_ref,c.owner,c.state,c.primary_intent,c.risk_flags,c.control_state,c.last_activity_at,
        (select count(*) from wa_escalations e where e.conversation_id=c.id and e.status='OPEN') open_escalations
        from wa_conversations c order by datetime(last_activity_at) desc limit ?`, Math.min(limit, 200))
        .map(x => ({ ...x, risk_flags: parseJson(x.risk_flags, []), open_escalations: Number(x.open_escalations || 0) }));
    },
    async getConversation(id) {
      const x = get('select * from wa_conversations where id=?', id);
      return x ? { ...x, risk_flags: parseJson(x.risk_flags, []), phone: x.phone_enc ? decryptText(x.phone_enc, encryptionKey) : null, phone_enc: undefined } : null;
    },
    async resolveEscalations(id) { exec("update wa_escalations set status='RESOLVED',resolved_at=datetime('now') where conversation_id=? and status='OPEN'", id); },
    async cleanup(retentionDays = 30) {
      const redacted = exec("update wa_messages set body_enc=null where body_enc is not null and datetime(created_at)<datetime('now', ?)", `-${Number(retentionDays)} days`);
      const removedDrafts = exec("delete from wa_shadow_drafts where datetime(created_at)<datetime('now', ?)", `-${Number(retentionDays)} days`);
      return Number(redacted.changes) + Number(removedDrafts.changes);
    },
    close() { db.close(); },
  };
}
