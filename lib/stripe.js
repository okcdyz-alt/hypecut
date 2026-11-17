// Paiements Stripe : carte, Apple Pay, Google Pay, PayPal, Link… (moyens activés dans le tableau de bord Stripe).
// Seule variable obligatoire : STRIPE_SECRET_KEY. Au démarrage, le serveur crée lui-même les produits,
// les prix, le coupon de lancement GTA VI et le webhook s'ils n'existent pas encore.
const crypto = require('crypto');
const { q, setting, addCredits } = require('./db');
const { PLANS, PACKS, isLaunch, LAUNCH_END } = require('./plans');

const API = 'https://api.stripe.com/v1';
const VERSION = '2024-06-20';
const enabled = () => !!process.env.STRIPE_SECRET_KEY;
const LAUNCH_COUPON = 'HYPECUT_GTAVI';

const CATALOG = {
  pro:     { lookup: 'hypecut_pro_monthly',     name: 'HYPECUT Pro',      amount: PLANS.pro.price,     recurring: true },
  creator: { lookup: 'hypecut_creator_monthly', name: 'HYPECUT Créateur', amount: PLANS.creator.price, recurring: true },
  pack20:  { lookup: 'hypecut_pack20',          name: 'HYPECUT Pack 20 clips', amount: PACKS.pack20.price, recurring: false },
};

function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) encode(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encode(item, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`)));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}

async function stripe(method, path, params) {
  const body = params && method !== 'GET' ? encode(params).join('&') : undefined;
  const qs = params && method === 'GET' ? '?' + encode(params).join('&') : '';
  const res = await fetch(API + path + qs, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Version': VERSION, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30e3),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message || `Stripe ${res.status}`); e.status = res.status; e.code = j.error?.code; throw e; }
  return j;
}

async function ensureCatalog() {
  const prices = {};
  const found = await stripe('GET', '/prices', { lookup_keys: Object.values(CATALOG).map((c) => c.lookup), active: 'true', limit: 10 });
  for (const p of found.data) prices[p.lookup_key] = p.id;
  for (const [id, c] of Object.entries(CATALOG)) {
    if (prices[c.lookup]) continue;
    const product = await stripe('POST', '/products', { name: c.name, metadata: { hypecut: id } });
    const price = await stripe('POST', '/prices', {
      product: product.id, currency: 'eur', unit_amount: c.amount, lookup_key: c.lookup,
      recurring: c.recurring ? { interval: 'month' } : undefined, metadata: { hypecut: id },
    });
    prices[c.lookup] = price.id;
  }
  // Coupon de lancement GTA VI : -50 % le premier mois Pro (7,99 € → 3,99 €)
  try { await stripe('GET', `/coupons/${LAUNCH_COUPON}`); } catch (e) {
    if (e.status !== 404) throw e;
    await stripe('POST', '/coupons', {
      id: LAUNCH_COUPON, name: 'Lancement GTA VI', amount_off: PLANS.pro.price - PLANS.pro.launchPrice, currency: 'eur',
      duration: 'once', redeem_by: Math.floor(LAUNCH_END.getTime() / 1000),
    });
  }
  try {
    const codes = await stripe('GET', '/promotion_codes', { code: 'GTAVI', limit: 1 });
    if (!codes.data.length) await stripe('POST', '/promotion_codes', { coupon: LAUNCH_COUPON, code: 'GTAVI', expires_at: Math.floor(LAUNCH_END.getTime() / 1000) });
  } catch (e) { console.warn('[stripe] code promo GTAVI :', e.message); }
  setting('stripe_prices', JSON.stringify(prices));
  return prices;
}

async function ensureWebhook(publicUrl) {
  if (process.env.STRIPE_WEBHOOK_SECRET) return;
  if (!publicUrl) { console.warn('[stripe] adresse publique inconnue : webhook non créé'); return; }
  const url = `${publicUrl.replace(/\/$/, '')}/api/stripe/webhook`;
  const list = await stripe('GET', '/webhook_endpoints', { limit: 100 });
  const existing = list.data.find((w) => w.url === url);
  if (existing && setting('stripe_webhook_secret') && setting('stripe_webhook_id') === existing.id) return;
  if (existing) await stripe('DELETE', `/webhook_endpoints/${existing.id}`);
  const wh = await stripe('POST', '/webhook_endpoints', {
    url,
    enabled_events: ['checkout.session.completed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted'],
    description: 'HYPECUT',
  });
  setting('stripe_webhook_id', wh.id);
  setting('stripe_webhook_secret', wh.secret);
  console.log('[stripe] webhook créé :', url);
}

async function init(publicUrl) {
  if (!enabled()) return;
  try { await ensureCatalog(); await ensureWebhook(publicUrl); console.log('[stripe] prêt'); }
  catch (e) { console.error('[stripe] initialisation :', e.message); }
}

function priceId(product) {
  const prices = JSON.parse(setting('stripe_prices') || '{}');
  return prices[CATALOG[product]?.lookup];
}

async function customerFor(user) {
  if (user.stripe_customer) return user.stripe_customer;
  const c = await stripe('POST', '/customers', { email: user.email, metadata: { user_id: user.id } });
  q.run('UPDATE users SET stripe_customer = ? WHERE id = ?', c.id, user.id);
  return c.id;
}

async function checkout(user, product, baseUrl) {
  if (!CATALOG[product]) throw Object.assign(new Error('Offre inconnue'), { status: 400 });
  let price = priceId(product);
  if (!price) { await ensureCatalog(); price = priceId(product); }
  const recurring = CATALOG[product].recurring;
  if (recurring && user.stripe_sub && user.plan !== 'free') {
    return portal(user, baseUrl); // déjà abonné : changement d'offre via l'espace client Stripe
  }
  const params = {
    mode: recurring ? 'subscription' : 'payment',
    customer: await customerFor(user),
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${baseUrl}/?paiement=ok#compte`,
    cancel_url: `${baseUrl}/?paiement=annule#offres`,
    metadata: { user_id: user.id, product, renonciation_retractation: new Date().toISOString() },
    locale: 'fr',
  };
  if (recurring) params.subscription_data = { metadata: { user_id: user.id, product } };
  if (product === 'pro' && isLaunch()) params.discounts = [{ coupon: LAUNCH_COUPON }];
  else params.allow_promotion_codes = 'true';
  const s = await stripe('POST', '/checkout/sessions', params);
  return s.url;
}

