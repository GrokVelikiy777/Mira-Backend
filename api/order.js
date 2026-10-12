/**
 * ══════════════════════════════════════════════════════════════
 *  TAKASHI RESTAURANT — Telegram Order Proxy
 *  ─────────────────────────────────────────────────────────────
 *  This file is the ONLY place the Telegram Bot Token lives.
 *  Never put the token in index.html or any frontend file.
 *
 *  DEPLOYMENT OPTIONS (all free tiers available):
 *
 *  A) Vercel (recommended — easiest)
 *     1. npm i -g vercel
 *     2. Create /api/order.js  (rename this file, place in /api/)
 *     3. vercel env add TELEGRAM_BOT_TOKEN
 *     4. vercel --prod
 *     → Your endpoint: https://your-project.vercel.app/api/order
 *
 *  B) Netlify Functions
 *     1. Place in /netlify/functions/order.js
 *     2. netlify env:set TELEGRAM_BOT_TOKEN <token>
 *     3. netlify deploy --prod
 *     → Endpoint: https://your-site.netlify.app/.netlify/functions/order
 *
 *  C) Cloudflare Workers
 *     1. npm i -g wrangler
 *     2. wrangler secret put TELEGRAM_BOT_TOKEN
 *     3. wrangler deploy
 *     → Endpoint: https://takashi-proxy.your-subdomain.workers.dev
 *
 *  D) Local (for testing)
 *     npm install express node-fetch
 *     TELEGRAM_BOT_TOKEN=xxx node telegram-proxy.js
 *     → http://localhost:3000/api/order
 *
 *  ENVIRONMENT VARIABLES NEEDED:
 *    TELEGRAM_BOT_TOKEN  — from @BotFather on Telegram
 *
 *  CHAT ID (already hardcoded in index.html frontend):
 *    -5262422113  (Takashi group)
 *
 *  CUSTOMER STATUS EMAILS:
 *    The "new order" confirmation email is sent from this file, right
 *    after the order is created (see notifyCustomer.js). Every later
 *    status change (accepted, cooking, driver left, delivered) is
 *    triggered ONLY from takashi-admin (see
 *    takashi-backend/api/notify-status.js) — this file no longer plays
 *    any part in status-change emails.
 *
 *  TELEGRAM IS NOTIFICATION-ONLY (since 2026-09):
 *    This endpoint sends ONE plain sendMessage per new order — no
 *    inline buttons, no callback_query handling, no webhook. Order
 *    status is managed exclusively in takashi-admin; nothing sent to
 *    or received from Telegram can change order data. The bot's
 *    webhook was explicitly deleted (Telegram deleteWebhook) so
 *    Telegram itself no longer attempts to call this endpoint for
 *    button presses.
 * ══════════════════════════════════════════════════════════════
 */

/* ─────────────────────────────────────────────────
   Works as-is on Vercel / Netlify / local Express
───────────────────────────────────────────────── */
const { notifyCustomer } = require('../lib/email/notifyCustomer'); // "new order" confirmation email only — status-change emails now live solely in takashi-admin (see api/notify-status.js)

const TELEGRAM_API = 'https://api.telegram.org/bot';

/* ══════════════════════════════════════════════════════════════
   ORDER HOURS — server-side authoritative gate (see handler below).
   Mirrors ORDER_HOURS/getBerlinNow() in сайт такаши/index.html
   EXACTLY — two separate deploys with no shared code, so this is a
   deliberate 1:1 duplication, not a re-derivation. Change BOTH files
   together when hours change. This is the file that actually decides
   whether an order gets created — the frontend copy only disables the
   button/shows a message, it cannot be trusted on its own (a direct
   POST to this endpoint bypasses it entirely).
   Format: 0=Sun..6=Sat → array of [openH,openM,closeH,closeM] windows,
   [] = closed all day. ══════════════════════════════════════════ */
const RESTAURANT = require('../lib/restaurant');
const ORDER_HOURS = RESTAURANT.orderHours;

/* Момент "сейчас" в часовом поясе ресторана (Europe/Berlin), а НЕ в
   часовом поясе сервера Vercel (обычно UTC) и тем более не клиента.
   Единый источник истины для ORDER_HOURS и Mittagskarte-проверки ниже —
   вычисляется один раз на запрос вместо дублирования Intl-вызова. */
function getBerlinNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });

  const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: WEEKDAY_MAP[map.weekday],
    minutes: (parseInt(map.hour, 10) % 24) * 60 + parseInt(map.minute, 10)
  };
}

/* Границы включительно снизу, исключительно сверху — в 11:30 уже
   открыто, после 14:30 уже нет (тот же принцип, что на сайте). */
function isOrderingOpenNow() {
  const now = getBerlinNow();
  const windows = ORDER_HOURS[now.weekday] || [];
  return windows.some((w) => now.minutes >= (w[0] * 60 + w[1]) && now.minutes < (w[2] * 60 + w[3]));
}

/* ══════════════════════════════════════════════════════════════
   SUPABASE INTEGRATION
   ─────────────────────────────────────────────────────────────
   Supabase is now the mandatory source of truth for Admin — if
   create_order_from_website() fails, the whole checkout fails (no
   Telegram order message, no email, no success response). Uses the
   PUBLIC anon key only, via plain fetch to PostgREST's RPC endpoint
   — no @supabase/supabase-js dependency, same "native fetch only"
   style already used for Telegram/Resend in this codebase. The anon
   key never has direct table access to customers/orders/order_items
   — only EXECUTE on the three functions in migration 016.
   ══════════════════════════════════════════════════════════════ */
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/* Calls a Postgres RPC via PostgREST. Never throws — returns
   { data, error } so callers decide how to proceed, same convention
   as callTelegramApi() below returning null on failure. `error`,
   when present, is a real Error object with the full PostgREST
   response attached as `.details` — callers are expected to
   console.error() the full object themselves (see the main handler)
   and only send a short, truncated summary to Telegram. */
async function callSupabaseRpc(functionName, params) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: new Error('SUPABASE_URL or SUPABASE_ANON_KEY not configured') };
  }

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(params)
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
    // PostgREST error shape: { code, message, details, hint }
    const message = (body && (body.message || body.hint || body.error_description)) || `HTTP ${res.status}`;
    const err = new Error(message);
    err.details = body;
    err.status  = res.status;
    return { data: null, error: err };
  }

  return { data: body, error: null };
}

/* Truncated, operator-readable version of a Supabase error for
   Telegram — the FULL error (with .details) is always
   console.error()'d separately by the caller, never dropped. */
function shortenSupabaseError(error) {
  if (!error) return 'Unknown error';
  return String(error.message || error).slice(0, 200);
}

/* Server-side mirror of index.html's tgSafe() — order.js now builds
   the FAILED ORDER message itself (see below), so customer-supplied
   text (name, phone) needs the same Markdown-breaking-character
   stripping the client already applies to everything it formats. */
