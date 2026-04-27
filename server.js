require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const CLOSE_API_KEY   = process.env.CLOSE_API_KEY   || '';
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY || '';
const CLOSE_BASE      = 'https://api.close.com/api/v1';
const HUBSPOT_BASE    = 'https://api.hubapi.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Simple cache ──────────────────────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000;
const cache = {};
function getCache(key) {
  const e = cache[key];
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  return null;
}
function setCache(key, data) { cache[key] = { data, ts: Date.now() }; }

// ─── Close.io helpers ──────────────────────────────────────────────────────────
function closeAuth() {
  return { Authorization: `Basic ${Buffer.from(CLOSE_API_KEY + ':').toString('base64')}` };
}

async function closeFetch(endpoint, params = {}) {
  const url = new URL(CLOSE_BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: closeAuth(), timeout: 30000 });
  if (!res.ok) throw new Error(`Close ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function closePageAll(endpoint, params = {}) {
  const results = [];
  let skip = 0;
  while (true) {
    const data = await closeFetch(endpoint, { ...params, _limit: 100, _skip: skip });
    results.push(...(data.data || []));
    if (!data.has_more) break;
    skip += 100;
  }
  return results;
}

// ─── HubSpot helpers ───────────────────────────────────────────────────────────
function hsHeaders() {
  return { Authorization: `Bearer ${HUBSPOT_API_KEY}`, 'Content-Type': 'application/json' };
}

async function hsFetch(path, params = {}) {
  const url = new URL(HUBSPOT_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: hsHeaders(), timeout: 30000 });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function hsPost(path, body) {
  const res = await fetch(HUBSPOT_BASE + path, {
    method: 'POST', headers: hsHeaders(), body: JSON.stringify(body), timeout: 30000,
  });
  if (!res.ok) throw new Error(`HubSpot POST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ─── MessageDesk: toMonthly ────────────────────────────────────────────────────
function mdToMonthly(opp) {
  const val = parseFloat(opp.value) || 0;
  const freq = (opp.value_period || '').toLowerCase();
  if (freq === 'annual') return val / 12;
  if (freq === 'one_time' || freq === 'one-time') return 0;
  return val;
}

function a2pStage(raw) {
  if (!raw) return 0;
  const m = raw.match(/^(\d+)\./);
  return m ? parseInt(m[1]) : 0;
}

// ─── MessageDesk dashboard ─────────────────────────────────────────────────────
async function fetchMessageDeskDashboard() {
  const cached = getCache('messagedesk');
  if (cached) return cached;

  const [opps, statuses] = await Promise.all([
    closePageAll('/opportunity/', {
      _fields: 'id,lead_id,lead_name,status_id,status_label,status_type,value,value_period,date_created,date_updated,date_won,date_lost,user_id,user_name,note,confidence,custom',
    }),
    closeFetch('/status/opportunity/'),
  ]);

  // Build status type map
  const statusTypeMap = {};
  (statuses.data || []).forEach(s => { statusTypeMap[s.id] = s.type || 'active'; });

  // Auto-detect A2P custom field (matches /^\d+\.\s+/)
  let a2pFieldId = null;
  for (const opp of opps) {
    const custom = opp.custom || {};
    for (const [k, v] of Object.entries(custom)) {
      if (typeof v === 'string' && /^\d+\.\s+/.test(v)) { a2pFieldId = k; break; }
    }
    if (a2pFieldId) break;
  }

  // Classify opps
  const active = [], won = [], lost = [];
  for (const opp of opps) {
    const stype = statusTypeMap[opp.status_id] || opp.status_type || 'active';
    const monthly = mdToMonthly(opp);
    const custom = opp.custom || {};
    const a2pRaw = a2pFieldId ? (custom[a2pFieldId] || '') : '';
    const deal = {
      id: opp.id, lead_id: opp.lead_id,
      company: opp.lead_name || '',
      status_label: opp.status_label || '',
      status_id: opp.status_id || '',
      monthly_value: monthly,
      owner: opp.user_name || '',
      a2p_stage: a2pStage(a2pRaw),
      a2p_label: a2pRaw,
      note: opp.note || '',
      date_created: opp.date_created || '',
      date_updated: opp.date_updated || '',
      date_won: opp.date_won || null,
      date_lost: opp.date_lost || null,
      confidence: opp.confidence || 0,
      age_days: Math.floor((Date.now() - new Date(opp.date_created).getTime()) / 86400000),
      status_type: stype,
    };
    if (stype === 'won') won.push(deal);
    else if (stype === 'lost') lost.push(deal);
    else active.push(deal);
  }

  // Pipeline by status
  const pipelineByStatus = {};
  for (const d of active) {
    if (!pipelineByStatus[d.status_label]) pipelineByStatus[d.status_label] = { count: 0, mrr: 0 };
    pipelineByStatus[d.status_label].count++;
    pipelineByStatus[d.status_label].mrr += d.monthly_value;
  }

  // MRR by month (last 12 months)
  const mrrByMonth = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    mrrByMonth[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`] = 0;
  }
  for (const d of won) {
    if (!d.date_won) continue;
    const dt = new Date(d.date_won);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    if (key in mrrByMonth) mrrByMonth[key] += d.monthly_value;
  }

  // A2P breakdown
  const a2pBreakdown = {};
  for (const d of active) {
    const k = d.a2p_stage || 0;
    if (!a2pBreakdown[k]) a2pBreakdown[k] = { count: 0, mrr: 0, label: d.a2p_label || `Stage ${k}` };
    a2pBreakdown[k].count++;
    a2pBreakdown[k].mrr += d.monthly_value;
  }

  const sumMrr = arr => arr.reduce((s, d) => s + d.monthly_value, 0);
  const kpis = {
    pipeline_mrr: sumMrr(active),
    active_deals: active.length,
    won_mrr: sumMrr(won),
    win_rate: (active.length + won.length + lost.length) > 0
      ? Math.round(won.length / (won.length + lost.length) * 100) || 0
      : 0,
    total_deals: opps.length,
  };

  const result = {
    kpis,
    active_opportunities: active,
    won_opportunities: won,
    lost_opportunities: lost,
    pipeline_by_status: pipelineByStatus,
    mrr_by_month: mrrByMonth,
    a2p_breakdown: a2pBreakdown,
    field_ids: { a2p: a2pFieldId },
    updated_at: new Date().toISOString(),
  };

  setCache('messagedesk', result);
  return result;
}

// ─── Duet stage/owner maps ─────────────────────────────────────────────────────
const DUET_STAGE_MAP = {
  '3446819577': 'New / Not Yet Contacted',
  '3446820538': 'Attempting Contact',
  '3446820539': 'Parasol Engaged',
  '3467751100': 'Meeting Booked',
  '3446820540': 'Meeting Held',
  '3467565765': 'Interest Confirmed',
  '3477604030': 'Diagnostic',
  '3446820542': 'LOI Sent',
  '3446820543': 'Enrolled / Won',
  '3446820544': 'Not Interested / Lost',
  '3446820545': 'Come Back To',
  '3446820546': 'Not Relevant / DQ',
};
const DUET_OWNER_MAP = {
  '163553901': 'Jonathan Goldberg',
  '163553854': 'Florencia Scopp',
  '83189293':  'Joe',
  '163575365': 'Jonathan Goldberg',
};
const ownerCache = {};

async function resolveOwner(id) {
  if (!id) return 'Unknown';
  if (DUET_OWNER_MAP[id]) return DUET_OWNER_MAP[id];
  if (ownerCache[id]) return ownerCache[id];
  try {
    const data = await hsFetch(`/crm/v3/owners/${id}`);
    const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || data.email || id;
    ownerCache[id] = name;
    return name;
  } catch { ownerCache[id] = id; return id; }
}

const DUET_PIPELINE_ID = '2168635108';
const DUET_PROPS = [
  'dealname','dealstage','pipeline','hubspot_owner_id','closedate',
  'hs_lastmodifieddate','attribution_2024_lives','gross_savings_2024_deal',
  'outreach_attempt_count','last_outreach_date','meeting_date','loi_sent_date',
  'loi_signed_date','enrollment_date','enrollment_deadline','champion_name',
  'champion_role','lost_reason','deal_source','duet_engaged_owner',
  'secondary_owner','meeting_set','np_intro_made',
].join(',');

async function fetchDuetDeals() {
  const cached = getCache('duet');
  if (cached) return cached;

  const deals = [];
  let after = null;
  while (true) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: DUET_PIPELINE_ID }] }],
      properties: DUET_PROPS.split(','),
      limit: 100,
    };
    if (after) body.after = after;
    const data = await hsPost('/crm/v3/objects/deals/search', body);
    deals.push(...(data.results || []));
    if (data.paging && data.paging.next && data.paging.next.after) {
      after = data.paging.next.after;
    } else break;
  }

  // Resolve owners in parallel (dedupe)
  const ownerIds = [...new Set(deals.map(d => d.properties?.hubspot_owner_id).filter(Boolean))];
  await Promise.all(ownerIds.map(id => resolveOwner(id)));

  const mapped = deals.map(d => {
    const p = d.properties || {};
    const stageId = p.dealstage || '';
    const ownerId = p.hubspot_owner_id || '';
    return {
      id: d.id,
      dealname: p.dealname || '',
      stage_id: stageId,
      stage: DUET_STAGE_MAP[stageId] || stageId,
      owner: DUET_OWNER_MAP[ownerId] || ownerCache[ownerId] || ownerId,
      owner_id: ownerId,
      closedate: p.closedate || null,
      last_modified: p.hs_lastmodifieddate || null,
      lives: parseFloat(p.attribution_2024_lives) || 0,
      gross_savings: parseFloat(p.gross_savings_2024_deal) || 0,
      outreach_attempts: parseInt(p.outreach_attempt_count) || 0,
      last_outreach: p.last_outreach_date || null,
      meeting_date: p.meeting_date || null,
      loi_sent_date: p.loi_sent_date || null,
      loi_signed_date: p.loi_signed_date || null,
      enrollment_date: p.enrollment_date || null,
      enrollment_deadline: p.enrollment_deadline || null,
      champion_name: p.champion_name || '',
      champion_role: p.champion_role || '',
      lost_reason: p.lost_reason || '',
      deal_source: p.deal_source || '',
      meeting_set: p.meeting_set || '',
      np_intro_made: p.np_intro_made || '',
    };
  });

  const result = { deals: mapped, updated_at: new Date().toISOString() };
  setCache('duet', result);
  return result;
}

// ─── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/messagedesk/dashboard', async (req, res) => {
  try {
    if (req.query.refresh === '1') delete cache['messagedesk'];
    res.json(await fetchMessageDeskDashboard());
  } catch (e) {
    console.error('MessageDesk error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/duet/deals', async (req, res) => {
  try {
    if (req.query.refresh === '1') delete cache['duet'];
    res.json(await fetchDuetDeals());
  } catch (e) {
    console.error('Duet error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Catch-all: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Parasol Hub → http://localhost:${PORT}`));
}

module.exports = app;
