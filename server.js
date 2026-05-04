require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CLOSE_API_KEY || '';
const PARASOL_PIPELINE_ID = 'pipe_1lXFBvtVQXtRgcjonTFr1Y';

// Hardcoded lead-level custom field string-name keys (confirmed via debug endpoint)
const LEAD_KEY_PIPELINE_REVIEW = 'Pipeline Review';
const LEAD_KEY_A2P             = 'A2P 10DLC Registration Status';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory caches ──────────────────────────────────────────────────────────
let _cache       = null;
let _fetchPromise = null;
let _leadCache   = null;   // { leadMap: {lead_id → custom_obj} }
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

// ─── Opp custom field extraction ───────────────────────────────────────────────
// Close.io returns opp custom fields as top-level dotted keys: opp['custom.KEY']
// KEY may be a string name ("Demo Status") or a cf_xxx ID — handle both.
function extractOppCustom(opp) {
  const c = { ...(opp.custom || {}) };
  for (const [k, v] of Object.entries(opp)) {
    if (k.startsWith('custom.')) c[k.slice('custom.'.length)] = v;
  }
  return c;
}

// ─── Opp-level Demo Status / Demo Date detection (value-based) ────────────────
const DEMO_STATUS_VALS = new Set([
  'Scheduled','Completed','No Show','No-Show','Cancelled','Rescheduled','Booked','Held','No showed',
]);
const DEMO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

let _oppFieldIds = null;

function detectOppFields(opps) {
  if (_oppFieldIds) return _oppFieldIds;
  const ids = {};
  for (const opp of opps) {
    const c = extractOppCustom(opp);
    for (const [k, v] of Object.entries(c)) {
      if (!ids.demo_status && typeof v === 'string' && DEMO_STATUS_VALS.has(v)) ids.demo_status = k;
      if (!ids.demo_date   && typeof v === 'string' && DEMO_DATE_RE.test(v))    ids.demo_date   = k;
    }
    if (ids.demo_status && ids.demo_date) break;
  }
  console.log('Opp custom field IDs detected:', JSON.stringify(ids));
  _oppFieldIds = ids;
  return ids;
}

function parseDemoDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }
  const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ─── Fetch all Parasol pipeline opportunities (includes opp custom fields) ─────
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

// ─── Process opps into deals (demo date/status read from opp custom fields) ────
function processOpps(opps) {
  const fieldIds = detectOppFields(opps);
  const deals = [];
  for (const opp of opps) {
    const custom      = extractOppCustom(opp);
    const stage       = STAGE_MAP[opp.status_label] || opp.status_label || 'Unknown';
    const category    = getCategory(stage);
    const monthly     = toMonthly(opp);
    const ageDays     = ACTIVE_STAGES.has(stage)
      ? Math.floor((Date.now() - new Date(opp.date_created).getTime()) / 86400000) : null;
    const demoStatus  = fieldIds.demo_status ? (custom[fieldIds.demo_status] || '') : '';
    const demoDate    = fieldIds.demo_date   ? parseDemoDate(custom[fieldIds.demo_date]) : null;

    deals.push({
      id: opp.id, lead_id: opp.lead_id,
      company:        opp.lead_name || '',
      stage, category, monthly_value: monthly, age_days: ageDays,
      score:          scoreOpp(opp),
      // Lead-level fields populated after lead fetch
      a2p_status:     '',
      pipeline_review:'',
      demo_status:    demoStatus,
      demo_date:      demoDate,
      demo_completed: demoStatus === 'Completed',
      date_created:   opp.date_created || '',
      date_updated:   opp.date_updated || '',
    });
  }

  const scheduled = deals.filter(d => d.demo_status === 'Scheduled');
  console.log(`Deals with demo_status=Scheduled: ${scheduled.length} (field: ${fieldIds.demo_status || 'not found'})`);
  scheduled.slice(0,3).forEach(d => console.log(`  ${d.company} | ${d.demo_date}`));

  return deals;
}

