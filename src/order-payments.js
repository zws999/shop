import { randomUUID } from 'node:crypto';
import { cryptoMethods, decimalUnits, paymentReference } from './payment-policy.js';
import { fail, one, orderLink, paidStatuses, releaseOrder, reserveExpiredOrder } from './checkout-store.js';

export const manualReviewStatuses = new Set(['awaiting_verification', 'payment_under_review', 'expired']);
const captureFailureStatuses = new Set(['DENIED', 'DECLINED', 'FAILED']);

export async function recordNote(tx, req, order, note) {
  if (!note) return;
  await tx.query('INSERT INTO order_notes(order_id,actor_id,note) VALUES($1,$2,$3)', [order.id, req.user?.id ?? null, note]);
}

async function claimReference(tx, order, reference, amount, confirmations) {
  const result = await tx.query(`INSERT INTO transaction_references(method_id,reference,order_id,received_amount,confirmations)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING order_id`,
  [order.method_id, reference, order.id, amount, confirmations ?? null]);
  if (!result.rowCount) fail(409, 'This transaction reference has already been credited.');
}

async function setPaid(tx, order, reference, fee, { notify, config }, inventoryHold = false) {
  const manual = await one(tx, "SELECT id FROM order_items WHERE order_id=$1 AND kind IN ('physical','service') LIMIT 1", [order.id]);
  const status = manual || inventoryHold ? 'paid' : 'completed';
  await tx.query('UPDATE orders SET status=$2,paid_at=now(),updated_at=now(),fee=$3 WHERE id=$1', [order.id, status, fee]);
  await tx.query("UPDATE payments SET transaction_id=$2,status='verified',verified_at=now() WHERE order_id=$1", [order.id, reference]);
  const message = manual || inventoryHold
    ? 'Your payment has been verified. We will update your order as it moves through fulfillment.'
    : 'Your payment has been verified. Open your order to access your purchase.';
  await notify(tx, order.email, 'Payment verified for ' + order.invoice_id, message + ' Order: ' + orderLink(config, order.id));
}

export async function approveManual(tx, req, order, input, services) {
  const { audit } = services;
  if (order.method_id === 'paypal' || !manualReviewStatuses.has(order.status)) fail(409, 'This order is unavailable for manual verification.');
  const proof = await one(tx, 'SELECT id,reference FROM payment_submissions WHERE order_id=$1 ORDER BY created_at DESC,id LIMIT 1', [order.id]);
  if (!proof) fail(409, 'A payment submission is required.');
  const reference = paymentReference(order.method_id, input.reference || proof.reference);
  const crypto = cryptoMethods[order.method_id];
  const precision = crypto?.precision ?? 2;
  const received = decimalUnits(input.receivedAmount, precision);
  const expected = crypto ? decimalUnits(order.crypto_amount, precision) : BigInt(order.total);
  if (!reference) fail(400, 'Enter a valid transaction reference.');
  if (received === null || expected === null) fail(400, 'Enter the verified transfer amount in the quoted currency.');
  if (received < expected) fail(409, 'The transfer is below the invoiced amount. Reconcile the balance before approval.');
  if (received > expected && (!input.acceptOverpayment || !input.note)) {
    fail(409, 'Record how the overpayment was reconciled and confirm acceptance before approval.');
  }
  if (crypto && (input.confirmations ?? 0) < order.confirmation_threshold) {
    fail(409, 'The transfer has insufficient independently verified network confirmations.');
  }
  await claimReference(tx, order, reference, input.receivedAmount, input.confirmations);
  await reserveExpiredOrder(tx, order);
  await setPaid(tx, order, reference, 0, services);
  await tx.query("UPDATE payment_submissions SET status='verified',reviewed_at=now() WHERE id=$1", [proof.id]);
  await recordNote(tx, req, order, input.note);
  await audit(tx, req, 'payment.manual_approved', order.invoice_id, {
    method: order.method_id, submissionId: proof.id, overpayment: received > expected, confirmations: input.confirmations ?? null
  });
}

