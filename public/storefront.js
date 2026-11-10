const main = document.querySelector('main');
const footer = document.querySelector('footer.site-footer');
const cartDialog = document.querySelector('#cart-dialog');
const cartCount = document.querySelector('#cart-count');
const supportDefault = 'https://discord.gg/EbV2GC4sar';
const icons = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  external: '<path d="M14 4h6v6m0-6-9 9"/><path d="M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  bag: '<path d="M5 8h14l1 12H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5m8 4.5v9"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z"/>',
  shield: '<path d="M12 22c5-2 8-5 8-10V5l-8-3-8 3v7c0 5 3 8 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  chat: '<path d="M20 12a8 8 0 0 1-8 8 9 9 0 0 1-3-.5L4 21l1.5-5a8 8 0 1 1 14.5-4Z"/><path d="M9 12h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  star: '<path d="m12 3 2.8 5.8 6.4 1-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-1L12 3Z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  credit: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  heart: '<path d="M20.8 8.6c0 4.3-8.8 10.5-8.8 10.5s-8.8-6.2-8.8-10.5a4.6 4.6 0 0 1 8.8-1.7 4.6 4.6 0 0 1 8.8 1.7Z"/>',
  receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
};
function icon(name) {
  return '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] ?? '') + '</svg>';
}
const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
const e = value => encodeURIComponent(String(value ?? ''));
const asArray = value => Array.isArray(value) ? value : [];
const discordIcon = '<img width="17" height="17" src="/brand/discord.svg" alt="">';
const kindLabels = { download:'Digital download', license:'License key', service:'Digital service', physical:'Physical product', digital_download:'Digital download', license_key:'License key', manual_service:'Digital service' };
const statusLabels = {
  pending_payment:'Pending payment', awaiting_verification:'Awaiting verification', payment_under_review:'Payment under review',
  paid:'Paid', processing:'Processing', completed:'Completed', cancelled:'Cancelled', expired:'Expired',
  refunded:'Refunded', partially_refunded:'Partially refunded', disputed:'Disputed'
};
const paymentAssets = {
  btc:['bitcoin','BTC'], eth:['ethereum','ETH'], ltc:['litecoin','LTC'], sol:['solana','SOL'],
  revolut:['revolut','Revolut'], paypal:['paypal','PayPal']
};
const state = {
  catalog: null, catalogExpires: 0, cart: null, store: {}, user: null, page: 0, checkoutDraft: {}, payReturn: null,
  route: {path:'/',query:new URLSearchParams()}, lastCheckout: null, cartLoading: null, catalogLoading: null,
};
document.querySelectorAll('[data-icon]').forEach(node => node.insertAdjacentHTML('afterbegin',icon(node.dataset.icon)));

