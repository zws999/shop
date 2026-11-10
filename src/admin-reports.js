import { z } from 'zod';
import { currency, day, fail, id, input, one, sendCsv, text } from './admin-validation.js';

const paymentMethod = z.enum(['btc', 'eth', 'ltc', 'sol', 'revolut', 'paypal']);
const orderStatus = z.enum([
  'pending_payment', 'awaiting_verification', 'payment_under_review', 'paid', 'processing',
  'completed', 'cancelled', 'expired', 'refunded', 'partially_refunded', 'disputed'
]);
const periodSchema = z.object({
  range: z.enum(['today','7d','30d','3m','6m','1y','all','custom']).default('30d'),
  currency: currency.default('USD'),
  from: day.optional(),
  to: day.optional()
});
const filterSchema = z.object({
  q: text(160, false).default(''),
  status: orderStatus.optional(),
  method: paymentMethod.optional(),
  from: day.optional(),
  to: day.optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});
const DAY = 86400000;

function endOf(dayValue) {
  return dayValue ? new Date(Date.parse(dayValue) + DAY).toISOString() : null;
}

function period(query) {
  const { range, currency, from, to } = input(periodSchema, query);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const end = endOf(range === 'custom' ? to : today.toISOString().slice(0, 10));
  const start = new Date(today);
  if (range === 'all') return { range, currency, start: null, end, priorStart: null, bucket: 'month' };
  if (range === 'custom') {
    if (!from || !to || from > to) fail(400, 'Select a valid start and end date.');
    start.setTime(Date.parse(from));
  } else {
    const days = { today: 1, '7d': 7, '30d': 30, '3m': 90, '6m': 180, '1y': 365 }[range];
    start.setUTCDate(start.getUTCDate() - days + 1);
  }
  const length = Date.parse(end) - start.getTime();
  if (length > 3660 * DAY) fail(400, 'Choose a custom range of ten years or less.');
  const priorStart = new Date(start.getTime() - length).toISOString();
  return { range, currency, start: start.toISOString(), end, priorStart, bucket: length > 90 * DAY ? 'month' : 'day' };
}

async function orderRows(db, query, limit, queue = false) {
  const filter = input(filterSchema, query);
  if (filter.from && filter.to && filter.from > filter.to) fail(400, 'Choose an end date on or after the start date.');
  return (await db.query(
    'SELECT o.id,o.invoice_id,o.email,o.customer_name,o.status,o.currency,o.total,o.method_id,o.payment_name,o.created_at,o.paid_at,o.refund_total,' +
    ' (SELECT string_agg(name, \', \' ORDER BY name) FROM order_items WHERE order_id=o.id) AS products' +
    ' FROM orders o WHERE ($1=\'\' OR o.email ILIKE \'%\'||$1||\'%\' OR o.customer_name ILIKE \'%\'||$1||\'%\' OR o.invoice_id ILIKE \'%\'||$1||\'%\')' +
    ' AND ($2::text IS NULL OR o.status=$2) AND ($3::text IS NULL OR o.method_id=$3)' +
    ' AND ($4::timestamptz IS NULL OR o.created_at >= $4) AND ($5::timestamptz IS NULL OR o.created_at < $5)' +
    " AND (NOT $8::boolean OR o.status IN ('awaiting_verification','payment_under_review'))" +
    ' ORDER BY o.created_at DESC,o.id LIMIT $6 OFFSET $7',
    [filter.q, filter.status ?? null, filter.method ?? null, filter.from ?? null, endOf(filter.to), limit, filter.offset, queue]
  )).rows;
}

async function totals(db, currencyCode, start, end) {
  const [orderResult, financeResult, customerResult] = await Promise.all([
    db.query('SELECT count(*)::int AS orders,' +
      " count(*) FILTER(WHERE status IN ('pending_payment','awaiting_verification','payment_under_review'))::int AS pending" +
      ' FROM orders WHERE currency=$1 AND ($2::timestamptz IS NULL OR created_at >= $2) AND created_at<$3',
    [currencyCode, start, end]),
    db.query(
      'WITH matched AS (SELECT * FROM orders WHERE currency=$1 AND paid_at IS NOT NULL AND' +
      ' ($2::timestamptz IS NULL OR paid_at >= $2) AND paid_at<$3), ' +
      ' amounts AS (SELECT count(*)::int AS paid,count(*) FILTER(WHERE refund_total>0)::int AS refunded,' +
      ' coalesce(sum(total),0)::float8 AS gross,coalesce(sum(fee),0)::float8 AS fees,coalesce(sum(tax),0)::float8 AS tax,' +
      ' coalesce(sum(refund_total),0)::float8 AS refunds,coalesce(sum(total-fee-tax-refund_total),0)::float8 AS net FROM matched),' +
      ' costs AS (SELECT CASE WHEN count(*)>0 AND count(cost)=count(*) THEN sum(cost::bigint*quantity)::float8 END AS costs' +
      ' FROM order_items i JOIN matched m ON m.id=i.order_id),' +
      ' repeat AS (SELECT count(*)::int AS buyers,count(*) FILTER(WHERE previous)::int AS returning FROM (' +
      ' SELECT m.email, bool_or(EXISTS (SELECT 1 FROM orders earlier WHERE earlier.email=m.email AND earlier.paid_at<m.paid_at)) AS previous' +
      ' FROM matched m GROUP BY m.email) k)' +
      ' SELECT * FROM amounts CROSS JOIN costs CROSS JOIN repeat',
      [currencyCode, start, end]
    ),
    db.query("SELECT count(*)::int AS customers FROM users WHERE role='customer' AND ($1::timestamptz IS NULL OR created_at >= $1) AND created_at<$2", [start, end])
  ]);
  return { ...orderResult.rows[0], ...financeResult.rows[0], ...customerResult.rows[0] };
}

