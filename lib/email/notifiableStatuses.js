/**
 * lib/email/notifiableStatuses.js
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for which status changes email the
 * customer. Previously this array lived only inline in
 * api/order.js (the Telegram callback handler). Now that
 * api/notify-status.js (called from the Admin Dashboard) also
 * needs to enforce the exact same list, it's extracted here so
 * both callers import one array instead of two copies drifting
 * apart over time.
 *
 * Per requirements: only 'accepted' and 'on_the_way' email the
 * customer. 'cooking' and 'delivered' intentionally do not — not
 * an oversight, don't add them without a separate decision.
 */
const EMAIL_NOTIFICATION_STATUSES = ['accepted', 'on_the_way'];

module.exports = { EMAIL_NOTIFICATION_STATUSES };
