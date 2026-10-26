'use strict';
const crypto = require('node:crypto');
const { get, all, run, tx, SHOP_ID } = require('./db');
const { HttpError, nowIso, localParts, zonedToDate, str, int, isDate } = require('./util');
const { getShop, pickupOptions } = require('./shop');

const ACTIVE = ['pending', 'preparing', 'ready'];
const PAY_TEXT = {
  unpaid: '未付款',
  claimed: '客户说已付款',
  paid: '已收款',
  refunded: '已退款',
};
const PAY_METHOD_TEXT = { wechat: '微信', alipay: '支付宝', cash: '当面' };
const CLOSED = ['rejected', 'cancelled'];

const STATUS_TEXT = {
  pending: '待商家确认',
  preparing: '备货中',
  ready: '待取货',
  completed: '已完成',
  rejected: '已拒绝',
  cancelled: '已取消',
};

// ---------- 购物车报价（价格、库存以服务器为准） ----------

function normalizeItems(items, { withPrice = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'EMPTY_CART', '购物车是空的');
  if (items.length > 50) throw new HttpError(400, 'BAD_INPUT', '一次最多预订 50 种商品');
  const merged = new Map();
  for (const it of items) {
    const specId = int(it && it.spec_id, { field: '商品规格', min: 1 });
    const qty = int(it.quantity, { field: '数量', min: 1, max: 999 });
    const price = withPrice ? int(it.unit_price_cents, { field: '单价', min: 0 }) : null;
    const prev = merged.get(specId);
    if (prev) prev.quantity += qty;
    else merged.set(specId, { spec_id: specId, quantity: qty, unit_price_cents: price });
  }
  for (const m of merged.values()) if (m.quantity > 999) throw new HttpError(400, 'BAD_INPUT', '单件商品数量不能超过 999');
  return [...merged.values()];
}

function loadSpec(specId) {
  return get(
    `SELECT s.id AS spec_id, s.name AS spec_name, s.price_cents, s.stock, s.deleted_at AS spec_deleted,
            p.id AS product_id, p.name AS product_name, p.image, p.status, p.deleted_at AS product_deleted, p.is_demo
     FROM product_specs s JOIN products p ON p.id = s.product_id
     WHERE s.id = ? AND p.shop_id = ?`, specId, SHOP_ID);
}

function lineProblem(row, qty) {
  if (!row || row.spec_deleted || row.product_deleted || row.status === 'off') return { problem: 'unavailable', message: '已下架' };
  if (row.status === 'sold_out' || row.stock === 0) return { problem: 'sold_out', message: '已售罄' };
  if (row.stock !== null && row.stock < qty) return { problem: 'stock_short', message: `库存只剩 ${row.stock} 件`, stock: row.stock };
  return null;
}

function quote(rawItems) {
  const items = normalizeItems(rawItems);
  let total = 0;
  let ok = true;
  const lines = items.map((it) => {
    const row = loadSpec(it.spec_id);
    const prob = lineProblem(row, it.quantity);
    if (prob) ok = false;
    const subtotal = row ? row.price_cents * it.quantity : 0;
    if (!prob) total += subtotal;
    return {
      spec_id: it.spec_id,
      product_id: row ? row.product_id : null,
      product_name: row ? row.product_name : '已删除的商品',
      spec_name: row ? row.spec_name : '',
      image: row ? row.image : '',
      unit_price_cents: row ? row.price_cents : 0,
      quantity: it.quantity,
      subtotal_cents: subtotal,
      stock: row ? row.stock : 0,
      ...(prob || {}),
    };
  });
  return { ok, lines, total_cents: total };
}

// ---------- 订单读取 ----------

function itemsFor(orderIds) {
  const map = new Map();
  if (!orderIds.length) return map;
  const rows = all(
    `SELECT order_id, product_id, spec_id, product_name, spec_name, unit_price_cents, quantity, subtotal_cents, image
     FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY id`, ...orderIds);
  for (const r of rows) {
    if (!map.has(r.order_id)) map.set(r.order_id, []);
    const { order_id, ...rest } = r;
    map.get(order_id).push(rest);
  }
  return map;
}

