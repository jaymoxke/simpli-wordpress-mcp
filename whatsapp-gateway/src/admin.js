'use strict';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { location = '/admin/login'; throw new Error('UNAUTHORIZED'); }
  if (!r.ok) throw new Error(`ADMIN_API_${r.status}`);
  return r.json();
}

function renderConversations(items) {
  const rows = $('rows');
  rows.innerHTML = items.length ? items.map(x => `<tr>
    <td class="mono">${esc(x.customer_ref)}</td>
    <td>${esc(x.owner)}</td>
    <td>${esc(x.state)}</td>
    <td>${esc(x.primary_intent || '—')}</td>
    <td>${esc((x.risk_flags || []).join(', ') || '—')}</td>
    <td>${esc(x.open_escalations)}</td>
    <td>${esc(new Date(`${x.last_activity_at}Z`).toLocaleString())}</td>
    <td>${esc(x.control_state || 'NONE')}<br>
      <button data-action="takeover" data-id="${esc(x.id)}">Take over</button>
      <button data-action="release" data-id="${esc(x.id)}">Return AI</button>
    </td>
  </tr>`).join('') : '<tr><td colspan="8" class="muted">No conversations yet.</td></tr>';
}

function renderDrafts(items) {
  const draftRows = $('draftRows');
  draftRows.innerHTML = items.length ? items.map(x => `<tr>
    <td>${esc(new Date(`${x.created_at}Z`).toLocaleString())}</td>
    <td class="mono">${esc(x.customer_ref)}</td>
    <td>${esc(x.model)}</td>
    <td><b>${esc(x.primary_intent || '—')}</b><br><span class="muted">${esc(x.advisor_action || '—')}</span></td>
    <td>${esc(x.control_state || 'NONE')}${x.handoff_required ? '<br><span class="pill bad">handoff</span>' : ''}</td>
    <td><span class="pill ${x.qa_pass ? 'ok' : 'bad'}">${x.qa_pass ? 'PASS' : 'BLOCK'}</span><br><span class="muted">${esc((x.qa_reasons || []).join(', '))}</span></td>
    <td class="mono">${esc((x.tool_calls || []).join(', ') || '—')}</td>
    <td>${esc(x.send_decision || '—')}</td>
    <td><div class="draft">${esc(x.response_text || '')}</div></td>
    <td class="basis">${esc((x.answer_basis || []).join(' · ') || '—')}</td>
  </tr>`).join('') : '<tr><td colspan="10" class="muted">No SHADOW drafts captured yet.</td></tr>';
}

async function load() {
  try {
    const [s, c, d] = await Promise.all([
      api('/admin/api/summary'),
      api('/admin/api/conversations'),
      api('/admin/api/shadow-drafts?limit=50'),
    ]);
    $('modeSelect').value = s.mode;
    $('cards').innerHTML = Object.entries(s.metrics).map(([k, v]) => `<div class="card"><div class="muted">${esc(k.replaceAll('_', ' '))}</div><div class="metric">${esc(v)}</div></div>`).join('');
    $('statusPanel').innerHTML = s.ready ? '<p class="pill ok">System ready</p>' : '<p class="pill shadow">SHADOW / activation incomplete</p>';
    renderConversations(c.items || []);
    renderDrafts(d.items || []);
  } catch (err) {
    if (String(err.message) !== 'UNAUTHORIZED') $('statusPanel').innerHTML = `<p class="pill bad">Dashboard load failed: ${esc(err.message)}</p>`;
  }
}

async function setMode() {
  await api('/admin/api/mode', { method: 'POST', body: JSON.stringify({ mode: $('modeSelect').value }) });
  $('modeMsg').textContent = ' Saved';
  await load();
}

async function logout() {
  await api('/admin/logout', { method: 'POST' });
  location = '/admin/login';
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.id === 'setModeBtn') return await setMode();
    if (button.id === 'logoutBtn') return await logout();
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action && id) {
      await api(`/admin/api/conversations/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await load();
    }
  } catch (err) {
    $('statusPanel').innerHTML = `<p class="pill bad">Action failed: ${esc(err.message)}</p>`;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  load();
  setInterval(load, 15000);
});
