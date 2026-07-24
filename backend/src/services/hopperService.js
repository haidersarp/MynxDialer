const { query, queryOne } = require('../db/connection');

let ioInstance = null;

async function refillHopper() {
  try {
    const campaigns = await query("SELECT * FROM campaigns WHERE status = 'active' AND (account_id IS NULL OR account_id NOT IN (SELECT id FROM accounts WHERE status = 'suspended'))");

    for (const campaign of campaigns) {
      const hopperLevel = parseInt(campaign.hopper_level) || 100;
      // Low-water mark: only refill once the hopper drains to this, then top it
      // back up to hopperLevel. Default 10% of the level (min 1) if unset.
      const threshold = campaign.hopper_threshold != null
        ? parseInt(campaign.hopper_threshold)
        : Math.max(1, Math.floor(hopperLevel * 0.1));

      const currentRow = await queryOne(
        "SELECT COUNT(*) as c FROM hopper WHERE campaign_id = ? AND status = 'ready'",
        [campaign.id]
      );
      const current = parseInt(currentRow.c) || 0;
      // Wait until it drops to/below the threshold before refilling.
      if (current > threshold) continue;
      let needed = hopperLevel - current;
      if (needed <= 0) continue;

      let added = 0;

      // ── Priority 1: Callbacks due now (priority 100) ──────────────
      if (added < needed) {
        const limit = needed - added;
        const existing = await query(
          'SELECT lead_id FROM hopper WHERE campaign_id = ?',
          [campaign.id]
        );
        const existingIds = existing.map(r => r.lead_id);

        const callbacks = await query(
          `SELECT l.id FROM leads l
           WHERE l.campaign_id = ${campaign.id}
             AND l.status = 'callback'
             AND l.callback_at <= NOW()
             AND l.assigned_agent IS NULL
             AND l.phone NOT IN (SELECT phone FROM dnc_list WHERE account_id = ${campaign.account_id || 0})
           LIMIT ${limit}`
        );

        for (const lead of callbacks) {
          if (existingIds.includes(lead.id)) continue;
          await query(
            'INSERT IGNORE INTO hopper (campaign_id, lead_id, priority) VALUES (?, ?, 100)',
            [campaign.id, lead.id]
          ).catch(() => {});
          added++;
        }
      }

      // ── Priority 2: New leads (priority 50) — respects list active/order ──
      if (added < needed) {
        const limit = needed - added;
        const existing = await query('SELECT lead_id FROM hopper WHERE campaign_id = ?', [campaign.id]);
        const existingIds = existing.map(r => r.lead_id);

        // Active lists: determines which leads are eligible + their order
        const activeLists = await query(
          "SELECT id, dial_order, dial_mode, seq_position FROM lead_lists WHERE campaign_id = ? AND active = 1 ORDER BY seq_position ASC, created_at ASC",
          [campaign.id]
        );
        const activeListIds = activeLists.map(l => l.id);

        // Ineligible: leads in INACTIVE lists (skip them)
        const inactiveLists = await query(
          "SELECT id FROM lead_lists WHERE campaign_id = ? AND active = 0",
          [campaign.id]
        );
        const inactiveIds = inactiveLists.map(l => l.id);
        const inactiveFilter = inactiveIds.length > 0 ? `AND (l.list_id IS NULL OR l.list_id NOT IN (${inactiveIds.join(',')}))` : '';

        // Determine ORDER BY from active lists
        const primaryList = activeLists[0];
        const orderBy = primaryList?.dial_order === 'desc' ? 'l.created_at DESC' : 'l.created_at ASC';

        const newLeads = await query(
          `SELECT l.id FROM leads l
           WHERE l.campaign_id = ${campaign.id}
             AND l.status = 'new'
             AND l.assigned_agent IS NULL
             AND (l.not_before IS NULL OR l.not_before <= NOW())
             AND l.phone NOT IN (SELECT phone FROM dnc_list WHERE account_id = ${campaign.account_id || 0})
             ${inactiveFilter}
           ORDER BY ${orderBy}
           LIMIT ${limit}`
        );

        for (const lead of newLeads) {
          if (existingIds.includes(lead.id)) continue;
          await query(
            'INSERT IGNORE INTO hopper (campaign_id, lead_id, priority) VALUES (?, ?, 50)',
            [campaign.id, lead.id]
          ).catch(() => {});
          added++;
        }
      }

      // ── Priority 3: Recycled leads after retry delay (priority 25) ──
      if (added < needed) {
        const limit  = needed - added;
        const delay  = parseInt(campaign.retry_delay) || 3600;
        const maxAtt = parseInt(campaign.max_attempts) || 3;

        const existing = await query(
          'SELECT lead_id FROM hopper WHERE campaign_id = ?',
          [campaign.id]
        );
        const existingIds = existing.map(r => r.lead_id);

        const recycled = await query(
          `SELECT l.id FROM leads l
           WHERE l.campaign_id = ${campaign.id}
             AND l.status IN ('called','no_answer','busy')
             AND l.attempts < ${maxAtt}
             AND l.assigned_agent IS NULL
             AND (l.last_attempt IS NULL OR TIMESTAMPDIFF(SECOND, l.last_attempt, NOW()) >= ${delay})
             AND l.phone NOT IN (SELECT phone FROM dnc_list WHERE account_id = ${campaign.account_id || 0})
           ORDER BY l.attempts ASC, l.last_attempt ASC
           LIMIT ${limit}`
        );

        for (const lead of recycled) {
          if (existingIds.includes(lead.id)) continue;
          await query(
            'INSERT IGNORE INTO hopper (campaign_id, lead_id, priority) VALUES (?, ?, 25)',
            [campaign.id, lead.id]
          ).catch(() => {});
          added++;
        }
      }

      if (added > 0) {
        console.log(`[Hopper] Campaign "${campaign.name}" refilled +${added} leads (total ~${current + added}/${hopperLevel})`);
        if (ioInstance) {
          ioInstance.to('admins').emit('hopper:updated', {
            campaign_id: campaign.id,
            added,
            total: current + added,
            hopper_level: hopperLevel
          });
        }
      }
    }
  } catch (err) {
    console.error('[Hopper] Refill error:', err.message);
  }
}

