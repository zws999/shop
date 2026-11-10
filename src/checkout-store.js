import { createHash } from 'node:crypto';
import { cryptoMethods, quoteCryptoUnits, validatePaymentDestination } from './payment-policy.js';
import { paypalConfigured } from './paypal.js';
import { HttpError } from './http.js';

export const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
export const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows;
export const emailOf = req => req.user?.verifiedAt ? req.user.email : null;
export const paidStatuses = new Set(['paid', 'processing', 'completed', 'partially_refunded']);
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invoicePattern = /^303-\d{4}-\d{6,10}$/;
const supportedCurrencies = ['USD', 'EUR', 'GBP', 'RON', 'CAD', 'AUD'];
const cartLifetime = "now() + interval '30 days'";

export function fail(status, message) {
  throw new HttpError(status, message);
}

export async function storeSettings(db, config) {
  const setting = await one(db, "SELECT value FROM store_settings WHERE key='settings'");
  const values = setting?.value ?? {};
  const tax = Number(values.taxBps ?? config.STORE_TAX_BPS ?? 0);
  const rate = values.shippingRate ?? config.STORE_SHIPPING_RATE;
  const countries = values.shippingCountries ?? (config.STORE_SHIPPING_COUNTRIES ?? '').split(',').map(value => value.trim());
  return {
    ...values,
    guestCheckout: values.guestCheckout ?? config.GUEST_CHECKOUT !== 'false',
    taxBps: Number.isInteger(tax) && tax >= 0 && tax <= 10000 ? tax : 0,
    shippingRate: rate !== undefined && rate !== '' && Number.isInteger(Number(rate)) && Number(rate) >= 0 ? Number(rate) : null,
    shippingCountries: Array.isArray(countries) ? countries.filter(value => /^[A-Z]{2}$/.test(value)) : []
  };
}

export function usableMethod(method, config) {
  if (!method?.enabled || !validatePaymentDestination(method.id, method.destination)) return false;
  const crypto = cryptoMethods[method.id];
  if (crypto) return Boolean(config.COINGECKO_API_KEY) && method.network === crypto.network;
  if (method.id === 'paypal') return paypalConfigured(config);
  return true;
}

export function publicMethod(method) {
  return {
    id: method.id, name: method.name, network: method.network,
    destination: method.destination, recipientName: method.recipient_name,
    instructions: method.instructions, currencies: method.currencies.filter(currency =>
      supportedCurrencies.includes(currency) && (method.id !== 'paypal' || currency !== 'RON')),
    expiresMinutes: method.expires_minutes, manual: method.id !== 'paypal',
    confirmations: cryptoMethods[method.id]
      ? Math.max(cryptoMethods[method.id].confirmations, method.confirmation_threshold || 0)
      : null
  };
}

