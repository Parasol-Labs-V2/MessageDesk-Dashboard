/* ─── Duet Tab Router ──────────────────────────────────────────────────────── */
function renderDuetTab(tabId, data) {
  switch (tabId) {
    case 'duet-tab1': renderDuetTab1(data); break;
    case 'duet-tab2': renderDuetTab2(data); break;
    case 'duet-tab3': renderDuetTab3(data); break;
    case 'duet-tab4': renderDuetTab4(data); break;
    case 'duet-tab5': renderDuetTab5(data); break;
    case 'duet-tab6': renderDuetTab6(data); break;
  }
}

const _du = window.ParasolUtils;

const DUET_ACTIVE_STAGES = new Set([
  'New / Not Yet Contacted','Attempting Contact','Parasol Engaged',
  'Meeting Booked','Meeting Held','Interest Confirmed','Diagnostic','LOI Sent',
]);
const DUET_WON_STAGE   = 'Enrolled / Won';
const DUET_LOST_STAGES = new Set(['Not Interested / Lost','Not Relevant / DQ','Come Back To']);

function duetStageColor(stage) {
  if (stage === DUET_WON_STAGE) return 'green';
  if (DUET_LOST_STAGES.has(stage)) return stage === 'Come Back To' ? 'yellow' : 'red';
  return 'blue';
}

function fmtLives(n) {
  if (!n) return '—';
  return Number(n).toLocaleString();
}
function fmtSavings(n) {
  if (!n) return '—';
  return _du.fmt$(n);
}

