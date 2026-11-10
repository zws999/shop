import express from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { openSecret, sealSecret } from './security.js';
import { HttpError } from './http.js';
import { cryptoMethods, cryptoPaymentUri, marketPrice, paymentReference } from './payment-policy.js';
import { paypalClient, paypalConfigured } from './paypal.js';
import { chainEvidence, chainLookupReady } from './chain-evidence.js';
import {
  cartItems, cartSummary, checkoutFingerprint, checkoutScope, createOrder, emailOf,
  existingCheckout, fail, getCart, one, orderItems, orderLink, ownedOrder, ownerOrder, paidStatuses,
  publicMethod, releaseOrder, reserveExpiredOrder, rows, touchCart, usableMethod
} from './checkout-store.js';
import {
  approveManual, manualReviewStatuses, recordNote, refundRequest, syncPayPalOrder, syncRefund
} from './order-payments.js';

export { expireOrders } from './checkout-store.js';

const uuid = z.uuid();
const quantity = z.number().int().min(1).max(50);
const couponCode = z.string().trim().toUpperCase().regex(/^(?:[A-Z0-9_-]{2,40})?$/);
const methods = z.enum(['btc', 'eth', 'ltc', 'sol', 'revolut', 'paypal']);
const noteText = z.string().trim().max(2000).optional();
const receiptInput = z.object({
  filename: z.string().trim().min(1).max(180),
  mime: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
  data: z.string().min(4).max(5_592_408)
});
const checkoutInput = z.object({
  email: z.email().trim().toLowerCase().max(254),
  customerName: z.string().trim().min(2).max(120),
  methodId: methods,
  idempotencyKey: uuid,
  coupon: couponCode.optional(),
  shippingAddress: z.object({
    address1: z.string().trim().min(3).max(200),
    address2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().min(1).max(30),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)
  }).nullable().optional()
});
const receiptFormats = {
  'image/png': { prefix: Buffer.from('89504e470d0a1a0a', 'hex'), extension: '.png' },
  'image/jpeg': { prefix: Buffer.from('ffd8ff', 'hex'), extension: '.jpg' },
  'application/pdf': { prefix: Buffer.from('%PDF-'), extension: '.pdf' }
};
const empty = async () => {};

function input(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const field = result.error.issues[0].path.join('.');
    fail(400, field ? 'Check the value for ' + field + '.' : 'Check the submitted information.');
  }
  return result.data;
}

function receiptFile(file) {
  if (!file) return { name: null, type: null, data: null };
  const { prefix, extension } = receiptFormats[file.mime];
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(file.data) || file.data.length % 4 !== 0) fail(400, 'The receipt encoding is invalid.');
  const data = Buffer.from(file.data, 'base64');
  if (data.length > 4 * 1024 * 1024 || !data.subarray(0, prefix.length).equals(prefix)) {
    fail(400, 'Upload a PNG, JPEG or PDF receipt no larger than 4 MB.');
  }
  const base = file.filename.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9_.-]+/gi, '-').replace(/^\.+/, '');
  return { name: (base || 'receipt') + extension, type: file.mime, data };
}

function orderSummary(order) {
  return {
    id: order.id, invoiceId: order.invoice_id, status: order.status,
    methodId: order.method_id, name: order.payment_name, currency: order.currency,
    subtotal: order.subtotal, discount: order.discount, tax: order.tax, shipping: order.shipping,
    total: order.total, refundTotal: order.refund_total,
    expiresAt: order.expires_at, createdAt: order.created_at, paidAt: order.paid_at,
    customerName: order.customer_name
  };
}

