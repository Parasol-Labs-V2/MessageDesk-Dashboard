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
let _leadCache   = null;   // { leadMap: {lead_id → custom}, fieldIds }
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

// ─── Fetch all Parasol leads (by pipeline membership) ─────────────────────────
// Uses the proven opportunity-filter query: opportunity(pipeline_id:"...")
async function fetchAllParasolLeads() {
  const QUERY  = `opportunity(pipeline_id:"${PARASOL_PIPELINE_ID}")`;
  const fields = 'id,custom';
  const base   = `https://api.close.com/api/v1/lead/?query=${encodeURIComponent(QUERY)}&_fields=${fields}&_limit=100`;

  let all = [], skip = 0;
  while (true) {
    const res = await fetch(`${base}&_skip=${skip}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Close lead API ${res.status}: ${(await res.text()).slice(0,200)}`);
    const data = await res.json();
    const rows = data.data || [];
    all = all.concat(rows);
    console.log(`Fetched leads: ${all.length}`);
    if (rows.length < 100) break;
    skip += 100;
  }
  console.log(`Total Parasol leads: ${all.length}`);
  return all;
}

// ─── Value-based field ID detection (no need to know field names) ─────────────
// Scans actual lead custom field values to identify which cf_xxx corresponds to
// which concept. This is resilient to field renames in Close.io.
const PR_EMOJI_RE    = /^[\u{1F7E1}\u{1F534}\u{1F7E2}✅⚠\u{1F535}⚪\u{1F7E0}]/u;
const PR_KEYWORD_RE  = /awaiting|blocked by|next step|follow.?up|pending|waiting|schedule|action/i;
const A2P_RE         = /^\d+\.\s+\S/;  // "1. Not Started", "5. Complete ..."
const DEMO_DATE_RE   = /^\d{4}-\d{2}-\d{2}/;
const DEMO_STATUS_VALS = new Set([
  'Scheduled','Completed','No Show','No-Show','Cancelled','Rescheduled','Booked','Held','No showed',
]);

function detectLeadFieldsByValue(leads) {
  const ids = {};

  // Dump first 3 leads' raw custom keys for debugging
  leads.slice(0, 3).forEach((lead, i) => {
    const c = lead.custom || {};
    const keys = Object.keys(c);
    console.log(`[lead ${i}] ${keys.length} custom keys:`,
      keys.map(k => `${k}=${JSON.stringify(c[k]).slice(0,40)}`).join(' | ')
    );
  });

  for (const lead of leads) {
    const c = lead.custom || {};
    for (const [k, v] of Object.entries(c)) {
      if (typeof v !== 'string' || !v) continue;
      // A2P: "1. Not Started" / "5. Complete ..."
      if (!ids.a2p && A2P_RE.test(v)) ids.a2p = k;
      // Demo Status: known enum values
      if (!ids.demo_status && DEMO_STATUS_VALS.has(v)) ids.demo_status = k;
      // Demo Date: ISO date string (skip if same field as a2p or demo_status)
      if (!ids.demo_date && k !== ids.a2p && k !== ids.demo_status && DEMO_DATE_RE.test(v)) ids.demo_date = k;
      // Pipeline Review: emoji-prefixed OR keyword text (not the a2p field)
      if (!ids.pipeline_review && k !== ids.a2p && (PR_EMOJI_RE.test(v) || (PR_KEYWORD_RE.test(v) && v.length > 15))) {
        ids.pipeline_review = k;
      }
    }
    if (ids.a2p && ids.demo_status && ids.demo_date && ids.pipeline_review) break;
  }

  console.log('Detected lead field IDs (by value):', JSON.stringify(ids));
  return ids;
}

// ─── Process opps into basic deals ────────────────────────────────────────────
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
      // Lead-level fields — populated after lead data is loaded
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

// ─── Shared lead data cache ───────────────────────────────────────────────────
// Fetches all Parasol leads once; both pipeline-review and meetings reuse it.
async function ensureLeadData(force = false) {
  if (force) _leadCache = null;
  if (_leadCache) return _leadCache;
  if (!_leadPromise) {
    _leadPromise = (async () => {
      await ensureData();  // need opp data first (for fallback lead_id list)
      const leads    = await fetchAllParasolLeads();
      const fieldIds = detectLeadFieldsByValue(leads);
      // Build leadId → custom map
      const leadMap  = {};
      for (const l of leads) leadMap[l.id] = l.custom || {};
      _leadCache = { leadMap, fieldIds, leadCount: leads.length };
      return _leadCache;
    })().finally(() => { _leadPromise = null; });
  }
  return _leadPromise;
}

