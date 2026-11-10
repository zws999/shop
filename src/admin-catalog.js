import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { digest, sealSecret } from './security.js';
import { currency, date, fail, id, idSchema, input, number, one, safeUrl, slug, text } from './admin-validation.js';

const nullableAmount = number().nullable();
const kind = z.enum(['download', 'license', 'service', 'physical']);
const productSchema = z.strictObject({
  name: text(),
  slug,
  description: text(20000, false),
  category_id: idSchema.nullable(),
  kind,
  currency,
  price: number(1),
  sale_price: number(1).nullable(),
  cost: nullableAmount,
  stock: nullableAmount,
  active: z.boolean(),
  featured: z.boolean(),
  publish_at: date.nullable(),
  tags: z.array(text(30)).max(20),
  details: z.strictObject({
    specifications: text(4000, false).default(''),
    instructions: text(4000, false).default(''),
    video: safeUrl.or(z.literal('')).default(''),
    seoTitle: text(120, false).default(''),
    seoDescription: text(350, false).default(''),
    related: z.array(idSchema).max(10).default([])
  })
}).refine(product => product.sale_price == null || product.sale_price < product.price,
  { path: ['sale_price'], message: 'Discounted price must be below the regular price.' });
const categorySchema = z.strictObject({ name: text(), slug, description: text(2000, false) });
const variantSchema = z.strictObject({ name: text(90), price: number(1).nullable(), stock: nullableAmount, active: z.boolean() });
const imageSchema = z.strictObject({ url: safeUrl, alt: text(240, false), position: number(0, 99) });
const imageLimit = 3 * 1024 ** 2;
const fileLimit = 15 * 1024 ** 2;
const binary = size => express.raw({ type: 'application/octet-stream', limit: size, inflate: false });

function uploadBody(req) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) fail(400, 'Select a file to upload.');
  return req.body;
}

function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.length >= 33) return 'image/png';
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && data.subarray(-2).equals(Buffer.from([255, 217]))) return 'image/jpeg';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' && data.length >= 20) return 'image/webp';
  fail(400, 'Upload a PNG, JPEG or WebP image.');
}

function decodeHeader(req, name) {
  try {
    return decodeURIComponent(req.get(name) || '');
  } catch {
    fail(400, 'Invalid upload metadata.');
  }
}

function uploadName(req) {
  return input(text(180).refine(value => !/[\\/\u0000-\u001f\u007f]/.test(value), 'File name contains an invalid character.'),
    decodeHeader(req, 'X-Filename'));
}

async function stockEvent(tx, product, variant, before, after, reason) {
  if (before === after) return;
  const mode = before === null || after === null;
  await tx.query('INSERT INTO inventory_events(product_id,variant_id,delta,reason) VALUES($1,$2,$3,$4)', [
    product, variant, (after ?? 0) - (before ?? 0), mode ? reason + ' (inventory mode changed)' : reason
  ]);
}

const productValues = product => [
  product.slug, product.name, product.description, product.category_id, product.kind, product.currency, product.price,
  product.sale_price, product.cost, product.stock, product.active, product.featured, product.publish_at, product.tags,
  JSON.stringify(product.details)
];
const updateProductSchema = z.strictObject({ product: productSchema, expectedStock: nullableAmount });

export function registerImageMedia(router, db) {
  router.get('/media/:id', async (req, res) => {
    const image = one(await db.query(
      'SELECT u.content_type,u.data FROM product_image_uploads u JOIN product_images i ON i.id=u.id ' +
      'JOIN products p ON p.id=i.product_id WHERE i.id=$1 AND p.active AND (p.publish_at IS NULL OR p.publish_at<=now())',
      [id(req.params.id)]
    ), 'Image');
    res.set('Cache-Control', 'public, max-age=300').set('X-Content-Type-Options', 'nosniff')
      .type(image.content_type).send(Buffer.from(image.data));
  });
}

