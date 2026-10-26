'use strict';
// 实时推送（Server-Sent Events）：订单、商品、店铺有变化时通知已打开的页面
let nextId = 1;
const clients = new Map(); // id -> { res, kind: 'admin' | 'customer', customerId }

function subscribe(req, res, info) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 让 Nginx 不缓冲推送
  });
  res.write('retry: 3000\n\n');
  const id = nextId++;
  clients.set(id, { res, ...info });
  write(res, 'hello', { at: new Date().toISOString() });
  const cleanup = () => clients.delete(id);
  req.on('close', cleanup);
  res.on('error', cleanup);
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) { /* 连接已断开 */ }
}

function emit(filter, event, data) {
  for (const c of clients.values()) if (filter(c)) write(c.res, event, data);
}

const toAdmins = (event, data) => emit((c) => c.kind === 'admin', event, data);
const toCustomer = (customerId, event, data) => emit((c) => c.kind === 'customer' && c.customerId === customerId, event, data);
const toAll = (event, data) => emit(() => true, event, data);

// 定时发送心跳，防止代理服务器断开空闲连接
setInterval(() => {
  for (const c of clients.values()) {
    try { c.res.write(': ping\n\n'); } catch (_) { /* ignore */ }
  }
}, 25_000).unref();

function closeAll() {
  for (const c of clients.values()) { try { c.res.end(); } catch (_) { /* ignore */ } }
  clients.clear();
}

module.exports = { subscribe, toAdmins, toCustomer, toAll, closeAll, count: () => clients.size };
