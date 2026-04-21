require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const API_KEY  = process.env.CLOSE_API_KEY || '';
const PARASOL_PIPELINE_ID = 'pipe_1lXFBvtVQXtRgcjonTFr1Y';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory state ───────────────────────────────────────────────────────────
let _cache = null;

const fetchStatus = {
  status:     'idle',   // 'idle' | 'fetching' | 'ready' | 'error'
  fetched:    0,
  total:      0,
  pct:        0,
  error:      null,
  started_at: null,
};

// ─── Auth ──────────────────────────────────────────────────────────────────────
function authHeaders() {
  return { Authorization: `Basic ${Buffer.from(API_KEY + ':').toString('base64')}` };
}

// ─── Stage mapping ─────────────────────────────────────────────────────────────
const STAGE_MAP = {
  'Champion Confirmed':         'Champion Confirmed',
  'Active Evaluation':          'Active Evaluation',
  'Meeting Scheduled':          'Meeting Scheduled',
  'Closed Won':                 'Closed Won',
  'Closed Lost - No Showed':    'No Showed',
  'Closed Lost - No Decision':  'No Decision',
  'Closed Lost - Timing':       'Timing',
  'Closed Lost - Mass Texting': 'Mass Texting',
  'Registration Pending':       'Registration Pending',
  'Typeform Reg App Submitted': 'Typeform Reg App Submitted',
  'Website Changes Needed':     'Website Changes Needed',
  'Account Created':            'Account Created',
  'MQLs':                       'MQLs',
  'Registration Approved':      'Registration Approved',
};
const ACTIVE_STAGES     = new Set(['Champion Confirmed','Active Evaluation','Meeting Scheduled','MQLs']);
const ONBOARDING_STAGES = new Set(['Registration Pending','Typeform Reg App Submitted','Website Changes Needed','Account Created','Registration Approved']);

function getCategory(stage) {
  if (ACTIVE_STAGES.has(stage))     return 'active';
  if (ONBOARDING_STAGES.has(stage)) return 'onboarding';
  if (stage === 'Closed Won')       return 'won';
  return 'lost';
}

function toMonthly(opp) {
  // Primary: value field is in cents — divide by 100
  if (opp.value !== null && opp.value !== undefined && opp.value !== '') {
    const dollars = parseFloat(opp.value) / 100;
    const freq = (opp.value_period || '').toLowerCase();
    if (freq === 'annual')                          return dollars / 12;
    if (freq === 'one_time' || freq === 'one-time') return 0;
    return dollars;
  }
  // Fallback: parse value_formatted e.g. "$39 monthly" or "$2,900 monthly"
  if (opp.value_formatted) {
    const m = opp.value_formatted.replace(/,/g, '').match(/\$?([\d.]+)/);
    if (m) {
      const v    = parseFloat(m[1]);
      const freq = (opp.value_period || '').toLowerCase();
      if (freq === 'annual')                          return v / 12;
      if (freq === 'one_time' || freq === 'one-time') return 0;
      return v;
    }
  }
  return 0;
}

// ─── Custom field detection ────────────────────────────────────────────────────
// Pipeline Review values look like: "🟡 Awaiting..." / "🔴 Blocked..." / "✅ ..."
const PR_EMOJI_RE  = /^[🟡🔴🟢✅⚠️🔵⚪]/u;
const PR_KEYWORD_RE = /awaiting|blocked by|next step|follow.?up|pending|waiting/i;

let _fields = { a2p: null, pr: null, scanned: false };