export function registerCatalog(router, { db, audit }) {
  router.get('/image-preview/:id', async (req, res) => {
    const image = one(await db.query('SELECT content_type,data FROM product_image_uploads WHERE id=$1', [id(req.params.id)]), 'Image');
    res.set('X-Content-Type-Options', 'nosniff').type(image.content_type).send(Buffer.from(image.data));
  });

  router.get('/categories', async (_req, res) => {
    const result = await db.query('SELECT c.*, (SELECT count(*)::int FROM products WHERE category_id=c.id) AS product_count FROM categories c ORDER BY name LIMIT 500');
    res.json(result.rows);
  });

  router.post('/categories', async (req, res) => {
    const category = input(categorySchema, req.body);
    const result = await db.tx(async tx => {
      const { rows } = await tx.query('INSERT INTO categories(name,slug,description) VALUES($1,$2,$3) RETURNING *',
        [category.name, category.slug, category.description]);
      await audit(tx, req, 'category.created', rows[0].id);
      return rows[0];
    });
    res.status(201).json(result);
  });

  router.put('/categories/:id', async (req, res) => {
    const category = input(categorySchema, req.body);
    const categoryId = id(req.params.id);
    await db.tx(async tx => {
      one(await tx.query('UPDATE categories SET name=$2,slug=$3,description=$4 WHERE id=$1 RETURNING id',
        [categoryId, category.name, category.slug, category.description]), 'Category');
      await audit(tx, req, 'category.updated', categoryId);
    });
    res.json({ ok: true });
  });

  router.delete('/categories/:id', async (req, res) => {
    const categoryId = id(req.params.id);
    await db.tx(async tx => {
      one(await tx.query('SELECT id FROM categories WHERE id=$1 FOR UPDATE', [categoryId]), 'Category');
      const used = await tx.query('SELECT 1 FROM products WHERE category_id=$1 UNION ALL SELECT 1 FROM coupons WHERE category_id=$1 LIMIT 1', [categoryId]);
      if (used.rows.length) fail(409, 'Move the products and coupons out of this category before deleting it.');
      await tx.query('DELETE FROM categories WHERE id=$1', [categoryId]);
      await audit(tx, req, 'category.deleted', categoryId);
    });
    res.json({ ok: true });
  });

  router.get('/products', async (req, res) => {
    const filter = input(z.object({
      q: text(120, false).default(''),
      category: idSchema.optional(),
      offset: z.coerce.number().int().min(0).max(100000).default(0)
    }), req.query);
    const result = await db.query(
      'SELECT p.*,c.name AS category, (SELECT url FROM product_images WHERE product_id=p.id ORDER BY position,id LIMIT 1) AS thumbnail,' +
      ' (SELECT count(*)::int FROM variants WHERE product_id=p.id AND active) AS variant_count,' +
      ' (SELECT count(*)::int FROM license_keys WHERE product_id=p.id AND assigned_order_item IS NULL) AS available_keys' +
      ' FROM products p LEFT JOIN categories c ON c.id=p.category_id' +
      " WHERE ($1='' OR p.name ILIKE '%'||$1||'%' OR p.slug ILIKE '%'||$1||'%') AND ($2::uuid IS NULL OR p.category_id=$2)" +
      ' ORDER BY p.created_at DESC,p.id LIMIT 100 OFFSET $3',
      [filter.q, filter.category ?? null, filter.offset]
    );
    res.json(result.rows);
  });

  router.get('/products/:id', async (req, res) => {
    const productId = id(req.params.id);
    const product = one(await db.query('SELECT * FROM products WHERE id=$1', [productId]), 'Product');
    const [variants, images, assets, licenses] = await Promise.all([
      db.query('SELECT * FROM variants WHERE product_id=$1 ORDER BY name,id', [productId]),
      db.query('SELECT * FROM product_images WHERE product_id=$1 ORDER BY position,id', [productId]),
      db.query('SELECT id,filename,download_limit,created_at,octet_length(data) AS size FROM digital_assets WHERE product_id=$1 ORDER BY created_at DESC', [productId]),
      db.query('SELECT id,assigned_at,created_at FROM license_keys WHERE product_id=$1 ORDER BY created_at DESC LIMIT 200', [productId])
    ]);
    res.json({ product, variants: variants.rows, images: images.rows, assets: assets.rows, licenses: licenses.rows });
  });

  router.post('/products', async (req, res) => {
    const product = input(productSchema, req.body);
    const result = await db.tx(async tx => {
      const row = one(await tx.query(
        'INSERT INTO products(slug,name,description,category_id,kind,currency,price,sale_price,cost,stock,active,featured,publish_at,tags,details)' +
        ' VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) RETURNING id',
        productValues(product)
      ), 'Product');
      await stockEvent(tx, row.id, null, null, product.stock, 'Initial inventory');
      await audit(tx, req, 'product.created', row.id, { active: product.active });
      return row;
    });
    res.status(201).json(result);
  });

  router.put('/products/:id', async (req, res) => {
    const { product, expectedStock } = input(updateProductSchema, req.body);
    const productId = id(req.params.id);
    await db.tx(async tx => {
      const previous = one(await tx.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      if (previous.stock !== expectedStock) fail(409, 'Stock changed while this editor was open. Reopen it to view the latest quantity.');
      if (previous.kind !== product.kind) {
        const commitments = await tx.query('SELECT 1 FROM order_items WHERE product_id=$1 LIMIT 1', [productId]);
        if (commitments.rows.length) fail(409, 'Create a new product to change fulfillment after orders have been placed.');
      }
      await tx.query(
        'UPDATE products SET slug=$1,name=$2,description=$3,category_id=$4,kind=$5,currency=$6,price=$7,sale_price=$8,cost=$9,' +
        ' stock=$10,active=$11,featured=$12,publish_at=$13,tags=$14,details=$15::jsonb,updated_at=now() WHERE id=$16',
        [...productValues(product), productId]
      );
      await stockEvent(tx, productId, null, previous.stock, product.stock, 'Product editor adjustment');
      await audit(tx, req, 'product.updated', productId, { active: product.active });
      if (previous.price !== product.price || previous.sale_price !== product.sale_price || previous.currency !== product.currency) {
        await audit(tx, req, 'product.price_changed', productId, {
          previous: [previous.currency, previous.price, previous.sale_price],
          current: [product.currency, product.price, product.sale_price]
        });
      }
    });
    res.json({ ok: true });
  });

  router.patch('/products/bulk', async (req, res) => {
    const { ids, active } = input(z.strictObject({ ids: z.array(idSchema).min(1).max(100), active: z.boolean() }), req.body);
    const count = await db.tx(async tx => {
      const result = await tx.query('UPDATE products SET active=$2,updated_at=now() WHERE id=ANY($1::uuid[]) RETURNING id', [ids, active]);
      for (const row of result.rows) await audit(tx, req, active ? 'product.published' : 'product.archived', row.id);
      return result.rows.length;
    });
    res.json({ count });
  });

  router.delete('/products/:id', async (req, res) => {
    const productId = id(req.params.id);
    await db.tx(async tx => {
      const product = one(await tx.query('SELECT active FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      if (product.active) fail(409, 'Archive this product before deleting it.');
      const used = await tx.query('SELECT 1 FROM order_items WHERE product_id=$1 UNION ALL SELECT 1 FROM reviews WHERE product_id=$1 LIMIT 1', [productId]);
      if (used.rows.length) fail(409, 'Products with orders or reviews can remain archived.');
      await tx.query('DELETE FROM products WHERE id=$1', [productId]);
      await audit(tx, req, 'product.deleted', productId);
    });
    res.json({ ok: true });
  });

  router.get('/inventory', async (_req, res) => {
    const [stock, events] = await Promise.all([
      db.query('SELECT p.id AS product_id, NULL::uuid AS variant_id, p.name, NULL::text AS variant, p.stock, p.active, p.kind,' +
        ' (SELECT count(*)::int FROM license_keys k WHERE k.product_id=p.id AND k.assigned_order_item IS NULL) AS keys FROM products p' +
        ' UNION ALL SELECT p.id, v.id, p.name, v.name, v.stock, v.active AND p.active, p.kind, NULL::int FROM variants v JOIN products p ON p.id=v.product_id' +
        ' ORDER BY name, variant NULLS FIRST LIMIT 500'),
      db.query('SELECT e.*,p.name,v.name AS variant FROM inventory_events e LEFT JOIN products p ON p.id=e.product_id' +
        ' LEFT JOIN variants v ON v.id=e.variant_id ORDER BY e.created_at DESC LIMIT 100')
    ]);
    res.json({ stock: stock.rows, events: events.rows });
  });

  router.post('/inventory/adjust', async (req, res) => {
    const schema = z.strictObject({
      rows: z.array(z.strictObject({ product: idSchema, variant: idSchema.nullable(), delta: number(-1000000, 1000000).refine(value => value !== 0) })).min(1).max(100),
      reason: text(140)
    });
    const { rows, reason } = input(schema, req.body);
    rows.sort((a, b) => (a.product + (a.variant || '')).localeCompare(b.product + (b.variant || '')));
    await db.tx(async tx => {
      for (const change of rows) {
        // Lock product first, matching checkout's stock reservation order.
        const product = one(await tx.query('SELECT stock FROM products WHERE id=$1 FOR UPDATE', [change.product]), 'Product');
        const current = change.variant ? one(await tx.query('SELECT stock FROM variants WHERE id=$1 AND product_id=$2 FOR UPDATE',
          [change.variant, change.product]), 'Variant') : product;
        if (current.stock == null) fail(409, 'Set a finite quantity in the product editor before adjusting unlimited stock.');
        const after = current.stock + change.delta;
        if (after < 0 || after > 100000000) fail(409, 'Stock adjustment exceeds the allowed quantity.');
        if (change.variant) await tx.query('UPDATE variants SET stock=$2 WHERE id=$1', [change.variant, after]);
        else await tx.query('UPDATE products SET stock=$2,updated_at=now() WHERE id=$1', [change.product, after]);
        await stockEvent(tx, change.product, change.variant, current.stock, after, reason);
        await audit(tx, req, 'inventory.adjusted', change.variant || change.product, { delta: change.delta, reason });
      }
    });
    res.json({ count: rows.length });
  });

  router.post('/products/:id/variants', async (req, res) => {
    const productId = id(req.params.id);
    const variant = input(variantSchema, req.body);
    const result = await db.tx(async tx => {
      one(await tx.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      const { rows } = await tx.query('INSERT INTO variants(product_id,name,price,stock,active) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [productId, variant.name, variant.price, variant.stock, variant.active]);
      await stockEvent(tx, productId, rows[0].id, null, variant.stock, 'Initial variant inventory');
      await audit(tx, req, 'variant.created', rows[0].id, { productId });
      return rows[0];
    });
    res.status(201).json(result);
  });

  router.put('/products/:id/variants/:variant', async (req, res) => {
    const productId = id(req.params.id);
    const variantId = id(req.params.variant);
    const { variant, expectedStock } = input(z.strictObject({ variant: variantSchema, expectedStock: nullableAmount }), req.body);
    await db.tx(async tx => {
      one(await tx.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      const previous = one(await tx.query('SELECT * FROM variants WHERE id=$1 AND product_id=$2 FOR UPDATE',
        [variantId, productId]), 'Variant');
      if (previous.stock !== expectedStock) fail(409, 'Stock changed while this editor was open. Reopen it to view the latest quantity.');
      await tx.query('UPDATE variants SET name=$2,price=$3,stock=$4,active=$5 WHERE id=$1',
        [variantId, variant.name, variant.price, variant.stock, variant.active]);
      await stockEvent(tx, productId, variantId, previous.stock, variant.stock, 'Variant editor adjustment');
      await audit(tx, req, 'variant.updated', variantId, { productId });
      if (previous.price !== variant.price) {
        await audit(tx, req, 'variant.price_changed', variantId, { previous: previous.price, current: variant.price });
      }
    });
    res.json({ ok: true });
  });

  router.post('/products/:id/images', async (req, res) => {
    const productId = id(req.params.id);
    const image = input(imageSchema, req.body);
    const result = await db.tx(async tx => {
      const { rows } = await tx.query('INSERT INTO product_images(product_id,url,alt,position) VALUES($1,$2,$3,$4) RETURNING id',
        [productId, image.url, image.alt, image.position]);
      await audit(tx, req, 'product.image_added', productId, { imageId: rows[0].id });
      return rows[0];
    });
    res.status(201).json(result);
  });

  router.post('/products/:id/images/upload', binary(imageLimit), async (req, res) => {
    const productId = id(req.params.id);
    const imageId = randomUUID();
    const data = uploadBody(req);
    const contentType = imageType(data);
    const alt = input(text(240, false), decodeHeader(req, 'X-Image-Alt'));
    const url = '/api/admin/media/' + imageId;
    await db.tx(async tx => {
      one(await tx.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      await tx.query('INSERT INTO product_images(id,product_id,url,alt,position)' +
        ' VALUES($1,$2,$3,$4,(SELECT coalesce(max(position)+1,0) FROM product_images WHERE product_id=$2))',
        [imageId, productId, url, alt]);
      await tx.query('INSERT INTO product_image_uploads(id,content_type,data) VALUES($1,$2,$3)', [imageId, contentType, data]);
      await audit(tx, req, 'product.image_uploaded', productId, { imageId, size: data.length });
    });
    res.status(201).json({ id: imageId, url });
  });

  router.post('/products/:id/assets', binary(fileLimit), async (req, res) => {
    const productId = id(req.params.id);
    const data = uploadBody(req);
    const filename = uploadName(req);
    const limit = input(z.coerce.number().int().min(1).max(100), req.get('X-Download-Limit') || '3');
    const result = await db.tx(async tx => {
      const product = one(await tx.query('SELECT kind FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      if (product.kind !== 'download') fail(409, 'Attach download files to a digital download product.');
      const { rows } = await tx.query('INSERT INTO digital_assets(product_id,filename,data,download_limit) VALUES($1,$2,$3,$4) RETURNING id',
        [productId, filename, data, limit]);
      await audit(tx, req, 'product.asset_uploaded', productId, { assetId: rows[0].id, size: data.length, limit });
      return rows[0];
    });
    res.status(201).json(result);
  });

  router.post('/products/:id/licenses', async (req, res) => {
    const productId = id(req.params.id);
    const { keys } = input(z.strictObject({ keys: z.array(text(1000)).min(1).max(500) }), req.body);
    if (new Set(keys).size !== keys.length) fail(400, 'Remove repeated keys from the import.');
    await db.tx(async tx => {
      const product = one(await tx.query('SELECT kind FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      if (product.kind !== 'license') fail(409, 'Import keys into a license product.');
      for (const key of keys) {
        const result = await tx.query('INSERT INTO license_keys(product_id,secret,fingerprint) VALUES($1,$2,$3) ON CONFLICT(fingerprint) DO NOTHING RETURNING id',
          [productId, sealSecret(key), digest('303 license inventory\0' + key)]);
        if (!result.rows.length) fail(409, 'One or more license keys already exist in inventory.');
      }
      await audit(tx, req, 'product.keys_imported', productId, { count: keys.length });
    });
    res.status(201).json({ count: keys.length });
  });

  router.delete('/products/:id/:resource/:item', async (req, res) => {
    const productId = id(req.params.id);
    const itemId = id(req.params.item);
    const resource = input(z.enum(['images', 'assets', 'licenses']), req.params.resource);
    await db.tx(async tx => {
      one(await tx.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [productId]), 'Product');
      const queries = {
        images: 'DELETE FROM product_images WHERE id=$1 AND product_id=$2 RETURNING id',
        assets: 'DELETE FROM digital_assets a WHERE a.id=$1 AND a.product_id=$2' +
          ' AND NOT EXISTS (SELECT 1 FROM order_assets WHERE asset_id=a.id)' +
          ' AND NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=a.product_id' +
          " AND o.status IN ('pending_payment','awaiting_verification','payment_under_review','paid','processing')) RETURNING id",
        licenses: 'DELETE FROM license_keys WHERE id=$1 AND product_id=$2 AND assigned_order_item IS NULL RETURNING id'
      };
      const result = await tx.query(queries[resource], [itemId, productId]);
      if (!result.rows.length) fail(409, 'This item is assigned to an order or no longer exists.');
      await audit(tx, req, 'product.' + resource + '_removed', productId, { itemId });
    });
    res.json({ ok: true });
  });
}
