require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CLOSE_API_KEY || '';
const PARASOL_PIPELINE_ID = 'pipe_1lXFBvtVQXtRgcjonTFr1Y';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory cache + concurrency lock ───────────────────────────────────────
let _cache        = null;
let _fetchPromise = null; // prevents duplicate concurrent fetches

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
  if (opp.value !== null && opp.value !== undefined && opp.value !== '') {
    const dollars = parseFloat(opp.value) / 100;
    const freq = (opp.value_period || '').toLowerCase();
    if (freq === 'annual')                          return dollars / 12;
    if (freq === 'one_time' || freq === 'one-time') return 0;
    return dollars;
  }
  if (opp.value_formatted) {
    const m = opp.value_formatted.replace(/,/g, '').match(/\$?([\d.]+)/);
    if (m) {
      const v = parseFloat(m[1]);
      const freq = (opp.value_period || '').toLowerCase();
      if (freq === 'annual')                          return v / 12;
      if (freq === 'one_time' || freq === 'one-time') return 0;
      return v;
    }
  }
  return 0;
}

// ─── Opp custom fields (hardcoded after discovery) ─────────────────────────────
const DEMO_STATUS_KEY = 'cf_8BtzV3ggENtaiUj0nBV1NZ65v9g9IaN2XglzDk4rHEA';
const DEMO_DATE_KEY   = 'cf_nRCz1lxTf78cLTtm8QCi2RwWyEdYY6r96JDzwMnMRYa';

// Close.io returns opp custom fields as top-level "custom.cf_xxx" keys
function extractOppCustom(opp) {
  const c = { ...(opp.custom || {}) };
  for (const [k, v] of Object.entries(opp)) {
    if (k.startsWith('custom.')) c[k.slice('custom.'.length)] = v;
  }
  return c;
}

