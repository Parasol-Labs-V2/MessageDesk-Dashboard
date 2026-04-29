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

  $('panel-4').innerHTML = `
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

  $('panel-5').innerHTML = `
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
// TAB 1 — Team Performance (CEO / founder view)
// ══════════════════════════════════════════════════════════════════════════════

async function renderTeamPerformance() {
  $('panel-1').innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span class="loading-text">Loading team performance…</span></div>`;

  let data;
  try {
    const res = await fetch('/api/team-performance');
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    data = await res.json();
  } catch (e) {
    $('panel-1').innerHTML = `<div class="error-box">⚠ Could not load team performance: ${esc(e.message)}</div>`;
    return;
  }

  const { owners, attention, summary, activity } = data;

  // ── helpers ──────────────────────────────────────────────────────────────────
  const AVATAR_COLORS = { 'Joe': '#1B9BF0', 'Lauren': '#F59E0B', 'Florencia': '#059669', 'Jonathan': '#7C3AED' };
  const DUET_ORDER    = ['Joe', 'Lauren', 'Florencia', 'Jonathan'];
  function ownerSortKey(name) {
    const i = DUET_ORDER.findIndex(k => name.includes(k));
    return i === -1 ? DUET_ORDER.length : i;
  }
  const sortedOwners = [...owners].sort((a, b) => ownerSortKey(a.owner) - ownerSortKey(b.owner));

  function avatarColor(name) {
    for (const [k, v] of Object.entries(AVATAR_COLORS)) if (name.includes(k)) return v;
    return '#6B7280';
  }
  function initials(name) { return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  function ownerHealth(o) {
    const pct = o.activeDeals > 0 ? (o.untouched / o.activeDeals) * 100 : 0;
    if (pct < 20) return { dot: '#22C55E', border: '#BBF7D0', bg: '#F0FDF4' };
    if (pct < 40) return { dot: '#F59E0B', border: '#FDE68A', bg: '#FFFBEB' };
    return { dot: '#EF4444', border: '#FECACA', bg: '#FEF2F2' };
  }
  function actionLine(o) {
    const pct = o.activeDeals > 0 ? (o.untouched / o.activeDeals) * 100 : 0;
    if (pct > 40) return `<div style="color:#DC2626;font-size:12px;font-weight:600;margin-top:10px;padding-top:10px;border-top:1px solid #FECACA">⚠️ ${o.untouched} account${o.untouched !== 1 ? 's' : ''} need first contact</div>`;
    if (o.callsThisWeek > 10) return `<div style="color:#059669;font-size:12px;font-weight:600;margin-top:10px;padding-top:10px;border-top:1px solid #BBF7D0">✅ Active this week — ${o.callsThisWeek} calls logged</div>`;
    if (o.lastActivity) {
      const days = Math.round((Date.now() - new Date(o.lastActivity).getTime()) / 86400000);
      if (days > 7) return `<div style="color:#D97706;font-size:12px;font-weight:600;margin-top:10px;padding-top:10px;border-top:1px solid #FDE68A">⚠️ No activity in ${days} days</div>`;
    }
    return `<div style="color:#6B7280;font-size:12px;margin-top:10px;padding-top:10px;border-top:1px solid #F3F4F6">On track</div>`;
  }

  // ── signal cards ──────────────────────────────────────────────────────────────
  const lives = summary.totalActiveLives;
  const livesH = lives >= 20000 ? { c:'#059669', bg:'#F0FDF4', b:'#BBF7D0', label:'🟢 Healthy' }
               : lives >= 10000 ? { c:'#D97706', bg:'#FFFBEB', b:'#FDE68A', label:'🟡 Building' }
               :                  { c:'#DC2626', bg:'#FEF2F2', b:'#FECACA', label:'🔴 Low' };

  const calls = (activity && activity.wtd && activity.wtd.calls) || 0;
  const callsH = calls >= 50 ? { c:'#059669', bg:'#F0FDF4', b:'#BBF7D0', label:'🟢 High Activity' }
               : calls >= 20  ? { c:'#D97706', bg:'#FFFBEB', b:'#FDE68A', label:'🟡 Moderate' }
               :                { c:'#DC2626', bg:'#FEF2F2', b:'#FECACA', label:'🔴 Low Activity' };

  const gap = summary.totalUntouched;
  const gapLabel = gap === 0 ? '🟢 All Contacted' : '🔴 Needs Action';

  function signalCard(bg, border, color, label, value, sub, badge) {
    return `<div style="flex:1;min-width:200px;background:${bg};border:1.5px solid ${border};border-radius:16px;padding:24px 26px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${color};opacity:.8;margin-bottom:6px">${label}</div>
      <div style="font-size:38px;font-weight:800;color:${color};line-height:1.1;margin-bottom:4px">${value}</div>
      <div style="font-size:13px;color:${color};opacity:.75;margin-bottom:12px">${sub}</div>
      <span style="display:inline-block;background:${color}22;color:${color};padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700">${badge}</span>
    </div>`;
  }

  // ── owner cards ───────────────────────────────────────────────────────────────
  const ownerCards = sortedOwners.map(o => {
    const ac = avatarColor(o.owner);
    const h  = ownerHealth(o);
    const uc = o.untouched > 0 ? '#DC2626' : '#6B7280';
    return `<div class="tp-owner-card" data-owner="${esc(o.owner)}" style="background:#fff;border:1.5px solid ${h.border};border-radius:14px;padding:20px;flex:1;min-width:210px;max-width:300px;cursor:pointer;transition:box-shadow .15s" onmouseenter="this.style.boxShadow='0 4px 16px rgba(0,0,0,.10)'" onmouseleave="this.style.boxShadow=''" onclick="filterAllDealsByOwner('${esc(o.owner)}')">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="width:40px;height:40px;border-radius:50%;background:${ac};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0">${initials(o.owner)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.owner)}</div>
          <div style="font-size:12px;color:#6B7280">${o.activeDeals} active · ${o.totalDeals} total</div>
        </div>
        <div title="${Math.round(o.activeDeals > 0 ? (o.untouched/o.activeDeals)*100 : 0)}% untouched" style="width:14px;height:14px;border-radius:50%;background:${h.dot};box-shadow:0 0 0 3px ${h.border};flex-shrink:0"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
        <div style="background:#F8FAFC;border-radius:8px;padding:10px 12px">
          <div style="font-size:20px;font-weight:800;color:#111;line-height:1">${o.activeDeals}</div>
          <div style="font-size:11px;color:#6B7280;margin-top:3px">Active Deals</div>
        </div>
        <div style="background:#F8FAFC;border-radius:8px;padding:10px 12px">
          <div style="font-size:20px;font-weight:800;color:#111;line-height:1">${fmtLives(o.activeLives)}</div>
          <div style="font-size:11px;color:#6B7280;margin-top:3px">Active Lives</div>
        </div>
        <div style="background:#F8FAFC;border-radius:8px;padding:10px 12px">
          <div style="font-size:20px;font-weight:800;color:${uc};line-height:1">${o.untouched}</div>
          <div style="font-size:11px;color:#6B7280;margin-top:3px">Untouched</div>
        </div>
        <div style="background:#F8FAFC;border-radius:8px;padding:10px 12px">
          <div style="font-size:20px;font-weight:800;color:#1B9BF0;line-height:1">${o.callsThisWeek}</div>
          <div style="font-size:11px;color:#6B7280;margin-top:3px">Calls (7d)</div>
        </div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#9CA3AF;margin-bottom:5px">
          <span>Pipeline share</span><span style="font-weight:600;color:#374151">${o.pipelinePct}%</span>
        </div>
        <div style="height:6px;background:#E5E7EB;border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${Math.min(o.pipelinePct, 100)}%;background:${ac};border-radius:99px"></div>
        </div>
      </div>
      ${actionLine(o)}
    </div>`;
  }).join('');

  // ── attention table ───────────────────────────────────────────────────────────
  const neglected = (attention || [])
    .filter(d => d.outreachAttempts === 0 && d.createDate && (Date.now() - new Date(d.createDate).getTime()) / 86400000 > 14)
    .filter(d => !d.owner.includes('Jonathan'))
    .slice(0, 10);

  const attRows = neglected.map(d => {
    const ageDays = d.createDate ? Math.round((Date.now() - new Date(d.createDate).getTime()) / 86400000) : '—';
    const status  = `<span style="background:#FEE2E2;color:#DC2626;padding:2px 8px;border-radius:5px;font-size:12px;font-weight:600">Never Contacted</span>`;
    return `<tr style="cursor:pointer" onclick="filterAllDealsByOwner('${esc(d.owner)}')" title="Filter to ${esc(d.owner)}">
      <td class="col-name">${esc(d.dealname)}</td>
      <td>${esc(d.owner)}</td>
      <td class="col-num">${fmtLives(d.lives)}</td>
      <td>${stageBadge(d.stageId, d.stage)}</td>
      <td class="col-num">${ageDays}d</td>
      <td>${status}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="padding:18px 16px;color:#6B7280;text-align:center">No neglected accounts — team is on it ✅</td></tr>`;

  // ── render ────────────────────────────────────────────────────────────────────
  $('panel-1').innerHTML = `
    <style>
      .tp-section-hdr{display:flex;align-items:center;gap:10px;margin:28px 0 12px}
      .tp-section-title{font-size:16px;font-weight:700;color:#111}
      .tp-owners-wrap{display:flex;gap:16px;flex-wrap:wrap}
      .tp-view-btn{margin-left:auto;padding:5px 14px;border:1.5px solid #E5E7EB;border-radius:7px;background:#fff;cursor:pointer;font-size:12px;font-weight:600;color:#374151}
      .tp-view-btn:hover{background:#F3F4F6}
      @media(max-width:640px){.tp-signal-row,.tp-owners-wrap{flex-direction:column}.tp-owner-card{max-width:unset!important}}
    </style>

    <div class="tp-signal-row" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:4px">
      ${signalCard(livesH.bg, livesH.b, livesH.c, 'Pipeline Health', fmtLives(lives), 'active lives in pipeline', livesH.label)}
      ${signalCard('#FEF2F2','#FECACA','#DC2626','Outreach Gap', String(gap), 'accounts waiting for first contact', gapLabel)}
      ${signalCard(callsH.bg, callsH.b, callsH.c, "This Week's Activity", `<span style="font-size:26px">${calls} <span style="font-size:18px;font-weight:600">calls</span> · ${summary.totalNotesThisWeek} <span style="font-size:18px;font-weight:600">notes</span></span>`, 'logged this week', callsH.label)}
    </div>

    <div class="tp-section-hdr">
      <div class="tp-section-title">Owner Performance</div>
      <div style="font-size:12px;color:#9CA3AF">Click any card to view their deals in All Deals tab</div>
    </div>
    <div class="tp-owners-wrap">${ownerCards}</div>

    <div class="tp-section-hdr">
      <div class="tp-section-title">🚨 Needs Attention</div>
      <div style="font-size:12px;color:#9CA3AF">Never contacted · older than 14 days · ${neglected.length} account${neglected.length !== 1 ? 's' : ''} · Parasol team only</div>
      <span title="'Never Contacted' = deals where outreach_attempt_count = 0 in HubSpot. Jonathan's accounts excluded (not Parasol team)." style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#E5E7EB;color:#6B7280;font-size:11px;font-weight:700;cursor:help;flex-shrink:0">?</span>
      <button class="tp-view-btn" onclick="filterAllDealsByOwner('')">View All Deals →</button>
    </div>
    <div class="table-wrap"><div class="tscroll">
      <table class="deal-table">
        <thead><tr>
          <th>Practice</th><th>Owner</th>
          <th class="col-num">Lives</th><th>Stage</th>
          <th class="col-num">Days Old</th><th>Status</th>
        </tr></thead>
        <tbody>${attRows}</tbody>
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