export async function getCart(tx, req) {
  const id = req.user?.id ?? req.cartId;
  await tx.query('INSERT INTO carts(id,user_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [id, req.user?.id ?? null]);
  let cart = await one(tx, 'SELECT * FROM carts WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2 FOR UPDATE', [id, req.user?.id ?? null]);
  if (!cart) fail(409, 'Your cart is unavailable. Sign in again and retry.');
  if (new Date(cart.expires_at) <= new Date()) {
    await tx.query('DELETE FROM cart_items WHERE cart_id=$1', [id]);
    cart = await one(tx, `UPDATE carts SET expires_at=${cartLifetime}, coupon_code=NULL WHERE id=$1 RETURNING *`, [id]);
  }
  if (req.user && req.cartId !== id) {
    const guest = await one(tx, 'SELECT * FROM carts WHERE id=$1 AND user_id IS NULL FOR UPDATE', [req.cartId]);
    if (guest && new Date(guest.expires_at) > new Date()) {
      const existing = await rows(tx, 'SELECT product_id,variant_id,quantity FROM cart_items WHERE cart_id=$1 ORDER BY id', [id]);
      const incoming = await rows(tx, 'SELECT product_id,variant_id,quantity FROM cart_items WHERE cart_id=$1 ORDER BY id', [guest.id]);
      const profile = await cartItems(tx, id);
      const guestItems = await cartItems(tx, guest.id);
      const currency = profile[0]?.currency ?? guestItems[0]?.currency;
      const mergeable = new Set(guestItems.filter(item => item.currency === currency).map(item => item.product_id));
      let count = existing.length;
      for (const item of incoming) {
        if (!mergeable.has(item.product_id)) continue;
        const present = existing.some(line => line.product_id === item.product_id && line.variant_id === item.variant_id);
        if (!present && count >= 25) continue;
        await tx.query(`INSERT INTO cart_items(cart_id,product_id,variant_id,quantity) VALUES($1,$2,$3,$4)
          ON CONFLICT(cart_id,product_id,variant_id) DO UPDATE SET quantity=LEAST(50,cart_items.quantity+EXCLUDED.quantity)`,
        [id, item.product_id, item.variant_id, item.quantity]);
        if (!present) count += 1;
        await tx.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2 AND variant_id IS NOT DISTINCT FROM $3',
          [guest.id, item.product_id, item.variant_id]);
      }
      if (!cart.coupon_code && guest.coupon_code) {
        cart = await one(tx, 'UPDATE carts SET coupon_code=$2 WHERE id=$1 RETURNING *', [id, guest.coupon_code]);
      }
      await tx.query('DELETE FROM carts WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM cart_items WHERE cart_id=$1)', [guest.id]);
    }
  }
  return cart;
}

export const touchCart = (tx, id) => tx.query(`UPDATE carts SET expires_at=${cartLifetime} WHERE id=$1`, [id]);

export function cartItems(tx, id) {
  return rows(tx, `SELECT ci.id,ci.product_id,ci.variant_id,ci.quantity,p.name,p.slug,p.category_id,p.currency,p.kind,p.cost,
      p.stock AS product_stock,v.stock AS variant_stock,v.name AS variant_name,
      COALESCE(v.price,p.sale_price,p.price) AS unit_price,
      (p.active AND (p.publish_at IS NULL OR p.publish_at<=now()) AND
        ((ci.variant_id IS NOT NULL AND v.active AND v.product_id=p.id) OR
         (ci.variant_id IS NULL AND NOT EXISTS(SELECT 1 FROM variants av WHERE av.product_id=p.id AND av.active)))) AS available,
      (SELECT i.url FROM product_images i WHERE i.product_id=p.id ORDER BY i.position,i.id LIMIT 1) AS image
    FROM cart_items ci JOIN products p ON p.id=ci.product_id LEFT JOIN variants v ON v.id=ci.variant_id
    WHERE ci.cart_id=$1 ORDER BY p.id,ci.variant_id,ci.id`, [id]);
}

function presentCartItem(item) {
  const stocks = [item.product_stock, item.variant_stock].filter(stock => stock !== null);
  return {
    id: item.id, productId: item.product_id, variantId: item.variant_id, name: item.name,
    variantName: item.variant_name, slug: item.slug, kind: item.kind, quantity: item.quantity,
    unitPrice: item.unit_price, currency: item.currency, lineTotal: item.unit_price * item.quantity,
    stock: stocks.length ? Math.min(...stocks) : null, available: item.available === true, image: item.image
  };
}

export function discountFor(coupon, items, shipping) {
  const eligible = items.filter(item => (!coupon.product_id || coupon.product_id === item.product_id) &&
    (!coupon.category_id || coupon.category_id === item.category_id));
  const subtotal = eligible.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  if (!subtotal) return null;
  if (coupon.kind === 'percent') return { discount: Math.floor((subtotal * coupon.amount + 5000) / 10000), shipping };
  if (coupon.kind === 'fixed') return { discount: Math.min(subtotal, coupon.amount), shipping };
  if (!shipping) return null;
  return { discount: 0, shipping: 0 };
}

