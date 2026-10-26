'use strict';
const crypto = require('node:crypto');
const config = require('./config');

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const nowIso = () => new Date().toISOString();

// ---------- 时间（按店铺时区计算） ----------
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timeZone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function localParts(date = new Date()) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    yymmdd: `${p.year.slice(2)}${p.month}${p.day}`,
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second,
  };
}

// 店铺时区的 “YYYY-MM-DD HH:MM” 转为真实时间点
function zonedToDate(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts));
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts = guess - (asUtc - ts);
  }
  return new Date(ts);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---------- 校验 ----------
function str(v, { field, min = 0, max = 200, required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, 'BAD_INPUT', `${field}格式不正确`);
  v = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !v) throw new HttpError(400, 'BAD_INPUT', `请填写${field}`);
  if (v.length < min) throw new HttpError(400, 'BAD_INPUT', `${field}至少 ${min} 个字`);
  if (v.length > max) throw new HttpError(400, 'BAD_INPUT', `${field}不能超过 ${max} 个字`);
  return v;
}

function int(v, { field, min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (nullable && (v === null || v === undefined || v === '')) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n)) throw new HttpError(400, 'BAD_INPUT', `${field}必须是整数`);
  if (n < min || n > max) throw new HttpError(400, 'BAD_INPUT', `${field}超出范围`);
  return n;
}

const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- 密码与令牌 ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// ---------- 简单的内存限流 ----------
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let arr = buckets.get(key);
  if (!arr) { arr = []; buckets.set(key, arr); }
  while (arr.length && arr[0] <= now - windowMs) arr.shift();
  if (arr.length >= limit) {
    throw new HttpError(429, 'TOO_MANY', '操作太频繁，请稍后再试');
  }
  arr.push(now);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) if (!arr.length || arr[arr.length - 1] < now - 3600_000) buckets.delete(k);
}, 600_000).unref();

module.exports = {
  HttpError, nowIso, localParts, zonedToDate, addDays, weekdayOf,
  str, int, isTime, isDate,
  hashPassword, verifyPassword, newToken, hashToken, rateLimit,
};
