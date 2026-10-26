'use strict';
// 接口自动化测试：覆盖验收清单的 7 条流程，以及并发防超卖、防重复提交、权限等规则。
// 运行：npm test（会在临时目录启动一个独立的服务，不影响正式数据）
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = 'test-password-123';
let dataDir;
let proc;

function req(method, url, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(BASE + url, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) { /* ignore */ }
        resolve({ status: res.statusCode, data });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// 订阅实时推送，收集收到的事件
function listen(url) {
  const events = [];
  let request;
  const ready = new Promise((resolve) => {
    request = http.get(BASE + url, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString();
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /event: (.+)/.exec(block);
          const data = /data: (.+)/.exec(block);
          if (ev) {
            events.push({ name: ev[1], data: data ? JSON.parse(data[1]) : null });
            if (ev[1] === 'hello') resolve();
          }
        }
      });
    });
  });
  return { events, ready, close: () => request.destroy() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(30); }
  return false;
}

let admin;
let tomorrow;
async function newCustomer() {
  const r = await req('POST', '/api/customer/session');
  assert.equal(r.status, 200);
  return r.data.token;
}
let reqSeq = 0;
function orderBody(items, extra = {}) {
  return {
    client_request_id: `test-${Date.now()}-${++reqSeq}`,
    items,
    pickup_name: '测试客户',
    pickup_contact: '13900000000',
    pickup_date: tomorrow,
    pickup_slot: '00:00-23:59',
    note: '',
    ...extra,
  };
}
async function stockOf(specId) {
  const r = await req('GET', '/api/admin/catalog', { token: admin });
  for (const p of r.data.products) for (const s of p.specs) if (s.id === specId) return s.stock;
  return undefined;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snack-test-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: ADMIN_PW, SEED_DEMO: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (c) => { log += c; });
  proc.stderr.on('data', (c) => { log += c; });
  const ok = await waitFor(() => log.includes('已启动'), 8000);
  assert.ok(ok, '服务没有启动：\n' + log);

  const login = await req('POST', '/api/admin/login', { body: { username: 'boss', password: ADMIN_PW } });
  assert.equal(login.status, 200);
  admin = login.data.token;
  // 设置一个全天时段，保证任何时间跑测试都能选到“明天”
  const shop = await req('PUT', '/api/admin/shop', { token: admin, body: { name: '测试小店', pickup_slots: [{ start: '00:00', end: '23:59' }], lead_minutes: 0, days_ahead: 2 } });
  assert.equal(shop.status, 200);
  tomorrow = shop.data.preview.dates[1].date;
});

