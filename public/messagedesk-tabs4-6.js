/* ─── MessageDesk Tabs 4–6 ─────────────────────────────────────────────────── */
const _mu = window.ParasolUtils;

/* ─── Tab 4: WoW Changes ───────────────────────────────────────────────────── */
function renderMdTab4(data) {
  const el     = document.getElementById('md-tab4');
  const active = data.active_opportunities || [];
  const won    = data.won_opportunities    || [];
  const lost   = data.lost_opportunities   || [];
  const { isLast7Days, fmt$, fmtDate, escHtml } = _mu;

  const recentActive = active.filter(d => isLast7Days(d.date_updated));
  const recentWon    = won.filter(d => isLast7Days(d.date_updated));
  const recentLost   = lost.filter(d => isLast7Days(d.date_updated));

  // Group active by stage
  const groups = {};
  for (const d of recentActive) {
    if (!groups[d.status_label]) groups[d.status_label] = [];
    groups[d.status_label].push(d);
  }

  let stageCards = '';
  for (const [stage, deals] of Object.entries(groups).sort((a,b)=>b[1].length-a[1].length)) {
    let rows = '';
    for (const d of deals.sort((a,b) => b.monthly_value - a.monthly_value)) {
      rows += `<tr>
        <td>${escHtml(d.company)}</td>
        <td class="num mrr-cell">${fmt$(d.monthly_value)}/mo</td>
        <td>${escHtml(d.owner)}</td>
        <td>${fmtDate(d.date_updated)}</td>
      </tr>`;
    }
    stageCards += `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--gray)">${escHtml(stage)} <span style="font-weight:400">(${deals.length})</span></div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Company</th><th class="num">MRR</th><th>Owner</th><th>Last Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
    </div>`;
  }

  let wonRows = '';
  for (const d of recentWon) {
    wonRows += `<tr>
      <td>${escHtml(d.company)}</td>
      <td class="num mrr-cell">${fmt$(d.monthly_value)}/mo</td>
      <td>${escHtml(d.owner)}</td>
      <td>${fmtDate(d.date_updated)}</td>
    </tr>`;
  }
  let lostRows = '';
  for (const d of recentLost) {
    lostRows += `<tr>
      <td>${escHtml(d.company)}</td>
      <td class="num">${fmt$(d.monthly_value)}/mo</td>
      <td>${escHtml(d.owner)}</td>
      <td>${fmtDate(d.date_updated)}</td>
    </tr>`;
  }

  el.innerHTML = `
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Active Updated</div><div class="value">${recentActive.length}</div></div>
      <div class="stat-box"><div class="label">MRR in Motion</div><div class="value" style="color:var(--blue)">${fmt$(recentActive.reduce((s,d)=>s+d.monthly_value,0))}</div></div>
      <div class="stat-box"><div class="label">Won This Week</div><div class="value" style="color:var(--green)">${recentWon.length}</div></div>
      <div class="stat-box"><div class="label">Lost This Week</div><div class="value" style="color:var(--red)">${recentLost.length}</div></div>
    </div>
    <div class="section-header"><div class="section-title">Active Deals Updated (Last 7 Days)</div></div>
    ${stageCards || '<div class="empty-state"><div class="icon">📊</div><div class="msg">No active deals updated this week</div></div>'}
    ${recentWon.length ? `
      <div class="section-header" style="margin-top:8px"><div class="section-title" style="color:var(--green)">Won This Week</div></div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Company</th><th class="num">MRR</th><th>Owner</th><th>Date Won</th></tr></thead>
        <tbody>${wonRows}</tbody>
      </table></div></div>` : ''}
    ${recentLost.length ? `
      <div class="section-header" style="margin-top:8px"><div class="section-title" style="color:var(--red)">Lost This Week</div></div>
      <div class="card"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Company</th><th class="num">MRR</th><th>Owner</th><th>Date Lost</th></tr></thead>
        <tbody>${lostRows}</tbody>
      </table></div></div>` : ''}
  `;
}