export async function cartSummary(tx, cart, config, options = {}) {
  const items = options.items ?? await cartItems(tx, cart.id);
  const settings = options.settings ?? await storeSettings(tx, config);
  const requiresShipping = items.some(item => item.kind === 'physical');
  let shipping = requiresShipping ? settings.shippingRate ?? 0 : 0;
  const currency = items[0]?.currency ?? 'USD';
  const subtotal = items.reduce((total, item) => total + item.unit_price * item.quantity, 0);
  let discount = 0;
  let couponError = null;
  const code = options.code ?? cart.coupon_code;
  if (code) {
    const coupon = await one(tx, `SELECT * FROM coupons WHERE code=$1${options.lockCoupon ? ' FOR UPDATE' : ''}`, [code]);
    const active = coupon?.enabled && (!coupon.starts_at || new Date(coupon.starts_at) <= new Date()) &&
      (!coupon.ends_at || new Date(coupon.ends_at) > new Date()) &&
      (!coupon.currency || coupon.currency === currency) && coupon.min_subtotal <= subtotal;
    const candidate = active && discountFor(coupon, items, shipping);
    if (!candidate) couponError = 'This promotion is unavailable for the current cart.';
    if (candidate) {
      const usage = await one(tx, `SELECT COUNT(*) AS total,
          COUNT(*) FILTER(WHERE user_id=$2 OR email=$3) AS customer
        FROM orders WHERE coupon_code=$1 AND status NOT IN ('cancelled','expired')`, [code, options.userId ?? null, options.email ?? null]);
      if ((coupon.max_uses && Number(usage.total) >= coupon.max_uses) ||
          (coupon.max_per_customer && Number(usage.customer) >= coupon.max_per_customer)) {
        couponError = 'This promotion has reached its usage limit.';
      } else if (coupon.first_purchase && (options.userId || options.email)) {
        const existing = await one(tx, `SELECT id FROM orders WHERE (user_id=$1 OR email=$2)
          AND status NOT IN ('cancelled','expired') LIMIT 1`, [options.userId ?? null, options.email ?? null]);
        if (existing) couponError = 'This promotion applies to a first purchase.';
      }
      if (!couponError) ({ discount, shipping } = candidate);
    }
  }
  const tax = Math.floor(((subtotal - discount + shipping) * settings.taxBps + 5000) / 10000);
  return {
    items: items.map(presentCartItem), requiresShipping, currency, subtotal, discount, shipping, tax,
    total: subtotal - discount + shipping + tax, coupon: code || null, couponError
  };
}

