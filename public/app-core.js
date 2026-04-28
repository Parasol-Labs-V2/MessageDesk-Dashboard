'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────
const STAGE_ORDER = [
  '3446819577','3446820538','3446820539','3467751100',
  '3446820540','3467565765','3477604030','3446820542',
  '3446820543','3446820544','3446820545','3446820546',
];

const STAGE_NAMES = {
  '3446819577': 'New / Not Yet Contacted',
  '3446820538': 'Attempting Contact',
  '3446820539': 'Parasol Engaged',
  '3467751100': 'Meeting Booked',
  '3446820540': 'Meeting Held',
  '3467565765': 'Interest Confirmed',
  '3477604030': 'Diagnostic',
  '3446820542': 'LOI Sent',
  '3446820543': 'Enrolled / Won',
  '3446820544': 'Not Interested / Lost',
  '3446820545': 'Come Back To',
  '3446820546': 'Not Relevant / DQ',
};

const ACTIVE_STAGE_IDS = new Set([
  '3446819577','3446820538','3446820539','3467751100',
  '3446820540','3467565765','3477604030','3446820542',
]);

const MID_FUNNEL_IDS = new Set([
  '3446820539','3467751100','3446820540',
  '3467565765','3477604030','3446820542',
]);

// ── Global state ───────────────────────────────────────────────────────────────
let _data      = null;
let _activeTab = 0;

// ── Utilities ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function fmtLives(n) {
  n = n || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function fmtSavings(n) {
  if (!n) return '<span class="dash">—</span>';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return '$' + (n / 1000).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString();
}

function fmtSavingsRaw(n) {
  if (!n) return '—';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return '$' + (n / 1000).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString();
}

function fmtDate(s) {
  if (!s) return '<span class="dash">—</span>';
  const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
  if (isNaN(d)) return '<span class="dash">—</span>';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateStr(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s + 'T12:00:00');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function stageBadge(stageId, stageName) {
  let cls = 'badge-active';
  if (stageId === '3446820543') cls = 'badge-won';
  else if (stageId === '3446820544' || stageId === '3446820546') cls = 'badge-lost';
  else if (stageId === '3446820545') cls = 'badge-comeback';
  return `<span class="stage-badge ${cls}">${stageName || '—'}</span>`;
}

function sortDeals(arr, col, dir) {
  return [...arr].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'number' || typeof bv === 'number') {
      return dir === 'asc' ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
    }
    const as = av == null ? (dir === 'asc' ? 'zzz' : '') : String(av);
    const bs = bv == null ? (dir === 'asc' ? 'zzz' : '') : String(bv);
    return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
  });
}

function sortTh(label, col, sortState, onSort) {
  const active = sortState.col === col;
  const icon   = active
    ? `<span class="sort-icon active">${sortState.dir === 'asc' ? '↑' : '↓'}</span>`
    : `<span class="sort-icon">↕</span>`;
  return `<th class="sortable-th" onclick="${onSort}('${col}')">${label}${icon}</th>`;
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(idx) {
  _activeTab = idx;
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
  document.querySelectorAll('.tab-panel').forEach((p, i) => p.classList.toggle('active', i === idx));
  if (!_data) return;
  dispatchRender(idx);
}

function dispatchRender(idx) {
  if (idx === 0) renderActivePipeline();
  if (idx === 1) renderFunnel();
  if (idx === 2) renderMeetings();
  if (idx === 3) renderWoW();
  if (idx === 4) renderPipelineReview();
  if (idx === 5) renderTeamPerformance();
  if (idx === 6) renderAllDeals();
}

// ── Fetch & render ─────────────────────────────────────────────────────────────
async function fetchAndRender(force) {
  const btn = $('refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Loading…'; }
  try {
    const res = await fetch(force ? '/api/deals?refresh=1' : '/api/deals');
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    _data = await res.json();
    const ts  = new Date(_data.updatedAt);
    const el  = $('updated-time');
    if (el) el.textContent = 'Updated ' + ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    dispatchRender(_activeTab);
  } catch (e) {
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.innerHTML = `<div class="error-box">⚠ Failed to load: ${e.message}</div>`;
    });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

function refreshData() { fetchAndRender(true); }

// ── Init ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach((btn, i) => {
  btn.addEventListener('click', () => switchTab(i));
});

setInterval(() => fetchAndRender(false), 5 * 60 * 1000);

document.addEventListener('DOMContentLoaded', () => fetchAndRender(false));
