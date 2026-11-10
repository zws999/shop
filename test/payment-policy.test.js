import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { connect, migrate } from '../src/db.js';
import { createOrder, getCart, releaseOrder } from '../src/checkout-store.js';
import { approveManual, refundRequest, syncPayPalOrder, syncRefund, verifiedCapture } from '../src/order-payments.js';
import { chainEvidence, chainLookupReady } from '../src/chain-evidence.js';
import {
  cryptoPaymentUri, marketPrice, paymentReference, quoteCryptoUnits, validatePaymentDestination
} from '../src/payment-policy.js';
import { paypalClient, paypalConfigured } from '../src/paypal.js';

const addresses = {
  btc: 'bc1qp3d9ay0vcl30ketz3amacxvvj3es5ms5lgzdpq',
  eth: '0x3Fb5eC76dCa4DEc5b9b0a378D2c7F65350a360C7',
  ltc: 'LQaaeXAK27XFHab9JAXkFxGVpjNtzTG7au',
  sol: 'GV2292A261gAfmKeEmDBEZeQppsQBZ2f5DzTvpKPb6ms'
};
const paypalConfig = {
  APP_URL: 'http://127.0.0.1:3030', NODE_ENV: 'development', PAYPAL_MODE: 'sandbox',
  PAYPAL_CLIENT_ID: 'offline-test-id', PAYPAL_CLIENT_SECRET: 'offline-test-secret',
  PAYPAL_WEBHOOK_ID: 'offline-test-webhook', PAYPAL_MERCHANT_ID: 'offline-test-merchant'
};
const noop = async () => {};

test('crypto checkout checks destinations, quotes atomically and constructs network-specific payment URIs', () => {
  for (const [id, value] of Object.entries(addresses)) assert.equal(validatePaymentDestination(id, value), true, id);
  assert.equal(validatePaymentDestination('btc', addresses.btc.slice(0, -1) + 'z'), false);
  assert.equal(validatePaymentDestination('btc', addresses.ltc), false);
  assert.equal(validatePaymentDestination('eth', addresses.eth.replace('Fb5', 'fb5')), false);
  assert.equal(validatePaymentDestination('ltc', addresses.ltc.slice(0, -1) + 'b'), false);
  assert.equal(validatePaymentDestination('sol', '11111111111111111111111111111111'), false);
  assert.equal(quoteCryptoUnits(2500, '99999.99', 8), '0.00025001');
  assert.equal(quoteCryptoUnits(10, '1', 18), '0.1');
  assert.equal(quoteCryptoUnits(2500, '0', 8), null);
  assert.equal(cryptoPaymentUri('eth', addresses.eth, '0.25'), 'ethereum:' + addresses.eth + '@1?value=250000000000000000');
  assert.equal(paymentReference('btc', 'A'.repeat(64)), 'a'.repeat(64));
  assert.equal(paymentReference('revolut', ' REF-001 '), 'ref-001');
});

test('market pricing uses provider timestamps and rejects stale, missing or malformed quotes', async t => {
  let timestamp = Math.floor(Date.now() / 1000);
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.hostname, 'api.coingecko.com');
    assert.equal(url.searchParams.get('include_last_updated_at'), 'true');
    assert.equal(options.headers['x-cg-demo-api-key'], 'test-key');
    return Response.json({ bitcoin: { usd: 110000.1, last_updated_at: timestamp } });
  });
  const config = { COINGECKO_API_KEY: 'test-key' };
  assert.equal(Number((await marketPrice(config, 'btc', 'USD')).price), 110000.1);
  timestamp -= 360;
  await assert.rejects(marketPrice(config, 'btc', 'USD'), /unavailable/);
  await assert.rejects(marketPrice({}, 'btc', 'USD'), /unavailable/);
  assert.equal(request.mock.callCount(), 2);
});