export function checkoutFingerprint(input) {
  const { idempotencyKey, ...payload } = input;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export const checkoutScope = req => req.user ? 'user:' + req.user.id : 'cart:' + req.cartId;

export async function existingCheckout(tx, scope, key, fingerprint) {
  const prior = await one(tx, 'SELECT * FROM orders WHERE idempotency_scope=$1 AND idempotency_key=$2', [scope, key]);
  if (prior && prior.request_fingerprint !== fingerprint) fail(409, 'This checkout request was already used with different information.');
  return prior;
}

async function nextInvoice(tx) {
  const year = new Date().getUTCFullYear();
  const sequence = await one(tx, `INSERT INTO invoice_sequences(year,last_number) VALUES($1,1)
    ON CONFLICT(year) DO UPDATE SET last_number=invoice_sequences.last_number+1 RETURNING last_number`, [year]);
  return '303-' + year + '-' + String(sequence.last_number).padStart(6, '0');
}

async function lockProducts(tx, items) {
  const productIds = [...new Set(items.map(item => item.product_id).filter(Boolean))];
  const variantIds = [...new Set(items.map(item => item.variant_id).filter(Boolean))];
  await tx.query('SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [productIds]);
  if (variantIds.length) await tx.query('SELECT id FROM variants WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [variantIds]);
}

async function stockEvent(tx, productId, variantId, delta, reason) {
  await tx.query('INSERT INTO inventory_events(product_id,variant_id,delta,reason) VALUES($1,$2,$3,$4)',
    [productId, variantId, delta, reason]);
}

async function changeStock(tx, item, sign) {
  const delta = item.quantity * sign;
  const reason = sign < 0 ? 'checkout_reservation' : 'reservation_release';
  if (item.reserved_product && item.product_id) {
    const result = await tx.query('UPDATE products SET stock=stock+$2 WHERE id=$1 AND stock+$2>=0 RETURNING id',
      [item.product_id, delta]);
    if (!result.rowCount && sign < 0) fail(409, item.name + ' has insufficient stock.');
    if (result.rowCount) await stockEvent(tx, item.product_id, null, delta, reason);
  }
  if (item.reserved_variant && item.variant_id) {
    const result = await tx.query('UPDATE variants SET stock=stock+$2 WHERE id=$1 AND stock+$2>=0 RETURNING id',
      [item.variant_id, delta]);
    if (!result.rowCount && sign < 0) fail(409, item.name + ' has insufficient variant stock.');
    if (result.rowCount) await stockEvent(tx, item.product_id, item.variant_id, delta, reason);
  }
}

async function reserveItem(tx, item) {
  if (!item.product_id) fail(409, 'A product in this order is no longer available.');
  await changeStock(tx, item, -1);
  if (item.kind === 'license') {
    const keys = await rows(tx, `SELECT id FROM license_keys WHERE product_id=$1 AND assigned_order_item IS NULL
      ORDER BY id LIMIT $2 FOR UPDATE`, [item.product_id, item.quantity]);
    if (keys.length !== item.quantity) fail(409, item.name + ' has insufficient license inventory.');
    await tx.query('UPDATE license_keys SET assigned_order_item=$1,assigned_at=now() WHERE id=ANY($2::uuid[])',
      [item.id, keys.map(key => key.id)]);
  }
}

export const orderItems = (tx, id) => rows(tx, 'SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id,variant_id,id', [id]);

export async function reserveExpiredOrder(tx, order) {
  if (!order.reservation_released) return;
  const items = await orderItems(tx, order.id);
  await lockProducts(tx, items);
  for (const item of items) {
    const product = item.product_id && await one(tx, 'SELECT stock FROM products WHERE id=$1', [item.product_id]);
    const variant = item.variant_id && await one(tx, 'SELECT stock FROM variants WHERE id=$1', [item.variant_id]);
    if (!product || (item.variant_name && !variant)) fail(409, 'An item in this invoice is unavailable for fulfillment.');
    const reservation = {
      ...item, reserved_product: product.stock !== null, reserved_variant: Boolean(variant && variant.stock !== null)
    };
    await reserveItem(tx, reservation);
    await tx.query('UPDATE order_items SET reserved_product=$2,reserved_variant=$3 WHERE id=$1',
      [item.id, reservation.reserved_product, reservation.reserved_variant]);
  }
  await tx.query('UPDATE orders SET reservation_released=false WHERE id=$1', [order.id]);
}

export async function releaseOrder(tx, order, status) {
  if (!order.reservation_released) {
    const items = await orderItems(tx, order.id);
    await lockProducts(tx, items);
    for (const item of items) {
      await changeStock(tx, item, 1);
      await tx.query('UPDATE license_keys SET assigned_order_item=NULL,assigned_at=NULL WHERE assigned_order_item=$1', [item.id]);
    }
  }
  await tx.query('UPDATE orders SET status=$2,reservation_released=true,updated_at=now() WHERE id=$1', [order.id, status]);
  await tx.query('UPDATE payments SET status=$2 WHERE order_id=$1', [order.id, status]);
}

export async function expireOrders(db) {
  const expiry = `((status='pending_payment' AND expires_at<=now()) OR
    (method_id<>'paypal' AND status IN ('awaiting_verification','payment_under_review') AND
      updated_at<=now()-interval '3 days'))`;
  const overdue = await rows(db, 'SELECT id FROM orders WHERE ' + expiry + ' ORDER BY expires_at,id LIMIT 20');
  let released = 0;
  for (const { id } of overdue) {
    released += await db.tx(async tx => {
      const order = await one(tx, 'SELECT * FROM orders WHERE id=$1 AND ' + expiry + ' FOR UPDATE SKIP LOCKED', [id]);
      if (!order) return 0;
      await releaseOrder(tx, order, 'expired');
      return 1;
    });
  }
  return released;
}

export async function createOrder(tx, req, input, config, pricing, notify) {
  const cart = await getCart(tx, req);
  const scope = checkoutScope(req);
  const fingerprint = checkoutFingerprint(input);
  const prior = await existingCheckout(tx, scope, input.idempotencyKey, fingerprint);
  if (prior) return prior;
  const settings = await storeSettings(tx, config);
  if (settings.maintenanceMode) fail(503, 'Checkout is temporarily unavailable.');
  if (!req.user && !settings.guestCheckout) fail(401, 'Sign in to continue to checkout.');
  const method = await one(tx, 'SELECT * FROM payment_methods WHERE id=$1 FOR SHARE', [input.methodId]);
  if (!usableMethod(method, config)) fail(409, 'This payment method is unavailable.');
  const display = publicMethod(method);
  const initial = await cartItems(tx, cart.id);
  if (!initial.length) fail(409, 'Your cart is empty.');
  await lockProducts(tx, initial);
  const items = await cartItems(tx, cart.id);
  if (initial.length !== items.length || items.some(item => !item.available)) fail(409, 'Your cart contains unavailable products.');
  if (items.some(item => item.currency !== items[0].currency)) fail(409, 'Products in this cart must use one currency.');
  const identity = createHash('sha256').update(input.email).digest('hex');
  await tx.query('INSERT INTO checkout_identities(identity_hash) VALUES($1) ON CONFLICT DO NOTHING', [identity]);
  await tx.query('SELECT identity_hash FROM checkout_identities WHERE identity_hash=$1 FOR UPDATE', [identity]);
  const reservations = await one(tx, `SELECT COUNT(*) AS count FROM orders
    WHERE (idempotency_scope=$1 OR email=$2) AND reservation_released=false
    AND ((status='pending_payment' AND expires_at>now()) OR status IN ('awaiting_verification','payment_under_review'))`,
  [scope, input.email]);
  if (Number(reservations.count) >= 5) fail(409, 'You have five open orders. Resolve a pending order to check out again.');
  const summary = await cartSummary(tx, cart, config, {
    items, settings, code: input.coupon, lockCoupon: true, userId: req.user?.id, email: input.email
  });
  if (summary.couponError) fail(409, summary.couponError);
  if (!display.currencies.includes(summary.currency)) fail(409, 'This payment method does not support the cart currency.');
  if (summary.total <= 0 || summary.total > 2147483647) fail(409, 'The checkout total must be positive and within the supported order limit.');
  if (summary.requiresShipping && (!input.shippingAddress || settings.shippingRate === null ||
      !settings.shippingCountries.includes(input.shippingAddress.country))) {
    fail(400, 'Enter a complete shipping address in a supported country.');
  }
  const crypto = cryptoMethods[method.id];
  const now = new Date();
  const cryptoAmount = crypto && pricing?.currency === summary.currency
    ? quoteCryptoUnits(summary.total, pricing.price, crypto.precision) : null;
  if (crypto && (!cryptoAmount || now - pricing.quotedAt > 300_000)) {
    fail(503, 'A fresh crypto quote is unavailable. Retry checkout shortly.');
  }
  const invoice = await nextInvoice(tx);
  const expires = new Date(now.getTime() + method.expires_minutes * 60000);
  const order = await one(tx, `INSERT INTO orders(invoice_id,user_id,cart_id,email,customer_name,currency,
    subtotal,discount,tax,shipping,total,method_id,payment_name,destination,recipient_name,network,
    confirmation_threshold,payment_instructions,crypto_amount,quoted_at,expires_at,coupon_code,
    shipping_address,idempotency_key,request_fingerprint,idempotency_scope,issuer)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
    RETURNING *`, [invoice, req.user?.id ?? null, req.cartId, input.email, input.customerName, summary.currency,
    summary.subtotal, summary.discount, summary.tax, summary.shipping, summary.total, method.id, method.name, method.destination,
    method.recipient_name, method.network, display.confirmations, method.instructions, cryptoAmount, pricing?.quotedAt ?? null,
    expires, summary.coupon, summary.requiresShipping ? input.shippingAddress : null, input.idempotencyKey, fingerprint, scope,
    { legalName: settings.legalName, address: settings.legalAddress, jurisdiction: settings.jurisdiction, taxId: settings.taxId }]);
  for (const item of items) {
    const line = await one(tx, `INSERT INTO order_items(order_id,product_id,variant_id,name,variant_name,quantity,unit_price,cost,
      kind,reserved_product,reserved_variant) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [order.id,item.product_id,item.variant_id,item.name,item.variant_name,item.quantity,item.unit_price,item.cost,item.kind,
      item.product_stock !== null,item.variant_stock !== null]);
    await reserveItem(tx, line);
    if (item.kind === 'download') {
      const assets = await tx.query(`INSERT INTO order_assets(order_item_id,asset_id)
        SELECT $1,id FROM digital_assets WHERE product_id=$2 RETURNING asset_id`, [line.id, item.product_id]);
      if (!assets.rowCount) fail(409, item.name + ' is not yet available for delivery.');
    }
  }
  await tx.query('INSERT INTO invoices(id,order_id) VALUES($1,$2)', [order.invoice_id, order.id]);
  await tx.query('INSERT INTO payments(order_id) VALUES($1)', [order.id]);
  await tx.query('DELETE FROM cart_items WHERE cart_id=$1', [cart.id]);
  await tx.query('UPDATE carts SET coupon_code=NULL WHERE id=$1', [cart.id]);
  const amount = cryptoAmount ? cryptoAmount + ' ' + method.id.toUpperCase() : (order.total / 100).toFixed(2) + ' ' + order.currency;
  await notify(tx, order.email, 'Order ' + order.invoice_id,
    `Your invoice is ${order.invoice_id}. Amount due: ${amount}. Payment method: ${order.payment_name}. ` +
    (method.id === 'paypal' ? 'Open your checkout to continue to PayPal.' : `Destination: ${order.destination}. ${order.payment_instructions}`) +
    ' Order: ' + orderLink(config, order.id));
  return order;
}

export function orderLink(config, id) {
  return new URL('/#/orders/' + id, config.APP_URL).href;
}

export function checkOrderRef(value) {
  if (!uuidPattern.test(value) && !invoicePattern.test(value)) fail(404, 'Order not found.');
}

export async function ownedOrder(tx, req, ref, lock = false) {
  checkOrderRef(ref);
  const key = uuidPattern.test(ref) ? 'id' : 'invoice_id';
  const order = await one(tx, `SELECT * FROM orders WHERE ${key}=$1
    AND (user_id=$2 OR (user_id IS NULL AND (($2::uuid IS NULL AND cart_id=$3) OR email=$4)))${lock ? ' FOR UPDATE' : ''}`,
  [ref, req.user?.id ?? null, req.cartId, emailOf(req)]);
  if (!order) fail(404, 'Order not found.');
  return order;
}

export async function ownerOrder(tx, ref) {
  checkOrderRef(ref);
  const key = uuidPattern.test(ref) ? 'id' : 'invoice_id';
  const order = await one(tx, `SELECT * FROM orders WHERE ${key}=$1 FOR UPDATE`, [ref]);
  if (!order) fail(404, 'Order not found.');
  return order;
}
