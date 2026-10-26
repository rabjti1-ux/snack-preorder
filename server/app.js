'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { route, match, readJson, readBody, sendJson, sendFile, securityHeaders, clientIp } = require('./http');
const { HttpError, rateLimit, int } = require('./util');
const auth = require('./auth');
const shop = require('./shop');
const catalog = require('./catalog');
const orders = require('./orders');
const events = require('./events');
const demo = require('./demo');
const apps = require('./apps');

const uploadsDir = path.join(config.dataDir, 'uploads');

// 订单变化后通知商家和下单客户
function notifyOrder(result, { created = false, ...extra } = {}) {
  const o = result.order;
  const payload = {
    id: o.id, order_no: o.order_no, status: o.status, status_text: o.status_text,
    pay_status: o.pay_status, pay_status_text: o.pay_status_text,
    kind: extra.payClaimed || extra.pay ? 'pay' : 'status', // pay = 只是付款状态变了
  };
  if (extra.payClaimed) {
    events.toAdmins('order.updated', { ...payload, pay_claimed: true, pickup_name: o.pickup_name, total_cents: o.total_cents, pay_method_text: o.pay_method_text });
  } else if (created) {
    events.toAdmins('order.created', { ...payload, pickup_name: o.pickup_name, total_cents: o.total_cents, item_count: o.item_count, pickup_date: o.pickup_date, pickup_slot: o.pickup_slot });
  } else {
    events.toAdmins('order.updated', payload);
  }
  events.toCustomer(result.customerId, 'order.updated', { ...payload, close_reason: o.close_reason });
}
const catalogChanged = () => events.toAll('catalog.changed', { at: Date.now() });
const shopChanged = () => events.toAll('shop.changed', { at: Date.now() });

// ======================== 客户接口 ========================

// 创建匿名客户身份（首次打开页面时调用）
route('POST', '/api/customer/session', (ctx) => {
  rateLimit(`newcustomer:${ctx.ip}`, 30, 3600_000);
  const { token, customer } = auth.createCustomer();
  return { token, customer };
});

route('GET', '/api/customer/me', (ctx) => ({ customer: auth.requireCustomer(ctx.req) }));

route('GET', '/api/shop', () => ({ shop: shop.publicShop(), server_time: new Date().toISOString(), time_zone: config.timeZone }));

route('GET', '/api/catalog', () => catalog.publicCatalog());

route('GET', '/api/products/:id', (ctx) => ({ product: catalog.getProduct(int(ctx.params.id, { field: '商品' }), { includeOff: false }) }));

route('POST', '/api/cart/quote', async (ctx) => {
  const body = await readJson(ctx.req);
  return orders.quote(body.items);
});

route('POST', '/api/orders', async (ctx) => {
  const customer = auth.requireCustomer(ctx.req);
  rateLimit(`order:${customer.id}`, 20, 600_000);
  const body = await readJson(ctx.req);
  const result = orders.createOrder(customer.id, body);
  if (!result.duplicate) {
    notifyOrder({ order: result.order, customerId: customer.id }, { created: true });
    catalogChanged();
  }
  return { order: result.order, duplicate: result.duplicate };
});

route('GET', '/api/orders', (ctx) => {
  const customer = auth.requireCustomer(ctx.req);
  return { orders: orders.listCustomerOrders(customer.id) };
});

route('GET', '/api/orders/:id', (ctx) => {
  const customer = auth.requireCustomer(ctx.req);
  return { order: orders.getCustomerOrder(customer.id, int(ctx.params.id, { field: '订单' })) };
});

route('POST', '/api/orders/:id/cancel', async (ctx) => {
  const customer = auth.requireCustomer(ctx.req);
  const body = await readJson(ctx.req);
  const result = orders.transition(int(ctx.params.id, { field: '订单' }), 'customer_cancel', { reason: body.reason, customerId: customer.id });
  notifyOrder(result);
  catalogChanged();
  return { order: orders.getCustomerOrder(customer.id, result.order.id) };
});

// 客户：我已付款（扫了商家的收款码）
route('POST', '/api/orders/:id/paid', async (ctx) => {
  const customer = auth.requireCustomer(ctx.req);
  rateLimit(`paid:${customer.id}`, 20, 600_000);
  const body = await readJson(ctx.req);
  const result = orders.customerClaimPaid(customer.id, int(ctx.params.id, { field: '订单' }), body);
  if (result.changed) notifyOrder(result, { payClaimed: true, pay: true });
  return { order: orders.getCustomerOrder(customer.id, result.order.id) };
});

// 客户实时推送
route('GET', '/api/events', (ctx) => {
  const c = auth.customerByToken(ctx.query.get('token'));
  if (!c) throw new HttpError(401, 'CUSTOMER_AUTH', '身份已失效');
  events.subscribe(ctx.req, ctx.res, { kind: 'customer', customerId: c.id });
  return undefined;
});

// ======================== 商家接口 ========================

