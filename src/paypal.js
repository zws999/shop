const env = (config, key) => config[key] ?? process.env[key];

export function paypalConfigured(config = {}) {
  try {
    const app = new URL(env(config, 'APP_URL'));
    const mode = env(config, 'PAYPAL_MODE') || 'sandbox';
    const secureUrl = app.protocol === 'https:' ||
      (mode === 'sandbox' && app.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname));
    return secureUrl && ['sandbox', 'live'].includes(mode) &&
      (!(config.production || env(config, 'NODE_ENV') === 'production') || mode === 'live') &&
      ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_MERCHANT_ID']
        .every(key => Boolean(env(config, key)?.trim()));
  } catch {
    return false;
  }
}

export function paypalClient(config, request = fetch) {
  const live = env(config, 'PAYPAL_MODE') === 'live';
  const base = live ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const merchantId = env(config, 'PAYPAL_MERCHANT_ID');
  let oauth;

  async function accessToken() {
    if (oauth && oauth.expires > Date.now()) return oauth.token;
    const auth = Buffer.from(env(config, 'PAYPAL_CLIENT_ID') + ':' + env(config, 'PAYPAL_CLIENT_SECRET')).toString('base64');
    const response = await request(base + '/v1/oauth2/token', {
      method: 'POST',
      headers: { authorization: 'Basic ' + auth, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(7000), redirect: 'error'
    });
    const data = response.ok && await response.json();
    if (!data?.access_token) throw new Error('PayPal authentication failed.');
    oauth = { token: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
    return oauth.token;
  }

  async function api(path, { method = 'GET', body, requestId, rawBody } = {}) {
    if (!paypalConfigured(config)) throw new Error('PayPal is unavailable.');
    const headers = {
      authorization: 'Bearer ' + await accessToken(),
      'content-type': 'application/json',
      prefer: 'return=representation'
    };
    if (requestId) headers['paypal-request-id'] = requestId;
    const response = await request(base + path, {
      method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(10_000), redirect: 'error'
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error('PayPal request failed.');
      error.providerStatus = response.status;
      error.issue = data.details?.[0]?.issue;
      throw error;
    }
    return response.json();
  }

  const amount = (minor, currency) => ({ value: (minor / 100).toFixed(2), currency_code: currency });
  const pathId = id => encodeURIComponent(id);

  return {
    merchantId,
    async create(order) {
      const returnUrl = new URL('/', env(config, 'APP_URL'));
      returnUrl.search = new URLSearchParams({ order: order.id, paypal: 'return' });
      const cancelUrl = new URL(returnUrl);
      cancelUrl.searchParams.set('paypal', 'cancel');
      const unit = {
        reference_id: order.id,
        custom_id: order.id,
        invoice_id: order.invoice_id,
        payee: { merchant_id: merchantId },
        amount: amount(order.total, order.currency)
      };
      if (order.shipping_address) {
        const shipping = order.shipping_address;
        unit.shipping = {
          name: { full_name: order.customer_name },
          address: {
            address_line_1: shipping.address1, address_line_2: shipping.address2,
            admin_area_2: shipping.city, admin_area_1: shipping.region,
            postal_code: shipping.postalCode, country_code: shipping.country
          }
        };
      }
      const data = await api('/v2/checkout/orders', {
        method: 'POST', requestId: order.id,
        body: {
          intent: 'CAPTURE',
          purchase_units: [unit],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: '303 Services/Shop',
                shipping_preference: order.shipping_address ? 'SET_PROVIDED_ADDRESS' : 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                return_url: returnUrl.toString(),
                cancel_url: cancelUrl.toString()
              }
            }
          }
        }
      });
      const approval = data.links?.find(link => ['payer-action', 'approve'].includes(link.rel))?.href;
      const approvalUrl = approval && new URL(approval);
      const allowed = live ? ['www.paypal.com', 'paypal.com'] : ['www.sandbox.paypal.com', 'sandbox.paypal.com'];
      if (!data.id || !approvalUrl || approvalUrl.protocol !== 'https:' || approvalUrl.port ||
          approvalUrl.username || approvalUrl.password || !allowed.includes(approvalUrl.hostname)) {
        throw new Error('PayPal returned invalid approval details.');
      }
      return { providerOrderId: data.id, approvalUrl: approvalUrl.toString() };
    },
    getOrder: id => api('/v2/checkout/orders/' + pathId(id)),
    async capture(id, localOrderId) {
      try {
        return await api('/v2/checkout/orders/' + pathId(id) + '/capture', {
          method: 'POST', body: {}, requestId: 'cap-' + localOrderId.replaceAll('-', '')
        });
      } catch (error) {
        if (error.issue === 'ORDER_ALREADY_CAPTURED') return this.getOrder(id);
        throw error;
      }
    },
    refund(captureId, refund) {
      return api('/v2/payments/captures/' + pathId(captureId) + '/refund', {
        method: 'POST',
        requestId: refund.idempotencyKey,
        body: { amount: amount(refund.amount, refund.currency), custom_id: refund.id }
      });
    },
    async verifyWebhook(headers, event, raw) {
      const envelope = {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: env(config, 'PAYPAL_WEBHOOK_ID')
      };
      if (!event?.id || !Object.values(envelope).every(value => typeof value === 'string' && value.length)) return false;
      const rawBody = raw
        ? JSON.stringify(envelope).slice(0, -1) + ',"webhook_event":' + raw + '}'
        : JSON.stringify({ ...envelope, webhook_event: event });
      const result = await api('/v1/notifications/verify-webhook-signature', { method: 'POST', rawBody });
      return result.verification_status === 'SUCCESS';
    }
  };
}