function shapeOrder(o, items) {
  return {
    id: o.id,
    order_no: o.order_no,
    pickup_code: o.pickup_code,
    status: o.status,
    status_text: STATUS_TEXT[o.status],
    pickup_name: o.pickup_name,
    pickup_contact: o.pickup_contact,
    pickup_date: o.pickup_date,
    pickup_slot: o.pickup_slot,
    note: o.note,
    total_cents: o.total_cents,
    item_count: o.item_count,
    close_reason: o.close_reason,
    closed_by: o.closed_by,
    is_demo: !!o.is_demo,
    pay_status: o.pay_status || 'unpaid',
    pay_status_text: PAY_TEXT[o.pay_status || 'unpaid'],
    pay_method: o.pay_method || '',
    pay_method_text: PAY_METHOD_TEXT[o.pay_method] || '',
    pay_note: o.pay_note || '',
    pay_claimed_at: o.pay_claimed_at || null,
    paid_at: o.paid_at || null,
    refunded_at: o.refunded_at || null,
    // 已付过钱（或客户说付过）的订单被拒单 / 取消：需要商家退款
    refund_due: CLOSED.includes(o.status) && (o.pay_status === 'claimed' || o.pay_status === 'paid'),
    created_at: o.created_at,
    accepted_at: o.accepted_at,
    ready_at: o.ready_at,
    completed_at: o.completed_at,
    closed_at: o.closed_at,
    updated_at: o.updated_at,
    items: items || [],
  };
}

function withItems(rows) {
  const items = itemsFor(rows.map((r) => r.id));
  return rows.map((r) => shapeOrder(r, items.get(r.id)));
}

function getOrderFull(id) {
  const o = get('SELECT * FROM orders WHERE id = ? AND shop_id = ?', id, SHOP_ID);
  if (!o) return null;
  const order = shapeOrder(o, itemsFor([o.id]).get(o.id));
  order.events = all('SELECT status, actor, note, created_at FROM order_events WHERE order_id = ? ORDER BY id', o.id);
  order.customer_id = o.customer_id;
  return order;
}

// 客户只能拿到自己的订单；别人的订单一律当作不存在
function getCustomerOrder(customerId, id) {
  const o = getOrderFull(id);
  if (!o || o.customer_id !== customerId) throw new HttpError(404, 'NOT_FOUND', '找不到这笔预订');
  delete o.customer_id;
  return o;
}

function listCustomerOrders(customerId) {
  const rows = all('SELECT * FROM orders WHERE customer_id = ? AND shop_id = ? ORDER BY id DESC LIMIT 100', customerId, SHOP_ID);
  return withItems(rows);
}

// ---------- 提交预订 ----------

function genPickupCode() {
  for (let len = 4; len <= 6; len++) {
    for (let i = 0; i < 40; i++) {
      const code = String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');
      const used = get(`SELECT 1 FROM orders WHERE shop_id = ? AND pickup_code = ? AND status IN ('pending','preparing','ready')`, SHOP_ID, code);
      if (!used) return code;
    }
  }
  throw new HttpError(500, 'CODE_EXHAUSTED', '暂时无法生成取货码，请稍后再试');
}

function nextOrderNo() {
  const day = localParts().yymmdd;
  const key = `order:${day}`;
  run('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1', key);
  const seq = get('SELECT value FROM counters WHERE name = ?', key).value;
  return day + String(seq).padStart(4, '0');
}

