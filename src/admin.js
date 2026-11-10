import express from 'express';
import { z } from 'zod';
import { registerCatalog, registerImageMedia } from './admin-catalog.js';
import { registerReports } from './admin-reports.js';
import { currency, date, fail, id, idSchema, input, number, one, safeUrl, sendCsv, text } from './admin-validation.js';
import { cryptoMethods, validatePaymentDestination } from './payment-policy.js';
import { paypalConfigured } from './paypal.js';
import { chainLookupReady } from './chain-evidence.js';

const paymentMethod = z.enum(['btc', 'eth', 'ltc', 'sol', 'revolut', 'paypal']);
const paymentSchema = z.strictObject({
  name: text(70),
  destination: text(250),
  recipient_name: text(120, false),
  instructions: text(5000),
  enabled: z.boolean(),
  currencies: z.array(currency).min(1).max(6),
  sort_order: number(0, 100),
  expires_minutes: number(5, 1440),
  confirmation_threshold: number(1, 10000).nullable()
});
const codeSchema = text(40).toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/, 'Use 2–40 letters, numbers, underscores or hyphens.');
const couponSchema = z.strictObject({
  code: codeSchema,
  kind: z.enum(['percent', 'fixed', 'free_shipping']),
  amount: number(),
  currency: currency.nullable(),
  product_id: idSchema.nullable(),
  category_id: idSchema.nullable(),
  starts_at: date.nullable(),
  ends_at: date.nullable(),
  max_uses: number(1, 1000000).nullable(),
  max_per_customer: number(1, 1000000).nullable(),
  first_purchase: z.boolean(),
  min_subtotal: number(),
  enabled: z.boolean()
});
const optionalUrl = safeUrl.or(z.literal(''));
const appearanceSchema = z.strictObject({
  name: text(70),
  logo: optionalUrl,
  favicon: optionalUrl,
  accent: text(7).regex(/^#[0-9a-f]{6}$/i, 'Enter a six-digit hex color.'),
  banner: text(200, false),
  footer: text(500, false),
  supportUrl: optionalUrl,
  socialLinks: z.array(safeUrl).max(10),
  announcement: text(180, false),
  cardStyle: z.enum(['standard', 'compact']),
  sections: z.array(z.enum(['featured', 'best-sellers', 'latest', 'categories', 'offers', 'reviews', 'how-it-works', 'community', 'faq', 'newsletter'])).max(10)
});
const storeSchema = z.strictObject({
  guestCheckout: z.boolean(),
  maintenanceMode: z.boolean(),
  reviewEligibility: z.enum(['verified', 'completed']),
  legalName: text(200, false),
  taxId: text(90, false),
  jurisdiction: text(160, false),
  taxBps: number(0, 10000),
  shippingRate: number(),
  shippingCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(249)
});
const legalSchema = z.strictObject({
  terms: text(30000, false), privacy: text(30000, false), refund: text(30000, false),
  delivery: text(30000, false), contact: text(30000, false), faq: text(30000, false), cookies: text(30000, false)
});
const settingsSchemas = { appearance: appearanceSchema, settings: storeSchema, legal: legalSchema };

function providerReady(config, method) {
  if (method === 'paypal') return paypalConfigured(config);
  if (cryptoMethods[method]) return Boolean(config.COINGECKO_API_KEY);
  return true;
}

export function adminRouter(deps) {
  const { db, owner, reauth, audit, notify, config } = deps;
  const router = express.Router();
  registerImageMedia(router, db);
  router.use(owner);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  registerCatalog(router, deps);
  registerReports(router, db);

  router.get('/payment-methods', async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM payment_methods ORDER BY sort_order,id');
    res.json(rows.map(row => ({
      ...row,
      ready: providerReady(config, row.id),
      chain_ready: cryptoMethods[row.id] ? chainLookupReady(row.id, config) : false,
      mode: row.id === 'paypal' ? (config.PAYPAL_MODE || 'sandbox') : 'manual',
      confirmation_floor: cryptoMethods[row.id]?.confirmations ?? null
    })));
  });

  router.put('/payment-methods/:id', reauth, async (req, res) => {
    const method = input(paymentMethod, req.params.id);
    const data = input(paymentSchema, req.body);
    const crypto = cryptoMethods[method];
    if (!validatePaymentDestination(method, data.destination)) fail(400, 'Enter a valid recipient for this payment method and network.');
    if (data.enabled && !providerReady(config, method)) fail(409, 'Configure provider credentials before enabling this method.');
    if (crypto && data.confirmation_threshold != null && data.confirmation_threshold < crypto.confirmations) {
      fail(400, 'Require at least ' + crypto.confirmations + ' confirmations.');
    }
    await db.tx(async tx => {
      const before = one(await tx.query('SELECT * FROM payment_methods WHERE id=$1 FOR UPDATE', [method]), 'Payment method');
      const currencies = [...new Set(data.currencies)];
      await tx.query('UPDATE payment_methods SET name=$2, destination=$3, recipient_name=$4, instructions=$5, enabled=$6,' +
        ' currencies=$7, sort_order=$8, expires_minutes=$9, confirmation_threshold=$10 WHERE id=$1',
      [method, data.name, data.destination, data.recipient_name, data.instructions, data.enabled, currencies, data.sort_order,
        data.expires_minutes, crypto ? data.confirmation_threshold : null]);
      await audit(tx, req, 'payment.settings_changed', method, {
        fields: Object.keys(data).filter(field => JSON.stringify(data[field]) !== JSON.stringify(before[field]))
      });
    });
    res.json({ ok: true });
  });

  router.get('/discounts', async (_req, res) => {
    const { rows } = await db.query(
      'SELECT c.*,p.name AS product,cat.name AS category, (SELECT count(*)::int FROM orders WHERE coupon_code=c.code AND paid_at IS NOT NULL) AS paid_uses' +
      ' FROM coupons c LEFT JOIN products p ON p.id=c.product_id LEFT JOIN categories cat ON cat.id=c.category_id ORDER BY c.code LIMIT 500'
    );
    res.json(rows);
  });

  router.put('/discounts/:code', async (req, res) => {
    const code = input(codeSchema, req.params.code);
    const coupon = input(couponSchema, req.body);
    if (code !== coupon.code) fail(400, 'Create a new coupon to use a different code.');
    if (coupon.kind === 'percent' && (coupon.amount < 1 || coupon.amount > 10000)) fail(400, 'Percentage must be between 0.01 and 100.');
    if (coupon.kind === 'fixed' && (coupon.amount <= 0 || coupon.currency == null)) fail(400, 'Fixed discounts need a positive amount and currency.');
    if (coupon.starts_at && coupon.ends_at && Date.parse(coupon.starts_at) >= Date.parse(coupon.ends_at)) fail(400, 'The end must follow the start.');
    await db.tx(async tx => {
      await tx.query(
        'INSERT INTO coupons(code,kind,amount,currency,product_id,category_id,starts_at,ends_at,max_uses,max_per_customer,first_purchase,min_subtotal,enabled)' +
        ' VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(code) DO UPDATE SET' +
        ' kind=excluded.kind,amount=excluded.amount,currency=excluded.currency,product_id=excluded.product_id,category_id=excluded.category_id,' +
        ' starts_at=excluded.starts_at,ends_at=excluded.ends_at,max_uses=excluded.max_uses,max_per_customer=excluded.max_per_customer,' +
        ' first_purchase=excluded.first_purchase,min_subtotal=excluded.min_subtotal,enabled=excluded.enabled',
        [code, coupon.kind, coupon.kind === 'free_shipping' ? 0 : coupon.amount, coupon.currency, coupon.product_id, coupon.category_id,
          coupon.starts_at, coupon.ends_at, coupon.max_uses, coupon.max_per_customer, coupon.first_purchase, coupon.min_subtotal, coupon.enabled]
      );
      await audit(tx, req, 'coupon.saved', code, { enabled: coupon.enabled });
    });
    res.json({ ok: true });
  });

  router.get('/customers', async (req, res) => {
    const q = input(text(120, false), req.query.q ?? '');
    const { rows } = await db.query(
      'SELECT id,username,email,role,verified_at,created_at, (mfa_secret IS NOT NULL) AS mfa,' +
      ' (SELECT count(*)::int FROM orders WHERE user_id=u.id) AS orders,' +
      ' (SELECT count(*)::int FROM sessions WHERE user_id=u.id AND expires_at>now()) AS sessions' +
      " FROM users u WHERE ($1='' OR username ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%')" +
      ' ORDER BY u.created_at DESC LIMIT 100',
      [q]
    );
    res.json(rows);
  });

  router.delete('/customers/:id/sessions', reauth, async (req, res) => {
    const userId = id(req.params.id);
    if (userId === req.user.id) fail(409, 'Sign out from the current owner session using the sidebar.');
    const count = await db.tx(async tx => {
      one(await tx.query("SELECT id FROM users WHERE id=$1 AND role<>'owner' FOR UPDATE", [userId]), 'Customer');
      const result = await tx.query('DELETE FROM sessions WHERE user_id=$1 RETURNING user_id', [userId]);
      await audit(tx, req, 'security.sessions_revoked', userId, { sessions: result.rows.length });
      return result.rows.length;
    });
    res.json({ count });
  });

  router.get('/reviews', async (req, res) => {
    const status = input(z.enum(['pending','published','hidden','rejected']).optional(), req.query.status);
    const { rows } = await db.query(
      'SELECT r.*,u.username,p.name FROM reviews r JOIN users u ON u.id=r.user_id JOIN products p ON p.id=r.product_id' +
      ' WHERE ($1::text IS NULL OR r.status=$1) ORDER BY r.created_at DESC LIMIT 100', [status ?? null]
    );
    res.json(rows);
  });

  router.put('/reviews/:id', async (req, res) => {
    const review = id(req.params.id);
    const { status, owner_reply } = input(z.strictObject({
      status: z.enum(['pending','published','hidden','rejected']), owner_reply: text(2000, false)
    }), req.body);
    await db.tx(async tx => {
      one(await tx.query('UPDATE reviews SET status=$2,owner_reply=$3 WHERE id=$1 RETURNING id', [review, status, owner_reply]), 'Review');
      await audit(tx, req, 'review.moderated', review, { status });
    });
    res.json({ ok: true });
  });

  router.get('/support', async (req, res) => {
    const status = input(z.enum(['open','in_progress','resolved','closed']).optional(), req.query.status);
    const { rows } = await db.query(
      'SELECT * FROM support_tickets WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 100', [status ?? null]
    );
    res.json(rows);
  });

  router.put('/support/:id', async (req, res) => {
    const ticket = id(req.params.id);
    const { status, reply } = input(z.strictObject({
      status: z.enum(['open','in_progress','resolved','closed']), reply: text(4000, false)
    }), req.body);
    await db.tx(async tx => {
      const before = one(await tx.query('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [ticket]), 'Ticket');
      await tx.query('UPDATE support_tickets SET status=$2,reply=$3 WHERE id=$1', [ticket, status, reply]);
      if (reply && reply !== before.reply) await notify(tx, before.email, '303 support update', reply);
      await audit(tx, req, 'support.updated', ticket, { status });
    });
    res.json({ ok: true });
  });

  router.get('/marketing', async (_req, res) => {
    const [count, subscribers] = await Promise.all([
      db.query('SELECT count(*)::int AS total FROM newsletter'),
      db.query('SELECT email,created_at FROM newsletter ORDER BY created_at DESC LIMIT 100')
    ]);
    res.json({ total: count.rows[0].total, subscribers: subscribers.rows });
  });

  router.get('/marketing.csv', async (_req, res) => {
    const { rows } = await db.query('SELECT email,created_at FROM newsletter ORDER BY created_at DESC LIMIT 10000');
    if (rows.length >= 10000) fail(409, 'More than 10,000 subscribers. Export from the database using the deployment access policy.');
    sendCsv(res, '303-newsletter', ['Email', 'Subscribed (UTC)'], rows.map(row => [row.email, row.created_at]));
  });

  router.delete('/marketing/subscribers', async (req, res) => {
    const email = input(z.strictObject({ email: z.email().max(254).toLowerCase() }), req.body).email;
    await db.tx(async tx => {
      one(await tx.query('DELETE FROM newsletter WHERE email=$1 RETURNING email', [email]), 'Subscriber');
      await audit(tx, req, 'newsletter.unsubscribed', 'newsletter');
    });
    res.json({ ok: true });
  });

  router.get('/audit', async (req, res) => {
    const q = input(text(100, false), req.query.q ?? '');
    const { rows } = await db.query(
      'SELECT a.id,a.action,a.target,a.metadata,a.created_at,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id' +
      " WHERE ($1='' OR a.action ILIKE '%'||$1||'%' OR a.target ILIKE '%'||$1||'%')" +
      ' ORDER BY a.created_at DESC,a.id LIMIT 150', [q]
    );
    res.json(rows);
  });

  router.get('/security', async (req, res) => {
    const [account, events] = await Promise.all([
      db.query('SELECT username,verified_at,created_at,mfa_secret IS NOT NULL AS mfa,' +
        ' (SELECT count(*)::int FROM recovery_codes WHERE user_id=$1) AS recovery_codes,' +
        ' (SELECT count(*)::int FROM sessions WHERE user_id=$1 AND expires_at>now()) AS sessions FROM users WHERE id=$1', [req.user.id]),
      db.query("SELECT action,target,created_at FROM audit_logs WHERE action LIKE 'auth.%' OR action LIKE 'security.%' ORDER BY created_at DESC LIMIT 20")
    ]);
    res.json({ account: account.rows[0], events: events.rows, reauthenticated: req.user.reauthAt ?? null });
  });

  router.get('/settings/:key', async (req, res) => {
    const key = input(z.enum(['appearance','settings','legal']), req.params.key);
    const { rows } = await db.query('SELECT value FROM store_settings WHERE key=$1', [key]);
    res.json(rows[0]?.value ?? {});
  });

  router.put('/settings/:key', reauth, async (req, res) => {
    const key = input(z.enum(['appearance','settings','legal']), req.params.key);
    const data = input(settingsSchemas[key], req.body);
    await db.tx(async tx => {
      await tx.query('INSERT INTO store_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [key, JSON.stringify(data)]);
      await audit(tx, req, 'store.settings_changed', key);
    });
    res.json({ ok: true });
  });

  router.use((error, _req, _res, next) => {
    if (error.code === '23505') return next(Object.assign(new Error('This name, URL slug or code is already in use.'), { status: 409 }));
    if (error.code === '23503') return next(Object.assign(new Error('A linked record has been removed or is still in use.'), { status: 409 }));
    return next(error);
  });
  return router;
}
