'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const label = value => String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
const count = value => new Intl.NumberFormat().format(Number(value || 0));
const cash = (value, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value || 0) / 100);
const time = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const shortDate = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const safeLink = value => {
  if (/^\/(?!\/)[A-Za-z0-9._\/-]+$/.test(value || '')) return esc(value);
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return esc(url.href);
  } catch {}
  return '#';
};
const paths = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  analytics: 'M4 19h16M7 16v-4M12 16V8M17 16V5',
  orders: 'M5 5h14l2 5v10H3V10zM3 10h18M9 14h6',
  products: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5',
  categories: 'M3 6h6l2 2h10v11H3z',
  inventory: 'M4 4h16v16H4zM4 9h16M8 13h8M8 16h5',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-4M16 3a4 4 0 0 1 0 8',
  reviews: 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6-4.4-4.3 6.1-.9z',
  payments: 'M3 6h18v12H3zM3 10h18M7 15h4',
  transactions: 'M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4',
  discounts: 'M20 4H12L3 13l8 8 9-9V4zM16 8h.01',
  invoices: 'M5 3h11l3 3v15H5zM9 10h6M9 14h6M9 17h3',
  support: 'M4 12a8 8 0 0 1 16 0v3M4 12h4v5H4zM16 12h4v5h-4zM20 17c0 3-3 4-7 4',
  marketing: 'M3 10h4l11-5v14L7 14H3zM7 14l2 6h4',
  appearance: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 .7-2.8h3.7c3 0 3.6-2.7 2.4-5.3A9 9 0 0 0 12 3zM7 11h.01M10 7h.01M15 7h.01M18 10h.01',
  security: 'm12 22 5-4a7 7 0 0 0 3-6V6l-8-4-8 4v6a7 7 0 0 0 3 6zM8 12l3 3 5-6',
  audit: 'M4 5h16v14H4zM8 9h8M8 13h8M8 16h4',
  settings: 'M4 7h16M4 12h16M4 17h16M8 5v4M15 10v4M10 15v4',
  close: 'm6 6 12 12M18 6 6 18'
};
const icons = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.orders}"/></svg>`;
const groups = {
  Workspace: { overview: 'Overview', analytics: 'Analytics' },
  Commerce: { orders: 'Orders', products: 'Products', categories: 'Categories', inventory: 'Inventory', customers: 'Customers', reviews: 'Reviews', payments: 'Payments', transactions: 'Transactions', discounts: 'Discounts', invoices: 'Invoices' },
  Operations: { support: 'Support', marketing: 'Marketing', appearance: 'Appearance', security: 'Security', audit: 'Audit Logs', settings: 'Settings' }
};
const pages = Object.assign({}, ...Object.values(groups));
const currencies = ['USD', 'EUR', 'GBP', 'RON', 'CAD', 'AUD'];
const methods = { btc: 'Bitcoin', eth: 'Ethereum', ltc: 'Litecoin', sol: 'Solana', revolut: 'Revolut', paypal: 'PayPal' };
const orderStates = ['pending_payment','awaiting_verification','payment_under_review','paid','processing','completed','cancelled','expired','refunded','partially_refunded','disputed'];
const kinds = { service: 'Manual service', download: 'Digital download', license: 'License key', physical: 'Physical product' };
const periods = { today: 'Today', '7d': '7 days', '30d': '30 days', '3m': '3 months', '6m': '6 months', '1y': '1 year', all: 'All time', custom: 'Custom' };
const state = { user: null, page: 'overview', seq: 0, filters: {}, reporting: { range: '30d', currency: 'USD' }, data: null };
const dialog = $('#editor');
const main = $('#main');

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not complete this request.'), { status: response.status, code: data.code });
  return data;
}
const get = path => api('/api/admin' + path);
const save = (path, method, data) => api('/api/admin' + path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
const values = form => Object.fromEntries(new FormData(form));
const list = value => String(value ?? '').split(/[,\n]/).map(value => value.trim()).filter(Boolean);
const nullableNumber = value => value === '' || value == null ? null : Number(value);
const toIso = value => value ? new Date(value).toISOString() : null;
const localDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function query(filters) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(filters ?? {})) if (value !== '' && value != null) result.set(key, value);
  return result.size ? '?' + result : '';
}
function toast(message, error = false) {
  const node = document.createElement('p');
  node.className = 'toast' + (error ? ' error' : '');
  node.textContent = message;
  $('#notifications').append(node);
  setTimeout(() => node.remove(), 5500);
}
function btn(action, labelText, id = '', variant = '') {
  return `<button class="button ${esc(variant)}" type="button" data-action="${esc(action)}" data-id="${esc(id)}">${esc(labelText)}</button>`;
}
const linkButton = (path, name, variant = '') => `<a class="button ${esc(variant)}" href="${esc(path)}">${esc(name)}</a>`;
function heading(title, summary, actions = '', kicker = '303 CONTROL CENTER') {
  return `<header class="page-heading"><div><span class="eyebrow">${esc(kicker)}</span><h1>${esc(title)}</h1><p>${esc(summary)}</p></div><div class="actions">${actions}</div></header>`;
}
function panel(title, description, body, actions = '', variant = '') {
  return `<section class="panel ${esc(variant)}"><header class="panel-head"><div><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="actions">${actions}</div></header>${body}</section>`;
}
function empty(title, description = '', icon = 'orders') {
  return `<div class="empty"><span class="empty-mark">${icons(icon)}</span><strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
}
function table(headers, rows, fallback) {
  if (!rows.length) return fallback || empty('No records yet');
  return `<div class="table-wrap"><table><thead><tr>${headers.map(name => `<th scope="col">${esc(name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function badge(status) {
  const good = ['paid','completed','published','enabled','verified','resolved','ready','sent','captured','active','approved'];
  const warn = ['pending_payment','awaiting_verification','payment_under_review','processing','pending','scheduled','in_progress','open','sandbox','low_stock'];
  const bad = ['cancelled','expired','refunded','rejected','disputed','sold_out','failed'];
  const color = good.includes(status) ? 'good' : warn.includes(status) ? 'warn' : bad.includes(status) ? 'bad' : '';
  return `<span class="badge ${color}">${esc(label(status))}</span>`;
}
function detail(items) {
  return `<dl class="detail-grid">${items.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value ?? '—')}</dd></div>`).join('')}</dl>`;
}
function field(name, title, value = '', opts = {}) {
  const type = opts.type ?? 'text';
  const required = opts.required ? ' required' : '';
  const cls = opts.wide ? ' class="span"' : '';
  const hint = opts.hint ? `<small class="helper">${esc(opts.hint)}</small>` : '';
  let control;
  if (type === 'select') {
    control = `<select name="${esc(name)}"${required}>${opts.options.map(([key, text]) => `<option value="${esc(key)}"${String(key) === String(value ?? '') ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea name="${esc(name)}" rows="${opts.rows || 4}"${required} maxlength="${opts.max || 30000}">${esc(value)}</textarea>`;
  } else if (type === 'checkbox') {
    return `<label class="checkbox${opts.wide ? ' span' : ''}"><input type="checkbox" name="${esc(name)}"${value ? ' checked' : ''}>${esc(title)}</label>`;
  } else {
    control = `<input type="${esc(type)}" name="${esc(name)}" value="${type === 'file' ? '' : esc(value)}"${required}${opts.min != null ? ` min="${esc(opts.min)}"` : ''}${opts.max != null ? ` max="${esc(opts.max)}"` : ''}${opts.step ? ` step="${esc(opts.step)}"` : ''}${opts.accept ? ` accept="${esc(opts.accept)}"` : ''}${opts.autocomplete ? ` autocomplete="${esc(opts.autocomplete)}"` : ''}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>`;
  }
  return `<label${cls}>${esc(title)}${control}${hint}</label>`;
}
const area = (name, title, value, options = {}) => field(name, title, value, { type: 'textarea', wide: true, ...options });
const choice = (name, title, value, options) => field(name, title, value, { type: 'select', options });
const check = (name, title, value) => field(name, title, value, { type: 'checkbox' });
const amountField = (name, title, value, hint = '', required = false) => field(name, title, value == null ? '' : (value / 100).toFixed(2), { type: 'number', min: 0, max: 1000000, step: '0.01', required, hint });
const minor = value => value === '' || value == null ? null : Math.round(Number(value) * 100);
const enumOptions = values => values.map(value => [value, label(value)]);
const allOptions = (values, text = 'Any') => [['', text], ...enumOptions(values)];
const categoryOptions = categories => [['', 'No category'], ...categories.map(item => [item.id, item.name])];
const productOptions = products => [['', 'Any product'], ...products.map(item => [item.id, item.name])];
function filterForm(markup) {
  return `<form class="filter-form" data-filter>${markup}<button class="button" type="submit">Apply filters</button>${btn('reset-filter', 'Clear')}</form>`;
}
function pagination(rows, offset = 0) {
  return offset || rows.length === 100 ? `<div class="pagination panel-body actions">${offset ? btn('page-offset', 'Previous 100', Math.max(0, offset - 100)) : ''}${rows.length === 100 ? btn('page-offset', 'Next 100', Number(offset) + 100) : ''}</div>` : '';
}
function closeDialog() {
  if (dialog.open) dialog.close();
  $('#editor-content').replaceChildren();
}
function openDialog(title, summary, body) {
  $('#editor-content').innerHTML = `<header class="panel-head"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(summary)}</p></div><button type="button" class="icon-button" aria-label="Close dialog" data-action="close">${icons('close')}</button></header><div class="dialog-body">${body}</div>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
}
function edit({ title, summary = '', body, action, button = 'Save changes', danger = false, after }) {
  openDialog(title, summary, `<form id="editor-form"><div class="form-grid">${body}</div><p class="form-status" role="alert"></p><div class="form-actions">${btn('close', 'Cancel')}<button class="button ${danger ? 'danger' : 'primary'}" type="submit">${esc(button)}</button></div></form>`);
  const form = $('#editor-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('button[type="submit"]', form);
    const feedback = $('.form-status', form);
    submit.disabled = true;
    feedback.textContent = '';
    const data = values(form);
    try {
      if (form.dataset.reauth === 'required') {
        await api('/api/auth/reauth', { method: 'POST', body: JSON.stringify({ password: data.reauth_password, otp: data.reauth_otp }) });
        form.dataset.reauth = 'done';
        $('.reauth-fields', form).remove();
      }
      const response = await action(data, form);
      closeDialog();
      toast(button === 'Delete' ? 'Record deleted.' : 'Changes saved.');
      if (after) await after(response);
      else await loadPage();
    } catch (error) {
      feedback.textContent = error.message;
      if (error.code === 'REAUTH_REQUIRED' && form.dataset.reauth !== 'required') {
        $('.form-grid', form).insertAdjacentHTML('beforeend',
          `<fieldset class="span reauth-fields"><legend>Confirm owner credentials</legend><p class="helper">Use a fresh code from your authenticator.</p>${field('reauth_password', 'Password', '', { type: 'password', required: true, autocomplete: 'current-password' })}${field('reauth_otp', 'Authenticator code', '', { required: true, autocomplete: 'one-time-code' })}</fieldset>`);
        form.dataset.reauth = 'required';
        $('[name="reauth_password"]', form).focus();
      }
    } finally {
      submit.disabled = false;
    }
  });
}
function confirmAction(title, description, action, after) {
  edit({ title, summary: description, body: '', button: 'Delete', danger: true, action, after });
}
function orderTable(rows, actionName = 'order') {
  return table(['Invoice','Customer','Products','Amount','Method','Status','Date'], rows.map(order => [
    btn(actionName, order.invoice_id, order.id, 'small'),
    `<span class="cell-title">${esc(order.customer_name)}</span><span class="cell-note">${esc(order.email)}</span>`,
    esc(order.products || '—'), `<span class="money">${esc(cash(order.total, order.currency))}</span>`,
    esc(order.payment_name), badge(order.status), esc(time(order.created_at))
  ]), empty('No orders to show', 'Orders appear here as customers start checkout.'));
}
function metric(name, value, note, icon) {
  return `<div class="metric"><div class="metric-label"><span>${esc(name)}</span>${icons(icon)}</div><p class="metric-value">${esc(value)}</p><small>${esc(note)}</small></div>`;
}
function listPanel(rows, key, extra, title) {
  if (!rows.length) return empty(title);
  return `<div class="panel-body"><ul class="list">${rows.map(row => `<li><span>${esc(key(row))}</span><span class="muted">${esc(extra(row))}</span></li>`).join('')}</ul></div>`;
}
const chartMetrics = { gross: 'Verified receipts', net: 'Net receipts', orders: 'Paid orders', customers: 'New customer accounts', refunds: 'Refunds on paid orders', costs: 'Known item costs' };
function chart(series, currency, metricName) {
  const actual = series.filter(row => row[metricName] != null);
  if (!actual.length) return empty('No activity in this period', 'This chart updates as matching records are recorded.', 'analytics');
  const val = value => ['orders','customers'].includes(metricName) ? count(value) : cash(value, currency);
  const width = 880, height = 230, left = 105, right = 850, top = 20, bottom = 192;
  const floor = Math.min(0, ...actual.map(row => row[metricName]));
  const ceiling = Math.max(1, ...actual.map(row => row[metricName]));
  const points = series.map((row, index) => {
    const x = left + (right - left) * (series.length === 1 ? .5 : index / (series.length - 1));
    return { row, x, y: row[metricName] == null ? null : bottom - (row[metricName] - floor) * (bottom - top) / (ceiling - floor) };
  });
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point.y == null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(point);
  }
  if (segment.length) segments.push(segment);
  const coords = segment => segment.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = top + index * (bottom - top) / 4;
    const value = ceiling - index * (ceiling - floor) / 4;
    return `<path class="grid" d="M${left} ${y}H${right}"/><text class="axis" x="${left - 9}" y="${y + 4}" text-anchor="end">${esc(val(value))}</text>`;
  }).join('');
  const showEvery = Math.max(1, Math.ceil(points.length / 5));
  const xLabels = points.filter((_, index) => index % showEvery === 0).map(point =>
    `<text class="axis" x="${point.x}" y="218" text-anchor="middle">${esc(shortDate(point.row.bucket))}</text>`).join('');
  const lines = segments.map(points => {
    const positions = coords(points);
    return `<polygon class="area" points="${points[0].x},${bottom} ${positions} ${points.at(-1).x},${bottom}"/><polyline class="trend" pathLength="1" points="${positions}"/>`;
  }).join('');
  const dots = actual.length <= 40 ? points.filter(point => point.y != null).map(point =>
    `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="#b99fff"><title>${esc(shortDate(point.row.bucket) + ' · ' + val(point.row[metricName]))}</title></circle>`).join('') : '';
  return `<div class="chart-wrap"><p class="chart-key">● &nbsp; ${esc(chartMetrics[metricName])}</p><svg class="chart" role="img" aria-label="${esc(chartMetrics[metricName])} over the selected period" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="revenue-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#865dff" stop-opacity=".32"/><stop offset="1" stop-color="#865dff" stop-opacity="0"/></linearGradient></defs>${grid}${lines}${dots}${xLabels}</svg></div>`;
}
function reportControls() {
  const { range, currency, from, to } = state.reporting;
  return `<div class="periods" aria-label="Reporting period">${Object.entries(periods).map(([id, name]) =>
    `<button type="button" data-action="report-range" data-id="${id}" aria-pressed="${id === range}">${esc(name)}</button>`).join('')}</div>
    <label class="sr-only" for="report-currency">Reporting currency</label><select id="report-currency">${currencies.map(code =>
    `<option value="${code}"${code === currency ? ' selected' : ''}>${code}</option>`).join('')}</select>${range === 'custom' ?
    `<form class="custom-range actions" id="report-custom">${field('from', 'Start (UTC)', from, { type: 'date', required: true })}${field('to', 'End (UTC)', to, { type: 'date', required: true })}<button class="button small">Apply</button></form>` : ''}`;
}
function dashboard(data, analytics) {
  const { current: c, previous, window: { currency }, series } = data;
  const delta = previous?.gross > 0 ? ((c.gross - previous.gross) / previous.gross * 100) : null;
  const grossNote = delta === null ? 'Verified payments' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}% vs. prior period`;
  const metrics = [
    metric('Total receipts', cash(c.gross, currency), grossNote, 'payments'),
    metric('Net receipts', cash(c.net, currency), 'After fees, tax and refunds', 'analytics'),
    metric('Orders placed', count(c.orders), count(c.paid) + ' payments verified in period', 'orders'),
    metric('Pending payments', count(c.pending), 'Orders awaiting payment action', 'transactions')
  ];
  if (analytics) metrics.push(
    metric('Average paid order', c.paid ? cash(c.gross / c.paid, currency) : '—', 'Verified receipts per paid order', 'orders'),
    metric('Refunded orders', count(c.refunded), cash(c.refunds, currency) + ' refunded on these orders', 'transactions'),
    metric('New accounts', count(c.customers), 'Registered customer accounts', 'customers'),
    metric('Returning buyer rate', c.buyers ? (c.returning / c.buyers * 100).toFixed(1) + '%' : '—', 'Buyers with an earlier paid order', 'customers')
  );
  const metricName = state.chartMetric ?? 'gross';
  return heading(analytics ? 'Sales analytics' : 'Store overview', analytics ? 'Verified sales and customer activity, reported in one currency.' :
    'Track store performance, review incoming payments, and manage your catalogue.', analytics ? linkButton('/api/admin/analytics.csv' + query(state.reporting), 'Export revenue CSV') : linkButton('#payments', 'Payment queue', 'primary'))
    + `<div class="metrics">${metrics.join('')}</div><div class="dashboard-grid">${panel('Revenue overview', 'Verified activity · UTC', chart(series, currency, metricName),
      reportControls() + `<label class="sr-only" for="chart-metric">Chart metric</label><select id="chart-metric">${Object.entries(chartMetrics).map(([id, name]) =>
        `<option value="${id}"${id === metricName ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>`, 'full')}
      ${analytics ? panel('Sales by payment method', 'Verified receipts by checkout method',
        listPanel(data.methods, row => row.payment_name + ' · ' + row.orders + ' orders', row => cash(row.gross, currency), 'No verified payments'))
        : panel('Recent orders', 'Latest orders across all currencies', orderTable(data.recent), linkButton('#orders', 'All orders', 'small'), 'full')}
      ${panel('Product performance', 'Units purchased on verified orders excluding fully refunded orders',
        listPanel(data.top, row => row.name, row => count(row.units) + ' sold', 'No verified sales'))}
      ${analytics ? panel('Financial breakdown', 'Figures follow the verified payment date',
        `<div class="panel-body">${detail([['Fees', cash(c.fees, currency)], ['Taxes collected', cash(c.tax, currency)], ['Refunds', cash(c.refunds, currency)],
          ['Item costs', c.costs == null ? 'Incomplete cost data' : cash(c.costs, currency)], ['Margin after refunds and item costs', c.costs == null ? 'Incomplete cost data' : cash(c.gross - c.tax - c.refunds - c.costs, currency)],
          ['Conversion rate', 'Visitor data unavailable']])}</div>`, '', 'full') :
        panel('Payment verification queue', 'Revolut and crypto submissions needing review',
          data.queue.length ? `<ul class="list panel-body">${data.queue.map(order => `<li>${btn('order', order.invoice_id, order.id, 'small')}<span>${esc(order.payment_name)}</span>${badge(order.status)}</li>`).join('')}</ul>` :
          empty('Verification queue clear', 'Submissions will appear after a customer sends payment details.', 'payments'), linkButton('#payments', 'View queue', 'small')) +
        panel('Low stock', 'Active products with five or fewer units available', listPanel(data.stock, row => row.name, row => row.stock + ' in stock', 'No low-stock products')) +
        panel('Recently published', 'Live catalogue releases', listPanel(data.published, row => row.name, row => time(row.published), 'No published products')) +
        panel('Activity feed', 'Recent owner and system events', listPanel(data.activity, row => label(row.action.replaceAll('.', ' ')), row => time(row.created_at), 'No recorded activity'), linkButton('#audit', 'Audit logs', 'small'))}
    </div>`;
}

function productPage({ rows, categories }) {
  const filter = state.filters.products ?? {};
  return heading('Products', 'Publish digital products and services, manage variants, and keep your catalogue current.', btn('product-new', 'New product', '', 'primary')) +
    filterForm(field('q', 'Search products', filter.q, { placeholder: 'Name or URL slug' }) +
      choice('category', 'Category', filter.category, [['', 'All categories'], ...categoryOptions(categories).slice(1)])) +
    panel('Catalogue', 'Select products to publish or archive together.',
      table(['Select','Product','Type','Price','Inventory','Visibility','Actions'], rows.map(p => [
        `<input type="checkbox" aria-label="Select ${esc(p.name)}" data-select-product value="${esc(p.id)}">`,
        `<div class="product-cell">${p.thumbnail && p.active ? `<img class="thumb" src="${safeLink(p.thumbnail)}" alt="" loading="lazy">` : ''}
        <div><span class="cell-title">${esc(p.name)}</span><small class="cell-note">${esc(p.category || 'Uncategorized')} · /${esc(p.slug)}</small></div></div>`,
        esc(kinds[p.kind]), esc(cash(p.sale_price ?? p.price, p.currency)),
        p.kind === 'license' ? esc(p.available_keys + ' available keys') : esc(p.stock == null ? 'Unlimited' : p.stock + ' available'),
        badge(!p.active ? 'archived' : p.publish_at && new Date(p.publish_at) > new Date() ? 'scheduled' : 'published'),
        btn('product', 'Manage', p.id, 'small')
      ]), empty('No products match', 'Create a product or clear your catalogue filters.', 'products')) + pagination(rows, filter.offset),
      rows.length ? btn('product-bulk', 'Publish selected', 'true', 'small') + btn('product-bulk', 'Archive selected', 'false', 'small') : '');
}

async function productEditor(productId) {
  const [record, categories, catalog] = await Promise.all([productId ? get('/products/' + productId) : null, get('/categories'), get('/products')]);
  const p = record?.product ?? {};
  const d = p.details ?? {};
  edit({
    title: productId ? 'Edit ' + p.name : 'Create product',
    summary: 'Set pricing, publishing, purchase details and fulfilment.',
    body: field('name', 'Product name', p.name, { required: true }) + field('slug', 'URL slug', p.slug, { required: true, placeholder: 'my-product' }) +
      area('description', 'Description', p.description, { max: 20000, hint: 'Use line breaks and headings to structure the product copy.' }) +
      choice('category_id', 'Category', p.category_id, categoryOptions(categories)) + choice('kind', 'Fulfilment type', p.kind || 'service', Object.entries(kinds)) +
      choice('currency', 'Currency', p.currency || 'USD', enumOptions(currencies)) +
      amountField('price', 'Regular price', p.price, '', true) + amountField('sale_price', 'Discounted price', p.sale_price, 'Optional') +
      amountField('cost', 'Unit cost', p.cost, 'Optional. Used for margin reporting.') +
      field('stock', 'Stock quantity', p.stock, { type: 'number', min: 0, max: 100000000, hint: 'Leave empty for unlimited inventory.' }) +
      field('publish_at', 'Scheduled publishing (local time)', localDate(p.publish_at), { type: 'datetime-local' }) +
      field('tags', 'Tags', p.tags?.join(', '), { wide: true, hint: 'Separate tags with commas.' }) +
      field('video', 'Product video URL', d.video, { wide: true, placeholder: 'https://' }) +
      field('seoTitle', 'SEO title', d.seoTitle) + field('seoDescription', 'SEO description', d.seoDescription) +
      area('specifications', 'Specifications', d.specifications, { max: 4000 }) +
      area('instructions', 'Post-purchase instructions', d.instructions, { max: 4000 }) +
      `<fieldset class="span reauth-fields"><legend>Related products</legend><select name="related" aria-label="Related products" multiple size="4">${catalog.filter(item => item.id !== productId)
        .map(item => `<option value="${esc(item.id)}"${d.related?.includes(item.id) ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select><small class="helper">Select up to ten related products.</small></fieldset>` +
      check('active', 'Published', p.active) + check('featured', 'Featured on homepage', p.featured),
    action: (v, form) => {
      const body = { name: v.name, slug: v.slug, description: v.description, category_id: v.category_id || null,
        kind: v.kind, currency: v.currency, price: minor(v.price), sale_price: minor(v.sale_price), cost: minor(v.cost),
        stock: nullableNumber(v.stock), active: !!v.active, featured: !!v.featured, publish_at: toIso(v.publish_at), tags: list(v.tags),
        details: { specifications: v.specifications, instructions: v.instructions, video: v.video, seoTitle: v.seoTitle,
          seoDescription: v.seoDescription, related: new FormData(form).getAll('related') } };
      return productId ? save('/products/' + productId, 'PUT', { product: body, expectedStock: p.stock }) : save('/products', 'POST', body);
    },
    after: async result => {
      await loadPage();
      await productDetail(productId || result.id);
    }
  });
}

async function productDetail(id) {
  const { product: p, variants, images, assets, licenses } = await get('/products/' + id);
  const itemList = (rows, render, message) => rows.length ? `<ul class="list">${rows.map(render).join('')}</ul>` : `<p class="helper">${esc(message)}</p>`;
  const subgroup = (name, content, actions = '') => `<section class="nested-panel"><h3>${esc(name)}</h3>${content}<div class="actions">${actions}</div></section>`;
  openDialog(p.name, 'Manage product media, fulfilment inventory and variants.', `<div class="actions">${btn('product-edit', 'Edit product', p.id, 'primary')}
    ${btn('product-toggle', p.active ? 'Archive' : 'Publish', p.id + '|' + !p.active)}
    ${p.active ? '' : btn('product-delete', 'Delete', p.id, 'danger')}</div>
    ${detail([['Type', kinds[p.kind]], ['URL slug', p.slug], ['Price', cash(p.price, p.currency)], ['Inventory', p.stock ?? 'Unlimited']])}
    ${subgroup('Variants', itemList(variants, variant => `<li><span>${esc(variant.name)} <small class="muted">${esc(variant.active ? (variant.stock ?? 'Unlimited') : 'Archived')}</small></span>${btn('variant', 'Edit', p.id + '|' + variant.id, 'small')}</li>`,
      'No variants. Customers can purchase this product as a single item.'), btn('variant', 'Add variant', p.id, 'small'))}
    ${subgroup('Product images', itemList(images, image => `<li><a href="${safeLink(image.url === '/api/admin/media/' + image.id ? '/api/admin/image-preview/' + image.id : image.url)}" target="_blank" rel="noopener noreferrer">${esc(image.alt || 'Open image')}</a>${btn('product-remove', 'Remove', p.id + '|images|' + image.id, 'small danger')}</li>`,
      'No product images yet.'), btn('image-url', 'Add image URL', p.id, 'small') + btn('image-upload', 'Upload image', p.id, 'small'))}
    ${p.kind === 'download' ? subgroup('Private downloads', itemList(assets, asset => `<li><span>${esc(asset.filename)} <small class="muted">${esc(count(asset.size))} bytes · ${asset.download_limit} downloads</small></span>${btn('product-remove', 'Remove', p.id + '|assets|' + asset.id, 'small danger')}</li>`,
      'Upload the protected files customers should receive.'), btn('asset-upload', 'Upload private file', p.id, 'small')) : ''}
    ${p.kind === 'license' ? subgroup('License keys', itemList(licenses, key => `<li><span class="mono">${esc(key.id.slice(0, 8))} · ${esc(key.assigned_at ? 'Assigned ' + time(key.assigned_at) : 'Available')}</span>
      ${key.assigned_at ? '' : btn('product-remove', 'Remove', p.id + '|licenses|' + key.id, 'small danger')}</li>`,
      'Import the unique keys customers should receive.'), btn('licenses', 'Import keys', p.id, 'small')) : ''}`);
}

async function variantEditor(productId, variantId) {
  const v = variantId ? (await get('/products/' + productId)).variants.find(item => item.id === variantId) : {};
  if (!v) throw new Error('Variant was not found.');
  edit({ title: variantId ? 'Edit variant' : 'Add variant', summary: 'Variants can override price and hold a separate quantity.',
    body: field('name', 'Variant name', v.name, { required: true }) + amountField('price', 'Price override', v.price, 'Leave empty to use product price.') +
      field('stock', 'Variant quantity', v.stock, { type: 'number', min: 0, max: 100000000, hint: 'Leave empty for unlimited variant inventory.' }) +
      check('active', 'Available', v.active ?? true),
    action: data => {
      const variant = { name: data.name, price: minor(data.price), stock: nullableNumber(data.stock), active: !!data.active };
      const base = '/products/' + productId + '/variants';
      return variantId ? save(base + '/' + variantId, 'PUT', { variant, expectedStock: v.stock }) : save(base, 'POST', variant);
    },
    after: () => productDetail(productId)
  });
}

function productUpload(productId, asset) {
  edit({ title: asset ? 'Upload private download' : 'Upload product image',
    summary: asset ? 'Verified buyers receive this file under its download limit.' : 'PNG, JPEG and WebP files up to 3 MiB.',
    body: field('file', 'File', '', { type: 'file', wide: true, required: true, accept: asset ? undefined : 'image/png,image/jpeg,image/webp' }) +
      (asset ? field('limit', 'Downloads allowed per purchase', '3', { type: 'number', min: 1, max: 100, required: true, hint: 'Maximum file size is 15 MiB.' }) : field('alt', 'Image description')),
    button: 'Upload file',
    action: ({ file, alt, limit }) => {
      if (!file?.size || file.size > (asset ? 15 : 3) * 1024 ** 2) throw new Error('Choose a non-empty file within the upload limit.');
      return api('/api/admin/products/' + productId + (asset ? '/assets' : '/images/upload'), {
        method: 'POST', body: file,
        headers: { 'Content-Type': 'application/octet-stream', ...(asset ? {
          'X-Filename': encodeURIComponent(file.name), 'X-Download-Limit': limit
        } : { 'X-Image-Alt': encodeURIComponent(alt) }) }
      });
    }, after: () => productDetail(productId)
  });
}

function categoryPage(categories) {
  return heading('Categories', 'Organize products into discoverable collections.', btn('category-new', 'New category', '', 'primary')) +
    panel('Store categories', '', table(['Name','Slug','Products','Description','Actions'], categories.map(c => [
      esc(c.name), esc(c.slug), esc(count(c.product_count)), esc(c.description),
      btn('category-edit', 'Edit', c.id, 'small') + ' ' + btn('category-delete', 'Delete', c.id, 'small danger')
    ]), empty('No categories yet', 'Create a collection for your catalogue.', 'categories')));
}

function categoryEditor(category) {
  edit({ title: category ? 'Edit category' : 'New category', body: field('name', 'Category name', category?.name, { required: true }) +
    field('slug', 'URL slug', category?.slug, { required: true }) + area('description', 'Description', category?.description, { max: 2000 }),
    action: ({ name, slug, description }) => save('/categories' + (category ? '/' + category.id : ''), category ? 'PUT' : 'POST', { name, slug, description })
  });
}

function inventoryPage({ stock, events }) {
  const active = stock.filter(item => item.active && (item.stock <= 5 && item.stock !== null || item.kind === 'license' && item.keys <= 5 && item.keys !== null));
  return heading('Inventory', 'Inspect available quantities and apply stock corrections with a reason.') +
    (active.length ? `<p class="notice">${active.length} active stock ${active.length === 1 ? 'line is' : 'lines are'} below the low-stock threshold.</p>` : '') +
    panel('Stock on hand', 'Quantities reflect reservations and recorded corrections.',
      table(['Select','Product','Variant','Stock','Keys','Status'], stock.map(item => [
        item.stock == null ? '—' : `<input type="checkbox" aria-label="Select ${esc(item.name + (item.variant ? ' ' + item.variant : ''))}" data-select-stock value="${item.product_id}|${item.variant_id || ''}">`,
        btn('product', item.name, item.product_id, 'small'), esc(item.variant || '—'), esc(item.stock ?? 'Unlimited'), esc(item.keys ?? '—'),
        badge(item.active ? item.stock === 0 || item.kind === 'license' && item.keys === 0 ? 'sold_out' : item.stock != null && item.stock <= 5 ? 'low_stock' : 'active' : 'archived')
      ]), empty('No stock records', 'Create a product to start tracking inventory.', 'inventory')), btn('stock-adjust', 'Adjust selected', '', 'small')) +
    panel('Adjustment history', 'Recent stock changes and reasons.', table(['Date','Product','Variant','Change','Reason'], events.map(item =>
      [esc(time(item.created_at)), esc(item.name || 'Deleted product'), esc(item.variant || '—'), esc((item.delta > 0 ? '+' : '') + item.delta), esc(item.reason)]),
    empty('No stock changes')), '', 'standalone');
}

function orderPage(rows, key) {
  const filter = state.filters[key] ?? {};
  const headingText = key === 'payments' ? 'Payment verification' : key === 'invoices' ? 'Invoices' : 'Orders';
  const description = key === 'payments' ? 'Review submitted evidence, then independently confirm the transfer before approving.' :
    key === 'invoices' ? 'Find the invoice PDF for any order and inspect its current payment status.' : 'Track payment state, fulfilment, invoice records and customer orders.';
  const actions = key === 'orders' ? linkButton('/api/admin/orders.csv' + query({ ...filter, offset: '' }), 'Export orders CSV') :
    key === 'payments' ? linkButton('#settings/payment-methods', 'Payment settings') : '';
  const filters = filterForm(field('q', 'Search', filter.q, { placeholder: 'Invoice, name or email' }) +
    choice('status', 'Status', filter.status, allOptions(key === 'payments' ? ['awaiting_verification','payment_under_review'] : orderStates, 'All statuses')) +
    choice('method', 'Payment method', filter.method, [['', 'All methods'], ...Object.entries(methods)]) +
    field('from', 'From (UTC)', filter.from, { type: 'date' }) + field('to', 'To (UTC)', filter.to, { type: 'date' }));
  const content = key === 'invoices' ? table(['Invoice','Customer','Total','Status','Created','Document'], rows.map(order => [
    btn('order', order.invoice_id, order.id, 'small'), esc(order.customer_name), esc(cash(order.total, order.currency)),
    badge(order.status), esc(time(order.created_at)), linkButton('/api/admin/orders/' + order.id + '/invoice.pdf', 'Download PDF', 'small')
  ]), empty('No invoices to show', 'Invoices are generated when checkout creates an order.', 'invoices')) : orderTable(rows);
  return heading(headingText, description, actions) + filters + panel(headingText, '', content + pagination(rows, filter.offset));
}

async function orderDetail(id) {
  const record = await get('/orders/' + id);
  const { order: o, items, submissions, payment, notes, refunds } = record;
  const reviewable = o.method_id !== 'paypal' && submissions.length && ['awaiting_verification','payment_under_review','expired'].includes(o.status);
  const delivery = ['paid','processing'].includes(o.status);
  const refundable = o.method_id === 'paypal' && o.paid_at && o.total > o.refund_total && o.status !== 'disputed';
  const grouped = (name, body) => `<section class="nested-panel"><h3>${esc(name)}</h3>${body}</section>`;
  openDialog(o.invoice_id, 'Order details, payment evidence and fulfilment.',
    `<div class="actions">${badge(o.status)}${linkButton('/api/admin/orders/' + o.id + '/invoice.pdf', 'Download invoice PDF', 'small')}${btn('order-note', 'Add internal note', o.id, 'small')}</div>
    ${detail([['Customer', o.customer_name], ['Email', o.email], ['Created', time(o.created_at)], ['Paid', time(o.paid_at)], ['Method', o.payment_name],
      ['Total', cash(o.total, o.currency)], ['Subtotal', cash(o.subtotal, o.currency)], ['Discount', cash(o.discount, o.currency)], ['Tax', cash(o.tax, o.currency)],
      ['Shipping', cash(o.shipping, o.currency)], ['Refunded', cash(o.refund_total, o.currency)], ['Transaction ID', payment?.transaction_id],
      ['Provider order', payment?.provider_order_id], ['Network', o.network], ['Recipient', o.destination],
      ['Crypto quote', o.crypto_amount], ['Payment window ends', time(o.expires_at)]])}
    ${o.shipping_address ? grouped('Shipping address', detail(Object.entries(o.shipping_address).map(([key, value]) => [label(key), value]))) : ''}
    ${grouped('Purchased items', table(['Product','Variant','Quantity','Unit price'], items.map(item =>
      [esc(item.name), esc(item.variant_name ?? '—'), esc(item.quantity), esc(cash(item.unit_price, o.currency))])))}
    ${grouped('Payment submissions', submissions.length ? `<div class="compact-stack">${submissions.map(item => `<div class="nested-panel"><div class="actions">
      ${badge(item.status)}<span class="mono">${esc(item.reference)}</span><small class="muted">${esc(time(item.created_at))}</small></div>
      <p class="body-copy">${esc(item.note)}</p>${item.receipt_filename ? linkButton('/api/admin/orders/' + o.id + '/receipt/' + item.id, 'Download receipt', 'small') : ''}</div>`).join('')}</div>` : empty('No submissions'))}
    ${reviewable || delivery || refundable ? grouped('Owner actions', `<div class="actions">${reviewable ?
      (o.status !== 'payment_under_review' ? btn('order-review', 'Start review', o.id, 'small') : '') +
      (o.network ? btn('order-chain', 'Look up on chain', o.id, 'small') : '') +
      btn('order-approve', 'Verify and approve', o.id, 'small primary') + btn('order-reject', 'Reject payment', o.id, 'small danger') : ''}
      ${delivery ? btn('order-fulfill', 'Update fulfilment', o.id, 'small primary') : ''}
      ${refundable ? btn('order-refund', 'Issue PayPal refund', o.id, 'small danger') : ''}</div>`) : ''}
    ${o.method_id === 'paypal' && payment?.provider_order_id ? `<div class="actions">${btn('order-reconcile', 'Reconcile PayPal', o.id, 'small')}</div>` : ''}
    ${refunds.length ? grouped('Refunds', table(['Date','Amount','Status','Provider reference'], refunds.map(item =>
      [esc(time(item.created_at)), esc(cash(item.amount, o.currency)), badge(item.status), esc(item.provider_id ?? '—')]))) : ''}
    ${grouped('Internal notes', notes.length ? `<ul class="list">${notes.map(item => `<li><div><p class="body-copy">${esc(item.note)}</p><small class="muted">${esc(item.username || 'System')} · ${esc(time(item.created_at))}</small></div></li>`).join('')}</ul>` : empty('No notes yet'))}`);
}

async function orderAction(actionName, id) {
  const { order: o, submissions } = await get('/orders/' + id);
  const operations = {
    approve: ['Verify and approve payment', 'Independently check the recipient, amount, transaction reference and network. Uploaded evidence cannot verify a payment on its own.'],
    review: ['Start payment review', 'Flag the submitted evidence as under review.'],
    reject: ['Reject payment submission', 'Record why the transfer could not be verified.'],
    fulfill: ['Update fulfilment', 'Set the order status after completing the required delivery steps.'],
    refund: ['Issue PayPal refund', 'Send a refund through PayPal for this verified capture.'],
    notes: ['Add internal note', 'Notes are available only in the owner workspace.']
  };
  const [title, summary] = operations[actionName];
  const idem = actionName === 'refund' ? crypto.randomUUID() : null;
  let body = '';
  if (actionName === 'approve') {
    body = field('reference', 'Verified transaction reference', submissions[0]?.reference, { wide: true, required: true }) +
      field('receivedAmount', o.crypto_amount ? 'Verified crypto amount received' : 'Verified amount received (' + o.currency + ')',
        o.crypto_amount ?? (o.total / 100).toFixed(2), { required: true }) +
      (o.network ? field('confirmations', 'Verified confirmations', '', { type: 'number', min: o.confirmation_threshold || 1, max: 10000, required: true }) : '') +
      check('acceptOverpayment', 'I reviewed and accept any overpayment', false) + check('confirmed', 'I confirmed the transfer independently', false);
  }
  if (actionName === 'fulfill') body += choice('status', 'Fulfilment status', 'completed', enumOptions(['processing','completed']));
  if (actionName === 'refund') body += amountField('amount', 'Refund amount (' + o.currency + ')', o.total - o.refund_total, 'Remaining amount available: ' + cash(o.total - o.refund_total, o.currency), true);
  if (actionName !== 'refund') body += area('note', actionName === 'reject' ? 'Rejection reason' : 'Internal note', '', { max: 2000, required: ['notes','reject'].includes(actionName) });
  edit({ title, summary, body, button: title, danger: ['refund','reject'].includes(actionName), action: v => {
    if (actionName === 'approve' && !v.confirmed) throw new Error('Confirm the independent transfer check to approve this payment.');
    const payload = actionName === 'refund' ? { amount: minor(v.amount), idempotencyKey: idem } : { ...(v.note ? { note: v.note } : {}) };
    if (actionName === 'approve') Object.assign(payload, { reference: v.reference, receivedAmount: v.receivedAmount.trim(),
      ...(v.confirmations ? { confirmations: Number(v.confirmations) } : {}), acceptOverpayment: !!v.acceptOverpayment });
    if (actionName === 'fulfill') payload.status = v.status;
    return save('/orders/' + id + '/' + actionName, 'POST', payload);
  }, after: async () => { await loadPage(); await orderDetail(id); } });
}

function transactionsPage(rows) {
  return heading('Transactions', 'Reconcile provider IDs, independently verified transfer references, and captured amounts.') +
    filterForm(field('q', 'Search', state.filters.transactions?.q, { placeholder: 'Invoice or transaction ID' })) +
    panel('Payment records', '', table(['Invoice','Reference','Method','Amount','Fee','Refunded','Status','Verified'], rows.map(row => [
      btn('order', row.invoice_id, row.id, 'small'),
      `<span class="mono">${esc(row.transaction_id || row.provider_order_id)}</span>`,
      esc(row.payment_name), esc(cash(row.total, row.currency)), esc(cash(row.fee, row.currency)),
      esc(cash(row.refund_total, row.currency)), badge(row.status), esc(time(row.paid_at))
    ]), empty('No transactions match', 'Transfer references are recorded when a payment is independently verified or processed.')));
}

function discountPage({ rows }) {
  return heading('Discounts', 'Manage campaign codes, customer restrictions and promotion schedules.', btn('discount-new', 'New coupon', '', 'primary')) +
    panel('Coupons', '', table(['Code','Offer','Eligibility','Paid uses','Status','Actions'], rows.map(row => [
      `<span class="mono">${esc(row.code)}</span>`,
      esc(row.kind === 'percent' ? row.amount / 100 + '%' : row.kind === 'fixed' ? cash(row.amount, row.currency) : 'Free shipping'),
      esc([row.product, row.category, row.first_purchase ? 'First purchase' : ''].filter(Boolean).join(' · ') || 'All eligible orders'),
      esc(count(row.paid_uses) + (row.max_uses ? ' / ' + row.max_uses : '')),
      badge(!row.enabled ? 'disabled' : row.ends_at && new Date(row.ends_at) <= new Date() ? 'expired' :
        row.starts_at && new Date(row.starts_at) > new Date() ? 'scheduled' : 'active'), btn('discount-edit', 'Edit', row.code, 'small')
    ]), empty('No discounts configured', 'Create a campaign coupon when you are ready.', 'discounts')));
}

function discountEditor(row) {
  const r = row || {};
  edit({ title: row ? 'Edit ' + row.code : 'Create coupon', summary: 'Coupons are validated on the server against the current order.',
    body: (row ? '' : field('code', 'Coupon code', '', { required: true })) +
      choice('kind', 'Discount type', r.kind || 'percent', [['percent','Percentage'],['fixed','Fixed amount'],['free_shipping','Free shipping']]) +
      amountField('amount', 'Percent or fixed amount', r.amount, 'Enter 10 for 10% or 10.00 in the selected currency.') +
      choice('currency', 'Currency', r.currency, [['','Any (percentage only)'], ...enumOptions(currencies)]) +
      choice('product_id', 'Product', r.product_id, productOptions(state.data.products)) +
      choice('category_id', 'Category', r.category_id, [['','Any category'], ...categoryOptions(state.data.categories).slice(1)]) +
      field('starts_at', 'Start (local time)', localDate(r.starts_at), { type: 'datetime-local' }) +
      field('ends_at', 'End (local time)', localDate(r.ends_at), { type: 'datetime-local' }) +
      field('max_uses', 'Total usage limit', r.max_uses, { type: 'number', min: 1, max: 1000000 }) +
      field('max_per_customer', 'Usage limit per customer', r.max_per_customer, { type: 'number', min: 1, max: 1000000 }) +
      amountField('min_subtotal', 'Minimum eligible subtotal', r.min_subtotal, 'In the order currency.') +
      check('first_purchase', 'First purchase only', r.first_purchase) + check('enabled', 'Coupon enabled', r.enabled ?? true),
    action: v => {
      const code = row?.code || v.code.trim().toUpperCase();
      return save('/discounts/' + encodeURIComponent(code), 'PUT', { code, kind: v.kind, amount: minor(v.amount) ?? 0,
        currency: v.currency || null, product_id: v.product_id || null, category_id: v.category_id || null,
        starts_at: toIso(v.starts_at), ends_at: toIso(v.ends_at), max_uses: nullableNumber(v.max_uses),
        max_per_customer: nullableNumber(v.max_per_customer), min_subtotal: minor(v.min_subtotal) ?? 0,
        first_purchase: !!v.first_purchase, enabled: !!v.enabled });
    }
  });
}

function customersPage(rows) {
  return heading('Customers', 'Find customer accounts and review verification, order history and active sessions.') +
    filterForm(field('q', 'Search accounts', state.filters.customers?.q, { placeholder: 'Username or email' })) +
    panel('Accounts', '', table(['Account','Role','Verification','Orders','Active sessions','Joined','Actions'], rows.map(row => [
      `<span class="cell-title">${esc(row.username)}</span><span class="cell-note">${esc(row.email)}</span>`, esc(label(row.role)),
      badge(row.verified_at ? 'verified' : 'pending'), esc(count(row.orders)), esc(count(row.sessions)), esc(time(row.created_at)),
      btn('customer-orders', 'Orders', row.email, 'small') + (row.sessions && row.role !== 'owner' ? ' ' + btn('customer-revoke', 'Revoke sessions', row.id, 'small danger') : '')
    ]), empty('No accounts match', 'Registered customers will appear here.', 'customers')));
}

const reviewStatuses = ['pending','published','hidden','rejected'];
function reviewsPage(rows) {
  return heading('Reviews', 'Moderate verified-purchase reviews and respond as the store.') +
    filterForm(choice('status', 'Review status', state.filters.reviews?.status, allOptions(reviewStatuses, 'All reviews'))) +
    panel('Customer feedback', '', table(['Product','Customer','Rating','Review','Status','Actions'], rows.map(row => [
      esc(row.name), esc(row.username), `<span class="review-stars" aria-label="${row.rating} out of 5">${'★'.repeat(row.rating)}${'☆'.repeat(5 - row.rating)}</span>`,
      esc(row.body.length > 130 ? row.body.slice(0, 130) + '…' : row.body), badge(row.status), btn('review-edit', 'Moderate', row.id, 'small')
    ]), empty('No reviews match', 'Eligible purchasers can submit a product review from their account.', 'reviews')));
}

const supportStatuses = ['open','in_progress','resolved','closed'];
function supportPage(rows) {
  return heading('Support', 'Work through customer requests and reply by email.') +
    filterForm(choice('status', 'Ticket status', state.filters.support?.status, allOptions(supportStatuses, 'All tickets'))) +
    panel('Support tickets', '', table(['Subject','Customer','Category','Invoice','Status','Received','Actions'], rows.map(row => [
      esc(row.subject), esc(row.email), esc(label(row.category)), esc(row.invoice_id || '—'), badge(row.status),
      esc(time(row.created_at)), btn('support-edit', 'View ticket', row.id, 'small')
    ]), empty('Inbox clear', 'Contact form submissions appear here.', 'support')));
}

function marketingPage({ total, subscribers }) {
  return heading('Marketing', 'Manage newsletter opt-ins and export the subscriber list.', linkButton('/api/admin/marketing.csv', 'Export subscribers')) +
    `<div class="metrics">${metric('Newsletter subscribers', count(total), 'Addresses currently subscribed', 'marketing')}</div>` +
    panel('Subscribers', 'Most recent opt-ins', table(['Email','Subscribed','Actions'], subscribers.map(row =>
      [esc(row.email), esc(time(row.created_at)), btn('unsubscribe', 'Remove subscription', row.email, 'small danger')]),
    empty('No subscribers yet', 'Newsletter opt-ins from your storefront appear here.', 'marketing')));
}

function auditPage(rows) {
  return heading('Audit logs', 'Inspect security events and changes to store records.') +
    filterForm(field('q', 'Search events', state.filters.audit?.q, { placeholder: 'Event or target' })) +
    panel('Audit trail', 'Most recent recorded events', table(['Timestamp','Event','Actor','Target','Details'], rows.map(row => [
      esc(time(row.created_at)), `<span class="mono">${esc(row.action)}</span>`,
      esc(row.username || 'System'), esc(row.target), esc(Object.keys(row.metadata || {}).length ? JSON.stringify(row.metadata) : '—')
    ]), empty('No matching events', '', 'audit')));
}

function securityPage({ account, events, reauthenticated }) {
  return heading('Security', 'Inspect owner authentication and recovery options.') +
    panel('Owner account', '', `<div class="panel-body">${detail([['Username', account.username], ['Authenticator', account.mfa ? 'Enabled' : 'Required'],
      ['Remaining recovery codes', account.recovery_codes], ['Active sessions', account.sessions], ['Last step-up in this session', time(reauthenticated)]])}
      <div class="actions">${btn('recovery-codes', 'Rotate recovery codes', '', 'primary')}</div></div>`) +
    panel('Recent security events', '', table(['Date','Event','Target'], events.map(row => [
      esc(time(row.created_at)), esc(row.action), esc(row.target)
    ]), empty('No security events')), '', 'standalone');
}

const sections = ['featured','best-sellers','latest','categories','offers','reviews','how-it-works','community','faq','newsletter'];
const legalNames = { terms: 'Terms of service', privacy: 'Privacy policy', refund: 'Refund policy', delivery: 'Delivery policy', contact: 'Contact page', faq: 'FAQ page', cookies: 'Cookie policy' };
function appearancePage(settings) {
  return heading('Appearance', 'Update the storefront’s identity, message and homepage sections.', btn('appearance-edit', 'Edit appearance', '', 'primary')) +
    panel('Store identity', '', `<div class="panel-body">${detail([['Name', settings.name || '303 Services/Shop'],
      ['Accent color', settings.accent || '#865dff'], ['Product cards', label(settings.cardStyle || 'standard')], ['Announcement', settings.announcement || '—'],
      ['Homepage banner', settings.banner || '—'], ['Support URL', settings.supportUrl || 'Default Discord invite'],
      ['Footer copy', settings.footer || '—'], ['Sections', (settings.sections ?? sections).map(item => label(item.replaceAll('-', ' '))).join(', ')]])}</div>`);
}
function appearanceEditor(r) {
  edit({ title: 'Edit storefront appearance', summary: 'These settings are visible on the storefront.',
    body: field('name', 'Store name', r.name || '303 Services/Shop', { required: true }) +
      field('accent', 'Accent color', r.accent || '#865dff', { type: 'color', required: true }) +
      field('logo', 'Logo URL', r.logo) + field('favicon', 'Favicon URL', r.favicon) +
      field('announcement', 'Announcement bar', r.announcement, { wide: true }) +
      field('banner', 'Homepage banner copy', r.banner, { wide: true }) +
      area('footer', 'Footer copy', r.footer, { max: 500 }) +
      field('supportUrl', 'Support URL', r.supportUrl) + choice('cardStyle', 'Product cards', r.cardStyle || 'standard', enumOptions(['standard','compact'])) +
      area('socialLinks', 'Social URLs, one per line', r.socialLinks?.join('\n'), { max: 18000 }) +
      `<fieldset class="span reauth-fields"><legend>Homepage sections</legend>${sections.map(section =>
        check('sections_' + section, label(section.replaceAll('-', ' ')), (r.sections ?? sections).includes(section))).join('')}</fieldset>`,
    action: v => save('/settings/appearance', 'PUT', { name: v.name, accent: v.accent, logo: v.logo, favicon: v.favicon, announcement: v.announcement,
      banner: v.banner, footer: v.footer, supportUrl: v.supportUrl, cardStyle: v.cardStyle, socialLinks: list(v.socialLinks),
      sections: sections.filter(section => v['sections_' + section]) })
  });
}
function settingsPage({ store, legal, payments }) {
  const tabs = `<nav class="actions overview-tabs" aria-label="Settings">${linkButton('#settings', 'General', !payments ? 'primary' : '')}
    ${linkButton('#settings/payment-methods', 'Payment methods', payments ? 'primary' : '')}</nav>`;
  if (payments) {
    return heading('Payment methods', 'Configure receiving details, accepted currencies and checkout availability.') + tabs +
      panel('Checkout methods', 'Provider configuration status checks for deployment credentials. Verified payment state remains order-specific.',
        table(['Method','Network','Destination','Currencies','Provider','Checkout','Actions'], payments.map(row => [
          esc(row.name), esc(row.network || '—'), `<span class="mono">${esc(row.destination)}</span>`, esc(row.currencies.join(', ')),
          badge(row.ready ? row.mode === 'sandbox' ? 'sandbox' : 'ready' : 'setup_required') +
            (row.network ? `<small class="cell-note">Chain lookup ${row.chain_ready ? 'configured' : 'requires setup'}</small>` : ''),
          badge(row.enabled ? 'enabled' : 'disabled'), btn('payment-edit', 'Configure', row.id, 'small')
        ])));
  }
  return heading('Settings', 'Manage checkout rules, merchant details and storefront policies.') + tabs +
    panel('Store operations', '', `<div class="panel-body">${detail([['Guest checkout', store.guestCheckout !== false ? 'Enabled' : 'Disabled'],
      ['Maintenance mode', store.maintenanceMode ? 'On' : 'Off'], ['Review eligibility', label(store.reviewEligibility ?? 'verified')], ['Legal business name', store.legalName || 'Required for production'],
      ['Jurisdiction', store.jurisdiction || 'Required for production'], ['Tax ID', store.taxId || '—'],
      ['Configured tax', (store.taxBps || 0) / 100 + '%'], ['Shipping destinations', store.shippingCountries?.join(', ') || 'None']])}</div>`,
      btn('settings-edit', 'Edit settings', '', 'small primary')) +
    panel('Customer-facing policies', 'Add your business policies before enabling production checkout.',
      table(['Page','Status'], Object.entries(legalNames).map(([key, name]) => [esc(name), badge(legal[key] ? 'configured' : 'empty')])),
      btn('legal-edit', 'Edit legal pages', '', 'small'), 'standalone');
}
function settingsEditor(r) {
  edit({ title: 'Edit store settings', body: field('legalName', 'Legal business name', r.legalName) +
    field('taxId', 'Tax registration ID', r.taxId) + field('jurisdiction', 'Tax jurisdiction', r.jurisdiction) +
    choice('reviewEligibility', 'Review eligibility', r.reviewEligibility || 'verified', [['verified','Verified payment'],['completed','Completed order']]) +
    field('tax', 'Tax percent', (r.taxBps ?? 0) / 100, { type: 'number', min: 0, max: 100, step: '0.01' }) +
    amountField('shippingRate', 'Flat shipping charge', r.shippingRate ?? 0, 'In the order currency.') +
    field('shippingCountries', 'Shipping destinations', r.shippingCountries?.join(', '), { hint: 'Comma-separated ISO two-letter country codes.' }) +
    check('guestCheckout', 'Enable guest checkout', r.guestCheckout ?? true) + check('maintenanceMode', 'Enable maintenance mode', r.maintenanceMode),
    action: v => save('/settings/settings', 'PUT', { legalName: v.legalName, taxId: v.taxId, jurisdiction: v.jurisdiction,
      reviewEligibility: v.reviewEligibility, taxBps: minor(v.tax) ?? 0, shippingRate: minor(v.shippingRate) ?? 0, shippingCountries: list(v.shippingCountries.toUpperCase()),
      guestCheckout: !!v.guestCheckout, maintenanceMode: !!v.maintenanceMode })
  });
}
function paymentEditor(row) {
  edit({ title: 'Configure ' + row.name, summary: 'Changes apply to future checkouts. Current invoices keep their original receiving details.',
    body: field('name', 'Display name', row.name, { required: true }) +
      field('destination', row.id === 'revolut' ? 'Recipient Revtag' : row.id === 'paypal' ? 'Merchant email for display' : 'Receiving wallet', row.destination, { required: true }) +
      field('recipient_name', 'Recipient display name', row.recipient_name) +
      field('currencies', 'Accepted currencies', row.currencies.join(', '), { required: true, hint: currencies.join(', ') }) +
      field('sort_order', 'Display order', row.sort_order, { type: 'number', min: 0, max: 100, required: true }) +
      field('expires_minutes', 'Payment window (minutes)', row.expires_minutes, { type: 'number', min: 5, max: 1440, required: true }) +
      (row.confirmation_floor ? field('confirmation_threshold', 'Required network confirmations', row.confirmation_threshold, { type: 'number', min: row.confirmation_floor, max: 10000,
        hint: 'Minimum and default: ' + row.confirmation_floor + ' on ' + row.network + '.' }) : '') +
      area('instructions', 'Payment instructions', row.instructions, { required: true, max: 5000 }) + check('enabled', 'Enable at checkout', row.enabled),
    action: v => save('/payment-methods/' + row.id, 'PUT', { name: v.name, destination: v.destination, recipient_name: v.recipient_name, instructions: v.instructions,
      enabled: !!v.enabled, currencies: list(v.currencies.toUpperCase()), sort_order: Number(v.sort_order), expires_minutes: Number(v.expires_minutes),
      confirmation_threshold: nullableNumber(v.confirmation_threshold) })
  });
}

const render = {
  overview: data => dashboard(data, false),
  analytics: data => dashboard(data, true),
  products: productPage,
  categories: categoryPage,
  inventory: inventoryPage,
  orders: data => orderPage(data, 'orders'),
  payments: data => orderPage(data, 'payments'),
  invoices: data => orderPage(data, 'invoices'),
  transactions: transactionsPage,
  discounts: discountPage,
  customers: customersPage,
  reviews: reviewsPage,
  support: supportPage,
  marketing: marketingPage,
  audit: auditPage,
  security: securityPage,
  appearance: appearancePage,
  settings: settingsPage
};
const objects = async entries => Object.fromEntries(await Promise.all(entries.map(async ([key, data]) => [key, await data])));
async function loadData(page, subpage) {
  const suffix = query(state.filters[page]);
  if (page === 'overview' || page === 'analytics') return get('/' + page + query(state.reporting));
  if (page === 'invoices') return get('/orders' + suffix);
  if (page === 'products') return objects([['rows', get('/products' + suffix)], ['categories', get('/categories')]]);
  if (page === 'discounts') return objects([['rows', get('/discounts')], ['products', get('/products')], ['categories', get('/categories')]]);
  if (page === 'appearance') return get('/settings/appearance');
  if (page === 'settings') {
    if (subpage === 'payment-methods') return { payments: await get('/payment-methods') };
    return objects([['store', get('/settings/settings')], ['legal', get('/settings/legal')]]);
  }
  return get('/' + page + suffix);
}
function navigation() {
  $('#navigation').innerHTML = Object.entries(groups).map(([group, links]) =>
    `<div class="nav-group"><p class="nav-label">${esc(group)}</p>${Object.entries(links).map(([id, name]) =>
      `<a class="nav-item" href="#${id}"${state.page === id ? ' aria-current="page"' : ''}>${icons(id)}${esc(name)}</a>`).join('')}</div>`).join('');
}
function sidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#mobile-backdrop').hidden = !open;
  $('#toggle-navigation').setAttribute('aria-expanded', String(open));
}
function switchToLogin() {
  state.user = null;
  $('#workspace').hidden = true;
  $('#login-view').hidden = false;
  closeDialog();
  if (location.pathname !== '/admin/login') history.replaceState(null, '', '/admin/login' + location.hash);
}
function authorized(user) {
  return user?.role === 'owner' && user.mfaAt;
}
async function initialize(user) {
  if (!authorized(user)) {
    switchToLogin();
    return;
  }
  state.user = user;
  $('#login-view').hidden = true;
  $('#workspace').hidden = false;
  $('#account-name').textContent = user.username;
  if (location.pathname === '/admin/login') history.replaceState(null, '', '/admin' + location.hash);
  await loadPage();
}
async function loadPage() {
  if (!state.user) return;
  const id = ++state.seq;
  const [route, subpage] = location.hash.slice(1).split('/');
  const page = Object.hasOwn(pages, route) ? route : 'overview';
  state.page = page;
  navigation();
  $('#breadcrumb').textContent = subpage === 'payment-methods' ? 'Payment methods' : pages[page];
  document.title = pages[page] + ' · 303 Control Center';
  main.innerHTML = '<div class="loading" role="status" aria-label="Loading workspace"><div class="skeleton"></div><div class="skeleton"></div></div>';
  try {
    const data = await loadData(page, subpage);
    if (id !== state.seq || !state.user) return;
    state.data = data;
    main.innerHTML = render[page](data);
  } catch (error) {
    if (id !== state.seq || !state.user) return;
    if (error.status === 401 || error.status === 403) switchToLogin();
    else main.innerHTML = heading(pages[page], 'This workspace section could not be loaded.') +
      `<section class="panel"><div class="panel-body"><p class="notice">${esc(error.message)}</p>${btn('reload', 'Try again')}</div></section>`;
  }
}
function reportRange(range) {
  const { currency, from, to } = state.reporting;
  if (range === 'custom' && !from) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    state.reporting = { range, currency, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  } else state.reporting = range === 'custom' ? { range, currency, from, to } : { range, currency };
  return loadPage();
}
function redirectToOrders(email) {
  state.filters.orders = { q: email };
  location.hash = 'orders';
}
const row = (id, key = 'id') => state.data.find(item => item[key] === id);
const refreshProduct = id => async () => { await loadPage(); await productDetail(id); };
const operation = {
  close: closeDialog,
  reload: loadPage,
  'reset-filter': () => { state.filters[state.page] = {}; return loadPage(); },
  'page-offset': offset => {
    state.filters[state.page] = { ...state.filters[state.page], offset: Number(offset) };
    return loadPage();
  },
  'report-range': reportRange,
  'product-new': () => productEditor(),
  product: productDetail,
  'product-edit': productEditor,
  'product-bulk': async enabled => {
    const ids = Array.from(document.querySelectorAll('[data-select-product]:checked'), input => input.value);
    if (!ids.length) throw new Error('Select at least one product.');
    edit({ title: enabled === 'true' ? 'Publish selected products' : 'Archive selected products', summary: ids.length + ' products selected.', body: '',
      action: () => save('/products/bulk', 'PATCH', { ids, active: enabled === 'true' }) });
  },
  'product-toggle': async value => {
    const [id, enabled] = value.split('|');
    await save('/products/bulk', 'PATCH', { ids: [id], active: enabled === 'true' });
    toast(enabled === 'true' ? 'Product published.' : 'Product archived.');
    await refreshProduct(id)();
  },
  'product-delete': id => confirmAction('Delete product', 'Products with orders or reviews must remain archived.', () => save('/products/' + id, 'DELETE')),
  variant: id => variantEditor(...id.split('|')),
  'image-upload': id => productUpload(id, false),
  'asset-upload': id => productUpload(id, true),
  'image-url': id => edit({ title: 'Add product image', body: field('url', 'Image URL', '', { required: true, wide: true, placeholder: 'https://' }) +
    field('alt', 'Image description') + field('position', 'Display position', '0', { type: 'number', min: 0, max: 99, required: true }),
  action: v => save('/products/' + id + '/images', 'POST', { url: v.url, alt: v.alt, position: Number(v.position) }), after: refreshProduct(id) }),
  'product-remove': value => {
    const [id, resource, item] = value.split('|');
    confirmAction('Remove item', 'Assigned files and licenses remain available to their purchasers.', () => save('/products/' + id + '/' + resource + '/' + item, 'DELETE'), refreshProduct(id));
  },
  licenses: id => edit({ title: 'Import license keys', summary: 'Paste one unique license key per line. Keys are encrypted before storage.',
    body: area('keys', 'License keys', '', { required: true, max: 501000, rows: 8 }),
    action: v => save('/products/' + id + '/licenses', 'POST', { keys: v.keys.split('\n').map(value => value.trim()).filter(Boolean) }), after: refreshProduct(id) }),
  'category-new': () => categoryEditor(),
  'category-edit': id => categoryEditor(row(id)),
  'category-delete': id => confirmAction('Delete category', 'Move any linked products and coupons to another category first.',
    () => save('/categories/' + id, 'DELETE')),
  'stock-adjust': () => {
    const selected = Array.from(document.querySelectorAll('[data-select-stock]:checked'), input => input.value.split('|'));
    if (!selected.length) throw new Error('Select one or more finite stock lines.');
    edit({ title: 'Adjust stock', summary: 'Apply the same adjustment to ' + selected.length + ' selected lines.',
      body: field('delta', 'Add or subtract units', '', { type: 'number', min: -1000000, max: 1000000, required: true }) +
        field('reason', 'Reason', '', { required: true, placeholder: 'Inventory recount' }),
      action: v => save('/inventory/adjust', 'POST', { rows: selected.map(([product, variant]) => ({ product, variant: variant || null, delta: Number(v.delta) })), reason: v.reason }) });
  },
  order: orderDetail,
  'order-note': id => orderAction('notes', id),
  'order-review': id => orderAction('review', id),
  'order-approve': id => orderAction('approve', id),
  'order-reject': id => orderAction('reject', id),
  'order-fulfill': id => orderAction('fulfill', id),
  'order-refund': id => orderAction('refund', id),
  'order-chain': async id => {
    const { evidence } = await save('/orders/' + id + '/chain-evidence', 'POST', {});
    openDialog('Blockchain evidence', 'Compare this transfer with independent invoice attribution before approval.', evidence.found ?
      detail([['Network', evidence.network], ['Reference', evidence.reference], ['Amount received', evidence.receivedAmount], ['Amount match', evidence.amountCheck],
        ['Confirmations', evidence.confirmations], ['Meets confirmation threshold', evidence.meetsThreshold ? 'Yes' : 'No'], ['Observed', time(evidence.observedAt)],
        ['Before invoice', evidence.predatesInvoice ? 'Yes' : 'No'], ['After expiry', evidence.afterExpiry ? 'Yes' : 'No']]) :
      empty('Transfer not found', 'The configured provider has not observed this reference on the selected network.') + btn('order', 'Back to order', id, 'small'));
  },
  'order-reconcile': id => edit({ title: 'Reconcile PayPal', summary: 'Look up the provider payment and update its status from PayPal.', body: '',
    button: 'Check PayPal', action: () => save('/orders/' + id + '/reconcile-paypal', 'POST', {}),
    after: async () => { await loadPage(); await orderDetail(id); } }),
  'discount-new': () => discountEditor(),
  'discount-edit': code => discountEditor(state.data.rows.find(row => row.code === code)),
  'customer-orders': redirectToOrders,
  'customer-revoke': id => edit({ title: 'Revoke active sessions', summary: 'The customer will need to sign in again on each device.', body: '', button: 'Revoke sessions',
    danger: true, action: () => save('/customers/' + id + '/sessions', 'DELETE') }),
  'review-edit': id => {
    const item = row(id);
    edit({ title: 'Moderate verified review', summary: item.name + ' · ' + item.username + ' · ' + item.rating + '/5',
      body: `<blockquote class="span body-copy">${esc(item.body)}</blockquote>` + choice('status', 'Review status', item.status, enumOptions(reviewStatuses)) +
        area('owner_reply', 'Store response', item.owner_reply, { max: 2000 }),
      action: ({ status, owner_reply }) => save('/reviews/' + id, 'PUT', { status, owner_reply }) });
  },
  'support-edit': id => {
    const item = row(id);
    edit({ title: item.subject, summary: item.email + (item.invoice_id ? ' · ' + item.invoice_id : ''),
      body: `<p class="notice span body-copy">${esc(item.message)}</p>` + choice('status', 'Ticket status', item.status, enumOptions(supportStatuses)) +
        area('reply', 'Reply to customer', item.reply, { max: 4000 }),
      action: ({ status, reply }) => save('/support/' + id, 'PUT', { status, reply }) });
  },
  unsubscribe: email => confirmAction('Remove subscription', 'Remove this address from the newsletter list.',
    () => save('/marketing/subscribers', 'DELETE', { email })),
  'appearance-edit': () => appearanceEditor(state.data),
  'settings-edit': () => settingsEditor(state.data.store),
  'payment-edit': id => paymentEditor(state.data.payments.find(row => row.id === id)),
  'legal-edit': () => edit({ title: 'Edit customer-facing policies', summary: 'Add the policy text for your jurisdiction and store.',
    body: Object.entries(legalNames).map(([key, name]) => area(key, name, state.data.legal[key])).join(''),
    action: v => save('/settings/legal', 'PUT', Object.fromEntries(Object.keys(legalNames).map(key => [key, v[key]]))) }),
  'recovery-codes': () => edit({ title: 'Rotate recovery codes', summary: 'All previous recovery codes will expire. Save the replacement codes somewhere private.',
    body: '', button: 'Generate replacement codes', danger: true,
    action: () => api('/api/auth/recovery-codes', { method: 'POST', body: '{}' }),
    after: async result => {
      await loadPage();
      openDialog('Replacement recovery codes', 'Save these codes now. Each can be used once.', `<pre class="credential-codes">${esc(result.codes.join('\n'))}</pre>`);
    } })
};

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = operation[button.dataset.action];
  if (!action) return;
  button.disabled = true;
  try { await action(button.dataset.id); } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
main.addEventListener('submit', event => {
  if (event.target.matches('[data-filter]')) {
    event.preventDefault();
    state.filters[state.page] = values(event.target);
    loadPage();
  } else if (event.target.id === 'report-custom') {
    event.preventDefault();
    const { from, to } = values(event.target);
    if (!from || !to || from > to) { toast('Select a valid date range.', true); return; }
    Object.assign(state.reporting, { from, to });
    loadPage();
  }
});
main.addEventListener('change', event => {
  if (event.target.id === 'report-currency') {
    state.reporting.currency = event.target.value;
    loadPage();
  } else if (event.target.id === 'chart-metric') {
    state.chartMetric = event.target.value;
    main.innerHTML = render[state.page](state.data);
    $('#chart-metric').focus();
  }
});
$('#owner-login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = values(form);
  const submit = $('button[type="submit"]', form);
  $('#login-status').textContent = '';
  submit.disabled = true;
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: data.username, password: data.password, otp: data.otp }) });
    if (!authorized(result.user)) {
      await api('/api/auth/logout', { method: 'POST' });
      throw new Error('Owner credentials with MFA are required.');
    }
    form.reset();
    await initialize(result.user);
  } catch (error) {
    $('#login-status').textContent = error.message;
    $('[name="otp"]', form).value = '';
  } finally {
    submit.disabled = false;
  }
});
$('#sign-out').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    switchToLogin();
  } catch (error) { toast(error.message, true); }
});
$('#toggle-navigation').addEventListener('click', () => sidebar(!$('#sidebar').classList.contains('open')));
$('#mobile-backdrop').addEventListener('click', () => sidebar(false));
$('#sidebar').addEventListener('click', event => { if (event.target.closest('a')) sidebar(false); });
window.addEventListener('hashchange', () => {
  closeDialog();
  loadPage();
});
dialog.addEventListener('close', () => { if (!dialog.open) $('#editor-content').replaceChildren(); });
api('/api/me').then(({ user }) => initialize(user)).catch(() => switchToLogin());
