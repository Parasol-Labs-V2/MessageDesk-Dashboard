'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — WoW Changes
// ══════════════════════════════════════════════════════════════════════════════

function renderWoW() {
  const deals  = _data.deals;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const modified = deals.filter(d => d.lastModified && new Date(d.lastModified).getTime() >= cutoff);
  const isNew    = d => d.createDate && new Date(d.createDate).getTime() >= cutoff;
  const newDeals = modified.filter(isNew);

  const totalLives = modified.reduce((s, d) => s + d.lives, 0);
  const wonCount   = modified.filter(d => d.isWon).length;
  const lostCount  = modified.filter(d => d.isLost || d.isDQ).length;

  // Group by current stage
  const byStage = {};
  for (const d of modified) {
    if (!byStage[d.stageId]) byStage[d.stageId] = [];
    byStage[d.stageId].push(d);
  }

  const stageSections = STAGE_ORDER
    .filter(id => byStage[id] && byStage[id].length > 0)
    .map(id => {
      const sd = byStage[id].sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      const sl = sd.reduce((s, d) => s + d.lives, 0);
      const rows = sd.map(d => `<tr>
        <td class="col-name">${esc(d.dealname)}</td>
        <td class="col-num">${fmtLives(d.lives)}</td>
        <td class="col-num">${fmtSavings(d.grossSavings)}</td>
        <td>${esc(d.owner)}</td>
        <td>${fmtDateStr(d.lastModified ? d.lastModified.split('T')[0] : null)}</td>
      </tr>`).join('');

      return `
        <div class="wow-section">
          <div class="wow-section-header">
            ${stageBadge(id, STAGE_NAMES[id])}
            <span class="wow-count">${sd.length} deal${sd.length !== 1 ? 's' : ''}</span>
            <span class="wow-lives">${fmtLives(sl)} lives</span>
          </div>
          <div class="table-wrap"><div class="tscroll">
            <table class="deal-table">
              <thead><tr>
                <th>Practice Name</th><th class="col-num">Lives</th>
                <th class="col-num">Gross Savings</th><th>Owner</th><th>Last Modified</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div></div>
        </div>`;
    }).join('');

  const noModified = `
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <div class="empty-title">No deals modified in the last 7 days</div>
    </div>`;

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
    <div class="section-header">
      <h2 class="section-title">Deals Modified — Last 7 Days</h2>
      <span class="badge">${modified.length}</span>
    </div>
    <div class="wow-note">
      HubSpot's basic API doesn't expose stage change history.
      Showing all deals with any update in the last 7 days, grouped by current stage.
    </div>
    ${stageSections || noModified}
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

  $('panel-5').innerHTML = `
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
