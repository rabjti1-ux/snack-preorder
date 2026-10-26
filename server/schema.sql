-- 零食预订 数据库结构（SQLite）
-- 服务启动时自动执行，已有的表不会被覆盖。
-- 金额一律以“分”为单位的整数保存，避免小数误差。
-- shop_id 字段为以后扩展多家店预留，第一版固定为 1。

-- 店铺信息与接单设置
CREATE TABLE IF NOT EXISTS shops (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  image            TEXT    NOT NULL DEFAULT '',
  phone            TEXT    NOT NULL DEFAULT '',
  address          TEXT    NOT NULL DEFAULT '',
  business_hours   TEXT    NOT NULL DEFAULT '',
  notice           TEXT    NOT NULL DEFAULT '',
  accepting_orders INTEGER NOT NULL DEFAULT 1,      -- 1 接单中，0 暂停接单
  pause_message    TEXT    NOT NULL DEFAULT '',     -- 暂停接单时给客户看的说明
  pickup_slots     TEXT    NOT NULL DEFAULT '[]',   -- 取货时段 JSON：[{"start":"10:00","end":"12:00"}]
  lead_minutes     INTEGER NOT NULL DEFAULT 30,     -- 至少提前多少分钟预订（距时段结束）
  days_ahead       INTEGER NOT NULL DEFAULT 2,      -- 可预约天数：1 = 只能约今天，2 = 今天和明天
  pay_wechat_qr    TEXT    NOT NULL DEFAULT '',     -- 微信收款码图片（可选）
  pay_alipay_qr    TEXT    NOT NULL DEFAULT '',     -- 支付宝收款码图片（可选）
  pay_note         TEXT    NOT NULL DEFAULT '',     -- 付款说明，例如“付款时备注取货码”
  updated_at       TEXT    NOT NULL
);

-- 商家管理账号（只能通过命令行或首次启动创建，客户无法注册）
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  shop_id       INTEGER NOT NULL REFERENCES shops(id),
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,                       -- 只保存令牌的哈希
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 客户：首次打开自动创建的匿名身份
CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_name    TEXT NOT NULL DEFAULT '',             -- 上次填写的取货人，用于自动填充
  last_contact TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY,
  shop_id    INTEGER NOT NULL REFERENCES shops(id),
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo    INTEGER NOT NULL DEFAULT 0,             -- 1 = 示例数据
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  shop_id     INTEGER NOT NULL REFERENCES shops(id),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  image       TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'on' CHECK (status IN ('on', 'sold_out', 'off')),  -- 在售 / 售罄 / 下架
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,                                  -- 删除后保留记录，旧订单仍可追溯
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- 规格：同一商品不同规格不同价格（单包 / 整盒）
CREATE TABLE IF NOT EXISTS product_specs (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  name        TEXT    NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock       INTEGER CHECK (stock IS NULL OR stock >= 0),  -- 可预订数量；NULL = 不限
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY,
  shop_id           INTEGER NOT NULL REFERENCES shops(id),
  order_no          TEXT    NOT NULL UNIQUE,         -- 例如 2610260007
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  client_request_id TEXT    NOT NULL,                -- 防重复提交
  pickup_code       TEXT    NOT NULL,                -- 4 位取货码
  status            TEXT    NOT NULL CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'rejected', 'cancelled')),
  pickup_name       TEXT    NOT NULL,
  pickup_contact    TEXT    NOT NULL,
  pickup_date       TEXT    NOT NULL,                -- 店铺时区日期 YYYY-MM-DD
  pickup_slot       TEXT    NOT NULL,                -- 例如 15:00-17:00
  pickup_at         TEXT    NOT NULL,                -- 时段开始 “YYYY-MM-DD HH:MM”，用于排序
  note              TEXT    NOT NULL DEFAULT '',
  total_cents       INTEGER NOT NULL,
  item_count        INTEGER NOT NULL,
  close_reason      TEXT    NOT NULL DEFAULT '',     -- 拒单 / 取消原因
  closed_by         TEXT    NOT NULL DEFAULT '',     -- customer / merchant
  stock_released    INTEGER NOT NULL DEFAULT 0,
  is_demo           INTEGER NOT NULL DEFAULT 0,      -- 含示例商品的订单
  -- 付款状态（扫商家收款码，商家人工核对）：
  -- unpaid 未付款 / claimed 客户说已付款 / paid 商家确认已收款 / refunded 已退款
  pay_status        TEXT    NOT NULL DEFAULT 'unpaid',
  pay_method        TEXT    NOT NULL DEFAULT '',     -- wechat / alipay / cash（当面）
  pay_note          TEXT    NOT NULL DEFAULT '',     -- 商家说没收到时的说明、退款备注
  pay_claimed_at    TEXT,
  paid_at           TEXT,
  refunded_at       TEXT,
  created_at        TEXT    NOT NULL,
  accepted_at       TEXT,
  ready_at          TEXT,
  completed_at      TEXT,
  closed_at         TEXT,
  updated_at        TEXT    NOT NULL,
  UNIQUE (customer_id, client_request_id)
);

-- 订单明细：下单时的名称和价格快照，之后改价不影响旧订单
CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL,
  spec_id          INTEGER NOT NULL,
  product_name     TEXT    NOT NULL,
  spec_name        TEXT    NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  subtotal_cents   INTEGER NOT NULL,
  image            TEXT    NOT NULL DEFAULT ''
);

-- 订单状态记录
CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  actor      TEXT    NOT NULL,                       -- customer / merchant / system
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_shop   ON products(shop_id, deleted_at, sort_order);
CREATE INDEX IF NOT EXISTS idx_specs_product   ON product_specs(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(shop_id, status, pickup_at);
CREATE INDEX IF NOT EXISTS idx_orders_pickup   ON orders(shop_id, pickup_date);
CREATE INDEX IF NOT EXISTS idx_orders_code     ON orders(shop_id, pickup_code);
CREATE INDEX IF NOT EXISTS idx_items_order     ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_events_order    ON order_events(order_id);
