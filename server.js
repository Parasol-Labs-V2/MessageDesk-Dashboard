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

// ─── In-memory caches ──────────────────────────────────────────────────────────
let _cache       = null;
let _fetchPromise = null;
let _leadCache   = null;   // { leadMap, fieldIds } — shared by meetings + PR
let _leadPromise = null;

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

function scoreOpp(opp) {
  let s = 50;
  const stage = STAGE_MAP[opp.status_label] || '';
  if (stage === 'Champion Confirmed')     s += 20;
  else if (stage === 'Active Evaluation') s += 10;
  const m = toMonthly(opp);
  if (m >= 200) s += 10; else if (m >= 100) s += 5;
  return Math.min(s, 99);
}

// ─── Fetch all Parasol pipeline opportunities ──────────────────────────────────
async function fetchAllParasolOpps() {
  const fields = [
    'id','lead_id','lead_name','status_label',
    'value','value_period','value_formatted',
    'date_created','date_updated',
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

// ─── Process opps into basic deals (no lead-level enrichment yet) ─────────────
function processOpps(opps) {
  const deals = [];
  for (const opp of opps) {
    const stage    = STAGE_MAP[opp.status_label] || opp.status_label || 'Unknown';
    const category = getCategory(stage);
    const monthly  = toMonthly(opp);
    const ageDays  = ACTIVE_STAGES.has(stage)
      ? Math.floor((Date.now() - new Date(opp.date_created).getTime()) / 86400000) : null;

    deals.push({
      id: opp.id, lead_id: opp.lead_id,
      company:        opp.lead_name || '',
      stage, category, monthly_value: monthly, age_days: ageDays,
      score:          scoreOpp(opp),
      // Lead-level fields — filled in after lead fetch
      a2p_status:     '',
      pipeline_review:'',
      demo_completed: false,
      demo_status:    '',
      demo_date:      null,
      date_created:   opp.date_created || '',
      date_updated:   opp.date_updated || '',
    });
  }
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
    deals:        deals.sort((a,b) => b.monthly_value - a.monthly_value),
    by_stage:     byStage,
    new_by_month: newByMonth,
    updated_at:   new Date().toISOString(),
  };
}

// ─── Fetch, process, cache (opps only — fast) ─────────────────────────────────
async function fetchAndCache() {
  const opps  = await fetchAllParasolOpps();
  const deals = processOpps(opps);
  _cache = buildDashboard(deals);
  console.log('Opp data ready —', _cache.kpis.total, 'deals');
  return _cache;
}

async function ensureData(force = false) {
  if (force) { _cache = null; _leadCache = null; }
  if (_cache) return _cache;
  if (!_fetchPromise) {
    _fetchPromise = fetchAndCache().finally(() => { _fetchPromise = null; });
  }
  return _fetchPromise;
}

// ─── Lead field discovery ─────────────────────────────────────────────────────
async function discoverLeadFields() {
  const res = await fetch('https://api.close.com/api/v1/custom_field/lead/?_limit=200', { headers: authHeaders() });
  if (!res.ok) { console.error('Lead field discovery failed:', res.status); return {}; }
  const data = await res.json();
  const fields = data.data || [];
  console.log('Lead custom fields:', fields.map(f => `"${f.name}" → ${f.id}`).join(', '));

  const ids = {};
  for (const f of fields) {
    const n = (f.name || '').toLowerCase();
    // Pipeline Review notes — match several common naming patterns
    if (!ids.pipeline_review && (
      n.includes('pipeline review') || n.includes('pipeline note') ||
      n.includes('next step')       || n.includes('nextstep')
    )) ids.pipeline_review = f.id;
    // A2P 10DLC Registration Status
    if (!ids.a2p && n.includes('a2p')) ids.a2p = f.id;
    // Demo Status (e.g. "Demo Status" / "Meeting Status")
    if (!ids.demo_status && n.includes('demo') && n.includes('status')) ids.demo_status = f.id;
    // Demo Date (e.g. "Demo Date" / "Meeting Date")
    if (!ids.demo_date && n.includes('demo') && n.includes('date')) ids.demo_date = f.id;
  }
  console.log('Mapped lead field IDs:', ids);
  return ids;
}

// ─── Fetch leads in parallel batches ─────────────────────────────────────────
async function fetchLeadsInBatches(leadIds) {
  const BATCH = 50;
  const batches = [];
  for (let i = 0; i < leadIds.length; i += BATCH) batches.push(leadIds.slice(i, i + BATCH));
  console.log(`Fetching ${leadIds.length} leads in ${batches.length} batches…`);

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

// ─── Shared lead data cache ───────────────────────────────────────────────────
// Both pipeline-review and meetings use this; it is built lazily on first call.
async function ensureLeadData(force = false) {
  if (force) _leadCache = null;
  if (_leadCache) return _leadCache;
  if (!_leadPromise) {
    _leadPromise = (async () => {
      const data = await ensureData();
      const [fieldIds, leadMap] = await Promise.all([
        discoverLeadFields(),
        fetchLeadsInBatches([...new Set(data.deals.map(d => d.lead_id).filter(Boolean))]),
      ]);
      _leadCache = { leadMap, fieldIds };
      return _leadCache;
    })().finally(() => { _leadPromise = null; });
  }
  return _leadPromise;
}

// ─── Parse a demo date value from a lead custom field ─────────────────────────
function parseDemoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ─── Enrich one deal with lead-level custom fields ────────────────────────────
function enrichDeal(deal, leadMap, fieldIds) {
  const custom     = leadMap[deal.lead_id] || {};
  const demoStatus = fieldIds.demo_status ? (custom[fieldIds.demo_status] || '') : '';
  const demoDate   = fieldIds.demo_date   ? parseDemoDate(custom[fieldIds.demo_date]) : null;
  return {
    ...deal,
    pipeline_review: fieldIds.pipeline_review ? (custom[fieldIds.pipeline_review] || '') : '',
    a2p_status:      fieldIds.a2p             ? (custom[fieldIds.a2p]             || '') : '',
    demo_status:     demoStatus,
    demo_date:       demoDate,
    demo_completed:  demoStatus === 'Completed',
  };
}

// ─── Pipeline Review — lazy-loaded ───────────────────────────────────────────
async function buildPipelineReviewData(force = false) {
  const { leadMap, fieldIds } = await ensureLeadData(force);
  const deals = (_cache && _cache.deals) || [];

  const enriched = deals
    .map(d => enrichDeal(d, leadMap, fieldIds))
    .filter(d => d.pipeline_review || d.a2p_status)
    .sort((a, b) => b.monthly_value - a.monthly_value);

  console.log(`Pipeline Review: ${enriched.length} deals with notes`);
  return { deals: enriched, field_ids: fieldIds, updated_at: new Date().toISOString() };
}

// ─── Meetings — filters lead-enriched deals for next week's demos ─────────────
async function getMeetings() {
  const { leadMap, fieldIds } = await ensureLeadData();
  const deals = (_cache && _cache.deals) || [];

  const now    = new Date();
  const day    = now.getDay();
  const toMon  = day === 0 ? 1 : 8 - day;
  const mon    = new Date(now); mon.setDate(now.getDate() + toMon); mon.setHours(0,0,0,0);
  const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);     sun.setHours(23,59,59,999);
  const fmt    = d => d.toISOString().split('T')[0];
  const weekStart = fmt(mon), weekEnd = fmt(sun);

  // Log all scheduled demos so we can verify in Vercel logs
  const allScheduled = deals.map(d => enrichDeal(d, leadMap, fieldIds))
    .filter(d => d.demo_status === 'Scheduled');
  console.log(`Total deals with Demo Status=Scheduled: ${allScheduled.length}`);
  allScheduled.slice(0,5).forEach(d =>
    console.log(`  ${d.company} | date=${d.demo_date} | stage=${d.stage}`)
  );

  const meetings = allScheduled
    .filter(d => d.demo_date && d.demo_date >= weekStart && d.demo_date <= weekEnd)
    .map(d => ({
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
    const data = await ensureData(force);
    res.json({ ...data, cached: _fetchPromise === null });
  } catch (e) {
    console.error('Dashboard error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pipeline-review', async (req, res) => {
  try {
    const data = await buildPipelineReviewData(req.query.refresh === '1');
    res.json(data);
  } catch (e) {
    console.error('Pipeline Review error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meetings', async (req, res) => {
  try {
    await ensureData();
    const data = await getMeetings();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// Debug: list all opportunity custom field definitions
app.get('/api/debug/opp-fields', async (req, res) => {
  try {
    const r = await fetch('https://api.close.com/api/v1/custom_field/opportunity/?_limit=200', { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json((data.data || []).map(f => ({ id: f.id, name: f.name, type: f.type })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: show what lead IDs and matched field values look like right now
app.get('/api/debug/lead-sample', async (req, res) => {
  try {
    const fieldIds = await discoverLeadFields();
    // Fetch a few leads from the pipeline
    const data = await ensureData();
    const sampleLeadIds = data.deals.slice(0, 5).map(d => d.lead_id).filter(Boolean);
    const leadMap = await fetchLeadsInBatches(sampleLeadIds);
    const samples = sampleLeadIds.map(id => ({
      lead_id: id,
      company: data.deals.find(d => d.lead_id === id)?.company,
      custom_keys: Object.keys(leadMap[id] || {}),
      pipeline_review: fieldIds.pipeline_review ? leadMap[id]?.[fieldIds.pipeline_review] : '(field not found)',
      a2p_status:      fieldIds.a2p             ? leadMap[id]?.[fieldIds.a2p]             : '(field not found)',
      demo_status:     fieldIds.demo_status      ? leadMap[id]?.[fieldIds.demo_status]     : '(field not found)',
      demo_date:       fieldIds.demo_date        ? leadMap[id]?.[fieldIds.demo_date]       : '(field not found)',
    }));
    res.json({ field_ids: fieldIds, samples });
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

// Debug: fetch raw opp by ID
app.get('/api/debug/opp/:id', async (req, res) => {
  try {
    const r = await fetch(`https://api.close.com/api/v1/opportunity/${req.params.id}/`, { headers: authHeaders() });
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
