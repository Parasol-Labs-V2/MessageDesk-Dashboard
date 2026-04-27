/* ─── Duet Tabs 4–6 ────────────────────────────────────────────────────────── */
const _duu = window.ParasolUtils;

const DUET_MID_FUNNEL = ['Parasol Engaged','Meeting Booked','Meeting Held','Interest Confirmed','Diagnostic','LOI Sent'];

/* ─── Tab 4: WoW Changes ───────────────────────────────────────────────────── */
function renderDuetTab4(data) {
  const el    = document.getElementById('duet-tab4');
  const deals = data.deals || [];
  const { isLast7Days, fmtDate, escHtml } = _duu;

  const modified = deals.filter(d => isLast7Days(d.last_modified));
  const newDeals = modified.filter(d => isLast7Days(d.last_modified) && d.stage === 'New / Not Yet Contacted');
  const wonDeals = modified.filter(d => d.stage === 'Enrolled / Won');
  const lostDeals= modified.filter(d => ['Not Interested / Lost','Not Relevant / DQ'].includes(d.stage));

  // Group by stage
  const groups = {};
  for (const d of modified) {
    if (!groups[d.stage]) groups[d.stage] = [];
    groups[d.stage].push(d);
  }

  let stageGroups = '';
  for (const [stage, grp] of Object.entries(groups).sort((a,b)=>b[1].length-a[1].length)) {
    const rows = grp.sort((a,b)=>b.lives-a.lives).map(d => `<tr>
      <td>${escHtml(d.dealname)}</td>
      <td class="num">${fmtLives(d.lives)}</td>
      <td class="num">${fmtSavings(d.gross_savings)}</td>
      <td>${escHtml(d.owner)}</td>
      <td>${fmtDate(d.last_modified)}</td>
    </tr>`).join('');
    stageGroups += `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--gray)">${escHtml(stage)} <span style="font-weight:400">(${grp.length})</span></div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Practice Name</th><th class="num">Lives</th><th class="num">Gross Savings</th><th>Owner</th><th>Last Modified</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
    </div>`;
  }

  el.innerHTML = `
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Deals Modified</div><div class="value">${modified.length}</div></div>
      <div class="stat-box"><div class="label">Lives in Motion</div><div class="value" style="color:var(--blue)">${fmtLives(modified.reduce((s,d)=>s+d.lives,0))}</div></div>
      <div class="stat-box"><div class="label">Won This Week</div><div class="value" style="color:var(--green)">${wonDeals.length}</div></div>
      <div class="stat-box"><div class="label">Lost This Week</div><div class="value" style="color:var(--red)">${lostDeals.length}</div></div>
    </div>
    <div class="section-header"><div class="section-title">Deals Modified (Last 7 Days) by Stage</div></div>
    ${stageGroups || '<div class="empty-state"><div class="icon">📊</div><div class="msg">No deals modified this week</div></div>'}
  `;
}

