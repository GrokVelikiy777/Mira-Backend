/**
 * ══════════════════════════════════════════════════════════════
 *  TAKASHI RESTAURANT — "Order Ready" Pickup Notification Endpoint
 *  ─────────────────────────────────────────────────────────────
 *  Thin, authenticated bridge between the Admin Dashboard
 *  (takashi-admin, app/(dashboard)/orders/actions.ts) and the
 *  existing email system in ../lib/email/. Triggered ONLY by staff
 *  clicking "Bestellung fertig — Kunde benachrichtigen" on a pickup
 *  order — never automatic, never tied to a status transition.
 *
 *  Mirrors api/notify-status.js almost exactly (same auth pattern,
 *  same claim → fetch → notifyCustomer pipeline), but is a SEPARATE
 *  file rather than a third branch inside notify-status.js because
 *  the business rules genuinely differ:
 *    - notify-status.js only fires AFTER update_order_status already
 *      committed a real status change (accepted/on_the_way).
 *    - This endpoint does NOT change orders.status at all — it is a
 *      standalone, repeatable-until-sent-once notification, and the
 *      project has no dedicated "ready" order status to reuse (order
 *      lifecycle is new → accepted → cooking → on_the_way → delivered
 *      → cancelled; pickup orders go straight from cooking/accepted
 *      to delivered when staff hand the food over — see
 *      order_statuses / status_transitions). Keeping it separate means
 *      the already-live, working notify-status.js is not touched.
 *
 *  ENVIRONMENT VARIABLES NEEDED (in addition to what api/order.js and
 *  ../lib/email/ already require):
 *
 *    NOTIFY_STATUS_ENDPOINT_SECRET
 *      Reused as-is from notify-status.js — same trust boundary (the
 *      Admin Dashboard's server-only actions.ts is the only caller of
 *      either endpoint), so no new secret was introduced.
 *
 *  AUTHORIZATION MODEL:
 *    - Bearer-token check identical to notify-status.js.
 *    - Only orders with orderType 'abholung' (pickup) are accepted —
 *      a delivery order returns 400. This is enforced here, not just
 *      hidden in the Admin UI, so a regular customer (who has no way
 *      to reach this endpoint at all — no CORS, requires the shared
 *      secret) and a staff mistake are both blocked the same way.
 *    - DEDUP: claim_status_email_notification(order_number,
 *      'ready_for_pickup', secret) — the exact same atomic Postgres
 *      claim table/RPC the status-email system already uses, with a
 *      synthetic status key that is not a real orders.status value.
 *      order_status_email_notifications.status is a bare text column
 *      (no FK/CHECK constraint — confirmed against the live schema),
 *      so this required no migration to that table.
 *    - The Admin Dashboard also reads this same table directly (via a
 *      new staff-only SELECT policy + GRANT, see migrations
 *      20260826_add_release_status_email_notification_and_staff_read.sql
 *      and 20260826_grant_select_order_status_email_notifications.sql)
 *      to render the button as "Kunde benachrichtigt" after a page
 *      reload, without needing a new column on orders.
 *
 *  No CORS headers are set on purpose — server-to-server only, same
 *  as notify-status.js.
 * ══════════════════════════════════════════════════════════════
 */
const { notifyCustomer } = require('../lib/email/notifyCustomer');
const { claimStatusEmailNotification } = require('../lib/email/claimStatusEmailNotification');
const { releaseStatusEmailNotification } = require('../lib/email/releaseStatusEmailNotification');
const { getOrderForNotification } = require('../lib/email/getOrderForNotification');

const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // same shape order.js/notify-status.js already validate against
const NOTIFICATION_KEY = 'ready_for_pickup';

/**
 * Constant-time secret comparison — identical helper to notify-status.js
 * (duplicated rather than imported, per this codebase's own "each
 * api/*.js function is self-contained" convention).
 */
function secretsMatch(a, b) {
  const crypto = require('crypto');
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const expectedSecret = process.env.NOTIFY_STATUS_ENDPOINT_SECRET;
  if (!expectedSecret) {
    console.error('[NotifyPickupReady] NOTIFY_STATUS_ENDPOINT_SECRET not set');
    res.status(500).json({ ok: false, error: 'Endpoint not configured' });
    return;
  }

  const authHeader    = req.headers.authorization || '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!secretsMatch(providedToken, expectedSecret)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Invalid JSON' });
    return;
  }

  const orderNumber = body && body.orderNumber;
  if (typeof orderNumber !== 'string' || !ORDER_NUMBER_PATTERN.test(orderNumber)) {
    res.status(400).json({ ok: false, error: 'Invalid or missing orderNumber' });
    return;
  }

  try {
    const { data: orderForEmail, error: lookupError } = await getOrderForNotification(
      orderNumber,
      process.env.SUPABASE_RPC_SECRET
    );

    if (lookupError || !orderForEmail) {
      console.error(`[NotifyPickupReady] Could not fetch order ${orderNumber} —`, lookupError);
      res.status(404).json({ ok: false, error: 'Order not found' });
      return;
    }

    // Pickup-only guard — enforced here, not just in the Admin UI.
    // get_order_for_notification maps order_type 'pickup' -> 'abholung'.
    if (orderForEmail.orderType !== 'abholung') {
      res.status(400).json({ ok: false, error: 'This notification is only available for pickup orders' });
      return;
    }

    const claimed = await claimStatusEmailNotification(orderNumber, NOTIFICATION_KEY, process.env.SUPABASE_RPC_SECRET);
    if (!claimed) {
      // Not an error — customer was already notified (a previous click,
      // a retried request, ...). Idempotent no-op, same 200 shape as
      // notify-status.js's "already-notified" response.
      res.status(200).json({ ok: true, sent: false, reason: 'already-notified' });
      return;
    }

    const result = await notifyCustomer(orderForEmail, NOTIFICATION_KEY);
    console.log('[NotifyPickupReady] Email result:', { orderNumber, ...result });

    if (!result.sent) {
      // Send failed — release the claim so this is retryable and is
      // never recorded as sent. Best-effort: even if the release call
      // itself fails, we still report sent:false/an error to the
      // caller (never silently claim success), per the feature's
      // explicit "do not mark as sent on failure" requirement.
      await releaseStatusEmailNotification(orderNumber, NOTIFICATION_KEY, process.env.SUPABASE_RPC_SECRET);
    }

    res.status(200).json({ ok: true, sent: result.sent, error: result.error || null });
  } catch (err) {
    console.error(`[NotifyPickupReady] Unexpected failure for ${orderNumber} —`, err && err.message);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
};
