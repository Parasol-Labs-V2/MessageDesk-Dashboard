'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — WoW Changes
// ══════════════════════════════════════════════════════════════════════════════

function renderWoW() {
  const deals  = _data.deals;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const modified = deals.filter(d => d.lastModified && new Date(d.lastModified).getTime() >= cutoff);
  const newDeals = modified.filter(d => d.createDate && new Date(d.createDate).getTime() >= cutoff);

  // Classify into three groups
  // "Stage Advances" = active mid-to-late funnel stages (likely moved forward)
  const ADVANCE_IDS = new Set(['3467751100','3446820540','3467565765','3477604030','3446820542','3446820543']);
  const stageAdvances = modified.filter(d => ADVANCE_IDS.has(d.stageId) && !newDeals.includes(d));
  const otherUpdated  = modified.filter(d => !ADVANCE_IDS.has(d.stageId) && !newDeals.includes(d));

  const totalLives = modified.reduce((s, d) => s + d.lives, 0);
  const wonCount   = modified.filter(d => d.isWon).length;
  const lostCount  = modified.filter(d => d.isLost || d.isDQ).length;

  function wowTable(rows, cols) {
    if (!rows.length) return `<div style="padding:12px 16px;color:var(--gray);font-size:13px">None this week.</div>`;
    const ths = cols.map(c => `<th${c.num ? ' class="col-num"' : ''}>${c.label}</th>`).join('');
    const tds = rows.map(d => {
      return '<tr>' + cols.map(c => {
        const v = c.render ? c.render(d) : esc(d[c.key]);
        return `<td${c.num ? ' class="col-num"' : ''}>${v}</td>`;
      }).join('') + '</tr>';
    }).join('');
    return `<div class="table-wrap"><div class="tscroll"><table class="deal-table">
      <thead><tr>${ths}</tr></thead><tbody>${tds}</tbody>
    </table></div></div>`;
  }

  const baseCols = [
    { label: 'Practice Name', key: 'dealname', render: d => `<span class="col-name">${esc(d.dealname)}</span>` },
    { label: 'Current Stage', render: d => stageBadge(d.stageId, d.stage) },
    { label: 'Lives', num: true, render: d => fmtLives(d.lives) },
    { label: 'Gross Savings', num: true, render: d => fmtSavings(d.grossSavings) },
    { label: 'Owner', render: d => esc(d.owner) },
    { label: 'Last Modified', render: d => fmtDateStr(d.lastModified ? d.lastModified.split('T')[0] : null) },
  ];

  const newCols = [
    { label: 'Practice Name', render: d => `<span class="col-name">${esc(d.dealname)}</span>` },
    { label: 'Stage', render: d => stageBadge(d.stageId, d.stage) },
    { label: 'Lives', num: true, render: d => fmtLives(d.lives) },
    { label: 'Owner', render: d => esc(d.owner) },
    { label: 'Created', render: d => fmtDateStr(d.createDate ? d.createDate.split('T')[0] : null) },
  ];

  const sortByLives = arr => [...arr].sort((a, b) => b.lives - a.lives);

  $('panel-3').innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card blue">
        <div class="kpi-label">Modified This Week</div>
        <div class="kpi-value">${modified.length}</div>
        <div class="kpi-sub">deals with any update</div>
      </div>
      <div class="kpi-card red">
        <div class="kpi-label">Lives in Motion</div>
        <div class="kpi-value">${fmtLives(totalLives)}</div>
        <div class="kpi-sub">across modified deals</div>
      </div>
      <div class="kpi-card green">
        <div class="kpi-label">New This Week</div>
        <div class="kpi-value">${newDeals.length}</div>
        <div class="kpi-sub">created in last 7 days</div>
      </div>
      <div class="kpi-card yellow">
        <div class="kpi-label">Won / Lost This Week</div>
        <div class="kpi-value">${wonCount} / ${lostCount}</div>
        <div class="kpi-sub">enrolled · lost or DQ'd</div>
      </div>
    </div>

    <div class="wow-note">
      <strong>Data note:</strong> HubSpot's CRM API doesn't expose stage change history on basic deal objects.
      Stage Advances are inferred from deals currently in mid-to-late funnel stages that were modified this week —
      they likely moved forward but prior stage is not available without HubSpot's Timeline API.
    </div>

    <div class="section-header">
      <h2 class="section-title">Stage Advances</h2>
      <span class="badge">${stageAdvances.length}</span>
      <span style="font-size:12px;color:var(--gray);margin-left:4px">deals in mid–late funnel, modified this week</span>
    </div>
    ${wowTable(sortByLives(stageAdvances), baseCols)}

    <div class="section-header" style="margin-top:24px">
      <h2 class="section-title">New Deals Added</h2>
      <span class="badge">${newDeals.length}</span>
    </div>
    ${wowTable(sortByLives(newDeals), newCols)}

    <div class="section-header" style="margin-top:24px">
      <h2 class="section-title">Recently Updated</h2>
      <span class="badge">${otherUpdated.length}</span>
      <span style="font-size:12px;color:var(--gray);margin-left:4px">modified but not a stage advance or new</span>
    </div>
    ${wowTable(sortByLives(otherUpdated), baseCols)}
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — Pipeline Review
// ══════════════════════════════════════════════════════════════════════════════

let _prSort  = { col: 'lives', dir: 'desc' };
let _prOwner = '';

function renderPipelineReview() {
  const mid      = _data.deals.filter(d => MID_FUNNEL_IDS.has(d.stageId));
  const owners   = [...new Set(mid.map(d => d.owner))].sort();
  const filtered = _prOwner ? mid.filter(d => d.owner === _prOwner) : mid;
  const sorted   = sortDeals(filtered, _prSort.col, _prSort.dir);

  const ownerOpts = owners
    .map(o => `<option value="${esc(o)}" ${_prOwner === o ? 'selected' : ''}>${esc(o)}</option>`)
    .join('');

  const rows = sorted.map(d => {
    const cls = d.stageId === '3446820542' ? 'row-loi' : d.outreachAttempts >= 3 ? 'row-warn' : '';
    return `<tr class="${cls}">
      <td class="col-name">${esc(d.dealname)}</td>
      <td>${stageBadge(d.stageId, d.stage)}</td>
      <td class="col-num">${fmtLives(d.lives)}</td>
      <td class="col-num">${fmtSavings(d.grossSavings)}</td>
      <td>${esc(d.owner)}</td>
      <td>${esc(d.championName) || '<span class="dash">—</span>'}</td>
      <td>${esc(d.championRole) || '<span class="dash">—</span>'}</td>
      <td>${fmtDate(d.loiSentDate)}</td>
      <td>${fmtDate(d.lastOutreachDate)}</td>
      <td class="col-num">${d.outreachAttempts || '<span class="dash">—</span>'}</td>
      <td>${esc(d.meetingSet) || '<span class="dash">—</span>'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="11" style="padding:20px;color:var(--gray);text-align:center">No deals match the current filter</td></tr>`;

  const th = (lbl, col) => sortTh(lbl, col, _prSort, 'sortPR');

  $('panel-4').innerHTML = `
    <div class="filter-bar">
      <label class="filter-label">Owner:</label>
      <select class="filter-select" onchange="setPROwner(this.value)">
        <option value="">All Owners</option>${ownerOpts}
      </select>
      <span class="filter-count">${filtered.length} deal${filtered.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="legend-bar">
      <span class="legend-item"><span class="legend-dot row-loi-dot"></span>LOI Sent (highlighted blue)</span>
      <span class="legend-item"><span class="legend-dot row-warn-dot"></span>3+ Outreach Attempts — needs attention</span>
    </div>
    <div class="table-wrap"><div class="tscroll">
      <table class="deal-table">
        <thead><tr>
          ${th('Practice Name','dealname')}
          <th>Stage</th>
          ${th('Lives','lives')}
          ${th('Gross Savings','grossSavings')}
          ${th('Owner','owner')}
          ${th('Champion','championName')}
          <th>Champion Role</th>
          ${th('LOI Sent','loiSentDate')}
          ${th('Last Outreach','lastOutreachDate')}
          ${th('Attempts','outreachAttempts')}
          <th>Meeting Set</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></div>
  `;
}

function sortPR(col) {
  _prSort = _prSort.col === col
    ? { col, dir: _prSort.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: 'desc' };
  renderPipelineReview();
}

function setPROwner(val) {
  _prOwner = val;
  renderPipelineReview();
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — Team Performance
// ══════════════════════════════════════════════════════════════════════════════

async function renderTeamPerformance() {
  $('panel-5').innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span class="loading-text">Loading team performance…</span></div>`;

  let data;
  try {
    const res = await fetch('/api/team-performance');
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    data = await res.json();
  } catch (e) {
    $('panel-5').innerHTML = `<div class="error-box">⚠ Could not load team performance: ${esc(e.message)}</div>`;
    return;
  }

  const { owners, summary } = data;

  function untouchedColor(n) {
    if (n > 10) return 'var(--red)';
    if (n >= 5)  return '#D97706'; // amber
    return 'var(--green)';
  }

  function untouchedBg(n) {
    if (n > 10) return '#FEE2E2';
    if (n >= 5)  return '#FEF3C7';
    return '#DCFCE7';
  }

  const rows = owners.map(o => {
    const avgAttempts = o.activeDeals > 0 ? (o.totalOutreachAttempts / o.activeDeals).toFixed(1) : '—';
    const untouchedStyle = `background:${untouchedBg(o.untouched)};color:${untouchedColor(o.untouched)};font-weight:700;padding:2px 8px;border-radius:6px;display:inline-block`;
    return `<tr style="cursor:pointer" onclick="filterAllDealsByOwner('${esc(o.owner)}')" title="Click to see ${esc(o.owner)}'s deals in All Deals tab">
      <td class="col-name" style="color:var(--blue)">${esc(o.owner)}</td>
      <td class="col-num">${o.totalDeals}</td>
      <td class="col-num">${o.activeDeals}</td>
      <td class="col-num">${fmtLives(o.activeLives)}</td>
      <td class="col-num"><span style="${untouchedStyle}">${o.untouched}</span></td>
      <td class="col-num">${o.meetingsBooked}</td>
      <td class="col-num">${avgAttempts}</td>
      <td>${o.lastActivity ? fmtDateStr(o.lastActivity) : '<span class="dash">—</span>'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--gray)">No owner data available</td></tr>`;

  $('panel-5').innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card blue">
        <div class="kpi-label">Active Owners</div>
        <div class="kpi-value">${summary.totalOwners}</div>
        <div class="kpi-sub">with deals assigned</div>
      </div>
      <div class="kpi-card red">
        <div class="kpi-label">Untouched Accounts</div>
        <div class="kpi-value">${summary.totalUntouched}</div>
        <div class="kpi-sub">active deals, 0 outreach attempts</div>
      </div>
      <div class="kpi-card yellow">
        <div class="kpi-label">Meetings Booked</div>
        <div class="kpi-value">${summary.totalMeetings}</div>
        <div class="kpi-sub">active deals with meeting date set</div>
      </div>
      <div class="kpi-card green">
        <div class="kpi-label">Total Active Lives</div>
        <div class="kpi-value">${fmtLives(summary.totalActiveLives)}</div>
        <div class="kpi-sub">across all active owners</div>
      </div>
    </div>

    <div class="legend-bar" style="margin-bottom:8px">
      <span class="legend-item"><span class="legend-dot" style="background:#DCFCE7;border:1px solid #16A34A"></span>&lt;5 untouched — good</span>
      <span class="legend-item"><span class="legend-dot" style="background:#FEF3C7;border:1px solid #D97706"></span>5–10 untouched — attention</span>
      <span class="legend-item"><span class="legend-dot" style="background:#FEE2E2;border:1px solid #E8231A"></span>&gt;10 untouched — action needed</span>
      <span style="font-size:11px;color:var(--gray);margin-left:8px">· Click any row to filter All Deals by that owner</span>
    </div>

    <div class="table-wrap"><div class="tscroll">
      <table class="deal-table">
        <thead><tr>
          <th>Owner</th>
          <th class="col-num">Total Deals</th>
          <th class="col-num">Active Deals</th>
          <th class="col-num">Active Lives</th>
          <th class="col-num">Untouched (0 attempts)</th>
          <th class="col-num">Meetings Booked</th>
          <th class="col-num">Avg Outreach</th>
          <th>Last Activity</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></div>
  `;
}

function filterAllDealsByOwner(owner) {
  _allFilters.owner = owner;
  switchTab(6);
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 6 — All Deals
// ══════════════════════════════════════════════════════════════════════════════

let _allSort    = { col: 'lives', dir: 'desc' };
let _allFilters = { stage: '', owner: '', minLives: '' };

function renderAllDeals() {
  const deals  = _data.deals;
  const stages = [...new Set(deals.map(d => d.stage))].sort();
  const owners = [...new Set(deals.map(d => d.owner))].sort();

  let filtered = deals;
  if (_allFilters.stage)    filtered = filtered.filter(d => d.stage === _allFilters.stage);
  if (_allFilters.owner)    filtered = filtered.filter(d => d.owner === _allFilters.owner);
  if (_allFilters.minLives) filtered = filtered.filter(d => d.lives >= Number(_allFilters.minLives));

  const sorted     = sortDeals(filtered, _allSort.col, _allSort.dir);
  const totalLives = filtered.reduce((s, d) => s + d.lives, 0);

  const stageOpts = stages
    .map(s => `<option value="${esc(s)}" ${_allFilters.stage === s ? 'selected' : ''}>${esc(s)}</option>`)
    .join('');
  const ownerOpts = owners
    .map(o => `<option value="${esc(o)}" ${_allFilters.owner === o ? 'selected' : ''}>${esc(o)}</option>`)
    .join('');

  const th = (lbl, col) => sortTh(lbl, col, _allSort, 'sortAll');

  const rows = sorted.map(d => `<tr>
    <td class="col-name">${esc(d.dealname)}</td>
    <td>${stageBadge(d.stageId, d.stage)}</td>
    <td class="col-num">${fmtLives(d.lives)}</td>
    <td class="col-num">${fmtSavings(d.grossSavings)}</td>
    <td>${esc(d.owner)}</td>
    <td>${fmtDate(d.lastOutreachDate)}</td>
    <td class="col-num">${d.outreachAttempts || '<span class="dash">—</span>'}</td>
    <td>${fmtDate(d.meetingDate)}</td>
    <td>${fmtDate(d.loiSentDate)}</td>
    <td>${fmtDate(d.enrollmentDate)}</td>
    <td>${fmtDate(d.closedate)}</td>
  </tr>`).join('') || `<tr><td colspan="11" style="padding:20px;color:var(--gray);text-align:center">No deals match the current filters</td></tr>`;

  $('panel-6').innerHTML = `
    <div class="filter-bar">
      <select class="filter-select" onchange="setAllFilter('stage', this.value)">
        <option value="">All Stages</option>${stageOpts}
      </select>
      <select class="filter-select" onchange="setAllFilter('owner', this.value)">
        <option value="">All Owners</option>${ownerOpts}
      </select>
      <input type="number" class="filter-input" placeholder="Min Lives"
        value="${esc(_allFilters.minLives)}"
        oninput="setAllFilter('minLives', this.value)">
      <span class="filter-count">${filtered.length} deal${filtered.length !== 1 ? 's' : ''} · ${fmtLives(totalLives)} total lives</span>
      <button class="export-btn" onclick="exportCSV()">↓ Export CSV</button>
    </div>
    <div class="table-wrap"><div class="tscroll">
      <table class="deal-table">
        <thead><tr>
          ${th('Practice Name','dealname')}
          <th>Stage</th>
          ${th('Lives','lives')}
          ${th('Gross Savings','grossSavings')}
          ${th('Owner','owner')}
          ${th('Last Outreach','lastOutreachDate')}
          ${th('Attempts','outreachAttempts')}
          ${th('Meeting Date','meetingDate')}
          ${th('LOI Sent','loiSentDate')}
          ${th('Enrollment Date','enrollmentDate')}
          ${th('Close Date','closedate')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></div>
  `;
}

function sortAll(col) {
  _allSort = _allSort.col === col
    ? { col, dir: _allSort.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: 'desc' };
  renderAllDeals();
}

function setAllFilter(key, val) {
  _allFilters[key] = val;
  renderAllDeals();
}

function exportCSV() {
  const deals = _data.deals;
  let filtered = deals;
  if (_allFilters.stage)    filtered = filtered.filter(d => d.stage === _allFilters.stage);
  if (_allFilters.owner)    filtered = filtered.filter(d => d.owner === _allFilters.owner);
  if (_allFilters.minLives) filtered = filtered.filter(d => d.lives >= Number(_allFilters.minLives));

  const cols = [
    'Practice Name','Stage','Lives','Gross Savings','Owner',
    'Last Outreach','Outreach Attempts','Meeting Date','LOI Sent Date',
    'Enrollment Date','Close Date',
  ];

  const csvRows = filtered.map(d => [
    csvCell(d.dealname),
    csvCell(d.stage),
    d.lives,
    d.grossSavings,
    csvCell(d.owner),
    d.lastOutreachDate  || '',
    d.outreachAttempts  || '',
    d.meetingDate       || '',
    d.loiSentDate       || '',
    d.enrollmentDate    || '',
    d.closedate         || '',
  ].join(','));

  const csv  = [cols.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `duet-deals-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(s) {
  if (s == null) return '';
  const str = String(s).replace(/"/g, '""');
  return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
}
