require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const PORT   = process.env.PORT || 3000;
const API_KEY = process.env.CLOSE_API_KEY || '';
const PARASOL_PIPELINE_ID = 'pipe_1lXFBvtVQXtRgcjonTFr1Y';
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
const CACHE_TTL = 5 * 60 * 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

let _cache = null, _cacheTs = 0;

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
  const dollars = (parseFloat(opp.value) || 0) / 100;
  const freq = (opp.value_period || '').toLowerCase();
  if (freq === 'annual')                        return dollars / 12;
  if (freq === 'one_time' || freq === 'one-time') return 0;
  return dollars;
}

// ─── Custom field auto-detection ───────────────────────────────────────────────
let _fields = { a2p: null, pr: null, demo: null, scanned: false };

function detectFields(leads) {
  if (_fields.scanned) return;
  for (const lead of leads) {
    const c = lead.custom || {};
    for (const [k, v] of Object.entries(c)) {
      if (!_fields.a2p && typeof v === 'string' && /^\d+\.\s+/i.test(v)) _fields.a2p = k;
      if (!_fields.demo && typeof v === 'boolean') _fields.demo = k;
    }
    if (_fields.a2p) break;
  }
  for (const lead of leads) {
    const c = lead.custom || {};
    for (const [k, v] of Object.entries(c)) {
      if (k !== _fields.a2p && !_fields.pr && typeof v === 'string' && v.length > 30) { _fields.pr = k; break; }
    }
    if (_fields.pr) break;
  }
  _fields.scanned = true;
  console.log('Custom fields →', _fields);
}

const getA2P  = l => (_fields.a2p  ? (l.custom||{})[_fields.a2p]  || '' : '');
const getPR   = l => (_fields.pr   ? (l.custom||{})[_fields.pr]   || '' : '');
const getDemo = l => {
  if (!_fields.demo) return false;
  const v = (l.custom||{})[_fields.demo];
  return v === true || v === 'Yes' || v === '1';
};

// ─── Deal scoring ──────────────────────────────────────────────────────────────
function scoreOpp(opp, lead) {
  let s = 50;
  const stage = STAGE_MAP[opp.status_label] || '';
  if (stage === 'Champion Confirmed') s += 20;
  else if (stage === 'Active Evaluation') s += 10;
  if (getDemo(lead)) s += 15;
  const a2p = getA2P(lead);
  if (a2p.startsWith('5.') || a2p.includes('. ') && a2p[0] === '5') s += 10;
  else if (a2p.startsWith('4.') || a2p.includes('. ') && a2p[0] === '4') s += 5;
  const m = toMonthly(opp);
  if (m >= 200) s += 10; else if (m >= 100) s += 5;
  return Math.min(s, 99);
}

// ─── Close.io fetch helpers ────────────────────────────────────────────────────
async function fetchAllLeads() {
  let all = [], hasMore = true, cursor = null;
  while (hasMore) {
    const base = 'https://api.close.com/api/v1/lead/?_limit=100&_fields=id,display_name,opportunities,custom,date_created';
    const url  = cursor ? `${base}&_cursor=${encodeURIComponent(cursor)}` : base;
    const res  = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Close API ${res.status}: ${(await res.text()).slice(0,200)}`);
    const data = await res.json();
    all = all.concat(data.data || []);
    hasMore = !!data.has_more;
    cursor  = data.cursor || null;
  }
  return all;
}

async function fetchMeetings() {
  const now = new Date();
  const toMon = now.getDay() === 0 ? 1 : 8 - now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() + toMon); mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toISOString().split('T')[0];
  const weekStart = fmt(mon), weekEnd = fmt(sun);
  try {
    const url = `https://api.close.com/api/v1/task/?due_date__gte=${weekStart}&due_date__lte=${weekEnd}&_limit=100`;
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    const meetings = (data.data || []).filter(t =>
      (t._type || t.type || '').toLowerCase().includes('meeting') || t.object_type === 'meeting'
    );
    return { meetings, week_start: weekStart, week_end: weekEnd };
  } catch (e) {
    return { meetings: [], week_start: weekStart, week_end: weekEnd };
  }
}

// ─── Process leads → deals ─────────────────────────────────────────────────────
function processLeads(allLeads) {
  detectFields(allLeads);
  const parasolLeads = allLeads.filter(l => (l.opportunities||[]).some(o => o.pipeline_id === PARASOL_PIPELINE_ID));
  console.log(`Leads: ${allLeads.length} total → ${parasolLeads.length} Parasol`);

  const deals = [];
  for (const lead of parasolLeads) {
    const opps = (lead.opportunities||[]).filter(o => o.pipeline_id === PARASOL_PIPELINE_ID);
    for (const opp of opps) {
      const stage    = STAGE_MAP[opp.status_label] || opp.status_label || 'Unknown';
      const category = getCategory(stage);
      const monthly  = toMonthly(opp);
      const ageDays  = ACTIVE_STAGES.has(stage)
        ? Math.floor((Date.now() - new Date(opp.date_created).getTime()) / 86400000) : null;
      deals.push({
        id: opp.id, lead_id: lead.id,
        company: lead.display_name || '',
        stage, category, monthly_value: monthly, age_days: ageDays,
        score: scoreOpp(opp, lead),
        a2p_status:     getA2P(lead),
        pipeline_review: getPR(lead),
        demo_completed:  getDemo(lead),
        date_created:   opp.date_created || '',
      });
    }
  }
  return deals;
}