route('POST', '/api/admin/login', async (ctx) => {
  rateLimit(`login:${ctx.ip}`, 10, 10 * 60_000);
  const body = await readJson(ctx.req);
  return auth.login(body.username, body.password);
});

route('POST', '/api/admin/logout', (ctx) => { auth.logout(ctx.req); return { ok: true }; });

route('GET', '/api/admin/me', (ctx) => ({ admin: auth.requireAdmin(ctx.req) }));

route('POST', '/api/admin/password', async (ctx) => {
  const admin = auth.requireAdmin(ctx.req);
  const body = await readJson(ctx.req);
  auth.changePassword(admin, body.old_password, body.new_password);
  return { ok: true };
});

route('GET', '/api/admin/overview', (ctx) => {
  auth.requireAdmin(ctx.req);
  return { ...orders.overview(), shop: shop.publicShop() };
});

route('GET', '/api/admin/orders', (ctx) => {
  auth.requireAdmin(ctx.req);
  return orders.adminListOrders({
    status: ctx.query.get('status') || 'pending', q: ctx.query.get('q') || '', date: ctx.query.get('date') || '', pay: ctx.query.get('pay') || '',
  });
});

route('GET', '/api/admin/orders/:id', (ctx) => {
  auth.requireAdmin(ctx.req);
  return { order: orders.adminGetOrder(int(ctx.params.id, { field: '订单' })) };
});

for (const action of ['accept', 'ready', 'complete', 'reject', 'cancel']) {
  route('POST', `/api/admin/orders/:id/${action}`, async (ctx) => {
    auth.requireAdmin(ctx.req);
    const body = await readJson(ctx.req);
    const result = orders.transition(int(ctx.params.id, { field: '订单' }), action, { reason: body.reason, pickupCode: body.pickup_code });
    notifyOrder(result);
    if (result.released) catalogChanged();
    return { order: orders.adminGetOrder(result.order.id) };
  });
}

// 商家：确认收款 / 没收到 / 标记已收款 / 已退款
route('POST', '/api/admin/orders/:id/payment', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const body = await readJson(ctx.req);
  const result = orders.merchantPayment(int(ctx.params.id, { field: '订单' }), body);
  notifyOrder(result, { pay: true });
  return { order: orders.adminGetOrder(result.order.id) };
});

route('GET', '/api/admin/pickup/:code', (ctx) => {
  auth.requireAdmin(ctx.req);
  return { orders: orders.findByPickupCode(ctx.params.code) };
});

route('GET', '/api/admin/prep', (ctx) => {
  auth.requireAdmin(ctx.req);
  return orders.prepSummary({ date: ctx.query.get('date') || '', slot: ctx.query.get('slot') || '' });
});

route('GET', '/api/admin/catalog', (ctx) => {
  auth.requireAdmin(ctx.req);
  return catalog.adminCatalog();
});

route('GET', '/api/admin/products/:id', (ctx) => {
  auth.requireAdmin(ctx.req);
  return { product: catalog.getProduct(int(ctx.params.id, { field: '商品' })) };
});

route('POST', '/api/admin/products', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const product = catalog.createProduct(await readJson(ctx.req));
  catalogChanged();
  return { product };
});

route('PUT', '/api/admin/products/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const product = catalog.updateProduct(int(ctx.params.id, { field: '商品' }), await readJson(ctx.req));
  catalogChanged();
  return { product };
});

route('DELETE', '/api/admin/products/:id', (ctx) => {
  auth.requireAdmin(ctx.req);
  catalog.deleteProduct(int(ctx.params.id, { field: '商品' }));
  catalogChanged();
  return { ok: true };
});

route('POST', '/api/admin/products/:id/status', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const body = await readJson(ctx.req);
  const product = catalog.setProductStatus(int(ctx.params.id, { field: '商品' }), body.status);
  catalogChanged();
  return { product };
});

route('POST', '/api/admin/products/:id/move', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const body = await readJson(ctx.req);
  catalog.moveProduct(int(ctx.params.id, { field: '商品' }), body.direction === 'up' ? 'up' : 'down');
  catalogChanged();
  return catalog.adminCatalog();
});

route('POST', '/api/admin/categories', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const categories = catalog.createCategory(await readJson(ctx.req));
  catalogChanged();
  return { categories };
});

route('PUT', '/api/admin/categories/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const categories = catalog.renameCategory(int(ctx.params.id, { field: '分类' }), await readJson(ctx.req));
  catalogChanged();
  return { categories };
});

route('DELETE', '/api/admin/categories/:id', (ctx) => {
  auth.requireAdmin(ctx.req);
  const categories = catalog.deleteCategory(int(ctx.params.id, { field: '分类' }));
  catalogChanged();
  return { categories };
});

route('POST', '/api/admin/categories/:id/move', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const body = await readJson(ctx.req);
  const categories = catalog.moveCategory(int(ctx.params.id, { field: '分类' }), body.direction === 'up' ? 'up' : 'down');
  catalogChanged();
  return { categories };
});