function asset(value) {
  if (!value) return '';
  try {
    const url = new URL(value,location.origin);
    if (url.origin === location.origin && !String(value).startsWith('//')) return url.pathname + url.search + url.hash;
    if (url.protocol === 'https:') return url.href;
  } catch {}
  return '';
}
function supportUrl() {
  const href = asset(state.store.discord || state.store.supportLink);
  return href && !href.startsWith('/') ? href : supportDefault;
}
function discordButton(text = 'Join our Discord', primary = false) {
  return '<a class="button' + (primary ? ' button-primary' : '') + '" href="' + h(supportUrl()) + '" target="_blank" rel="noopener noreferrer">' + discordIcon + h(text) + '</a>';
}
function date(value, time = false) {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',...(time ? {timeStyle:'short'} : {})}).format(parsed);
}
function money(cents, currency = 'USD') {
  const amount = Number(cents);
  const code = String(currency || 'USD').toUpperCase();
  if (!Number.isFinite(amount)) return '—';
  try {
    const formatter = new Intl.NumberFormat(undefined,{style:'currency',currency:code});
    return formatter.format(amount / 10 ** formatter.resolvedOptions().maximumFractionDigits);
  } catch { return (amount / 100).toFixed(2) + ' ' + code; }
}
function displayPrice(product, variant = null) {
  const variants = asArray(product.variants);
  const eligible = variants.filter(option => !soldOut(product, option));
  const variantPrices = (eligible.length ? eligible : variants).map(item => Number(item.price ?? product.sale_price ?? product.price));
  const regular = variant?.price ?? product.price;
  const sale = variant?.price == null ? product.sale_price : null;
  const low = !variant && variantPrices.length ? Math.min(...variantPrices) : null;
  if (low !== null) return '<span class="price"><small class="muted">From</small> ' + h(money(low,product.currency)) + '</span>';
  if (sale != null && Number(sale) < Number(regular)) return '<span class="price">' + h(money(sale,product.currency)) + '<del>' + h(money(regular,product.currency)) + '</del></span>';
  return '<span class="price">' + h(money(regular,product.currency)) + '</span>';
}
function soldOut(product, variant = null) {
  if (variant) return (variant.stock != null && Number(variant.stock) <= 0) || (product.stock != null && Number(product.stock) <= 0);
  const variants = asArray(product.variants);
  if (variants.length) return variants.every(option => soldOut(product,option));
  return product.stock != null && Number(product.stock) <= 0;
}
function isSale(product) { return product.sale_price != null && Number(product.sale_price) < Number(product.price); }
function routeHref(path) { return '#' + path; }
function go(path) {
  if (location.hash === routeHref(path)) render();
  else location.hash = routeHref(path);
}
function route() {
  const href = location.hash.startsWith('#/') ? location.hash.slice(1) : location.pathname + location.search;
  const parsed = new URL(href,location.origin);
  return {path:parsed.pathname.replace(/\/+$/,'') || '/', query:parsed.searchParams};
}
function updateTitle(title) {
  document.title = title ? title + ' | ' + (state.store.name || '303 Services/Shop') : (state.store.name || '303 Services/Shop') + ' | Digital shopping. Redefined.';
}
async function api(path, options = {}) {
  const response = await fetch('/api' + path,{
    method:options.method ?? 'GET',
    credentials:'same-origin',
    headers:options.body !== undefined ? {'Content-Type':'application/json'} : undefined,
    body:options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The request could not be completed.');
  return data;
}
const post = (path, body = {}) => api(path,{method:'POST',body});
function notify(message, error = false) {
  const item = document.createElement('div');
  item.className = 'toast' + (error ? ' error' : '');
  item.textContent = message;
  const region = document.querySelector('#toast-region');
  region.replaceChildren(item);
  window.setTimeout(() => item.remove(),3800);
}
function empty(title, body, symbol = 'cube', action = '') {
  return '<div class="empty-state"><span class="empty-icon">' + icon(symbol) + '</span><div><h3>' + h(title) + '</h3><p>' + h(body) + '</p></div>' + action + '</div>';
}
function linkButton(path,text,primary = false,symbol = '') {
  return '<a class="button' + (primary ? ' button-primary' : '') + '" href="' + h(routeHref(path)) + '">' + h(text) + (symbol ? icon(symbol) : '') + '</a>';
}
function errorNotice(message) { return '<p class="notice error" role="alert">' + h(message) + '</p>'; }
function page(title, eyebrow, copy, content) {
  updateTitle(title);
  return '<div class="shell page"><header class="page-heading"><span class="eyebrow">' + h(eyebrow) + '</span><h1>' + h(title) + '</h1>' + (copy ? '<p>' + h(copy) + '</p>' : '') + '</header>' + content + '</div>';
}
function section(label,title,copy,content,action = '',id = '') {
  return '<section class="section"' + (id ? ' id="' + h(id) + '"' : '') + '><div class="shell"><div class="section-head"><div><span class="eyebrow">' + h(label) + '</span><h2>' + h(title) + '</h2>' + (copy ? '<p>' + h(copy) + '</p>' : '') + '</div>' + action + '</div>' + content + '</div></section>';
}
function renderFooter() {
  footer.innerHTML = '<div class="shell"><div class="footer-grid"><div><a href="#/" class="brand" aria-label="303 Services/Shop home"><img src="' + h(asset(state.store.logo) || '/brand/wordmark.svg?v=2') + '" width="47" height="30" alt=""><span class="brand-name">SERVICES<span class="brand-slash">/</span>SHOP</span></a><p class="footer-blurb">' + h(state.store.footer || 'Premium digital products and services, all in one place.') + '</p></div><div class="footer-group"><h2>Discover</h2><a href="#/shop">Shop all products</a><a href="#/categories">Categories</a><a href="#/reviews">Customer reviews</a></div><div class="footer-group"><h2>Help</h2><a href="#/faq">FAQ</a><a href="#/support">Contact support</a><a href="#/orders">Track your order</a><a href="' + h(supportUrl()) + '" target="_blank" rel="noopener noreferrer">Discord community</a></div><div class="footer-group"><h2>Store policies</h2><a href="#/legal/terms">Terms of service</a><a href="#/legal/privacy">Privacy policy</a><a href="#/legal/refund">Refund policy</a><a href="#/legal/delivery">Delivery policy</a><a href="#/legal/cookies">Cookie policy</a></div></div><div class="footer-foot"><span>© ' + new Date().getFullYear() + ' ' + h(state.store.name || '303 Services/Shop') + '</span><span>Digital products and services</span></div></div>';
  const supportLinks = footer.querySelectorAll('.footer-group')[1];
  for (const url of asArray(state.store.socialLinks).map(asset).filter(url => url.startsWith('https:'))) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = new URL(url).hostname.replace(/^www\./,'');
    supportLinks.append(link);
  }
}
function applyBrand() {
  const logo = asset(state.store.logo);
  const favicon = asset(state.store.favicon);
  const accent = state.store.accent;
  if (logo) document.querySelector('.site-header .brand img').src = logo;
  if (favicon) document.querySelector('link[rel=icon]').href = favicon;
  if (/^#[0-9a-f]{6}$/i.test(accent || '')) document.documentElement.style.setProperty('--accent',accent);
  document.documentElement.classList.toggle('compact-cards',state.store.cardStyle === 'compact');
  const header = document.querySelector('.site-header');
  const existing = document.querySelector('.announcement');
  if (state.store.announcement && !existing) {
    const banner = document.createElement('div');
    banner.className = 'announcement';
    banner.textContent = state.store.announcement;
    header.before(banner);
  } else if (existing) {
    existing.textContent = state.store.announcement || '';
    existing.hidden = !state.store.announcement;
  }
  renderFooter();
}
async function catalog() {
  if (state.catalog && Date.now() < state.catalogExpires) return state.catalog;
  state.catalogLoading ??= api('/catalog').then(data => {
    state.catalog = {products:asArray(data.products),categories:asArray(data.categories)};
    state.catalogExpires = Date.now() + 20000;
    state.store = data.store || {};
    applyBrand();
    return state.catalog;
  }).finally(() => { state.catalogLoading = null; });
  return state.catalogLoading;
}
function visual(image, className = '', extra = '') {
  const url = asset(image?.url);
  return url
    ? '<div class="product-visual ' + className + '">' + extra + '<img src="' + h(url) + '" alt="' + h(image.alt || '') + '" loading="lazy" decoding="async"></div>'
    : '<div class="product-visual fallback ' + className + '">' + extra + '<img src="/brand/wordmark.svg?v=2" alt="" width="80" height="46" loading="lazy"></div>';
}
function productCard(product) {
  const badges = (isSale(product) ? '<span class="badge card-media-badge">On sale</span>' : '') + (soldOut(product) ? '<span class="badge neutral card-media-badge">Sold out</span>' : '');
  const details = '/product/' + e(product.slug);
  return '<article class="product-card"><a href="' + details + '" aria-label="' + h('View ' + product.name) + '">' + visual(asArray(product.images)[0],'',badges) + '</a><div class="card-content"><p class="kicker card-type">' + h(product.category_name || kindLabels[product.kind] || 'Product') + '</p><h3><a href="' + details + '">' + h(product.name) + '</a></h3><p>' + h(product.description) + '</p><div class="flex-between">' + displayPrice(product) + '<a class="button button-small" href="' + details + '" aria-label="' + h('View ' + product.name) + '">View ' + icon('arrow') + '</a></div></div></article>';
}
function productGrid(products, emptyTitle, emptyCopy) {
  return products.length ? '<div class="product-grid">' + products.map(productCard).join('') + '</div>' : empty(emptyTitle,emptyCopy);
}
function categoryCards(categories) {
  return categories.length ? '<div class="category-grid">' + categories.map(category => '<a class="category-card" href="#/shop?category=' + e(category.slug) + '"><span class="card-icon">' + icon('grid') + '</span><h3>' + h(category.name) + '</h3><p>' + h(category.description || 'Browse this collection') + '</p></a>').join('') + '</div>' : empty('No categories yet','Collections will appear once the store publishes them.','grid');
}
function reviewCards(reviews) {
  if (!reviews.length) return empty('No reviews yet','Feedback from verified purchasers will appear here.','star');
  return '<div class="review-grid">' + reviews.map(review => {
    const stars = Math.min(5,Math.max(1,Number(review.rating) || 1));
    return '<article class="review-card"><div class="review-stars" aria-label="' + stars + ' out of 5 stars">' + '★'.repeat(stars) + '☆'.repeat(5 - stars) + '</div>' +
      (review.product_name ? '<h3>' + h(review.product_name) + '</h3>' : '') + '<p>' + h(review.body) + '</p>' +
      '<footer><strong>' + h(review.username || 'Verified customer') + '</strong><span class="badge success">' + icon('check') + 'Verified purchase</span><time datetime="' + h(review.created_at) + '">' + h(date(review.created_at)) + '</time></footer>' +
      (review.owner_reply ? '<div class="owner-reply"><strong>Store response</strong><p>' + h(review.owner_reply) + '</p></div>' : '') + '</article>';
  }).join('') + '</div>';
}
const faqItems = [
  ['How do I place an order?','Browse the catalogue, choose a product and add it to your cart. At checkout, you can review your order, enter your details and select one of the available payment methods.'],
  ['What happens after I submit a manual payment?','Your order enters verification. Open a Discord support ticket and provide your invoice ID and transaction reference so the store can review your payment.'],
  ['How do I get my purchase?','When your order is ready, open its status page to see your download, license key or fulfillment information. The product page describes the delivery method.'],
  ['Where can I find my invoice?','Open your order from the same browser used at checkout or sign in to the account you ordered with. The order page includes the invoice PDF.'],
];
function faqGrid() {
  return '<div class="faq-grid">' + faqItems.map(([q,a]) => '<details class="faq-item"><summary>' + h(q) + icon('chevron') + '</summary><p>' + h(a) + '</p></details>').join('') + '</div>';
}
function processGrid() {
  return '<div class="process-grid">' + [
    ['cube','Browse and choose','Explore products and select the options you need.'],
    ['credit','Review and pay','Check your order total and choose an available payment method.'],
    ['bolt','Track your order','Use your invoice ID to follow payment verification and delivery.'],
  ].map(([symbol,title,copy],index) => '<article class="process-card"><div class="flex-between"><span class="card-icon">' + icon(symbol) + '</span><span class="kicker">0' + (index + 1) + '</span></div><h3>' + h(title) + '</h3><p>' + h(copy) + '</p></article>').join('') + '</div>';
}
function input(label,name,type = 'text',attributes = '',value = '') {
  return '<label class="field"><span>' + h(label) + '</span><input name="' + h(name) + '" type="' + h(type) + '" value="' + h(value) + '" ' + attributes + '></label>';
}
function formError() { return '<p class="form-error" role="alert"></p>'; }
function newsletter() {
  return '<div class="newsletter"><div><span class="eyebrow">303 updates</span><h2>Stay in the loop.</h2><p>Get email updates about new products and store offers.</p></div><form class="form-grid" data-form="newsletter"><div class="inline-form">' + input('Email address','email','email','autocomplete="email" required placeholder="you@example.com"') + '<button type="submit" class="button button-primary">Subscribe ' + icon('arrow') + '</button></div>' + formError() + '</form></div>';
}
function sectionEnabled(key) {
  const configured = state.store.sections;
  if (Array.isArray(configured)) return configured.includes(key);
  return configured?.[key] !== false;
}
function home(data, reviews = [], error = '') {
  updateTitle();
  const products = data.products;
  const featured = products.filter(product => product.featured).slice(0,3);
  const best = products.filter(product => Number(product.sales) > 0).sort((a,b) => Number(b.sales) - Number(a.sales)).slice(0,3);
  const latest = products.slice(0,3);
  const offers = products.filter(isSale).slice(0,3);
  const banner = state.store.heroTitle || state.store.banner;
  const heroTitle = typeof banner === 'string' && banner.trim() ? h(banner) : 'Digital shopping.<br><em>Redefined.</em>';
  const heroCopy = state.store.heroCopy || 'Discover a new standard in digital products and services. Premium quality, effortless ordering, and a shopping experience designed around you.';
  return '<section class="hero"><div class="shell hero-content"><span class="hero-chip">' + h(state.store.name || '303 Services/Shop') + '</span><h1 class="hero-title">' + heroTitle + '</h1><p class="hero-copy">' + h(heroCopy) + '</p><div class="button-row">' + linkButton('/shop','Explore products',true,'arrow') + discordButton() + '</div></div><img class="hero-graphic" src="/brand/orbit.svg?v=2" width="790" height="620" alt="" fetchpriority="high"><span class="hero-caption" aria-hidden="true">303 / ORBITAL SERIES</span></section>' +
    '<div class="feature-rail"><div class="shell rail-inner"><div class="rail-item">' + icon('cube') + 'Digital-first catalogue</div><div class="rail-item">' + icon('credit') + 'Multiple ways to pay</div><div class="rail-item">' + icon('chat') + 'Discord support</div></div></div>' +
    (error ? '<div class="shell section">' + errorNotice(error) + '</div>' :
      (sectionEnabled('featured') ? section('01 / curated','Featured products','Discover the latest products selected by our store.',productGrid(featured,'No featured products yet','Featured items will appear when the store selects them.'),linkButton('/shop','View shop',false,'arrow')) : '') +
      (sectionEnabled('categories') ? section('02 / collections','Shop by category','Explore our catalogue by product category.',categoryCards(data.categories),linkButton('/categories','All categories',false,'arrow')) : '') +
      (sectionEnabled('latest') ? section('03 / new arrivals','Latest releases','See what’s new in the catalogue.',productGrid(latest,'No releases yet','New products will appear here as they go live.')) : '') +
      (sectionEnabled('best-sellers') ? section('04 / best sellers','Best sellers','Products with the most verified sales.',productGrid(best,'No sales to rank yet','Best sellers will appear once verified orders are recorded.')) : '') +
      (sectionEnabled('offers') ? section('05 / promotions','Special offers','See current discounts on products.',productGrid(offers,'No active offers','Current product offers will appear here.')) : '')) +
    (sectionEnabled('how-it-works') ? section('06 / ordering','How it works','Follow your purchase from cart to delivery.',processGrid()) : '') +
    (sectionEnabled('reviews') ? section('07 / feedback','Customer reviews','Read feedback from verified purchasers.',reviewCards(reviews.slice(0,3)),linkButton('/reviews','All reviews',false,'arrow')) : '') +
    (sectionEnabled('community') ? '<section class="section"><div class="shell"><div class="community"><div><span class="eyebrow">Discord community</span><h2>Connect with 303.</h2><p>Join the Discord for store updates, help with orders, and access to our support team.</p></div>' + discordButton('Join the community',true) + '</div></div></section>' : '') +
    (sectionEnabled('faq') ? section('09 / help','Frequently asked questions','Quick answers about payments, orders and delivery.',faqGrid(),linkButton('/support','Contact support',false,'arrow')) : '') +
    (sectionEnabled('newsletter') ? '<section class="section"><div class="shell">' + newsletter() + '</div></section>' : '');
}
function shopResults(data, form, withSuggestions = false) {
  const values = new FormData(form);
  const query = String(values.get('q') || '').trim().toLowerCase();
  const cat = String(values.get('category') || '');
  const sort = String(values.get('sort') || 'newest');
  const filtered = data.products.filter(product => (!cat || product.category_slug === cat) &&
    (!query || [product.name,product.description,product.category_name,...asArray(product.tags)].filter(Boolean).join(' ').toLowerCase().includes(query)));
  if (sort === 'price-low' || sort === 'price-high') filtered.sort((a,b) => (sort === 'price-high' ? -1 : 1) * (Number(a.sale_price ?? a.price) - Number(b.sale_price ?? b.price)));
  if (sort === 'name') filtered.sort((a,b) => String(a.name).localeCompare(String(b.name)));
  if (sort === 'popular') filtered.sort((a,b) => Number(b.sales || 0) - Number(a.sales || 0));
  const results = document.querySelector('#shop-results');
  if (results) results.innerHTML = '<p class="results-count">' + filtered.length + (filtered.length === 1 ? ' product' : ' products') + '</p>' + productGrid(filtered,'No products found',query || cat ? 'Try another search or category.' : 'Products will appear once published by the store.');
  const suggestions = document.querySelector('#shop-suggestions');
  if (suggestions) {
    const suggested = filtered.filter(product => String(product.name).toLowerCase().includes(query)).slice(0,5);
    suggestions.hidden = !(withSuggestions && query.length >= 2 && suggested.length);
    suggestions.innerHTML = suggestions.hidden ? '' : suggested.map(product => '<a href="/product/' + e(product.slug) + '">' + h(product.name) + '</a>').join('');
  }
}
function shop(data, query) {
  const category = query.get('category') || '';
  return page('Shop','The catalogue','Browse digital products and services. Find what you need by searching or filtering the catalogue.',
    '<form class="shop-filters" data-form="shop"><label class="field search-field"><span>Search products</span>' + icon('search') + '<input type="search" name="q" id="shop-search" autocomplete="off" placeholder="Search the catalogue…" value="' + h(query.get('q') || '') + '"><span class="search-suggestions" id="shop-suggestions" hidden></span></label><label class="field"><span>Category</span><select name="category"><option value="">All categories</option>' + data.categories.map(item => '<option value="' + h(item.slug) + '"' + (item.slug === category ? ' selected' : '') + '>' + h(item.name) + '</option>').join('') + '</select></label><label class="field"><span>Sort by</span><select name="sort"><option value="newest">Newest</option><option value="popular">Best sellers</option><option value="price-low">Price, low to high</option><option value="price-high">Price, high to low</option><option value="name">Name, A to Z</option></select></label></form><div id="shop-results" aria-live="polite"></div>');
}
function productDetails({product,reviews,related},canRequestReview) {
  const images = asArray(product.images).filter(image => asset(image.url));
  const variants = asArray(product.variants);
  const variant = variants.find(option => !soldOut(product,option)) || variants[0];
  const inventory = soldOut(product,variant);
  const maxQuantity = Math.min(50,variant?.stock ?? 50,product.stock ?? 50);
  const specs = product.details?.specs || product.details?.specifications;
  const details = typeof specs === 'string' ? specs : Object.entries(specs || {}).map(([label,value]) => label + '  ' + String(value)).join('\n');
  const instructions = product.purchase_instructions || product.instructions;
  const video = asset(product.details?.video || product.video || product.video_url);
  const content = '<div class="breadcrumb"><a href="#/">Home</a>' + icon('next') + '<a href="#/shop">Shop</a>' + icon('next') + '<span>' + h(product.name) + '</span></div><div class="detail-layout"><div><div class="detail-media" id="detail-media">' + visual(images[0]) + '</div>' +
    (images.length > 1 ? '<div class="media-thumbnails">' + images.map((image,index) => '<button type="button" data-action="product-image" data-url="' + h(asset(image.url)) + '" data-alt="' + h(image.alt || '') + '" aria-label="Show product image ' + (index + 1) + '" aria-pressed="' + (index === 0) + '"><img src="' + h(asset(image.url)) + '" alt="" width="70" height="49" loading="lazy"></button>').join('') + '</div>' : '') +
    (video ? '<p><a class="button button-small" href="' + h(video) + '" target="_blank" rel="noopener noreferrer">View product video ' + icon('external') + '</a></p>' : '') +
    '</div><div class="surface detail-info"><span class="badge">' + h(kindLabels[product.kind] || 'Product') + '</span><h1>' + h(product.name) + '</h1><div id="detail-price">' + displayPrice(product,variant) + '</div><p class="detail-description">' + h(product.description) + '</p>' +
    '<form data-form="add-cart" class="form-grid"><input type="hidden" name="productId" value="' + h(product.id) + '">' +
    (variants.length ? '<label class="field"><span>Variant</span><select name="variantId" required>' + variants.map(option => '<option value="' + h(option.id) + '"' + (option === variant ? ' selected' : '') + (soldOut(product,option) ? ' disabled' : '') + '>' + h(option.name + (soldOut(product,option) ? ' · sold out' : '')) + '</option>').join('') + '</select></label>' : '') +
    input('Quantity','quantity','number','min="1" max="' + (inventory ? 1 : maxQuantity) + '" step="1" required','1') +
    '<button type="submit" class="button button-primary button-wide"' + (inventory ? ' disabled' : '') + '>' + icon('bag') + ' ' + (inventory ? 'Sold out' : 'Add to cart') + '</button>' + formError() + '</form><div class="button-row"><button class="button button-small button-ghost" type="button" data-action="wishlist" data-id="' + h(product.id) + '">' + icon('heart') + ' Wishlist</button></div></div></div>' +
    '<div class="detail-sections">' + (details || instructions || asArray(product.tags).length ? '<div class="surface"><h2>Product details</h2>' + (details ? '<p class="prose">' + h(details) + '</p>' : '') + (instructions ? '<p class="prose">' + h(instructions) + '</p>' : '') + '<div class="detail-tags">' + asArray(product.tags).map(tag => '<span class="tag">' + h(tag) + '</span>').join('') + '</div></div>' : '') +
    '<section><div class="section-head"><h2>Customer reviews</h2></div>' + reviewCards(asArray(reviews)) + '</section>' +
    (canRequestReview ? reviewForm(product) : '') +
    (asArray(related).length ? '<section><div class="section-head"><h2>Related products</h2></div>' + productGrid(asArray(related),'No related products','') + '</section>' : '') + '</div>';
  updateTitle(product.name);
  return '<div class="shell page">' + content + '</div>';
}
function totalLines(cart) {
  return '<div class="summary-lines">' +
    [['Subtotal',cart.subtotal],['Discount',cart.discount ? -cart.discount : 0],['Tax',cart.tax],['Shipping',cart.shipping]].map(([label,value]) =>
      '<div class="summary-line"><span>' + label + '</span><strong>' + h(money(value || 0,cart.currency)) + '</strong></div>').join('') +
    '</div><div class="summary-total"><span>Total</span><strong>' + h(money(cart.total,cart.currency)) + '</strong></div>';
}
function lineItems(items, currency) {
  return '<div class="line-items">' + asArray(items).map(item => '<div><span>' + h(item.quantity + ' × ' + item.name + (item.variantName ? ' · ' + item.variantName : '')) + '</span><strong>' + h(money(item.lineTotal ?? item.unitPrice * item.quantity,item.currency || currency)) + '</strong></div>').join('') + '</div>';
}
function setCart(data) {
  state.cart = data.cart || data;
  const count = asArray(state.cart.items).reduce((total,item) => total + Number(item.quantity),0);
  cartCount.hidden = count === 0;
  cartCount.textContent = count;
  document.querySelector('.cart-trigger').setAttribute('aria-label',count ? 'Open shopping cart, ' + count + ' items' : 'Open shopping cart');
  if (cartDialog.open) renderCart();
  return state.cart;
}
async function loadCart() {
  if (!state.cartLoading) state.cartLoading = api('/cart').then(setCart).finally(() => { state.cartLoading = null; });
  return state.cartLoading;
}
function renderCart(message = '') {
  const cart = state.cart;
  const items = asArray(cart?.items);
  const top = '<div class="cart-top"><h2 id="cart-heading">Shopping cart</h2><button class="icon-button" type="button" data-action="close-cart" aria-label="Close cart">' + icon('close') + '</button></div>';
  if (!cart) {
    cartDialog.innerHTML = top + '<div class="cart-body">' + (message ? errorNotice(message) : '<p class="muted">Loading your cart…</p>') + '</div>';
    return;
  }
  if (!items.length) {
    cartDialog.innerHTML = top + '<div class="cart-body">' + empty('Your cart is empty','Add a product to get started.','bag') + '</div><div class="cart-bottom"><a class="button button-primary button-wide" href="#/shop">Browse products ' + icon('arrow') + '</a></div>';
    return;
  }
  const itemRows = items.map(item => {
    const unavailable = item.available === false || item.stock === 0;
    const max = Math.min(50,item.stock ?? 50);
    const id = h(item.id || item.itemId);
    const controls = unavailable ? '<span class="badge warning">Unavailable</span>' :
      input('Qty','quantity','number','min="1" max="' + max + '" step="1" required',item.quantity) + '<button type="submit" class="button button-small">Update</button>';
    return '<article class="cart-item"><div class="flex-between"><div><h3>' + (item.slug ? '<a href="/product/' + e(item.slug) + '">' + h(item.name) + '</a>' : h(item.name)) + '</h3><small class="muted">' + h(item.variantName || '') + '</small></div><strong>' + h(money(item.lineTotal,item.currency || cart.currency)) + '</strong></div>' +
      '<form class="cart-item-controls" data-form="cart-quantity" data-id="' + id + '">' + controls + '<button type="button" class="button button-small button-ghost" data-action="remove-cart" data-id="' + id + '">Remove</button></form></article>';
  }).join('');
  cartDialog.innerHTML = top + '<div class="cart-body">' + itemRows + (message ? errorNotice(message) : '') + '</div><div class="cart-bottom">' + totalLines(cart) + '<div class="button-row cart-checkout"><a href="#/checkout" class="button button-primary button-wide">Continue to checkout ' + icon('arrow') + '</a></div></div>';
}
async function openCart() {
  if (!cartDialog.open) cartDialog.showModal();
  renderCart();
  try { await loadCart(); } catch (error) { renderCart(error.message); }
}
function paymentKey(id) {
  return ({bitcoin:'btc',ethereum:'eth',litecoin:'ltc',solana:'sol'})[String(id).toLowerCase()] || String(id).toLowerCase();
}
function paymentIcon(id) {
  const key = paymentKey(id);
  const details = paymentAssets[key];
  return '<span class="payment-icon ' + (details ? key : '') + '">' + (details ? '<img src="/brand/' + details[0] + '.svg" alt="" width="21" height="21">' : icon('credit')) + '</span>';
}
function checkoutSteps(step) {
  return '<ol class="checkout-steps" aria-label="Checkout progress">' + ['Review order','Customer details','Payment method','Payment','Order status'].map((label,index) =>
    '<li' + (index === step - 1 ? ' aria-current="step"' : '') + '><span>' + (index + 1) + '</span>' + h(label) + '</li>').join('') + '</ol>';
}
function checkout(cart, methods, user) {
  const items = asArray(cart.items);
  if (!items.length) return page('Checkout','Secure checkout','',empty('Your cart is empty','Add something to your cart before checking out.','bag',linkButton('/shop','Browse products',true,'arrow')));
  const draft = state.checkoutDraft;
  const allowed = methods.filter(method => asArray(method.currencies).includes(cart.currency));
  const unavailable = items.some(item => item.available === false || (item.stock != null && item.stock < item.quantity));
  const activeMethod = allowed.some(method => method.id === draft.methodId) ? draft.methodId : allowed[0]?.id;
  const shipping = cart.requiresShipping ? '<div class="form-grid"><h3>Shipping address</h3>' +
    input('Street address','address1','text','autocomplete="address-line1" maxlength="150" required',draft.address1) +
    input('Apartment or suite (optional)','address2','text','autocomplete="address-line2" maxlength="150"',draft.address2) +
    '<div class="field-row">' + input('City','city','text','autocomplete="address-level2" maxlength="80" required',draft.city) +
    input('State or region','region','text','autocomplete="address-level1" maxlength="80"',draft.region) + '</div><div class="field-row">' +
    input('Postal code','postalCode','text','autocomplete="postal-code" maxlength="20" required',draft.postalCode) +
    input('Country code','country','text','autocomplete="country" maxlength="2" minlength="2" pattern="[A-Za-z]{2}" placeholder="US" required',draft.country) + '</div></div>' : '';
  const choices = allowed.length ? '<fieldset class="payment-options"><legend>Choose a payment method</legend>' + allowed.map(method => {
    const info = paymentAssets[paymentKey(method.id)];
    return '<label class="payment-option"><input type="radio" name="methodId" value="' + h(method.id) + '"' + (method.id === activeMethod ? ' checked' : '') + ' required>' +
      paymentIcon(method.id) + '<span><strong>' + h(method.name) + '</strong><small>' + h(method.network || info?.[1] || '') + '</small></span></label>';
  }).join('') + '</fieldset>' : '<p class="notice">No payment methods are currently available for this currency.</p>';
  const guestClosed = !user && state.store.guestCheckout === false;
  const form = state.store.maintenance ? '<div class="surface">' + errorNotice('Ordering is paused for store maintenance.') + '</div>' :
    guestClosed ? '<div class="surface stack"><h2>Sign in to checkout</h2><p class="muted">Sign in or create an account to complete your order.</p>' + linkButton('/account','Sign in',true,'arrow') + '</div>' :
    '<form data-form="checkout" class="surface form-grid"><h2>Customer information</h2><div class="field-row">' +
    input('Full name','customerName','text','autocomplete="name" required minlength="2" maxlength="120"',draft.customerName ?? user?.displayName ?? '') +
    input('Email address','email','email','autocomplete="email" required maxlength="254"',draft.email ?? user?.email ?? '') + '</div>' +
    shipping + '<hr class="divider">' + choices +
    (unavailable ? errorNotice('Update unavailable quantities in the cart to continue.') : '') +
    '<button type="submit" class="button button-primary button-wide"' + (allowed.length && !unavailable ? '' : ' disabled') + '>Create order ' + icon('arrow') + '</button>' + formError() + '</form>';
  const coupon = '<form class="form-grid" data-form="coupon"><div class="inline-form">' + input('Promo code','code','text','autocomplete="off" maxlength="40" placeholder="Enter code"',cart.coupon || '') + '<button type="submit" class="button">Apply</button></div>' +
    (cart.coupon ? '<button class="button button-small button-ghost" type="button" data-action="clear-coupon">Remove coupon</button>' : '') + (cart.couponError ? errorNotice(cart.couponError) : '') + formError() + '</form>';
  return page('Checkout','Secure checkout','Review your order and choose how to pay.',checkoutSteps(2) + '<div class="checkout-layout">' + form + '<aside class="surface summary"><div class="flex-between"><h2>Order summary</h2><button class="button button-small button-ghost" type="button" data-action="open-cart">Edit cart</button></div>' + lineItems(items,cart.currency) + totalLines(cart) + '<hr class="divider">' + coupon + '</aside></div>');
}
function statusBadge(status) {
  const code = String(status || '').toLowerCase();
  const css = ['paid','processing','completed'].includes(code) ? 'success' :
    ['awaiting_verification','payment_under_review','pending_payment','partially_refunded'].includes(code) ? 'warning' :
    ['cancelled','expired','refunded','disputed'].includes(code) ? 'danger' : 'neutral';
  return '<span class="badge ' + css + '">' + h(statusLabels[code] || code.replaceAll('_',' ') || 'Order received') + '</span>';
}
function copyButton(value, label = 'Copy') {
  return '<button type="button" class="button button-small" data-action="copy" data-value="' + h(value) + '">' + icon('copy') + ' ' + h(label) + '</button>';
}
function invoiceRow(invoiceId) {
  return '<div class="invoice-row"><span class="muted">Invoice</span><code>' + h(invoiceId) + '</code>' + copyButton(invoiceId) + '</div>';
}
const revolutCopy = 'Complete your payment through Revolut using the recipient Revtag shown above. Once your transfer is complete, submit your payment reference and contact our support team with your invoice ID so we can verify your payment and process your order.';
const verificationCopy = 'Thank you for shopping with 303 Services/Shop. Once you’ve sent your payment, please open a ticket in our Discord server and provide your invoice ID along with your payment confirmation. Our team will review your payment and update your order accordingly.';
const submittedCopy = 'Thank you for your order. Your payment details have been submitted for verification. To help us process your purchase, please open a support ticket on our Discord server and include your invoice ID along with your payment confirmation.';
function delivery(order) {
  const items = asArray(order.items);
  const deliverables = items.flatMap(item => [
    ...asArray(item.assets).map(file => {
      const url = asset(file.url);
      const link = url ? '<a class="button button-small" href="' + h(url) + '">' + icon('download') + ' Download</a>' :
        '<span class="badge neutral">Download limit reached</span>';
      return '<div class="notice flex-between"><div><strong>' + h(file.filename) + '</strong><br><small>' + h(item.name) + (file.downloadLimit ? ' · ' + h(file.used ?? 0) + ' / ' + h(file.downloadLimit) + ' downloads used' : '') + '</small></div>' + link + '</div>';
    }),
    ...asArray(item.licenses).map(license => typeof license === 'string' ? license : license.key || license.value).filter(Boolean).map(key => '<div class="notice"><strong>' + h(item.name) + ' license key</strong><div class="payment-destination"><code>' + h(key) + '</code>' + copyButton(key) + '</div></div>'),
  ]);
  const notes = order.fulfillmentNote || order.fulfillment_note || order.deliveryInstructions;
  if (notes) deliverables.push('<div class="notice prose">' + h(notes) + '</div>');
  return deliverables.length ? '<section class="surface stack"><h2>Your purchase</h2>' + deliverables.join('') + '</section>' : '';
}
function orderPage(order, providerError = '') {
  const id = order.id;
  const method = order.methodId || order.method_id;
  const key = paymentKey(method);
  const invoiceId = order.invoiceId || order.invoice_id;
  const status = String(order.status || '').toLowerCase();
  const pending = status === 'pending_payment';
  const submitted = ['awaiting_verification','payment_under_review'].includes(status);
  const expiresAt = new Date(order.expiresAt);
  const expired = pending && (order.canPay === false || (order.expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()));
  const details = paymentAssets[key];
  const displayName = order.name || order.methodName || details?.[1] || 'Payment';
  const qr = typeof order.qrDataUrl === 'string' && /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(order.qrDataUrl) ? order.qrDataUrl : '';
  const refresh = '<button type="button" class="button button-small" data-action="refresh-order">Refresh status</button>';
  let panel = '';
  if (pending && !expired && key === 'paypal') {
    panel = '<div class="surface stack"><div class="pay-head">' + paymentIcon(method) + '<h2>PayPal checkout</h2></div>' +
      (providerError ? errorNotice(providerError) : '') +
      '<p class="muted">Continue to PayPal to approve this commercial purchase. Your order updates after PayPal confirms the capture.</p><div class="button-row"><button class="button button-primary" type="button" data-action="paypal-start" data-id="' + h(id) + '">Continue to PayPal ' + icon('external') + '</button>' + refresh + '</div></div>';
  } else if (pending && !expired && key !== 'paypal') {
    const amount = order.cryptoAmount ? String(order.cryptoAmount) + ' ' + (details?.[1] || '') : money(order.total,order.currency);
    const destination = order.destination || '';
    panel = '<div class="surface stack"><div class="pay-head">' + paymentIcon(method) + '<h2>' + h(displayName) + '</h2></div>' +
      '<div class="summary-line"><span>Amount due</span><strong>' + h(amount) + '</strong></div>' +
      (order.network ? '<div class="notice"><strong>Network</strong> ' + h(order.network) + '<br>Send funds only on the network shown above.</div>' : '') +
      '<div><div class="kicker">' + (key === 'revolut' ? 'Send your payment to' : 'Receiving address') + '</div><div class="payment-destination"><code>' + h(destination) + '</code>' + copyButton(destination,key === 'revolut' ? 'Copy Revtag' : 'Copy address') + '</div>' +
      (qr ? '<img class="payment-qr" src="' + h(qr) + '" alt="Payment address QR code" width="150" height="150">' : '') + '</div>' +
      (order.expiresAt ? '<p class="form-note">' + icon('clock') + ' Invoice expires ' + h(date(order.expiresAt,true)) + '.</p>' : '') +
      (order.confirmations ? '<p class="form-note">The store checks for at least ' + h(order.confirmations) + ' network ' + (Number(order.confirmations) === 1 ? 'confirmation.' : 'confirmations.') + '</p>' : '') +
      '<p class="prose">' + h(key === 'revolut' ? revolutCopy : order.instructions || verificationCopy) + '</p>' +
      (key === 'revolut' && order.instructions && order.instructions !== revolutCopy ? '<p class="prose">' + h(order.instructions) + '</p>' : '') +
      '<form class="form-grid" data-form="payment-submit" data-id="' + h(id) + '">' +
      input(key === 'revolut' ? 'Revolut transaction reference' : 'Transaction hash','reference','text','autocomplete="off" minlength="4" maxlength="160" required') +
      '<label class="field"><span>Upload a receipt (optional)</span><input name="receipt" type="file" accept="image/png,image/jpeg,application/pdf"><small class="form-note">PNG, JPEG or PDF. Maximum 4 MB.</small></label>' +
      '<button class="button button-primary" type="submit">I completed the purchase ' + icon('arrow') + '</button>' + formError() + '</form></div>' +
      '<div class="surface"><span class="eyebrow">Payment verification</span><p>' + h(verificationCopy) + '</p>' + discordButton('Open support ticket') + '</div>';
  } else if (submitted) {
    panel = '<section class="surface stack"><span class="card-icon">' + icon('receipt') + '</span><h2>Payment submitted</h2><p class="muted">' + h(submittedCopy) + '</p>' + invoiceRow(invoiceId) +
      (order.lastSubmission?.reference ? '<p class="form-note break-word">Submitted reference ' + h(order.lastSubmission.reference) + '</p>' : '') +
      '<div class="button-row">' + discordButton('Open Discord support',true) + refresh + '</div></section>';
  } else if (pending && expired) {
    panel = '<div class="surface stack"><h2>Invoice payment window ended</h2><p class="muted">Open a support request if you already sent a transfer. Include this invoice ID and your transaction reference.</p><div class="button-row">' + discordButton('Open Discord support') + refresh + '</div></div>';
  } else {
    panel = '<div class="surface stack"><h2>Order status</h2><div>' + statusBadge(status) + '</div><div class="button-row">' + refresh + discordButton('Discord support') + '</div></div>' + delivery(order);
  }
  return page('Order ' + invoiceId,'Order tracking','Follow the payment and fulfillment of this order.',checkoutSteps(pending && !expired ? 4 : 5) +
    '<div class="checkout-layout"><div class="stack">' + panel + '</div><aside class="surface summary stack"><div class="flex-between"><h2>Invoice summary</h2>' + statusBadge(status) + '</div>' + invoiceRow(invoiceId) +
    '<p class="form-note">Created ' + h(date(order.createdAt || order.created_at,true)) + '</p>' + lineItems(order.items,order.currency) + totalLines(order) +
    '<a class="button" href="/api/orders/' + e(id) + '/invoice.pdf">' + icon('download') + ' Download invoice</a>' +
    (order.canCancel ? '<button class="button button-small button-ghost" data-action="cancel-order" data-id="' + h(id) + '" type="button">Cancel order</button>' : '') +
    '</aside></div>');
}
function orderLinks(orders) {
  if (!orders.length) return empty('No orders yet','Orders placed in this session or account will appear here.','receipt');
  return '<div class="order-list">' + orders.map(order => {
    const invoice = order.invoiceId || order.invoice_id;
    return '<a href="#/orders/' + e(order.id || invoice) + '"><div><strong>' + h(invoice) + '</strong><br><small class="muted">' + h(date(order.createdAt || order.created_at)) + '</small></div><strong>' + h(money(order.total,order.currency)) + '</strong>' + statusBadge(order.status) + '</a>';
  }).join('') + '</div>';
}
function trackPage(orders) {
  return page('Track an order','Order tracking','Enter your invoice ID from the browser or account you used to place the order.','<div class="account-layout"><div class="surface stack"><h2>Your orders</h2>' + orderLinks(orders) + '</div><form class="surface form-grid" data-form="track"><h2>Find an invoice</h2>' + input('Invoice ID','invoice','text','autocomplete="off" maxlength="80" required placeholder="303-2026-000001"') + '<button class="button button-primary" type="submit">Track order ' + icon('arrow') + '</button>' + formError() + '</form></div>');
}
function support(query) {
  const invoice = query.get('invoice') || '';
  const form = '<form class="surface form-grid" data-form="support"><h2>Send a support request</h2>' +
    input('Email address','email','email','autocomplete="email" maxlength="254" required',state.user?.email) +
    input('Subject','subject','text','minlength="4" maxlength="150" required') +
    '<div class="field-row"><label class="field"><span>Category</span><select name="category"><option value="general">General question</option><option value="order">Order</option><option value="payment">Payment</option><option value="delivery">Delivery</option></select></label>' +
    input('Invoice ID (optional)','invoiceId','text','maxlength="70" autocomplete="off"',invoice) + '</div>' +
    '<label class="field"><span>Message</span><textarea name="message" minlength="10" maxlength="4000" required placeholder="How can we help?"></textarea></label>' +
    '<button type="submit" class="button button-primary">Submit request ' + icon('arrow') + '</button>' + formError() + '</form>';
  const help = '<div class="surface stack"><span class="card-icon">' + icon('chat') + '</span><h2>Discord support</h2><p class="muted">For help with a payment or purchase, open a support ticket in Discord. Include your invoice ID so our team can find your order.</p><div>' + discordButton('Open Discord support') + '</div><hr class="divider">' + linkButton('/faq','Read the FAQ',false,'arrow') + linkButton('/orders','Track an order',false,'arrow') + '</div>';
  return page('Support','How can we help?','Contact the store about your order, delivery or payment.', '<div class="support-layout">' + form + help + '</div>');
}
function authPanel(query, message = '') {
  const resetToken = query.get('reset');
  const mode = resetToken ? 'reset' : query.get('mode') || 'login';
  const back = '<a class="button button-small button-ghost" href="#/account">Back to sign in</a>';
  let form = '';
  if (mode === 'reset') {
    form = '<form class="form-grid" data-form="reset"><h2>Choose a new password</h2><input type="hidden" name="token" value="' + h(resetToken) + '">' + input('New password','password','password','autocomplete="new-password" minlength="14" maxlength="128" required') + '<button class="button button-primary" type="submit">Update password</button>' + formError() + back + '</form>';
  } else if (mode === 'forgot') {
    form = '<form class="form-grid" data-form="forgot"><h2>Reset your password</h2>' + input('Email address','email','email','autocomplete="email" maxlength="254" required') + '<button class="button button-primary" type="submit">Request reset link</button>' + formError() + back + '</form>';
  } else if (mode === 'register') {
    form = '<form class="form-grid" data-form="register"><h2>Create an account</h2>' + input('Email address','email','email','autocomplete="email" maxlength="254" required') +
      input('Username','username','text','autocomplete="username" minlength="3" maxlength="32" required') +
      input('Password','password','password','autocomplete="new-password" minlength="14" maxlength="128" required') +
      '<p class="form-note">Use at least 14 characters.</p><button class="button button-primary" type="submit">Create account ' + icon('arrow') + '</button>' + formError() + back + '</form>';
  } else {
    form = '<form class="form-grid" data-form="login"><h2>Sign in</h2>' + input('Email or username','login','text','autocomplete="username" maxlength="254" required') +
      input('Password','password','password','autocomplete="current-password" maxlength="128" required') +
      '<button class="button button-primary" type="submit">Sign in ' + icon('arrow') + '</button>' + formError() +
      '<div class="button-row"><a class="button button-small" href="#/account?mode=register">Create account</a><a class="button button-small button-ghost" href="#/account?mode=forgot">Forgot password?</a></div></form>';
  }
  return page('Your account','Customer portal','Access your orders, downloads and wishlist.', '<div class="account-layout"><div class="surface">' + (message ? '<p class="notice">' + h(message) + '</p>' : '') + form + '</div><aside class="surface stack"><span class="card-icon">' + icon('receipt') + '</span><h2>Ordered as a guest?</h2><p class="muted">You can track an order from the same browser used to place it.</p>' + linkButton('/orders','Track an order',false,'arrow') + '</aside></div>');
}
function recentRead() {
  try { return asArray(JSON.parse(localStorage.getItem('303.recent') || '[]')); } catch { return []; }
}
function recentAdd(slug) {
  try { localStorage.setItem('303.recent',JSON.stringify([slug,...recentRead().filter(item => item !== slug)].slice(0,6))); } catch {}
}
function preferencesPanel(preferences = {}) {
  return '<form class="form-grid" data-form="preferences"><h2>Notification preferences</h2>' +
    '<label class="checkbox-label"><input type="checkbox" name="newsletter"' + (preferences.newsletter ? ' checked' : '') + '> Newsletter</label>' +
    '<label class="checkbox-label"><input type="checkbox" name="productUpdates"' + (preferences.productUpdates ? ' checked' : '') + '> Product updates</label>' +
    '<button type="submit" class="button">Save preferences</button>' + formError() + '</form>';
}
function supportHistory(tickets) {
  return tickets.length ? '<div class="stack">' + tickets.map(ticket =>
    '<article class="notice"><div class="flex-between"><strong>' + h(ticket.subject) + '</strong><span class="badge neutral">' + h(ticket.status.replaceAll('_',' ')) + '</span></div>' +
    '<small>' + h(date(ticket.created_at)) + (ticket.invoice_id ? ' · ' + h(ticket.invoice_id) : '') + '</small>' +
    (ticket.reply ? '<div class="owner-reply"><strong>Store response</strong><p class="prose">' + h(ticket.reply) + '</p></div>' : '') + '</article>').join('') + '</div>' :
    empty('No support requests','Requests made while signed in will appear here.','chat');
}
function accountPage(data, message = '') {
  const user = data.user || state.user;
  const list = asArray(data.wishlist);
  const orders = asArray(data.orders);
  const recent = recentRead().map(slug => state.catalog?.products.find(product => product.slug === slug)).filter(Boolean);
  const greeting = user.username ? 'Welcome, ' + user.username + '.' : 'Welcome back.';
  const content = (message ? '<p class="notice">' + h(message) + '</p>' : '') + '<div class="account-layout"><div class="stack"><section class="surface stack"><h2>Order history</h2>' + orderLinks(orders) + '</section><section class="surface stack"><div class="flex-between"><h2>Support requests</h2>' + linkButton('/support','New request') + '</div>' + supportHistory(asArray(data.tickets)) + '</section></div><aside class="surface stack"><span class="card-icon">' + icon('user') + '</span><h2>Account details</h2><p class="break-word">' + h(user.email) + '</p><div>' + (user.verifiedAt ? '<span class="badge success">' + icon('check') + 'Email verified</span>' : '<span class="badge warning">Email verification pending</span>') + '</div>' +
    (!user.verifiedAt ? '<button class="button button-small" type="button" data-action="resend-verification">Resend verification email</button>' : '') +
    (['owner','staff'].includes(user.role) ? '<a class="button" href="/admin">303 Control Center ' + icon('arrow') + '</a>' : '') +
    '<button type="button" class="button" data-action="logout">Sign out</button><hr class="divider">' + preferencesPanel(data.preferences) + '</aside></div><div class="detail-sections"><section><div class="section-head"><h2>Wishlist</h2></div>' + productGrid(list,'Your wishlist is empty','Save products from their detail pages to find them here later.') + '</section>' +
    (recent.length ? '<section><div class="section-head"><h2>Recently viewed</h2></div>' + productGrid(recent,'No recently viewed products','') + '</section>' : '') + '</div>';
  return page('Your account','Customer portal',greeting,content);
}
function reviewForm(product) {
  return '<form class="surface form-grid" data-form="review" data-id="' + h(product.id) + '"><h2>Review this product</h2><p class="form-note">Verified purchasers can leave one review per product.</p>' +
    '<label class="field"><span>Rating</span><select name="rating" required><option value="">Select a rating</option><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select></label>' +
    '<label class="field"><span>Review</span><textarea name="body" minlength="5" maxlength="2000" required></textarea></label><button class="button button-primary" type="submit">Submit review</button>' + formError() + '</form>';
}
let selectedProduct = null;
let verifyMessage = '';
let attemptedVerifyToken = null;
function active(path) {
  const navPath = path.startsWith('/product/') ? '/shop' : path;
  document.querySelectorAll('[data-nav]').forEach(anchor => {
    if (anchor.dataset.nav === navPath) anchor.setAttribute('aria-current','page');
    else anchor.removeAttribute('aria-current');
  });
}
async function identify() {
  state.user = (await api('/me')).user;
  return state.user;
}
async function render({preserve = false, focus = false} = {}) {
  const {path,query} = route();
  const sequence = ++state.page;
  state.route = {path,query};
  selectedProduct = null;
  active(path);
  let content = '';
  main.setAttribute('aria-busy','true');
  if (!preserve) window.scrollTo({top:0,behavior:'instant'});
  try {
    if (path === '/') {
      const [data,reviews] = await Promise.allSettled([catalog(),api('/reviews')]);
      content = home(data.status === 'fulfilled' ? data.value : {products:[],categories:[]},
        reviews.status === 'fulfilled' ? asArray(reviews.value.reviews) : [],data.status === 'rejected' ? 'The catalogue is temporarily unavailable. Please check back shortly.' : '');
    } else if (path === '/shop') {
      content = shop(await catalog(),query);
    } else if (path === '/categories') {
      const data = await catalog();
      content = page('Categories','Collections','Explore the catalogue by collection.',categoryCards(data.categories));
    } else if (path === '/reviews') {
      const data = await api('/reviews');
      content = page('Customer reviews','Verified purchase feedback','Read reviews from people who bought from 303 Services/Shop.',reviewCards(asArray(data.reviews)));
    } else if (path === '/faq') {
      const result = await api('/legal/faq').catch(() => ({}));
      content = page(result.title || 'Frequently asked questions','Help centre','',result.body ? '<div class="surface prose">' + h(result.body) + '</div>' : faqGrid());
    } else if (path === '/support') {
      await identify().catch(() => {});
      content = support(query);
    } else if (path === '/checkout') {
      const [cart,methods,user] = await Promise.all([loadCart(),api('/payment-methods'),identify().catch(() => null),catalog().catch(() => {})]);
      content = checkout(cart,asArray(methods.methods),user);
    } else if (path === '/orders') {
      const data = await api('/orders');
      content = trackPage(asArray(data.orders));
    } else if (path.startsWith('/orders/')) {
      const id = decodeURIComponent(path.slice(8));
      let providerError = '';
      let data;
      const action = state.payReturn;
      if (action && action.order === id) {
        state.payReturn = null;
        if (action.mode === 'return') {
          try { data = await post('/orders/' + e(id) + '/paypal/capture'); }
          catch (error) { providerError = error.message; }
        }
        if (action.mode === 'cancel') providerError = 'PayPal checkout was cancelled. You can try again.';
      }
      data ??= await api('/orders/' + e(id));
      content = orderPage(data.order || data,providerError);
    } else if (path.startsWith('/product/')) {
      const slug = decodeURIComponent(path.slice(9));
      const [data,user] = await Promise.all([api('/catalog/' + e(slug)),identify().catch(() => null)]);
      recentAdd(slug);
      if (sequence === state.page) selectedProduct = data.product;
      content = productDetails(data, Boolean(user?.verifiedAt));
    } else if (path === '/account') {
      const token = query.get('verify');
      if (token && attemptedVerifyToken !== token) {
        attemptedVerifyToken = token;
        try { await post('/auth/verify',{token}); verifyMessage = 'Your email has been verified.'; }
        catch (error) { verifyMessage = error.message; }
        if (location.hash.startsWith('#/')) history.replaceState(null,'',location.pathname + '#/account');
        else history.replaceState(null,'',location.pathname);
      }
      const user = await identify();
      if (user && !query.get('reset')) {
        await catalog().catch(() => {});
        content = accountPage(await api('/account'),verifyMessage);
      } else {
        content = authPanel(query,verifyMessage);
      }
      verifyMessage = '';
    } else if (path.startsWith('/legal/')) {
      const result = await api('/legal/' + e(decodeURIComponent(path.slice(7))));
      content = page(result.title || 'Store policy','Store policies','',result.body ? '<div class="surface prose">' + h(result.body) + '</div>' : empty('Policy pending','The store has not published this policy.','receipt',linkButton('/support','Contact support')));
    } else {
      content = page('Page not found','303 Services/Shop','',empty('This page is unavailable','Return to the store to keep browsing.','cube',linkButton('/shop','View shop',true)));
    }
  } catch (error) {
    if (sequence !== state.page) return;
    const title = path.startsWith('/orders/') ? 'Order unavailable' : 'Something went wrong';
    content = page(title,'303 Services/Shop','',errorNotice(error.message) + '<div class="button-row"><button class="button" type="button" data-action="refresh-order">Try again</button>' + linkButton(path.startsWith('/orders/') ? '/orders' : '/shop',path.startsWith('/orders/') ? 'Track an order' : 'View shop') + '</div>');
  }
  if (sequence !== state.page) return;
  main.innerHTML = content;
  main.removeAttribute('aria-busy');
  if (path === '/shop') {
    const form = document.querySelector('[data-form="shop"]');
    if (form && state.catalog) shopResults(state.catalog,form);
    if (query.get('search') === '1') document.querySelector('#shop-search')?.focus();
    else if (focus) main.focus({preventScroll:true});
  } else if (focus) {
    main.focus({preventScroll:true});
  }
}
function closeMobile() {
  document.querySelector('.site-nav').classList.remove('open');
  const toggle = document.querySelector('.mobile-menu');
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-label','Open navigation');
}
function checkoutValues(form) {
  return Object.fromEntries(new FormData(form));
}
function idempotency(details) {
  const fingerprint = JSON.stringify([asArray(state.cart?.items).map(item => [item.id,item.quantity,item.unitPrice]),state.cart?.coupon,details]);
  if (state.lastCheckout?.fingerprint === fingerprint) return state.lastCheckout.key;
  const key = crypto.randomUUID();
  state.lastCheckout = {fingerprint,key};
  return key;
}
async function receiptData(file) {
  if (!(file instanceof File) || !file.size) return undefined;
  if (file.size > 4 * 1024 * 1024) throw new Error('Choose a receipt no larger than 4 MB.');
  if (!['image/png','image/jpeg','application/pdf'].includes(file.type)) throw new Error('Upload a PNG, JPEG or PDF receipt.');
  const data = await new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('The receipt could not be read.'));
    reader.readAsDataURL(file);
  });
  return {filename:file.name,mime:file.type,data};
}
async function action(button) {
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case 'open-cart':
      return openCart();
    case 'close-cart':
      return cartDialog.close();
    case 'mobile-menu': {
      const open = document.querySelector('.site-nav').classList.toggle('open');
      button.setAttribute('aria-expanded',String(open));
      button.setAttribute('aria-label',open ? 'Close navigation' : 'Open navigation');
      return;
    }
    case 'remove-cart':
      setCart(await api('/cart/items/' + e(id),{method:'DELETE'}));
      if (state.route.path === '/checkout') await render({preserve:true});
      return;
    case 'clear-coupon':
      setCart(await post('/cart/coupon',{code:''}));
      await render({preserve:true});
      notify('Coupon removed.');
      return;
    case 'product-image':
      document.querySelector('#detail-media').innerHTML = visual({url:button.dataset.url,alt:button.dataset.alt});
      document.querySelectorAll('[data-action="product-image"]').forEach(option => option.setAttribute('aria-pressed',String(option === button)));
      return;
    case 'wishlist': {
      if (!state.user) return go('/account');
      const data = await post('/account/wishlist',{productId:id});
      const saved = data.saved ?? data.added;
      if (saved != null) button.setAttribute('aria-pressed',String(Boolean(saved)));
      notify(saved === false ? 'Removed from your wishlist.' : saved === true ? 'Saved to your wishlist.' : 'Wishlist updated.');
      return;
    }
    case 'copy':
      if (!navigator.clipboard) throw new Error('Select and copy the text from this page.');
      await navigator.clipboard.writeText(button.dataset.value);
      notify('Copied to clipboard.');
      return;
    case 'refresh-order':
      return render({preserve:true});
    case 'paypal-start': {
      const {approvalUrl} = await post('/orders/' + e(id) + '/paypal/start');
      const url = new URL(approvalUrl);
      if (url.protocol !== 'https:' || (url.hostname !== 'paypal.com' && !url.hostname.endsWith('.paypal.com'))) throw new Error('PayPal returned an invalid approval link.');
      location.assign(url.href);
      return;
    }
    case 'cancel-order':
      if (!window.confirm('Cancel this unpaid order?')) return;
      await post('/orders/' + e(id) + '/cancel');
      notify('Order cancelled.');
      await render({preserve:true});
      return;
    case 'logout':
      await post('/auth/logout');
      state.user = null;
      state.cart = null;
      await loadCart().catch(() => {});
      notify('You are signed out.');
      return render();
    case 'resend-verification':
      await post('/auth/resend');
      notify('A verification link was requested.');
      return;
    default:
      return undefined;
  }
}
async function submit(form) {
  const type = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  switch (type) {
    case 'shop': {
      const suggestions = document.querySelector('#shop-suggestions');
      if (suggestions) suggestions.hidden = true;
      shopResults(state.catalog,form);
      return;
    }
    case 'newsletter':
      await post('/newsletter',{email:data.email});
      form.reset();
      notify('You signed up for store updates.');
      return;
    case 'support': {
      const result = await post('/support',{email:data.email,subject:data.subject,category:data.category,message:data.message,invoiceId:data.invoiceId || undefined});
      form.reset();
      const reference = result.reference || result.ticket?.id || result.ticketId;
      notify(reference ? 'Support request received. Reference ' + reference : 'Support request received.');
      return;
    }
    case 'add-cart':
      setCart(await post('/cart/items',{productId:data.productId,variantId:data.variantId || undefined,quantity:Number(data.quantity)}));
      await openCart();
      notify('Added to your cart.');
      return;
    case 'cart-quantity':
      setCart(await api('/cart/items/' + e(form.dataset.id),{method:'PATCH',body:{quantity:Number(data.quantity)}}));
      if (state.route.path === '/checkout') await render({preserve:true});
      return;
    case 'coupon':
      setCart(await post('/cart/coupon',{code:data.code}));
      notify(state.cart.coupon ? 'Coupon applied.' : 'Coupon removed.');
      return render({preserve:true});
    case 'checkout': {
      const {email,customerName,methodId,address1,address2,city,region,postalCode,country} = data;
      const details = {email,customerName,methodId,coupon:state.cart?.coupon || undefined,...(state.cart?.requiresShipping ? {
        shippingAddress:{address1,address2:address2 || undefined,city,region:region || undefined,postalCode,country:country.toUpperCase()}
      } : {})};
      const {order} = await post('/checkout',{...details,idempotencyKey:idempotency(details)});
      state.checkoutDraft = {};
      await loadCart().catch(() => {});
      go('/orders/' + e(order.id || order.invoiceId));
      return;
    }
    case 'payment-submit': {
      const receipt = await receiptData(data.receipt);
      await post('/orders/' + e(form.dataset.id) + '/submit',{reference:data.reference,receipt});
      notify('Payment details submitted for verification.');
      return render({preserve:true});
    }
    case 'track':
      await api('/orders/' + e(data.invoice.trim()));
      go('/orders/' + e(data.invoice.trim()));
      return;
    case 'login':
      await post('/auth/login',{login:data.login,password:data.password});
      notify('You are signed in.');
      await loadCart().catch(() => {});
      return render();
    case 'register':
      await post('/auth/register',{email:data.email,username:data.username,password:data.password});
      notify('Account created. Check your inbox for a verification link.');
      return go('/account');
    case 'forgot':
      await post('/auth/forgot',{email:data.email});
      form.reset();
      notify('If an account matches that email, a reset link will be sent.');
      return;
    case 'reset':
      await post('/auth/reset',{token:data.token,password:data.password});
      history.replaceState(null,'','/#/account');
      notify('Password updated. You can sign in with your new password.');
      return render();
    case 'review':
      await post('/account/reviews',{productId:form.dataset.id,rating:Number(data.rating),body:data.body});
      form.reset();
      notify('Review submitted.');
      return render({preserve:true});
    case 'preferences':
      await post('/account/preferences',{newsletter:data.newsletter === 'on',productUpdates:data.productUpdates === 'on'});
      notify('Preferences saved.');
      return;
    default:
      return undefined;
  }
}
document.addEventListener('submit',async event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const button = event.submitter;
  if (form.dataset.busy === 'true') return;
  form.dataset.busy = 'true';
  if (button) button.disabled = true;
  const failure = form.querySelector('.form-error');
  if (failure) failure.textContent = '';
  try { await submit(form); }
  catch (error) {
    if (failure) failure.textContent = error.message;
    else notify(error.message,true);
  } finally {
    delete form.dataset.busy;
    if (button) button.disabled = false;
  }
});
document.addEventListener('click',async event => {
  const link = event.target.closest('a[href^="#/"]');
  if (link) {
    closeMobile();
    if (cartDialog.open) cartDialog.close();
    if (link.getAttribute('href') === location.hash) { event.preventDefault(); await render({focus:true}); }
  }
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const immediate = ['mobile-menu','open-cart','close-cart','product-image','copy'].includes(button.dataset.action);
  if (!immediate) button.disabled = true;
  try { await action(button); } catch (error) { notify(error.message,true); }
  finally { if (!immediate) button.disabled = false; }
});
document.addEventListener('input',event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  if (form.dataset.form === 'shop' && state.catalog) shopResults(state.catalog,form,event.target.name === 'q');
  if (form.dataset.form === 'checkout') state.checkoutDraft = checkoutValues(form);
});
document.addEventListener('change',event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  if (form.dataset.form === 'add-cart' && event.target.name === 'variantId' && selectedProduct) {
    const variant = asArray(selectedProduct.variants).find(option => String(option.id) === event.target.value);
    document.querySelector('#detail-price').innerHTML = displayPrice(selectedProduct,variant);
    const quantity = form.elements.quantity;
    quantity.max = String(Math.min(50,variant?.stock ?? 50,selectedProduct.stock ?? 50));
    quantity.value = String(Math.min(Number(quantity.value),Number(quantity.max)));
  }
  if (form.dataset.form === 'checkout' && event.target.name === 'methodId') {
    document.querySelectorAll('.checkout-steps li').forEach((step,index) => {
      if (index === 2) step.setAttribute('aria-current','step');
      else step.removeAttribute('aria-current');
    });
  }
});
cartDialog.addEventListener('click',event => {
  if (event.target === cartDialog) cartDialog.close();
});
document.querySelector('.skip-link').addEventListener('click',event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener('hashchange',() => render({focus:true}));
window.addEventListener('keydown',event => {
  if (event.key === 'Escape') {
    closeMobile();
    const suggestions = document.querySelector('#shop-suggestions');
    if (suggestions) suggestions.hidden = true;
  }
});
renderFooter();
const search = new URLSearchParams(location.search);
if (search.get('order') && ['return','cancel'].includes(search.get('paypal'))) {
  state.payReturn = {order:search.get('order'),mode:search.get('paypal')};
  history.replaceState(null,'','/#/orders/' + e(state.payReturn.order));
}
loadCart().catch(() => {});
catalog().catch(() => {});
render();