function createOrder(customerId, body) {
  const clientRequestId = str(body.client_request_id, { field: '请求编号', min: 8, max: 64, required: true });
  const items = normalizeItems(body.items, { withPrice: true });
  const pickupName = str(body.pickup_name, { field: '取货人姓名或昵称', required: true, max: 20 });
  const pickupContact = str(body.pickup_contact, { field: '联系方式', required: true, min: 3, max: 30 });
  const note = str(body.note, { field: '备注', max: 200 });
  const pickupDate = body.pickup_date;
  const pickupSlot = typeof body.pickup_slot === 'string' ? body.pickup_slot : '';
  if (!isDate(pickupDate) || !pickupSlot) throw new HttpError(400, 'BAD_INPUT', '请选择取货时间');

  return tx(() => {
    // 同一个请求编号重复提交（连点、网络重试）时直接返回第一次的订单
    const dup = get('SELECT id FROM orders WHERE customer_id = ? AND client_request_id = ?', customerId, clientRequestId);
    if (dup) return { order: getCustomerOrder(customerId, dup.id), duplicate: true };

    const shop = getShop();
    if (!shop.accepting_orders) {
      throw new HttpError(409, 'SHOP_PAUSED', shop.pause_message ? `店铺暂停接单：${shop.pause_message}` : '店铺暂停接单，暂时不能提交预订');
    }

    const day = pickupOptions(shop).dates.find((d) => d.date === pickupDate);
    const slot = day && day.slots.find((s) => s.value === pickupSlot);
    if (!slot) throw new HttpError(409, 'PICKUP_INVALID', '这个取货时间已不可预约，请重新选择');
    if (!slot.available) throw new HttpError(409, 'PICKUP_EXPIRED', '这个取货时段已经来不及了，请换一个时段');

    const problems = [];
    const priceChanges = [];
    const lines = [];
    for (const it of items) {
      const row = loadSpec(it.spec_id);
      const prob = lineProblem(row, it.quantity);
      const name = row ? `${row.product_name}（${row.spec_name}）` : '某件商品';
      if (prob) problems.push({ spec_id: it.spec_id, name, ...prob });
      else if (row.price_cents !== it.unit_price_cents) {
        priceChanges.push({ spec_id: it.spec_id, name, old_price_cents: it.unit_price_cents, new_price_cents: row.price_cents });
      }
      lines.push({ row, qty: it.quantity });
    }
    if (problems.length) {
      throw new HttpError(409, 'ITEMS_UNAVAILABLE', '部分商品库存不足或已下架，请调整后再提交', { problems, quote: quote(items) });
    }
    if (priceChanges.length) {
      throw new HttpError(409, 'PRICE_CHANGED', '商品价格有变化，请确认新价格后再提交', { price_changes: priceChanges, quote: quote(items) });
    }
    const total = lines.reduce((s, l) => s + l.row.price_cents * l.qty, 0);
    if (body.expected_total_cents !== undefined && body.expected_total_cents !== total) {
      throw new HttpError(409, 'PRICE_CHANGED', '订单总额有变化，请确认后再提交', { price_changes: [], quote: quote(items) });
    }

    // 预留库存：条件更新，库存不够时不会扣成负数
    for (const l of lines) {
      if (l.row.stock === null) continue;
      const r = run('UPDATE product_specs SET stock = stock - ? WHERE id = ? AND stock >= ?', l.qty, l.row.spec_id, l.qty);
      if (r.changes !== 1) throw new HttpError(409, 'ITEMS_UNAVAILABLE', '部分商品库存不足，请调整后再提交', { problems: [], quote: quote(items) });
    }

    const now = nowIso();
    const [startTime] = pickupSlot.split('-');
    const isDemo = lines.some((l) => l.row.is_demo) ? 1 : 0;
    const r = run(
      `INSERT INTO orders (shop_id, order_no, customer_id, client_request_id, pickup_code, status, pickup_name, pickup_contact,
         pickup_date, pickup_slot, pickup_at, note, total_cents, item_count, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      SHOP_ID, nextOrderNo(), customerId, clientRequestId, genPickupCode(), pickupName, pickupContact,
      pickupDate, pickupSlot, `${pickupDate} ${startTime}`, note, total, lines.reduce((s, l) => s + l.qty, 0), isDemo, now, now);
    const orderId = Number(r.lastInsertRowid);
    for (const l of lines) {
      run(`INSERT INTO order_items (order_id, product_id, spec_id, product_name, spec_name, unit_price_cents, quantity, subtotal_cents, image)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, l.row.product_id, l.row.spec_id, l.row.product_name, l.row.spec_name, l.row.price_cents, l.qty, l.row.price_cents * l.qty, l.row.image);
    }
    run(`INSERT INTO order_events (order_id, status, actor, note, created_at) VALUES (?, 'pending', 'customer', '', ?)`, orderId, now);
    run('UPDATE customers SET last_name = ?, last_contact = ? WHERE id = ?', pickupName, pickupContact, customerId);
    return { order: getCustomerOrder(customerId, orderId), duplicate: false };
  });
}

