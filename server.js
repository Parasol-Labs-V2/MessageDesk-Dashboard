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

const MID_FUNNEL_IDS = new Set([
  '3446820539','3467751100','3446820540',
  '3467565765','3477604030','3446820542',
]);

const QUALIFIED_STAGE_IDS = new Set([
  '3467751100','3446820540','3467565765','3477604030','3446820542','3446820543',
]);

const OWNER_MAP = {
  '163553901': 'Jonathan Goldberg',
  '163553854': 'Florencia Scopp',
  '163553855': 'Florencia Scopp',
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

async function fetchAllOwners() {
  try {
    let after = null;
    let total = 0;
    while (true) {
      const url = `https://api.hubapi.com/crm/v3/owners?limit=100${after ? '&after=' + encodeURIComponent(after) : ''}`;
      const res = await fetch(url, { headers: hubHeaders() });
      if (!res.ok) break;
      const data = await res.json();
      for (const o of data.results || []) {
        const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || `Owner ${o.id}`;
        if (!OWNER_MAP[String(o.id)]) _ownerCache[String(o.id)] = name;
        total++;
      }
      after = data.paging && data.paging.next && data.paging.next.after;
      if (!after) break;
    }
    console.log(`Pre-loaded ${total} HubSpot owners into cache`);
  } catch (e) {
    console.warn('fetchAllOwners failed:', e.message);
  }
}

function getWeekBoundaries() {
  const now = new Date();
  const daysSinceMon = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const thisMon = new Date(now);
  thisMon.setDate(now.getDate() - daysSinceMon);
  thisMon.setHours(0, 0, 0, 0);
  const lastMon = new Date(thisMon);
  lastMon.setDate(thisMon.getDate() - 7);
  return { wtdStart: thisMon.getTime(), lastWeekStart: lastMon.getTime(), lastWeekEnd: thisMon.getTime() - 1 };
}

async function fetchEngagementsInRange(type, fromMs, toMs) {
  try {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${type}/search`, {
      method: 'POST',
      headers: hubHeaders(),
      body: JSON.stringify({
        filterGroups: [{
          filters: [
            { propertyName: 'hs_timestamp', operator: 'GTE', value: String(fromMs) },
            { propertyName: 'hs_timestamp', operator: 'LTE', value: String(toMs)  },
          ],
        }],
        properties: ['hubspot_owner_id', 'hs_timestamp'],
        limit: 100,
      }),
    });
    if (!res.ok) return [];
    return (await res.json()).results || [];
  } catch (e) {
    console.warn(`fetchEngagementsInRange(${type}) failed:`, e.message);
    return [];
  }
}

async function fetchWeeklyEngagements(type, cutoffMs) {
  try {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${type}/search`, {
      method: 'POST',
      headers: hubHeaders(),
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'hs_timestamp', operator: 'GTE', value: String(cutoffMs) }],
        }],
        properties: ['hubspot_owner_id', 'hs_timestamp'],
        limit: 100,
      }),
    });
    if (!res.ok) return [];
    return (await res.json()).results || [];
  } catch (e) {
    console.warn(`fetchWeeklyEngagements(${type}) failed:`, e.message);
    return [];
  }
}

