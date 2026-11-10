import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { adminRouter } from './admin.js';
import { authRouter,customer,identity,owner,reauth,rate } from './auth.js';
import { commerceRouter } from './commerce.js';
import { HttpError,escapeHtml } from './http.js';
import { audit,notify } from './notifications.js';
import { configureSecurity } from './security.js';
import { checkLaunch,legalTitles,products,publicStore,storeRouter,storeState } from './store.js';

const publicDir = fileURLToPath(new URL('../public/',import.meta.url));
const paypalWebhook = '/api/webhooks/paypal';
const assetUrl = value => typeof value === 'string' && (/^\/(?!\/)/.test(value) || /^https:\/\//.test(value)) ? value : '';
const adminUser = req => req.user?.role === 'owner' && req.user.mfaAt;
const brandDescription = 'Discover a new standard in digital products and services. Premium quality, effortless ordering, and a shopping experience designed around you.';

export function buildApp({db,config}) {
  configureSecurity(config);
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY_HOPS) app.set('trust proxy',Number(config.TRUST_PROXY_HOPS));
  app.use((req,res,next) => {
    req.requestId = randomUUID();
    res.set('X-Request-ID',req.requestId);
    next();
  });
  app.use(helmet({
    strictTransportSecurity:config.production ? undefined : false,
    crossOriginEmbedderPolicy:false,
    contentSecurityPolicy:{ directives:{
      defaultSrc:["'self'"], scriptSrc:["'self'"], scriptSrcAttr:["'none'"],
      styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],
      fontSrc:["'self'",'https://fonts.gstatic.com','data:'],
      imgSrc:["'self'",'data:','blob:','https:'], mediaSrc:["'self'",'https:','blob:'],
      connectSrc:["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"],
      baseUri:["'self'"], formAction:["'self'"], upgradeInsecureRequests:config.production ? [] : null
    }},
    referrerPolicy:{policy:'no-referrer'}
  }));
  app.use((_req,res,next) => {
    res.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  app.get('/healthz',async (_req,res) => {
    await db.query('SELECT 1');
    res.set('Cache-Control','no-store').json({status:'ok'});
  });
  app.use('/api',(req,res,next) => {
    res.set('Cache-Control','no-store');
    if (['GET','HEAD','OPTIONS'].includes(req.method) || (req.method==='POST' && req.originalUrl.split('?')[0]===paypalWebhook)) return next();
    const origin = req.get('origin');
    if (origin!==config.APP_URL || req.get('sec-fetch-site')==='cross-site') {
      return next(new HttpError(403,'This request must come from the store.'));
    }
    next();
  });
  app.use(express.json({limit:'8mb',verify(req,_res,buffer) {
    if (req.originalUrl.split('?')[0]===paypalWebhook) req.rawBody = Buffer.from(buffer);
  }}));
  app.use(cookieParser(config.cookieSecret));

  app.get(['/admin.html','/admin','/admin/*rest'],identity(db,config),(req,res) => {
    res.set('Cache-Control','no-store').set('X-Robots-Tag','noindex');
    if (req.path==='/admin.html') return res.redirect(302,'/admin');
    if (!adminUser(req) && req.path!=='/admin/login') return res.redirect(302,'/admin/login');
    res.sendFile('admin.html',{root:publicDir});
  });
  app.use(express.static(publicDir,{ index:false, dotfiles:'deny', maxAge:config.production ? 3600000 : 0, redirect:false }));
  app.use('/api',identity(db,config));
  const services = {db,config,customer,owner,reauth,audit,notify,rate,checkLaunch:()=>checkLaunch(db,config)};
  app.use('/api',authRouter(services));
  app.use('/api',storeRouter(services));
  app.use('/api/admin',adminRouter(services));
  app.use('/api',commerceRouter(services));
  app.use('/api',(_req,_res,next) => next(new HttpError(404,'This endpoint could not be found.')));

  app.get('/robots.txt',(_req,res) => {
    res.type('text').send('User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /account\nDisallow: /orders/\nDisallow: /order/\nDisallow: /checkout\nSitemap: '+config.APP_URL+'/sitemap.xml\n');
  });
  app.get('/sitemap.xml',async (_req,res) => {
    const {rows} = await db.query('SELECT slug FROM products WHERE active AND (publish_at IS NULL OR publish_at<=now()) ORDER BY slug');
    const state = await storeState(db);
    const paths = ['/','/shop','/categories','/reviews','/support',...rows.map(row => '/product/'+encodeURIComponent(row.slug)),
      ...Object.keys(legalTitles).filter(slug => state.legal?.[slug]).map(slug => '/legal/'+slug)];
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
      paths.map(path => '<url><loc>'+escapeHtml(config.APP_URL+path)+'</loc></url>').join('')+'</urlset>');
  });

  let shell;
  app.get('/{*path}',async (req,res) => {
    if (/\.(?:js|css|png|webp|svg|ico|woff2?)$/i.test(req.path)) throw new HttpError(404,'This asset could not be found.');
    const state = await storeState(db);
    const store = publicStore(state);
    let title = store.name + ' | Digital shopping, redefined';
    let description = brandDescription;
    let image = assetUrl(store.logo);
    let structured = '';
    let status = 200;
    const slug = req.path.match(/^\/(?:product|products)\/([\w-]+)\/?$/)?.[1];
    if (slug) {
      const [product] = await products(db,'AND p.slug=$1',[slug]);
      if (!product) status = 404;
      else {
        title = product.details.seoTitle || product.name+' | '+store.name;
        description = product.details.seoDescription || product.description;
        image = assetUrl(product.images[0]?.url) || image;
        structured = JSON.stringify({ '@context':'https://schema.org','@type':'Product',name:product.name,description,
          image:product.images.map(item => assetUrl(item.url)).filter(Boolean).map(url => new URL(url,config.APP_URL).href),
          offers:{'@type':'Offer',price:((product.sale_price || product.price)/100).toFixed(2),
            priceCurrency:product.currency,availability:'https://schema.org/'+(product.stock===0 ? 'OutOfStock' : 'InStock'),
            url:config.APP_URL+req.path} }).replaceAll('<','\\u003c');
      }
    }
    if (/^\/(account|orders?|checkout)(\/|$)/.test(req.path)) res.set('X-Robots-Tag','noindex');
    const favicon = assetUrl(store.favicon);
    const meta = '<meta property="og:title" content="'+escapeHtml(title)+'"><meta property="og:description" content="'+escapeHtml(description)+'">'+
      '<meta property="og:type" content="'+(structured?'product':'website')+'"><meta property="og:url" content="'+escapeHtml(config.APP_URL+req.path)+'">'+
      '<link rel="canonical" href="'+escapeHtml(config.APP_URL+req.path)+'">'+
      (image ? '<meta property="og:image" content="'+escapeHtml(new URL(image,config.APP_URL).href)+'">' : '')+
      (favicon ? '<link rel="icon" href="'+escapeHtml(favicon)+'">' : '')+
      (structured ? '<script type="application/ld+json">'+structured+'</script>' : '');
    shell = config.production && shell ? shell : await readFile(new URL('../public/index.html',import.meta.url),'utf8');
    const html = shell.replace(/<meta property="og:[^"]+"[^>]*>/gi,'').replace(/<title>.*?<\/title>/is,() => '<title>'+escapeHtml(title)+'</title>')
      .replace(/<meta name="description"[^>]*>/i,() => '<meta name="description" content="'+escapeHtml(description)+'">')
      .replace('</head>',() => meta+'</head>');
    res.status(status).set('Cache-Control','no-cache').type('html').send(html);
  });

  app.use((error,req,res,next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof ZodError ? 400 : Number(error.status || error.statusCode || 500);
    const publicStatus = Number.isInteger(status) && status>=400 && status<=599 ? status : 500;
    if (publicStatus >= 500 && !(error instanceof HttpError)) {
      console.error(JSON.stringify({event:'request.error',requestId:req.requestId,method:req.method,
        status:publicStatus,code:error.code || error.name,
        ...(config.production ? {} : {message:error.message,stack:error.stack})}));
    }
    const message = error instanceof ZodError ? error.issues[0]?.message :
      publicStatus >= 500 && !(error instanceof HttpError) ? 'Something went wrong. Please try again.' :
      publicStatus===413 ? 'This upload exceeds the allowed size.' : error.message;
    res.status(publicStatus).json({error:message,requestId:req.requestId});
  });
  return app;
}
