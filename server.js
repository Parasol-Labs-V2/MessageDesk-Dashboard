require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLOSE_API_KEY = process.env.CLOSE_API_KEY;
const CLOSE_BASE = 'https://api.close.com/api/v1';

const closeApi = axios.create({
  baseURL: CLOSE_BASE,
  auth: { username: CLOSE_API_KEY, password: '' },
  timeout: 30000,
});

// Fetch all pages from a Close.io endpoint
async function fetchAllPages(endpoint, params = {}) {
  const results = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const res = await closeApi.get(endpoint, { params: { ...params, _limit: limit, _skip: skip } });
    const data = res.data;
    results.push(...(data.data || []));
    if (!data.has_more) break;
    skip += limit;
  }
  return results;
}

// Convert opportunity value to monthly equivalent
function toMonthly(opp) {
  const val = parseFloat(opp.value) || 0;
  const freq = (opp.value_period || '').toLowerCase();
  if (freq === 'annual') return val / 12;
  if (freq === 'one_time' || freq === 'one-time') return 0;
  return val; // monthly
}

// Parse A2P status number prefix
function a2pStage(raw) {
  if (!raw) return 0;
  const m = raw.match(/^(\d+)\./);
  return m ? parseInt(m[1]) : 0;
}

// GET /api/debug - inspect raw lead fields
app.get('/api/debug', async (req, res) => {
  try {
    const r = await closeApi.get('/lead/', { params: { _limit: 1 } });
    res.json(r.data.data[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/dashboard - main data endpoint
app.get('/api/dashboard', async (req, res) => {
  try {
    // Fetch all leads with opportunities
    const leads = await fetchAllPages('/lead/', {
      query: 'has:opportunities',
      _fields: 'id,display_name,opportunities,custom,contacts,date_created',
    });

    // Fetch all opportunities directly for richer data
    const opps = await fetchAllPages('/opportunity/', {
      _fields: 'id,lead_id,lead_name,status_id,status_label,status_type,value,value_period,date_created,date_updated,date_won,date_lost,user_id,user_name,note,confidence,custom',
    });

    // Fetch opportunity statuses
    const statusRes = await closeApi.get('/status/opportunity/');
    const statuses = statusRes.data.data || [];

    // Build lookup maps
    const leadMap = {};
    for (const lead of leads) {
      leadMap[lead.id] = lead;
    }

    // Extract custom field IDs from first lead with custom fields
    let a2pFieldId = null;
    let pipelineFieldId = null;
    for (const lead of leads) {
      if (lead.custom) {
        for (const [k, v] of Object.entries(lead.custom)) {
          if (typeof v === 'string' && v.match(/^\d+\.\s+/)) {
            // likely A2P field
            if (!a2pFieldId) a2pFieldId = k;
          }
        }
      }
    }

    // Process opportunities
    const activeOpps = [];
    const wonOpps = [];
    const lostOpps = [];
    let totalPipelineValue = 0;
    let totalWonMRR = 0;

    // Status type mapping
    const statusTypeMap = {};
    for (const s of statuses) {
      statusTypeMap[s.id] = s.type; // 'active', 'won', 'lost'
    }

    for (const opp of opps) {
      const monthly = toMonthly(opp);
      const lead = leadMap[opp.lead_id] || {};
      const custom = lead.custom || {};

      // Find A2P field
      let a2pStatus = '';
      let pipelineReview = '';
      if (!a2pFieldId) {
        for (const [k, v] of Object.entries(custom)) {
          if (typeof v === 'string' && v.match(/^\d+\.\s+/)) {
            a2pFieldId = k;
            a2pStatus = v;
            break;
          }
        }
      } else {
        a2pStatus = custom[a2pFieldId] || '';
      }
      if (!pipelineFieldId) {
        for (const [k, v] of Object.entries(custom)) {
          if (k !== a2pFieldId && typeof v === 'string' && v.length > 20) {
            pipelineFieldId = k;
            pipelineReview = v;
            break;
          }
        }
      } else {
        pipelineReview = custom[pipelineFieldId] || '';
      }

      // Age in days
      const created = new Date(opp.date_created);
      const ageDays = Math.floor((Date.now() - created.getTime()) / 86400000);

      const enriched = {
        ...opp,
        monthly_value: monthly,
        age_days: ageDays,
        a2p_status: a2pStatus,
        a2p_stage: a2pStage(a2pStatus),
        pipeline_review: pipelineReview,
        lead_display_name: opp.lead_name || lead.display_name || '',
      };

      const sType = statusTypeMap[opp.status_id] || opp.status_type || '';
      if (sType === 'won') {
        wonOpps.push(enriched);
        totalWonMRR += monthly;
      } else if (sType === 'lost') {
        lostOpps.push(enriched);
      } else {
        activeOpps.push(enriched);
        totalPipelineValue += monthly;
      }
    }

    // Sort active by monthly value desc
    activeOpps.sort((a, b) => b.monthly_value - a.monthly_value);

    // KPI calculations
    const totalLeads = leads.length;
    const activeCount = activeOpps.length;
    const wonCount = wonOpps.length;
    const lostCount = lostOpps.length;

    // Win rate
    const closedTotal = wonCount + lostCount;
    const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : 0;

    // Average deal size (won)
    const avgDealSize = wonCount > 0 ? Math.round(totalWonMRR / wonCount) : 0;

    // A2P breakdown for active
    const a2pBreakdown = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const o of activeOpps) {
      const stage = o.a2p_stage;
      a2pBreakdown[stage] = (a2pBreakdown[stage] || 0) + 1;
    }

    // Pipeline by status label
    const pipelineByStatus = {};
    for (const o of activeOpps) {
      const label = o.status_label || 'Unknown';
      if (!pipelineByStatus[label]) pipelineByStatus[label] = { count: 0, value: 0 };
      pipelineByStatus[label].count++;
      pipelineByStatus[label].value += o.monthly_value;
    }

    // Won MRR over time (by month)
    const mrrByMonth = {};
    for (const o of wonOpps) {
      const d = new Date(o.date_won || o.date_updated);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      mrrByMonth[key] = (mrrByMonth[key] || 0) + o.monthly_value;
    }

    res.json({
      kpis: {
        total_leads: totalLeads,
        active_opportunities: activeCount,
        pipeline_mrr: Math.round(totalPipelineValue),
        won_mrr: Math.round(totalWonMRR),
        win_rate: winRate,
        avg_deal_size: avgDealSize,
        won_count: wonCount,
        lost_count: lostCount,
        closed_total: closedTotal,
      },
      active_opportunities: activeOpps,
      won_opportunities: wonOpps.slice(0, 50),
      lost_opportunities: lostOpps.slice(0, 50),
      pipeline_by_status: pipelineByStatus,
      mrr_by_month: mrrByMonth,
      a2p_breakdown: a2pBreakdown,
      statuses,
      field_ids: { a2p: a2pFieldId, pipeline_review: pipelineFieldId },
    });
  } catch (e) {
    console.error('Dashboard error:', e.response?.data || e.message);
    res.status(500).json({ error: e.message, detail: e.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MessageDesk Dashboard running on http://localhost:${PORT}`));