async function doRefresh() {
  await fetchAllOwners();
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

  _cache = { deals, updatedAt: new Date().toISOString() };
  _cacheTime = Date.now();
  _tpCache = null; _tpCacheTime = 0; // invalidate TP cache on deal refresh
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
            { propertyName: 'hs_meeting_start_time', operator: 'BETWEEN', value: String(past14), highValue: String(next7) },
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

let _tpCache = null, _tpCacheTime = 0;

// ── /api/team-performance — per-owner breakdown with calls, notes, richer stats ─
app.get('/api/team-performance', async (req, res) => {
  try {
    if (_tpCache && Date.now() - _tpCacheTime < TTL) return res.json(_tpCache);

    const { deals, updatedAt } = await getData();
    const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const { wtdStart, lastWeekStart, lastWeekEnd } = getWeekBoundaries();

    // Fetch calls + notes (rolling 7d) plus WTD and last-week calls in parallel
    const [callsRaw, notesRaw, wtdCallsRaw, lwCallsRaw] = await Promise.all([
      fetchWeeklyEngagements('calls', weekCutoff),
      fetchWeeklyEngagements('notes', weekCutoff),
      fetchEngagementsInRange('calls', wtdStart, Date.now()),
      fetchEngagementsInRange('calls', lastWeekStart, lastWeekEnd),
    ]);

    // Resolve all owner IDs from engagements upfront
    const engagementOwnerIds = [...new Set([
      ...callsRaw.map(r => r.properties && r.properties.hubspot_owner_id),
      ...notesRaw.map(r => r.properties && r.properties.hubspot_owner_id),
    ].filter(Boolean))];
    await Promise.all(engagementOwnerIds.map(resolveOwner));

    function ownerNameFromId(id) {
      if (!id) return null;
      return OWNER_MAP[id] || _ownerCache[id] || null;
    }

    const callsByOwner = {};
    for (const c of callsRaw) {
      const name = ownerNameFromId(c.properties && c.properties.hubspot_owner_id);
      if (name) callsByOwner[name] = (callsByOwner[name] || 0) + 1;
    }
    const notesByOwner = {};
    for (const n of notesRaw) {
      const name = ownerNameFromId(n.properties && n.properties.hubspot_owner_id);
      if (name) notesByOwner[name] = (notesByOwner[name] || 0) + 1;
    }

    const totalActiveLives = deals.filter(d => d.isActive).reduce((s, d) => s + d.lives, 0);

    const byOwner = {};
    for (const d of deals) {
      if (!byOwner[d.owner]) {
        byOwner[d.owner] = {
          owner:                d.owner,
          totalDeals:           0,
          activeDeals:          0,
          activeLives:          0,
          contacted:            0,
          engaged:              0,
          loiSent:              0,
          enrolled:             0,
          lostDQ:               0,
          untouched:            0,
          meetingsBooked:       0,
          totalOutreachAttempts:0,
          lastActivity:         null,
        };
      }
      const o = byOwner[d.owner];
      o.totalDeals++;

      if (d.isActive) {
        o.activeDeals++;
        o.activeLives           += d.lives;
        o.totalOutreachAttempts += d.outreachAttempts;
        if (d.outreachAttempts === 0)     o.untouched++;
        if (d.outreachAttempts > 0)       o.contacted++;
        if (MID_FUNNEL_IDS.has(d.stageId)) o.engaged++;
        if (d.meetingDate)                o.meetingsBooked++;
      }
      if (d.loiSentDate) o.loiSent++;
      if (d.isWon)       o.enrolled++;
      if (d.isLost || d.isDQ) o.lostDQ++;

      const candidates = [d.lastOutreachDate, d.lastModified ? d.lastModified.split('T')[0] : null]
        .filter(Boolean);
      for (const c of candidates) {
        if (!o.lastActivity || c > o.lastActivity) o.lastActivity = c;
      }
    }

    const owners = Object.values(byOwner)
      .filter(o => o.totalDeals > 0)
      .map(o => ({
        ...o,
        pipelinePct:   totalActiveLives > 0 ? Math.round((o.activeLives / totalActiveLives) * 100) : 0,
        callsThisWeek: callsByOwner[o.owner] || 0,
        notesThisWeek: notesByOwner[o.owner] || 0,
      }))
      .sort((a, b) => b.activeLives - a.activeLives);

    // Accounts needing attention: active, no outreach and >7 days old, OR last outreach >14 days ago
    const attention = deals
      .filter(d => {
        if (!d.isActive) return false;
        const ageDays = d.createDate
          ? (Date.now() - new Date(d.createDate).getTime()) / 86400000
          : 0;
        const daysSinceOutreach = d.lastOutreachDate
          ? (Date.now() - new Date(d.lastOutreachDate).getTime()) / 86400000
          : Infinity;
        return (d.outreachAttempts === 0 && ageDays > 7) || daysSinceOutreach > 14;
      })
      .map(d => ({
        id:               d.id,
        dealname:         d.dealname,
        stageId:          d.stageId,
        stage:            d.stage,
        owner:            d.owner,
        lives:            d.lives,
        outreachAttempts: d.outreachAttempts,
        lastOutreachDate: d.lastOutreachDate,
        createDate:       d.createDate ? d.createDate.split('T')[0] : null,
      }))
      .sort((a, b) => b.lives - a.lives);

    // Week-bounded deal metrics
    function dealActivity(fromMs, toMs) {
      const subset = deals.filter(d => {
        if (!d.lastModified) return false;
        const ms = new Date(d.lastModified).getTime();
        return ms >= fromMs && ms <= toMs;
      });
      return {
        meetingsBooked: subset.filter(d => d.stageId === '3467751100').length,
        dealsForward:   subset.filter(d => QUALIFIED_STAGE_IDS.has(d.stageId)).length,
      };
    }
    const wtdDeals = dealActivity(wtdStart, Date.now());
    const lwDeals  = dealActivity(lastWeekStart, lastWeekEnd);

    const payload = {
      owners,
      attention,
      activity: {
        wtd:      { calls: wtdCallsRaw.length,  ...wtdDeals },
        lastWeek: { calls: lwCallsRaw.length,   ...lwDeals  },
      },
      summary: {
        totalOwners:        owners.length,
        totalUntouched:     owners.reduce((s, o) => s + o.untouched, 0),
        totalMeetings:      owners.reduce((s, o) => s + o.meetingsBooked, 0),
        totalActiveLives,
        totalCallsThisWeek: owners.reduce((s, o) => s + o.callsThisWeek, 0),
        totalNotesThisWeek: owners.reduce((s, o) => s + o.notesThisWeek, 0),
      },
      updatedAt,
    };
    _tpCache = payload; _tpCacheTime = Date.now();
    res.json(payload);
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