after(() => {
  if (proc) proc.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

let cola; // { productId, single, box }

test('1. 商家新增一件零食，客户能看到', async () => {
  const cat = await req('POST', '/api/admin/categories', { token: admin, body: { name: '饮料' } });
  assert.equal(cat.status, 200);
  const catId = cat.data.categories[0].id;
  const r = await req('POST', '/api/admin/products', {
    token: admin,
    body: { name: '测试可乐', category_id: catId, description: '冰的', status: 'on', specs: [{ name: '单罐', price_cents: 300, stock: 50 }, { name: '整箱', price_cents: 6000, stock: 2 }] },
  });
  assert.equal(r.status, 200);
  cola = { productId: r.data.product.id, single: r.data.product.specs[0].id, box: r.data.product.specs[1].id };

  const c = await req('GET', '/api/catalog');
  const p = c.data.products.find((x) => x.name === '测试可乐');
  assert.ok(p, '客户端商品列表里应该有新商品');
  assert.equal(p.specs.length, 2);
  assert.equal(p.specs[0].price_cents, 300);
  assert.equal(p.specs[1].price_cents, 6000);
  assert.equal(c.data.categories[0].name, '饮料');

  // 下架后客户看不到，恢复后又能看到
  await req('POST', `/api/admin/products/${cola.productId}/status`, { token: admin, body: { status: 'off' } });
  assert.ok(!(await req('GET', '/api/catalog')).data.products.some((x) => x.id === cola.productId));
  await req('POST', `/api/admin/products/${cola.productId}/status`, { token: admin, body: { status: 'on' } });
  assert.ok((await req('GET', '/api/catalog')).data.products.some((x) => x.id === cola.productId));
});

const ctx = {};

test('2. 两位客户分别下单，商家能清楚区分每个人要什么', async () => {
  ctx.li = await newCustomer();
  ctx.wang = await newCustomer();
  const chips = await req('POST', '/api/admin/products', { token: admin, body: { name: '测试薯片', specs: [{ name: '大包', price_cents: 800, stock: 10 }] } });
  ctx.chips = chips.data.product.specs[0].id;

  const a = await req('POST', '/api/orders', { token: ctx.li, body: orderBody([{ spec_id: cola.single, quantity: 2, unit_price_cents: 300 }, { spec_id: ctx.chips, quantity: 3, unit_price_cents: 800 }], { pickup_name: '小李', pickup_contact: '13811112222', note: '可乐要冰的' }) });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const b = await req('POST', '/api/orders', { token: ctx.wang, body: orderBody([{ spec_id: cola.box, quantity: 1, unit_price_cents: 6000 }], { pickup_name: '小王', pickup_contact: 'wx_xiaowang' }) });
  assert.equal(b.status, 200);
  ctx.orderLi = a.data.order;
  ctx.orderWang = b.data.order;
  assert.equal(ctx.orderLi.status, 'pending');
  assert.equal(ctx.orderLi.total_cents, 2 * 300 + 3 * 800);
  assert.match(ctx.orderLi.pickup_code, /^\d{4}$/);
  assert.notEqual(ctx.orderLi.pickup_code, ctx.orderWang.pickup_code);

  const list = await req('GET', '/api/admin/orders?status=pending', { token: admin });
  assert.equal(list.status, 200);
  const li = list.data.orders.find((o) => o.id === ctx.orderLi.id);
  const wang = list.data.orders.find((o) => o.id === ctx.orderWang.id);
  assert.equal(li.pickup_name, '小李');
  assert.equal(li.pickup_contact, '13811112222');
  assert.equal(li.note, '可乐要冰的');
  assert.deepEqual(li.items.map((i) => [i.product_name, i.spec_name, i.quantity]), [['测试可乐', '单罐', 2], ['测试薯片', '大包', 3]]);
  assert.deepEqual(wang.items.map((i) => [i.product_name, i.spec_name, i.quantity]), [['测试可乐', '整箱', 1]]);

  // 按商品汇总 / 按客户查看
  const prep = await req('GET', `/api/admin/prep?date=${tomorrow}`, { token: admin });
  const byName = Object.fromEntries(prep.data.todo.products.map((p) => [`${p.product_name}/${p.spec_name}`, p.quantity]));
  assert.deepEqual(byName, { '测试可乐/单罐': 2, '测试可乐/整箱': 1, '测试薯片/大包': 3 });
  assert.equal(prep.data.todo.orders.length, 2);

  // 搜索：按取货人、电话、订单号
  for (const q of ['小李', '1381111', ctx.orderLi.order_no, ctx.orderLi.pickup_code]) {
    const s = await req('GET', `/api/admin/orders?status=all&q=${encodeURIComponent(q)}`, { token: admin });
    assert.ok(s.data.orders.some((o) => o.id === ctx.orderLi.id), `搜索「${q}」应能找到小李的订单`);
    assert.ok(!s.data.orders.some((o) => o.id === ctx.orderWang.id), `搜索「${q}」不应出现小王的订单`);
  }
});

test('3. 商家接单、备货完成，客户能实时看到状态变化', async () => {
  const sse = listen(`/api/events?token=${ctx.li}`);
  await sse.ready;
  const acc = await req('POST', `/api/admin/orders/${ctx.orderLi.id}/accept`, { token: admin, body: {} });
  assert.equal(acc.status, 200);
  assert.equal(acc.data.order.status, 'preparing');
  assert.ok(await waitFor(() => sse.events.some((e) => e.name === 'order.updated' && e.data.status === 'preparing')), '客户应收到“备货中”推送');
  assert.equal((await req('GET', `/api/orders/${ctx.orderLi.id}`, { token: ctx.li })).data.order.status, 'preparing');

  // 已接单后客户不能自己取消
  const c = await req('POST', `/api/orders/${ctx.orderLi.id}/cancel`, { token: ctx.li, body: {} });
  assert.equal(c.status, 409);
  assert.match(c.data.message, /联系商家/);

  const rd = await req('POST', `/api/admin/orders/${ctx.orderLi.id}/ready`, { token: admin, body: {} });
  assert.equal(rd.data.order.status, 'ready');
  assert.ok(await waitFor(() => sse.events.some((e) => e.name === 'order.updated' && e.data.status === 'ready')), '客户应收到“待取货”推送');
  const mine = await req('GET', `/api/orders/${ctx.orderLi.id}`, { token: ctx.li });
  assert.equal(mine.data.order.status_text, '待取货');
  sse.close();

  // 不能跳过步骤
  const skip = await req('POST', `/api/admin/orders/${ctx.orderWang.id}/complete`, { token: admin, body: { pickup_code: ctx.orderWang.pickup_code } });
  assert.equal(skip.status, 409);
});

test('4. 客户到店，商家用取货码核对并完成订单', async () => {
  const found = await req('GET', `/api/admin/pickup/${ctx.orderLi.pickup_code}`, { token: admin });
  assert.equal(found.status, 200);
  assert.equal(found.data.orders.length, 1);
  assert.equal(found.data.orders[0].pickup_name, '小李');

  const wrong = String((Number(ctx.orderLi.pickup_code) + 1) % 10000).padStart(4, '0');
  const bad = await req('POST', `/api/admin/orders/${ctx.orderLi.id}/complete`, { token: admin, body: { pickup_code: wrong } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'CODE_MISMATCH');

  const ok = await req('POST', `/api/admin/orders/${ctx.orderLi.id}/complete`, { token: admin, body: { pickup_code: ctx.orderLi.pickup_code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.order.status, 'completed');
  // 完成后取货码不再能查到
  assert.equal((await req('GET', `/api/admin/pickup/${ctx.orderLi.pickup_code}`, { token: admin })).data.orders.length, 0);
  // 备货汇总里已完成单独统计
  const prep = await req('GET', `/api/admin/prep?date=${tomorrow}`, { token: admin });
  assert.ok(prep.data.completed.orders.some((o) => o.id === ctx.orderLi.id));
  assert.ok(!prep.data.todo.orders.some((o) => o.id === ctx.orderLi.id));
});

test('5. 全流程不需要在线支付', async () => {
  const o = (await req('GET', `/api/orders/${ctx.orderLi.id}`, { token: ctx.li })).data.order;
  assert.equal(o.status, 'completed');
  // 没有任何付款操作，订单照样能完成（付款在线下进行，扫收款码是可选的）
  assert.equal(o.pay_status, 'unpaid');
  for (const k of Object.keys(o)) assert.ok(!/wallet|balance|transaction|prepay/i.test(k), `订单里不应有在线支付字段：${k}`);
  for (const url of ['/api/pay', '/api/payments', '/api/wallet']) {
    assert.equal((await req('POST', url, { token: ctx.li, body: {} })).status, 404);
  }
});

test('6. 商品改价不影响旧订单；取消、拒单会正确释放库存', async () => {
  // 改价
  const p = await req('PUT', `/api/admin/products/${cola.productId}`, {
    token: admin,
    body: { name: '测试可乐', status: 'on', specs: [{ id: cola.single, name: '单罐', price_cents: 350, stock: 48 }, { id: cola.box, name: '整箱', price_cents: 6000, stock: 1 }] },
  });
  assert.equal(p.status, 200);
  const old = (await req('GET', `/api/orders/${ctx.orderLi.id}`, { token: ctx.li })).data.order;
  assert.equal(old.items[0].unit_price_cents, 300, '旧订单单价应保持 3.00');
  assert.equal(old.total_cents, 3000);

  // 客户确认页还是旧价格时提交：提示重新确认，不会按旧价下单
  const zhao = await newCustomer();
  const stale = await req('POST', '/api/orders', { token: zhao, body: orderBody([{ spec_id: cola.single, quantity: 1, unit_price_cents: 300 }]) });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'PRICE_CHANGED');
  assert.equal(stale.data.price_changes[0].new_price_cents, 350);
  assert.equal(stale.data.quote.lines[0].unit_price_cents, 350);
  assert.equal(await stockOf(cola.single), 48, '价格不符时不能扣库存');

  // 客户取消：库存加回
  const before = await stockOf(cola.single);
  const o1 = await req('POST', '/api/orders', { token: zhao, body: orderBody([{ spec_id: cola.single, quantity: 5, unit_price_cents: 350 }]) });
  assert.equal(o1.status, 200);
  assert.equal(await stockOf(cola.single), before - 5);
  const cancel = await req('POST', `/api/orders/${o1.data.order.id}/cancel`, { token: zhao, body: { reason: '不想要了' } });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.order.status, 'cancelled');
  assert.equal(await stockOf(cola.single), before);
  // 重复取消不会再加一次库存
  assert.equal((await req('POST', `/api/orders/${o1.data.order.id}/cancel`, { token: zhao, body: {} })).status, 409);
  assert.equal(await stockOf(cola.single), before);

  // 商家拒单：必须写原因，库存加回，客户能看到原因
  const o2 = await req('POST', '/api/orders', { token: zhao, body: orderBody([{ spec_id: cola.single, quantity: 3, unit_price_cents: 350 }]) });
  assert.equal(await stockOf(cola.single), before - 3);
  const noReason = await req('POST', `/api/admin/orders/${o2.data.order.id}/reject`, { token: admin, body: { reason: '' } });
  assert.equal(noReason.status, 400);
  const rej = await req('POST', `/api/admin/orders/${o2.data.order.id}/reject`, { token: admin, body: { reason: '商品缺货' } });
  assert.equal(rej.data.order.status, 'rejected');
  assert.equal(await stockOf(cola.single), before);
  const seen = (await req('GET', `/api/orders/${o2.data.order.id}`, { token: zhao })).data.order;
  assert.equal(seen.close_reason, '商品缺货');

  // 商家取消已接单的订单：库存加回
  const o3 = await req('POST', '/api/orders', { token: zhao, body: orderBody([{ spec_id: cola.single, quantity: 2, unit_price_cents: 350 }]) });
  await req('POST', `/api/admin/orders/${o3.data.order.id}/accept`, { token: admin, body: {} });
  const mc = await req('POST', `/api/admin/orders/${o3.data.order.id}/cancel`, { token: admin, body: { reason: '客户要求取消' } });
  assert.equal(mc.data.order.status, 'cancelled');
  assert.equal(await stockOf(cola.single), before);

  // 已取消、已拒绝的订单不进备货汇总
  const prep = await req('GET', `/api/admin/prep?date=${tomorrow}`, { token: admin });
  const all = [...prep.data.todo.orders, ...prep.data.ready.orders, ...prep.data.completed.orders].map((o) => o.id);
  for (const o of [o1, o2, o3]) assert.ok(!all.includes(o.data.order.id));
});

test('7. 客户看不到别人的订单，也进不了商家后台', async () => {
  // 小王看小李的订单
  const peek = await req('GET', `/api/orders/${ctx.orderLi.id}`, { token: ctx.wang });
  assert.equal(peek.status, 404);
  const mine = await req('GET', '/api/orders', { token: ctx.wang });
  assert.ok(mine.data.orders.every((o) => o.id !== ctx.orderLi.id));
  // 小王取消小李的订单
  assert.equal((await req('POST', `/api/orders/${ctx.orderLi.id}/cancel`, { token: ctx.wang, body: {} })).status, 404);
  // 客户令牌访问商家接口
  for (const [m, u] of [['GET', '/api/admin/orders'], ['GET', '/api/admin/overview'], ['POST', `/api/admin/orders/${ctx.orderWang.id}/accept`], ['POST', '/api/admin/products'], ['GET', '/api/admin/catalog']]) {
    assert.equal((await req(m, u, { token: ctx.wang, body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${u} 应拒绝客户`);
  }
  // 不带令牌
  assert.equal((await req('GET', '/api/admin/orders')).status, 401);
  assert.equal((await req('GET', '/api/orders')).status, 401);
  // 客户的实时推送里收不到别人的订单
  assert.equal((await req('GET', '/api/admin/events?token=' + ctx.wang)).status, 401);
  // 错误密码不能登录
  assert.equal((await req('POST', '/api/admin/login', { body: { username: 'boss', password: 'wrong-password' } })).status, 401);
  // 公开接口里不包含客户联系方式
  const pub = JSON.stringify((await req('GET', '/api/catalog')).data) + JSON.stringify((await req('GET', '/api/shop')).data);
  assert.ok(!pub.includes('13811112222'));
});

test('并发下单不会超卖', async () => {
  const p = await req('POST', '/api/admin/products', { token: admin, body: { name: '限量辣条', specs: [{ name: '单包', price_cents: 100, stock: 5 }] } });
  const spec = p.data.product.specs[0].id;
  const tokens = await Promise.all(Array.from({ length: 12 }, newCustomer));
  const results = await Promise.all(tokens.map((t) => req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: spec, quantity: 1, unit_price_cents: 100 }]) })));
  const ok = results.filter((r) => r.status === 200).length;
  const full = results.filter((r) => r.status === 409 && r.data.code === 'ITEMS_UNAVAILABLE').length;
  assert.equal(ok, 5, '只能成功 5 单');
  assert.equal(full, 7);
  assert.equal(await stockOf(spec), 0);
});

test('重复提交（连点或网络重试）只生成一笔订单', async () => {
  const t = await newCustomer();
  const before = await stockOf(cola.single);
  const body = orderBody([{ spec_id: cola.single, quantity: 1, unit_price_cents: 350 }]);
  const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => req('POST', '/api/orders', { token: t, body })));
  for (const r of [r1, r2, r3]) assert.equal(r.status, 200);
  assert.equal(new Set([r1, r2, r3].map((r) => r.data.order.id)).size, 1);
  assert.equal([r1, r2, r3].filter((r) => r.data.duplicate).length, 2);
  assert.equal(await stockOf(cola.single), before - 1);
  assert.equal((await req('GET', '/api/orders', { token: t })).data.orders.length, 1);
});

test('暂停接单时能看商品但不能下单；取货时段和输入在后台校验', async () => {
  const t = await newCustomer();
  await req('POST', '/api/admin/shop/accepting', { token: admin, body: { accepting: false, pause_message: '今天进货' } });
  assert.equal((await req('GET', '/api/catalog')).status, 200);
  const shop = (await req('GET', '/api/shop')).data.shop;
  assert.equal(shop.accepting_orders, false);
  const r = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: cola.single, quantity: 1, unit_price_cents: 350 }]) });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'SHOP_PAUSED');
  await req('POST', '/api/admin/shop/accepting', { token: admin, body: { accepting: true } });

  const badSlot = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: cola.single, quantity: 1, unit_price_cents: 350 }], { pickup_slot: '03:00-04:00' }) });
  assert.equal(badSlot.status, 409);
  const farDate = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: cola.single, quantity: 1, unit_price_cents: 350 }], { pickup_date: '2099-01-01' }) });
  assert.equal(farDate.status, 409);
  const noName = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: cola.single, quantity: 1, unit_price_cents: 350 }], { pickup_name: '  ' }) });
  assert.equal(noName.status, 400);
  const negQty = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: cola.single, quantity: -2, unit_price_cents: 350 }]) });
  assert.equal(negQty.status, 400);
  const soldOut = await req('POST', '/api/admin/products', { token: admin, body: { name: '售罄饼干', status: 'sold_out', specs: [{ name: '盒', price_cents: 500, stock: 10 }] } });
  const so = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: soldOut.data.product.specs[0].id, quantity: 1, unit_price_cents: 500 }]) });
  assert.equal(so.status, 409);
});

test('删除商品后旧订单仍完整可查', async () => {
  const p = await req('POST', '/api/admin/products', { token: admin, body: { name: '临时糖果', specs: [{ name: '袋', price_cents: 700, stock: null }] } });
  const spec = p.data.product.specs[0].id;
  const t = await newCustomer();
  const o = await req('POST', '/api/orders', { token: t, body: orderBody([{ spec_id: spec, quantity: 2, unit_price_cents: 700 }]) });
  assert.equal(o.status, 200);
  assert.equal(await stockOf(spec), null, '不限库存保持不限');
  await req('DELETE', `/api/admin/products/${p.data.product.id}`, { token: admin });
  assert.ok(!(await req('GET', '/api/catalog')).data.products.some((x) => x.id === p.data.product.id));
  const after = (await req('GET', `/api/orders/${o.data.order.id}`, { token: t })).data.order;
  assert.equal(after.items[0].product_name, '临时糖果');
  assert.equal(after.total_cents, 1400);
});

function rawReq(method, url, buf, token) {
  return new Promise((resolve, reject) => {
    const r = http.request(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': buf.length, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        let data = null;
        try { data = JSON.parse(body.toString()); } catch (_) { /* ignore */ }
        resolve({ status: res.statusCode, headers: res.headers, body, data });
      });
    });
    r.on('error', reject);
    r.end(buf);
  });
}

test('安卓安装包：只有商家能上传，客户能下载；下载页可访问', async () => {
  const before = await req('GET', '/api/app-downloads');
  assert.equal(before.status, 200);
  assert.equal(before.data.apps.customer.available, false);

  // 一个最小的“像 APK 的” zip
  const fakeApk = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....AndroidManifest.xml....classes.dex....')]);
  const customer = await newCustomer();
  assert.equal((await rawReq('POST', '/api/admin/apps/customer', fakeApk, customer)).status, 401, '客户不能上传');
  assert.equal((await rawReq('POST', '/api/admin/apps/customer', fakeApk)).status, 401, '未登录不能上传');
  const notApk = await rawReq('POST', '/api/admin/apps/customer', Buffer.from('PK\u0003\u0004 just a zip'), admin);
  assert.equal(notApk.status, 400);
  assert.equal((await rawReq('POST', '/api/admin/apps/hacker', fakeApk, admin)).status, 404);

  const up = await rawReq('POST', '/api/admin/apps/customer', fakeApk, admin);
  assert.equal(up.status, 200);
  assert.equal(up.data.apps.customer.available, true);
  assert.equal(up.data.apps.customer.size, fakeApk.length);
  assert.equal(up.data.apps.merchant.available, false);

  const dl = await rawReq('GET', '/downloads/snack-customer.apk', Buffer.alloc(0));
  assert.equal(dl.status, 200);
  assert.equal(dl.headers['content-type'], 'application/vnd.android.package-archive');
  assert.match(dl.headers['content-disposition'], /attachment/);
  assert.ok(dl.body.equals(fakeApk));
  // 只能下载这两个固定文件
  for (const bad of ['/downloads/../shop.db', '/downloads/%2e%2e%2fshop.db', '/downloads/shop.db', '/downloads/snack-customer.apk.uploading']) {
    assert.equal((await rawReq('GET', bad, Buffer.alloc(0))).status, 404, bad);
  }
  const page = await rawReq('GET', '/download', Buffer.alloc(0));
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /download\.js/);

  const del = await req('DELETE', '/api/admin/apps/customer', { token: admin });
  assert.equal(del.data.apps.customer.available, false);
  assert.equal((await rawReq('GET', '/downloads/snack-customer.apk', Buffer.alloc(0))).status, 404);
});

test('收款码付款：客户标记已付款，商家核对；拒单后待退款；权限隔离', async () => {
  const t = await newCustomer();
  const other = await newCustomer();
  const p = await req('POST', '/api/admin/products', { token: admin, body: { name: '付款测试饮料', specs: [{ name: '瓶', price_cents: 500, stock: null }] } });
  const spec = p.data.product.specs[0].id;
  const place = async (tok) => (await req('POST', '/api/orders', { token: tok, body: orderBody([{ spec_id: spec, quantity: 2, unit_price_cents: 500 }]) })).data.order;

  // 商家还没上传收款码：客户不能标记扫码付款
  const o1 = await place(t);
  assert.equal(o1.pay_status, 'unpaid');
  assert.equal((await req('POST', `/api/orders/${o1.id}/paid`, { token: t, body: { method: 'wechat' } })).status, 409);

  // 上传收款码（用图片上传接口的地址）
  const shop = await req('PUT', '/api/admin/shop', { token: admin, body: { pay_wechat_qr: '/uploads/abc123.jpg', pay_note: '付款时备注取货码' } });
  assert.equal(shop.status, 200);
  const pub = (await req('GET', '/api/shop')).data.shop.pay;
  assert.equal(pub.wechat_qr, '/uploads/abc123.jpg');
  assert.equal(pub.alipay_qr, '');
  assert.equal((await req('PUT', '/api/admin/shop', { token: admin, body: { pay_alipay_qr: 'https://evil.example/x.png' } })).status, 400, '收款码只能是上传的图片');

  // 支付宝没开通
  assert.equal((await req('POST', `/api/orders/${o1.id}/paid`, { token: t, body: { method: 'alipay' } })).status, 409);
  // 别人不能替我标记，也不能看
  assert.equal((await req('POST', `/api/orders/${o1.id}/paid`, { token: other, body: { method: 'wechat' } })).status, 404);
  // 客户不能调用商家的收款接口
  assert.equal((await req('POST', `/api/admin/orders/${o1.id}/payment`, { token: t, body: { action: 'confirm' } })).status, 401);

  // 客户说已付款 → 商家端能筛出来
  const sse = listen('/api/admin/events?token=' + admin);
  await sse.ready;
  const c1 = await req('POST', `/api/orders/${o1.id}/paid`, { token: t, body: { method: 'wechat' } });
  assert.equal(c1.status, 200);
  assert.equal(c1.data.order.pay_status, 'claimed');
  assert.equal(c1.data.order.pay_method, 'wechat');
  assert.ok(await waitFor(() => sse.events.some((e) => e.name === 'order.updated' && e.data.pay_claimed && e.data.id === o1.id)), '商家应实时收到“客户说已付款”');
  sse.close();
  // 重复点不会出错
  assert.equal((await req('POST', `/api/orders/${o1.id}/paid`, { token: t, body: { method: 'wechat' } })).data.order.pay_status, 'claimed');
  const claimedList = await req('GET', '/api/admin/orders?pay=claimed', { token: admin });
  assert.ok(claimedList.data.orders.some((o) => o.id === o1.id));
  assert.ok((await req('GET', '/api/admin/overview', { token: admin })).data.pay_claimed >= 1);

  // 商家没查到 → 回到未付款，客户能看到说明；“没收到”必须写说明
  assert.equal((await req('POST', `/api/admin/orders/${o1.id}/payment`, { token: admin, body: { action: 'reject', note: '' } })).status, 400);
  const r1 = await req('POST', `/api/admin/orders/${o1.id}/payment`, { token: admin, body: { action: 'reject', note: '没查到这笔转账' } });
  assert.equal(r1.data.order.pay_status, 'unpaid');
  const seen = (await req('GET', `/api/orders/${o1.id}`, { token: t })).data.order;
  assert.equal(seen.pay_note, '没查到这笔转账');

  // 再次标记 → 商家确认收款
  await req('POST', `/api/orders/${o1.id}/paid`, { token: t, body: { method: 'wechat' } });
  const ok1 = await req('POST', `/api/admin/orders/${o1.id}/payment`, { token: admin, body: { action: 'confirm' } });
  assert.equal(ok1.data.order.pay_status, 'paid');
  assert.equal(ok1.data.order.pay_status_text, '已收款');
  assert.equal((await req('POST', `/api/orders/${o1.id}/paid`, { token: t, body: { method: 'wechat' } })).status, 409, '已收款后不能再标记');
  // 没有退款前不能标退款
  assert.equal((await req('POST', `/api/admin/orders/${o1.id}/payment`, { token: admin, body: { action: 'refund' } })).status, 409);

  // 已收款的订单被拒单 → 待退款 → 商家标记已退款
  const rej = await req('POST', `/api/admin/orders/${o1.id}/reject`, { token: admin, body: { reason: '商品缺货' } });
  assert.equal(rej.data.order.refund_due, true);
  assert.ok((await req('GET', '/api/admin/orders?pay=refund', { token: admin })).data.orders.some((o) => o.id === o1.id));
  const ref = await req('POST', `/api/admin/orders/${o1.id}/payment`, { token: admin, body: { action: 'refund', note: '已微信转回' } });
  assert.equal(ref.data.order.pay_status, 'refunded');
  assert.equal(ref.data.order.refund_due, false);
  const evs = (await req('GET', `/api/orders/${o1.id}`, { token: t })).data.order.events.map((e) => e.status);
  for (const s of ['pay_claimed', 'pay_rejected', 'pay_confirmed', 'rejected', 'refunded']) assert.ok(evs.includes(s), `记录里应有 ${s}`);

  // 到店当面付：商家直接标记收款（现金）
  const o2 = await place(t);
  const cash = await req('POST', `/api/admin/orders/${o2.id}/payment`, { token: admin, body: { action: 'mark_paid', method: 'cash' } });
  assert.equal(cash.data.order.pay_status, 'paid');
  assert.equal(cash.data.order.pay_method_text, '当面');

  // 客户自己取消一笔已标记付款的订单 → 进入待退款
  const o3 = await place(t);
  await req('POST', `/api/orders/${o3.id}/paid`, { token: t, body: { method: 'wechat' } });
  const cc = await req('POST', `/api/orders/${o3.id}/cancel`, { token: t, body: {} });
  assert.equal(cc.data.order.refund_due, true);

  // 已取消的订单不能再标记付款
  assert.equal((await req('POST', `/api/orders/${o3.id}/paid`, { token: t, body: { method: 'wechat' } })).status, 409);
  await req('PUT', '/api/admin/shop', { token: admin, body: { pay_wechat_qr: '', pay_note: '' } });
});
