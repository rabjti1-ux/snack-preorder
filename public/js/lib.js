// 公共工具：HTML 模板、局部更新、接口请求、弹窗、实时推送
(function () {
  'use strict';

  // ---------- 安全的 HTML 模板 ----------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(String(s));
  function val(v) {
    if (v === null || v === undefined || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(val).join('');
    return esc(v);
  }
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
    return new Raw(out);
  }

  // ---------- 把新 HTML 合并到页面（保留输入框焦点和滚动位置） ----------
  function patch(container, content) {
    const tpl = document.createElement('template');
    tpl.innerHTML = content instanceof Raw ? content.s : String(content);
    morphChildren(container, tpl.content);
  }
  function morphChildren(from, to) {
    const fc = Array.from(from.childNodes);
    const tc = Array.from(to.childNodes);
    for (let i = 0; i < tc.length; i++) {
      if (i < fc.length) morphNode(fc[i], tc[i]);
      else from.appendChild(tc[i]);
    }
    for (let i = tc.length; i < fc.length; i++) from.removeChild(fc[i]);
  }
  function morphNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName ||
        (a.nodeType === 1 && a.getAttribute('data-key') !== b.getAttribute('data-key'))) {
      a.replaceWith(b);
      return;
    }
    if (a.nodeType === 3 || a.nodeType === 8) {
      if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
      return;
    }
    if (a.nodeType !== 1) return;
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    const tag = a.nodeName;
    if (tag === 'INPUT') {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      else if (a.type !== 'file' && document.activeElement !== a) {
        const v = b.getAttribute('value') || '';
        if (a.value !== v) a.value = v;
      }
      return;
    }
    if (tag === 'TEXTAREA') {
      if (document.activeElement !== a && a.value !== b.textContent) a.value = b.textContent;
      return;
    }
    morphChildren(a, b);
    if (tag === 'SELECT' && document.activeElement !== a) {
      const opts = Array.from(b.querySelectorAll('option'));
      const idx = opts.findIndex((o) => o.hasAttribute('selected'));
      a.selectedIndex = idx >= 0 ? idx : 0;
    }
  }

  // ---------- 格式化 ----------
  const yuan = (cents) => '¥' + (Number(cents || 0) / 100).toFixed(2);
  const yuanPlain = (cents) => (Number(cents || 0) / 100).toFixed(2);
  function parseYuan(text) {
    const s = String(text || '').trim();
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
    const [i, d = ''] = s.split('.');
    return Number(i) * 100 + Number((d + '00').slice(0, 2));
  }
  let shopTz = 'Asia/Shanghai';
  const setTimeZone = (tz) => { if (tz) shopTz = tz; };
  function fmtTime(iso, withDate = true) {
    if (!iso) return '';
    const d = new Date(iso);
    const opt = withDate
      ? { timeZone: shopTz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { timeZone: shopTz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    const p = {};
    for (const x of new Intl.DateTimeFormat('zh-CN', opt).formatToParts(d)) p[x.type] = x.value;
    return withDate ? `${p.month}月${p.day}日 ${p.hour}:${p.minute}` : `${p.hour}:${p.minute}`;
  }
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  // 取货日期显示：今天 / 明天 / 10月28日 周三
  function fmtDay(dateStr, today) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const wd = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    if (today) {
      if (dateStr === today) return `今天 ${m}月${d}日`;
      if (dateStr === addDays(today, 1)) return `明天 ${m}月${d}日`;
      if (dateStr === addDays(today, -1)) return `昨天 ${m}月${d}日`;
    }
    return `${m}月${d}日 ${wd}`;
  }
  function todayInShop() {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: shopTz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
    return `${p.year}-${p.month}-${p.day}`;
  }
  const isPhone = (s) => /^\+?[\d\s-]{7,20}$/.test(String(s || '').trim());
  const telHref = (s) => 'tel:' + String(s || '').replace(/[^\d+]/g, '');

  const STATUS = {
    pending: { text: '待商家确认', cls: 'st-pending' },
    preparing: { text: '备货中', cls: 'st-preparing' },
    ready: { text: '待取货', cls: 'st-ready' },
    completed: { text: '已完成', cls: 'st-completed' },
    rejected: { text: '已拒绝', cls: 'st-closed' },
    cancelled: { text: '已取消', cls: 'st-closed' },
  };
  const statusPill = (s) => html`<span class="pill ${STATUS[s] ? STATUS[s].cls : ''}">${STATUS[s] ? STATUS[s].text : s}</span>`;

  // ---------- 接口请求 ----------
  class ApiError extends Error {
    constructor(status, code, message, data) {
      super(message);
      this.status = status;
      this.code = code;
      this.data = data || {};
    }
  }
  async function request(method, url, body, opts = {}) {
    const headers = {};
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    let payload;
    if (body instanceof Blob) { payload = body; headers['Content-Type'] = body.type || 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    let res;
    try {
      res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', e.name === 'AbortError'
        ? '网络超时，没有收到服务器回复。请检查网络后重试。'
        : '网络连接失败，请检查网络后重试。');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON */ }
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.code) || 'HTTP_' + res.status,
        (data && data.message) || `服务器返回错误（${res.status}），请稍后再试。`, data);
    }
    return data;
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // ---------- 提示与弹窗（独立于页面内容，不会被刷新冲掉） ----------
  let toastTimer = null;
  function toast(msg, kind = '') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, kind === 'error' ? 4200 : 2400);
  }

  function modal(build) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true"></div>';
      const box = wrap.firstChild;
      document.body.appendChild(wrap);
      document.body.classList.add('modal-open');
      const close = (v) => {
        wrap.remove();
        if (!document.querySelector('.modal-wrap')) document.body.classList.remove('modal-open');
        resolve(v);
      };
      build(box, close);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
      const first = box.querySelector('input, textarea, button.primary');
      if (first) setTimeout(() => first.focus(), 30);
    });
  }

  function confirmDialog({ title, message = '', ok = '确定', cancel = '取消', danger = false }) {
    return modal((box, close) => {
      box.innerHTML = html`
        <h3>${title}</h3>
        ${message ? html`<p class="modal-msg">${message}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-r="0">${cancel}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${ok}</button>
        </div>`.s;
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (b) close(b.dataset.r === '1');
      });
    });
  }

  // 带输入框的弹窗：可选快捷原因
  function promptDialog({ title, message = '', placeholder = '', presets = [], ok = '确定', required = true, danger = false, inputMode = '', maxLength = 100, value = '' }) {
    return modal((box, close) => {
      box.innerHTML = html`
        <h3>${title}</h3>
        ${message ? html`<p class="modal-msg">${message}</p>` : ''}
        ${presets.length ? html`<div class="chips wrap">${presets.map((p) => html`<button type="button" class="chip" data-preset="${p}">${p}</button>`)}</div>` : ''}
        <textarea class="input" rows="2" maxlength="${maxLength}" placeholder="${placeholder}" ${inputMode ? raw(`inputmode="${inputMode}"`) : ''}>${value}</textarea>
        <p class="field-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-r="0">取消</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${ok}</button>
        </div>`.s;
      const ta = box.querySelector('textarea');
      const err = box.querySelector('.field-error');
      if (inputMode === 'numeric') { ta.rows = 1; ta.classList.add('code-input'); }
      box.addEventListener('click', (e) => {
        const p = e.target.closest('[data-preset]');
        if (p) { ta.value = p.dataset.preset; ta.focus(); return; }
        const b = e.target.closest('[data-r]');
        if (!b) return;
        if (b.dataset.r === '0') return close(null);
        const v = ta.value.trim();
        if (required && !v) { err.textContent = '请填写后再确定'; err.hidden = false; ta.focus(); return; }
        close(v);
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); box.querySelector('[data-r="1"]').click(); }
      });
    });
  }

  // 多个选项的弹窗：返回选中项的 value，取消返回 null
  function chooseDialog({ title, message = '', options = [], cancel = '取消' }) {
    return modal((box, close) => {
      box.innerHTML = html`
        <h3>${title}</h3>
        ${message ? html`<p class="modal-msg">${message}</p>` : ''}
        <div class="stack">${options.map((o, i) => html`<button type="button" class="btn block ${o.kind || ''}" data-i="${i}">${o.label}</button>`)}</div>
        <div class="modal-actions"><button type="button" class="btn ghost" data-i="-1">${cancel}</button></div>`.s;
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const i = Number(b.dataset.i);
        close(i < 0 ? null : options[i].value);
      });
    });
  }

  // ---------- 实时推送：断线自动重连，重连后通知页面刷新 ----------
  function connectEvents(getUrl, { onEvent, onStatus }) {
    let es = null;
    let retry = 1000;
    let stopped = false;
    let timer = null;
    function open() {
      if (stopped) return;
      const url = getUrl();
      if (!url) { timer = setTimeout(open, 3000); return; }
      es = new EventSource(url);
      es.addEventListener('hello', () => { retry = 1000; onStatus && onStatus(true); onEvent('reconnected', {}); });
      for (const name of ['order.created', 'order.updated', 'catalog.changed', 'shop.changed']) {
        es.addEventListener(name, (e) => {
          let data = {};
          try { data = JSON.parse(e.data); } catch (_) { /* ignore */ }
          onEvent(name, data);
        });
      }
      es.onerror = () => {
        onStatus && onStatus(false);
        if (es.readyState === EventSource.CLOSED) {
          es = null;
          timer = setTimeout(open, retry);
          retry = Math.min(retry * 2, 30000);
        }
      };
    }
    open();
    return {
      restart() { if (es) es.close(); es = null; clearTimeout(timer); open(); },
      stop() { stopped = true; if (es) es.close(); clearTimeout(timer); },
    };
  }

  // ---------- 本地存储（失败时不影响使用） ----------
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  // ---------- 简单路由（#/path） ----------
  function parseRoute() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs = ''] = h.split('?');
    return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
  }
  const go = (path) => { if (location.hash !== '#' + path) location.hash = path; };

  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  // 有输入框正在编辑时，延后整页刷新，避免打断输入
  const isEditing = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  };

  window.Lib = {
    html, raw, esc, patch, yuan, yuanPlain, parseYuan, fmtTime, fmtDay, todayInShop, addDays, setTimeZone,
    isPhone, telHref, STATUS, statusPill, request, ApiError, uuid, toast, modal, confirmDialog, promptDialog, chooseDialog,
    connectEvents, store, parseRoute, go, registerSW, isEditing,
  };
})();
