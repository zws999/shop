import express from 'express';
import { z } from 'zod';
import { customer, emailSchema, rate } from './auth.js';
import { HttpError, parse, uuid } from './http.js';
import { notify } from './notifications.js';

export const DISCORD = 'https://discord.gg/EbV2GC4sar';
export const legalTitles = {
  terms:'Terms of Service', privacy:'Privacy Policy', refund:'Refund Policy', delivery:'Delivery Policy',
  cookies:'Cookie Policy', contact:'Contact', faq:'Frequently Asked Questions'
};
const requiredPolicies = ['terms','privacy','refund','delivery','cookies'];
const publicDetails = ['specs','specifications','video','seoTitle','seoDescription','related','relatedProducts','shipping'];
const publicAppearance = ['name','logo','favicon','accent','banner','footer','supportUrl','announcement','cardStyle','sections','heroTitle','heroCopy','socialLinks'];
const pick = (value,keys) => Object.fromEntries(keys.filter(key => value && Object.hasOwn(value,key)).map(key => [key,value[key]]));
const visible = '(p.active AND (p.publish_at IS NULL OR p.publish_at<=now()))';
const paidStates = "('paid','processing','completed','partially_refunded')";

export async function storeState(db) {
  const {rows} = await db.query("SELECT key,value FROM store_settings WHERE key IN ('appearance','settings','legal')");
  return Object.fromEntries(rows.map(row => [row.key,row.value]));
}
export function publicStore(state) {
  const appearance = pick(state.appearance,publicAppearance);
  const support = appearance.supportUrl;
  return { name:'303 Services/Shop', ...appearance, discord:/^https:\/\/(discord\.gg|discord\.com\/invite)\//.test(support ?? '') ? support : DISCORD,
    maintenance:Boolean(state.settings?.maintenanceMode), guestCheckout:state.settings?.guestCheckout };
}
export async function checkLaunch(db,config) {
  const {settings,legal} = await storeState(db);
  if (settings?.maintenanceMode) throw new HttpError(503,'Ordering is paused for store maintenance.');
  if (config.production && (!settings?.legalName?.trim() || !settings?.jurisdiction?.trim() ||
      requiredPolicies.some(key => !legal?.[key]?.trim()))) {
    throw new HttpError(503,'Checkout will open once the store publishes its business information and policies.');
  }
}

export async function products(db, where = '', args = []) {
  const {rows} = await db.query(`SELECT p.id,p.slug,p.name,p.description,p.kind,p.currency,p.price,p.sale_price,p.stock,
    p.featured,p.tags,p.details,p.category_id,p.created_at,c.name AS category_name,c.slug AS category_slug,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('url',i.url,'alt',i.alt) ORDER BY i.position,i.id)
      FROM product_images i WHERE i.product_id=p.id),'[]'::jsonb) AS images,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'price',v.price,'stock',v.stock) ORDER BY v.name)
      FROM variants v WHERE v.product_id=p.id AND v.active),'[]'::jsonb) AS variants,
    COALESCE((SELECT sum(oi.quantity) FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE oi.product_id=p.id AND o.paid_at IS NOT NULL AND o.status IN ('paid','processing','completed')),0) AS sales
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE ${visible} ${where} ORDER BY p.created_at DESC,p.id LIMIT 500`,args);
  return rows.map(row => {
    const details = pick(row.details,publicDetails);
    details.specs ??= details.specifications;
    details.relatedProducts ??= details.related;
    return {...row,sales:Number(row.sales),details};
  });
}

