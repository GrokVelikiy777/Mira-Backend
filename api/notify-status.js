/**
 * ══════════════════════════════════════════════════════════════
 *  TAKASHI RESTAURANT — Admin Status-Change Notification Endpoint
 *  ─────────────────────────────────────────────────────────────
 *  Thin, authenticated bridge between the Admin Dashboard
 *  (takashi-admin, app/(dashboard)/orders/actions.ts) and the
 *  existing, already-working email system in ../lib/email/. It does
 *  NOT duplicate any of that system — it only orchestrates three
 *  existing pieces in order:
 *
 *    1. claimStatusEmailNotification()   — atomic Postgres dedup claim
 *    2. getOrderForNotification()        — get_order_for_notification RPC
 *    3. notifyCustomer()                 — same function order.js's
 *                                            Telegram handler already uses
 *
 *  Deployed alongside api/order.js on the same Vercel project, so it
 *  shares that project's env vars.
 *
 *  ENVIRONMENT VARIABLES NEEDED (in addition to what api/order.js and
 *  ../lib/email/ already require — SUPABASE_URL, SUPABASE_ANON_KEY,
 *  SUPABASE_RPC_SECRET, RESEND_API_KEY, EMAIL_*):
 *
 *    NOTIFY_STATUS_ENDPOINT_SECRET
 *      Shared secret this endpoint checks on every request, via
 *      "Authorization: Bearer <secret>". takashi-admin sends the same
 *      value from its own server-only env var of the same name (never
 *      NEXT_PUBLIC_ — it's read only inside a 'use server' action, so
 *      it's never bundled to the browser). Generate a long random
 *      value; it is unrelated to SUPABASE_RPC_SECRET (that one guards
 *      the Postgres RPC directly, this one guards this HTTP endpoint —
 *      keeping them separate limits the blast radius if either leaks).
 *
 *  AUTHORIZATION MODEL:
 *    Only accepted / on_the_way are ever emailed from here (same list
 *    as the Telegram handler — see ../lib/email/notifiableStatuses.js,
 *    the single source of truth both files import). A request for any
 *    other status is rejected with 400, not silently ignored, so a
 *    caller bug is visible instead of a quietly missing email.
 *
 *  No CORS headers are set on purpose: this endpoint is meant to be
 *  called server-to-server only (Next.js Server Action → fetch), never
 *  from a browser. Omitting Access-Control-Allow-Origin means a
 *  browser-based cross-origin call is blocked by default.
 * ══════════════════════════════════════════════════════════════
 */
const { notifyCustomer } = require('../lib/email/notifyCustomer');
const { EMAIL_NOTIFICATION_STATUSES } = require('../lib/email/notifiableStatuses');
const { claimStatusEmailNotification } = require('../lib/email/claimStatusEmailNotification');
const { getOrderForNotification } = require('../lib/email/getOrderForNotification');

const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // same shape order.js already validates orderId against

/**
 * Constant-time secret comparison — avoids leaking how many leading
 * bytes matched via response-time differences. Falls back to `false`
 * on any length mismatch rather than throwing (timingSafeEqual itself
 * throws if the two buffers differ in length).
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
    console.error('[NotifyStatus] NOTIFY_STATUS_ENDPOINT_SECRET not set');
    res.status(500).json({ ok: false, error: 'Endpoint not configured' });
    return;
  }

  const authHeader   = req.headers.authorization || '';
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
  const status       = body && body.status;

  if (typeof orderNumber !== 'string' || !ORDER_NUMBER_PATTERN.test(orderNumber)) {
    res.status(400).json({ ok: false, error: 'Invalid or missing orderNumber' });
    return;
  }
  if (typeof status !== 'string' || !EMAIL_NOTIFICATION_STATUSES.includes(status)) {
    res.status(400).json({
      ok:    false,
      error: `status must be one of: ${EMAIL_NOTIFICATION_STATUSES.join(', ')}`
    });
    return;
  }

  try {
    const claimed = await claimStatusEmailNotification(orderNumber, status, process.env.SUPABASE_RPC_SECRET);
    if (!claimed) {
      // Not an error — someone else (Telegram, a retried request, ...)
      // already sent this exact order+status email. Idempotent no-op.
      res.status(200).json({ ok: true, sent: false, reason: 'already-notified' });
      return;
    }

    const { data: orderForEmail, error: lookupError } = await getOrderForNotification(
      orderNumber,
      process.env.SUPABASE_RPC_SECRET
    );

    if (lookupError || !orderForEmail) {
      console.error(`[NotifyStatus] Could not fetch order ${orderNumber} for status email —`, lookupError);
      res.status(404).json({ ok: false, error: 'Order not found' });
      return;
    }

    const result = await notifyCustomer(orderForEmail, status);
    console.log('[NotifyStatus] Email result:', { orderNumber, status, ...result });

    res.status(200).json({ ok: true, sent: result.sent, error: result.error || null });
  } catch (err) {
    console.error(`[NotifyStatus] Unexpected failure for ${orderNumber}/${status} —`, err && err.message);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
};