test('crypto evidence requires manual verification, sufficient confirmations and a unique reference', async t => {
  const db = await connect({ PGLITE_MEMORY: 'true' });
  t.after(() => db.close());
  await migrate(db);
  const config = { APP_URL: 'http://127.0.0.1:3030', COINGECKO_API_KEY: 'offline-test' };
  await db.query("UPDATE payment_methods SET enabled=true WHERE id='btc'");
  const productId = (await db.query(`INSERT INTO products(slug,name,kind,currency,price,stock,active)
    VALUES('test-service','Test service','service','USD',2500,3,true) RETURNING id`)).rows[0].id;
  const price = { price: '100000', currency: 'USD', quotedAt: new Date() };
  const proof = 'a'.repeat(64);
  const first = { cartId: randomUUID() };
  const second = { cartId: randomUUID() };
  const base = { customerName: 'Test Buyer', methodId: 'btc' };

  async function reserve(req, email) {
    const order = await db.tx(async tx => {
      const cart = await getCart(tx, req);
      await tx.query('INSERT INTO cart_items(cart_id,product_id,quantity) VALUES($1,$2,1)', [cart.id, productId]);
      return createOrder(tx, req, { ...base, email, idempotencyKey: randomUUID() }, config, price, noop);
    });
    assert.equal(order.crypto_amount, '0.00025');
    assert.equal(order.status, 'pending_payment');
    return order;
  }

  const firstOrder = await reserve(first, 'first@example.test');
  await assert.rejects(db.tx(tx => approveManual(tx, {}, firstOrder, { receivedAmount: '0.00025', confirmations: 3 },
    { audit: noop, notify: noop, config })), /manual verification/);
  const secondOrder = await reserve(second, 'second@example.test');
  for (const order of [firstOrder, secondOrder]) {
    await db.query('INSERT INTO payment_submissions(order_id,reference) VALUES($1,$2)', [order.id, proof]);
    await db.query("UPDATE orders SET status='awaiting_verification' WHERE id=$1", [order.id]);
    order.status = 'awaiting_verification';
  }
  const services = { audit: noop, notify: noop, config };
  await assert.rejects(db.tx(tx => approveManual(tx, {}, firstOrder, { receivedAmount: '0.00025', confirmations: 2 }, services)), /insufficient/);
  await assert.rejects(db.tx(tx => approveManual(tx, {}, firstOrder, { receivedAmount: '0.00024', confirmations: 3 }, services)), /below/);
  await db.tx(tx => approveManual(tx, {}, firstOrder, { receivedAmount: '0.00025', confirmations: 3 }, services));
  await assert.rejects(db.tx(tx => approveManual(tx, {}, secondOrder, { receivedAmount: '0.00025', confirmations: 3 }, services)), /already been credited/);
  const state = (await db.query('SELECT status,paid_at FROM orders WHERE id=$1', [firstOrder.id])).rows[0];
  assert.equal(state.status, 'paid');
  assert.ok(state.paid_at);
  await db.tx(tx => releaseOrder(tx, secondOrder, 'cancelled'));
  assert.equal((await db.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock, 2);
});

test('PayPal client creates a commercial order and verifies the signed-event envelope server-side', async () => {
  assert.equal(paypalConfigured(paypalConfig), true);
  assert.equal(paypalConfigured({ ...paypalConfig, APP_URL: 'https://example.test', production: true }), false);
  assert.equal(paypalConfigured({ ...paypalConfig, PAYPAL_WEBHOOK_ID: '' }), false);
  const id = randomUUID();
  const captured = [];
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    captured.push({ path, body: options.body, headers: options.headers });
    if (path.endsWith('/token')) return Response.json({ access_token: 'access', expires_in: 3600 });
    if (path.endsWith('/orders')) return Response.json({
      id: 'ORDERID', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDERID' }]
    });
    return Response.json({ verification_status: 'SUCCESS' });
  };
  const client = paypalClient(paypalConfig, request);
  const order = { id, invoice_id: '303-2026-000001', total: 3333, currency: 'USD' };
  const provider = await client.create(order);
  assert.match(provider.approvalUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
  const body = JSON.parse(captured[1].body);
  assert.equal(body.purchase_units[0].amount.value, '33.33');
  assert.equal(body.purchase_units[0].payee.merchant_id, paypalConfig.PAYPAL_MERCHANT_ID);
  assert.equal(body.purchase_units[0].invoice_id, order.invoice_id);
  assert.equal(body.intent, 'CAPTURE');
  assert.equal(body.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
  assert.equal(await client.verifyWebhook({}, { id: 'WH-1' }), false);
  const event = '{ "id": "WH-1", "event_type": "PAYMENT.CAPTURE.COMPLETED" }';
  const headers = Object.fromEntries(['auth-algo', 'cert-url', 'transmission-id', 'transmission-sig', 'transmission-time']
    .map(key => ['paypal-' + key, 'offline-test-value']));
  assert.equal(await client.verifyWebhook(headers, JSON.parse(event), event), true);
  assert.ok(captured[2].body.includes(event));
  assert.equal(JSON.parse(captured[2].body).webhook_id, paypalConfig.PAYPAL_WEBHOOK_ID);
});

test('PayPal capture matching rejects cross-invoice, tampered total and wrong-merchant captures', () => {
  const order = { id: randomUUID(), invoice_id: '303-2026-000001', currency: 'USD', total: 1234 };
  const amount = { value: '12.34', currency_code: 'USD' };
  const capture = { id: 'CAPTUREID', amount: { ...amount }, final_capture: true, status: 'COMPLETED' };
  const unit = {
    reference_id: order.id, custom_id: order.id, invoice_id: order.invoice_id,
    payee: { merchant_id: 'merchant-1' }, amount, payments: { captures: [capture] }
  };
  const provider = { id: 'ORDERID', status: 'COMPLETED', purchase_units: [unit] };
  assert.equal(verifiedCapture(order, provider, 'merchant-1'), capture);
  assert.equal(verifiedCapture(order, provider, 'merchant-2'), null);
  assert.equal(verifiedCapture({ ...order, total: 1235 }, provider, 'merchant-1'), null);
  assert.equal(verifiedCapture({ ...order, id: randomUUID() }, provider, 'merchant-1'), null);
  capture.amount.value = '12.33';
  assert.equal(verifiedCapture(order, provider, 'merchant-1'), null);
});

test('trusted chain evidence reports the actual native transfer, destination and confirmation count', async t => {
  const reference = '0x' + 'a'.repeat(64);
  const block = '0x' + 'b'.repeat(64);
  const current = Math.floor(Date.now() / 1000);
  const response = {
    eth_chainId: '0x1',
    eth_getTransactionByHash: { hash: reference, blockHash: block, to: addresses.eth, value: '0x3782dace9d90000' },
    eth_getTransactionReceipt: { transactionHash: reference, blockHash: block, blockNumber: '0x100', status: '0x1' },
    eth_blockNumber: '0x10b',
    eth_getBlockByNumber: { hash: block, timestamp: '0x' + current.toString(16) }
  };
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { method } = JSON.parse(options.body);
    return Response.json({ jsonrpc: '2.0', id: 1, result: response[method] });
  });
  const config = { ETHEREUM_RPC_URL: 'https://rpc.example.test' };
  const order = {
    method_id: 'eth', destination: addresses.eth, network: 'Ethereum Mainnet', crypto_amount: '0.25',
    created_at: new Date(current * 1000 - 60_000), expires_at: new Date(current * 1000 + 60_000),
    confirmation_threshold: 12
  };
  assert.equal(chainLookupReady('eth', config), true);
  const evidence = await chainEvidence(order, reference, config);
  assert.equal(evidence.amountCheck, 'exact');
  assert.equal(evidence.confirmations, 12);
  assert.equal(evidence.meetsThreshold, true);
  response.eth_getTransactionByHash.to = '0x' + '1'.repeat(40);
  assert.equal((await chainEvidence(order, reference, config)).amountCheck, 'destination_mismatch');
  response.eth_chainId = '0x5';
  await assert.rejects(chainEvidence(order, reference, config), /Mainnet/);
});