function providerMinor(amount, currency) {
  if (amount?.currency_code !== currency) return null;
  const value = decimalUnits(amount.value, 2);
  return value !== null && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function verifiedCapture(order, provider, merchantId) {
  if (provider.purchase_units?.length !== 1) return null;
  const unit = provider.purchase_units[0];
  if (unit.reference_id !== order.id || unit.custom_id !== order.id || unit.invoice_id !== order.invoice_id ||
      unit.payee?.merchant_id !== merchantId || providerMinor(unit.amount, order.currency) !== order.total) return null;
  const captures = unit.payments?.captures;
  if (captures?.length !== 1) return null;
  const capture = captures[0];
  if (!capture.id || providerMinor(capture.amount, order.currency) !== order.total || capture.final_capture !== true) return null;
  return capture;
}

export async function syncPayPalOrder(tx, req, order, payment, provider, client, services) {
  const { audit, notify } = services;
  if (payment.provider_order_id !== provider.id) fail(409, 'PayPal order reconciliation failed.');
  if (!provider.purchase_units?.[0]?.payments?.captures?.length) return;
  const capture = verifiedCapture(order, provider, client.merchantId);
  if (!capture) fail(409, 'PayPal payment details do not match the invoice.');
  if (order.paid_at) {
    if (payment.transaction_id !== capture.id) fail(409, 'PayPal capture conflicts with the verified transaction.');
    return;
  }
  if (captureFailureStatuses.has(capture.status)) {
    await releaseOrder(tx, order, 'cancelled');
    await notify(tx, order.email, 'Payment declined for ' + order.invoice_id, 'PayPal declined the payment. Contact support for assistance.');
    await audit(tx, req, 'payment.paypal_declined', order.invoice_id);
    return;
  }
  if (capture.status === 'PENDING') {
    await tx.query("UPDATE orders SET status='payment_under_review',updated_at=now() WHERE id=$1", [order.id]);
    await tx.query("UPDATE payments SET status='pending_capture',transaction_id=$2 WHERE order_id=$1", [order.id, capture.id]);
    return;
  }
  if (capture.status !== 'COMPLETED' || provider.status !== 'COMPLETED') return;
  const fee = providerMinor(capture.seller_receivable_breakdown?.paypal_fee, order.currency) ?? 0;
  await claimReference(tx, order, capture.id, capture.amount.value, null);
  let inventoryHold = false;
  if (order.reservation_released) {
    await tx.query('SAVEPOINT late_paypal_inventory');
    try {
      await reserveExpiredOrder(tx, order);
    } catch (error) {
      if (error.status !== 409) throw error;
      await tx.query('ROLLBACK TO SAVEPOINT late_paypal_inventory');
      inventoryHold = true;
    }
    await tx.query('RELEASE SAVEPOINT late_paypal_inventory');
  }
  await setPaid(tx, order, capture.id, fee, services, inventoryHold);
  await audit(tx, req, 'payment.paypal_verified', order.invoice_id, { providerOrderId: provider.id, inventoryHold });
  if (inventoryHold) {
    await recordNote(tx, req, order, 'PayPal captured payment after the reservation expired. Restock and fulfill, or reconcile a refund.');
    const ownerEmail = services.config.OWNER_EMAIL || (await one(tx, "SELECT email FROM users WHERE role='owner'"))?.email;
    if (ownerEmail) await notify(tx, ownerEmail, 'Inventory hold for ' + order.invoice_id, 'PayPal captured payment after the reservation expired. Open the Control Center to resolve the order.');
  }
}

export async function refundRequest(tx, order, input) {
  const prior = await one(tx, 'SELECT * FROM refunds WHERE order_id=$1 AND idempotency_key=$2', [order.id, input.idempotencyKey]);
  if (prior) {
    if (prior.amount !== input.amount) fail(409, 'This refund request already used a different amount.');
    return prior;
  }
  if (order.method_id !== 'paypal' || !paidStatuses.has(order.status)) fail(409, 'This order is unavailable for a PayPal refund.');
  const pending = await one(tx, "SELECT COALESCE(SUM(amount),0) AS amount FROM refunds WHERE order_id=$1 AND status IN ('requested','pending')", [order.id]);
  if (input.amount > order.total - order.refund_total - Number(pending.amount)) {
    fail(409, 'The refund exceeds the remaining captured amount.');
  }
  return one(tx, `INSERT INTO refunds(order_id,amount,status,idempotency_key) VALUES($1,$2,'requested',$3) RETURNING *`,
    [order.id, input.amount, input.idempotencyKey]);
}

export async function syncRefund(tx, req, order, data, { audit, notify }, expectedId) {
  if (!data?.id) fail(409, 'PayPal refund details are unavailable.');
  const amount = providerMinor(data.amount, order.currency);
  if (!amount || amount > order.total) fail(409, 'The PayPal refund currency or amount does not match the order.');
  let record = await one(tx, 'SELECT * FROM refunds WHERE provider_id=$1', [data.id]);
  if (!record) {
    const identifier = expectedId || data.custom_id;
    if (typeof identifier === 'string' && /^[0-9a-f-]{36}$/i.test(identifier)) {
      record = await one(tx, 'SELECT * FROM refunds WHERE id=$1 AND order_id=$2', [identifier, order.id]);
    }
  }
  if (record && (record.amount !== amount || record.order_id !== order.id || (record.provider_id && record.provider_id !== data.id))) {
    fail(409, 'The PayPal refund conflicts with the recorded request.');
  }
  if (record?.status === 'completed') return;
  const status = ({ COMPLETED: 'completed', PENDING: 'pending', CANCELLED: 'cancelled', FAILED: 'failed' })[data.status];
  if (!status) fail(409, 'PayPal returned an unsupported refund status.');
  if (record) {
    await tx.query('UPDATE refunds SET provider_id=$2,status=$3 WHERE id=$1', [record.id, data.id, status]);
  } else {
    await tx.query('INSERT INTO refunds(order_id,provider_id,amount,status,idempotency_key) VALUES($1,$2,$3,$4,$5)',
      [order.id, data.id, amount, status, randomUUID()]);
  }
  if (status !== 'completed') return;
  const cumulative = order.refund_total + amount;
  if (cumulative > order.total) fail(409, 'The verified refund exceeds the captured amount.');
  const orderStatus = cumulative === order.total ? 'refunded' : order.status === 'disputed' ? 'disputed' : 'partially_refunded';
  await tx.query('UPDATE orders SET status=$2,refund_total=$3,updated_at=now() WHERE id=$1', [order.id, orderStatus, cumulative]);
  await tx.query('UPDATE payments SET status=$2 WHERE order_id=$1', [order.id, orderStatus]);
  await audit(tx, req, 'payment.paypal_refunded', order.invoice_id, { amount, currency: order.currency });
  await notify(tx, order.email, 'Refund recorded for ' + order.invoice_id,
    'PayPal confirmed a refund of ' + (amount / 100).toFixed(2) + ' ' + order.currency + '.');
}
