/**
 * lib/email/templates/orderReadyForPickup.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff click "Bestellung fertig — Kunde benachrichtigen"
 * ("Order ready — notify customer") in the Admin Dashboard, for
 * pickup orders only. See api/notify-pickup-ready.js.
 *
 * Deliberately does NOT reuse statusEmailBody.js's progress tracker:
 * "ready_for_pickup" is not one of the 5 real order statuses
 * (new/accepted/cooking/on_the_way/delivered) — it's a standalone,
 * admin-triggered notification, fully independent of orders.status.
 * Rendering it as a tracker step would wrongly imply it IS a status
 * change, which the feature spec explicitly forbids. Instead this
 * template assembles statusHeader() + orderSummaryHtml() directly,
 * the same two reusable pieces statusEmailBody.js itself is built
 * from, just without the tracker in between.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { statusHeader } = require('./statusHeader');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

function orderReadyForPickupEmail(order) {
  const brand = config.brand;
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.ready_for_pickup;
  const name = (order.customer && order.customer.name) || '';
  const bodyText = s.body(name);

  const headerHtml = statusHeader({
    badgeText:  getStrings(lang).tracker.ready_for_pickup,
    badgeColor: config.statusColors.ready_for_pickup,
    headline:   s.headline,
    body:       bodyText,
    brand
  });
  const summaryHtml = orderSummaryHtml(order, lang);

  const bodyHtml = `
    ${headerHtml}
    ${summaryHtml}
  `;

  return {
    subject: s.subject,
    html: emailLayout({ previewText: bodyText, bodyHtml, lang })
  };
}

module.exports = orderReadyForPickupEmail;
