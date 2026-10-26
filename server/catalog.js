'use strict';
const { get, all, run, tx, SHOP_ID } = require('./db');
const { HttpError, nowIso, str, int } = require('./util');
const { validImage } = require('./shop');

const STATUSES = ['on', 'sold_out', 'off'];

function listCategories() {
  return all('SELECT id, name, sort_order, is_demo FROM categories WHERE shop_id = ? ORDER BY sort_order, id', SHOP_ID);
}

function specsFor(productIds) {
  if (!productIds.length) return new Map();
  const rows = all(
    `SELECT id, product_id, name, price_cents, stock, sort_order FROM product_specs
     WHERE deleted_at IS NULL AND product_id IN (${productIds.map(() => '?').join(',')})
     ORDER BY sort_order, id`, ...productIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push({ id: r.id, name: r.name, price_cents: r.price_cents, stock: r.stock });
  }
  return map;
}

function shape(p, specs) {
  const list = specs.get(p.id) || [];
  const prices = list.map((s) => s.price_cents);
  return {
    id: p.id,
    category_id: p.category_id,
    name: p.name,
    description: p.description,
    image: p.image,
    status: p.status,
    sort_order: p.sort_order,
    is_demo: !!p.is_demo,
    specs: list,
    min_price_cents: prices.length ? Math.min(...prices) : 0,
    max_price_cents: prices.length ? Math.max(...prices) : 0,
    // 是否还能预订：在售，且至少一个规格有库存
    orderable: p.status === 'on' && list.some((s) => s.stock === null || s.stock > 0),
    updated_at: p.updated_at,
  };
}

// 客户看到的商品：不含已下架和已删除
function publicCatalog() {
  const products = all(
    `SELECT p.* FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.shop_id = ? AND p.deleted_at IS NULL AND p.status != 'off'
     ORDER BY COALESCE(c.sort_order, 1e9), p.sort_order, p.id`, SHOP_ID);
  const specs = specsFor(products.map((p) => p.id));
  return {
    categories: listCategories().map(({ id, name }) => ({ id, name })),
    products: products.map((p) => shape(p, specs)).filter((p) => p.specs.length > 0),
  };
}

function adminCatalog() {
  const products = all(
    `SELECT p.* FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.shop_id = ? AND p.deleted_at IS NULL
     ORDER BY COALESCE(c.sort_order, 1e9), p.sort_order, p.id`, SHOP_ID);
  const specs = specsFor(products.map((p) => p.id));
  return { categories: listCategories(), products: products.map((p) => shape(p, specs)) };
}

function getProduct(id, { includeOff = true } = {}) {
  const p = get('SELECT * FROM products WHERE id = ? AND shop_id = ? AND deleted_at IS NULL', id, SHOP_ID);
  if (!p || (!includeOff && p.status === 'off')) throw new HttpError(404, 'NOT_FOUND', '商品不存在或已下架');
  return shape(p, specsFor([p.id]));
}

function validateProduct(body) {
  const name = str(body.name, { field: '商品名称', required: true, max: 40 });
  const description = str(body.description, { field: '商品说明', max: 500 });
  const image = validImage(body.image);
  let categoryId = body.category_id === null || body.category_id === '' || body.category_id === undefined ? null : int(body.category_id, { field: '分类' });
  if (categoryId !== null && !get('SELECT 1 FROM categories WHERE id = ? AND shop_id = ?', categoryId, SHOP_ID)) {
    throw new HttpError(400, 'BAD_INPUT', '分类不存在，请重新选择');
  }
  const status = body.status === undefined ? 'on' : body.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'BAD_INPUT', '商品状态不正确');
  if (!Array.isArray(body.specs) || body.specs.length === 0) throw new HttpError(400, 'BAD_INPUT', '至少要有一个规格和价格');
  if (body.specs.length > 10) throw new HttpError(400, 'BAD_INPUT', '规格最多 10 个');
  const names = new Set();
  const specs = body.specs.map((s, i) => {
    const sName = str(s && s.name, { field: `第 ${i + 1} 个规格的名称`, required: true, max: 20 });
    if (names.has(sName)) throw new HttpError(400, 'BAD_INPUT', `规格「${sName}」重复了`);
    names.add(sName);
    return {
      id: s.id ? int(s.id, { field: '规格' }) : null,
      name: sName,
      price_cents: int(s.price_cents, { field: `「${sName}」的价格`, min: 0, max: 10_000_000 }),
      stock: int(s.stock, { field: `「${sName}」的库存`, min: 0, max: 999_999, nullable: true }),
    };
  });
  return { name, description, image, category_id: categoryId, status, specs };
}

