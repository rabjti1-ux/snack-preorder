'use strict';
// 命令行管理工具
//   node server/cli.js create-admin <用户名> <密码>     新建商家账号
//   node server/cli.js reset-password <用户名> <新密码>  重置商家密码
//   node server/cli.js list-admins                       查看商家账号
//   node server/cli.js clear-demo                        删除示例商品及相关订单
//   node server/cli.js clear-orders                      删除全部订单（上线前清理测试订单）
//   node server/cli.js seed-demo                         重新写入示例商品
//   node server/cli.js backup                            备份数据库到 data/backups
const { HttpError } = require('./util');
const { ensureShop } = require('./shop');
const auth = require('./auth');
const demo = require('./demo');

const [cmd, ...args] = process.argv.slice(2);

function done(msg) { console.log(msg); process.exit(0); }

try {
  ensureShop();
  switch (cmd) {
    case 'create-admin': {
      const [u, p] = args;
      if (!u || !p) done('用法：node server/cli.js create-admin <用户名> <密码>');
      auth.createAdmin(u, p);
      done(`已创建商家账号 ${u}`);
      break;
    }
    case 'reset-password': {
      const [u, p] = args;
      if (!u || !p) done('用法：node server/cli.js reset-password <用户名> <新密码>');
      auth.setAdminPassword(u, p);
      done(`已重置 ${u} 的密码，其他设备需要重新登录`);
      break;
    }
    case 'list-admins':
      for (const a of auth.listAdmins()) console.log(`${a.username}\t创建于 ${a.created_at}`);
      done('');
      break;
    case 'clear-demo': {
      const r = demo.clearDemo();
      done(`已删除示例商品 ${r.products} 件、示例分类 ${r.categories} 个、相关订单 ${r.orders} 笔`);
      break;
    }
    case 'clear-orders': {
      if (args[0] !== '--yes') done('这会删除全部订单且无法恢复。确认的话请运行：node server/cli.js clear-orders --yes');
      const r = demo.clearAllOrders();
      done(`已删除 ${r.orders} 笔订单`);
      break;
    }
    case 'seed-demo':
      demo.seedDemo();
      done('已写入示例商品');
      break;
    case 'backup': {
      // 在线备份数据库（服务运行中也可以执行）；图片在 data/uploads，需要一起复制
      const fs = require('node:fs');
      const path = require('node:path');
      const config = require('./config');
      const { db } = require('./db');
      const dir = path.join(config.dataDir, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
      const file = path.join(dir, `shop-${stamp}.db`);
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      done(`已备份到 ${file}\n商品图片在 ${path.join(config.dataDir, 'uploads')}，请一起复制保存。`);
      break;
    }
    default:
      done([
        '可用命令：',
        '  create-admin <用户名> <密码>      新建商家账号',
        '  reset-password <用户名> <新密码>  重置商家密码',
        '  list-admins                       查看商家账号',
        '  clear-demo                        删除示例商品及相关订单',
        '  clear-orders --yes                删除全部订单',
        '  seed-demo                         写入示例商品',
        '  backup                            备份数据库',
      ].join('\n'));
  }
} catch (e) {
  console.error(e instanceof HttpError ? `失败：${e.message}` : e);
  process.exit(1);
}
