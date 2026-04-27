/* ─── MessageDesk Tab Router ───────────────────────────────────────────────── */
function renderMdTab(tabId, data) {
  switch (tabId) {
    case 'md-tab1': renderMdTab1(data); break;
    case 'md-tab2': renderMdTab2(data); break;
    case 'md-tab3': renderMdTab3(data); break;
    case 'md-tab4': renderMdTab4(data); break;
    case 'md-tab5': renderMdTab5(data); break;
    case 'md-tab6': renderMdTab6(data); break;
  }
}

/* ─── Tab 1: Active Pipeline ───────────────────────────────────────────────── */
function renderMdTab1(data) {
  const { fmt$, escHtml } = window.ParasolUtils;
  const el  = document.getElementById('md-tab1');
  const k   = data.kpis;
  const active = data.active_opportunities || [];

  // Group by status
  const groups = {};
  for (const d of active) {
    if (!groups[d.status_label]) groups[d.status_label] = [];
    groups[d.status_label].push(d);
  }

  let stageCards = '';
  for (const [stage, deals] of Object.entries(groups).sort((a,b) => {
    const mrrA = a[1].reduce((s,d)=>s+d.monthly_value,0);
    const mrrB = b[1].reduce((s,d)=>s+d.monthly_value,0);
    return mrrB - mrrA;
  })) {
    const totalMrr = deals.reduce((s,d) => s+d.monthly_value, 0);
    const id = 'md-stage-' + stage.replace(/\W+/g,'_');
    let rows = '';
    for (const d of deals.sort((a,b) => b.monthly_value - a.monthly_value)) {
      rows += `<tr>
        <td>${escHtml(d.company)}</td>
        <td class="num mrr-cell">${fmt$(d.monthly_value)}/mo</td>
        <td>${escHtml(d.owner)}</td>
        <td>${d.a2p_stage ? 'Stage ' + d.a2p_stage : '—'}</td>
        <td class="num">${d.age_days}d</td>
        <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(d.note)}</td>
      </tr>`;
    }
    stageCards += `
    <div class="card">
      <div class="card-header" onclick="toggleCard('${id}')">
        <div class="card-header-left">
          <span class="stage-name">${escHtml(stage)}</span>
          <span class="stage-count">${deals.length}</span>
        </div>
        <div class="card-header-right">
          <span class="stage-mrr">${fmt$(totalMrr)}/mo</span>
          <span class="chevron" id="${id}-chev">▼</span>
        </div>
      </div>
      <div class="card-body" id="${id}">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Company</th><th class="num">MRR</th><th>Owner</th>
              <th>A2P Stage</th><th class="num">Age</th><th>Note</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Pipeline MRR</div><div class="kpi-value red">${fmt$(k.pipeline_mrr)}</div><div class="kpi-sub">monthly</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Deals</div><div class="kpi-value">${k.active_deals}</div></div>
      <div class="kpi-card"><div class="kpi-label">Won MRR</div><div class="kpi-value green">${fmt$(k.won_mrr)}</div><div class="kpi-sub">monthly</div></div>
      <div class="kpi-card"><div class="kpi-label">Win Rate</div><div class="kpi-value blue">${k.win_rate}%</div></div>
    </div>
    <div class="section-header"><div class="section-title">Active Pipeline by Stage</div></div>
    ${stageCards || '<div class="empty-state"><div class="icon">📋</div><div class="msg">No active deals</div></div>'}
  `;
}

window.toggleCard = function(id) {
  const body = document.getElementById(id);
  const chev = document.getElementById(id + '-chev');
  if (!body) return;
  body.classList.toggle('open');
  if (chev) chev.classList.toggle('open');
};

/* ─── Tab 2: Funnel Overview ───────────────────────────────────────────────── */
function renderMdTab2(data) {
  const { fmt$, escHtml } = window.ParasolUtils;
  const el  = document.getElementById('md-tab2');
  const pbs = data.pipeline_by_status || {};
  const won = data.won_opportunities  || [];
  const lost= data.lost_opportunities || [];
  const active = data.active_opportunities || [];

  const allMrr = [...active, ...won].reduce((s,d) => s+d.monthly_value, 0);
  const maxMrr = Math.max(...Object.values(pbs).map(v=>v.mrr), 1);

  let funnelRows = '';
  for (const [stage, v] of Object.entries(pbs).sort((a,b) => b[1].mrr - a[1].mrr)) {
    const pct = Math.round(v.mrr / maxMrr * 100);
    funnelRows += `
      <div class="funnel-row">
        <div class="funnel-label" title="${escHtml(stage)}">${escHtml(stage)}</div>
        <div class="funnel-bar-track"><div class="funnel-bar-fill blue" style="width:${pct}%"></div></div>
        <div class="funnel-count">${v.count} deal${v.count !== 1 ? 's' : ''}</div>
        <div class="funnel-val">${fmt$(v.mrr)}/mo</div>
      </div>`;
  }

  // MRR by month chart
  const mbm = data.mrr_by_month || {};
  const months = Object.keys(mbm).sort().slice(-6);
  const maxM = Math.max(...months.map(m => mbm[m]), 1);
  let bars = '';
  for (const m of months) {
    const h = Math.round(mbm[m] / maxM * 100);
    const label = m.slice(5); // MM
    bars += `<div class="bar-col">
      <div class="bar-val">${mbm[m] > 0 ? fmt$(mbm[m]) : ''}</div>
      <div class="bar-fill red" style="height:${h}%"></div>
      <div class="bar-label">${label}</div>
    </div>`;
  }

  const wonMrr  = won.reduce((s,d) => s+d.monthly_value, 0);
  const lostMrr = lost.reduce((s,d) => s+d.monthly_value, 0);

  el.innerHTML = `
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Active Pipeline</div><div class="value" style="color:var(--blue)">${fmt$(active.reduce((s,d)=>s+d.monthly_value,0))}</div></div>
      <div class="stat-box"><div class="label">Won MRR (total)</div><div class="value" style="color:var(--green)">${fmt$(wonMrr)}</div></div>
      <div class="stat-box"><div class="label">Lost Deals</div><div class="value" style="color:var(--red)">${lost.length}</div></div>
      <div class="stat-box"><div class="label">Active Deals</div><div class="value">${active.length}</div></div>
    </div>
    <div class="section-header"><div class="section-title">Pipeline by Stage</div></div>
    <div class="card" style="padding:20px;margin-bottom:24px">${funnelRows || '<div class="empty-state"><div class="msg">No pipeline data</div></div>'}</div>
    <div class="chart-wrap">
      <div class="chart-title">Won MRR by Month (last 6 months)</div>
      <div class="bar-chart">${bars}</div>
    </div>
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Won Deals</div><div class="value" style="color:var(--green)">${won.length}</div></div>
      <div class="stat-box"><div class="label">Won MRR</div><div class="value" style="color:var(--green)">${fmt$(wonMrr)}</div></div>
      <div class="stat-box"><div class="label">Lost Deals</div><div class="value" style="color:var(--red)">${lost.length}</div></div>
    </div>
  `;
}

/* ─── Tab 3: Meetings Next Week ────────────────────────────────────────────── */
function renderMdTab3(data) {
  const { fmt$, fmtDate, escHtml, isNextWeek } = window.ParasolUtils;
  const el     = document.getElementById('md-tab3');
  const active = data.active_opportunities || [];

  const upcoming = active.filter(d => {
    const updated = d.date_updated;
    return isNextWeek(updated);
  });

  let rows = '';
  for (const d of upcoming.sort((a,b) => new Date(a.date_updated) - new Date(b.date_updated))) {
    rows += `<tr>
      <td>${escHtml(d.company)}</td>
      <td class="num mrr-cell">${fmt$(d.monthly_value)}/mo</td>
      <td>${escHtml(d.owner)}</td>
      <td>${escHtml(d.status_label)}</td>
      <td>${fmtDate(d.date_updated)}</td>
    </tr>`;
  }

  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + diff);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const range = `${mon.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sun.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Deals Active Next Week</div>
      <div style="font-size:13px;color:var(--gray)">${range}</div>
    </div>
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Deals</div><div class="value">${upcoming.length}</div></div>
      <div class="stat-box"><div class="label">MRR in Motion</div><div class="value" style="color:var(--red)">${fmt$(upcoming.reduce((s,d)=>s+d.monthly_value,0))}</div></div>
    </div>
    ${upcoming.length ? `
    <div class="card"><div class="table-wrap"><table class="data-table">
      <thead><tr><th>Company</th><th class="num">MRR</th><th>Owner</th><th>Stage</th><th>Last Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>` : `
    <div class="empty-state"><div class="icon">📅</div><div class="msg">No deals updated next week</div></div>`}
  `;
}
