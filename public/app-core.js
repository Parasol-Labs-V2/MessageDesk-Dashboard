/* ─── State ────────────────────────────────────────────────────────────────── */
const state = {
  activeClient: 'messagedesk',
  mdData:   null,
  duetData: null,
  mdActiveTab:   'md-tab1',
  duetActiveTab: 'duet-tab1',
};

/* ─── Utils ────────────────────────────────────────────────────────────────── */
function fmt$(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString();
}
function fmtNum(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function ageDays(dateStr) {
  if (!dateStr) return '—';
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return d + 'd';
}
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function isNextWeek(dateStr) {
  if (!dateStr) return false;
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const mon  = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0);
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);   sun.setHours(23,59,59,999);
  const dt   = new Date(dateStr);
  return dt >= mon && dt <= sun;
}
function isPast14Days(dateStr) {
  if (!dateStr) return false;
  const dt = new Date(dateStr);
  return dt >= new Date(Date.now() - 14 * 86400000);
}
function isLast7Days(dateStr) {
  if (!dateStr) return false;
  const dt = new Date(dateStr);
  return dt >= new Date(Date.now() - 7 * 86400000);
}
function exportCsv(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
function makeSortable(tableEl) {
  const ths = tableEl.querySelectorAll('th.sortable');
  ths.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const isNum = th.dataset.type === 'num';
      const rows = Array.from(tableEl.querySelectorAll('tbody tr'));
      const asc = th.dataset.asc !== 'true';
      th.dataset.asc = asc;
      ths.forEach(t => { delete t.dataset.asc; t.textContent = t.textContent.replace(/ [▲▼]$/,''); });
      th.dataset.asc = asc;
      th.textContent = th.textContent.replace(/ [▲▼]$/,'') + (asc ? ' ▲' : ' ▼');
      rows.sort((a, b) => {
        const av = a.dataset[col] || '';
        const bv = b.dataset[col] || '';
        if (isNum) return asc ? parseFloat(av) - parseFloat(bv) : parseFloat(bv) - parseFloat(av);
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      const tbody = tableEl.querySelector('tbody');
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

window.ParasolUtils = { fmt$, fmtNum, fmtDate, ageDays, escHtml, isNextWeek, isPast14Days, isLast7Days, exportCsv, makeSortable };

/* ─── Tab switching ────────────────────────────────────────────────────────── */
function switchTab(navId, tabId) {
  const nav = document.getElementById(navId);
  nav.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  const panelPrefix = navId === 'md-tabs-nav' ? 'md-tab' : 'duet-tab';
  document.querySelectorAll(`[id^="${panelPrefix}"]`).forEach(p => p.classList.toggle('active', p.id === tabId));
}

document.getElementById('md-tabs-nav').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.mdActiveTab = btn.dataset.tab;
  switchTab('md-tabs-nav', btn.dataset.tab);
  if (state.mdData) renderMdTab(btn.dataset.tab, state.mdData);
});

document.getElementById('duet-tabs-nav').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.duetActiveTab = btn.dataset.tab;
  switchTab('duet-tabs-nav', btn.dataset.tab);
  if (state.duetData) renderDuetTab(btn.dataset.tab, state.duetData);
});

/* ─── Client switching ─────────────────────────────────────────────────────── */
document.querySelectorAll('.client-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const client = btn.dataset.client;
    state.activeClient = client;
    document.querySelectorAll('.client-btn').forEach(b => b.classList.toggle('active', b.dataset.client === client));
    document.querySelectorAll('.client-panel').forEach(p => p.classList.toggle('hidden', p.id !== `panel-${client}`));
    if (client === 'messagedesk' && !state.mdData) loadMessageDesk();
    if (client === 'duet'        && !state.duetData) loadDuet();
  });
});

/* ─── Loading overlay ──────────────────────────────────────────────────────── */
let loadingCount = 0;
function showLoading()  { loadingCount++; document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading()  { loadingCount = Math.max(0, loadingCount - 1); if (!loadingCount) document.getElementById('loading-overlay').classList.add('hidden'); }

/* ─── Timestamp ────────────────────────────────────────────────────────────── */
function setUpdated(iso) {
  const el = document.getElementById('updated-time');
  if (!iso) { el.textContent = ''; return; }
  el.textContent = 'Updated ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ─── Data loaders ─────────────────────────────────────────────────────────── */
async function loadMessageDesk(force = false) {
  showLoading();
  try {
    const url = '/api/messagedesk/dashboard' + (force ? '?refresh=1' : '');
    const r   = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.mdData = await r.json();
    setUpdated(state.mdData.updated_at);
    renderMdTab(state.mdActiveTab, state.mdData);
  } catch (e) {
    console.error('MessageDesk load error:', e);
  } finally { hideLoading(); }
}

async function loadDuet(force = false) {
  showLoading();
  try {
    const url = '/api/duet/deals' + (force ? '?refresh=1' : '');
    const r   = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.duetData = await r.json();
    setUpdated(state.duetData.updated_at);
    renderDuetTab(state.duetActiveTab, state.duetData);
  } catch (e) {
    console.error('Duet load error:', e);
  } finally { hideLoading(); }
}

/* ─── Refresh button ───────────────────────────────────────────────────────── */
document.getElementById('refresh-btn').addEventListener('click', () => {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '↻ Refreshing…';
  state.mdData   = null;
  state.duetData = null;
  const p = [];
  if (state.activeClient === 'messagedesk') p.push(loadMessageDesk(true));
  else p.push(loadDuet(true));
  Promise.all(p).finally(() => { btn.disabled = false; btn.textContent = '↻ Refresh'; });
});

/* ─── Auto-refresh every 5 min ─────────────────────────────────────────────── */
setInterval(() => {
  if (state.activeClient === 'messagedesk') { state.mdData = null;   loadMessageDesk(); }
  else                                       { state.duetData = null; loadDuet(); }
}, 5 * 60 * 1000);

/* ─── Boot ─────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => loadMessageDesk());
