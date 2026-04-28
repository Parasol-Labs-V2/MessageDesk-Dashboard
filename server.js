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
  '163575365': 'Jonathan Goldberg',
};

// Cache for owner names fetched from HubSpot (persists for the process lifetime)
const _ownerCache = {};

async function resolveOwner(ownerId) {
  if (!ownerId) return 'Unassigned';
  if (OWNER_MAP[ownerId]) return OWNER_MAP[ownerId];
  if (_ownerCache[ownerId]) return _ownerCache[ownerId];

  try {
    const res = await fetch(`https://api.hubapi.com/crm/v3/owners/${ownerId}`, {
      headers: hubHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || data.email || `Owner ${ownerId}`;
      _ownerCache[ownerId] = name;
      console.log(`Resolved owner ${ownerId} → ${name}`);
      return name;
    }
  } catch (e) {
    console.warn(`Could not resolve owner ${ownerId}:`, e.message);
  }

  _ownerCache[ownerId] = `Owner ${ownerId}`;
  return _ownerCache[ownerId];
}

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

function mapDeal(raw, ownerName) {
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
    owner:              ownerName,
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
  const raw = await fetchAllDeals();

  // Collect unique unknown owner IDs and resolve them in parallel
  const unknownIds = [...new Set(
    raw.map(r => r.properties && r.properties.hubspot_owner_id).filter(id => id && !OWNER_MAP[id] && !_ownerCache[id])
  )];
  await Promise.all(unknownIds.map(resolveOwner));

  const deals = await Promise.all(raw.map(async r => {
    const ownerId = r.properties && r.properties.hubspot_owner_id;
    const ownerName = await resolveOwner(ownerId);
    return mapDeal(r, ownerName);
  }));

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

// ── /api/meetings — HubSpot meeting engagements, enriched with deal data ───────
app.get('/api/meetings', async (req, res) => {
  try {
    await getData(); // ensure deal cache is warm

    const now    = Date.now();
    const past14 = now - 14 * 24 * 60 * 60 * 1000;
    const next7  = now +  7 * 24 * 60 * 60 * 1000;

    // 1. Search meetings in the window [past14, next7]
    const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/meetings/search', {
      method: 'POST',
      headers: hubHeaders(),
      body: JSON.stringify({
        filterGroups: [{
          filters: [
            { propertyName: 'hs_meeting_start_time', operator: 'GTE', value: String(past14) },
            { propertyName: 'hs_meeting_start_time', operator: 'LTE', value: String(next7)  },
          ],
        }],
        properties: ['hs_meeting_title','hs_meeting_start_time','hs_meeting_end_time',
                     'hubspot_owner_id','hs_meeting_outcome'],
        limit: 100,
      }),
    });

    if (!searchRes.ok) {
      const txt = await searchRes.text();
      throw new Error(`HubSpot meetings search ${searchRes.status}: ${txt.slice(0, 200)}`);
    }

    const meetings = (await searchRes.json()).results || [];
    if (meetings.length === 0) {
      return res.json({ upcoming: [], recent: [], fetchedAt: new Date().toISOString() });
    }

    // 2. Batch-fetch meeting → deal associations
    const dealIdsByMeeting = {};
    try {
      const assocRes = await fetch('https://api.hubapi.com/crm/v4/associations/meetings/deals/batch/read', {
        method: 'POST',
        headers: hubHeaders(),
        body: JSON.stringify({ inputs: meetings.map(m => ({ id: m.id })) }),
      });
      if (assocRes.ok) {
        const assocData = await assocRes.json();
        for (const r of (assocData.results || [])) {
          dealIdsByMeeting[r.from.id] = (r.to || []).map(t => t.toObjectId || t.id);
        }
      }
    } catch (e) {
      console.warn('Association fetch failed:', e.message);
    }

    // 3. Build enriched meeting objects
    const dealById = {};
    if (_cache) _cache.deals.forEach(d => { dealById[d.id] = d; });

    const enriched = await Promise.all(meetings.map(async m => {
      const p          = m.properties || {};
      const startMs    = p.hs_meeting_start_time ? parseInt(p.hs_meeting_start_time) : null;
      const endMs      = p.hs_meeting_end_time   ? parseInt(p.hs_meeting_end_time)   : null;
      const ownerName  = await resolveOwner(p.hubspot_owner_id || '');
      const dealIds    = dealIdsByMeeting[m.id] || [];
      const deal       = dealIds.length ? dealById[dealIds[0]] : null;

      return {
        id:          m.id,
        title:       p.hs_meeting_title || '(No title)',
        startMs,
        endMs,
        outcome:     p.hs_meeting_outcome || null,
        owner:       ownerName,
        dealId:      deal ? deal.id       : null,
        dealName:    deal ? deal.dealname : null,
        dealLives:   deal ? deal.lives    : 0,
        dealStage:   deal ? deal.stage    : null,
        dealStageId: deal ? deal.stageId  : null,
      };
    }));

    const upcoming = enriched
      .filter(m => m.startMs && m.startMs >= now && m.startMs <= next7)
      .sort((a, b) => a.startMs - b.startMs);
    const recent = enriched
      .filter(m => m.startMs && m.startMs < now && m.startMs >= past14)
      .sort((a, b) => b.startMs - a.startMs);

    res.json({ upcoming, recent, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Meetings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── /api/team-performance — per-owner breakdown from cached deal data ──────────
app.get('/api/team-performance', async (req, res) => {
  try {
    const { deals, updatedAt } = await getData();

    const byOwner = {};
    for (const d of deals) {
      if (!byOwner[d.owner]) {
        byOwner[d.owner] = {
          owner:                d.owner,
          totalDeals:           0,
          activeDeals:          0,
          activeLives:          0,
          untouched:            0,  // active deals with 0 outreach attempts
          meetingsBooked:       0,  // active deals with meeting_date set
          totalOutreachAttempts:0,
          lastActivity:         null,
        };
      }
      const o = byOwner[d.owner];
      o.totalDeals++;

      if (d.isActive) {
        o.activeDeals++;
        o.activeLives          += d.lives;
        o.totalOutreachAttempts += d.outreachAttempts;
        if (d.outreachAttempts === 0) o.untouched++;
        if (d.meetingDate)            o.meetingsBooked++;
      }

      // Track most recent activity across all deals
      const candidates = [d.lastOutreachDate, d.lastModified ? d.lastModified.split('T')[0] : null]
        .filter(Boolean);
      for (const c of candidates) {
        if (!o.lastActivity || c > o.lastActivity) o.lastActivity = c;
      }
    }

    const owners = Object.values(byOwner)
      .filter(o => o.totalDeals > 0)
      .sort((a, b) => b.activeLives - a.activeLives);

    res.json({
      owners,
      summary: {
        totalOwners:     owners.length,
        totalUntouched:  owners.reduce((s, o) => s + o.untouched, 0),
        totalMeetings:   owners.reduce((s, o) => s + o.meetingsBooked, 0),
        totalActiveLives:owners.reduce((s, o) => s + o.activeLives, 0),
      },
      updatedAt,
    });
  } catch (e) {
    console.error('Team performance error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

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