// ---------- 状态流转 ----------

const ACTIONS = {
  accept: { from: ['pending'], to: 'preparing', at: 'accepted_at', actor: 'merchant' },
  ready: { from: ['preparing'], to: 'ready', at: 'ready_at', actor: 'merchant' },
  complete: { from: ['ready'], to: 'completed', at: 'completed_at', actor: 'merchant' },
  reject: { from: ['pending'], to: 'rejected', at: 'closed_at', actor: 'merchant', close: true },
  cancel: { from: ['preparing', 'ready'], to: 'cancelled', at: 'closed_at', actor: 'merchant', close: true },
  customer_cancel: { from: ['pending'], to: 'cancelled', at: 'closed_at', actor: 'customer', close: true },
};

function conflictMessage(order, action) {
  if (action === 'customer_cancel') {
    if (order.status === 'preparing' || order.status === 'ready') return '商家已经接单，如需取消请直接联系商家';
    return `这笔预订已经是「${STATUS_TEXT[order.status]}」，不能再取消`;
  }
  if (action === 'complete' && order.status === 'preparing') return '这笔订单还在备货中，请先点「备货完成」';
  return `订单当前是「${STATUS_TEXT[order.status]}」，不能进行这个操作，请刷新后再看`;
}

function releaseStock(orderId) {
  const o = get('SELECT stock_released FROM orders WHERE id = ?', orderId);
  if (!o || o.stock_released) return;
  for (const it of all('SELECT spec_id, quantity FROM order_items WHERE order_id = ?', orderId)) {
    run('UPDATE product_specs SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL AND deleted_at IS NULL', it.quantity, it.spec_id);
  }
  run('UPDATE orders SET stock_released = 1 WHERE id = ?', orderId);
}

function transition(orderId, action, { reason = '', customerId = null, pickupCode = null } = {}) {
  const t = ACTIONS[action];
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND shop_id = ?', orderId, SHOP_ID);
    if (!o || (customerId !== null && o.customer_id !== customerId)) throw new HttpError(404, 'NOT_FOUND', '找不到这笔订单');
    if (!t.from.includes(o.status)) throw new HttpError(409, 'BAD_STATUS', conflictMessage(o, action), { status: o.status });
    let why = '';
    if (t.close) {
      why = str(reason, { field: action === 'reject' ? '拒单原因' : '取消原因', required: t.actor === 'merchant', max: 100 });
    }
    if (action === 'complete' && String(pickupCode || '').trim() !== o.pickup_code) {
      throw new HttpError(400, 'CODE_MISMATCH', '取货码不对，请让客户出示「我的预订」里的取货码再核对');
    }
    const now = nowIso();
    const r = run(
      `UPDATE orders SET status = ?, ${t.at} = ?, updated_at = ?, close_reason = CASE WHEN ? THEN ? ELSE close_reason END,
         closed_by = CASE WHEN ? THEN ? ELSE closed_by END
       WHERE id = ? AND status = ?`,
      t.to, now, now, t.close ? 1 : 0, why, t.close ? 1 : 0, t.actor, o.id, o.status);
    if (r.changes !== 1) throw new HttpError(409, 'BAD_STATUS', '订单状态刚刚变了，请刷新后再看');
    if (t.close) releaseStock(o.id);
    run('INSERT INTO order_events (order_id, status, actor, note, created_at) VALUES (?, ?, ?, ?, ?)', o.id, t.to, t.actor, why, now);
    return { order: getOrderFull(o.id), customerId: o.customer_id, released: !!t.close };
  });
}

// ---------- 付款（扫商家收款码，商家人工核对） ----------