function tgSafe(v) {
  return String(v == null ? '' : v).replace(/[*_`[\]]/g, '');
}

/* Deliberately its own template — no status buttons, no PDF — so it
   can never be mistaken for a real tracked order in the group. This
   order does not exist in Admin; the message says so explicitly. */
function buildFailedOrderText(payload, shortError) {
  const customer     = (payload && payload.customer) || {};
  const isLieferung  = payload && payload.orderType === 'lieferung';
  const timeStr      = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return [
    '⚠️ *FAILED ORDER — Supabase insert failed*',
    '',
    'Bestellung konnte NICHT im System gespeichert werden.',
    'Bitte Kunden ggf. manuell kontaktieren.',
    '',
    `*Kunde:* ${tgSafe(customer.name)}`,
    `*Typ:* ${isLieferung ? 'Lieferung' : 'Abholung'}`,
    `*Summe:* ${tgSafe(payload && payload.total)}€`,
    `*Zeit:* ${timeStr}`,
    '',
    `*Fehler:* \`${tgSafe(shortError)}\``,
    '',
    '_(Diese Bestellung erscheint NICHT im Admin-Panel.)_'
  ].join('\n');
}

/* Best-effort, single attempt — no retry loop by design (a retry
   here would risk a second, redundant alert if the first actually
   went through but the response was lost). If this also fails, the
   full reason is logged and we give up; callTelegramApi() already
   never throws, so no try/catch is needed around this call itself. */
async function sendFailedOrderAlert(TOKEN, chatId, payload, shortError) {
  const alertResult = await callTelegramApi(
    TOKEN,
    'sendMessage',
    { chat_id: chatId, text: buildFailedOrderText(payload, shortError), parse_mode: 'Markdown' },
    'FAILED ORDER alert'
  );
  if (!alertResult) {
    console.error('[Proxy] FAILED ORDER alert to Telegram ALSO failed — giving up, no retry.');
  }
}

/* ─── Shared Telegram API caller ───
   Centralizes the fetch + error handling that used to be duplicated across
   sendMessage / answerCallbackQuery / editMessageText call sites. Never
   throws — callers get `null` on failure and can decide how to proceed,
   so one failed Telegram call (e.g. the WhatsApp button) can never crash
   the request or block unrelated logic (e.g. the status edit). Never logs
   the bot token or full request payloads (which may contain customer PII). */
async function callTelegramApi(TOKEN, method, payload, context) {
  let res;
  try {
    res = await fetch(`${TELEGRAM_API}${TOKEN}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`[Proxy] ${context}: network error —`, err.message);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`[Proxy] ${context}: could not parse Telegram response (status ${res.status})`);
    return null;
  }

  if (!data.ok) {
    if (data.description?.includes('message is not modified')) {
      return data;
    }

    console.error(
      `[Proxy] ${context}: Telegram API error —`,
      data.description || 'unknown error'
    );
  }

  return data;
}

/* ══════════════════════════════════════════════════════════════
   DELIVERY COORDINATES
   Still needed: create_order_from_website stores p_delivery_lat/
   p_delivery_lng in Supabase for takashi-admin's own use. This has
   nothing to do with Telegram — the "Open in Google Maps" Telegram
   button and its URL-building helper were removed together with the
   rest of Telegram's admin functionality (Requirement 2 is gone).
   ══════════════════════════════════════════════════════════════ */

/* Looks for delivery coordinates under a few common field-name
   variants so this works whether the frontend nests them as
   `coordinates: {lat, lon}`, `location: {lat, lng}`, or flat
   `lat`/`lon` (`latitude`/`longitude`) fields on the payload itself.
   Returns null if nothing usable is found — never guesses/geocodes. */
function extractOrderCoordinates(payload) {
  if (!payload) return null;
  const candidates = [payload.coordinates, payload.location, payload.deliveryCoordinates, payload];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const lat = c.lat ?? c.latitude ?? c.deliveryLat;
    const lon = c.lon ?? c.lng ?? c.longitude ?? c.deliveryLon;
    if (isFiniteCoord(lat) && isFiniteCoord(lon)) {
      return { lat: Number(lat), lon: Number(lon) };
    }
  }
  return null;
}
function isFiniteCoord(v) {
  return v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
}

/* ─── Main handler ─── */
module.exports = async function handler(req, res) {
  /* CORS — allow requests from your domain */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    console.error('[Proxy] TELEGRAM_BOT_TOKEN not set');
    res.status(500).json({ ok: false, error: 'Bot token not configured' });
    return;
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch(e) { res.status(400).json({ ok: false, error: 'Invalid JSON' }); return; }

  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, error: 'Invalid request body' });
    return;
  }

  /* Telegram no longer has a registered webhook (deleteWebhook was
     called once, manually, when Telegram's admin functionality was
     removed) — so a real callback_query can no longer arrive here.
     There is deliberately no route for it any more: even a forged or
     replayed callback_query payload just falls through to the
     validation below and is rejected, since this endpoint now only
     understands the new-order shape. */
  const { _orderPayload } = body;
  /* Mira: Chat-ID kommt aus der Vercel-Variable TELEGRAM_CHAT_ID, nicht vom Browser */
  const chat_id = process.env.TELEGRAM_CHAT_ID || body.chat_id;
  if (!chat_id) {
    res.status(400).json({ ok: false, error: 'Missing chat_id' });
    return;
  }
  if (!_orderPayload || typeof _orderPayload !== 'object') {
    res.status(400).json({ ok: false, error: 'Missing order payload' });
    return;
  }

  /* Email is required — the frontend (submitOrder() in index.html) has
     already enforced this for a while, but nothing here re-checked it,
     so a direct POST bypassing the site's own validation could still
     slip an order through with no email and no way to notify the
     customer. Same basic format check as the frontend. */
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var _orderEmail = _orderPayload.customer && _orderPayload.customer.email;
  if (!_orderEmail || !EMAIL_PATTERN.test(_orderEmail)) {
    res.status(400).json({ ok: false, error: 'A valid customer email is required' });
    return;
  }

  /* ── Day/time gate: order hours + Mittagskarte (server-side authoritative) ──
     Both checks below share ONE "what time is it at the restaurant"
     helper (getBerlinNow()) instead of each computing it separately —
     avoids duplicating the same Intl.DateTimeFormat logic twice in this
     file. Mirrors getBerlinNow()/ORDER_HOURS in index.html exactly (two
     separate deploys with no shared code — logic is intentionally
     duplicated 1:1, not re-derived differently); change BOTH places
     together when hours change. */
  if (!isOrderingOpenNow()) {
    res.status(400).json({ ok: false, error: 'Orders are currently not being accepted — outside opening hours' });
    return;
  }

  /* Mittagskarte — только Di–Fr, ДОПОЛНИТЕЛЬНО к общим часам приёма
     заказов выше. Раньше это ограничение проверялось ТОЛЬКО на сайте
     (getCategoryAvailability в index.html), а сам backend вообще не
     получал категорию товара — значит прямой POST на этот endpoint
     (или вызов JS-функции в консоли браузера в обход UI) мог создать
     заказ с Mittagskarte в любой день. items[].category теперь
     приходит с сайта (см. submitOrder() в index.html) — если его нет
     (старый кэш сайта у клиента), считаем безопасной стороной и НЕ
     блокируем непонятные товары, блокируем только явно распознанный
     'mittagskarte'. ВНИМАНИЕ: список дней продублирован в index.html
     (MITTAGSKARTE.availability.days) — менять нужно оба места
     одновременно. */
  const MITTAGSKARTE_ALLOWED_WEEKDAYS = RESTAURANT.mittagskarteWeekdays;
  const hasMittagskarteItem = Array.isArray(_orderPayload.items)
    && _orderPayload.items.some((item) => item && item.category === 'mittagskarte');
  if (hasMittagskarteItem && !MITTAGSKARTE_ALLOWED_WEEKDAYS.includes(getBerlinNow().weekday)) {
    res.status(400).json({ ok: false, error: 'Mittagskarte is only available Tuesday–Friday' });
    return;
  }

  /* ══════════════════════════════════════════════════════════════
     MANDATORY: create the order in Supabase FIRST. Admin is now the
     system of record — if this fails, the whole checkout fails: no
     Telegram order message, no confirmation email, no success
     response to the customer. Telegram still gets notified either
     way (see sendFailedOrderAlert) so a failed attempt is never
     silently lost — the owner sees it even when Admin can't record it.
     ══════════════════════════════════════════════════════════════ */
  const clientOrderType = _orderPayload.orderType === 'lieferung' ? 'delivery' : 'pickup';
  const coords = extractOrderCoordinates(_orderPayload);

  const { data: supabaseOrder, error: supabaseError } = await callSupabaseRpc('create_order_from_website', {
    p_customer_name:    _orderPayload.customer && _orderPayload.customer.name,
    p_customer_phone:   _orderPayload.customer && _orderPayload.customer.phone,
    p_customer_email:   (_orderPayload.customer && _orderPayload.customer.email) || null,
    p_order_type:       clientOrderType,
    p_delivery_address: _orderPayload.deliveryAddress || null,
    p_delivery_zone:    _orderPayload.deliveryZone || null,
    p_delivery_lat:     coords ? coords.lat : null,
    p_delivery_lng:     coords ? coords.lon : null,
    p_subtotal:         _orderPayload.subtotal,
    p_delivery_fee:     _orderPayload.fee,
    p_total:            _orderPayload.total,
    p_payment_method:   _orderPayload.paymentMethod || null,
    p_comment:          _orderPayload.comment || null,
    p_lang:             _orderPayload.lang || 'de',
    p_estimated_time:   _orderPayload.estimatedTime || null,
    p_requested_time:   _orderPayload.wunschzeit || null,
    p_items: (_orderPayload.items || []).map((item) => ({
      name:      item.name,
      variant:   item.variant || null,
      comment:   item.comment || null,
      qty:       item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      /* category (maki/nigiri/insideout/…) уже приходит с сайта в
         _orderPayload.items[].category (см. submitOrder() в index.html,
         уже используется чуть выше для проверки Mittagskarte) — раньше
         терялась именно здесь при сборке p_items. Нужна в Admin, чтобы
         различать одинаковые названия из разных разделов меню
         (например "Sake" есть и в Maki, и в Nigiri). */
      category:  item.category || null
    }))
  });

  if (supabaseError || !supabaseOrder) {
    /* Full error, always — this is what you diagnose from. Telegram
       only ever gets the short, truncated version (shortenSupabaseError). */
    console.error('[Proxy] Supabase order creation FAILED — FULL ERROR:', supabaseError);

    await sendFailedOrderAlert(TOKEN, chat_id, _orderPayload, shortenSupabaseError(supabaseError));

    res.status(502).json({ ok: false, error: 'Order could not be saved. Please try again.' });
    return;
  }

  /* Single source of truth from here on: every downstream use of
     _orderPayload.orderId (Telegram text, confirmation email) now
     sees the real Postgres-generated order_number, not the client's
     provisional one. */
  _orderPayload.orderId = supabaseOrder.order_number;

  /* Telegram notification — built entirely server-side from the
     confirmed order data, never from anything the client sent (there
     is no client-supplied text any more — see the validation above).
     No reply_markup: Telegram has no buttons any more, so there is
     nothing for a button press to do. */
  const notificationText = buildOrderNotificationText(_orderPayload);

  const data = await callTelegramApi(TOKEN, 'sendMessage', { chat_id, text: notificationText, parse_mode: 'Markdown' }, 'New order sendMessage');
  if (!data) {
    res.status(502).json({ ok: false, error: 'Failed to reach Telegram' });
    return;
  }

  /* Order-confirmation email — sent BEFORE the HTTP response.
     Vercel's execution environment can be frozen shortly after the
     response is sent, so this must complete first — same reasoning
     reservation.js already relies on. Fully failure-isolated: an
     email failure is caught and logged, never turned into an error
     response — the order itself was already created successfully. */
  try {
    const result = await notifyCustomer(_orderPayload, 'new');
    console.log('[Email Result]', result);
  } catch (err) {
    console.error('[Proxy] Order-confirmation email failed —', err.message);
  }

  res.status(200).json(Object.assign({}, data, { orderNumber: _orderPayload.orderId }));
};

/* ══════════════════════════════════════════════════════════════
   TELEGRAM NOTIFICATION TEXT — data minimisation by design
   (Art. 5 Abs. 1 lit. c DSGVO): only what staff need for a quick
   WHO / WHAT / HOW MUCH / WHEN overview. Deliberately excludes
   delivery address, coordinates, email, comments, payment method and
   delivery zone — those stay visible only in takashi-admin.
   ══════════════════════════════════════════════════════════════ */
function buildOrderNotificationText(p) {
  const isLieferung = p.orderType === 'lieferung';
  const lines = [];
  lines.push('🔔 *Neue Bestellung ' + tgSafe(p.orderId) + '*');
  lines.push('👤 ' + tgSafe(p.customer && p.customer.name));
  if (p.customer && p.customer.phone) lines.push('📞 ' + tgSafe(p.customer.phone));
  (p.items || []).forEach((item) => {
    lines.push('📦 ' + tgSafe(item.qty) + '× ' + tgSafe(item.name));
  });
  lines.push('💰 ' + tgSafe(p.total) + ' €');
  lines.push(isLieferung ? '🚚 Lieferung' : '🛍 Abholung');
  lines.push('🕐 ' + tgSafe(p.wunschzeit || p.estimatedTime));
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────
   LOCAL DEV SERVER (for testing without Vercel)
   Run: TELEGRAM_BOT_TOKEN=xxx node telegram-proxy.js
───────────────────────────────────────────────── */
if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3000;

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type' });
      res.end(); return;
    }
    if (req.url !== '/api/order') { res.writeHead(404); res.end('Not found'); return; }
    let rawBody = '';
    req.on('data', d => rawBody += d);
    req.on('end', async () => {
      req.body = rawBody;
      await module.exports(req, res);
    });
  }).listen(PORT, () => console.log('[Proxy] Listening on http://localhost:' + PORT + '/api/order'));
}