async function orderView(db, order) {
  const items = await orderItems(db, order.id);
  const deliveriesAvailable = order.paid_at && !order.reservation_released && paidStatuses.has(order.status);
  const detail = [];
  for (const item of items) {
    const assets = deliveriesAvailable ? await rows(db, `SELECT a.id,a.filename,a.download_limit,COALESCE(d.count,0) AS used
      FROM order_assets oa JOIN digital_assets a ON a.id=oa.asset_id
      LEFT JOIN downloads d ON d.order_item_id=oa.order_item_id AND d.asset_id=oa.asset_id
      WHERE oa.order_item_id=$1 ORDER BY a.created_at,a.id`, [item.id]) : [];
    const keys = deliveriesAvailable && item.kind === 'license'
      ? await rows(db, 'SELECT secret FROM license_keys WHERE assigned_order_item=$1 ORDER BY id', [item.id]) : [];
    detail.push({
      id: item.id, productId: item.product_id, variantId: item.variant_id, name: item.name,
      variantName: item.variant_name, quantity: item.quantity, unitPrice: item.unit_price, kind: item.kind,
      assets: assets.map(asset => {
        const downloadLimit = asset.download_limit * item.quantity;
        const token = sealSecret(JSON.stringify({ order: order.id, item: item.id, asset: asset.id, expires: Date.now() + 10 * 60_000 }), 'download');
        return {
          id: asset.id, filename: asset.filename, downloadLimit, used: asset.used,
          url: asset.used < downloadLimit
            ? '/api/orders/' + order.id + '/downloads/' + item.id + '/' + asset.id + '?token=' + encodeURIComponent(token)
            : null
        };
      }),
      licenses: keys.map(key => openSecret(key.secret))
    });
  }
  const payment = await one(db, 'SELECT status,provider_order_id FROM payments WHERE order_id=$1', [order.id]);
  const proof = await one(db, 'SELECT reference,status,created_at FROM payment_submissions WHERE order_id=$1 ORDER BY created_at DESC,id LIMIT 1', [order.id]);
  const canPay = order.status === 'pending_payment' && new Date(order.expires_at) > new Date();
  return {
    ...orderSummary(order), email: order.email, network: order.network, destination: order.destination,
    recipientName: order.recipient_name, instructions: order.payment_instructions, manual: order.method_id !== 'paypal',
    cryptoAmount: order.crypto_amount, quotedAt: order.quoted_at, confirmations: order.confirmation_threshold,
    qrDataUrl: order.crypto_amount && canPay
      ? await QRCode.toDataURL(cryptoPaymentUri(order.method_id, order.destination, order.crypto_amount), { margin: 2, width: 280 })
      : null,
    paymentStatus: payment?.status, requiresShipping: Boolean(order.shipping_address),
    shippingAddress: order.shipping_address, items: detail, canPay, canCancel: canPay && !payment?.provider_order_id,
    lastSubmission: proof ? { reference: proof.reference, status: proof.status, createdAt: proof.created_at } : null,
    invoiceUrl: '/api/orders/' + order.id + '/invoice.pdf'
  };
}

async function withLockedOrder(db, req, action, administrator = false) {
  return db.tx(async tx => {
    const order = administrator ? await ownerOrder(tx, req.params.id) : await ownedOrder(tx, req, req.params.id, true);
    return action(tx, order);
  });
}

async function currentOrder(db, req) {
  return withLockedOrder(db, req, async (tx, order) => {
    if (order.status !== 'pending_payment' || new Date(order.expires_at) > new Date()) return order;
    await releaseOrder(tx, order, 'expired');
    return { ...order, status: 'expired' };
  });
}

function invoicePdf(res, order, items) {
  const pdf = new PDFDocument({ size: 'A4', margin: 52, info: { Title: 'Invoice ' + order.invoice_id } });
  const money = amount => new Intl.NumberFormat('en', { style: 'currency', currency: order.currency }).format(amount / 100);
  res.type('application/pdf').attachment(order.invoice_id + '.pdf');
  res.type('application/pdf').set('Cache-Control', 'private, no-store');
  pdf.pipe(res);
  pdf.fillColor('#693DDF').fontSize(38).text('303', { continued: true });
  pdf.fontSize(10).fillColor('#191920').text('   SERVICES / SHOP');
  pdf.moveDown(2).fontSize(24).text('Invoice ' + order.invoice_id);
  pdf.moveDown(0.5).fontSize(11).text('Issued ' + new Date(order.created_at).toISOString().slice(0, 10));
  pdf.text('Order status: ' + order.status.replaceAll('_', ' '));
  pdf.text('Payment method: ' + order.payment_name);
  const issuer = order.issuer;
  if (issuer?.legalName) {
    pdf.moveDown().text('Seller').fontSize(10).text(issuer.legalName);
    if (issuer.address) pdf.text(issuer.address);
    if (issuer.taxId) pdf.text('Tax ID: ' + issuer.taxId);
    if (issuer.jurisdiction) pdf.text(issuer.jurisdiction);
  }
  pdf.moveDown().fontSize(11).text('Bill to').fontSize(10).text(order.customer_name).text(order.email);
  const address = order.shipping_address;
  if (address) {
    pdf.moveDown(0.5).text([address.address1, address.address2, address.city, address.region, address.postalCode, address.country]
      .filter(Boolean).join(', '));
  }
  pdf.moveDown().fontSize(11);
  for (const item of items) {
    const name = item.variant_name ? item.name + ' / ' + item.variant_name : item.name;
    pdf.text(item.quantity + ' x ' + name + ' @ ' + money(item.unit_price));
  }
  pdf.moveDown().text('Subtotal  ' + money(order.subtotal), { align: 'right' });
  pdf.text('Discount  ' + money(order.discount), { align: 'right' });
  pdf.text('Shipping  ' + money(order.shipping), { align: 'right' });
  pdf.text('Tax  ' + money(order.tax), { align: 'right' });
  pdf.moveDown(0.5).fontSize(17).text('Total  ' + money(order.total), { align: 'right' });
  if (order.refund_total) pdf.moveDown(0.5).fontSize(11).text('Refunded  ' + money(order.refund_total), { align: 'right' });
  pdf.end();
}

