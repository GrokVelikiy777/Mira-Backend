/**
 * lib/email/claimStatusEmailNotification.js
 * ─────────────────────────────────────────────────────────────
 * Cross-process idempotency guard for status-change customer emails.
 * Two independent callers can now trigger the same (orderNumber,
 * status) email — the Telegram bot's callback handler (api/order.js)
 * and the Admin Dashboard's notify endpoint (api/notify-status.js).
 * They're separate serverless invocations with no shared memory, so
 * the pre-existing in-memory messageStore dedup can't guarantee
 * "at most one email" between them.
 *
 * This calls the `claim_status_email_notification(p_order_number,
 * p_status, p_secret)` Postgres RPC (see takashi-admin's migration
 * 20260812_add_order_status_email_dedup.sql), which atomically
 * inserts into order_status_email_notifications and returns whether
 * THIS call was the one that inserted the row. Postgres's primary key
 * enforces that at most one concurrent caller gets `true` back for
 * the same (orderNumber, status) — that's what makes this safe under
 * a simultaneous Admin + Telegram click.
 *
 * AUTHORIZATION: p_secret must match public.rpc_secrets.notification_secret
 * — the exact same secret get_order_for_notification already requires.
 * Without it, the RPC is callable by anyone holding only the public
 * anon key (it's shipped to browsers elsewhere in this project) and
 * could be used to pre-claim rows and silently suppress a real
 * customer's status email. Callers must pass SUPABASE_RPC_SECRET.
 *
 * Mirrors api/order.js's own callSupabaseRpc() request shape (native
 * fetch, PostgREST /rest/v1/rpc/<fn>, anon key) rather than importing
 * it, so this file stays independently usable from both api/order.js
 * and api/notify-status.js without either depending on the other.
 *
 * FAIL-CLOSED BY DESIGN: if the secret is missing/wrong, the RPC call
 * fails outright, or the RPC itself isn't reachable yet (e.g. the
 * migration above hasn't been applied), this resolves to `false` —
 * i.e. "do NOT send". This is a deliberate reversal from an earlier
 * fail-open draft: since this claim now doubles as an authorization
 * gate, silently failing open would mean a misconfigured secret (or a
 * not-yet-applied migration) quietly disables the gate rather than
 * blocking sends — worse than an occasional missed status email,
 * which staff can always resend by re-triggering the status change.
 * Every failure is logged so it's visible, never silent.
 *
 * @param {string} orderNumber
 * @param {string} status
 * @param {string} secret     SUPABASE_RPC_SECRET — same value passed
 *                              to get_order_for_notification.
 * @returns {Promise<boolean>} true = claimed, caller should send.
 *                              false = already sent by someone else,
 *                              OR the claim could not be verified —
 *                              caller should skip either way.
 */
async function claimStatusEmailNotification(orderNumber, status, secret) {
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[EmailDedup] SUPABASE_URL/SUPABASE_ANON_KEY not configured — failing closed, NOT sending');
    return false;
  }

  if (!secret) {
    console.error('[EmailDedup] No secret provided to claimStatusEmailNotification — failing closed, NOT sending');
    return false;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_status_email_notification`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_order_number: orderNumber, p_status: status, p_secret: secret })
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[EmailDedup] claim_status_email_notification returned HTTP ${res.status} for ${orderNumber}/${status} — failing closed, NOT sending —`,
        body
      );
      return false;
    }

    const claimed = await res.json();
    return claimed === true;
  } catch (err) {
    console.error(
      `[EmailDedup] claim_status_email_notification request failed for ${orderNumber}/${status} — failing closed, NOT sending —`,
      err && err.message
    );
    return false;
  }
}

module.exports = { claimStatusEmailNotification };