async function portal(user, baseUrl) {
  const s = await stripe('POST', '/billing_portal/sessions', { customer: await customerFor(user), return_url: `${baseUrl}/#compte`, locale: 'fr' });
  return s.url;
}

function verify(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || setting('stripe_webhook_secret');
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const sigs = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - +parts.t) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

const planFromLookup = (lk) => (lk === CATALOG.pro.lookup ? 'pro' : lk === CATALOG.creator.lookup ? 'creator' : null);
const userByCustomer = (cid) => q.get('SELECT * FROM users WHERE stripe_customer = ?', cid);

async function handleEvent(evt) {
  if (q.get('SELECT id FROM stripe_events WHERE id = ?', evt.id)) return;
  q.run('INSERT INTO stripe_events(id) VALUES(?)', evt.id);
  const o = evt.data.object;
  switch (evt.type) {
    case 'checkout.session.completed': {
      const uid = o.metadata?.user_id || o.client_reference_id;
      if (!uid) break;
      if (o.customer) q.run('UPDATE users SET stripe_customer = ? WHERE id = ?', o.customer, uid);
      if (o.mode === 'payment' && o.payment_status === 'paid' && o.metadata?.product === 'pack20') addCredits(uid, PACKS.pack20.credits, 'pack20');
      if (o.mode === 'subscription' && o.subscription) q.run('UPDATE users SET stripe_sub = ? WHERE id = ?', o.subscription, uid);
      break;
    }
    case 'invoice.paid': {
      const u = userByCustomer(o.customer);
      const line = (o.lines?.data || []).find((l) => l.price?.lookup_key);
      const plan = planFromLookup(line?.price?.lookup_key);
      if (!u || !plan) break;
      const quota = PLANS[plan].credits;
      q.run('UPDATE users SET plan = ?, stripe_sub = COALESCE(?, stripe_sub), period_end = ?, credits = MAX(credits, ?) WHERE id = ?',
        plan, o.subscription || null, line?.period?.end ? new Date(line.period.end * 1000).toISOString() : null, quota, u.id);
      q.run('INSERT INTO ledger(user_id, delta, reason) VALUES(?, 0, ?)', u.id, `abonnement ${plan} : solde ramené à ${quota} minimum`);
      break;
    }
    case 'customer.subscription.updated': {
      const u = userByCustomer(o.customer);
      if (!u) break;
      if (['canceled', 'unpaid', 'incomplete_expired'].includes(o.status)) q.run("UPDATE users SET plan = 'free', stripe_sub = NULL WHERE id = ?", u.id);
      else if (['active', 'trialing'].includes(o.status)) {
        const plan = planFromLookup(o.items?.data?.[0]?.price?.lookup_key);
        if (plan) q.run('UPDATE users SET plan = ?, stripe_sub = ? WHERE id = ?', plan, o.id, u.id);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const u = userByCustomer(o.customer);
      if (u) q.run("UPDATE users SET plan = 'free', stripe_sub = NULL WHERE id = ?", u.id);
      break;
    }
  }
}

module.exports = { enabled, init, checkout, portal, verify, handleEvent, encode };