function detectFields(leads) {
  if (_fields.scanned) return;

  // ── A2P: value looks like "1. Not Started" / "5. Complete (...)" ─────────────
  for (const lead of leads) {
    if (_fields.a2p) break;
    const c = lead.custom || {};
    for (const [k, v] of Object.entries(c)) {
      if (!_fields.a2p && typeof v === 'string' && /^\d+\.\s+/.test(v)) { _fields.a2p = k; break; }
    }
  }

  // ── Pipeline Review: emoji-prefixed → keyword in value → keyword in key name ──
  for (const lead of leads) {
    if (_fields.pr) break;
    const c = lead.custom || {};
    for (const [k, v] of Object.entries(c)) {
      if (k === _fields.a2p) continue;
      if (typeof v === 'string' && PR_EMOJI_RE.test(v)) { _fields.pr = k; break; }
    }
  }
  if (!_fields.pr) {
    for (const lead of leads) {
      if (_fields.pr) break;
      const c = lead.custom || {};
      for (const [k, v] of Object.entries(c)) {
        if (k === _fields.a2p) continue;
        if (typeof v === 'string' && PR_KEYWORD_RE.test(v) && v.length > 20) { _fields.pr = k; break; }
      }
    }
  }
  if (!_fields.pr) {
    const known = leads[0] ? Object.keys(leads[0].custom || {}) : [];
    for (const k of known) {
      if (/pipeline|review|next.?step/i.test(k) && k !== _fields.a2p) { _fields.pr = k; break; }
    }
  }

  _fields.scanned = true;
  console.log('Lead custom fields resolved → a2p:', _fields.a2p, '| pr:', _fields.pr);
}

const getA2P = l => (_fields.a2p ? (l.custom||{})[_fields.a2p] || '' : '');
const getPR  = l => (_fields.pr  ? (l.custom||{})[_fields.pr]  || '' : '');

// ─── Opportunity-level custom field detection (Demo Date, Demo Status) ─────────
const DEMO_STATUS_VALS = new Set(['Scheduled','Completed','No Show','No-Show','Cancelled']);

let _oppFields = {
  demoStatus: 'cf_8BtzV3ggENtaiUj0nBV1NZ65v9g9IaN2XglzDk4rHEA',
  demoDate:   'cf_nRCz1lxTf78cLTtm8QCi2RwWyEdYY6r96JDzwMnMRYa',
  scanned: true,
};

// Return a flat map of all custom entries on an opp, handling two Close.io layouts:
//   Layout A: opp.custom = { cf_xxx: value, ... }   (nested object)
//   Layout B: opp['custom.cf_xxx'] = value           (top-level dotted keys)
function oppCustomEntries(opp) {
  const entries = [];
  // Layout A
  if (opp.custom && typeof opp.custom === 'object') {
    for (const [k, v] of Object.entries(opp.custom)) entries.push([k, v]);
  }
  // Layout B — top-level keys that start with "custom."
  for (const [k, v] of Object.entries(opp)) {
    if (k.startsWith('custom.')) entries.push([k.slice('custom.'.length), v]);
  }
  return entries;
}

function detectOppFields() {
  // Field IDs are hardcoded — no scan needed
}

function getOppCustomVal(opp, cfKey) {
  if (!cfKey) return undefined;
  // Layout A: opp.custom[cfKey]
  if (opp.custom && opp.custom[cfKey] !== undefined) return opp.custom[cfKey];
  // Layout B: opp['custom.cfKey']
  if (opp[`custom.${cfKey}`] !== undefined) return opp[`custom.${cfKey}`];
  return undefined;
}