/* ─── Tab 5: 2K+ Pipeline Review ──────────────────────────────────────────── */
function renderMdTab5(data) {
  const el     = document.getElementById('md-tab5');
  const active = data.active_opportunities || [];
  const { fmt$, fmtDate, escHtml, makeSortable } = _mu;

  const big = active.filter(d => d.monthly_value >= 2000)
                    .sort((a,b) => b.monthly_value - a.monthly_value);

  const owners = [...new Set(big.map(d => d.owner).filter(Boolean))].sort();
  const ownerOpts = ['<option value="">All Owners</option>',
    ...owners.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`)].join('');

  function buildRows(deals) {
    return deals.map(d => `<tr>
      <td>${escHtml(d.company)}</td>
      <td class="num mrr-cell">${fmt$(d.monthly_value)}/mo</td>
      <td>${escHtml(d.owner)}</td>
      <td>${escHtml(d.status_label)}</td>
      <td>${d.a2p_stage ? 'Stage ' + d.a2p_stage : '—'}</td>
      <td>${d.age_days}d</td>
      <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(d.note)}</td>
    </tr>`).join('');
  }

  el.innerHTML = `
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Deals ≥ $2K/mo</div><div class="value">${big.length}</div></div>
      <div class="stat-box"><div class="label">Total MRR</div><div class="value" style="color:var(--red)">${fmt$(big.reduce((s,d)=>s+d.monthly_value,0))}</div></div>
    </div>
    <div class="filters-row">
      <span class="filter-label">Owner:</span>
      <select class="filter-select" id="md-tab5-owner">${ownerOpts}</select>
    </div>
    <div class="card" id="md-tab5-wrap">
      <div class="table-wrap">
        <table class="data-table" id="md-tab5-table">
          <thead><tr>
            <th class="sortable" data-col="company">Company</th>
            <th class="sortable num" data-col="mrr" data-type="num">MRR</th>
            <th>Owner</th>
            <th class="sortable" data-col="stage">Stage</th>
            <th>A2P Stage</th>
            <th class="sortable num" data-col="age" data-type="num">Age</th>
            <th>Note</th>
          </tr></thead>
          <tbody id="md-tab5-tbody">${buildRows(big)}</tbody>
        </table>
      </div>
    </div>
  `;

  // Add data attrs for sort
  const tbody = document.getElementById('md-tab5-tbody');
  big.forEach((d, i) => {
    const row = tbody.rows[i];
    if (row) {
      row.dataset.company = d.company;
      row.dataset.mrr     = d.monthly_value;
      row.dataset.stage   = d.status_label;
      row.dataset.age     = d.age_days;
    }
  });
  makeSortable(document.getElementById('md-tab5-table'));

  document.getElementById('md-tab5-owner').addEventListener('change', function() {
    const filter = this.value;
    const filtered = filter ? big.filter(d => d.owner === filter) : big;
    document.getElementById('md-tab5-tbody').innerHTML = buildRows(filtered);
    filtered.forEach((d, i) => {
      const row = tbody.rows[i];
      if (row) { row.dataset.company=d.company; row.dataset.mrr=d.monthly_value; row.dataset.stage=d.status_label; row.dataset.age=d.age_days; }
    });
  });
}

/* ─── Tab 6: All Deals ─────────────────────────────────────────────────────── */
function renderMdTab6(data) {
  const el     = document.getElementById('md-tab6');
  const active = data.active_opportunities || [];
  const won    = data.won_opportunities    || [];
  const lost   = data.lost_opportunities   || [];
  const { fmt$, fmtDate, escHtml, exportCsv, makeSortable } = _mu;

  const all = [
    ...active.map(d => ({ ...d, _type: 'active' })),
    ...won.map(d    => ({ ...d, _type: 'won' })),
    ...lost.map(d   => ({ ...d, _type: 'lost' })),
  ];

  const owners = [...new Set(all.map(d => d.owner).filter(Boolean))].sort();
  const ownerOpts = ['<option value="">All Owners</option>',
    ...owners.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`)].join('');

  function buildRows(deals) {
    return deals.map(d => {
      const typeBadge = d._type === 'won' ? '<span class="badge green">Won</span>'
                      : d._type === 'lost' ? '<span class="badge red">Lost</span>'
                      : '<span class="badge blue">Active</span>';
      return `<tr data-company="${escHtml(d.company)}" data-mrr="${d.monthly_value}" data-stage="${escHtml(d.status_label)}" data-owner="${escHtml(d.owner)}">
        <td>${escHtml(d.company)}</td>
        <td class="num mrr-cell">${fmt$(d.monthly_value)}/mo</td>
        <td>${typeBadge}</td>
        <td>${escHtml(d.status_label)}</td>
        <td>${escHtml(d.owner)}</td>
        <td>${fmtDate(d.date_updated)}</td>
      </tr>`;
    }).join('');
  }

  function applyFilters() {
    const typeF  = document.getElementById('md-tab6-type').value;
    const ownerF = document.getElementById('md-tab6-owner').value;
    const minMrr = parseFloat(document.getElementById('md-tab6-minmrr').value) || 0;
    let filtered = all;
    if (typeF)  filtered = filtered.filter(d => d._type === typeF);
    if (ownerF) filtered = filtered.filter(d => d.owner === ownerF);
    if (minMrr) filtered = filtered.filter(d => d.monthly_value >= minMrr);
    document.getElementById('md-tab6-tbody').innerHTML = buildRows(filtered);
    document.getElementById('md-tab6-count').textContent = `${filtered.length} deals · ${fmt$(filtered.reduce((s,d)=>s+d.monthly_value,0))}/mo total`;
    return filtered;
  }

  el.innerHTML = `
    <div class="filters-row">
      <span class="filter-label">Type:</span>
      <select class="filter-select" id="md-tab6-type">
        <option value="">All</option>
        <option value="active">Active</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
      <span class="filter-label">Owner:</span>
      <select class="filter-select" id="md-tab6-owner">${ownerOpts}</select>
      <span class="filter-label">Min MRR:</span>
      <input class="filter-input" id="md-tab6-minmrr" type="number" placeholder="0" style="width:90px">
      <button class="export-btn" id="md-tab6-export">Export CSV</button>
      <span id="md-tab6-count" style="font-size:12px;color:var(--gray);margin-left:auto"></span>
    </div>
    <div class="card"><div class="table-wrap">
      <table class="data-table" id="md-tab6-table">
        <thead><tr>
          <th class="sortable" data-col="company">Company</th>
          <th class="sortable num" data-col="mrr" data-type="num">MRR</th>
          <th>Status</th>
          <th class="sortable" data-col="stage">Stage</th>
          <th class="sortable" data-col="owner">Owner</th>
          <th>Last Updated</th>
        </tr></thead>
        <tbody id="md-tab6-tbody">${buildRows(all)}</tbody>
      </table>
    </div></div>
  `;

  applyFilters();
  makeSortable(document.getElementById('md-tab6-table'));
  ['md-tab6-type','md-tab6-owner','md-tab6-minmrr'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('md-tab6-minmrr').addEventListener('input', applyFilters);
  document.getElementById('md-tab6-export').addEventListener('click', () => {
    const filtered = applyFilters();
    exportCsv(filtered.map(d => ({
      Company: d.company, MRR: d.monthly_value, Type: d._type,
      Stage: d.status_label, Owner: d.owner, Updated: d.date_updated,
    })), 'messagedesk-deals.csv');
  });
}
