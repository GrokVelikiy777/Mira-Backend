/**
 * lib/email/templates/i18n.js
 * ─────────────────────────────────────────────────────────────
 * All customer-facing email copy, in German and English, in one
 * place. Templates/components pull strings from here instead of
 * hardcoding text, so adding a language later means adding one more
 * key per entry — not touching every template or component.
 *
 * order.lang ('de' | 'en') is captured on the website at checkout
 * time (the same language toggle that already drives index.html's
 * data-de/data-en content) and carried through on the order payload,
 * so every email in an order's lifecycle is sent in the language the
 * customer actually checked out in — no manual switching, nothing
 * new to maintain on the website side.
 */
const R = require('../../restaurant');
const STRINGS = {
  de: {
    labels: {
      orderNumber:          'Bestellnummer',
      items:                 'Bestellte Artikel',
      subtotal:               'Zwischensumme',
      deliveryFee:             'Liefergebühr',
      total:                    'Gesamtbetrag',
      estimatedTime:             'Voraussichtliche Lieferzeit',
      estimatedTimePickup:        'Voraussichtliche Abholzeit',
      /* Für Bestellungen mit einer konkret gewählten Wunschzeit (nicht
         "So bald wie möglich") — ersetzt estimatedTime/-Pickup, siehe
         orderSummary.js. Bewusst ohne "Voraussichtliche", da es sich
         nicht mehr um eine Schätzung handelt. */
      scheduledTime:               'Lieferzeit',
      scheduledTimePickup:          'Abholzeit',
      deliveryAddress:              'Lieferadresse',
      orderTypeDelivery:              'Lieferung',
      orderTypePickup:                  'Abholung'
    },
    tracker: {
      new:        'Bestellung eingegangen',
      accepted:   'Angenommen',
      cooking:    'In Zubereitung',
      on_the_way: 'Unterwegs',
      delivered:  'Zugestellt',
      /* Kurzes Badge-Wort für orderReadyForPickup.js — kein echter
         Tracker-Schritt (progressTracker.js wird für diese E-Mail
         nicht verwendet), nur der gleiche kurze-Label-Stil. */
      ready_for_pickup: 'Abholbereit'
    },
    footer: {
      googleReview: '⭐ Bei Google bewerten',
      instagram:    '📷 Folgen Sie uns auf Instagram',
      orderAgain:   '🍣 Erneut bestellen'
    },
    statuses: {
      new: {
        subject:  'Wir haben Ihre Bestellung erhalten!',
        headline: 'Bestellung eingegangen',
        body: (name) => `Hallo ${name}, vielen Dank für Ihre Bestellung bei ${R.short}! Wir haben sie erhalten und bereiten alles für Sie vor.`
      },
      accepted: {
        subject:  'Ihre Bestellung wurde angenommen',
        headline: 'Bestellung angenommen',
        body: (name) => `Gute Nachrichten, ${name}! Die Küche hat Ihre Bestellung angenommen und beginnt in Kürze mit der Zubereitung.`
      },
      cooking: {
        subject:  'Wir bereiten Ihr Essen zu',
        headline: 'In Zubereitung',
        body: (name) => `Unsere Köche bereiten Ihre Bestellung gerade mit Sorgfalt zu, ${name}.`
      },
      on_the_way: {
        subject:  'Ihre Bestellung ist unterwegs',
        headline: 'Unterwegs zu Ihnen',
        body: (name) => `Der Fahrer ist losgefahren, ${name}! Bitte halten Sie Ihr Telefon griffbereit, falls er Sie kontaktieren muss.`
      },
      delivered: {
        subject:  'Guten Appetit!',
        headline: 'Zugestellt',
        body: (name) => `Ihre Bestellung wurde zugestellt, ${name}. Wir hoffen, sie schmeckt Ihnen! Vielen Dank, dass Sie bei ${R.short} bestellt haben — wir freuen uns schon auf Ihre nächste Bestellung.`
      },
      /* Manuell aus der Admin-Oberfläche ausgelöst ("Bestellung fertig
         — Kunde benachrichtigen"), nur für Abholung, unabhängig vom
         eigentlichen orders.status — siehe orderReadyForPickup.js. */
      ready_for_pickup: {
        subject:  'Ihre Bestellung ist abholbereit!',
        headline: 'Bereit zur Abholung',
        body: (name) => `Gute Nachrichten, ${name}! Ihre Bestellung ist fertig und wartet auf Sie bei ${R.short}.`
      }
    }
  },
  en: {
    labels: {
      orderNumber:          'Order number',
      items:                 'Order items',
      subtotal:               'Subtotal',
      deliveryFee:             'Delivery fee',
      total:                    'Total',
      estimatedTime:             'Estimated delivery time',
      estimatedTimePickup:        'Estimated pickup time',
      scheduledTime:               'Delivery time',
      scheduledTimePickup:          'Pickup time',
      deliveryAddress:              'Delivery address',
      orderTypeDelivery:              'Delivery',
      orderTypePickup:                  'Pickup'
    },
    tracker: {
      new:        'Order received',
      accepted:   'Accepted',
      cooking:    'Preparing',
      on_the_way: 'On the way',
      delivered:  'Delivered',
      ready_for_pickup: 'Ready for pickup'
    },
    footer: {
      googleReview: '⭐ Leave a Google Review',
      instagram:    '📷 Follow us on Instagram',
      orderAgain:   '🍣 Order again'
    },
    statuses: {
      new: {
        subject:  "We've received your order!",
        headline: 'Order received',
        body: (name) => `Hi ${name}, thank you for ordering from ${R.short}! We've received your order and we're getting everything ready for you.`
      },
      accepted: {
        subject:  'Your order has been accepted',
        headline: 'Order accepted',
        body: (name) => `Good news, ${name}! The kitchen has accepted your order and will start preparing it shortly.`
      },
      cooking: {
        subject:  "We're preparing your food",
        headline: 'Preparing your order',
        body: (name) => `Our chefs are carefully preparing your order right now, ${name}.`
      },
      on_the_way: {
        subject:  'Your order is on the way',
        headline: 'On the way to you',
        body: (name) => `Your courier has left the restaurant, ${name}! Please keep your phone nearby in case they need to reach you.`
      },
      delivered: {
        subject:  'Enjoy your meal!',
        headline: 'Delivered',
        body: (name) => `Your order has been delivered, ${name}. We hope you enjoy it! Thank you for ordering from ${R.short} — we'd love to have you back soon.`
      },
      ready_for_pickup: {
        subject:  'Your order is ready for pickup!',
        headline: 'Ready for pickup',
        body: (name) => `Good news, ${name}! Your order is ready and waiting for you at ${R.short}.`
      }
    }
  }
};

/* Always returns a valid language block — falls back to German
   (the restaurant's primary market) for anything unrecognized. */
function getStrings(lang) {
  return STRINGS[lang] || STRINGS.de;
}

module.exports = { getStrings };