function logEvent(orderId, status, actor, note) {
  run('INSERT INTO order_events (order_id, status, actor, note, created_at) VALUES (?, ?, ?, ?, ?)', orderId, status, actor, note || '', nowIso());
}

// 客户：我已付款
function customerClaimPaid(customerId, orderId, body) {
  const method = body && body.method;
  if (method !== 'wechat' && method !== 'alipay') throw new HttpError(400, 'BAD_INPUT', '请选择付款方式');
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND shop_id = ?', orderId, SHOP_ID);
    if (!o || o.customer_id !== customerId) throw new HttpError(404, 'NOT_FOUND', '找不到这笔预订');
    const shop = getShop();
    if (!(method === 'wechat' ? shop.pay_wechat_qr : shop.pay_alipay_qr)) {
      throw new HttpError(409, 'PAY_NOT_AVAILABLE', '商家没有开通这种付款方式，请到店付款');
    }
    if (!ACTIVE.includes(o.status)) throw new HttpError(409, 'BAD_STATUS', `这笔预订已经是「${STATUS_TEXT[o.status]}」，不需要再付款`);
    if (o.pay_status === 'paid') throw new HttpError(409, 'ALREADY_PAID', '商家已经确认收到这笔钱了');
    if (o.pay_status === 'claimed') return { order: getOrderFull(o.id), customerId, changed: false };
    const now = nowIso();
    run(`UPDATE orders SET pay_status = 'claimed', pay_method = ?, pay_note = '', pay_claimed_at = ?, updated_at = ? WHERE id = ?`, method, now, now, o.id);
    logEvent(o.id, 'pay_claimed', 'customer', PAY_METHOD_TEXT[method]);
    return { order: getOrderFull(o.id), customerId, changed: true };
  });
}

// 商家：确认收款 / 没收到 / 标记已收款（含当面）/ 已退款
function merchantPayment(orderId, body) {
  const action = body && body.action;
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ? AND shop_id = ?', orderId, SHOP_ID);
    if (!o) throw new HttpError(404, 'NOT_FOUND', '找不到这笔订单');
    const now = nowIso();
    if (action === 'confirm') {
      if (o.pay_status !== 'claimed') throw new HttpError(409, 'BAD_PAY_STATUS', `付款状态是「${PAY_TEXT[o.pay_status]}」，不能确认，请刷新后再看`);
      run(`UPDATE orders SET pay_status = 'paid', paid_at = ?, pay_note = '', updated_at = ? WHERE id = ?`, now, now, o.id);
      logEvent(o.id, 'pay_confirmed', 'merchant', PAY_METHOD_TEXT[o.pay_method] || '');
    } else if (action === 'reject') {
      if (o.pay_status !== 'claimed') throw new HttpError(409, 'BAD_PAY_STATUS', '客户没有标记已付款，请刷新后再看');
      const note = str(body.note, { field: '说明', required: true, max: 100 });
      run(`UPDATE orders SET pay_status = 'unpaid', pay_method = '', pay_note = ?, pay_claimed_at = NULL, updated_at = ? WHERE id = ?`, note, now, o.id);
      logEvent(o.id, 'pay_rejected', 'merchant', note);
    } else if (action === 'mark_paid') {
      const method = body.method;
      if (!PAY_METHOD_TEXT[method]) throw new HttpError(400, 'BAD_INPUT', '请选择收款方式');
      if (CLOSED.includes(o.status)) throw new HttpError(409, 'BAD_STATUS', '订单已经取消或拒绝，不能再标记收款');
      if (o.pay_status === 'paid') throw new HttpError(409, 'ALREADY_PAID', '这单已经是已收款');
      run(`UPDATE orders SET pay_status = 'paid', pay_method = ?, paid_at = ?, pay_note = '', updated_at = ? WHERE id = ?`, method, now, now, o.id);
      logEvent(o.id, 'pay_confirmed', 'merchant', PAY_METHOD_TEXT[method]);
    } else if (action === 'refund') {
      if (!CLOSED.includes(o.status)) throw new HttpError(409, 'BAD_STATUS', '只有已取消或已拒绝的订单才需要退款');
      if (o.pay_status !== 'claimed' && o.pay_status !== 'paid') throw new HttpError(409, 'BAD_PAY_STATUS', '这单没有付款记录，不需要退款');
      const note = str(body.note, { field: '退款说明', max: 100 });
      run(`UPDATE orders SET pay_status = 'refunded', refunded_at = ?, pay_note = ?, updated_at = ? WHERE id = ?`, now, note, now, o.id);
      logEvent(o.id, 'refunded', 'merchant', note);
    } else {
      throw new HttpError(400, 'BAD_INPUT', '不支持的操作');
    }
    return { order: getOrderFull(o.id), customerId: o.customer_id };
  });
}

