/**
 * lib/email/config.js
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for the email system's configuration.
 * Nothing else in lib/email/ reads process.env directly — this is
 * the only file that does, so every knob (sender identity, which
 * provider is active, retry behaviour, brand colours) lives in one
 * place instead of being scattered across templates/providers.
 *
 * ENV VARS (all optional — sensible defaults below):
 *   EMAIL_PROVIDER       — 'resend' (default; only one implemented today)
 *   EMAIL_FROM_NAME       — display name on outgoing emails
 *   EMAIL_FROM_ADDRESS     — must be a verified sender/domain with the provider
 *   EMAIL_REPLY_TO           — optional, defaults to no reply-to header
 *   RESEND_API_KEY             — read directly by providers/resend.js only
 */
const R = require('../restaurant');
module.exports = {
  /* Which providers/<name>.js module sendOrderEmail.js delegates to.
     Swapping providers later is: add providers/postmark.js with the
     same send() shape, change this one string. */
  provider: process.env.EMAIL_PROVIDER || 'resend',

  from: {
    name:    process.env.EMAIL_FROM_NAME    || R.name,
    /* TEMPORARY: pinned to the exact mailbox reservation.js already
       sends from successfully, to isolate whether order emails were
       failing because of the sender address/domain verification
       specifically. Revert to a dedicated orders@ mailbox (or restore
       the EMAIL_FROM_ADDRESS env var here) once order emails are
       confirmed working. */
    address: R.emailFrom
  },
  replyTo: process.env.EMAIL_REPLY_TO || null,

  /* Transient-failure retry policy, applied in sendOrderEmail.js
     regardless of which provider is active. */
  retry: {
    maxAttempts:  3,
    baseDelayMs:  400 // exponential-ish: 400ms, 800ms between attempts
  },

  /* Shared visual identity for every template — change once here,
     every status email (and future ones) picks it up. Matches the
     existing PDF receipt's navy/gold so the brand is consistent
     across Telegram PDF, website and email. */
  brand: {
    black:    '#0b0b0c',
    navy:     '#0b1830',
    gold:     '#c4993a',
    goldL:    '#e0bb68',
    goldSoft: 'rgba(196,153,58,.12)',
    white:    '#ffffff',
    text:     '#1a1a1a',
    muted:    '#6b7280',
    dim:      '#9a9a9a',
    border:   '#ececec',
    panel:    '#fafafa',
    success:  '#3c9a5f'
  },

  /* Status → accent colour, reused as the email's banner colour.
     Intentionally the same palette used elsewhere in the project
     for the same statuses, for visual consistency — not a code
     dependency, this file has no import from anywhere else. */
  statusColors: {
    new:        '#C4993A',
    accepted:   '#5B8DEF',
    cooking:    '#E0A63E',
    on_the_way: '#8B7CF6',
    delivered:  '#4C9F70',
    /* NOT a real orders.status value — a one-off admin-triggered ping
       ("Order ready — notify customer") sent only for pickup orders,
       fully decoupled from the status lifecycle above (see
       templates/orderReadyForPickup.js and api/notify-pickup-ready.js).
       Reuses brand.success rather than inventing a new accent. */
    ready_for_pickup: '#3C9A5F'
  },

  restaurant: {
    name:            R.name,
    address:         R.address,
    phone:           R.phone,
    website:         R.website,
    instagramUrl:    R.instagramUrl,
    googleReviewUrl: R.googleReviewUrl
  },

  /* Default language if an order somehow has none (older orders
     placed before the language field existed). */
  defaultLang: 'de'
};