// ─── Fetch leads by their IDs (individual endpoints, chunked concurrency) ──────
// Pipeline query returns 0 (broken in current Close.io API), so we fetch individually.
// Lead custom fields use string name keys: "Pipeline Review", "A2P 10DLC Registration Status"
async function fetchLeadsByIds(leadIds) {
  const CHUNK = 50; // parallel requests per chunk
  const map   = {};

  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const results = await Promise.allSettled(chunk.map(id =>
      fetch(`https://api.close.com/api/v1/lead/${id}/?_fields=id,custom`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    ));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) map[r.value.id] = r.value.custom || {};
    }
    console.log(`Leads fetched: ${Object.keys(map).length}/${leadIds.length}`);
  }
  return map;
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

  // Win rate: only count lost deals where a meeting was actually held.
  // "No Showed" is excluded — the meeting was scheduled but never happened.
  const MEETING_HELD_LOST = new Set(['No Decision', 'Timing', 'Mass Texting']);
  const qualifiedLost = lost.filter(d => MEETING_HELD_LOST.has(d.stage));
  const winRateDenom  = won.length + qualifiedLost.length;
  const winRate       = winRateDenom > 0 ? Math.round(won.length / winRateDenom * 100) : 0;

  const kpis = {
    total:            deals.length,
    active_count:     active.length,     active_mrr:     sum(active),
    onboarding_count: onboarding.length, onboarding_mrr: sum(onboarding),
    won_count:        won.length,        won_mrr:        sum(won),
    lost_count:       lost.length,
    champion_count:   champion.length,   champion_mrr:   sum(champion),
    win_rate:         winRate,
    win_rate_denom:   winRateDenom,
  };

  return {
    kpis, changes,
    deals:        deals.sort((a,b) => b.monthly_value - a.monthly_value),
    by_stage:     byStage,
    new_by_month: newByMonth,
    updated_at:   new Date().toISOString(),
  };
}

// ─── Fetch, process, cache (opps only — fast, includes opp custom fields) ──────
async function fetchAndCache() {
  _oppFieldIds = null; // reset so detection runs fresh
  const opps  = await fetchAllParasolOpps();
  const deals = processOpps(opps);
  _cache = buildDashboard(deals);
  console.log('Opp data ready —', _cache.kpis.total, 'deals');
  return _cache;
}

async function ensureData(force = false) {
  if (force) { _cache = null; _leadCache = null; _oppFieldIds = null; }
  if (_cache) return _cache;
  if (!_fetchPromise) {
    _fetchPromise = fetchAndCache().finally(() => { _fetchPromise = null; });
  }
  return _fetchPromise;
}

// ─── Shared lead data cache ───────────────────────────────────────────────────
async function ensureLeadData(force = false) {
  if (force) _leadCache = null;
  if (_leadCache) return _leadCache;
  if (!_leadPromise) {
    _leadPromise = (async () => {
      const data    = await ensureData();
      const leadIds = [...new Set(data.deals.map(d => d.lead_id).filter(Boolean))];
      const leadMap = await fetchLeadsByIds(leadIds);
      console.log(`Lead cache ready: ${Object.keys(leadMap).length} leads`);
      // Log sample to confirm field keys
      const sampleId = leadIds[0];
      if (sampleId && leadMap[sampleId]) {
        const c = leadMap[sampleId];
        console.log(`Sample lead keys: ${Object.keys(c).join(', ')}`);
        console.log(`  Pipeline Review: ${c[LEAD_KEY_PIPELINE_REVIEW] || '(empty)'}`);
        console.log(`  A2P: ${c[LEAD_KEY_A2P] || '(empty)'}`);
      }
      _leadCache = { leadMap };
      return _leadCache;
    })().finally(() => { _leadPromise = null; });
  }
  return _leadPromise;
}

// ─── Enrich a deal with lead-level custom fields ──────────────────────────────
function enrichDeal(deal, leadMap) {
  const custom = leadMap[deal.lead_id] || {};
  return {
    ...deal,
    pipeline_review: custom[LEAD_KEY_PIPELINE_REVIEW] || '',
    a2p_status:      custom[LEAD_KEY_A2P]             || '',
  };
}

