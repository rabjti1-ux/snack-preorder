'use strict';
// 安卓安装包：商家在后台上传，客户在 /download 页面下载
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { HttpError } = require('./util');

const APPS = {
  customer: { file: 'snack-customer.apk', name: '零食预订.apk', label: '客户版' },
  merchant: { file: 'snack-merchant.apk', name: '商家后台.apk', label: '商家版' },
};
const dir = path.join(config.dataDir, 'downloads');
fs.mkdirSync(dir, { recursive: true });

function check(which) {
  const app = APPS[which];
  if (!app) throw new HttpError(404, 'NOT_FOUND', '没有这个安装包');
  return app;
}

function info() {
  const out = {};
  for (const [key, app] of Object.entries(APPS)) {
    try {
      const st = fs.statSync(path.join(dir, app.file));
      out[key] = { available: true, size: st.size, updated_at: st.mtime.toISOString(), url: `/downloads/${app.file}` };
    } catch (_) {
      out[key] = { available: false };
    }
  }
  return out;
}

function save(which, buf) {
  const app = check(which);
  // APK 本质是 zip，开头是 PK\x03\x04，里面一定有 AndroidManifest.xml
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (!isZip || !buf.includes('AndroidManifest.xml')) {
    throw new HttpError(400, 'BAD_APK', '这不是安卓安装包（.apk）。GitHub 下载的是 zip，请先解压，再上传里面的 .apk 文件');
  }
  const tmp = path.join(dir, `${app.file}.uploading`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, path.join(dir, app.file));
  return info();
}

function remove(which) {
  const app = check(which);
  try { fs.unlinkSync(path.join(dir, app.file)); } catch (_) { /* 本来就没有 */ }
  return info();
}

function fileFor(rel) {
  const app = Object.values(APPS).find((a) => a.file === rel);
  return app || null;
}

module.exports = { info, save, remove, fileFor, dir, APPS };
