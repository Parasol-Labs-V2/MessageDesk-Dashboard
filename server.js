require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app        = express();
const PORT       = process.env.PORT || 3000;
const HB_KEY     = process.env.HUBSPOT_API_KEY || '';
const PIPELINE_ID = '2168635108';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const STAGE_MAP = {
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

const STAGE_ORDER = [
  '3446819577','3446820538','3446820539','3467751100',
  '3446820540','3467565765','3477604030','3446820542',
  '3446820543','3446820544','3446820545','3446820546',
];

const ACTIVE_STAGE_IDS = new Set([
  '3446819577','3446820538','3446820539','3467751100',
  '3446820540','3467565765','3477604030','3446820542',
]);

const OWNER_MAP = {
  '163553901': 'Jonathan Goldberg',
  '163553854': 'Florencia Scopp',
  '83189293':  'Joe',
};

const PROPS = [
  'dealname','dealstage','pipeline','hubspot_owner_id','closedate',
  'hs_lastmodifieddate','createdate',
  'attribution_2024_lives','gross_savings_2024_deal',
  'outreach_attempt_count','last_outreach_date','meeting_date',
  'loi_sent_date','loi_signed_date','enrollment_date','enrollment_deadline',
  'champion_name','champion_role','lost_reason','deal_source',
  'duet_engaged_owner','secondary_owner','meeting_set','np_intro_made',
];

let _cache = null, _cacheTime = 0, _pending = null;
const TTL = 5 * 60 * 1000;

function hubHeaders() {
  return { Authorization: `Bearer ${HB_KEY}`, 'Content-Type': 'application/json' };
}

function parseDate(val) {
  if (!val) return null;
  const n = Number(val);
  if (!isNaN(n) && n > 1e12) return new Date(n).toISOString().split('T')[0];
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

async function fetchAllDeals() {
  const url = 'https://api.hubapi.com/crm/v3/objects/deals/search';
  let all = [], after;

  while (true) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_ID }] }],
      properties: PROPS,
      limit: 100,
    };
    if (after) body.after = after;

    const res = await fetch(url, { method: 'POST', headers: hubHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    all = all.concat(data.results || []);
    console.log(`Fetched ${all.length} deals`);
    after = data.paging && data.paging.next && data.paging.next.after;
    if (!after) break;
  }

  console.log(`Total: ${all.length} deals`);
  return all;
}

function mapDeal(raw) {
  const p       = raw.properties || {};
  const stageId = p.dealstage || '';
  const ownerId = p.hubspot_owner_id || '';
  return {
    id:                 raw.id,
    dealname:           p.dealname || 'Unnamed Deal',
    stageId,
    stage:              STAGE_MAP[stageId] || stageId || 'Unknown',
    stageOrder:         STAGE_ORDER.indexOf(stageId),
    isActive:           ACTIVE_STAGE_IDS.has(stageId),
    isWon:              stageId === '3446820543',
    isLost:             stageId === '3446820544',
    isComeBack:         stageId === '3446820545',
    isDQ:               stageId === '3446820546',
    ownerId,
    owner:              OWNER_MAP[ownerId] || (ownerId ? `Owner ${ownerId}` : 'Unassigned'),
    closedate:          parseDate(p.closedate),
    lastModified:       p.hs_lastmodifieddate ? new Date(p.hs_lastmodifieddate).toISOString() : null,
    createDate:         p.createdate ? new Date(p.createdate).toISOString() : null,
    lives:              parseInt(p.attribution_2024_lives)   || 0,
    grossSavings:       parseFloat(p.gross_savings_2024_deal) || 0,
    outreachAttempts:   parseInt(p.outreach_attempt_count)   || 0,
    lastOutreachDate:   parseDate(p.last_outreach_date),
    meetingDate:        parseDate(p.meeting_date),
    loiSentDate:        parseDate(p.loi_sent_date),
    loiSignedDate:      parseDate(p.loi_signed_date),
    enrollmentDate:     parseDate(p.enrollment_date),
    enrollmentDeadline: parseDate(p.enrollment_deadline),
    championName:       p.champion_name    || null,
    championRole:       p.champion_role    || null,
    lostReason:         p.lost_reason      || null,
    dealSource:         p.deal_source      || null,
    duetEngagedOwner:   p.duet_engaged_owner || null,
    secondaryOwner:     p.secondary_owner  || null,
    meetingSet:         p.meeting_set      || null,
    npIntroMade:        p.np_intro_made    || null,
  };
}

async function doRefresh() {
  const raw   = await fetchAllDeals();
  const deals = raw.map(mapDeal);
  _cache     = { deals, updatedAt: new Date().toISOString() };
  _cacheTime  = Date.now();
  console.log('Cache ready:', deals.length, 'deals');
  return _cache;
}

async function getData(force = false) {
  if (!force && _cache && Date.now() - _cacheTime < TTL) return _cache;
  if (!_pending) _pending = doRefresh().finally(() => { _pending = null; });
  return _pending;
}

app.get('/api/deals', async (req, res) => {
  try {
    res.json(await getData(req.query.refresh === '1'));
  } catch (e) {
    console.error('Deals error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pipeline-stats', async (req, res) => {
  try {
    const { deals, updatedAt } = await getData();
    const stats = {};
    for (const id of STAGE_ORDER) {
      stats[id] = { stageId: id, stage: STAGE_MAP[id], count: 0, totalLives: 0, totalSavings: 0 };
    }
    for (const d of deals) {
      if (stats[d.stageId]) {
        stats[d.stageId].count++;
        stats[d.stageId].totalLives   += d.lives;
        stats[d.stageId].totalSavings += d.grossSavings;
      }
    }
    res.json({ stages: Object.values(stats), updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Duet Dashboard → http://localhost:${PORT}`);
    getData().catch(console.error);
  });
}

module.exports = app;
