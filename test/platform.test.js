import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after,before,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { connect,migrate } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { otpContext,rotateRecovery } from '../src/auth.js';
import { createTotpSecret,hashPassword,openSecret,sealSecret,totpAt } from '../src/security.js';

const origin = 'http://127.0.0.1:3030';
const config = loadConfig({ NODE_ENV:'test', DATABASE_URL:process.env.TEST_DATABASE_URL || '', PGLITE_MEMORY:'true',
  APP_SECRET:'b'.repeat(64), APP_URL:origin, OWNER_EMAIL:'owner@example.test',
  RESEND_API_KEY:'', COINGECKO_API_KEY:'', PAYPAL_CLIENT_ID:'' });
const password = 'integration-only ' + randomUUID();
let db,server,base,ownerId,ownerSecret,recoveryCode;

function browser() {
  const cookies = new Map();
  return async (path,{method='GET',body,headers={},originHeader=origin}={}) => {
    const response = await fetch(base+path,{method,redirect:'manual',headers:{
      cookie:[...cookies].map(([name,value]) => name+'='+value).join('; '),
      ...(originHeader ? {origin:originHeader} : {}),
      ...(body===undefined ? {} : {'content-type':'application/json'}),
      ...headers
    },body:body===undefined ? undefined : JSON.stringify(body)});
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0];
      const split = pair.indexOf('=');
      cookies.set(pair.slice(0,split),pair.slice(split+1));
    }
    const data = (response.headers.get('content-type') || '').startsWith('application/json') ?
      await response.json() : Buffer.from(await response.arrayBuffer());
    return {status:response.status,data,headers:response.headers};
  };
}
function expect(result,status) {
  assert.equal(result.status,status,Buffer.isBuffer(result.data) ? result.data.toString().slice(0,400) : JSON.stringify(result.data));
  return result.data;
}
const post = (body,headers) => ({method:'POST',body,headers});
before(async () => {
  db = await connect(config);
  if (config.DATABASE_URL) {
    const {rows:[{count}]} = await db.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
    assert.equal(Number(count),0,'TEST_DATABASE_URL must point to an empty disposable database.');
  }
  await migrate(db);
  const app = buildApp({db,config});
  server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  ownerId = randomUUID();
  ownerSecret = createTotpSecret();
  await db.query(`INSERT INTO users(id,email,username,password_hash,role,verified_at,mfa_secret)
    VALUES($1,$2,'zews1009485',$3,'owner',now(),$4)`,
    [ownerId,config.OWNER_EMAIL,await hashPassword(password),sealSecret(ownerSecret,otpContext(ownerId))]);
  [recoveryCode] = await db.tx(tx => rotateRecovery(tx,ownerId));
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.close();
});

test('admin access, same-origin writes, account email verification and reset',async () => {
  const guest = browser();
  assert.equal((await guest('/admin')).headers.get('location'),'/admin/login');
  expect(await guest('/api/admin/overview'),403);
  expect(await guest('/api/auth/register',{...post({email:'alice@example.test',username:'alice',password}),originHeader:'https://unrelated.example.test'}),403);
  expect(await guest('/api/auth/register',post({email:'alice@example.test',username:'alice',password})),201);
  const mail = await db.query("SELECT message FROM outbox WHERE recipient='alice@example.test' AND subject='Verify your 303 account'");
  const token = openSecret(mail.rows[0].message, 'outbox').match(/verify=([\w-]+)/)[1];
  expect(await guest('/api/auth/verify',post({token})),200);
  assert.ok(expect(await guest('/api/me'),200).user.verifiedAt);
  expect(await guest('/api/auth/verify',post({token})),400);
  expect(await guest('/api/auth/forgot',post({email:'alice@example.test'})),200);
  const reset = await db.query("SELECT message FROM outbox WHERE recipient='alice@example.test' AND subject='Reset your 303 password'");
  expect(await guest('/api/auth/reset',post({token:openSecret(reset.rows[0].message, 'outbox').match(/reset=([\w-]+)/)[1],password:password+' reset'})),200);
  assert.equal(expect(await guest('/api/me'),200).user,null);
  expect(await guest('/api/auth/login',post({login:'alice',password})),401);
  expect(await guest('/api/auth/login',post({login:'alice',password:password+' reset'})),200);
  expect(await guest('/api/admin/overview'),403);
});

test('audit events cannot be updated or deleted',async () => {
  await assert.rejects(db.query('DELETE FROM audit_logs'),/append-only/);
  await assert.rejects(db.query("UPDATE audit_logs SET action='changed'"),/append-only/);
});


