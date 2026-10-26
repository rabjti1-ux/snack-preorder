'use strict';
// 示例数据：所有示例商品、分类、以及包含示例商品的订单都带有 is_demo = 1，可一键清理
const { get, all, run, tx, SHOP_ID } = require('./db');
const { nowIso } = require('./util');

const DEMO = [
  { cat: '饮料', items: [
    { name: '可乐 330ml', image: '/demo/can-red.svg', desc: '冰柜里拿，取货时是冰的。', specs: [['单罐', 300, 48], ['整箱 24 罐', 6000, 3]] },
    { name: '冰红茶 500ml', image: '/demo/bottle-amber.svg', desc: '', specs: [['单瓶', 350, 30]] },
    { name: '矿泉水 550ml', image: '/demo/bottle-blue.svg', desc: '', specs: [['单瓶', 200, null], ['整箱 24 瓶', 2400, 5]] },
  ] },
  { cat: '辣条', items: [
    { name: '麻辣辣条', image: '/demo/strip-red.svg', desc: '微辣偏甜，学生最常买的那种。', specs: [['单包', 100, 100], ['整盒 20 包', 1800, 4]] },
    { name: '大面筋', image: '/demo/strip-orange.svg', desc: '', specs: [['单包', 250, 40]] },
  ] },
  { cat: '薯片', items: [
    { name: '原味薯片', image: '/demo/bag-yellow.svg', desc: '', specs: [['小包 40g', 450, 20], ['大包 75g', 800, 12]] },
    { name: '番茄味薯片', image: '/demo/bag-red.svg', desc: '', specs: [['大包 75g', 800, 0]] },
  ] },
  { cat: '饼干', items: [
    { name: '苏打饼干', image: '/demo/cracker.svg', desc: '独立小包装，一盒 8 小包。', specs: [['单盒', 500, 15]] },
    { name: '巧克力夹心饼干', image: '/demo/cookie.svg', desc: '', specs: [['单盒', 650, 10]], status: 'sold_out' },
  ] },
  { cat: '糖果', items: [
    { name: '水果硬糖', image: '/demo/candy-green.svg', desc: '混合口味，约 30 颗。', specs: [['一袋', 700, 18]] },
    { name: '棒棒糖', image: '/demo/lollipop.svg', desc: '', specs: [['单支', 100, 60], ['一盒 30 支', 2500, 2]] },
  ] },
];

function seedDemo() {
  return tx(() => {
    const now = nowIso();
    run(`UPDATE shops SET name = ?, image = ?, phone = ?, address = ?, business_hours = ?, notice = ?, pickup_slots = ?, lead_minutes = 30, days_ahead = 3, updated_at = ? WHERE id = ?`,
      '转角零食铺', '/demo/shop.svg', '13800000000', '学校东门对面，文具店隔壁', '每天 10:00–21:00',
      '提前订好，到点直接来拿。缺货时我会先打电话跟你确认，不会私自换东西。',
      JSON.stringify([{ start: '10:00', end: '12:00' }, { start: '12:00', end: '14:00' }, { start: '16:00', end: '18:00' }, { start: '18:00', end: '21:00' }]),
      now, SHOP_ID);
    let catOrder = 0;
    let prodOrder = 0;
    for (const c of DEMO) {
      const cr = run('INSERT INTO categories (shop_id, name, sort_order, is_demo, created_at) VALUES (?, ?, ?, 1, ?)', SHOP_ID, c.cat, ++catOrder, now);
      const catId = Number(cr.lastInsertRowid);
      for (const p of c.items) {
        const pr = run(`INSERT INTO products (shop_id, category_id, name, description, image, status, sort_order, is_demo, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          SHOP_ID, catId, p.name, p.desc, p.image, p.status || 'on', ++prodOrder, now, now);
        const pid = Number(pr.lastInsertRowid);
        p.specs.forEach(([name, price, stock], i) => {
          run('INSERT INTO product_specs (product_id, name, price_cents, stock, sort_order) VALUES (?, ?, ?, ?, ?)', pid, name, price, stock, i);
        });
      }
    }
  });
}

function demoStats() {
  return {
    products: get('SELECT COUNT(*) AS n FROM products WHERE is_demo = 1 AND deleted_at IS NULL').n,
    orders: get('SELECT COUNT(*) AS n FROM orders WHERE is_demo = 1').n,
    categories: get('SELECT COUNT(*) AS n FROM categories WHERE is_demo = 1').n,
  };
}

// 清理示例数据：删除示例商品、含示例商品的订单，以及清空后的示例分类。真实商品和订单不受影响。
function clearDemo() {
  return tx(() => {
    releaseActive(`AND is_demo = 1`);
    const orders = run('DELETE FROM orders WHERE is_demo = 1').changes;
    const ids = all('SELECT id FROM products WHERE is_demo = 1').map((r) => r.id);
    for (const id of ids) {
      run('DELETE FROM product_specs WHERE product_id = ?', id);
      run('DELETE FROM products WHERE id = ?', id);
    }
    const cats = run(`DELETE FROM categories WHERE is_demo = 1 AND id NOT IN (SELECT category_id FROM products WHERE category_id IS NOT NULL)`).changes;
    return { orders, products: ids.length, categories: cats };
  });
}

// 清空全部订单（上线前清理测试订单用）：未完成订单占用的库存会先退回
function releaseActive(extraWhere = '') {
  const active = all(`SELECT id FROM orders WHERE status IN ('pending','preparing','ready') AND stock_released = 0 ${extraWhere}`);
  for (const o of active) {
    for (const it of all('SELECT spec_id, quantity FROM order_items WHERE order_id = ?', o.id)) {
      run('UPDATE product_specs SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL AND deleted_at IS NULL', it.quantity, it.spec_id);
    }
  }
}

function clearAllOrders() {
  return tx(() => {
    releaseActive();
    const n = run('DELETE FROM orders').changes;
    run(`DELETE FROM counters WHERE name LIKE 'order:%'`);
    return { orders: n };
  });
}

module.exports = { seedDemo, demoStats, clearDemo, clearAllOrders };
