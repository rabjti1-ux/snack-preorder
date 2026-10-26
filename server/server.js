'use strict';
// 启动入口：node server/server.js
const http = require('node:http');
const os = require('node:os');
const config = require('./config');
const { get } = require('./db');
const { ensureShop } = require('./shop');
const { ensureAdmin } = require('./auth');
const { seedDemo } = require('./demo');
const { handle } = require('./app');
const events = require('./events');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n需要 Node.js 22.13 或更高版本，当前是 ${process.versions.node}。请到 https://nodejs.org 下载 LTS 版本。\n`);
  process.exit(1);
}

const freshDb = get('SELECT COUNT(*) AS n FROM shops').n === 0;
ensureShop();
if (freshDb && config.seedDemo) {
  seedDemo();
  console.log('已写入示例商品（标记为示例数据，可在商家端「店铺」页一键清理）。');
}
const created = ensureAdmin();

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.listen(config.port, config.host, () => {
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) lan.push(ni.address);
  }
  const line = '─'.repeat(52);
  console.log(`\n${line}\n 零食预订 已启动\n${line}`);
  console.log(` 本机打开：   http://localhost:${config.port}`);
  for (const ip of lan) console.log(` 手机打开：   http://${ip}:${config.port}   （手机和电脑连同一个 Wi-Fi）`);
  console.log(` 商家后台：   在地址后面加 /admin`);
  if (created) {
    console.log(`\n 已创建商家账号：${created.username}`);
    if (created.generated) {
      if (config.adminPassword) console.log(' ADMIN_PASSWORD 少于 8 位，已改用下面的随机密码。');
      console.log(` 初始密码：    ${created.password}    ← 请记下来，登录后在「店铺」页修改`);
    } else {
      console.log(' 密码：        你在 ADMIN_PASSWORD 里设置的密码');
    }
  }
  console.log(`${line}\n`);
});

function shutdown() {
  events.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