test('PayPal reconciliation verifies a capture once and applies partial and full provider refunds', async t => {
  const db = await connect({ PGLITE_MEMORY: 'true' });
  t.after(() => db.close());
  await migrate(db);
  const req = { cartId: randomUUID() };
  const services = { config: paypalConfig, notify: noop, audit: noop };
  const order = await db.tx(async tx => {
    await tx.query("UPDATE payment_methods SET enabled=true WHERE id='paypal'");
    const cart = await getCart(tx, req);
    const product = (await tx.query(`INSERT INTO products(slug,name,kind,currency,price,active)
      VALUES('test-service','Test service','service','USD',1234,true) RETURNING id`)).rows[0];
    await tx.query('INSERT INTO cart_items(cart_id,product_id,quantity) VALUES($1,$2,1)', [cart.id, product.id]);
    return createOrder(tx, req, {
      customerName: 'Test Buyer', email: 'buyer@example.test', methodId: 'paypal', idempotencyKey: randomUUID()
    }, paypalConfig, null, noop);
  });
  const client = { merchantId: paypalConfig.PAYPAL_MERCHANT_ID };
  const payment = (await db.query("UPDATE payments SET provider_order_id='PORDERID' WHERE order_id=$1 RETURNING *", [order.id])).rows[0];
  const amount = { currency_code: 'USD', value: '12.34' };
  const capture = {
    id: 'CAPTUREID', status: 'PENDING', amount, final_capture: true,
    seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: '0.50' } }
  };
  const provider = {
    id: payment.provider_order_id, status: 'COMPLETED', purchase_units: [{
      reference_id: order.id, custom_id: order.id, invoice_id: order.invoice_id, amount,
      payee: { merchant_id: client.merchantId }, payments: { captures: [capture] }
    }]
  };
  async function getOrder(tx = db) {
    return (await tx.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0];
  }
  async function sync() {
    await db.tx(async tx => syncPayPalOrder(tx, req, await getOrder(tx),
      (await tx.query('SELECT * FROM payments WHERE order_id=$1', [order.id])).rows[0], provider, client, services));
  }
  await sync();
  assert.equal((await getOrder()).status, 'payment_under_review');
  assert.equal((await getOrder()).paid_at, null);
  capture.status = 'COMPLETED';
  await sync();
  await sync();
  assert.equal((await getOrder()).status, 'paid');
  assert.equal((await getOrder()).fee, 50);
  const refund = { idempotencyKey: randomUUID(), amount: 400 };
  const first = await db.tx(async tx => refundRequest(tx, await getOrder(tx), refund));
  const providerRefund = { id: 'REFUNDID1', amount: { currency_code: 'USD', value: '4.00' }, status: 'COMPLETED', custom_id: first.id };
  await db.tx(async tx => syncRefund(tx, req, await getOrder(tx), providerRefund, services));
  await db.tx(async tx => syncRefund(tx, req, await getOrder(tx), providerRefund, services));
  assert.equal((await getOrder()).status, 'partially_refunded');
  assert.equal((await getOrder()).refund_total, 400);
  const remainder = { id: 'REFUNDID2', amount: { currency_code: 'USD', value: '8.34' }, status: 'COMPLETED' };
  await db.tx(async tx => syncRefund(tx, req, await getOrder(tx), remainder, services));
  assert.equal((await getOrder()).status, 'refunded');
  assert.equal((await getOrder()).refund_total, 1234);
});
