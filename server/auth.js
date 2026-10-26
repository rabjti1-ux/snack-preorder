'use strict';
const { get, run, all, SHOP_ID } = require('./db');
const config = require('./config');
const { HttpError, nowIso, newToken, hashToken, hashPassword, verifyPassword, str } = require('./util');

const SESSION_DAYS = 30;

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9_-]{20,100})$/);
  return m ? m[1] : null;
}

// ---------- 客户（匿名身份） ----------

function createCustomer() {
  const token = newToken();
  const now = nowIso();
  const r = run('INSERT INTO customers (token_hash, created_at, last_seen_at) VALUES (?, ?, ?)', hashToken(token), now, now);
  return { token, customer: { id: Number(r.lastInsertRowid), last_name: '', last_contact: '' } };
}

function customerByToken(token) {
  if (!token) return null;
  const c = get('SELECT id, last_name, last_contact, last_seen_at FROM customers WHERE token_hash = ?', hashToken(token));
  if (!c) return null;
  if (Date.now() - Date.parse(c.last_seen_at) > 5 * 60_000) run('UPDATE customers SET last_seen_at = ? WHERE id = ?', nowIso(), c.id);
  return { id: c.id, last_name: c.last_name, last_contact: c.last_contact };
}

function requireCustomer(req) {
  const c = customerByToken(bearer(req));
  if (!c) throw new HttpError(401, 'CUSTOMER_AUTH', '身份已失效，请刷新页面');
  return c;
}

// ---------- 商家 ----------

function createAdmin(username, password) {
  const u = str(username, { field: '用户名', required: true, min: 3, max: 30 });
  if (!/^[A-Za-z0-9_.-]+$/.test(u)) throw new HttpError(400, 'BAD_INPUT', '用户名只能用字母、数字、下划线');
  checkPasswordStrength(password);
  if (get('SELECT 1 FROM admins WHERE username = ?', u)) throw new HttpError(400, 'BAD_INPUT', `账号 ${u} 已存在`);
  run('INSERT INTO admins (shop_id, username, password_hash, created_at) VALUES (?, ?, ?, ?)', SHOP_ID, u, hashPassword(password), nowIso());
}

function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'BAD_INPUT', '密码至少 8 位');
  if (pw.length > 100) throw new HttpError(400, 'BAD_INPUT', '密码太长');
}

function setAdminPassword(username, password) {
  checkPasswordStrength(password);
  const a = get('SELECT id FROM admins WHERE username = ?', username);
  if (!a) throw new HttpError(404, 'NOT_FOUND', `账号 ${username} 不存在`);
  run('UPDATE admins SET password_hash = ? WHERE id = ?', hashPassword(password), a.id);
  run('DELETE FROM admin_sessions WHERE admin_id = ?', a.id); // 改密码后其他设备需要重新登录
}

function login(username, password) {
  const a = get('SELECT * FROM admins WHERE username = ?', String(username || '').trim());
  if (!a || !verifyPassword(String(password || ''), a.password_hash)) {
    throw new HttpError(401, 'LOGIN_FAILED', '账号或密码不对');
  }
  const token = newToken();
  const now = new Date();
  run('INSERT INTO admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    hashToken(token), a.id, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString());
  run('DELETE FROM admin_sessions WHERE expires_at < ?', now.toISOString());
  return { token, admin: { id: a.id, username: a.username } };
}

function adminByToken(token) {
  if (!token) return null;
  return get(
    `SELECT a.id, a.username, a.shop_id FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(token), nowIso()) || null;
}

function requireAdmin(req) {
  const a = adminByToken(bearer(req));
  if (!a) throw new HttpError(401, 'ADMIN_AUTH', '请先登录商家账号');
  return a;
}

function logout(req) {
  const t = bearer(req);
  if (t) run('DELETE FROM admin_sessions WHERE token_hash = ?', hashToken(t));
}

function changePassword(admin, oldPw, newPw) {
  const a = get('SELECT * FROM admins WHERE id = ?', admin.id);
  if (!verifyPassword(String(oldPw || ''), a.password_hash)) throw new HttpError(400, 'BAD_INPUT', '原密码不对');
  checkPasswordStrength(newPw);
  run('UPDATE admins SET password_hash = ? WHERE id = ?', hashPassword(newPw), a.id);
}

// 首次启动：没有任何商家账号时自动创建一个
function ensureAdmin() {
  const n = get('SELECT COUNT(*) AS n FROM admins').n;
  if (n > 0) return null;
  let password = config.adminPassword;
  let generated = false;
  if (!password || password.length < 8) {
    password = newToken().slice(0, 12);
    generated = true;
  }
  createAdmin(config.adminUsername, password);
  return { username: config.adminUsername, password, generated };
}

function listAdmins() {
  return all('SELECT username, created_at FROM admins ORDER BY id');
}

module.exports = {
  bearer, createCustomer, customerByToken, requireCustomer,
  createAdmin, setAdminPassword, login, adminByToken, requireAdmin, logout, changePassword, ensureAdmin, listAdmins,
};
