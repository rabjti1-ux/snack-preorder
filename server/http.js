'use strict';
// 极简路由、请求体解析和静态文件服务（只用 Node.js 内置模块）
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { HttpError } = require('./util');

const routes = [];

function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}

function match(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { handler: r.handler, params };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'TOO_LARGE', '提交的内容太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 256 * 1024);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
    return v;
  } catch (_) {
    throw new HttpError(400, 'BAD_JSON', '提交的数据格式不正确');
  }
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.apk': 'application/vnd.android.package-archive',
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function sendFile(req, res, baseDir, relPath, { immutable = false, downloadName = '' } = {}) {
  const base = path.resolve(baseDir);
  const file = path.resolve(base, '.' + path.sep + relPath);
  if (!file.startsWith(base + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
  };
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  if (downloadName) {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }
  if (ext === '.svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

module.exports = { route, match, readJson, readBody, sendJson, sendFile, securityHeaders, clientIp };