function saveSpecs(productId, specs) {
  const existing = all('SELECT id FROM product_specs WHERE product_id = ? AND deleted_at IS NULL', productId).map((r) => r.id);
  const keep = new Set();
  specs.forEach((s, i) => {
    if (s.id && existing.includes(s.id)) {
      keep.add(s.id);
      run('UPDATE product_specs SET name = ?, price_cents = ?, stock = ?, sort_order = ? WHERE id = ?', s.name, s.price_cents, s.stock, i, s.id);
    } else {
      run('INSERT INTO product_specs (product_id, name, price_cents, stock, sort_order) VALUES (?, ?, ?, ?, ?)', productId, s.name, s.price_cents, s.stock, i);
    }
  });
  const now = nowIso();
  for (const id of existing) if (!keep.has(id)) run('UPDATE product_specs SET deleted_at = ? WHERE id = ?', now, id);
}

function createProduct(body) {
  const v = validateProduct(body);
  return tx(() => {
    const now = nowIso();
    const max = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE shop_id = ?', SHOP_ID).m;
    const r = run(`INSERT INTO products (shop_id, category_id, name, description, image, status, sort_order, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      SHOP_ID, v.category_id, v.name, v.description, v.image, v.status, max + 1, now, now);
    const id = Number(r.lastInsertRowid);
    saveSpecs(id, v.specs);
    return getProduct(id);
  });
}

function updateProduct(id, body) {
  const v = validateProduct(body);
  return tx(() => {
    getProduct(id);
    run(`UPDATE products SET category_id = ?, name = ?, description = ?, image = ?, status = ?, updated_at = ? WHERE id = ?`,
      v.category_id, v.name, v.description, v.image, v.status, nowIso(), id);
    saveSpecs(id, v.specs);
    return getProduct(id);
  });
}

function setProductStatus(id, status) {
  if (!STATUSES.includes(status)) throw new HttpError(400, 'BAD_INPUT', '商品状态不正确');
  getProduct(id);
  run('UPDATE products SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
  return getProduct(id);
}

// 删除商品：从店里移除，但保留记录，已提交订单里的商品名称和价格不受影响
function deleteProduct(id) {
  getProduct(id);
  run('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
}

// 在同一分类内上移 / 下移
function moveProduct(id, direction) {
  return tx(() => {
    const p = getProduct(id);
    const list = all(`SELECT id FROM products WHERE shop_id = ? AND deleted_at IS NULL AND category_id IS ? ORDER BY sort_order, id`,
      SHOP_ID, p.category_id);
    const idx = list.findIndex((r) => r.id === id);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    list.forEach((r, i) => run('UPDATE products SET sort_order = ? WHERE id = ?', i + 1, r.id));
  });
}

function createCategory(body) {
  const name = str(body.name, { field: '分类名称', required: true, max: 12 });
  if (get('SELECT 1 FROM categories WHERE shop_id = ? AND name = ?', SHOP_ID, name)) throw new HttpError(400, 'BAD_INPUT', `分类「${name}」已存在`);
  const max = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE shop_id = ?', SHOP_ID).m;
  run('INSERT INTO categories (shop_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)', SHOP_ID, name, max + 1, nowIso());
  return listCategories();
}

function renameCategory(id, body) {
  const name = str(body.name, { field: '分类名称', required: true, max: 12 });
  if (!get('SELECT 1 FROM categories WHERE id = ? AND shop_id = ?', id, SHOP_ID)) throw new HttpError(404, 'NOT_FOUND', '分类不存在');
  if (get('SELECT 1 FROM categories WHERE shop_id = ? AND name = ? AND id != ?', SHOP_ID, name, id)) throw new HttpError(400, 'BAD_INPUT', `分类「${name}」已存在`);
  run('UPDATE categories SET name = ? WHERE id = ?', name, id);
  return listCategories();
}

function deleteCategory(id) {
  if (!get('SELECT 1 FROM categories WHERE id = ? AND shop_id = ?', id, SHOP_ID)) throw new HttpError(404, 'NOT_FOUND', '分类不存在');
  const n = get('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND deleted_at IS NULL', id).n;
  if (n > 0) throw new HttpError(409, 'CATEGORY_NOT_EMPTY', `这个分类下还有 ${n} 件商品，请先把它们移到别的分类`);
  run('DELETE FROM categories WHERE id = ?', id);
  return listCategories();
}

function moveCategory(id, direction) {
  return tx(() => {
    const list = all('SELECT id FROM categories WHERE shop_id = ? ORDER BY sort_order, id', SHOP_ID);
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) throw new HttpError(404, 'NOT_FOUND', '分类不存在');
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target >= 0 && target < list.length) {
      [list[idx], list[target]] = [list[target], list[idx]];
      list.forEach((r, i) => run('UPDATE categories SET sort_order = ? WHERE id = ?', i + 1, r.id));
    }
    return listCategories();
  });
}

module.exports = {
  publicCatalog, adminCatalog, getProduct, createProduct, updateProduct, setProductStatus, deleteProduct, moveProduct,
  listCategories, createCategory, renameCategory, deleteCategory, moveCategory,
};