function getDemoStatus(custom) { return custom[DEMO_STATUS_KEY] || ''; }
function getDemoDate(custom) {
  const v = custom[DEMO_DATE_KEY];
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function scoreOpp(opp, demoCompleted) {
  let s = 50;
  const stage = STAGE_MAP[opp.status_label] || '';
  if (stage === 'Champion Confirmed')     s += 20;
  else if (stage === 'Active Evaluation') s += 10;
  if (demoCompleted) s += 15;
  const m = toMonthly(opp);
  if (m >= 200) s += 10; else if (m >= 100) s += 5;
  return Math.min(s, 99);
}

// ─── Fetch all Parasol pipeline opportunities (fast — ~5s for ~500 opps) ──────
async function fetchAllParasolOpps() {
  const fields = [
    'id','lead_id','lead_name','status_label',
    'value','value_period','value_formatted',
    'date_created','date_updated','custom',
  ].join(',');
  const base = `https://api.close.com/api/v1/opportunity/?pipeline_id=${PARASOL_PIPELINE_ID}&_limit=100&_fields=${fields}`;

  let all = [], skip = 0;
  while (true) {
    const res = await fetch(`${base}&_skip=${skip}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Close API ${res.status}: ${(await res.text()).slice(0,200)}`);
    const data = await res.json();
    const rows = data.data || [];
    all = all.concat(rows);
    console.log(`Fetched opps: ${all.length}`);
    if (rows.length < 100) break;
    skip += 100;
  }
  console.log(`Total Parasol opps: ${all.length}`);
  return all;
}

// ─── Process opps into deals ───────────────────────────────────────────────────
function processOpps(opps) {
  const deals = [];
  for (const opp of opps) {
    const custom       = extractOppCustom(opp);
    const stage        = STAGE_MAP[opp.status_label] || opp.status_label || 'Unknown';
    const category     = getCategory(stage);
    const monthly      = toMonthly(opp);
    const ageDays      = ACTIVE_STAGES.has(stage)
      ? Math.floor((Date.now() - new Date(opp.date_created).getTime()) / 86400000) : null;
    const demoStatus   = getDemoStatus(custom);
    const demoDate     = getDemoDate(custom);
    const demoCompleted = demoStatus === 'Completed';

    deals.push({
      id: opp.id, lead_id: opp.lead_id,
      company:        opp.lead_name || '',
      stage, category, monthly_value: monthly, age_days: ageDays,
      score:          scoreOpp(opp, demoCompleted),
      a2p_status:     '',
      pipeline_review:'',
      demo_completed: demoCompleted,
      demo_status:    demoStatus,
      demo_date:      demoDate,
      date_created:   opp.date_created || '',
      date_updated:   opp.date_updated || '',
    });
  }

  // Log scheduled meetings for debugging
  const scheduled = deals.filter(d => d.demo_status === 'Scheduled');
  console.log(`Deals with Demo Status=Scheduled: ${scheduled.length}`);
  if (scheduled.length) scheduled.slice(0,5).forEach(d =>
    console.log(`  ${d.company} | ${d.demo_date} | ${d.stage}`)
  );

  return deals;
}

// ─── Build dashboard payload ───────────────────────────────────────────────────
function buildDashboard(deals) {
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

  // WoW — computed from date_created / date_updated, no external storage needed
  const DAY = 86400000;
  const now = Date.now();
  const thisWeekCutoff = now - 7  * DAY;
  const lastWeekCutoff = now - 14 * DAY;
  const inThis = d => d && new Date(d).getTime() >= thisWeekCutoff;
  const inLast = d => { if (!d) return false; const t = new Date(d).getTime(); return t >= lastWeekCutoff && t < thisWeekCutoff; };

  const changes = {
    new_this_week:        deals.filter(d => inThis(d.date_created)),
    new_last_week:        deals.filter(d => inLast(d.date_created)),
    won_this_week:        deals.filter(d => d.category === 'won'               && inThis(d.date_updated)),
    won_last_week:        deals.filter(d => d.category === 'won'               && inLast(d.date_updated)),
    lost_this_week:       deals.filter(d => d.category === 'lost'              && inThis(d.date_updated)),
    lost_last_week:       deals.filter(d => d.category === 'lost'              && inLast(d.date_updated)),
    onboarding_this_week: deals.filter(d => d.category === 'onboarding'        && inThis(d.date_updated)),
    champion_this_week:   deals.filter(d => d.stage    === 'Champion Confirmed' && inThis(d.date_updated)),
    active_updated:       deals.filter(d => d.category === 'active'            && inThis(d.date_updated)),
  };

  const kpis = {
    total:            deals.length,
    active_count:     active.length,     active_mrr:     sum(active),
    onboarding_count: onboarding.length, onboarding_mrr: sum(onboarding),
    won_count:        won.length,        won_mrr:        sum(won),
    lost_count:       lost.length,
    champion_count:   champion.length,   champion_mrr:   sum(champion),
  };

  return {
    kpis, changes,
    deals:           deals.sort((a,b) => b.monthly_value - a.monthly_value),
    by_stage:        byStage,
    new_by_month:    newByMonth,
    pipeline_review: [],   // requires lead-level fetch; not available in fast mode
    updated_at:      new Date().toISOString(),
  };
}

// ─── Fetch, process, cache ─────────────────────────────────────────────────────
async function fetchAndCache() {
  const opps  = await fetchAllParasolOpps();
  const deals = processOpps(opps);
  _cache = buildDashboard(deals);
  console.log('Data ready —', _cache.kpis.total, 'deals');
  return _cache;
}

// Ensures only one concurrent fetch runs; subsequent callers wait for it
async function ensureData(force = false) {
  if (force) _cache = null;
  if (_cache) return _cache;
  if (!_fetchPromise) {
    _fetchPromise = fetchAndCache().finally(() => { _fetchPromise = null; });
  }
  return _fetchPromise;
}

// ─── Lead field discovery ─────────────────────────────────────────────────────
let _leadFieldIds = null;

async function discoverLeadFields() {
  if (_leadFieldIds) return _leadFieldIds;
  const res = await fetch('https://api.close.com/api/v1/custom_field/lead/?_limit=200', { headers: authHeaders() });
  if (!res.ok) { console.error('Lead field discovery failed:', res.status); return {}; }
  const data = await res.json();
  const fields = data.data || [];
  console.log('Lead custom fields:', fields.map(f => `"${f.name}" → ${f.id}`).join(', '));
  const ids = {};
  for (const f of fields) {
    const n = (f.name || '').toLowerCase();
    if (n.includes('pipeline review') || n.includes('next step')) ids.pipeline_review = f.id;
    if (n.includes('a2p'))                                        ids.a2p            = f.id;
  }
  console.log('Mapped lead field IDs:', ids);
  _leadFieldIds = ids;
  return ids;
}

async function fetchLeadsInBatches(leadIds) {
  const BATCH = 50;
  const batches = [];
  for (let i = 0; i < leadIds.length; i += BATCH) batches.push(leadIds.slice(i, i + BATCH));
  console.log(`Fetching ${leadIds.length} leads in ${batches.length} parallel batches…`);

  const results = await Promise.all(batches.map(async batch => {
    const query = batch.map(id => `id:"${id}"`).join(' OR ');
    const url = `https://api.close.com/api/v1/lead/?query=${encodeURIComponent(query)}&_fields=id,custom&_limit=${BATCH}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) { console.error('Lead batch error:', res.status); return []; }
    const data = await res.json();
    return data.data || [];
  }));

  const map = {};
  for (const batch of results) for (const lead of batch) map[lead.id] = lead.custom || {};
  console.log(`Lead data received for ${Object.keys(map).length} leads`);
  return map;
}

// ─── Pipeline Review cache ────────────────────────────────────────────────────
let _prCache        = null;
let _prFetchPromise = null;

async function buildPipelineReviewData() {
  const [fieldIds] = await Promise.all([discoverLeadFields(), ensureData()]);

  const deals   = (_cache && _cache.deals) || [];
  const leadIds = [...new Set(deals.map(d => d.lead_id).filter(Boolean))];
  const leadMap = await fetchLeadsInBatches(leadIds);

  const prKey  = fieldIds.pipeline_review;
  const a2pKey = fieldIds.a2p;

  const enriched = deals
    .map(d => ({
      ...d,
      pipeline_review: prKey  ? (leadMap[d.lead_id]?.[prKey]  || '') : '',
      a2p_status:      a2pKey ? (leadMap[d.lead_id]?.[a2pKey] || '') : '',
    }))
    .filter(d => d.pipeline_review || d.a2p_status)
    .sort((a, b) => b.monthly_value - a.monthly_value);

  console.log(`Pipeline Review: ${enriched.length} deals with notes`);
  return { deals: enriched, field_ids: fieldIds, updated_at: new Date().toISOString() };
}

async function ensurePipelineReview(force = false) {
  if (force) _prCache = null;
  if (_prCache) return _prCache;
  if (!_prFetchPromise) {
    _prFetchPromise = buildPipelineReviewData()
      .then(r => { _prCache = r; return r; })
      .finally(() => { _prFetchPromise = null; });
  }
  return _prFetchPromise;
}

// ─── Meetings: filter cached deals ────────────────────────────────────────────
function getMeetings() {
  const now    = new Date();
  const day    = now.getDay();
  const toMon  = day === 0 ? 1 : 8 - day;
  const mon    = new Date(now); mon.setDate(now.getDate() + toMon); mon.setHours(0,0,0,0);
  const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);     sun.setHours(23,59,59,999);
  const fmt    = d => d.toISOString().split('T')[0];
  const weekStart = fmt(mon), weekEnd = fmt(sun);

  const deals = (_cache && _cache.deals) || [];
  const meetings = deals.filter(d =>
    d.demo_date &&
    d.demo_status === 'Scheduled' &&
    d.demo_date >= weekStart &&
    d.demo_date <= weekEnd
  ).map(d => ({
    lead_id: d.lead_id, lead_name: d.company,
    demo_date: d.demo_date, demo_status: d.demo_status,
    monthly_value: d.monthly_value, stage: d.stage,
    note: '',
  }));

  console.log(`Meetings ${weekStart}–${weekEnd}: ${meetings.length}`);
  return { meetings, week_start: weekStart, week_end: weekEnd };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (force) _prCache = null; // invalidate PR cache too
    const data = await ensureData(force);
    res.json({ ...data, cached: _fetchPromise === null });
  } catch (e) {
    console.error('Dashboard error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pipeline-review', async (req, res) => {
  try {
    const data = await ensurePipelineReview(req.query.refresh === '1');
    res.json(data);
  } catch (e) {
    console.error('Pipeline Review error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meetings', async (req, res) => {
  try {
    await ensureData();
    res.json(getMeetings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug: fetch raw opp by ID
app.get('/api/debug/opp/:id', async (req, res) => {
  try {
    const r = await fetch(`https://api.close.com/api/v1/opportunity/${req.params.id}/`, { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: list all lead custom field definitions
app.get('/api/debug/lead-fields', async (req, res) => {
  try {
    const r = await fetch('https://api.close.com/api/v1/custom_field/lead/?_limit=200', { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json((data.data || []).map(f => ({ id: f.id, name: f.name, type: f.type })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: fetch raw lead by ID
app.get('/api/debug/lead/:id', async (req, res) => {
  try {
    const r = await fetch(`https://api.close.com/api/v1/lead/${req.params.id}/`, { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Startup (local dev only) ──────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MessageDesk Dashboard → http://localhost:${PORT}`);
    fetchAndCache().catch(console.error);
  });
}

module.exports = app;
