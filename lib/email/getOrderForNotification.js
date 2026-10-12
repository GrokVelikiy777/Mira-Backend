/**
 * lib/email/getOrderForNotification.js
 * ─────────────────────────────────────────────────────────────
 * Thin wrapper around the `get_order_for_notification(p_order_number,
 * p_secret)` Postgres RPC (migration 017) — the same function
 * api/order.js's Telegram callback handler already calls via its own
 * local callSupabaseRpc(). Kept as a separate small module (rather
 * than importing order.js) so api/notify-status.js doesn't pull in
 * Telegram bot code it has nothing to do with — same "each api/*.js
 * function is self-contained, shared code lives in lib/" split
 * api/reservation.js's own top-of-file comment already documents for
 * this codebase.
 *
 * @param {string} orderNumber
 * @param {string} secret        SUPABASE_RPC_SECRET
 * @returns {Promise<{data: object|null, error: Error|null}>}
 */
async function getOrderForNotification(orderNumber, secret) {
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: new Error('SUPABASE_URL or SUPABASE_ANON_KEY not configured') };
  }

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_for_notification`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_order_number: orderNumber, p_secret: secret })
    });
  } catch (err) {
    return { data: null, error: err };
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { data: null, error: new Error(`Could not parse Supabase response (HTTP ${res.status})`) };
  }

  if (!res.ok) {
    const message = (body && (body.message || body.hint || body.error_description)) || `HTTP ${res.status}`;
    const err = new Error(message);
    err.details = body;
    err.status  = res.status;
    return { data: null, error: err };
  }

  return { data: body, error: null };
}

module.exports = { getOrderForNotification };
