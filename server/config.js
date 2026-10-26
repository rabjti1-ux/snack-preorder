'use strict';
// 读取配置：优先使用环境变量，其次读取项目根目录的 .env 文件。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;

module.exports = {
  ROOT,
  publicDir: path.join(ROOT, 'public'),
  port: parseInt(env.PORT || '3000', 10),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  // 店铺所在时区：决定“今天”、取货日期和订单号日期
  timeZone: env.SHOP_TIMEZONE || 'Asia/Shanghai',
  // 首次启动时如果还没有商家账号，用这里的账号密码创建；密码留空则随机生成并打印在启动日志里
  adminUsername: env.ADMIN_USERNAME || 'admin',
  adminPassword: env.ADMIN_PASSWORD || '',
  // 首次启动（数据库为空）时是否写入示例商品
  seedDemo: (env.SEED_DEMO || 'true').toLowerCase() !== 'false',
  // 部署在 Nginx 等反向代理后面时设为 true，才会使用 X-Forwarded-For 识别客户端 IP
  trustProxy: (env.TRUST_PROXY || 'false').toLowerCase() === 'true',
};