function fillSeries(rows, window) {
  if (!rows.length) return [];
  const chart = new Map(rows.map(row => [new Date(row.bucket).toISOString().slice(0, 10), row]));
  const cursor = new Date(window.start || rows[0].bucket);
  if (window.bucket === 'month') cursor.setUTCDate(1);
  const end = new Date(window.end);
  const series = [];
  while (cursor < end) {
    const bucket = cursor.toISOString().slice(0, 10);
    series.push(chart.get(bucket) ?? { bucket, gross: 0, net: 0, orders: 0, refunds: 0, customers: 0, costs: null });
    if (window.bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

async function financials(db, query) {
  const window = period(query);
  const { currency, start, end, priorStart, bucket } = window;
  const [current, previous, series, top, methods] = await Promise.all([
    totals(db, currency, start, end),
    priorStart ? totals(db, currency, priorStart, start) : null,
    db.query(
      'WITH received AS (SELECT id, paid_at,total,fee,tax,refund_total FROM orders WHERE currency=$1 AND paid_at IS NOT NULL' +
      ' AND ($2::timestamptz IS NULL OR paid_at >= $2) AND paid_at<$3),' +
      " receipts AS (SELECT date_trunc($4,paid_at,'UTC') AS bucket,count(*)::int AS orders,sum(total)::float8 AS gross," +
      ' sum(total-fee-tax-refund_total)::float8 AS net,sum(refund_total)::float8 AS refunds FROM received GROUP BY 1),' +
      " costs AS (SELECT date_trunc($4,r.paid_at,'UTC') AS bucket," +
      ' CASE WHEN count(i.cost)=count(*) THEN sum(i.cost::bigint*i.quantity)::float8 END AS costs' +
      ' FROM received r JOIN order_items i ON i.order_id=r.id GROUP BY 1),' +
      " customers AS (SELECT date_trunc($4,created_at,'UTC') AS bucket,count(*)::int AS customers FROM users WHERE role='customer'" +
      ' AND ($2::timestamptz IS NULL OR created_at >= $2) AND created_at<$3 GROUP BY 1)' +
      ' SELECT coalesce(r.bucket,c.bucket) AS bucket,coalesce(r.orders,0) AS orders,coalesce(r.gross,0) AS gross,coalesce(r.net,0) AS net,' +
      ' coalesce(r.refunds,0) AS refunds,coalesce(c.customers,0) AS customers,k.costs' +
      ' FROM receipts r FULL OUTER JOIN customers c USING(bucket) LEFT JOIN costs k ON k.bucket=r.bucket ORDER BY 1',
      [currency, start, end, bucket]
    ),
    db.query(
      'SELECT i.product_id,i.name,sum(i.quantity)::int AS units,sum(i.unit_price::bigint*i.quantity)::float8 AS line_value' +
      ' FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.currency=$1 AND o.paid_at IS NOT NULL' +
      ' AND ($2::timestamptz IS NULL OR o.paid_at >= $2) AND o.paid_at<$3 AND o.refund_total<o.total' +
      ' GROUP BY i.product_id,i.name ORDER BY units DESC,i.name LIMIT 8', [currency, start, end]
    ),
    db.query(
      'SELECT method_id,payment_name,count(*)::int AS orders,sum(total)::float8 AS gross' +
      ' FROM orders WHERE currency=$1 AND paid_at IS NOT NULL AND ($2::timestamptz IS NULL OR paid_at >= $2) AND paid_at<$3' +
      ' GROUP BY method_id,payment_name ORDER BY gross DESC', [currency, start, end]
    )
  ]);
  return { window, current, previous, series: fillSeries(series.rows, window), top: top.rows, methods: methods.rows };
}

export function registerReports(router, db) {
  router.get('/overview', async (req, res) => {
    const [financial, recent, queue, stock, activity, published] = await Promise.all([
      financials(db, req.query),
      orderRows(db, {}, 6),
      orderRows(db, {}, 6, true),
      db.query('SELECT id,name,stock FROM products WHERE active AND stock<=5 ORDER BY stock,name LIMIT 8'),
      db.query('SELECT action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 7'),
      db.query('SELECT id,name,coalesce(publish_at,created_at) AS published FROM products WHERE active' +
        ' AND (publish_at IS NULL OR publish_at<=now()) ORDER BY published DESC LIMIT 5')
    ]);
    res.json({ ...financial, recent, queue, stock: stock.rows, activity: activity.rows, published: published.rows });
  });

  router.get('/analytics', async (req, res) => {
    res.json(await financials(db, req.query));
  });

  router.get('/analytics.csv', async (req, res) => {
    const { series, window } = await financials(db, req.query);
    sendCsv(res, '303-revenue-' + window.currency,
      ['Date (UTC)', 'Currency', 'Verified receipts (minor units)', 'Net receipts (minor units)', 'Paid orders', 'Refunds (minor units)', 'New accounts', 'Known item costs (minor units)'],
      series.map(row => [new Date(row.bucket).toISOString().slice(0, 10), window.currency, row.gross, row.net, row.orders, row.refunds, row.customers, row.costs]));
  });

  router.get('/orders', async (req, res) => res.json(await orderRows(db, req.query, 100)));
  router.get('/payments', async (req, res) => res.json(await orderRows(db, req.query, 100, true)));
  router.get('/orders.csv', async (req, res) => {
    const rows = await orderRows(db, req.query, 10000);
    if (rows.length >= 10000) fail(409, 'Narrow your filters to export fewer than 10,000 orders.');
    sendCsv(res, '303-orders', ['Invoice', 'Customer', 'Email', 'Products', 'Status', 'Currency', 'Total (minor units)', 'Refunded (minor units)', 'Method', 'Created (UTC)', 'Verified (UTC)'],
      rows.map(row => [row.invoice_id, row.customer_name, row.email, row.products, row.status, row.currency, row.total, row.refund_total, row.payment_name, row.created_at, row.paid_at]));
  });

  router.get('/orders/:id', async (req, res) => {
    const orderId = id(req.params.id);
    const order = one(await db.query(
      'SELECT id,invoice_id,email,customer_name,status,currency,subtotal,discount,tax,shipping,total,fee,refund_total,method_id,payment_name,' +
      ' destination,recipient_name,network,crypto_amount,expires_at,paid_at,created_at,shipping_address,coupon_code,confirmation_threshold' +
      ' FROM orders WHERE id=$1', [orderId]
    ), 'Order');
    const [items, submissions, payment, notes, refunds] = await Promise.all([
      db.query('SELECT id,product_id,name,variant_name,quantity,unit_price,kind FROM order_items WHERE order_id=$1 ORDER BY name,id', [orderId]),
      db.query('SELECT id,reference,note,receipt_filename,status,created_at,reviewed_at FROM payment_submissions WHERE order_id=$1 ORDER BY created_at DESC', [orderId]),
      db.query('SELECT provider_order_id,transaction_id,status,verified_at FROM payments WHERE order_id=$1', [orderId]),
      db.query('SELECT n.id,n.note,n.created_at,u.username FROM order_notes n LEFT JOIN users u ON u.id=n.actor_id WHERE n.order_id=$1 ORDER BY n.created_at DESC', [orderId]),
      db.query('SELECT provider_id,amount,status,created_at FROM refunds WHERE order_id=$1 ORDER BY created_at DESC', [orderId])
    ]);
    res.json({ order, items: items.rows, submissions: submissions.rows, payment: payment.rows[0], notes: notes.rows, refunds: refunds.rows });
  });

  router.get('/transactions', async (req, res) => {
    const q = input(text(160, false), req.query.q ?? '');
    const result = await db.query(
      'SELECT o.id,o.invoice_id,o.method_id,o.payment_name,o.currency,o.total,o.fee,o.refund_total,o.paid_at,' +
      ' p.transaction_id,p.provider_order_id,p.status,t.received_amount,t.confirmations' +
      ' FROM payments p JOIN orders o ON o.id=p.order_id LEFT JOIN transaction_references t ON t.order_id=o.id' +
      ' WHERE (p.transaction_id IS NOT NULL OR p.provider_order_id IS NOT NULL)' +
      " AND ($1='' OR o.invoice_id ILIKE '%'||$1||'%' OR p.transaction_id ILIKE '%'||$1||'%')" +
      ' ORDER BY o.created_at DESC LIMIT 100', [q]
    );
    res.json(result.rows);
  });
}
