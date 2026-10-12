/**
 * lib/restaurant.js — ALLES, was dieses Backend über "seinen" Restaurant wissen muss.
 * Takashi und Mira laufen mit demselben Code; nur diese Datei + die Vercel-Umgebungsvariablen unterscheiden sich.
 */
module.exports = {
  key:      'mira',
  name:     'Mira Restaurant',
  short:    'Mira',
  wordmark: 'MIRA',
  city:     'Metzingen',
  address:  'Eisenbahnstraße 24, 72555 Metzingen',
  addressHtml: 'Eisenbahnstra&szlig;e 24<br>72555 Metzingen',
  phone:    '+49 7123 9595739',
  phoneTel: '+4971239595739',
  /* bis die neue Domain steht, leer lassen → Links werden in E-Mails nicht angezeigt */
  website:  process.env.RESTAURANT_WEBSITE || '',
  instagramUrl: '',
  googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=Mira+Restaurant+Eisenbahnstra%C3%9Fe+24+72555+Metzingen',
  /* Absender: muss in Resend als Domain verifiziert sein */
  emailFrom: process.env.EMAIL_FROM_ADDRESS || '',
  /* Bestellzeiten (0=So..6=Sa) — identisch mit ORDER_HOURS im Mira-index.html */
  orderHours: {
    0: [[11, 0, 21, 30]],
    1: [],
    2: [[11, 0, 21, 30]],
    3: [[11, 0, 21, 30]],
    4: [[11, 0, 21, 30]],
    5: [[11, 0, 21, 30]],
    6: [[11, 0, 21, 30]]
  },
  mittagskarteWeekdays: [2, 3, 4, 5] // Di–Fr
};