// ---------- 商家查询 ----------

function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function statusCounts() {
  const counts = { pending: 0, preparing: 0, ready: 0, completed: 0, closed: 0 };
  for (const r of all('SELECT status, COUNT(*) AS n FROM orders WHERE shop_id = ? GROUP BY status', SHOP_ID)) {
    if (r.status === 'rejected' || r.status === 'cancelled') counts.closed += r.n;
    else counts[r.status] = r.n;
  }
  return counts;
}

function adminListOrders({ status = 'pending', q = '', date = '', pay = '' } = {}) {
  const where = ['shop_id = ?'];
  const params = [SHOP_ID];
  if (pay === 'claimed') {
    // 客户说已付款、等商家核对（未完成的和已完成的都算）
    where.push(`pay_status = 'claimed' AND status NOT IN ('rejected','cancelled')`);
    status = 'all';
  } else if (pay === 'refund') {
    where.push(`pay_status IN ('claimed','paid') AND status IN ('rejected','cancelled')`);
    status = 'all';
  } else if (pay) throw new HttpError(400, 'BAD_INPUT', '付款筛选不正确');
  if (status === 'all') { /* 不按订单状态筛选 */ } else if (status === 'closed') where.push(`status IN ('rejected','cancelled')`);
  else if (status === 'active') where.push(`status IN ('pending','preparing','ready')`);
  else if (STATUS_TEXT[status]) { where.push('status = ?'); params.push(status); }
  else throw new HttpError(400, 'BAD_INPUT', '订单状态筛选不正确');
  const kw = String(q || '').trim().slice(0, 30);
  if (kw) {
    const like = `%${likeEscape(kw)}%`;
    where.push(`(order_no LIKE ? ESCAPE '\\' OR pickup_name LIKE ? ESCAPE '\\' OR pickup_contact LIKE ? ESCAPE '\\' OR pickup_code = ?)`);
    params.push(like, like, like, kw);
  }
  if (date) {
    if (!isDate(date)) throw new HttpError(400, 'BAD_INPUT', '日期格式不正确');
    where.push('pickup_date = ?');
    params.push(date);
  }
  const activeSort = ['pending', 'preparing', 'ready', 'active'].includes(status) && !kw;
  const order = activeSort ? 'pickup_at ASC, id ASC' : 'updated_at DESC, id DESC';
  const rows = all(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`, ...params);
  return { orders: withItems(rows), counts: statusCounts() };
}

function adminGetOrder(id) {
  const o = getOrderFull(id);
  if (!o) throw new HttpError(404, 'NOT_FOUND', '找不到这笔订单');
  o.customer_order_count = get('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', o.customer_id).n;
  delete o.customer_id;
  return o;
}

// 取货码核销：只在未完成的订单里找
function findByPickupCode(code) {
  const c = String(code || '').trim();
  if (!/^\d{4,6}$/.test(c)) throw new HttpError(400, 'BAD_INPUT', '取货码是 4 位数字');
  const rows = all(`SELECT * FROM orders WHERE shop_id = ? AND pickup_code = ? AND status IN ('pending','preparing','ready') ORDER BY id DESC`, SHOP_ID, c);
  return withItems(rows);
}

// ---------- 备货汇总 ----------

function prepSummary({ date, slot = '' } = {}) {
  const today = localParts().date;
  const d = date && isDate(date) ? date : today;
  const params = [SHOP_ID, d];
  let slotSql = '';
  if (slot) { slotSql = 'AND pickup_slot = ?'; params.push(slot); }
  const rows = all(
    `SELECT * FROM orders WHERE shop_id = ? AND pickup_date = ? ${slotSql}
     AND status IN ('pending','preparing','ready','completed') ORDER BY pickup_at, id`, ...params);
  const orders = withItems(rows);

  const group = (statuses) => {
    const list = orders.filter((o) => statuses.includes(o.status));
    const map = new Map();
    for (const o of list) {
      for (const it of o.items) {
        let g = map.get(it.spec_id);
        if (!g) {
          g = { spec_id: it.spec_id, product_name: it.product_name, spec_name: it.spec_name, image: it.image, quantity: 0, pending_quantity: 0, order_count: 0 };
          map.set(it.spec_id, g);
        }
        g.quantity += it.quantity;
        if (o.status === 'pending') g.pending_quantity += it.quantity;
        g.order_count += 1;
      }
    }
    const products = [...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, 'zh-CN') || a.spec_name.localeCompare(b.spec_name, 'zh-CN'));
    return {
      orders: list,
      products,
      order_count: list.length,
      item_count: products.reduce((s, p) => s + p.quantity, 0),
    };
  };

  const slotSet = new Set(getShop().pickup_slots.map((s) => `${s.start}-${s.end}`));
  for (const r of all('SELECT DISTINCT pickup_slot FROM orders WHERE shop_id = ? AND pickup_date = ?', SHOP_ID, d)) slotSet.add(r.pickup_slot);

  return {
    date: d,
    today,
    slot,
    slots: [...slotSet].sort(),
    todo: group(['pending', 'preparing']), // 需要备货（含未接单，单独标出数量）
    ready: group(['ready']), // 已备好，等客户来取
    completed: group(['completed']), // 已取走，单独统计
  };
}

// ---------- 经营概览 ----------

function overview() {
  const today = localParts().date;
  const dayStart = zonedToDate(today, '00:00').toISOString();
  const counts = statusCounts();
  const createdToday = get('SELECT COUNT(*) AS n FROM orders WHERE shop_id = ? AND created_at >= ?', SHOP_ID, dayStart).n;
  const done = get(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS s FROM orders WHERE shop_id = ? AND status = 'completed' AND completed_at >= ?`, SHOP_ID, dayStart);
  const pickupsToday = get(`SELECT COUNT(*) AS n FROM orders WHERE shop_id = ? AND pickup_date = ? AND status IN ('pending','preparing','ready')`, SHOP_ID, today).n;
  const pending = withItems(all(`SELECT * FROM orders WHERE shop_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 20`, SHOP_ID));
  const soldOut = all(
    `SELECT p.name AS product_name, s.name AS spec_name FROM product_specs s JOIN products p ON p.id = s.product_id
     WHERE p.shop_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND p.status = 'on' AND s.stock = 0
     ORDER BY p.name LIMIT 20`, SHOP_ID);
  const payClaimed = get(`SELECT COUNT(*) AS n FROM orders WHERE shop_id = ? AND pay_status = 'claimed' AND status NOT IN ('rejected','cancelled')`, SHOP_ID).n;
  const refundDue = get(`SELECT COUNT(*) AS n FROM orders WHERE shop_id = ? AND pay_status IN ('claimed','paid') AND status IN ('rejected','cancelled')`, SHOP_ID).n;
  return {
    today,
    counts,
    pay_claimed: payClaimed,
    refund_due: refundDue,
    created_today: createdToday,
    completed_today: done.n,
    completed_today_cents: done.s,
    pickups_today: pickupsToday,
    pending,
    out_of_stock: soldOut,
  };
}

module.exports = {
  STATUS_TEXT, PAY_TEXT, ACTIVE, customerClaimPaid, merchantPayment, quote, createOrder, transition, getCustomerOrder, listCustomerOrders,
  adminListOrders, adminGetOrder, findByPickupCode, prepSummary, overview, getOrderFull,
};