/* ─── Tab 5: Pipeline Review ───────────────────────────────────────────────── */
function renderDuetTab5(data) {
  const el    = document.getElementById('duet-tab5');
  const deals = (data.deals || []).filter(d => DUET_MID_FUNNEL.includes(d.stage));
  const { fmtDate, escHtml, makeSortable, exportCsv } = _duu;

  const owners   = [...new Set(deals.map(d => d.owner).filter(Boolean))].sort();
  const ownerOpts = ['<option value="">All Owners</option>',
    ...owners.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`)].join('');

  function rowClass(d) {
    if (d.stage === 'LOI Sent') return 'highlight-blue';
    if (d.outreach_attempts >= 3) return 'highlight-yellow';
    return '';
  }

  function buildRows(list) {
    return list.map(d => `<tr class="${rowClass(d)}"
        data-company="${escHtml(d.dealname)}"
        data-lives="${d.lives}"
        data-stage="${escHtml(d.stage)}"
        data-owner="${escHtml(d.owner)}"
        data-attempts="${d.outreach_attempts}">
      <td>${escHtml(d.dealname)}</td>
      <td>${escHtml(d.stage)}</td>
      <td class="num">${fmtLives(d.lives)}</td>
      <td class="num">${fmtSavings(d.gross_savings)}</td>
      <td>${escHtml(d.owner)}</td>
      <td>${escHtml(d.champion_name)}</td>
      <td>${escHtml(d.champion_role)}</td>
      <td>${fmtDate(d.loi_sent_date)}</td>
      <td>${fmtDate(d.last_outreach)}</td>
      <td class="num">${d.outreach_attempts || 0}</td>
      <td>${escHtml(d.meeting_set || '—')}</td>
    </tr>`).join('');
  }

  el.innerHTML = `
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Mid-Funnel Deals</div><div class="value">${deals.length}</div></div>
      <div class="stat-box"><div class="label">Total Lives</div><div class="value" style="color:var(--blue)">${fmtLives(deals.reduce((s,d)=>s+d.lives,0))}</div></div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;font-size:12px;color:var(--gray)">
      <span style="background:#eff6ff;padding:2px 8px;border-radius:4px">■ Blue = LOI Sent</span>
      <span style="background:#fffbeb;padding:2px 8px;border-radius:4px">■ Yellow = 3+ Attempts</span>
    </div>
    <div class="filters-row">
      <span style="font-size:12px;font-weight:600;color:var(--gray)">Owner:</span>
      <select class="filter-select" id="duet-tab5-owner">${ownerOpts}</select>
      <button class="export-btn" id="duet-tab5-export">Export CSV</button>
    </div>
    <div class="card"><div class="table-wrap">
      <table class="data-table" id="duet-tab5-table">
        <thead><tr>
          <th class="sortable" data-col="company">Practice Name</th>
          <th class="sortable" data-col="stage">Stage</th>
          <th class="sortable num" data-col="lives" data-type="num">Lives</th>
          <th class="num">Gross Savings</th>
          <th class="sortable" data-col="owner">Owner</th>
          <th>Champion</th><th>Role</th>
          <th>LOI Sent</th><th>Last Outreach</th>
          <th class="sortable num" data-col="attempts" data-type="num">Attempts</th>
          <th>Meeting Set</th>
        </tr></thead>
        <tbody id="duet-tab5-tbody">${buildRows(deals)}</tbody>
      </table>
    </div></div>
  `;

  makeSortable(document.getElementById('duet-tab5-table'));

  document.getElementById('duet-tab5-owner').addEventListener('change', function() {
    const f = this.value;
    const filtered = f ? deals.filter(d => d.owner === f) : deals;
    document.getElementById('duet-tab5-tbody').innerHTML = buildRows(filtered);
  });

  document.getElementById('duet-tab5-export').addEventListener('click', () => {
    exportCsv(deals.map(d => ({
      Practice: d.dealname, Stage: d.stage, Lives: d.lives,
      GrossSavings: d.gross_savings, Owner: d.owner,
      Champion: d.champion_name, Role: d.champion_role,
      LOISent: d.loi_sent_date, LastOutreach: d.last_outreach, Attempts: d.outreach_attempts,
    })), 'duet-pipeline-review.csv');
  });
}

/* ─── Tab 6: All Deals ─────────────────────────────────────────────────────── */
function renderDuetTab6(data) {
  const el    = document.getElementById('duet-tab6');
  const deals = data.deals || [];
  const { fmtDate, escHtml, exportCsv, makeSortable } = _duu;

  const allStages = [...new Set(deals.map(d => d.stage))].sort();
  const owners    = [...new Set(deals.map(d => d.owner).filter(Boolean))].sort();

  const stageOpts = ['<option value="">All Stages</option>',
    ...allStages.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`)].join('');
  const ownerOpts = ['<option value="">All Owners</option>',
    ...owners.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`)].join('');

  function buildRows(list) {
    return list.map(d => `<tr
        data-company="${escHtml(d.dealname)}"
        data-lives="${d.lives}"
        data-stage="${escHtml(d.stage)}"
        data-owner="${escHtml(d.owner)}">
      <td>${escHtml(d.dealname)}</td>
      <td>${escHtml(d.stage)}</td>
      <td class="num">${fmtLives(d.lives)}</td>
      <td class="num">${fmtSavings(d.gross_savings)}</td>
      <td>${escHtml(d.owner)}</td>
      <td>${fmtDate(d.last_modified)}</td>
    </tr>`).join('');
  }

  function applyFilters() {
    const stageF = document.getElementById('duet-tab6-stage').value;
    const ownerF = document.getElementById('duet-tab6-owner').value;
    const minL   = parseFloat(document.getElementById('duet-tab6-minlives').value) || 0;
    let filtered = deals;
    if (stageF) filtered = filtered.filter(d => d.stage === stageF);
    if (ownerF) filtered = filtered.filter(d => d.owner === ownerF);
    if (minL)   filtered = filtered.filter(d => d.lives >= minL);
    document.getElementById('duet-tab6-tbody').innerHTML = buildRows(filtered);
    document.getElementById('duet-tab6-count').textContent =
      `${filtered.length} deals · ${fmtLives(filtered.reduce((s,d)=>s+d.lives,0))} lives`;
    return filtered;
  }

  el.innerHTML = `
    <div class="filters-row">
      <span class="filter-label">Stage:</span>
      <select class="filter-select" id="duet-tab6-stage">${stageOpts}</select>
      <span class="filter-label">Owner:</span>
      <select class="filter-select" id="duet-tab6-owner">${ownerOpts}</select>
      <span class="filter-label">Min Lives:</span>
      <input class="filter-input" id="duet-tab6-minlives" type="number" placeholder="0" style="width:90px">
      <button class="export-btn" id="duet-tab6-export">Export CSV</button>
      <span id="duet-tab6-count" style="font-size:12px;color:var(--gray);margin-left:auto"></span>
    </div>
    <div class="card"><div class="table-wrap">
      <table class="data-table" id="duet-tab6-table">
        <thead><tr>
          <th class="sortable" data-col="company">Practice Name</th>
          <th class="sortable" data-col="stage">Stage</th>
          <th class="sortable num" data-col="lives" data-type="num">Lives</th>
          <th class="num">Gross Savings</th>
          <th class="sortable" data-col="owner">Owner</th>
          <th>Last Modified</th>
        </tr></thead>
        <tbody id="duet-tab6-tbody">${buildRows(deals)}</tbody>
      </table>
    </div></div>
  `;

  applyFilters();
  makeSortable(document.getElementById('duet-tab6-table'));
  ['duet-tab6-stage','duet-tab6-owner'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('duet-tab6-minlives').addEventListener('input', applyFilters);
  document.getElementById('duet-tab6-export').addEventListener('click', () => {
    const filtered = applyFilters();
    exportCsv(filtered.map(d => ({
      Practice: d.dealname, Stage: d.stage, Lives: d.lives,
      GrossSavings: d.gross_savings, Owner: d.owner, LastModified: d.last_modified,
    })), 'duet-all-deals.csv');
  });
}

// Helper functions shared from duet-tabs1-3
function fmtLives(n)   { return !n ? '—' : Number(n).toLocaleString(); }
function fmtSavings(n) { return !n ? '—' : _duu.fmt$(n); }