// ─── Pipeline Review — lazy-loaded ───────────────────────────────────────────
async function buildPipelineReviewData(force = false) {
  const { leadMap } = await ensureLeadData(force);
  const deals = (_cache && _cache.deals) || [];

  const enriched = deals
    .map(d => enrichDeal(d, leadMap))
    .filter(d => d.pipeline_review || d.a2p_status)
    .sort((a, b) => b.monthly_value - a.monthly_value);

  console.log(`Pipeline Review: ${enriched.length} deals with notes out of ${deals.length} total`);
  return {
    deals:     enriched,
    updated_at: new Date().toISOString(),
  };
}

// ─── Meetings — reads demo_date/demo_status from opp-level data ───────────────
async function getMeetings() {
  await ensureData();
  const deals = (_cache && _cache.deals) || [];

  const now    = new Date();
  const day    = now.getDay();
  // Current week's Monday (not next week's): Mon=0 days back, Tue=1, …, Sun=6
  const daysFromMon = day === 0 ? 6 : day - 1;
  const mon    = new Date(now); mon.setDate(now.getDate() - daysFromMon); mon.setHours(0,0,0,0);
  const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);     sun.setHours(23,59,59,999);
  const fmt    = d => d.toISOString().split('T')[0];
  const weekStart = fmt(mon), weekEnd = fmt(sun);

  const allScheduled = deals.filter(d => d.demo_status === 'Scheduled');
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
    const data = await getMeetings();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug: raw lead by ID
app.get('/api/debug/lead/:id', async (req, res) => {
  try {
    const r = await fetch(`https://api.close.com/api/v1/lead/${req.params.id}/`, { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: raw opp by ID
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

// Debug: list all opportunity custom field definitions
app.get('/api/debug/opp-fields', async (req, res) => {
  try {
    const r = await fetch('https://api.close.com/api/v1/custom_field/opportunity/?_limit=200', { headers: authHeaders() });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json((data.data || []).map(f => ({ id: f.id, name: f.name, type: f.type })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: show opp custom fields for a sample opp + what demo fields were detected
app.get('/api/debug/opp-sample', async (req, res) => {
  try {
    await ensureData();
    const sampleOpps = (_cache && _cache.deals || []).slice(0, 5);
    const results = await Promise.all(sampleOpps.map(async d => {
      const r = await fetch(`https://api.close.com/api/v1/opportunity/${d.id}/?_fields=id,lead_name,status_label,custom`, { headers: authHeaders() });
      if (!r.ok) return { id: d.id, error: r.status };
      const opp = await r.json();
      const extracted = extractOppCustom(opp);
      return {
        id: opp.id,
        lead_name: opp.lead_name,
        status_label: opp.status_label,
        raw_custom: opp.custom,
        dotted_keys: Object.keys(opp).filter(k => k.startsWith('custom.')).reduce((o,k) => { o[k] = opp[k]; return o; }, {}),
        extracted_custom: extracted,
      };
    }));
    res.json({
      detected_opp_field_ids: _oppFieldIds,
      samples: results,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: show lead sample and lead cache state
app.get('/api/debug/lead-sample', async (req, res) => {
  try {
    await ensureData();
    const sampleLeadIds = (_cache && _cache.deals || []).slice(0, 3).map(d => d.lead_id).filter(Boolean);
    const samples = await Promise.all(sampleLeadIds.map(async id => {
      const r = await fetch(`https://api.close.com/api/v1/lead/${id}/?_fields=id,display_name,custom`, { headers: authHeaders() });
      if (!r.ok) return { lead_id: id, error: r.status };
      const l = await r.json();
      return {
        lead_id: id, company: l.display_name,
        custom_keys: Object.keys(l.custom || {}),
        pipeline_review: (l.custom || {})[LEAD_KEY_PIPELINE_REVIEW],
        a2p_status: (l.custom || {})[LEAD_KEY_A2P],
      };
    }));
    res.json({
      hardcoded_lead_keys: { pipeline_review: LEAD_KEY_PIPELINE_REVIEW, a2p: LEAD_KEY_A2P },
      lead_cache: _leadCache ? { lead_count: Object.keys(_leadCache.leadMap).length } : null,
      samples,
    });
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