async function getHopperStats(campaignId) {
  try {
    const row = await queryOne(
      `SELECT
         SUM(CASE WHEN status = 'ready'   THEN 1 ELSE 0 END) as ready,
         SUM(CASE WHEN status = 'dialing' THEN 1 ELSE 0 END) as dialing,
         COUNT(*) as total,
         SUM(CASE WHEN priority = 100 THEN 1 ELSE 0 END) as callbacks,
         SUM(CASE WHEN priority = 50  THEN 1 ELSE 0 END) as new_leads,
         SUM(CASE WHEN priority = 25  THEN 1 ELSE 0 END) as recycled
       FROM hopper WHERE campaign_id = ?`,
      [campaignId]
    );
    return {
      ready:     parseInt(row?.ready)    || 0,
      dialing:   parseInt(row?.dialing)  || 0,
      total:     parseInt(row?.total)    || 0,
      callbacks: parseInt(row?.callbacks)|| 0,
      new_leads: parseInt(row?.new_leads)|| 0,
      recycled:  parseInt(row?.recycled) || 0
    };
  } catch (err) {
    return { ready: 0, dialing: 0, total: 0, callbacks: 0, new_leads: 0, recycled: 0 };
  }
}

async function flushHopper(campaignId) {
  await query("DELETE FROM hopper WHERE campaign_id = ? AND status = 'ready'", [campaignId]);
  await refillHopper();
}

function initHopperService(io) {
  ioInstance = io;
  const interval = parseInt(process.env.HOPPER_INTERVAL) || 5000;
  console.log(`[Hopper] Service started (refill every ${interval}ms)`);
  refillHopper();
  setInterval(refillHopper, interval);
}

module.exports = { initHopperService, refillHopper, getHopperStats, flushHopper };