// ─── Snapshot helpers ──────────────────────────────────────────────────────────
function saveSnapshot(data) {
  const today = new Date().toISOString().split('T')[0];
  const file  = path.join(SNAPSHOTS_DIR, `${today}.json`);
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, JSON.stringify({
    date: today, kpis: data.kpis,
    deals: data.deals.map(d => ({ id:d.id, company:d.company, stage:d.stage, category:d.category, monthly_value:d.monthly_value })),
  }, null, 2));
  console.log('Snapshot saved:', file);
}

function loadLatestSnapshot() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const files = fs.readdirSync(SNAPSHOTS_DIR)
      .filter(f => f.endsWith('.json') && f < `${today}.json`)
      .sort().reverse();
    return files.length ? JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, files[0]), 'utf8')) : null;
  } catch { return null; }
}

// ─── Build full dashboard payload ─────────────────────────────────────────────
function buildDashboard(deals, snapshot) {
  const active     = deals.filter(d => d.category === 'active');
  const onboarding = deals.filter(d => d.category === 'onboarding');
  const won        = deals.filter(d => d.category === 'won');
  const lost       = deals.filter(d => d.category === 'lost');
  const champion   = deals.filter(d => d.stage === 'Champion Confirmed');
  const sum = arr => arr.reduce((s,d) => s + d.monthly_value, 0);

  // Per-stage breakdown
  const byStage = {};
  for (const d of deals) {
    if (!byStage[d.stage]) byStage[d.stage] = { count:0, mrr:0 };
    byStage[d.stage].count++; byStage[d.stage].mrr += d.monthly_value;
  }

  // Monthly deal creation histogram (from Sep 2025 onward)
  const newByMonth = {};
  for (const d of deals) {
    if (!d.date_created) continue;
    const dt = new Date(d.date_created);
    if (dt < new Date('2025-09-01')) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    newByMonth[key] = (newByMonth[key]||0) + 1;
  }

  // WoW change computation
  let changes = null;
  if (snapshot) {
    const prevById = Object.fromEntries((snapshot.deals||[]).map(d => [d.id, d]));
    const currById = Object.fromEntries(deals.map(d => [d.id, d]));
    changes = {
      prev_date:    snapshot.date,
      prev_kpis:    snapshot.kpis,
      new_count:    deals.filter(d => !prevById[d.id]).length,
      removed_count: (snapshot.deals||[]).filter(d => !currById[d.id]).length,
      new_won:      deals.filter(d => d.category==='won' && prevById[d.id] && prevById[d.id].category!=='won'),
      stage_changes: deals
        .filter(d => prevById[d.id] && prevById[d.id].stage !== d.stage)
        .map(d => ({ ...d, prev_stage: prevById[d.id].stage })),
    };
  }

  const kpis = {
    total:            deals.length,
    active_count:     active.length,
    active_mrr:       sum(active),
    onboarding_count: onboarding.length,
    onboarding_mrr:   sum(onboarding),
    won_count:        won.length,
    won_mrr:          sum(won),
    lost_count:       lost.length,
    champion_count:   champion.length,
    champion_mrr:     sum(champion),
  };

  return {
    kpis,
    deals: deals.sort((a,b) => b.monthly_value - a.monthly_value),
    by_stage: byStage, new_by_month: newByMonth, changes,
    pipeline_review: deals.filter(d => d.pipeline_review && d.pipeline_review.length > 5)
                          .sort((a,b) => b.monthly_value - a.monthly_value),
    updated_at: new Date().toISOString(),
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  const now = Date.now(), force = req.query.refresh === '1';
  if (_cache && !force && now - _cacheTs < CACHE_TTL) return res.json({ ..._cache, cached: true });
  try {
    const allLeads = await fetchAllLeads();
    const deals    = processLeads(allLeads);
    const snapshot = loadLatestSnapshot();
    const data     = buildDashboard(deals, snapshot);
    saveSnapshot(data);
    _cache = data; _cacheTs = now;
    res.json(data);
  } catch (e) {
    console.error('Dashboard error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meetings', async (req, res) => {
  try { res.json(await fetchMeetings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`MessageDesk Dashboard → http://localhost:${PORT}`));
}
module.exports = app;
