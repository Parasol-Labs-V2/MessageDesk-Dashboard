'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Active Pipeline
// ══════════════════════════════════════════════════════════════════════════════

let _expandedStage = null;

// Qualified = Meeting Booked and beyond
const QUALIFIED_IDS = new Set(['3467751100','3446820540','3467565765','3477604030','3446820542','3446820543']);

function wtdBounds() {
  const now = new Date();
  const daysSinceMon = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const thisMon = new Date(now);
  thisMon.setDate(now.getDate() - daysSinceMon);
  thisMon.setHours(0, 0, 0, 0);
  const lastMon = new Date(thisMon);
  lastMon.setDate(thisMon.getDate() - 7);
  return { wtdStart: thisMon.getTime(), lwStart: lastMon.getTime(), lwEnd: thisMon.getTime() - 1 };
}

async function renderActivePipeline() {
  const deals  = _data.deals;
  const active = deals.filter(d => d.isActive);

  const stageCards = STAGE_ORDER
    .filter(id => ACTIVE_STAGE_IDS.has(id))
    .map(id => {
      const stageName  = STAGE_NAMES[id];
      const stageDeals = active.filter(d => d.stageId === id);
      const stageLives = stageDeals.reduce((s, d) => s + d.lives, 0);
      const stageSavings = stageDeals.reduce((s, d) => s + d.grossSavings, 0);
      const isOpen = _expandedStage === id;

      const dealRows = stageDeals
        .sort((a, b) => b.lives - a.lives)
        .map(d => `<tr>
          <td class="col-name">${esc(d.dealname)}</td>
          <td class="col-num">${fmtLives(d.lives)}</td>
          <td class="col-num">${fmtSavings(d.grossSavings)}</td>
          <td>${esc(d.owner)}</td>
          <td>${fmtDate(d.lastOutreachDate)}</td>
          <td class="col-num">${d.outreachAttempts || '<span class="dash">—</span>'}</td>
        </tr>`).join('');

      const tableHTML = isOpen && stageDeals.length
        ? `<div class="stage-table-wrap">
            <div class="tscroll">
              <table class="deal-table">
                <thead><tr>
                  <th>Practice Name</th><th class="col-num">Lives</th>
                  <th class="col-num">Gross Savings</th><th>Owner</th>
                  <th>Last Outreach</th><th class="col-num">Attempts</th>
                </tr></thead>
                <tbody>${dealRows}</tbody>
              </table>
            </div>
          </div>`
        : (isOpen && !stageDeals.length
            ? `<div class="stage-table-wrap" style="padding:16px 20px;color:var(--gray);font-size:13px">No deals in this stage</div>`
            : '');

      return `
        <div class="stage-card ${isOpen ? 'expanded' : ''}" onclick="toggleStage('${id}')">
          <div class="stage-card-top">
            <div class="stage-name">${stageName}</div>
            <div class="stage-arrow">▼</div>
          </div>
          <div class="stage-stats">
            <div>
              <div class="stat-num">${stageDeals.length}</div>
              <div class="stat-lbl">Deals</div>
            </div>
            <div>
              <div class="stat-num accent">${fmtLives(stageLives)}</div>
              <div class="stat-lbl">Lives</div>
            </div>
            <div>
              <div class="stat-num">${fmtSavingsRaw(stageSavings)}</div>
              <div class="stat-lbl">Gross Savings</div>
            </div>
          </div>
          ${tableHTML}
        </div>`;
    }).join('');

  // Qualified metrics (Meeting Booked and beyond)
  const qualified    = deals.filter(d => QUALIFIED_IDS.has(d.stageId));
  const qualLives    = qualified.reduce((s, d) => s + d.lives, 0);
  const qualSavings  = qualified.reduce((s, d) => s + d.grossSavings, 0);

  // Week-bounded deal activity (computed synchronously from cached data)
  const { wtdStart, lwStart, lwEnd } = wtdBounds();
  function dealMetrics(fromMs, toMs) {
    const sub = deals.filter(d => d.lastModified && new Date(d.lastModified).getTime() >= fromMs && new Date(d.lastModified).getTime() <= toMs);
    return {
      meetings: sub.filter(d => d.stageId === '3467751100').length,
      forward:  sub.filter(d => QUALIFIED_IDS.has(d.stageId)).length,
    };
  }
  const wtd = dealMetrics(wtdStart, Date.now());
  const lw  = dealMetrics(lwStart, lwEnd);

  function activityCard(id, label, callsId, callsVal, metrics) {
    const isWTD = id === 'wtd';
    const bg    = isWTD ? '#F5F3FF' : '#F8FAFC';
    const accent= isWTD ? '#7C3AED' : '#374151';
    return `<div class="kpi-card" style="background:${bg};border-color:${accent}30;min-width:180px">
      <div class="kpi-label" style="color:${accent}">${label}</div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:#6B7280">Calls</span>
          <span id="${callsId}" style="font-weight:700;font-size:15px;color:${accent}">${callsVal}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:#6B7280">Meetings Booked</span>
          <span style="font-weight:700;font-size:15px;color:${accent}">${metrics.meetings}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:#6B7280">Deals Qualified</span>
          <span style="font-weight:700;font-size:15px;color:${accent}">${metrics.forward}</span>
        </div>
      </div>
    </div>`;
  }

  $('panel-0').innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(5,1fr)">
      <div class="kpi-card green">
        <div class="kpi-label">Qualified Lives</div>
        <div class="kpi-value">${fmtLives(qualLives)}</div>
        <div class="kpi-sub">Meeting Booked and beyond</div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-label">Qualified Deals</div>
        <div class="kpi-value">${qualified.length}</div>
        <div class="kpi-sub">Meeting Booked and beyond</div>
      </div>
      <div class="kpi-card yellow">
        <div class="kpi-label">Qualified Savings</div>
        <div class="kpi-value">${fmtSavingsRaw(qualSavings)}</div>
        <div class="kpi-sub">Meeting Booked and beyond</div>
      </div>
      ${activityCard('lw',  'Last Week Activity', 'ap-lw-calls',  '…', lw)}
      ${activityCard('wtd', 'WTD Activity',        'ap-wtd-calls', '…', wtd)}
    </div>
    <div class="stage-cards-grid">${stageCards || '<div class="empty-state"><div class="empty-title">No active deals found</div></div>'}</div>
  `;

  // Fetch calls counts from team-performance in background and fill in
  fetch('/api/team-performance')
    .then(r => r.ok ? r.json() : null)
    .then(tp => {
      if (!tp || !tp.activity) return;
      const lwEl  = $('ap-lw-calls');
      const wtdEl = $('ap-wtd-calls');
      if (lwEl)  lwEl.textContent  = tp.activity.lastWeek.calls;
      if (wtdEl) wtdEl.textContent = tp.activity.wtd.calls;
    })
    .catch(() => {});
}

function toggleStage(id) {
  _expandedStage = _expandedStage === id ? null : id;
  renderActivePipeline();
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Funnel Overview
// ══════════════════════════════════════════════════════════════════════════════

function renderFunnel() {
  const deals      = _data.deals;
  const totalLives = deals.reduce((s, d) => s + d.lives, 0);

  // Per-stage stats
  const stageStats = STAGE_ORDER.map(id => {
    const sd = deals.filter(d => d.stageId === id);
    const sl = sd.reduce((s, d) => s + d.lives, 0);
    return { id, count: sd.length, lives: sl, pct: totalLives > 0 ? Math.round(sl / totalLives * 100) : 0 };
  });

  const maxLives = Math.max(...stageStats.map(s => s.lives), 1);

  function stageColor(id) {
    if (id === '3446820543') return 'var(--green)';
    if (id === '3446820544' || id === '3446820546') return 'var(--red)';
    if (id === '3446820545') return 'var(--yellow)';
    return 'var(--blue)';
  }

  // Conversion rates
  const totalActive   = deals.filter(d => d.isActive).length;
  const contacted     = deals.filter(d => d.stageId !== '3446819577').length;
  const contactRate   = (totalActive + deals.filter(d => !d.isActive).length) > 0
    ? Math.round(contacted / deals.length * 100) : 0;

  const activeCount   = totalActive;
  const meetingCount  = deals.filter(d =>
    ['3467751100','3446820540','3467565765','3477604030','3446820542'].includes(d.stageId)
  ).length;
  const meetingRate   = activeCount > 0 ? Math.round(meetingCount / activeCount * 100) : 0;

  const loiCount      = deals.filter(d => d.stageId === '3446820542').length;
  const loiRate       = meetingCount > 0 ? Math.round(loiCount / meetingCount * 100) : 0;

  const wonCount      = deals.filter(d => d.isWon).length;
  const lostCount     = deals.filter(d => d.isLost).length;
  const closedTotal   = wonCount + lostCount;
  const winRate       = closedTotal > 0 ? Math.round(wonCount / closedTotal * 100) : 0;

  const activeLives   = deals.filter(d => d.isActive).reduce((s, d) => s + d.lives, 0);
  const enrolledLives = deals.filter(d => d.isWon).reduce((s, d) => s + d.lives, 0);

  const funnelRows = stageStats.map(s => {
    const bar = Math.round(s.lives / maxLives * 100);
    return `
      <div class="funnel-row">
        <div class="funnel-stage">${STAGE_NAMES[s.id]}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${bar}%;background:${stageColor(s.id)}"></div>
        </div>
        <div class="funnel-count">${s.count}</div>
        <div class="funnel-lives">${fmtLives(s.lives)} lives</div>
        <div class="funnel-pct">${s.pct}%</div>
      </div>`;
  }).join('');

  $('panel-2').innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card blue">
        <div class="kpi-label">Prospect Lives</div>
        <div class="kpi-value">${fmtLives(activeLives)}</div>
        <div class="kpi-sub">active stages</div>
      </div>
      <div class="kpi-card green">
        <div class="kpi-label">Enrolled Lives</div>
        <div class="kpi-value">${fmtLives(enrolledLives)}</div>
        <div class="kpi-sub">Enrolled / Won</div>
      </div>
      <div class="kpi-card red">
        <div class="kpi-label">Total Pipeline</div>
        <div class="kpi-value">${deals.length}</div>
        <div class="kpi-sub">all deals</div>
      </div>
      <div class="kpi-card yellow">
        <div class="kpi-label">Total Lives Tracked</div>
        <div class="kpi-value">${fmtLives(totalLives)}</div>
        <div class="kpi-sub">all stages combined</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">Pipeline Funnel — Lives by Stage</div>
        ${funnelRows}
        <div class="funnel-legend">
          <span class="legend-item"><span class="legend-dot" style="background:var(--blue)"></span>Active</span>
          <span class="legend-item"><span class="legend-dot" style="background:var(--green)"></span>Won</span>
          <span class="legend-item"><span class="legend-dot" style="background:var(--red)"></span>Lost / DQ</span>
          <span class="legend-item"><span class="legend-dot" style="background:var(--yellow)"></span>Come Back To</span>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Conversion Rates</div>
          <div class="conv-grid">
            <div class="conv-card">
              <div class="conv-pct">${contactRate}%</div>
              <div class="conv-lbl">Contact Rate</div>
              <div class="conv-sub">Deals past first stage</div>
            </div>
            <div class="conv-card">
              <div class="conv-pct">${meetingRate}%</div>
              <div class="conv-lbl">Meeting Rate</div>
              <div class="conv-sub">Active → Meeting</div>
            </div>
            <div class="conv-card">
              <div class="conv-pct">${loiRate}%</div>
              <div class="conv-lbl">LOI Rate</div>
              <div class="conv-sub">Meeting → LOI</div>
            </div>
            <div class="conv-card">
              <div class="conv-pct">${winRate}%</div>
              <div class="conv-lbl">Win Rate</div>
              <div class="conv-sub">Won / (Won + Lost)</div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Lives Summary</div>
          <div class="lives-row">
            <span class="lives-lbl">Prospect Lives (Active)</span>
            <span class="lives-val">${fmtLives(activeLives)}</span>
          </div>
          <div class="lives-row">
            <span class="lives-lbl">Enrolled Lives (Won)</span>
            <span class="lives-val" style="color:var(--green)">${fmtLives(enrolledLives)}</span>
          </div>
          <div class="lives-row total">
            <span class="lives-lbl">Total Tracked</span>
            <span class="lives-val">${fmtLives(totalLives)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — Meetings Next Week  (fetches /api/meetings from HubSpot engagements)
// ══════════════════════════════════════════════════════════════════════════════

async function renderMeetings() {
  $('panel-3').innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span class="loading-text">Loading meetings from HubSpot…</span></div>`;

  let apiData;
  try {
    const res = await fetch('/api/meetings');
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    apiData = await res.json();
  } catch (e) {
    $('panel-3').innerHTML = `<div class="error-box">⚠ Could not load meetings: ${esc(e.message)}</div>`;
    return;
  }

  const upcoming = apiData.upcoming || [];
  const recent   = apiData.recent   || [];

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function fmtMsDate(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function fmtMsTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function engRow(m) {
    return `<tr>
      <td class="col-name">${esc(m.title)}</td>
      <td>${fmtMsDate(m.startMs)}<span style="color:var(--gray);font-size:11px;margin-left:4px">${fmtMsTime(m.startMs)}</span></td>
      <td>${esc(m.owner)}</td>
      <td class="col-name">${m.dealName ? esc(m.dealName) : '<span class="dash">—</span>'}</td>
      <td class="col-num">${m.dealLives ? fmtLives(m.dealLives) : '<span class="dash">—</span>'}</td>
      <td>${m.dealStageId ? stageBadge(m.dealStageId, m.dealStage) : '<span class="dash">—</span>'}</td>
      <td>${m.outcome ? `<span class="stage-badge badge-active">${esc(m.outcome)}</span>` : '<span class="dash">—</span>'}</td>
    </tr>`;
  }

  function engTable(rows, emptyMsg) {
    if (!rows.length) return `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">${emptyMsg}</div><div class="empty-sub">Meetings are pulled from HubSpot meeting engagements</div></div>`;
    return `<div class="table-wrap"><div class="tscroll"><table class="deal-table">
      <thead><tr>
        <th>Meeting Title</th><th>Date &amp; Time</th><th>Owner</th>
        <th>Practice / Deal</th><th class="col-num">Lives</th><th>Stage</th><th>Outcome</th>
      </tr></thead>
      <tbody>${rows.map(engRow).join('')}</tbody>
    </table></div></div>`;
  }

  // Also show deal-level meeting_date as a fallback supplemental section
  const dealMeetings = (_data && _data.deals || []).filter(d => d.meetingDate);

  $('panel-3').innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Meetings — Next 7 Days</h2>
      <span class="badge">${upcoming.length}</span>
    </div>
    ${engTable(upcoming, 'No meetings scheduled in the next 7 days')}

    <div class="section-header" style="margin-top:28px">
      <h2 class="section-title">Recent Meetings — Past 14 Days</h2>
      <span class="badge">${recent.length}</span>
    </div>
    ${engTable(recent, 'No meetings in the past 14 days')}

    ${dealMeetings.length ? `
    <div class="section-header" style="margin-top:28px">
      <h2 class="section-title">Deals with Meeting Date Set</h2>
      <span class="badge">${dealMeetings.length}</span>
    </div>
    <div class="table-wrap"><div class="tscroll"><table class="deal-table">
      <thead><tr>
        <th>Practice Name</th><th>Meeting Date</th><th>Owner</th>
        <th class="col-num">Lives</th><th>Stage</th><th>Champion</th>
      </tr></thead>
      <tbody>${dealMeetings.sort((a,b) => (a.meetingDate||'').localeCompare(b.meetingDate||'')).map(d => `<tr>
        <td class="col-name">${esc(d.dealname)}</td>
        <td>${fmtDate(d.meetingDate)}</td>
        <td>${esc(d.owner)}</td>
        <td class="col-num">${fmtLives(d.lives)}</td>
        <td>${stageBadge(d.stageId, d.stage)}</td>
        <td>${esc(d.championName) || '<span class="dash">—</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>` : ''}
  `;
}

// ── Shared escape helper (used in all tab files) ───────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