function getOppDemoStatus(opp) {
  const v = getOppCustomVal(opp, _oppFields.demoStatus);
  return (typeof v === 'string' ? v : '') || '';
}
function getOppDemoDate(opp) {
  const v = getOppCustomVal(opp, _oppFields.demoDate);
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function scoreOpp(opp, lead, demoCompleted = false) {
  let s = 50;
  const stage = STAGE_MAP[opp.status_label] || '';
  if (stage === 'Champion Confirmed')     s += 20;
  else if (stage === 'Active Evaluation') s += 10;
  if (demoCompleted) s += 15;
  const a2p = getA2P(lead);
  if (a2p.startsWith('5.')) s += 10; else if (a2p.startsWith('4.')) s += 5;
  const m = toMonthly(opp);
  if (m >= 200) s += 10; else if (m >= 100) s += 5;
  return Math.min(s, 99);
}

// ─── Fetch all leads: parallel GET pagination, filter Parasol after ────────────
const LEAD_FIELDS = 'id,display_name,opportunities,custom,date_created';
const LEAD_BASE   = `https://api.close.com/api/v1/lead/?_limit=100&_fields=${LEAD_FIELDS}`;

async function fetchPage(skip) {
  const res = await fetch(`${LEAD_BASE}&_skip=${skip}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Close API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Fetch opportunity custom fields directly — lead endpoint omits them
async function fetchOppCustomFields() {
  const base = `https://api.close.com/api/v1/opportunity/?pipeline_id=${PARASOL_PIPELINE_ID}&_limit=100&_fields=id,custom`;
  let all = [], skip = 0, total = null;
  while (true) {
    const res = await fetch(`${base}&_skip=${skip}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Opp custom fetch ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const rows = data.data || [];
    all = all.concat(rows);
    process.stdout.write(`\rFetching opp custom fields: ${all.length}…   `);
    if (rows.length < 100) break;
    skip += 100;
  }
  console.log(`\nFetched opp custom fields for ${all.length} Parasol opps`);
  return Object.fromEntries(all.map(o => [o.id, o.custom || {}]));
}

async function fetchAllLeads() {
  fetchStatus.fetched = 0;
  fetchStatus.total   = 0;
  fetchStatus.pct     = 0;

  // Page 0 first — gives us total_results for accurate progress bar
  const firstData = await fetchPage(0);
  const total     = firstData.total_results || 0;
  fetchStatus.total = total;

  let all = firstData.data || [];
  fetchStatus.fetched = all.length;
  fetchStatus.pct     = total > 0 ? Math.round(all.length / total * 100) : 0;
  process.stdout.write(`\rFetching leads: ${all.length}/${total}   `);

  const totalPages = total > 0 ? Math.ceil(total / 100) : 1;
  const BATCH = 5; // 5 concurrent requests

  for (let page = 1; page < totalPages; page += BATCH) {
    const skips = [];
    for (let p = page; p < Math.min(page + BATCH, totalPages); p++) skips.push(p * 100);

    const pages = await Promise.all(skips.map(skip => fetchPage(skip).then(d => d.data || [])));
    for (const pageData of pages) all = all.concat(pageData);

    fetchStatus.fetched = all.length;
    fetchStatus.pct     = total > 0 ? Math.round(all.length / total * 100) : 0;
    process.stdout.write(`\rFetching leads: ${all.length}/${total} (${fetchStatus.pct}%)   `);
  }

  console.log(`\nFetched ${all.length} total leads`);
  return all;
}

// ─── Process + build dashboard ─────────────────────────────────────────────────
function processLeads(allLeads, oppCustomMap = {}) {
  // Hard filter to Parasol pipeline only
  const leads = allLeads.filter(lead =>
    lead.opportunities &&
    lead.opportunities.some(opp => opp.pipeline_id === PARASOL_PIPELINE_ID)
  );
  console.log(`Pipeline filter: ${allLeads.length} total → ${leads.length} Parasol`);

  detectFields(leads);

  // Merge fetched opp custom fields into each opp, then detect field IDs
  const allParasolOpps = leads.flatMap(l =>
    (l.opportunities||[])
      .filter(o => o.pipeline_id === PARASOL_PIPELINE_ID)
      .map(o => ({ ...o, custom: { ...(o.custom || {}), ...(oppCustomMap[o.id] || {}) } }))
  );
  detectOppFields(allParasolOpps);

  const deals = [];
  for (const lead of leads) {
    const opps = (lead.opportunities||[])
      .filter(o => o.pipeline_id === PARASOL_PIPELINE_ID)
      .map(o => ({ ...o, custom: { ...(o.custom || {}), ...(oppCustomMap[o.id] || {}) } }));
    for (const opp of opps) {
      const stage       = STAGE_MAP[opp.status_label] || opp.status_label || 'Unknown';
      const category    = getCategory(stage);
      const monthly     = toMonthly(opp);
      const ageDays     = ACTIVE_STAGES.has(stage)
        ? Math.floor((Date.now() - new Date(opp.date_created).getTime()) / 86400000) : null;
      const demoStatus  = getOppDemoStatus(opp);
      const demoDate    = getOppDemoDate(opp);
      const demoCompleted = demoStatus === 'Completed';
      deals.push({
        id: opp.id, lead_id: lead.id,
        company:         lead.display_name || '',
        stage, category, monthly_value: monthly, age_days: ageDays,
        score:           scoreOpp(opp, lead, demoCompleted),
        a2p_status:      getA2P(lead),
        pipeline_review: getPR(lead),
        demo_completed:  demoCompleted,
        demo_status:     demoStatus,
        demo_date:       demoDate,
        date_created:    opp.date_created || '',
      });
    }
  }
  return deals;
}

function buildDashboard(deals) {
  const snapshot = null; // no persistent storage on Vercel — WoW deltas unavailable
  const active     = deals.filter(d => d.category === 'active');
  const onboarding = deals.filter(d => d.category === 'onboarding');
  const won        = deals.filter(d => d.category === 'won');
  const lost       = deals.filter(d => d.category === 'lost');
  const champion   = deals.filter(d => d.stage === 'Champion Confirmed');
  const sum = arr  => arr.reduce((s,d) => s + d.monthly_value, 0);

  const byStage = {};
  for (const d of deals) {
    if (!byStage[d.stage]) byStage[d.stage] = { count:0, mrr:0 };
    byStage[d.stage].count++; byStage[d.stage].mrr += d.monthly_value;
  }

  const newByMonth = {};
  for (const d of deals) {
    if (!d.date_created) continue;
    const dt = new Date(d.date_created);
    if (dt < new Date('2025-09-01')) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    newByMonth[key] = (newByMonth[key]||0) + 1;
  }

  let changes = null;
  if (snapshot) {
    const prevById = Object.fromEntries((snapshot.deals||[]).map(d => [d.id, d]));
    const currById = Object.fromEntries(deals.map(d => [d.id, d]));
    changes = {
      prev_date:     snapshot.date,
      prev_kpis:     snapshot.kpis,
      new_count:     deals.filter(d => !prevById[d.id]).length,
      removed_count: (snapshot.deals||[]).filter(d => !currById[d.id]).length,
      new_won:       deals.filter(d => d.category==='won' && prevById[d.id] && prevById[d.id].category!=='won'),
      stage_changes: deals
        .filter(d => prevById[d.id] && prevById[d.id].stage !== d.stage)
        .map(d => ({ ...d, prev_stage: prevById[d.id].stage })),
    };
  }

  const kpis = {
    total:            deals.length,
    active_count:     active.length,   active_mrr:     sum(active),
    onboarding_count: onboarding.length, onboarding_mrr: sum(onboarding),
    won_count:        won.length,      won_mrr:        sum(won),
    lost_count:       lost.length,
    champion_count:   champion.length, champion_mrr:   sum(champion),
  };

  return {
    kpis, changes,
    deals:           deals.sort((a,b) => b.monthly_value - a.monthly_value),
    by_stage:        byStage,
    new_by_month:    newByMonth,
    pipeline_review: deals.filter(d => d.pipeline_review && d.pipeline_review.length > 5)
                          .sort((a,b) => b.monthly_value - a.monthly_value),
    updated_at:      new Date().toISOString(),
  };
}

// ─── Main fetch-and-cache pipeline ────────────────────────────────────────────
async function fetchAndCache() {
  if (fetchStatus.status === 'fetching') {
    console.log('Fetch already in progress, skipping');
    return;
  }
  fetchStatus.status     = 'fetching';
  fetchStatus.started_at = Date.now();
  fetchStatus.error      = null;

  try {
    const allLeads     = await fetchAllLeads();
    const oppCustomMap = await fetchOppCustomFields();
    const deals        = processLeads(allLeads, oppCustomMap);
    const data         = buildDashboard(deals);
    _cache = data;
    fetchStatus.status = 'ready';
    console.log('Background fetch complete — data ready');
  } catch (e) {
    fetchStatus.status = 'error';
    fetchStatus.error  = e.message;
    console.error('fetchAndCache error:', e.message);
  }
}

// ─── Meetings: filter cached deals by Demo Date next week + Demo Status=Scheduled
function getMeetingsFromCache() {
  const now   = new Date();
  const toMon = now.getDay() === 0 ? 1 : 8 - now.getDay();
  const mon   = new Date(now); mon.setDate(now.getDate() + toMon); mon.setHours(0,0,0,0);
  const sun   = new Date(mon); sun.setDate(mon.getDate() + 6);    sun.setHours(23,59,59,999);
  const fmt   = d => d.toISOString().split('T')[0];
  const weekStart = fmt(mon), weekEnd = fmt(sun);

  const deals = (_cache && _cache.deals) || [];
  const meetings = deals.filter(d => {
    if (!d.demo_date) return false;
    if (d.demo_status !== 'Scheduled') return false;
    return d.demo_date >= weekStart && d.demo_date <= weekEnd;
  }).map(d => ({
    lead_id:     d.lead_id,
    lead_name:   d.company,
    demo_date:   d.demo_date,
    demo_status: d.demo_status,
    monthly_value: d.monthly_value,
    stage:       d.stage,
    note:        d.pipeline_review || '',
  }));

  console.log(`Meetings next week (${weekStart}–${weekEnd}): ${meetings.length}`);
  return { meetings, week_start: weekStart, week_end: weekEnd };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status:  fetchStatus.status,
    fetched: fetchStatus.fetched,
    total:   fetchStatus.total,
    pct:     fetchStatus.pct,
    error:   fetchStatus.error,
  });
});

app.get('/api/dashboard', async (req, res) => {
  const force = req.query.refresh === '1';

  if (force) _cache = null;

  // Serve from in-memory cache
  if (!force && _cache) {
    return res.json({ ..._cache, cached: true });
  }

  // Fetch in progress — tell client to poll
  if (fetchStatus.status === 'fetching') {
    return res.status(202).json({
      status:  'fetching',
      fetched: fetchStatus.fetched,
      total:   fetchStatus.total,
      pct:     fetchStatus.pct,
    });
  }

  // Start a fresh fetch, tell client to poll
  fetchAndCache();
  return res.status(202).json({ status: 'fetching', fetched: 0, total: 0, pct: 0 });
});

// Debug: fetch a single opportunity directly to inspect all its fields
app.get('/api/debug/opp/:id', async (req, res) => {
  try {
    const r = await fetch(`https://api.close.com/api/v1/opportunity/${req.params.id}/`, { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: fetch first cached opp ID then retrieve full opportunity record
app.get('/api/debug/opp', async (req, res) => {
  const firstDeal = _cache && _cache.deals && _cache.deals[0];
  if (!firstDeal) return res.status(404).json({ error: 'No cached deals yet — wait for fetch to complete' });
  try {
    const r = await fetch(`https://api.close.com/api/v1/opportunity/${firstDeal.id}/`, { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/meetings', (req, res) => {
  if (!_cache) return res.status(202).json({ meetings: [], week_start: '', week_end: '', pending: true });
  try { res.json(getMeetingsFromCache()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Startup ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MessageDesk Dashboard → http://localhost:${PORT}`);
    fetchAndCache();
  });
}

module.exports = app;