// ─── Parse demo date value ────────────────────────────────────────────────────
function parseDemoDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    // epoch ms
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ─── Enrich a deal with lead-level custom fields ──────────────────────────────
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
  const { leadMap, fieldIds, leadCount } = await ensureLeadData(force);
  const deals = (_cache && _cache.deals) || [];

  const enriched = deals
    .map(d => enrichDeal(d, leadMap, fieldIds))
    .filter(d => d.pipeline_review || d.a2p_status)
    .sort((a, b) => b.monthly_value - a.monthly_value);

  console.log(`Pipeline Review: ${enriched.length} deals with notes (from ${leadCount} leads, fieldIds=${JSON.stringify(fieldIds)})`);
  return {
    deals: enriched,
    field_ids: fieldIds,
    lead_count: leadCount,
    updated_at: new Date().toISOString(),
  };
}

// ─── Meetings — filters by demo_status=Scheduled & demo_date next week ────────
async function getMeetings() {
  const { leadMap, fieldIds, leadCount } = await ensureLeadData();
  const deals = (_cache && _cache.deals) || [];

  const now    = new Date();
  const day    = now.getDay();
  const toMon  = day === 0 ? 1 : 8 - day;
  const mon    = new Date(now); mon.setDate(now.getDate() + toMon); mon.setHours(0,0,0,0);
  const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);     sun.setHours(23,59,59,999);
  const fmt    = d => d.toISOString().split('T')[0];
  const weekStart = fmt(mon), weekEnd = fmt(sun);

  const enrichedDeals = deals.map(d => enrichDeal(d, leadMap, fieldIds));

  const allScheduled = enrichedDeals.filter(d => d.demo_status === 'Scheduled');
  console.log(`Leads fetched=${leadCount} fieldIds=${JSON.stringify(fieldIds)}`);
  console.log(`Deals with demo_status=Scheduled: ${allScheduled.length}`);
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
  return { meetings, week_start: weekStart, week_end: weekEnd, field_ids: fieldIds };
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

// Debug: list all lead custom field definitions from Close API
app.get('/api/debug/lead-fields', async (req, res) => {
  try {
    const r = await fetch('https://api.close.com/api/v1/custom_field/lead/?_limit=200', { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json((data.data || []).map(f => ({ id: f.id, name: f.name, type: f.type })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: list all opportunity custom field definitions from Close API
app.get('/api/debug/opp-fields', async (req, res) => {
  try {
    const r = await fetch('https://api.close.com/api/v1/custom_field/opportunity/?_limit=200', { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json((data.data || []).map(f => ({ id: f.id, name: f.name, type: f.type })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: show field detection results + raw custom keys for 5 sample leads
app.get('/api/debug/lead-sample', async (req, res) => {
  try {
    // Fetch 5 sample leads directly via individual endpoint (bypasses query format issues)
    await ensureData();
    const sampleLeadIds = (_cache && _cache.deals || []).slice(0, 5).map(d => d.lead_id).filter(Boolean);
    const samples = await Promise.all(sampleLeadIds.map(async id => {
      const r = await fetch(`https://api.close.com/api/v1/lead/${id}/?_fields=id,display_name,custom`, { headers: authHeaders() });
      if (!r.ok) return { lead_id: id, error: r.status };
      const l = await r.json();
      return { lead_id: id, company: l.display_name, custom_keys: Object.keys(l.custom || {}), custom: l.custom || {} };
    }));

    // Also show what the lead fetch query returns (are we getting leads?)
    const QUERY = `opportunity(pipeline_id:"${PARASOL_PIPELINE_ID}")`;
    const testUrl = `https://api.close.com/api/v1/lead/?query=${encodeURIComponent(QUERY)}&_fields=id,custom&_limit=5`;
    const testRes = await fetch(testUrl, { headers: authHeaders() });
    const testData = testRes.ok ? await testRes.json() : { error: testRes.status };

    // Run value-based field detection on the query results
    const queryLeads = testData.data || [];
    const detectedIds = detectLeadFieldsByValue(queryLeads);

    res.json({
      individual_fetch_samples: samples,
      pipeline_query_results: {
        total_results: testData.total_results,
        first_5_leads: queryLeads.map(l => ({ id: l.id, custom_keys: Object.keys(l.custom || {}), custom: l.custom })),
      },
      detected_field_ids: detectedIds,
      cached_lead_data: _leadCache ? {
        lead_count: _leadCache.leadCount,
        field_ids:  _leadCache.fieldIds,
      } : null,
    });
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
