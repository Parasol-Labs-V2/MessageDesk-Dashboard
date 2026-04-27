window.renderMdTab = function(tabName, data) {
  var fmt$       = window.ParasolUtils.fmt$;
  var fmtDate    = window.ParasolUtils.fmtDate;
  var escHtml    = window.ParasolUtils.escHtml;
  var isNextWeek = window.ParasolUtils.isNextWeek;
  var isLast7Days = window.ParasolUtils.isLast7Days;

  // ── Tab 1: Active Pipeline ──────────────────────────────────────────────────
  function renderTab1() {
    var el     = document.getElementById('md-tab1');
    var k      = data.kpis;
    var active = data.active_opportunities || [];

    var groups = {};
    for (var i = 0; i < active.length; i++) {
      var d = active[i];
      if (!groups[d.status_label]) groups[d.status_label] = [];
      groups[d.status_label].push(d);
    }

    var stages = Object.keys(groups).sort(function(a, b) {
      var mA = groups[a].reduce(function(s, x) { return s + x.monthly_value; }, 0);
      var mB = groups[b].reduce(function(s, x) { return s + x.monthly_value; }, 0);
      return mB - mA;
    });

    var stageCards = '';
    for (var si = 0; si < stages.length; si++) {
      var stage   = stages[si];
      var deals   = groups[stage].slice().sort(function(a, b) { return b.monthly_value - a.monthly_value; });
      var totalMrr = deals.reduce(function(s, x) { return s + x.monthly_value; }, 0);
      var id      = 'md-stage-' + stage.replace(/\W+/g, '_');
      var rows    = '';
      for (var di = 0; di < deals.length; di++) {
        var deal = deals[di];
        rows += '<tr>' +
          '<td>' + escHtml(deal.company) + '</td>' +
          '<td class="num mrr-cell">' + fmt$(deal.monthly_value) + '/mo</td>' +
          '<td>' + escHtml(deal.owner) + '</td>' +
          '<td>' + (deal.a2p_stage ? 'Stage ' + deal.a2p_stage : '—') + '</td>' +
          '<td class="num">' + deal.age_days + 'd</td>' +
          '<td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(deal.note) + '</td>' +
          '</tr>';
      }
      stageCards +=
        '<div class="card">' +
          '<div class="card-header" onclick="window.toggleCard(\'' + id + '\')">' +
            '<div class="card-header-left">' +
              '<span class="stage-name">' + escHtml(stage) + '</span>' +
              '<span class="stage-count">' + deals.length + '</span>' +
            '</div>' +
            '<div class="card-header-right">' +
              '<span class="stage-mrr">' + fmt$(totalMrr) + '/mo</span>' +
              '<span class="chevron" id="' + id + '-chev">▼</span>' +
            '</div>' +
          '</div>' +
          '<div class="card-body" id="' + id + '">' +
            '<div class="table-wrap"><table class="data-table">' +
              '<thead><tr><th>Company</th><th class="num">MRR</th><th>Owner</th>' +
              '<th>A2P Stage</th><th class="num">Age</th><th>Note</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table></div>' +
          '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<div class="kpi-grid">' +
        '<div class="kpi-card"><div class="kpi-label">Pipeline MRR</div><div class="kpi-value red">' + fmt$(k.pipeline_mrr) + '</div><div class="kpi-sub">monthly</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">Active Deals</div><div class="kpi-value">' + k.active_deals + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">Won MRR</div><div class="kpi-value green">' + fmt$(k.won_mrr) + '</div><div class="kpi-sub">monthly</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">Win Rate</div><div class="kpi-value blue">' + k.win_rate + '%</div></div>' +
      '</div>' +
      '<div class="section-header"><div class="section-title">Active Pipeline by Stage</div></div>' +
      (stageCards || '<div class="empty-state"><div class="icon">📋</div><div class="msg">No active deals</div></div>');
  }

  // ── Tab 2: Funnel Overview ──────────────────────────────────────────────────
  function renderTab2() {
    var el     = document.getElementById('md-tab2');
    var pbs    = data.pipeline_by_status || {};
    var won    = data.won_opportunities  || [];
    var lost   = data.lost_opportunities || [];
    var active = data.active_opportunities || [];

    var pbsVals = Object.values(pbs);
    var maxMrr  = pbsVals.length ? Math.max.apply(null, pbsVals.map(function(v) { return v.mrr; })) : 1;
    if (maxMrr < 1) maxMrr = 1;

    var pbsEntries = Object.keys(pbs).sort(function(a, b) { return pbs[b].mrr - pbs[a].mrr; });
    var funnelRows = '';
    for (var fi = 0; fi < pbsEntries.length; fi++) {
      var stage = pbsEntries[fi];
      var v     = pbs[stage];
      var pct   = Math.round(v.mrr / maxMrr * 100);
      funnelRows +=
        '<div class="funnel-row">' +
          '<div class="funnel-label" title="' + escHtml(stage) + '">' + escHtml(stage) + '</div>' +
          '<div class="funnel-bar-track"><div class="funnel-bar-fill blue" style="width:' + pct + '%"></div></div>' +
          '<div class="funnel-count">' + v.count + ' deal' + (v.count !== 1 ? 's' : '') + '</div>' +
          '<div class="funnel-val">' + fmt$(v.mrr) + '/mo</div>' +
        '</div>';
    }

    var mbm    = data.mrr_by_month || {};
    var months = Object.keys(mbm).sort().slice(-6);
    var maxM   = months.length ? Math.max.apply(null, months.map(function(m) { return mbm[m]; })) : 1;
    if (maxM < 1) maxM = 1;
    var bars = '';
    for (var mi = 0; mi < months.length; mi++) {
      var m = months[mi];
      var h = Math.round(mbm[m] / maxM * 100);
      bars +=
        '<div class="bar-col">' +
          '<div class="bar-val">' + (mbm[m] > 0 ? fmt$(mbm[m]) : '') + '</div>' +
          '<div class="bar-fill red" style="height:' + h + '%"></div>' +
          '<div class="bar-label">' + m.slice(5) + '</div>' +
        '</div>';
    }

    var wonMrr  = won.reduce(function(s, d) { return s + d.monthly_value; }, 0);
    var activeMrr = active.reduce(function(s, d) { return s + d.monthly_value; }, 0);

    el.innerHTML =
      '<div class="stat-boxes">' +
        '<div class="stat-box"><div class="label">Active Pipeline</div><div class="value" style="color:var(--blue)">' + fmt$(activeMrr) + '</div></div>' +
        '<div class="stat-box"><div class="label">Won MRR (total)</div><div class="value" style="color:var(--green)">' + fmt$(wonMrr) + '</div></div>' +
        '<div class="stat-box"><div class="label">Lost Deals</div><div class="value" style="color:var(--red)">' + lost.length + '</div></div>' +
        '<div class="stat-box"><div class="label">Active Deals</div><div class="value">' + active.length + '</div></div>' +
      '</div>' +
      '<div class="section-header"><div class="section-title">Pipeline by Stage</div></div>' +
      '<div class="card" style="padding:20px;margin-bottom:24px">' + (funnelRows || '<div class="empty-state"><div class="msg">No pipeline data</div></div>') + '</div>' +
      '<div class="chart-wrap">' +
        '<div class="chart-title">Won MRR by Month (last 6 months)</div>' +
        '<div class="bar-chart">' + bars + '</div>' +
      '</div>' +
      '<div class="stat-boxes">' +
        '<div class="stat-box"><div class="label">Won Deals</div><div class="value" style="color:var(--green)">' + won.length + '</div></div>' +
        '<div class="stat-box"><div class="label">Won MRR</div><div class="value" style="color:var(--green)">' + fmt$(wonMrr) + '</div></div>' +
        '<div class="stat-box"><div class="label">Lost Deals</div><div class="value" style="color:var(--red)">' + lost.length + '</div></div>' +
      '</div>';
  }

  // ── Tab 3: Meetings Next Week ───────────────────────────────────────────────
  function renderTab3() {
    var el     = document.getElementById('md-tab3');
    var active = data.active_opportunities || [];

    var upcoming = active.filter(function(d) { return isNextWeek(d.date_updated); })
                         .sort(function(a, b) { return new Date(a.date_updated) - new Date(b.date_updated); });

    var rows = '';
    for (var i = 0; i < upcoming.length; i++) {
      var d = upcoming[i];
      rows +=
        '<tr>' +
          '<td>' + escHtml(d.company) + '</td>' +
          '<td class="num mrr-cell">' + fmt$(d.monthly_value) + '/mo</td>' +
          '<td>' + escHtml(d.owner) + '</td>' +
          '<td>' + escHtml(d.status_label) + '</td>' +
          '<td>' + fmtDate(d.date_updated) + '</td>' +
        '</tr>';
    }

    var now  = new Date();
    var day  = now.getDay();
    var diff = day === 0 ? 1 : 8 - day;
    var mon  = new Date(now); mon.setDate(now.getDate() + diff);
    var sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    var range = mon.toLocaleDateString('en-US', {month:'short', day:'numeric'}) +
                ' – ' + sun.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    var mrrInMotion = upcoming.reduce(function(s, d) { return s + d.monthly_value; }, 0);

    el.innerHTML =
      '<div class="section-header">' +
        '<div class="section-title">Deals Active Next Week</div>' +
        '<div style="font-size:13px;color:var(--gray)">' + range + '</div>' +
      '</div>' +
      '<div class="stat-boxes">' +
        '<div class="stat-box"><div class="label">Deals</div><div class="value">' + upcoming.length + '</div></div>' +
        '<div class="stat-box"><div class="label">MRR in Motion</div><div class="value" style="color:var(--red)">' + fmt$(mrrInMotion) + '</div></div>' +
      '</div>' +
      (upcoming.length
        ? '<div class="card"><div class="table-wrap"><table class="data-table">' +
            '<thead><tr><th>Company</th><th class="num">MRR</th><th>Owner</th><th>Stage</th><th>Last Updated</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div></div>'
        : '<div class="empty-state"><div class="icon">📅</div><div class="msg">No deals updated next week</div></div>');
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────
  if (tabName === 'md-tab1') renderTab1();
  else if (tabName === 'md-tab2') renderTab2();
  else if (tabName === 'md-tab3') renderTab3();
  else if (tabName === 'md-tab4') window.renderMdTab4(data);
  else if (tabName === 'md-tab5') window.renderMdTab5(data);
  else if (tabName === 'md-tab6') window.renderMdTab6(data);
};

window.toggleCard = function(id) {
  var body = document.getElementById(id);
  var chev = document.getElementById(id + '-chev');
  if (!body) return;
  body.classList.toggle('open');
  if (chev) chev.classList.toggle('open');
};