/* ─── Tab 1: Active Pipeline ───────────────────────────────────────────────── */
function renderDuetTab1(data) {
  const el    = document.getElementById('duet-tab1');
  const deals = (data.deals || []).filter(d => DUET_ACTIVE_STAGES.has(d.stage));
  const { fmt$, fmtDate, escHtml } = _du;

  const totalLives   = deals.reduce((s,d) => s + d.lives, 0);
  const totalSavings = deals.reduce((s,d) => s + d.gross_savings, 0);
  const avgLives     = deals.length ? Math.round(totalLives / deals.length) : 0;

  // Group by stage
  const groups = {};
  for (const d of deals) {
    if (!groups[d.stage]) groups[d.stage] = [];
    groups[d.stage].push(d);
  }

  const stageOrder = ['New / Not Yet Contacted','Attempting Contact','Parasol Engaged',
    'Meeting Booked','Meeting Held','Interest Confirmed','Diagnostic','LOI Sent'];

  let stageCards = '';
  for (const stage of stageOrder) {
    const grp = groups[stage];
    if (!grp || !grp.length) continue;
    const tLives   = grp.reduce((s,d) => s+d.lives, 0);
    const tSavings = grp.reduce((s,d) => s+d.gross_savings, 0);
    const id = 'duet-stage-' + stage.replace(/\W+/g,'_');
    let rows = '';
    for (const d of grp.sort((a,b) => b.lives - a.lives)) {
      rows += `<tr>
        <td>${escHtml(d.dealname)}</td>
        <td class="num">${fmtLives(d.lives)}</td>
        <td class="num">${fmtSavings(d.gross_savings)}</td>
        <td>${escHtml(d.owner)}</td>
        <td>${fmtDate(d.last_outreach)}</td>
        <td class="num">${d.outreach_attempts || 0}</td>
      </tr>`;
    }
    stageCards += `
    <div class="card">
      <div class="card-header" onclick="toggleCard('${id}')">
        <div class="card-header-left">
          <span class="stage-name">${escHtml(stage)}</span>
          <span class="stage-count">${grp.length}</span>
        </div>
        <div class="card-header-right">
          <span style="font-size:13px;color:var(--blue);font-weight:700">${fmtLives(tLives)} lives</span>
          <span style="font-size:12px;color:var(--gray)">${fmtSavings(tSavings)}</span>
          <span class="chevron" id="${id}-chev">▼</span>
        </div>
      </div>
      <div class="card-body" id="${id}">
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>Practice Name</th><th class="num">Lives</th><th class="num">Gross Savings</th>
            <th>Owner</th><th>Last Outreach</th><th class="num">Attempts</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    </div>`;
  }

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Active Lives</div><div class="kpi-value blue">${fmtLives(totalLives)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Deals</div><div class="kpi-value">${deals.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Gross Savings</div><div class="kpi-value green">${fmtSavings(totalSavings)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Lives / Deal</div><div class="kpi-value">${fmtLives(avgLives)}</div></div>
    </div>
    <div class="section-header"><div class="section-title">Active Pipeline by Stage</div></div>
    ${stageCards || '<div class="empty-state"><div class="icon">📋</div><div class="msg">No active deals</div></div>'}
  `;
}

/* ─── Tab 2: Funnel Overview ───────────────────────────────────────────────── */
function renderDuetTab2(data) {
  const el    = document.getElementById('duet-tab2');
  const deals = data.deals || [];
  const { escHtml } = _du;

  const allStages = [
    'New / Not Yet Contacted','Attempting Contact','Parasol Engaged',
    'Meeting Booked','Meeting Held','Interest Confirmed','Diagnostic','LOI Sent',
    'Enrolled / Won','Not Interested / Lost','Come Back To','Not Relevant / DQ',
  ];

  const byStage = {};
  for (const d of deals) {
    if (!byStage[d.stage]) byStage[d.stage] = { count:0, lives:0, savings:0 };
    byStage[d.stage].count++;
    byStage[d.stage].lives   += d.lives;
    byStage[d.stage].savings += d.gross_savings;
  }

  const totalLives = deals.reduce((s,d) => s+d.lives, 0);
  const maxLives   = Math.max(...allStages.map(s => (byStage[s]||{}).lives||0), 1);

  let funnelRows = '';
  for (const stage of allStages) {
    const v   = byStage[stage] || { count:0, lives:0 };
    const pct = Math.round(v.lives / maxLives * 100);
    const pctTotal = totalLives ? Math.round(v.lives / totalLives * 100) : 0;
    const color = duetStageColor(stage);
    funnelRows += `
      <div class="funnel-row">
        <div class="funnel-label" title="${escHtml(stage)}">${escHtml(stage)}</div>
        <div class="funnel-bar-track"><div class="funnel-bar-fill ${color}" style="width:${pct}%"></div></div>
        <div class="funnel-count">${v.count} deal${v.count!==1?'s':''} · ${pctTotal}%</div>
        <div class="funnel-val">${fmtLives(v.lives)} lives</div>
      </div>`;
  }

  // Conversion rates
  const contacted   = deals.filter(d => d.stage !== 'New / Not Yet Contacted').length;
  const meetings    = deals.filter(d => ['Meeting Booked','Meeting Held','Interest Confirmed','Diagnostic','LOI Sent','Enrolled / Won'].includes(d.stage)).length;
  const lois        = deals.filter(d => ['LOI Sent','Enrolled / Won'].includes(d.stage)).length;
  const enrolled    = deals.filter(d => d.stage === DUET_WON_STAGE).length;
  const totalDeals  = deals.length || 1;
  const contactRate = Math.round(contacted / totalDeals * 100);
  const meetingRate = Math.round(meetings  / totalDeals * 100);
  const loiRate     = Math.round(lois      / totalDeals * 100);
  const winRate     = Math.round(enrolled  / totalDeals * 100);

  const enrolledLives = deals.filter(d => d.stage === DUET_WON_STAGE).reduce((s,d) => s+d.lives, 0);
  const activeLives   = deals.filter(d => DUET_ACTIVE_STAGES.has(d.stage)).reduce((s,d) => s+d.lives, 0);

  el.innerHTML = `
    <div class="conv-grid">
      <div class="conv-card"><div class="conv-rate">${contactRate}%</div><div class="conv-label">Contact Rate</div></div>
      <div class="conv-card"><div class="conv-rate">${meetingRate}%</div><div class="conv-label">Meeting Rate</div></div>
      <div class="conv-card"><div class="conv-rate">${loiRate}%</div><div class="conv-label">LOI Rate</div></div>
      <div class="conv-card"><div class="conv-rate">${winRate}%</div><div class="conv-label">Win Rate</div></div>
    </div>
    <div class="section-header"><div class="section-title">Pipeline by Stage (all 12)</div></div>
    <div class="card" style="padding:20px;margin-bottom:24px">${funnelRows}</div>
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Prospect Lives</div><div class="value" style="color:var(--blue)">${fmtLives(activeLives)}</div></div>
      <div class="stat-box"><div class="label">Enrolled Lives</div><div class="value" style="color:var(--green)">${fmtLives(enrolledLives)}</div></div>
      <div class="stat-box"><div class="label">Total Deals</div><div class="value">${deals.length}</div></div>
    </div>
  `;
}

/* ─── Tab 3: Meetings Next Week ────────────────────────────────────────────── */
function renderDuetTab3(data) {
  const el    = document.getElementById('duet-tab3');
  const deals = data.deals || [];
  const { isNextWeek, isPast14Days, fmtDate, escHtml } = _du;

  const upcoming = deals.filter(d => isNextWeek(d.meeting_date))
                        .sort((a,b) => new Date(a.meeting_date)-new Date(b.meeting_date));
  const recent   = deals.filter(d => d.meeting_date && isPast14Days(d.meeting_date) && !isNextWeek(d.meeting_date))
                        .sort((a,b) => new Date(b.meeting_date)-new Date(a.meeting_date));

  function meetingRow(d) {
    return `<tr>
      <td>${escHtml(d.dealname)}</td>
      <td>${fmtDate(d.meeting_date)}</td>
      <td>${escHtml(d.owner)}</td>
      <td class="num">${fmtLives(d.lives)}</td>
      <td>${escHtml(d.stage)}</td>
      <td>${escHtml(d.champion_name)}</td>
      <td>${escHtml(d.champion_role)}</td>
    </tr>`;
  }

  const thead = `<thead><tr>
    <th>Practice Name</th><th>Meeting Date</th><th>Owner</th>
    <th class="num">Lives</th><th>Stage</th><th>Champion</th><th>Role</th>
  </tr></thead>`;

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title">Meetings Next Week</div>
    </div>
    <div class="stat-boxes">
      <div class="stat-box"><div class="label">Upcoming</div><div class="value">${upcoming.length}</div></div>
      <div class="stat-box"><div class="label">Lives</div><div class="value" style="color:var(--blue)">${fmtLives(upcoming.reduce((s,d)=>s+d.lives,0))}</div></div>
    </div>
    ${upcoming.length ? `
    <div class="card"><div class="table-wrap"><table class="data-table">${thead}
      <tbody>${upcoming.map(meetingRow).join('')}</tbody>
    </table></div></div>` : '<div class="empty-state"><div class="icon">📅</div><div class="msg">No meetings next week</div></div>'}
    ${recent.length ? `
    <div class="section-header" style="margin-top:24px"><div class="section-title">Recent Meetings (Past 14 Days)</div></div>
    <div class="card"><div class="table-wrap"><table class="data-table">${thead}
      <tbody>${recent.map(meetingRow).join('')}</tbody>
    </table></div></div>` : ''}
  `;
}
