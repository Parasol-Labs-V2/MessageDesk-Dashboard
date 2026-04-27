'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Active Pipeline
// ══════════════════════════════════════════════════════════════════════════════

let _expandedStage = null;

function renderActivePipeline() {
  const deals  = _data.deals;
  const active = deals.filter(d => d.isActive);

  const totalLives   = active.reduce((s, d) => s + d.lives, 0);
  const totalSavings = active.reduce((s, d) => s + d.grossSavings, 0);
  const avgLives     = active.length ? Math.round(totalLives / active.length) : 0;

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

  $('panel-0').innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card red">
        <div class="kpi-label">Total Active Lives</div>
        <div class="kpi-value">${fmtLives(totalLives)}</div>
        <div class="kpi-sub">across all active stages</div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-label">Active Deals</div>
        <div class="kpi-value">${active.length}</div>
        <div class="kpi-sub">in pipeline</div>
      </div>
      <div class="kpi-card yellow">
        <div class="kpi-label">Active Gross Savings</div>
        <div class="kpi-value">${fmtSavingsRaw(totalSavings)}</div>
        <div class="kpi-sub">estimated total</div>
      </div>
      <div class="kpi-card black">
        <div class="kpi-label">Avg Lives / Deal</div>
        <div class="kpi-value">${fmtLives(avgLives)}</div>
        <div class="kpi-sub">across active pipeline</div>
      </div>
    </div>
    <div class="stage-cards-grid">${stageCards || '<div class="empty-state"><div class="empty-title">No active deals found</div></div>'}</div>
  `;
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

  $('panel-1').innerHTML = `
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
// TAB 3 — Meetings Next Week
// ══════════════════════════════════════════════════════════════════════════════

function renderMeetings() {
  const deals = _data.deals;
  const now   = new Date(); now.setHours(0, 0, 0, 0);
  const next7 = new Date(now); next7.setDate(now.getDate() + 7);
  const past14 = new Date(now); past14.setDate(now.getDate() - 14);

  function inRange(ds, from, to) {
    if (!ds) return false;
    const d = new Date(ds.includes('T') ? ds : ds + 'T12:00:00');
    return d >= from && d < to;
  }

  const upcoming = deals
    .filter(d => inRange(d.meetingDate, now, next7))
    .sort((a, b) => (a.meetingDate || '').localeCompare(b.meetingDate || ''));

  const recent = deals
    .filter(d => inRange(d.meetingDate, past14, now))
    .sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''));

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function meetingRow(d) {
    const dt     = d.meetingDate ? new Date(d.meetingDate + 'T12:00:00') : null;
    const dayStr = dt ? `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}` : '—';
    return `<tr>
      <td class="col-name">${esc(d.dealname)}</td>
      <td>${dayStr}</td>
      <td>${esc(d.owner)}</td>
      <td class="col-num">${fmtLives(d.lives)}</td>
      <td>${stageBadge(d.stageId, d.stage)}</td>
      <td>${esc(d.championName) || '<span class="dash">—</span>'}</td>
      <td>${esc(d.championRole) || '<span class="dash">—</span>'}</td>
    </tr>`;
  }

  function meetingTable(rows) {
    return `<div class="table-wrap"><div class="tscroll"><table class="deal-table">
      <thead><tr>
        <th>Practice Name</th><th>Meeting Date</th><th>Owner</th>
        <th class="col-num">Lives</th><th>Stage</th><th>Champion</th><th>Role</th>
      </tr></thead>
      <tbody>${rows.map(meetingRow).join('')}</tbody>
    </table></div></div>`;
  }

  const upcomingHTML = upcoming.length
    ? meetingTable(upcoming)
    : `<div class="empty-state">
        <div class="empty-icon">📅</div>
        <div class="empty-title">No meetings in the next 7 days</div>
        <div class="empty-sub">Meeting dates come from the <em>meeting_date</em> field in HubSpot</div>
      </div>`;

  const recentHTML = recent.length
    ? meetingTable(recent)
    : `<div style="padding:16px 0;color:var(--gray);font-size:13px">No meetings in the past 14 days.</div>`;

  $('panel-2').innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Meetings — Next 7 Days</h2>
      <span class="badge">${upcoming.length}</span>
    </div>
    ${upcomingHTML}
    <div class="section-header" style="margin-top:28px">
      <h2 class="section-title">Recent Meetings — Past 14 Days</h2>
      <span class="badge">${recent.length}</span>
    </div>
    ${recentHTML}
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