test('Revolut invoice, protected fulfillment, moderation, and replay protection',async () => {
  const storefront = browser();
  const other = browser();
  const control = browser();
  expect(await control('/api/auth/login',post({login:'zews1009485',password,otp:'000000-invalid'})),401);
  expect(await control('/api/auth/login',post({login:'zews1009485',password,otp:recoveryCode})),200);
  const product = {
    name:'Integration Download',slug:'integration-download',description:'Isolated test fixture',category_id:null,
    kind:'download',currency:'USD',price:3099,sale_price:2999,cost:1000,stock:3,active:true,featured:true,
    publish_at:null,tags:['test'],details:{instructions:'Private fixture instructions'}
  };
  const published = expect(await control('/api/admin/products',post(product)),201);
  const productId = published.id ?? published.product?.id;
  assert.ok(productId);
  await db.query("INSERT INTO digital_assets(product_id,filename,data,download_limit) VALUES($1,'guide.txt',$2,1)",[productId,Buffer.from('test download')]);
  const publicProduct = expect(await storefront('/api/catalog/integration-download'),200).product;
  assert.equal(publicProduct.sale_price,2999);
  assert.equal(publicProduct.details.instructions,undefined);
  expect(await storefront('/api/auth/register',post({email:'buyer@example.test',username:'buyer',password})),201);
  const {rows:[mail]} = await db.query("SELECT message FROM outbox WHERE recipient='buyer@example.test' AND subject='Verify your 303 account'");
  const token = openSecret(mail.message,'outbox').match(/verify=([\w-]+)/)[1];
  expect(await storefront('/api/auth/verify',post({token})),200);
  expect(await storefront('/api/account/reviews',post({productId,rating:5,body:'Test review before payment'})),403);

  const cart = expect(await storefront('/api/cart/items',post({productId,quantity:1,price:1})),201);
  assert.equal((cart.cart ?? cart).subtotal,2999);
  const checkout = { email:'untrusted@example.test',customerName:'Test Buyer',methodId:'revolut',idempotencyKey:randomUUID() };
  const {order} = expect(await storefront('/api/checkout',post(checkout)),201);
  assert.match(order.invoiceId,/^303-\d{4}-\d{6,}$/);
  assert.equal(order.status,'pending_payment');
  assert.equal(order.destination,'@zewss');
  assert.equal(order.total,2999);
  assert.equal(order.email,'buyer@example.test');
  const retry = expect(await storefront('/api/checkout',post(checkout)),200);
  assert.equal(retry.order.id,order.id);
  const route = '/api/orders/'+order.id;
  const approveRoute = '/api/admin/orders/'+order.id+'/approve';
  expect(await other(route),404);
  expect(await other(route+'/invoice.pdf'),404);
  expect(await storefront(approveRoute,post({receivedAmount:'29.99'})),403);
  const submission = expect(await storefront(route+'/submit',post({reference:'transfer-ref-1234'})),200);
  assert.equal(submission.order.status,'awaiting_verification');
  assert.equal(submission.order.paidAt,null);
  assert.equal(submission.order.items[0].assets.length,0);
  expect(await control(approveRoute,post({receivedAmount:'29.99'})),403);
  expect(await control('/api/auth/reauth',post({password,otp:totpAt(ownerSecret)})),200);
  expect(await control(approveRoute,post({receivedAmount:'2.99'})),409);
  expect(await control(approveRoute,post({receivedAmount:'29.99'})),200);
  expect(await control(approveRoute,post({receivedAmount:'29.99'})),409);

  const result = expect(await storefront(route),200).order;
  assert.equal(result.status,'completed');
  assert.ok(result.paidAt);
  const download = result.items[0].assets[0].url;
  expect(await other(download),404);
  assert.equal(expect(await storefront(download),200).toString(),'test download');
  const limit = await storefront(download);
  assert.ok([403,409,410].includes(limit.status),JSON.stringify(limit.data));
  assert.equal(expect(await storefront(route+'/invoice.pdf'),200).subarray(0,5).toString(),'%PDF-');

  expect(await storefront('/api/account/reviews',post({productId,rating:5,body:'Verified test review'})),201);
  expect(await storefront('/api/account/reviews',post({productId,rating:4,body:'Duplicate test review'})),409);
  assert.equal(expect(await storefront('/api/reviews'),200).reviews.length,0);
  assert.ok((await db.query("SELECT action FROM audit_logs WHERE action='payment.manual_approved'")).rowCount);
});

test('guest cart persists, coupon usage is reserved, and cancellation restores stock',async () => {
  const guest = browser();
  const differentGuest = browser();
  const {rows:[{id:productId}]} = await db.query(`INSERT INTO products(slug,name,kind,currency,price,stock,active)
    VALUES('integration-service','Integration Service','service','EUR',1000,2,true) RETURNING id`);
  await db.query(`INSERT INTO coupons(code,kind,amount,currency,max_uses,max_per_customer)
    VALUES('INTEGRATION','fixed',100,'EUR',1,1)`);
  expect(await guest('/api/cart/items',post({productId,quantity:1})),201);
  assert.equal(expect(await guest('/api/cart'),200).items[0].productId,productId);
  expect(await guest('/api/cart/coupon',post({code:'INTEGRATION'})),200);
  const checkout = {email:'guest@example.test',customerName:'Guest Buyer',methodId:'revolut',idempotencyKey:randomUUID()};
  const {order} = expect(await guest('/api/checkout',post(checkout)),201);
  assert.equal(order.total,900);
  assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,1);
  expect(await differentGuest('/api/orders/'+order.id),404);
  expect(await differentGuest('/api/cart/items',post({productId,quantity:1})),201);
  expect(await differentGuest('/api/cart/coupon',post({code:'INTEGRATION'})),409);
  expect(await guest('/api/orders/'+order.id+'/cancel',post({})),200);
  assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,2);
  expect(await differentGuest('/api/cart/coupon',post({code:'INTEGRATION'})),200);
  const next = expect(await differentGuest('/api/checkout',post({...checkout,idempotencyKey:randomUUID()})),201);
  assert.equal(next.order.total,900);
  assert.notEqual(next.order.invoiceId,order.invoiceId);
});
