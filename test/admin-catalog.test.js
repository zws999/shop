import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { connect, migrate } from '../src/db.js';
import { adminRouter } from '../src/admin.js';

test('catalogue management protects private bytes and detects stale stock edits', async () => {
  const db = await connect({ PGLITE_MEMORY: 'true' });
  let server;
  try {
    await migrate(db);
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter({
      db, config: {}, audit: async () => {}, notify: async () => {},
      owner: (req, res, next) => req.get('authorization') === 'catalogue-test' ? next() : res.sendStatus(403),
      reauth: (_req, _res, next) => next()
    }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port + '/api/admin';
    const admin = (path, options = {}) => fetch(base + path, {
      ...options, headers: { authorization: 'catalogue-test', ...options.headers }
    });
    const json = (path, method, data) => admin(path, {
      method, body: JSON.stringify(data), headers: { 'content-type': 'application/json' }
    });
    const binary = (path, body) => admin(path, {
      method: 'POST', body, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'guide.zip' }
    });
    const product = {
      name: 'Private guide', slug: 'private-guide', description: 'Fixture', category_id: null, kind: 'download',
      currency: 'USD', price: 1000, sale_price: null, cost: null, stock: 5, active: false, featured: false,
      publish_at: null, tags: [], details: {}
    };
    const create = await json('/products', 'POST', product);
    assert.equal(create.status, 201);
    const { id } = await create.json();
    const route = '/products/' + id;
    assert.equal((await binary(route + '/assets', Buffer.from('private file content'))).status, 201);
    assert.equal((await binary(route + '/images/upload', Buffer.from('<svg></svg>'))).status, 400);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG/0AAAAASUVORK5CYII=', 'base64');
    const upload = await binary(route + '/images/upload', png);
    assert.equal(upload.status, 201);
    const { id: imageId } = await upload.json();
    assert.equal((await fetch(base + '/media/' + imageId)).status, 404);
    const preview = await admin('/image-preview/' + imageId);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);
    assert.equal((await json('/products/bulk', 'PATCH', { ids: [id], active: true })).status, 200);
    const published = await fetch(base + '/media/' + imageId);
    assert.deepEqual(Buffer.from(await published.arrayBuffer()), png);
    assert.equal(published.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await json('/inventory/adjust', 'POST', {
      rows: [{ product: id, variant: null, delta: -2 }], reason: 'Inventory recount'
    })).status, 200);
    assert.equal((await json(route, 'PUT', { product, expectedStock: 5 })).status, 409);
    const detail = await (await admin(route)).json();
    assert.equal(detail.product.stock, 3);
    assert.equal(detail.assets[0].filename, 'guide.zip');
    assert.equal(detail.assets[0].data, undefined);
    assert.equal((await fetch(base + route)).status, 403);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
