/**
 * lib/email/releaseStatusEmailNotification.js
 * ─────────────────────────────────────────────────────────────
 * Compensating action for claimStatusEmailNotification.js, used only
 * by api/notify-pickup-ready.js: if notifyCustomer() reports the
 * pickup-ready email failed to send, this deletes the claim row that
 * was already inserted, so a retry of the same (orderNumber,
 * 'ready_for_pickup') pair can claim again instead of being told
 * "already-notified" for an email that was never actually delivered.
 *
 * Not used by the accepted/on_the_way flow — there, staying claimed
 * even after a failed send is intentional (Telegram vs Admin race;
 * see claimStatusEmailNotification.js's own comment). This button has
 * exactly one caller, so releasing on failure is safe and matches the
 * explicit "a failed send must not be marked as sent, must be
 * retryable" requirement for this feature.
 *
 * Best-effort: if the release call itself fails, this only logs — the
 * worst case is the same as before this file existed (a stuck claim
 * that staff can't retry until someone clears it manually), never a
 * false "sent" state.
 *
 * @param {string} orderNumber
 * @param {string} status
 * @param {string} secret     SUPABASE_RPC_SECRET
 * @returns {Promise<boolean>} true if the release call succeeded
 */
async function releaseStatusEmailNotification(orderNumber, status, secret) {
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !secret) {
    console.error('[EmailDedup] releaseStatusEmailNotification: missing config — cannot release claim for', orderNumber, status);
    return false;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/release_status_email_notification`, {
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
      console.error(`[EmailDedup] release_status_email_notification returned HTTP ${res.status} for ${orderNumber}/${status} —`, body);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[EmailDedup] release_status_email_notification request failed for ${orderNumber}/${status} —`, err && err.message);
    return false;
  }
}

module.exports = { releaseStatusEmailNotification };
