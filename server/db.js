'use strict';
// 数据库连接（Node.js 内置 SQLite，不需要安装任何依赖）
const fs = require('node:fs');
const path = require('node:path');

// 屏蔽内置 SQLite 的“实验功能”提示，避免吓到使用者
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && msg.includes('SQLite')) return;
  return origEmit.call(process, warning, ...args);
};

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('\n当前 Node.js 版本不支持内置 SQLite，请安装 Node.js 22.13 或更高版本（推荐 24 LTS）。\n');
  process.exit(1);
}

const config = require('./config');

const SHOP_ID = 1;

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });

const dbFile = process.env.DB_FILE || path.join(config.dataDir, 'shop.db');
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// 数据库升级：老版本建的表缺少新字段时自动补上（数据不受影响）
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
// v1.2：收款码与付款状态
ensureColumn('shops', 'pay_wechat_qr', "TEXT NOT NULL DEFAULT ''");
ensureColumn('shops', 'pay_alipay_qr', "TEXT NOT NULL DEFAULT ''");
ensureColumn('shops', 'pay_note', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'pay_status', "TEXT NOT NULL DEFAULT 'unpaid'");
ensureColumn('orders', 'pay_method', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'pay_note', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'pay_claimed_at', 'TEXT');
ensureColumn('orders', 'paid_at', 'TEXT');
ensureColumn('orders', 'refunded_at', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_pay ON orders(shop_id, pay_status)');

const cache = new Map();
function q(sql) {
  let st = cache.get(sql);
  if (!st) { st = db.prepare(sql); cache.set(sql, st); }
  return st;
}
const get = (sql, ...p) => q(sql).get(...p);
const all = (sql, ...p) => q(sql).all(...p);
const run = (sql, ...p) => q(sql).run(...p);

let depth = 0;
// 事务：同一时间只有一个写事务，避免多人同时下单造成超卖
function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    depth--;
  }
}

module.exports = { db, q, get, all, run, tx, SHOP_ID, dbFile };