function paymentFailure(error) {
  if (error instanceof HttpError) throw error;
  if (error.issue === 'ORDER_NOT_APPROVED') fail(409, 'Approve the order in PayPal and retry.');
  if (error.issue === 'INSTRUMENT_DECLINED') fail(409, 'PayPal declined this funding source. Choose another in PayPal.');
  fail(502, 'The payment provider could not confirm the request. Retry or contact support with your invoice ID.');
}

function refundCaptureId(data) {
  if (data?.supplementary_data?.related_ids?.capture_id) return data.supplementary_data.related_ids.capture_id;
  const up = data?.links?.find(link => link.rel === 'up')?.href;
  return typeof up === 'string' ? up.match(/\/v2\/payments\/captures\/([A-Z0-9]+)$/)?.[1] : null;
}

function orderProviderId(data) {
  if (data?.supplementary_data?.related_ids?.order_id) return data.supplementary_data.related_ids.order_id;
  const up = data?.links?.find(link => link.rel === 'up')?.href;
  return typeof up === 'string' ? up.match(/\/v2\/checkout\/orders\/([A-Z0-9]+)$/)?.[1] : null;
}

export function commerceRouter({ db, config, owner, reauth, audit = empty, notify = empty, checkLaunch = empty, rate = empty }) {
  const router = express.Router();
  const client = paypalClient(config);
  const events = { audit, notify, config };

  router.use(['/cart', '/checkout', '/orders', '/payment-methods'], (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  router.get('/payment-methods', async (_req, res) => {
    const active = (await rows(db, 'SELECT * FROM payment_methods ORDER BY sort_order,id')).filter(method => usableMethod(method, config));
    res.json({ methods: active.map(publicMethod) });
  });

  router.get('/cart', async (req, res) => {
    const result = await db.tx(async tx => cartSummary(tx, await getCart(tx, req), config, { userId: req.user?.id, email: req.user?.email }));
    res.json(result);
  });

  router.post('/cart/items', async (req, res) => {
    const body = input(z.object({ productId: uuid, variantId: uuid.nullable().optional(), quantity }), req.body);
    const result = await db.tx(async tx => {
      const cart = await getCart(tx, req);
      const prior = await cartItems(tx, cart.id);
      const line = prior.find(item => item.product_id === body.productId && item.variant_id === (body.variantId ?? null));
      if (!line && prior.length >= 25) fail(409, 'The cart already contains 25 distinct products.');
      if ((line?.quantity ?? 0) + body.quantity > 50) fail(409, 'The maximum line quantity is 50.');
      const product = await one(tx, 'SELECT currency FROM products WHERE id=$1 AND active AND (publish_at IS NULL OR publish_at<=now())', [body.productId]);
      if (!product) fail(404, 'Product is unavailable.');
      if (prior.some(item => item.currency !== product.currency)) fail(409, 'Complete your existing cart before adding products in another currency.');
      if (body.variantId && !await one(tx, 'SELECT id FROM variants WHERE id=$1 AND product_id=$2 AND active', [body.variantId, body.productId])) {
        fail(400, 'Select an available variant.');
      }
      await tx.query(`INSERT INTO cart_items(cart_id,product_id,variant_id,quantity) VALUES($1,$2,$3,$4)
        ON CONFLICT(cart_id,product_id,variant_id) DO UPDATE SET quantity=cart_items.quantity+EXCLUDED.quantity`,
      [cart.id, body.productId, body.variantId ?? null, body.quantity]);
      const summary = await cartSummary(tx, cart, config);
      const changed = summary.items.find(item => item.productId === body.productId && item.variantId === (body.variantId ?? null));
      if (!changed?.available || (changed.stock !== null && changed.stock < changed.quantity)) fail(409, 'The selected product is unavailable in that quantity.');
      await touchCart(tx, cart.id);
      return summary;
    });
    res.status(201).json(result);
  });

  router.patch('/cart/items/:itemId', async (req, res) => {
    const id = input(uuid, req.params.itemId);
    const { quantity: count } = input(z.object({ quantity }), req.body);
    const result = await db.tx(async tx => {
      const cart = await getCart(tx, req);
      const changed = await tx.query('UPDATE cart_items SET quantity=$3 WHERE id=$1 AND cart_id=$2 RETURNING id', [id, cart.id, count]);
      if (!changed.rowCount) fail(404, 'Cart item not found.');
      const summary = await cartSummary(tx, cart, config);
      const line = summary.items.find(item => item.id === id);
      if (!line?.available || (line.stock !== null && line.stock < count)) fail(409, 'The selected product is unavailable in that quantity.');
      await touchCart(tx, cart.id);
      return summary;
    });
    res.json(result);
  });

  router.delete('/cart/items/:itemId', async (req, res) => {
    const id = input(uuid, req.params.itemId);
    const result = await db.tx(async tx => {
      const cart = await getCart(tx, req);
      await tx.query('DELETE FROM cart_items WHERE id=$1 AND cart_id=$2', [id, cart.id]);
      await touchCart(tx, cart.id);
      return cartSummary(tx, cart, config);
    });
    res.json(result);
  });

  router.post('/cart/coupon', async (req, res) => {
    const { code } = input(z.object({ code: couponCode }), req.body);
    const result = await db.tx(async tx => {
      const cart = await getCart(tx, req);
      const summary = await cartSummary(tx, cart, config, { code, userId: req.user?.id, email: req.user?.email });
      if (summary.couponError) fail(409, summary.couponError);
      await tx.query('UPDATE carts SET coupon_code=$2 WHERE id=$1', [cart.id, code || null]);
      await touchCart(tx, cart.id);
      return summary;
    });
    res.json(result);
  });

  router.post('/checkout', async (req, res) => {
    const body = input(checkoutInput, req.body);
    if (req.user) body.email = req.user.email;
    const prior = await existingCheckout(db, checkoutScope(req), body.idempotencyKey, checkoutFingerprint(body));
    if (prior) return res.json({ order: await orderView(db, prior) });
    await rate(db, 'checkout', req.ip, 20, 900);
    await checkLaunch(req);
    let pricing;
    if (cryptoMethods[body.methodId]) {
      const method = await one(db, 'SELECT * FROM payment_methods WHERE id=$1', [body.methodId]);
      if (!usableMethod(method, config)) fail(409, 'This payment method is unavailable.');
      const currency = await db.tx(async tx => (await cartItems(tx, (await getCart(tx, req)).id))[0]?.currency);
      if (!currency) fail(409, 'Your cart is empty.');
      try {
        pricing = { ...await marketPrice(config, body.methodId, currency), currency };
      } catch {
        fail(503, 'A fresh crypto quote is unavailable. Retry checkout shortly.');
      }
    }
    const order = await db.tx(tx => createOrder(tx, req, body, config, pricing, notify));
    res.status(201).json({ order: await orderView(db, order) });
  });

  router.get('/orders', async (req, res) => {
    const list = await rows(db, `SELECT * FROM orders WHERE user_id=$1 OR
      (user_id IS NULL AND (($1::uuid IS NULL AND cart_id=$2) OR email=$3))
      ORDER BY created_at DESC,id LIMIT 100`, [req.user?.id ?? null, req.cartId, emailOf(req)]);
    res.json({ orders: list.map(orderSummary) });
  });

  router.get('/orders/:id', async (req, res) => res.json({ order: await orderView(db, await currentOrder(db, req)) }));

  router.post('/orders/:id/cancel', async (req, res) => {
    await withLockedOrder(db, req, async (tx, order) => {
      const payment = await one(tx, 'SELECT provider_order_id FROM payments WHERE order_id=$1', [order.id]);
      if (order.status !== 'pending_payment' || payment?.provider_order_id) fail(409, 'This order can no longer be cancelled from checkout.');
      await releaseOrder(tx, order, 'cancelled');
    });
    res.json({ order: await orderView(db, await ownedOrder(db, req, req.params.id)) });
  });

  router.post('/orders/:id/submit', async (req, res) => {
    await rate(db, 'payment_proof', req.ip, 30, 3600);
    const body = input(z.object({ reference: z.string().trim().min(4).max(160), note: noteText, receipt: receiptInput.nullable().optional() }), req.body);
    const file = receiptFile(body.receipt);
    await withLockedOrder(db, req, async (tx, order) => {
      if (order.method_id === 'paypal' || !['pending_payment', 'expired', 'awaiting_verification'].includes(order.status)) {
        fail(409, 'This order does not accept payment submissions.');
      }
      const reference = paymentReference(order.method_id, body.reference);
      if (!reference) fail(400, 'Enter a valid transaction reference for this payment method.');
      const credited = await one(tx, 'SELECT order_id FROM transaction_references WHERE method_id=$1 AND reference=$2', [order.method_id, reference]);
      if (credited) fail(409, 'This transaction reference has already been credited.');
      const prior = await one(tx, 'SELECT COUNT(*) AS count FROM payment_submissions WHERE order_id=$1', [order.id]);
      if (Number(prior.count) >= 3) fail(409, 'This order has reached its submission limit. Contact support with your invoice ID.');
      const proof = await one(tx, `INSERT INTO payment_submissions(order_id,reference,note,receipt_filename,receipt_type,receipt)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [order.id, body.reference, body.note ?? '', file.name, file.type, file.data]);
      await tx.query("UPDATE orders SET status='awaiting_verification',updated_at=now() WHERE id=$1", [order.id]);
      await tx.query("UPDATE payments SET status='submitted' WHERE order_id=$1", [order.id]);
      await notify(tx, order.email, 'Payment submitted for ' + order.invoice_id,
        'Your payment details were received and await verification. Open a Discord support ticket with your invoice ID and payment confirmation. Order: ' +
        orderLink(config, order.id));
      const ownerEmail = config.OWNER_EMAIL || (await one(tx, "SELECT email FROM users WHERE role='owner'"))?.email;
      if (ownerEmail) await notify(tx, ownerEmail, 'Payment needs verification for ' + order.invoice_id,
        'A customer submitted payment details. Open the Control Center to independently verify the transfer.');
      await audit(tx, req, 'payment.submitted', order.invoice_id, { submissionId: proof.id, method: order.method_id });
    });
    res.json({ order: await orderView(db, await ownedOrder(db, req, req.params.id)) });
  });

  router.post('/orders/:id/paypal/start', async (req, res) => {
    const result = await withLockedOrder(db, req, async (tx, order) => {
      if (order.method_id !== 'paypal' || order.status !== 'pending_payment' || new Date(order.expires_at) <= new Date()) {
        fail(409, 'This PayPal checkout is unavailable.');
      }
      const payment = await one(tx, 'SELECT * FROM payments WHERE order_id=$1', [order.id]);
      if (payment.approval_url) return { approvalUrl: payment.approval_url };
      let provider;
      try { provider = await client.create(order); } catch (error) { paymentFailure(error); }
      await tx.query("UPDATE payments SET provider_order_id=$2,approval_url=$3,status='approved_checkout' WHERE order_id=$1",
        [order.id, provider.providerOrderId, provider.approvalUrl]);
      return { approvalUrl: provider.approvalUrl };
    });
    res.json(result);
  });

  router.post('/orders/:id/paypal/capture', async (req, res) => {
    await withLockedOrder(db, req, async (tx, order) => {
      if (order.method_id !== 'paypal') fail(409, 'This order does not use PayPal.');
      if (order.paid_at) return;
      const payment = await one(tx, 'SELECT * FROM payments WHERE order_id=$1', [order.id]);
      if (!payment?.provider_order_id) fail(409, 'Start PayPal checkout first.');
      if (!['pending_payment', 'payment_under_review'].includes(order.status)) fail(409, 'This PayPal checkout is no longer active.');
      if (order.status === 'pending_payment' && new Date(order.expires_at) <= new Date()) fail(409, 'This PayPal checkout expired.');
      let provider;
      try {
        provider = order.status === 'payment_under_review'
          ? await client.getOrder(payment.provider_order_id)
          : await client.capture(payment.provider_order_id, order.id);
      } catch (error) { paymentFailure(error); }
      await syncPayPalOrder(tx, req, order, payment, provider, client, events);
    });
    res.json({ order: await orderView(db, await ownedOrder(db, req, req.params.id)) });
  });

  router.get('/orders/:id/invoice.pdf', async (req, res) => {
    const order = await ownedOrder(db, req, req.params.id);
    invoicePdf(res, order, await orderItems(db, order.id));
  });

  router.get('/orders/:id/downloads/:itemId/:assetId', async (req, res) => {
    const itemId = input(uuid, req.params.itemId);
    const assetId = input(uuid, req.params.assetId);
    const file = await withLockedOrder(db, req, async (tx, order) => {
      if (!order.paid_at || order.reservation_released || !paidStatuses.has(order.status)) fail(404, 'Download not found.');
      let link;
      try { link = JSON.parse(openSecret(req.query.token, 'download')); } catch { fail(403, 'Open your order to get a fresh download link.'); }
      if (link.order !== order.id || link.item !== itemId || link.asset !== assetId || link.expires < Date.now()) {
        fail(403, 'Open your order to get a fresh download link.');
      }
      const asset = await one(tx, `SELECT a.filename,a.data,a.download_limit,oi.quantity FROM order_assets oa
        JOIN order_items oi ON oi.id=oa.order_item_id JOIN digital_assets a ON a.id=oa.asset_id
        WHERE oi.order_id=$1 AND oa.order_item_id=$2 AND oa.asset_id=$3`, [order.id, itemId, assetId]);
      if (!asset) fail(404, 'Download not found.');
      const use = await tx.query(`INSERT INTO downloads(order_item_id,asset_id,count) VALUES($1,$2,1)
        ON CONFLICT(order_item_id,asset_id) DO UPDATE SET count=downloads.count+1,last_download_at=now()
        WHERE downloads.count<$3 RETURNING count`, [itemId, assetId, asset.download_limit * asset.quantity]);
      if (!use.rowCount) fail(403, 'This purchase has reached its download limit.');
      return asset;
    });
    res.attachment(file.filename).type('application/octet-stream').send(Buffer.from(file.data));
  });

  router.post('/webhooks/paypal', async (req, res) => {
    if (!paypalConfigured(config)) fail(503, 'PayPal webhook is unavailable.');
    let valid;
    try { valid = await client.verifyWebhook(req.headers, req.body, req.rawBody?.toString('utf8')); } catch (error) { paymentFailure(error); }
    if (!valid) fail(401, 'PayPal webhook signature could not be verified.');
    const event = req.body;
    const resource = event.resource;
    const eventType = event.event_type;
    const supported = ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED',
      'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.REFUND.PENDING', 'PAYMENT.REFUND.FAILED', 'PAYMENT.CAPTURE.REVERSED'];
    if (!supported.includes(eventType)) return res.sendStatus(204);
    await db.tx(async tx => {
      const seen = await tx.query("INSERT INTO provider_events(provider,event_id,event_type) VALUES('paypal',$1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
        [event.id, eventType]);
      if (!seen.rowCount) return;
      const isRefund = eventType === 'PAYMENT.CAPTURE.REFUNDED' || eventType.startsWith('PAYMENT.REFUND.');
      const captureId = isRefund ? refundCaptureId(resource) : resource?.id;
      const providerId = orderProviderId(resource);
      let payment = await one(tx, `SELECT * FROM payments WHERE provider_order_id IS NOT NULL AND
        (provider_order_id=$1 OR transaction_id=$2) ORDER BY (provider_order_id=$1) DESC NULLS LAST LIMIT 1`,
        [providerId ?? null, captureId ?? null]);
      if (!payment?.provider_order_id) return;
      const order = await ownerOrder(tx, payment.order_id);
      payment = await one(tx, 'SELECT * FROM payments WHERE order_id=$1', [order.id]);
      if (isRefund) {
        if (captureId !== payment.transaction_id || !order.paid_at) fail(409, 'The PayPal refund could not be matched to a verified capture.');
        await syncRefund(tx, req, order, resource, events);
      } else if (eventType === 'PAYMENT.CAPTURE.REVERSED' && captureId === payment.transaction_id && order.paid_at) {
        await tx.query("UPDATE orders SET status='disputed',updated_at=now() WHERE id=$1", [order.id]);
        await tx.query("UPDATE payments SET status='disputed' WHERE order_id=$1", [order.id]);
        await audit(tx, req, 'payment.paypal_reversed', order.invoice_id, { eventId: event.id });
      } else {
        let provider;
        try { provider = await client.getOrder(payment.provider_order_id); } catch (error) { paymentFailure(error); }
        await syncPayPalOrder(tx, req, order, payment, provider, client, events);
      }
    });
    res.sendStatus(204);
  });

  router.get('/admin/orders/:id/invoice.pdf', owner, async (req, res) => {
    const order = await withLockedOrder(db, req, (_tx, order) => order, true);
    invoicePdf(res, order, await orderItems(db, order.id));
  });

  router.get('/admin/orders/:id/receipt/:submissionId', owner, async (req, res) => {
    const id = input(uuid, req.params.submissionId);
    const file = await withLockedOrder(db, req, (tx, order) => one(tx,
      'SELECT receipt,receipt_filename FROM payment_submissions WHERE order_id=$1 AND id=$2', [order.id, id]), true);
    if (!file?.receipt) fail(404, 'Receipt not found.');
    res.set('Cache-Control', 'private, no-store').attachment(file.receipt_filename).type('application/octet-stream').send(Buffer.from(file.receipt));
  });

  router.post('/admin/orders/:id/review', owner, async (req, res) => {
    const { note } = input(z.object({ note: noteText }), req.body ?? {});
    await withLockedOrder(db, req, async (tx, order) => {
      if (!['awaiting_verification', 'expired'].includes(order.status) || order.method_id === 'paypal' ||
          !await one(tx, 'SELECT id FROM payment_submissions WHERE order_id=$1 LIMIT 1', [order.id])) {
        fail(409, 'This order has no eligible payment submission.');
      }
      await tx.query("UPDATE orders SET status='payment_under_review',updated_at=now() WHERE id=$1", [order.id]);
      await tx.query("UPDATE payments SET status='review' WHERE order_id=$1", [order.id]);
      await recordNote(tx, req, order, note);
      await audit(tx, req, 'payment.manual_review_started', order.invoice_id);
    }, true);
    res.json({ ok: true });
  });

  router.post('/admin/orders/:id/approve', owner, reauth, async (req, res) => {
    const body = input(z.object({
      reference: z.string().trim().max(160).optional(), receivedAmount: z.string().trim().min(1).max(42),
      confirmations: z.number().int().min(0).max(10_000_000).optional(), note: noteText,
      acceptOverpayment: z.boolean().optional()
    }), req.body);
    await withLockedOrder(db, req, (tx, order) => approveManual(tx, req, order, body, events), true);
    res.json({ ok: true });
  });

  router.post('/admin/orders/:id/chain-evidence', owner, async (req, res) => {
    await rate(db, 'chain_lookup', req.user.id, 25, 3600);
    const { reference } = input(z.object({ reference: z.string().trim().min(4).max(160).optional() }), req.body ?? {});
    const pair = await withLockedOrder(db, req, async (tx, order) => {
      if (!cryptoMethods[order.method_id] || !order.crypto_amount) fail(409, 'This invoice has no cryptocurrency quote.');
      if (!chainLookupReady(order.method_id, config)) fail(503, 'Chain lookup for this network needs provider configuration.');
      const submitted = await one(tx, 'SELECT reference FROM payment_submissions WHERE order_id=$1 ORDER BY created_at DESC,id LIMIT 1', [order.id]);
      const txid = paymentReference(order.method_id, reference || submitted?.reference || '');
      if (!txid) fail(400, 'Enter a valid transaction hash or signature.');
      return { order, txid };
    }, true);
    let evidence;
    try { evidence = await chainEvidence(pair.order, pair.txid, config); } catch {
      fail(502, 'The chain provider could not confirm this lookup. Verify the payment independently.');
    }
    res.json({ evidence });
  });

  router.post('/admin/orders/:id/reject', owner, reauth, async (req, res) => {
    const { note } = input(z.object({ note: z.string().trim().min(3).max(2000) }), req.body);
    await withLockedOrder(db, req, async (tx, order) => {
      if (order.method_id === 'paypal' || !manualReviewStatuses.has(order.status) ||
          !await one(tx, 'SELECT id FROM payment_submissions WHERE order_id=$1 LIMIT 1', [order.id])) {
        fail(409, 'This order cannot be rejected.');
      }
      await releaseOrder(tx, order, 'cancelled');
      await tx.query("UPDATE payment_submissions SET status='rejected',reviewed_at=now() WHERE order_id=$1 AND status='submitted'", [order.id]);
      await recordNote(tx, req, order, note);
      await audit(tx, req, 'payment.manual_rejected', order.invoice_id);
      await notify(tx, order.email, 'Payment could not be verified for ' + order.invoice_id,
        'Your submission was rejected. Contact support with your invoice ID if you need help reconciling the transfer.');
    }, true);
    res.json({ ok: true });
  });

  router.post('/admin/orders/:id/fulfill', owner, async (req, res) => {
    const { status, note } = input(z.object({ status: z.enum(['processing', 'completed']), note: noteText }), req.body);
    await withLockedOrder(db, req, async (tx, order) => {
      if (!order.paid_at || (order.status !== 'paid' && !(order.status === 'processing' && status === 'completed'))) {
        fail(409, 'This order cannot move to that fulfillment status.');
      }
      await reserveExpiredOrder(tx, order);
      await tx.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1', [order.id, status]);
      await recordNote(tx, req, order, note);
      await audit(tx, req, 'order.fulfillment_updated', order.invoice_id, { status });
      await notify(tx, order.email, 'Order ' + order.invoice_id + ' update',
        'Your order is ' + status + '. Order: ' + orderLink(config, order.id));
    }, true);
    res.json({ ok: true });
  });

  router.post('/admin/orders/:id/notes', owner, async (req, res) => {
    const { note } = input(z.object({ note: z.string().trim().min(1).max(2000) }), req.body);
    await withLockedOrder(db, req, async (tx, order) => {
      await recordNote(tx, req, order, note);
      await audit(tx, req, 'order.note_added', order.invoice_id);
    }, true);
    res.json({ ok: true });
  });

  router.post('/admin/orders/:id/reconcile-paypal', owner, reauth, async (req, res) => {
    await withLockedOrder(db, req, async (tx, order) => {
      const payment = await one(tx, 'SELECT * FROM payments WHERE order_id=$1', [order.id]);
      if (order.method_id !== 'paypal' || !payment?.provider_order_id) fail(409, 'This order has no PayPal transaction.');
      let provider;
      try { provider = await client.getOrder(payment.provider_order_id); } catch (error) { paymentFailure(error); }
      await syncPayPalOrder(tx, req, order, payment, provider, client, events);
      await audit(tx, req, 'payment.paypal_reconciled', order.invoice_id, { providerStatus: provider.status });
    }, true);
    res.json({ ok: true });
  });

  router.post('/admin/orders/:id/refund', owner, reauth, async (req, res) => {
    const body = input(z.object({ amount: z.number().int().min(1).max(2147483647), idempotencyKey: uuid }), req.body);
    if (!paypalConfigured(config)) fail(503, 'PayPal refunds are unavailable.');
    const record = await withLockedOrder(db, req, (tx, order) => refundRequest(tx, order, body), true);
    await withLockedOrder(db, req, async (tx, order) => {
      const refund = await one(tx, 'SELECT * FROM refunds WHERE id=$1', [record.id]);
      if (refund.status !== 'requested') return;
      const payment = await one(tx, 'SELECT transaction_id FROM payments WHERE order_id=$1', [order.id]);
      if (!payment?.transaction_id) fail(409, 'This order has no verified capture.');
      let provider;
      try { provider = await client.refund(payment.transaction_id, {
        id: refund.id, idempotencyKey: refund.idempotency_key, amount: refund.amount, currency: order.currency
      }); } catch (error) { paymentFailure(error); }
      await syncRefund(tx, req, order, provider, events, refund.id);
    }, true);
    const current = await one(db, 'SELECT id,status,amount FROM refunds WHERE id=$1', [record.id]);
    res.json({ refund: current });
  });

  return router;
}