// 上传图片：页面里先压缩成 JPEG 再上传
route('POST', '/api/admin/uploads', async (ctx) => {
  auth.requireAdmin(ctx.req);
  rateLimit(`upload:${ctx.ip}`, 60, 600_000);
  const buf = await readBody(ctx.req, 5 * 1024 * 1024);
  let ext = null;
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = '.jpg';
  else if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = '.png';
  else if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ext = '.webp';
  else if (buf.length > 6 && buf.slice(0, 4).toString() === 'GIF8') ext = '.gif';
  if (!ext) throw new HttpError(400, 'BAD_IMAGE', '只支持 JPG、PNG、WebP、GIF 图片');
  const name = crypto.randomBytes(12).toString('hex') + ext;
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return { url: `/uploads/${name}` };
});

route('GET', '/api/admin/shop', (ctx) => {
  auth.requireAdmin(ctx.req);
  return { shop: shop.getShop(), preview: shop.publicShop().pickup };
});

route('PUT', '/api/admin/shop', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const s = shop.updateShop(await readJson(ctx.req));
  shopChanged();
  return { shop: s, preview: shop.publicShop().pickup };
});

route('POST', '/api/admin/shop/accepting', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const body = await readJson(ctx.req);
  const s = shop.updateShop({ accepting_orders: !!body.accepting, ...(body.pause_message !== undefined ? { pause_message: body.pause_message } : {}) });
  shopChanged();
  return { shop: s };
});

route('GET', '/api/admin/demo', (ctx) => {
  auth.requireAdmin(ctx.req);
  return demo.demoStats();
});

route('POST', '/api/admin/demo/clear', (ctx) => {
  auth.requireAdmin(ctx.req);
  const result = demo.clearDemo();
  catalogChanged();
  events.toAdmins('order.updated', { id: 0 });
  return result;
});

// 商家实时推送
route('GET', '/api/admin/events', (ctx) => {
  const a = auth.adminByToken(ctx.query.get('token'));
  if (!a) throw new HttpError(401, 'ADMIN_AUTH', '请先登录商家账号');
  events.subscribe(ctx.req, ctx.res, { kind: 'admin' });
  return undefined;
});

// ======================== 手机 APP 下载 ========================

route('GET', '/api/app-downloads', () => {
  const s = shop.publicShop();
  return { apps: apps.info(), shop: { name: s.name, image: s.image } };
});

route('POST', '/api/admin/apps/:which', async (ctx) => {
  auth.requireAdmin(ctx.req);
  rateLimit(`apk:${ctx.ip}`, 20, 600_000);
  const buf = await readBody(ctx.req, 50 * 1024 * 1024);
  return { apps: apps.save(ctx.params.which, buf) };
});

route('DELETE', '/api/admin/apps/:which', (ctx) => {
  auth.requireAdmin(ctx.req);
  return { apps: apps.remove(ctx.params.which) };
});

route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString() }));

// ======================== 请求入口 ========================

async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const ctx = { req, res, query: url.searchParams, params: {}, ip: clientIp(req) };
    try {
      const m = match(req.method, pathname);
      if (!m) throw new HttpError(404, 'NOT_FOUND', '接口不存在');
      if (m.methodNotAllowed) throw new HttpError(405, 'METHOD', '请求方式不正确');
      ctx.params = m.params;
      const data = await m.handler(ctx);
      if (data !== undefined && !res.headersSent) sendJson(res, 200, data);
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) {
        sendJson(res, e.status, { code: e.code, message: e.message, ...(e.extra || {}) });
      } else {
        console.error(new Date().toISOString(), req.method, pathname, e);
        sendJson(res, 500, { code: 'SERVER_ERROR', message: '服务器出错了，请稍后再试' });
      }
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }

  let ok = false;
  if (pathname.startsWith('/uploads/')) {
    ok = sendFile(req, res, uploadsDir, pathname.slice('/uploads/'.length), { immutable: true });
  } else if (pathname.startsWith('/downloads/')) {
    const app = apps.fileFor(pathname.slice('/downloads/'.length));
    if (app) ok = sendFile(req, res, apps.dir, app.file, { downloadName: app.name });
  } else if (pathname === '/download' || pathname === '/download/') {
    ok = sendFile(req, res, config.publicDir, 'download.html');
  } else if (pathname === '/' || pathname === '/index.html') {
    ok = sendFile(req, res, config.publicDir, 'index.html');
  } else if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
    ok = sendFile(req, res, config.publicDir, 'admin.html');
  } else {
    let rel;
    try { rel = decodeURIComponent(pathname.slice(1)); } catch (_) { rel = ''; }
    if (rel && !rel.includes('\0')) ok = sendFile(req, res, config.publicDir, rel);
  }
  if (!ok) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('页面不存在');
  }
}

module.exports = { handle };