function publishedReviews(db,productId = null) {
  return db.query(`SELECT r.id,r.product_id,r.rating,r.body,r.owner_reply,r.created_at,p.name AS product_name,u.username
    FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id
    WHERE r.status='published' AND ${visible} AND ($1::uuid IS NULL OR p.id=$1)
    ORDER BY r.created_at DESC LIMIT 60`,[productId]);
}
const legalDefaults = {
  contact:'For help with an order or choosing a product, send a message from the support page or join the 303 Discord. Keep your invoice ID handy if you already placed an order.',
  faq:'When will my order be delivered?\nDigital deliveries become available after payment verification and fulfillment. Services and physical items follow the terms listed on their product pages.\n\nHow do I verify a manual payment?\nSubmit your transaction reference on the order page, then open a Discord support ticket with your invoice ID.\n\nCan I order as a guest?\nGuest checkout is available when enabled. Keep the browser you used to place your order for access to its status and downloads.'
};
export async function legalPage(db,slug) {
  if (!Object.hasOwn(legalTitles,slug)) throw new HttpError(404,'This policy could not be found.');
  const {legal} = await storeState(db);
  return { title:legalTitles[slug],body:legal?.[slug] || legalDefaults[slug] || '',
    published:Boolean(legal?.[slug] || legalDefaults[slug]) };
}
export function storeRouter({db,config}) {
  const router = express.Router();
  router.get('/catalog',async (_req,res) => {
    const [catalog,{rows:categories},state] = await Promise.all([
      products(db),
      db.query('SELECT id,slug,name,description FROM categories ORDER BY name LIMIT 200'),
      storeState(db)
    ]);
    res.json({products:catalog,categories,store:publicStore(state)});
  });
  router.get('/catalog/:slug',async (req,res) => {
    const [product] = await products(db,'AND p.slug=$1',[req.params.slug]);
    if (!product) throw new HttpError(404,'This product could not be found.');
    const ids = Array.isArray(product.details.relatedProducts) ? product.details.relatedProducts.filter(id => uuid.test(id)) : [];
    const [reviewResult,related] = await Promise.all([
      publishedReviews(db,product.id),
      ids.length ? products(db,'AND p.id=ANY($1::uuid[])',[ids.slice(0,20)]) :
        product.category_id ? products(db,'AND p.category_id=$1 AND p.id<>$2',[product.category_id,product.id]) : []
    ]);
    res.json({product,reviews:reviewResult.rows,related:related.slice(0,6)});
  });
  router.get('/reviews',async (_req,res) => res.json({reviews:(await publishedReviews(db)).rows}));
  router.get('/legal/:slug',async (req,res) => res.json(await legalPage(db,req.params.slug)));
  router.get('/account',customer,async (req,res) => {
    const {id,email,verifiedAt} = req.user;
    const [wishlist,orderResult,ticketResult,preferenceResult] = await Promise.all([
      products(db,'AND EXISTS (SELECT 1 FROM wishlist w WHERE w.product_id=p.id AND w.user_id=$1)',[id]),
      db.query(`SELECT invoice_id,status,currency,total,method_id,created_at,paid_at FROM orders
        WHERE user_id=$1 OR (user_id IS NULL AND $2::boolean AND lower(email)=$3)
        ORDER BY created_at DESC LIMIT 100`,[id,Boolean(verifiedAt),email]),
      db.query('SELECT id,invoice_id,subject,category,status,reply,created_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[id]),
      db.query('SELECT preferences FROM users WHERE id=$1',[id])
    ]);
    res.json({user:req.user,wishlist,orders:orderResult.rows,tickets:ticketResult.rows,preferences:preferenceResult.rows[0]?.preferences ?? {}});
  });
  router.post('/account/preferences',customer,async (req,res) => {
    const input = parse(z.object({ newsletter:z.boolean().optional(), productUpdates:z.boolean().optional() }),req.body);
    await db.query('UPDATE users SET preferences=preferences || $2::jsonb WHERE id=$1',[req.user.id,JSON.stringify(input)]);
    res.json({ok:true});
  });
  router.post('/account/wishlist',customer,async (req,res) => {
    const {productId} = parse(z.object({productId:z.uuid()}),req.body);
    const saved = await db.tx(async tx => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      const {rowCount} = await tx.query('DELETE FROM wishlist WHERE user_id=$1 AND product_id=$2',[req.user.id,productId]);
      if (rowCount) return false;
      const inserted = await tx.query(`INSERT INTO wishlist(user_id,product_id) SELECT $1,p.id FROM products p WHERE id=$2 AND ${visible}`,
        [req.user.id,productId]);
      if (!inserted.rowCount) throw new HttpError(404,'This product could not be found.');
      return true;
    });
    res.json({saved});
  });
  router.post('/account/reviews',customer,async (req,res) => {
    if (!req.user.verifiedAt) throw new HttpError(403,'Verify your email before submitting a review.');
    await rate(db,'review',req.user.id,12,3600);
    const {productId,rating,body} = parse(z.object({productId:z.uuid(),rating:z.number().int().min(1).max(5),
      body:z.string().trim().min(5).max(2000)}),req.body);
    const {settings} = await storeState(db);
    const eligibleStates = settings?.reviewEligibility==='completed' ? "('completed')" : paidStates;
    const {rows:[review]} = await db.tx(async tx => {
      const {rows:[eligible]} = await tx.query(`SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.product_id=$1 AND o.paid_at IS NOT NULL AND o.status IN ${eligibleStates}
        AND (o.user_id=$2 OR (o.user_id IS NULL AND lower(o.email)=$3)) LIMIT 1`,[productId,req.user.id,req.user.email]);
      if (!eligible) throw new HttpError(403,'A verified purchase of this product is required.');
      const result = await tx.query(`INSERT INTO reviews(user_id,product_id,rating,body) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id,product_id) DO NOTHING RETURNING id,status`,[req.user.id,productId,rating,body]);
      if (!result.rows[0]) throw new HttpError(409,'You already reviewed this product.');
      await notify(tx,config.OWNER_EMAIL,'New 303 review awaiting moderation','A verified purchaser submitted a review. Open the 303 Control Center to moderate it.');
      return result;
    });
    res.status(201).json({review});
  });
  router.post('/support',async (req,res) => {
    await rate(db,'support',req.ip,8,3600);
    const data = parse(z.object({email:emailSchema,subject:z.string().trim().min(4).max(150),category:z.string().trim().min(2).max(48),
      message:z.string().trim().min(10).max(4000),invoiceId:z.string().trim().max(70).optional()}),req.body);
    const email = req.user?.email || data.email;
    const ticket = await db.tx(async tx => {
      let invoiceId = null;
      if (data.invoiceId) {
        const {rows:[order]} = await tx.query(`SELECT invoice_id FROM orders WHERE upper(invoice_id)=upper($1)
          AND (user_id=$2 OR (user_id IS NULL AND (cart_id=$3 OR ($4::boolean AND lower(email)=$5))))`,
          [data.invoiceId,req.user?.id ?? null,req.cartId,Boolean(req.user?.verifiedAt),email]);
        if (!order) throw new HttpError(404,'Could not associate this invoice. Check the ID or contact Discord support.');
        invoiceId = order.invoice_id;
      }
      const {rows:[ticket]} = await tx.query(`INSERT INTO support_tickets(user_id,invoice_id,email,subject,category,message)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status`,[req.user?.id || null,invoiceId,email,data.subject,data.category,data.message]);
      await notify(tx,config.OWNER_EMAIL,'New 303 support ticket','Ticket ' + ticket.id + ' is ready in the 303 Control Center.');
      await notify(tx,email,'303 support request received','Your support request was received. Your ticket ID is ' + ticket.id + '.');
      return ticket;
    });
    res.status(201).json({ticket});
  });
  router.post('/newsletter',async (req,res) => {
    await rate(db,'newsletter',req.ip,10,3600);
    const {email} = parse(z.object({email:emailSchema}),req.body);
    await db.query('INSERT INTO newsletter(email) VALUES($1) ON CONFLICT DO NOTHING',[email]);
    res.status(201).json({ok:true});
  });
  return router;
}
