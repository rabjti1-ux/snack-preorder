// 商家端：登录、经营概览、订单、备货汇总、商品管理、店铺设置
(function () {
  'use strict';
  const {
    html, raw, patch, yuan, yuanPlain, parseYuan, fmtTime, fmtDay, request, toast, confirmDialog, promptDialog, chooseDialog, modal,
    connectEvents, store, parseRoute, go, statusPill, telHref, isPhone, addDays,
  } = Lib;

  const root = document.getElementById('app');
  document.body.classList.add('admin');

  const S = {
    token: store.get('snack.admin'),
    admin: null,
    shop: null,
    overview: null,
    orders: { status: 'pending', q: '', pay: '', list: null, counts: null, error: '' },
    orderDetail: {},
    orderError: {},
    prep: { date: '', slot: '', view: 'product', data: null, error: '' },
    catalog: null,
    catFilter: 'all',
    edit: null,
    shopForm: null,
    pwForm: { old: '', next: '' },
    verify: { code: '', results: null, error: '' },
    demo: null,
    apps: null,
    apkBusy: {},
    online: true,
    alerts: [], // 未查看的新订单
    sound: store.get('snack.sound', true),
    busy: {},
    login: { username: '', password: '', error: '', loading: false },
  };

  const api = async (method, url, body) => {
    try {
      return await request(method, url, body, { token: S.token });
    } catch (e) {
      if (e.status === 401 && e.code === 'ADMIN_AUTH') logoutLocal('登录已过期，请重新登录');
      throw e;
    }
  };

  const ICON = {
    home: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></svg>'),
    list: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>'),
    box: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 8 12 4l9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>'),
    tag: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>'),
    shop: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5c0 1.4 1.2 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8h13v-8"/></svg>'),
  };

  const today = () => (S.overview && S.overview.today) || Lib.todayInShop();

  // ---------- 登录 ----------
  function logoutLocal(msg) {
    S.token = null;
    store.del('snack.admin');
    S.admin = null;
    if (events) { events.stop(); events = null; }
    if (msg) toast(msg, 'error');
    go('/login');
  }

  async function doLogin() {
    const L = S.login;
    if (L.loading) return;
    if (!L.username.trim() || !L.password) { L.error = '请输入账号和密码'; render(); return; }
    L.loading = true; L.error = ''; render();
    try {
      const r = await request('POST', '/api/admin/login', { username: L.username.trim(), password: L.password });
      S.token = r.token;
      store.set('snack.admin', r.token);
      S.admin = r.admin;
      L.password = '';
      unlockAudio();
      await afterLogin();
      go('/');
    } catch (e) {
      L.error = e.message;
    }
    L.loading = false;
    render();
  }

  async function afterLogin() {
    await Promise.all([loadOverview(), loadOrders()]);
    startEvents();
  }

  // ---------- 数据 ----------
  async function loadOverview() {
    const r = await api('GET', '/api/admin/overview');
    S.overview = r;
    S.shop = r.shop;
  }
  async function loadOrders() {
    const o = S.orders;
    const qs = new URLSearchParams({ status: o.status, q: o.q.trim(), pay: o.pay || '' });
    try {
      const r = await api('GET', '/api/admin/orders?' + qs);
      o.list = r.orders;
      o.counts = r.counts;
      o.error = '';
    } catch (e) {
      o.error = e.message;
    }
  }
  async function loadOrder(id) {
    try {
      const r = await api('GET', `/api/admin/orders/${id}`);
      S.orderDetail[id] = r.order;
      delete S.orderError[id];
    } catch (e) {
      S.orderError[id] = e.message;
    }
  }
  async function loadPrep() {
    const p = S.prep;
    try {
      const r = await api('GET', '/api/admin/prep?' + new URLSearchParams({ date: p.date, slot: p.slot }));
      p.data = r;
      if (!p.date) p.date = r.date;
      p.error = '';
    } catch (e) {
      p.error = e.message;
    }
  }
  async function loadCatalog() {
    S.catalog = await api('GET', '/api/admin/catalog');
  }
  async function loadShopForm() {
    const r = await api('GET', '/api/admin/shop');
    const s = r.shop;
    S.shop = { ...(S.shop || {}), ...s };
    S.shopForm = {
      name: s.name, image: s.image, phone: s.phone, address: s.address, business_hours: s.business_hours, notice: s.notice,
      pause_message: s.pause_message, lead_minutes: String(s.lead_minutes), days_ahead: String(s.days_ahead),
      pay_wechat_qr: s.pay_wechat_qr || '', pay_alipay_qr: s.pay_alipay_qr || '', pay_note: s.pay_note || '',
      slots: s.pickup_slots.map((x) => ({ start: x.start, end: x.end })),
      saving: false, error: '', dirty: false,
    };
  }
  async function loadApps() {
    try { S.apps = (await request('GET', '/api/app-downloads')).apps; } catch (_) { /* ignore */ }
  }
  async function loadDemo() {
    try { S.demo = await api('GET', '/api/admin/demo'); } catch (_) { /* ignore */ }
  }

  // ---------- 新订单提醒：声音 + 振动 + 顶部提醒条 ----------
  let audioCtx = null;
  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* 不支持就算了 */ }
  }
  function ding() {
    if (!S.sound || !audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      [[880, 0], [1320, 0.18], [880, 0.5], [1320, 0.68]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.5, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + d);
        o.stop(t + d + 0.18);
      });
    } catch (_) { /* ignore */ }
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  let repeatTimer = null;
  let repeatLeft = 0;
  function alertNewOrder(data) {
    S.alerts.push(data);
    ding();
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (_) { /* ignore */ } }
    updateTitle();
    // 在安卓 APP 里：APP 在后台时弹系统通知
    if (window.SnackApp && window.SnackApp.showNotice) {
      try { window.SnackApp.showNotice('新预订', `${data.pickup_name}：${data.item_count} 件，${yuan(data.total_cents)}，${fmtDay(data.pickup_date, today())} ${data.pickup_slot} 取`, true); } catch (_) { /* ignore */ }
    } else if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('新预订', { body: `${data.pickup_name}：${data.item_count} 件，${yuan(data.total_cents)}`, tag: 'order-' + data.id }); } catch (_) { /* ignore */ }
    }
    // 没处理就每 30 秒再响一次，最多 10 次
    repeatLeft = 10;
    clearInterval(repeatTimer);
    repeatTimer = setInterval(() => {
      if (!S.alerts.length || --repeatLeft <= 0) { clearInterval(repeatTimer); return; }
      ding();
    }, 30_000);
  }
  function clearAlerts() {
    S.alerts = [];
    clearInterval(repeatTimer);
    updateTitle();
  }
  function updateTitle() {
    const pending = (S.overview && S.overview.counts.pending) || 0;
    document.title = S.alerts.length ? `(${S.alerts.length}) 新预订 - 商家后台` : pending ? `(${pending}) 待确认 - 商家后台` : '商家后台';
  }

  // ---------- 公共片段 ----------
  function tabbar(active) {
    const pending = (S.orders.counts && S.orders.counts.pending) || (S.overview && S.overview.counts.pending) || 0;
    const t = (key, href, icon, label, badge) => html`<a href="${href}" class="${active === key ? 'on' : ''}">${icon}<span>${label}</span>${badge ? html`<span class="badge">${badge}</span>` : ''}</a>`;
    return html`<nav class="tabbar" aria-label="商家导航">
      ${t('home', '#/', ICON.home, '概览')}
      ${t('orders', '#/orders', ICON.list, '订单', pending)}
      ${t('prep', '#/prep', ICON.box, '备货')}
      ${t('products', '#/products', ICON.tag, '商品')}
      ${t('shop', '#/shop', ICON.shop, '店铺')}
    </nav>`;
  }

  function header(title) {
    const accepting = S.shop ? S.shop.accepting_orders : true;
    return html`<header class="topbar">
      <span class="shop-title">${title}</span>
      ${S.shop ? html`<button type="button" class="accept-pill ${accepting ? 'on' : 'off'}" data-act="toggleAccept">${accepting ? '接单中' : '已暂停接单'}</button>` : ''}
    </header>`;
  }
  function backHeader(title, to) {
    return html`<header class="topbar"><button class="back" type="button" data-act="back" data-to="${to}" aria-label="返回">‹</button><h1>${title}</h1></header>`;
  }

  function alertBar() {
    if (!S.alerts.length) return '';
    const a = S.alerts[S.alerts.length - 1];
    const text = S.alerts.length === 1
      ? html`<strong>新预订</strong> ${a.pickup_name}，${a.item_count} 件，${yuan(a.total_cents)}<br>${fmtDay(a.pickup_date, today())} ${a.pickup_slot} 取`
      : html`<strong>有 ${S.alerts.length} 笔新预订</strong><br>最新：${a.pickup_name}，${yuan(a.total_cents)}`;
    return html`<div class="alert-new" role="alert">
      <div class="an-text">${text}</div>
      <button type="button" class="btn sm" data-act="viewAlerts">去处理</button>
      <button type="button" class="an-x" data-act="dismissAlerts" aria-label="关闭提醒">×</button>
    </div>`;
  }

  const offlineBar = () => (S.online ? '' : html`<div class="offline-bar">网络连接中断，新订单可能收不到提醒，正在重新连接…</div>`);

  function img(src, alt, cls = 'thumb') {
    if (!src) return html`<div class="${cls} empty-img" aria-hidden="true">${(alt || '').slice(0, 1)}</div>`;
    return html`<img class="${cls}" src="${src}" alt="" loading="lazy">`;
  }

  function contactLink(c) {
    return isPhone(c) ? html`<a href="${telHref(c)}" data-stop>${c}</a>` : html`${c}`;
  }

  // 订单卡片：谁订的、订了什么、各多少、几点来拿、备注、总共多少钱
  function orderCard(o, { full = false } = {}) {
    const isNew = S.alerts.some((a) => a.id === o.id);
    const closed = o.status === 'rejected' || o.status === 'cancelled';
    return html`<article class="ocard s-${o.status} ${isNew ? 'is-new' : ''}" data-key="o${o.id}">
      <div class="oc-head" ${full ? '' : raw(`data-act="openOrder" data-id="${o.id}"`)}>
        <div class="oc-who"><span class="oc-name">${o.pickup_name}</span><span class="oc-contact grow">${contactLink(o.pickup_contact)}</span>${statusPill(o.status)}</div>
        <div class="oc-when"><span><strong>${fmtDay(o.pickup_date, today())}</strong> <span class="num">${o.pickup_slot}</span></span><span><span class="code-label">取货码</span> <span class="code-tag">${o.pickup_code}</span></span></div>
      </div>
      <div class="oc-items" ${full ? '' : raw(`data-act="openOrder" data-id="${o.id}"`)}>
        <ul class="lines">${o.items.map((i) => html`<li><span class="l-name">${i.product_name}<span class="l-spec">${i.spec_name}</span></span><span class="l-qty">×${i.quantity}</span>${full ? html`<span class="l-sum">${yuan(i.subtotal_cents)}</span>` : ''}</li>`)}</ul>
      </div>
      ${o.note ? html`<p class="oc-note">备注：${o.note}</p>` : ''}
      ${closed && o.close_reason ? html`<p class="oc-reason">${o.closed_by === 'customer' ? '客户取消' : o.status === 'rejected' ? '拒单原因' : '取消原因'}：${o.close_reason}</p>` : ''}
      ${closed && !o.close_reason && o.closed_by === 'customer' ? html`<p class="oc-reason">客户自己取消了</p>` : ''}
      <div class="oc-foot"><span>共 ${o.item_count} 件 · <span class="num">#${o.order_no}</span></span><span><span class="price">${yuan(o.total_cents)}</span> ${payTag(o)}</span></div>
      ${payRow(o)}
      ${orderActions(o, full)}
    </article>`;
  }

  // 付款标签：未付款时就是“到店收”
  function payTag(o) {
    if (o.refund_due) return html`<span class="paytag pt-refund">待退款</span>`;
    if (o.pay_status === 'refunded') return html`<span class="paytag pt-muted">已退款</span>`;
    if (o.pay_status === 'paid') return html`<span class="paytag pt-paid">已收款${o.pay_method_text ? '·' + o.pay_method_text : ''}</span>`;
    if (o.pay_status === 'claimed') return html`<span class="paytag pt-claimed">待核对</span>`;
    if (o.status === 'rejected' || o.status === 'cancelled') return '';
    if (o.status === 'completed') return html`<span class="paytag pt-muted">未记收款</span>`;
    return html`<span class="small">到店收</span>`;
  }

  // 需要商家处理的付款：客户说已付款 / 需要退款
  function payRow(o) {
    const busy = S.busy['pay' + o.id] ? raw('disabled') : '';
    if (o.refund_due) {
      return html`<div class="oc-pay refund">
        <p>客户${o.pay_status === 'paid' ? '已付' : '说已付'} ${yuan(o.total_cents)}${o.pay_method_text ? `（${o.pay_method_text}）` : ''}，订单${o.status === 'rejected' ? '已拒单' : '已取消'}。请把钱退给客户，再点「已退款」。</p>
        <div class="oc-pay-btns"><button type="button" class="btn sm" data-act="payRefund" data-id="${o.id}" ${busy}>已退款</button></div>
      </div>`;
    }
    if (o.pay_status === 'claimed') {
      return html`<div class="oc-pay">
        <p><strong>${o.pickup_name}</strong> 说已用${o.pay_method_text}付了 ${yuan(o.total_cents)}。请在${o.pay_method_text}收款记录里核对（客户会备注取货码 ${o.pickup_code}）。</p>
        <div class="oc-pay-btns">
          <button type="button" class="btn sm" data-act="payReject" data-id="${o.id}" ${busy}>没收到</button>
          <button type="button" class="btn sm go" data-act="payConfirm" data-id="${o.id}" ${busy}>确认已收款</button>
        </div>
      </div>`;
    }
    return '';
  }

  function orderActions(o, full) {
    const busy = S.busy[o.id];
    const dis = busy ? raw('disabled') : '';
    if (o.status === 'pending') {
      return html`<div class="oc-actions">
        <button type="button" class="btn danger narrow" data-act="reject" data-id="${o.id}" ${dis}>拒单</button>
        <button type="button" class="btn primary" data-act="accept" data-id="${o.id}" ${dis}>接单</button>
      </div>`;
    }
    if (o.status === 'preparing') {
      return html`<div class="oc-actions">
        ${full ? html`<button type="button" class="btn danger narrow" data-act="cancel" data-id="${o.id}" ${dis}>取消订单</button>` : ''}
        <button type="button" class="btn blue" data-act="ready" data-id="${o.id}" ${dis}>备货完成</button>
      </div>`;
    }
    if (o.status === 'ready') {
      return html`<div class="oc-actions">
        ${full ? html`<button type="button" class="btn danger narrow" data-act="cancel" data-id="${o.id}" ${dis}>取消订单</button>` : ''}
        <button type="button" class="btn go" data-act="complete" data-id="${o.id}" ${dis}>核对取货码，完成取货</button>
      </div>`;
    }
    return '';
  }

  // ---------- 页面：登录 ----------
  function pageLogin() {
    const L = S.login;
    return html`<main class="login">
      <h1>商家登录</h1>
      <p class="muted" style="margin-bottom:18px">用店主的管理账号登录。客户请打开店铺首页下单。</p>
      <label class="field"><span class="label">账号</span><input class="input" autocomplete="username" autocapitalize="off" value="${L.username}" data-model="login.username"></label>
      <label class="field"><span class="label">密码</span><input class="input" type="password" autocomplete="current-password" value="${L.password}" data-model="login.password" data-enter="doLogin"></label>
      ${L.error ? html`<p class="field-error" role="alert">${L.error}</p>` : ''}
      <button type="button" class="btn primary block lg" style="margin-top:14px" data-act="doLogin" ${L.loading ? raw('disabled') : ''}>${L.loading ? '正在登录…' : '登录'}</button>
      <p class="small faint" style="margin-top:20px">忘记密码：在服务器上运行 <code>node server/cli.js reset-password 账号 新密码</code></p>
    </main>`;
  }

  // ---------- 页面：经营概览 ----------
  function pageHome() {
    const ov = S.overview;
    if (!ov) return html`${header('经营概览')}<div class="loading">正在加载…</div>${tabbar('home')}`;
    const c = ov.counts;
    const v = S.verify;
    const accepting = S.shop.accepting_orders;
    return html`
      ${header(S.shop.name)}
      ${alertBar()}${offlineBar()}
      <div class="accept-card ${accepting ? '' : 'off'}">
        <div class="grow">
          <div class="ac-title">${accepting ? '正在接单' : '已暂停接单'}</div>
          <div class="ac-sub">${accepting ? '客户可以提交新的预订' : '客户能看商品，但不能提交新预订'}${!accepting && S.shop.pause_message ? html`：${S.shop.pause_message}` : ''}</div>
        </div>
        <label class="switch" aria-label="接单开关"><input type="checkbox" data-act="toggleAccept" ${accepting ? raw('checked') : ''}><span></span></label>
      </div>

      <div class="tiles">
        <a class="tile hot" href="#/orders?status=pending"><div class="t-n">${c.pending}</div><div class="t-l">待确认</div></a>
        <a class="tile blue" href="#/orders?status=preparing"><div class="t-n">${c.preparing}</div><div class="t-l">备货中</div></a>
        <a class="tile green" href="#/orders?status=ready"><div class="t-n">${c.ready}</div><div class="t-l">待取货</div></a>
      </div>
      <p class="today-line">今天新预订 <span class="num">${ov.created_today}</span> 笔，已取货 <span class="num">${ov.completed_today}</span> 笔，合计 <span class="num">${yuan(ov.completed_today_cents)}</span><br><span class="small faint">金额为订单金额，钱在店里线下收，APP 不经手。</span></p>

      ${ov.pay_claimed ? html`<a class="banner warn pay-banner" href="#/orders?pay=claimed"><strong>${ov.pay_claimed} 笔客户说已付款</strong>，等你核对收款记录</a>` : ''}
      ${ov.refund_due ? html`<a class="banner stop pay-banner" href="#/orders?pay=refund"><strong>${ov.refund_due} 笔需要退款</strong>：客户付过钱，订单已取消或拒单</a>` : ''}

      <section class="verify">
        <h2>客户来取货</h2>
        <div class="row">
          <input class="input grow" inputmode="numeric" maxlength="6" placeholder="输入取货码" value="${v.code}" data-model="verify.code" data-enter="verify" aria-label="取货码">
          <button type="button" class="btn dark lg" data-act="verify">查找</button>
        </div>
        ${v.error ? html`<p class="field-error">${v.error}</p>` : ''}
      </section>
      ${v.results ? (v.results.length
        ? v.results.map((o) => orderCard(o))
        : html`<p class="banner warn">没有找到取货码为 ${v.code} 的待取订单。请让客户打开「我的预订」再核对一下。</p>`) : ''}

      <section style="margin-top:6px">
        <div class="section-head"><h2>待确认的预订</h2>${c.pending > ov.pending.length ? html`<a href="#/orders?status=pending" class="small">全部 ${c.pending} 笔</a>` : ''}</div>
        ${ov.pending.length ? ov.pending.map((o) => orderCard(o)) : html`<p class="pad muted" style="background:var(--surface)">没有待确认的预订。新预订到达时会响铃提醒。</p>`}
      </section>

      ${ov.out_of_stock.length ? html`<section class="section">
        <div class="section-head"><h2>已经没库存</h2><a href="#/products" class="small">去补库存</a></div>
        <p class="pad" style="padding-top:0">${ov.out_of_stock.map((s, i) => html`${i ? '、' : ''}${s.product_name}（${s.spec_name}）`)}</p>
      </section>` : ''}
      ${S.demo && S.demo.products > 0 ? html`<p class="banner info">店里现在有 ${S.demo.products} 件示例商品。正式营业前，到「店铺」页底部一键清理。</p>` : ''}
      ${tabbar('home')}`;
  }

  // ---------- 页面：订单列表 ----------
  const TABS = [['pending', '待确认'], ['preparing', '备货中'], ['ready', '待取货'], ['completed', '已完成'], ['closed', '已取消/拒绝']];

  function pageOrders() {
    const o = S.orders;
    let body;
    if (o.error && !o.list) body = html`<div class="error-box"><p>${o.error}</p><button class="btn" type="button" data-act="reloadOrders">重新加载</button></div>`;
    else if (!o.list) body = html`<div class="loading">正在加载…</div>`;
    else if (!o.list.length) {
      body = html`<div class="empty"><p class="big">${o.pay ? '都处理完了' : o.q ? `没有找到「${o.q}」` : `没有${(TABS.find((t) => t[0] === o.status) || ['', ''])[1]}的订单`}</p></div>`;
    } else {
      const active = ['pending', 'preparing', 'ready'].includes(o.status) && !o.q && !o.pay;
      if (active) {
        const out = [];
        let lastDay = null;
        for (const ord of o.list) {
          if (ord.pickup_date !== lastDay) { lastDay = ord.pickup_date; out.push(html`<h3 class="day-head">${fmtDay(ord.pickup_date, today())} 取货</h3>`); }
          out.push(orderCard(ord));
        }
        body = out;
      } else body = o.list.map((ord) => orderCard(ord));
    }
    const counts = o.counts || {};
    return html`
      ${header('订单')}
      ${alertBar()}${offlineBar()}
      ${o.pay ? html`<div class="pay-filter" data-key="payfilter"><span class="grow">${o.pay === 'claimed' ? '客户说已付款，等你核对' : '需要退款的订单'}</span><button type="button" class="btn sm" data-act="otab" data-id="pending">看全部订单</button></div>` : ''}
      <div class="otabs" role="tablist" data-key="otabs">
        ${TABS.map(([k, label]) => html`<button type="button" class="chip ${o.status === k && !o.pay ? 'on' : ''}" data-act="otab" data-id="${k}">${label}${counts[k] !== undefined && k !== 'completed' && k !== 'closed' ? html`<span class="n">${counts[k]}</span>` : ''}</button>`)}
      </div>
      <div class="osearch"><input class="input" type="search" placeholder="搜订单号 / 取货人 / 电话 / 取货码" value="${o.q}" data-model="orders.q" aria-label="搜索订单"></div>
      ${body}
      <div style="height:12px"></div>
      ${tabbar('orders')}`;
  }

  // ---------- 页面：订单详情 ----------
  function pageOrder(id) {
    const o = S.orderDetail[id];
    if (!o) {
      return html`${backHeader('订单详情', '/orders')}${S.orderError[id] ? html`<div class="error-box"><p>${S.orderError[id]}</p></div>` : html`<div class="loading">正在加载…</div>`}`;
    }
    const EV = {
      pending: '客户提交预订', preparing: '接单，开始备货', ready: '备货完成', completed: '客户已取货', rejected: '拒单', cancelled: '取消',
      pay_claimed: '客户说已付款', pay_confirmed: '确认收款', pay_rejected: '没查到付款', refunded: '已退款',
    };
    return html`
      ${backHeader('订单 #' + o.order_no, '/orders')}
      ${alertBar()}${offlineBar()}
      ${orderCard(o, { full: true })}
      <section class="section">
        <div class="section-head"><h2>订单信息</h2></div>
        <dl class="kv pad" style="padding-top:0">
          <dt>取货人</dt><dd>${o.pickup_name}</dd>
          <dt>联系方式</dt><dd>${contactLink(o.pickup_contact)}</dd>
          <dt>取货时间</dt><dd>${fmtDay(o.pickup_date, today())} <span class="num">${o.pickup_slot}</span></dd>
          <dt>下单时间</dt><dd>${fmtTime(o.created_at)}</dd>
          <dt>订单号</dt><dd class="num">${o.order_no}</dd>
          <dt>付款</dt><dd>${payText(o)}
            ${!['rejected', 'cancelled'].includes(o.status) && o.pay_status === 'unpaid' ? html`<br><button type="button" class="btn sm" style="margin-top:6px" data-act="payMark" data-id="${o.id}">标记已收款</button>` : ''}</dd>
          <dt>客户记录</dt><dd>${o.customer_order_count > 1 ? `这位客户第 ${o.customer_order_count} 次预订` : '第一次在店里预订'}</dd>
        </dl>
      </section>
      ${isPhone(o.pickup_contact) && ['pending', 'preparing', 'ready'].includes(o.status) ? html`<div class="pad"><a class="btn block" href="${telHref(o.pickup_contact)}">打电话给 ${o.pickup_name}</a></div>` : ''}
      ${['pending', 'preparing'].includes(o.status) ? html`<p class="warn-note">缺货或需要换商品时，请先联系客户。订单里的商品和金额不能在这里修改；客户同意换的话，可以取消这单，请客户重新下单。</p>` : ''}
      <section class="section">
        <div class="section-head"><h2>处理记录</h2></div>
        <ul class="timeline pad" style="padding-top:2px">${[...o.events].reverse().map((e) => html`<li><span class="tl-main">${e.status === 'cancelled' && e.actor === 'customer' ? '客户取消' : EV[e.status] || e.status}${['pay_claimed', 'pay_confirmed'].includes(e.status) && e.note ? `（${e.note}）` : ''}</span> · ${fmtTime(e.created_at)}${e.note && !['pay_claimed', 'pay_confirmed'].includes(e.status) ? html`<br>${e.status.startsWith('pay') || e.status === 'refunded' ? '说明' : '原因'}：${e.note}` : ''}</li>`)}</ul>
      </section>
      <div style="height:16px"></div>`;
  }

  // ---------- 页面：备货汇总 ----------
  function pagePrep() {
    const p = S.prep;
    const d = p.data;
    const t = today();
    const dayChips = [0, 1, 2].map((i) => addDays(t, i));
    let body;
    if (p.error && !d) body = html`<div class="error-box"><p>${p.error}</p><button class="btn" type="button" data-act="reloadPrep">重新加载</button></div>`;
    else if (!d) body = html`<div class="loading">正在汇总…</div>`;
    else {
      const sec = (g, cls, title, sub, open = true) => {
        if (!g.order_count) return '';
        const inner = p.view === 'product' ? prepProducts(g) : prepCustomers(g);
        const headInner = html`<h2>${cls === 'done' ? html`<span class="chev">›</span> ` : ''}${title}</h2><span class="muted">${g.order_count} 笔 · ${g.item_count} 件${sub ? html` · ${sub}` : ''}</span>`;
        if (!open) return html`<details class="prep-sec ${cls}"><summary class="ps-head">${headInner}</summary>${inner}</details>`;
        return html`<section class="prep-sec ${cls}"><div class="ps-head">${headInner}</div>${inner}</section>`;
      };
      const pendingQty = d.todo.products.reduce((s, x) => s + x.pending_quantity, 0);
      const empty = !d.todo.order_count && !d.ready.order_count && !d.completed.order_count;
      body = empty
        ? html`<div class="empty"><p class="big">${fmtDay(d.date, t)}${p.slot ? ` ${p.slot}` : ''} 没有要备的货</p><p>已取消和已拒绝的订单不会算进来。</p></div>`
        : html`
          ${sec(d.todo, 'todo', '需要备货', pendingQty ? html`<span style="color:var(--amber)">${pendingQty} 件未接单</span>` : '')}
          ${d.todo.order_count === 0 ? html`<p class="banner ok">这个时段的货都备好了。</p>` : ''}
          ${sec(d.ready, 'ready', '已备好，等客户来取')}
          ${sec(d.completed, 'done', '已取走', '', false)}
          <p class="pad small faint">不含已取消、已拒绝的订单。“需要备货”包含已接单和还没接单的预订，未接单的数量单独标出。</p>`;
    }
    return html`
      ${header('备货汇总')}
      ${alertBar()}${offlineBar()}
      <div class="prep-filters">
        <div class="chips">
          ${dayChips.map((x, i) => html`<button type="button" class="chip ${p.date === x ? 'on' : ''}" data-act="prepDate" data-id="${x}">${['今天', '明天', '后天'][i]}</button>`)}
          <input class="input" type="date" value="${p.date}" data-model="prep.date" aria-label="选择日期" style="max-width:160px">
        </div>
        ${d ? html`<div class="chips">
          <button type="button" class="chip ${!p.slot ? 'on' : ''}" data-act="prepSlot" data-id="">全部时段</button>
          ${d.slots.map((s) => html`<button type="button" class="chip num ${p.slot === s ? 'on' : ''}" data-act="prepSlot" data-id="${s}">${s}</button>`)}
        </div>` : ''}
        <div class="seg">
          <button type="button" class="${p.view === 'product' ? 'on' : ''}" data-act="prepView" data-id="product">按商品汇总</button>
          <button type="button" class="${p.view === 'customer' ? 'on' : ''}" data-act="prepView" data-id="customer">按客户查看</button>
        </div>
      </div>
      ${body}
      ${tabbar('prep')}`;
  }

  function prepProducts(g) {
    return html`<ul class="ptable">${g.products.map((x) => html`<li>
      ${img(x.image, x.product_name, 'thumb sm')}
      <span class="pt-name">${x.product_name}<small>${x.spec_name} · ${x.order_count} 笔订单</small></span>
      <span><span class="pt-qty">${x.quantity}</span>${x.pending_quantity ? html`<span class="pt-pending">${x.pending_quantity} 件未接单</span>` : ''}</span>
    </li>`)}</ul>`;
  }

  function prepCustomers(g) {
    return html`<div class="pcust">${g.orders.map((o) => html`<div class="pc" data-act="openOrder" data-id="${o.id}">
      <div class="pc-top"><span class="pc-name">${o.pickup_name}</span><span class="num muted grow">${o.pickup_slot}</span><span class="code-tag">${o.pickup_code}</span>${statusPill(o.status)}</div>
      ${o.pay_status === 'paid' ? html`<div class="small" style="color:var(--green)">已付款${o.pay_method_text ? '（' + o.pay_method_text + '）' : ''}，取货时不用收钱</div>` : ''}
      <div class="pc-items">${o.items.map((i) => html`<span class="pc-item">${i.product_name}<span class="muted">（${i.spec_name}）</span> <b>×${i.quantity}</b></span>`)}</div>
      ${o.note ? html`<div class="small" style="color:#7a5a00">备注：${o.note}</div>` : ''}
    </div>`)}</div>`;
  }

  // ---------- 页面：商品管理 ----------
  const PSTATUS = { on: '在售', sold_out: '售罄', off: '已下架' };

  function pageProducts() {
    const c = S.catalog;
    if (!c) return html`${header('商品管理')}<div class="loading">正在加载…</div>${tabbar('products')}`;
    let list = c.products;
    if (S.catFilter === 'none') list = list.filter((p) => !p.category_id);
    else if (S.catFilter !== 'all') list = list.filter((p) => String(p.category_id) === S.catFilter);
    const hasNone = c.products.some((p) => !p.category_id);
    const catName = (id) => { const x = c.categories.find((k) => k.id === id); return x ? x.name : '未分类'; };
    return html`
      ${header('商品管理')}
      ${alertBar()}${offlineBar()}
      <div class="pad row" style="padding-bottom:4px">
        <a class="btn primary grow" href="#/products/new">＋ 新增商品</a>
        <button type="button" class="btn" data-act="manageCats">管理分类</button>
      </div>
      <div class="chips" style="padding:6px 12px 10px">
        <button type="button" class="chip ${S.catFilter === 'all' ? 'on' : ''}" data-act="pcat" data-id="all">全部 ${c.products.length}</button>
        ${c.categories.map((k) => html`<button type="button" class="chip ${S.catFilter === String(k.id) ? 'on' : ''}" data-act="pcat" data-id="${k.id}">${k.name}</button>`)}
        ${hasNone ? html`<button type="button" class="chip ${S.catFilter === 'none' ? 'on' : ''}" data-act="pcat" data-id="none">未分类</button>` : ''}
      </div>
      ${list.length ? html`<div>${list.map((p, idx) => {
        const sameCat = list.filter((x) => x.category_id === p.category_id);
        const pos = sameCat.indexOf(p);
        return html`<div class="mprod ${p.status === 'off' ? 'off' : ''}" data-key="m${p.id}">
          <div class="mp-left">
            ${img(p.image, p.name)}
            <div class="mp-sort">
              <button type="button" class="icon-btn" data-act="pmove" data-id="${p.id}" data-d="up" aria-label="上移" ${pos <= 0 ? raw('disabled') : ''}>↑</button>
              <button type="button" class="icon-btn" data-act="pmove" data-id="${p.id}" data-d="down" aria-label="下移" ${pos >= sameCat.length - 1 ? raw('disabled') : ''}>↓</button>
            </div>
          </div>
          <div class="mp-body">
            <div class="row" style="gap:8px;align-items:flex-start"><span class="mp-name grow">${p.name}</span><span class="pill ps-${p.status}">${PSTATUS[p.status]}</span></div>
            <div class="mp-specs">${p.specs.map((s) => html`<div>${s.name} <span class="num strong">${yuan(s.price_cents)}</span> · ${s.stock === null ? '库存不限' : html`<span class="${s.stock === 0 ? 'zero' : ''}">库存 ${s.stock}</span>`}</div>`)}
              <div class="faint">${catName(p.category_id)}${p.is_demo ? ' · 示例' : ''}</div></div>
            <div class="mp-actions">
              <a class="btn sm" href="#/products/${p.id}">编辑</a>
              ${p.status === 'on' ? html`<button type="button" class="btn sm" data-act="pstatus" data-id="${p.id}" data-s="sold_out">设为售罄</button>` : ''}
              ${p.status === 'sold_out' ? html`<button type="button" class="btn sm" data-act="pstatus" data-id="${p.id}" data-s="on">恢复销售</button>` : ''}
              ${p.status !== 'off' ? html`<button type="button" class="btn sm" data-act="pstatus" data-id="${p.id}" data-s="off">下架</button>` : html`<button type="button" class="btn sm" data-act="pstatus" data-id="${p.id}" data-s="on">重新上架</button>`}
            </div>
          </div>
        </div>`;
      })}</div>` : html`<div class="empty"><p class="big">这里还没有商品</p><p>点「新增商品」添加第一件。</p></div>`}
      <p class="pad small faint">图片下面的 ↑ ↓ 调整同一分类里的展示顺序。售罄的商品客户能看到但不能订；下架的商品客户看不到。</p>
      ${tabbar('products')}`;
  }

  // ---------- 页面：商品编辑 ----------
  function newEdit(p) {
    if (!p) {
      return { id: null, name: '', category_id: S.catFilter !== 'all' && S.catFilter !== 'none' ? S.catFilter : '', description: '', image: '', status: 'on',
        specs: [{ id: null, name: '单包', price: '', stock: '' }], saving: false, uploading: false, error: '', errors: {} };
    }
    return {
      id: p.id, name: p.name, category_id: p.category_id ? String(p.category_id) : '', description: p.description, image: p.image, status: p.status,
      specs: p.specs.map((s) => ({ id: s.id, name: s.name, price: yuanPlain(s.price_cents), stock: s.stock === null ? '' : String(s.stock), origPrice: s.price_cents })),
      saving: false, uploading: false, error: '', errors: {},
    };
  }

  function pageEdit() {
    const e = S.edit;
    if (!e || !S.catalog) return html`${backHeader('商品', '/products')}<div class="loading">正在加载…</div>`;
    const cats = S.catalog.categories;
    const err = e.errors;
    const priceChanged = e.id && e.specs.some((s) => s.id && s.origPrice !== undefined && parseYuan(s.price) !== null && parseYuan(s.price) !== s.origPrice);
    return html`
      ${backHeader(e.id ? '编辑商品' : '新增商品', '/products')}
      ${offlineBar()}
      <section class="section">
        <div class="field">
          <span class="label">商品图片</span>
          <div class="img-edit">
            ${e.image ? html`<img class="preview" src="${e.image}" alt="">` : html`<div class="preview">还没有图片</div>`}
            <div class="stack">
              <label class="btn file-btn">${e.uploading ? '正在上传…' : e.image ? '换一张' : '上传图片'}<input type="file" accept="image/*" data-upload="product" ${e.uploading ? raw('disabled') : ''}></label>
              ${e.image ? html`<button type="button" class="link-btn" data-act="removeImage">移除图片</button>` : ''}
            </div>
          </div>
        </div>
        <label class="field"><span class="label">商品名称</span>
          <input class="input ${err.name ? 'invalid' : ''}" maxlength="40" placeholder="比如：可乐 330ml" value="${e.name}" data-model="edit.name">
          ${err.name ? html`<p class="field-error">${err.name}</p>` : ''}
        </label>
        <label class="field"><span class="label">分类</span>
          <select class="input" data-model="edit.category_id">
            <option value="" ${!e.category_id ? raw('selected') : ''}>未分类</option>
            ${cats.map((c) => html`<option value="${c.id}" ${String(c.id) === e.category_id ? raw('selected') : ''}>${c.name}</option>`)}
          </select>
          <span class="hint">没有合适的分类？到商品管理页点「管理分类」添加。</span>
        </label>
        <label class="field"><span class="label">商品说明 <span class="faint small">（可不填）</span></span>
          <textarea class="input" maxlength="500" rows="2" placeholder="口味、包装、注意事项等" data-model="edit.description">${e.description}</textarea>
        </label>
      </section>

      <section class="section">
        <div class="section-head"><h2>规格、价格和库存</h2></div>
        <div class="pad" style="padding-top:0">
          ${e.specs.map((s, i) => html`<div class="spec-edit" data-key="s${i}">
            <div class="se-head">
              <input class="input grow ${err['spec' + i] ? 'invalid' : ''}" maxlength="20" placeholder="规格名称，比如 单包 / 整盒" value="${s.name}" data-model="spec.${i}.name" aria-label="规格名称">
              ${e.specs.length > 1 ? html`<button type="button" class="icon-btn" data-act="delSpec" data-id="${i}" aria-label="删除这个规格">✕</button>` : ''}
            </div>
            <div class="se-grid">
              <label>价格（元）<input class="input num" inputmode="decimal" placeholder="0.00" value="${s.price}" data-model="spec.${i}.price"></label>
              <label>库存（留空 = 不限）<input class="input num" inputmode="numeric" placeholder="不限" value="${s.stock}" data-model="spec.${i}.stock"></label>
            </div>
            ${err['spec' + i] ? html`<p class="field-error">${err['spec' + i]}</p>` : ''}
          </div>`)}
          ${e.specs.length < 10 ? html`<button type="button" class="btn block" data-act="addSpec">＋ 添加规格</button>` : ''}
          <p class="hint" style="margin-top:8px">库存是还能被预订的数量：客户下单自动扣减，取消或拒单自动加回。</p>
          ${priceChanged ? html`<p class="banner info" style="margin:10px 0 0">改价只影响之后的预订，已经提交的订单仍按下单时的价格。</p>` : ''}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>销售状态</h2></div>
        <div class="pad chips wrap" style="padding-top:0">
          ${[['on', '在售'], ['sold_out', '售罄（客户能看到，不能订）'], ['off', '下架（客户看不到）']].map(([k, label]) => html`<button type="button" class="chip ${e.status === k ? 'on' : ''}" data-act="estatus" data-id="${k}">${label}</button>`)}
        </div>
      </section>

      ${e.error ? html`<p class="banner stop" role="alert">${e.error}</p>` : ''}
      ${e.id ? html`<div class="pad"><button type="button" class="btn danger block" data-act="deleteProduct">删除这件商品</button></div>` : ''}
      <div style="height:90px"></div>
      <div class="actionbar">
        <a class="btn cancel" href="#/products">取消</a>
        <button type="button" class="btn primary lg grow" data-act="saveProduct" ${e.saving || e.uploading ? raw('disabled') : ''}>${e.saving ? '正在保存…' : '保存'}</button>
      </div>`;
  }

  // ---------- 手机 APP 安装包 ----------
  const fmtSize = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

  function appSection() {
    const a = S.apps;
    const row = (key, label) => {
      const x = a && a[key];
      const busy = S.apkBusy[key];
      return html`<div class="apk-row">
        <div class="grow"><div class="strong">${label}</div>
          <div class="small ${x && x.available ? 'muted' : 'faint'}">${!a ? '正在查询…' : x.available ? `已上传 ${fmtSize(x.size)} · ${fmtTime(x.updated_at)}` : '还没上传'}</div></div>
        <label class="btn sm file-btn">${busy ? '正在上传…' : x && x.available ? '更新' : '上传 APK'}<input type="file" accept=".apk,application/vnd.android.package-archive" data-apk="${key}" ${busy ? raw('disabled') : ''}></label>
        ${x && x.available ? html`<button type="button" class="icon-btn" data-act="delApk" data-id="${key}" aria-label="删除">✕</button>` : ''}
      </div>`;
    };
    return html`<section class="section">
      <div class="section-head"><h2>手机 APP</h2></div>
      <div class="pad" style="padding-top:0">
        <p class="small muted">客户下载页（安卓下载安装包，苹果手机教添加到主屏幕）：</p>
        <div class="copy-line" style="margin-top:6px"><code>${location.origin}/download</code><button type="button" class="btn sm" data-act="copyLink" data-path="/download">复制</button></div>
        <p class="small muted" style="margin-top:12px">商家版下载页（给店员用）：</p>
        <div class="copy-line" style="margin-top:6px"><code>${location.origin}/download?for=merchant</code><button type="button" class="btn sm" data-act="copyLink" data-path="/download?for=merchant">复制</button></div>
        <div style="margin-top:14px">
          ${row('customer', '安卓客户版（零食预订）')}
          ${row('merchant', '安卓商家版（商家后台）')}
        </div>
        <p class="small faint" style="margin-top:8px">安装包由 GitHub Actions 打包：下载 zip，解压后把 snack-customer.apk、snack-merchant.apk 分别传到这里。</p>
      </div>
    </section>`;
  }

  async function uploadApk(file, which) {
    if (file.size > 50 * 1024 * 1024) { toast('安装包不能超过 50 MB', 'error'); return; }
    S.apkBusy[which] = true;
    render();
    try {
      const r = await request('POST', `/api/admin/apps/${which}`, file, { token: S.token, timeout: 300_000 });
      S.apps = r.apps;
      toast('安装包已上传，客户在下载页就能下载', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    delete S.apkBusy[which];
    render();
  }

  // ---------- 页面：店铺设置 ----------
  function pageShop() {
    const f = S.shopForm;
    if (!f) return html`${header('店铺设置')}<div class="loading">正在加载…</div>${tabbar('shop')}`;
    const accepting = S.shop.accepting_orders;
    const customerUrl = location.origin + '/';
    const pw = S.pwForm;
    return html`
      ${header('店铺设置')}
      ${alertBar()}${offlineBar()}
      <div class="accept-card ${accepting ? '' : 'off'}">
        <div class="grow"><div class="ac-title">${accepting ? '正在接单' : '已暂停接单'}</div><div class="ac-sub">临时有事可以先暂停，客户仍能看商品</div></div>
        <label class="switch" aria-label="接单开关"><input type="checkbox" data-act="toggleAccept" ${accepting ? raw('checked') : ''}><span></span></label>
      </div>

      <section class="section">
        <div class="section-head"><h2>给客户的链接</h2></div>
        <div class="pad copy-line" style="padding-top:0"><code>${customerUrl}</code><button type="button" class="btn sm" data-act="copyLink">复制</button></div>
        <p class="pad small faint" style="padding-top:0">把这个链接发给客户，打开就能预订。</p>
      </section>

      ${appSection()}

      <section class="section">
        <div class="section-head"><h2>店铺信息</h2></div>
        <div class="field">
          <span class="label">店铺图片</span>
          <div class="img-edit">
            ${f.image ? html`<img class="preview" src="${f.image}" alt="">` : html`<div class="preview">没有图片</div>`}
            <div class="stack">
              <label class="btn file-btn">${f.uploading ? '正在上传…' : '上传图片'}<input type="file" accept="image/*" data-upload="shop"></label>
              ${f.image ? html`<button type="button" class="link-btn" data-act="removeShopImage">移除图片</button>` : ''}
            </div>
          </div>
        </div>
        <label class="field"><span class="label">店名</span><input class="input" maxlength="30" value="${f.name}" data-model="shop.name"></label>
        <label class="field"><span class="label">联系电话</span><input class="input" maxlength="30" inputmode="tel" value="${f.phone}" data-model="shop.phone"></label>
        <label class="field"><span class="label">地址</span><input class="input" maxlength="100" value="${f.address}" data-model="shop.address" placeholder="客户来取货的地方"></label>
        <label class="field"><span class="label">营业时间</span><input class="input" maxlength="60" value="${f.business_hours}" data-model="shop.business_hours" placeholder="比如：每天 10:00–21:00"></label>
        <label class="field"><span class="label">公告</span><textarea class="input" maxlength="300" rows="3" data-model="shop.notice" placeholder="显示在店铺首页">${f.notice}</textarea></label>
        <label class="field"><span class="label">暂停接单时的说明</span><input class="input" maxlength="100" value="${f.pause_message}" data-model="shop.pause_message" placeholder="比如：今天进货，明天恢复"></label>
      </section>

      <section class="section">
        <div class="section-head"><h2>收款码（可选）</h2></div>
        <p class="pad small muted" style="padding-top:0">上传后，客户下单后可以扫码提前付款，然后点「我已付款」；你在收款记录里核对后点「确认已收款」。APP 不会自动扣款，也不会自动确认到账。不上传就只能到店付。</p>
        <div class="pad qr-edit" style="padding-top:0">
          ${[['wechat', '微信收款码'], ['alipay', '支付宝收款码']].map(([k, label]) => {
            const img = f['pay_' + k + '_qr'];
            return html`<div class="qr-slot">
              ${img ? html`<img class="qr-preview" src="${img}" alt="${label}">` : html`<div class="qr-preview empty">${label}</div>`}
              <label class="btn sm file-btn">${img ? '换一张' : '上传' + label}<input type="file" accept="image/*" data-upload="${k}"></label>
              ${img ? html`<button type="button" class="link-btn" data-act="removeQr" data-id="${k}">移除</button>` : ''}
            </div>`;
          })}
        </div>
        <label class="field"><span class="label">付款说明 <span class="faint small">（可不填）</span></span><input class="input" maxlength="100" value="${f.pay_note}" data-model="shop.pay_note" placeholder="比如：金额不对或付错了，直接联系店主"></label>
        <p class="pad small faint" style="padding-top:0">建议用微信“经营收款码”，不需要营业执照，和个人零花钱分开。记得点下面的「保存店铺设置」。</p>
      </section>

      <section class="section">
        <div class="section-head"><h2>取货时间</h2></div>
        <div class="pad" style="padding-top:0">
          <p class="small muted" style="margin-bottom:8px">客户只能在这些时段里选。</p>
          ${f.slots.map((s, i) => html`<div class="slot-edit" data-key="t${i}">
            <input class="input" type="time" value="${s.start}" data-model="slot.${i}.start" aria-label="开始时间">
            <span>到</span>
            <input class="input" type="time" value="${s.end}" data-model="slot.${i}.end" aria-label="结束时间">
            <button type="button" class="icon-btn" data-act="delSlot" data-id="${i}" aria-label="删除这个时段" ${f.slots.length <= 1 ? raw('disabled') : ''}>✕</button>
          </div>`)}
          ${f.slots.length < 12 ? html`<button type="button" class="btn block" data-act="addSlot">＋ 添加时段</button>` : ''}
        </div>
        <label class="field"><span class="label">至少提前多少分钟预订</span>
          <input class="input num" inputmode="numeric" value="${f.lead_minutes}" data-model="shop.lead_minutes">
          <span class="hint">离时段结束不到这么多分钟，客户就不能再选这个时段。</span>
        </label>
        <label class="field"><span class="label">可以预约几天内的</span>
          <select class="input" data-model="shop.days_ahead">
            ${[1, 2, 3, 4, 5, 6, 7].map((n) => html`<option value="${n}" ${String(n) === f.days_ahead ? raw('selected') : ''}>${n === 1 ? '只能约今天' : `今天起 ${n} 天`}</option>`)}
          </select>
        </label>
      </section>
      ${f.error ? html`<p class="banner stop" role="alert">${f.error}</p>` : ''}
      <div class="pad"><button type="button" class="btn primary block lg" data-act="saveShop" ${f.saving ? raw('disabled') : ''}>${f.saving ? '正在保存…' : '保存店铺设置'}</button></div>

      <section class="section">
        <div class="section-head"><h2>新订单提醒</h2></div>
        <div class="pad row between" style="padding-top:0"><span>响铃提醒</span><label class="switch"><input type="checkbox" data-act="toggleSound" ${S.sound ? raw('checked') : ''}><span></span></label></div>
        <div class="pad btn-row" style="padding-top:0">
          <button type="button" class="btn sm" data-act="testSound">试听铃声</button>
          ${'Notification' in window && window.isSecureContext ? html`<button type="button" class="btn sm" data-act="askNotify">${Notification.permission === 'granted' ? '系统通知已开启' : '开启系统通知'}</button>` : ''}
        </div>
        <p class="pad small faint" style="padding-top:0">保持这个页面开着才能响铃。手机锁屏后浏览器可能不响，营业时建议屏幕常亮或常看一眼。</p>
      </section>

      <section class="section">
        <div class="section-head"><h2>账号</h2><span class="small muted">${S.admin ? S.admin.username : ''}</span></div>
        <label class="field"><span class="label">原密码</span><input class="input" type="password" autocomplete="current-password" value="${pw.old}" data-model="pw.old"></label>
        <label class="field"><span class="label">新密码（至少 8 位）</span><input class="input" type="password" autocomplete="new-password" value="${pw.next}" data-model="pw.next"></label>
        <div class="pad btn-row"><button type="button" class="btn" data-act="changePw">修改密码</button><button type="button" class="btn danger" data-act="logout">退出登录</button></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>示例数据</h2></div>
        <p class="pad" style="padding-top:0">${S.demo ? (S.demo.products || S.demo.orders
          ? html`现在有示例商品 ${S.demo.products} 件、用示例商品下的订单 ${S.demo.orders} 笔。正式营业前删除，不影响你自己添加的商品和订单。`
          : '没有示例数据了。') : '正在统计…'}</p>
        ${S.demo && (S.demo.products || S.demo.orders) ? html`<div class="pad" style="padding-top:0"><button type="button" class="btn danger block" data-act="clearDemo">删除全部示例数据</button></div>` : ''}
      </section>
      <div style="height:12px"></div>
      ${tabbar('shop')}`;
  }

  // ---------- 渲染 ----------
  let lastKey = null;
  const scrollMemo = {};
  function render() {
    const r = parseRoute();
    const [a, b] = r.parts;
    let content;
    if (!S.token || a === 'login') content = pageLogin();
    else if (!a) content = pageHome();
    else if (a === 'orders') content = pageOrders();
    else if (a === 'o' && b) content = pageOrder(Number(b));
    else if (a === 'prep') content = pagePrep();
    else if (a === 'products' && b) content = pageEdit();
    else if (a === 'products') content = pageProducts();
    else if (a === 'shop') content = pageShop();
    else content = html`<div class="empty"><p class="big">页面不存在</p><p><a href="#/">回到概览</a></p></div>`;
    patch(root, content);
    const key = r.path;
    if (key !== lastKey) {
      const restore = ['/', '/orders', '/products', '/prep'].includes(key) ? scrollMemo[key] || 0 : 0;
      lastKey = key;
      window.scrollTo(0, restore);
    }
    updateTitle();
  }
  window.addEventListener('scroll', () => { if (lastKey) scrollMemo[lastKey] = window.scrollY; }, { passive: true });

  async function onRoute() {
    const r = parseRoute();
    const [a, b] = r.parts;
    if (!S.token) { if (a !== 'login') { go('/login'); return; } render(); return; }
    if (a === 'login') { go('/'); return; }
    if (a === 'orders') {
      // 先套用链接里的筛选条件，避免先显示一遍别的列表
      const st = r.query.get('status');
      const pay = r.query.get('pay') || '';
      if (pay !== S.orders.pay) { S.orders.pay = pay; S.orders.list = null; }
      if (st && st !== S.orders.status) { S.orders.status = st; S.orders.list = null; }
    }
    render();
    try {
      if (!a) { await Promise.all([loadOverview(), loadDemo()]); }
      else if (a === 'orders') {
        await loadOrders();
      } else if (a === 'o' && b) await loadOrder(Number(b));
      else if (a === 'prep') await loadPrep();
      else if (a === 'products' && b) {
        await loadCatalog();
        if (b === 'new') S.edit = newEdit(null);
        else {
          const p = S.catalog.products.find((x) => x.id === Number(b));
          S.edit = p ? newEdit(p) : null;
          if (!p) { toast('商品不存在或已删除', 'error'); go('/products'); return; }
        }
      } else if (a === 'products') await loadCatalog();
      else if (a === 'shop') { await Promise.all([loadShopForm(), loadDemo(), loadApps()]); }
    } catch (e) {
      if (e.status !== 401) toast(e.message, 'error');
    }
    render();
  }

  // ---------- 订单操作 ----------
  async function orderAction(id, action) {
    const order = findOrder(id);
    let body = {};
    if (action === 'reject' || action === 'cancel') {
      const reason = await promptDialog({
        title: action === 'reject' ? '拒绝这笔预订' : '取消这笔订单',
        message: `${order ? order.pickup_name + '，' : ''}客户会在「我的预订」里看到原因。${action === 'cancel' ? '\n取消后占用的库存会自动退回。' : ''}${order && ['claimed', 'paid'].includes(order.pay_status) ? `\n客户${order.pay_status === 'paid' ? '已付' : '说已付'} ${yuan(order.total_cents)}，${action === 'reject' ? '拒单' : '取消'}后请把钱退给客户。` : ''}`,
        presets: action === 'reject' ? ['商品缺货', '今天不营业', '取货时间来不及备货', '联系不上客户'] : ['客户要求取消', '商品缺货，已和客户沟通', '客户没来取货'],
        placeholder: '填写原因',
        ok: action === 'reject' ? '确认拒单' : '确认取消',
        danger: true,
      });
      if (reason === null) return;
      body.reason = reason;
    }
    if (action === 'complete') {
      const code = await askPickupCode(order);
      if (code === null) return;
      body.pickup_code = code;
    }
    await runAction(id, action, body);
  }

  async function askPickupCode(order, errorMsg = '') {
    const code = await promptDialog({
      title: '核对取货码',
      message: `${errorMsg ? errorMsg + '\n' : ''}请客户出示「我的预订」里的取货码，输入后确认已取货。${order ? `\n取货人：${order.pickup_name}` : ''}`,
      placeholder: '4 位数字',
      inputMode: 'numeric',
      maxLength: 6,
      ok: '确认已取货',
    });
    return code === null ? null : code.replace(/\s/g, '');
  }

  async function runAction(id, action, body) {
    S.busy[id] = true;
    render();
    try {
      const r = await api('POST', `/api/admin/orders/${id}/${action}`, body);
      S.orderDetail[id] = r.order;
      S.alerts = S.alerts.filter((a) => a.id !== id);
      updateTitle();
      const msg = { accept: '已接单，开始备货', ready: '已标记备货完成，客户会看到「待取货」', complete: '取货完成', reject: '已拒单', cancel: '订单已取消' }[action];
      toast(msg, 'ok');
      if (action === 'complete' && r.order.pay_status !== 'paid') setTimeout(() => askPaidAfterComplete(r.order), 300);
      // 核销结果里同步更新
      if (S.verify.results) S.verify.results = S.verify.results.map((o) => (o.id === id ? r.order : o)).filter((o) => ['pending', 'preparing', 'ready'].includes(o.status));
      refreshLists();
    } catch (e) {
      if (e.code === 'CODE_MISMATCH') {
        delete S.busy[id];
        const code = await askPickupCode(findOrder(id), '取货码不对，请再核对一次。');
        if (code !== null) return runAction(id, action, { pickup_code: code });
      } else {
        toast(e.message, 'error');
        refreshLists();
      }
    } finally {
      delete S.busy[id];
      render();
    }
  }

  function payText(o) {
    if (o.refund_due) return `待退款 ${yuan(o.total_cents)}`;
    if (o.pay_status === 'refunded') return `已退款${o.pay_note ? '（' + o.pay_note + '）' : ''}`;
    if (o.pay_status === 'paid') return `已收款 ${yuan(o.total_cents)}${o.pay_method_text ? '（' + o.pay_method_text + '）' : ''}`;
    if (o.pay_status === 'claimed') return `客户说已用${o.pay_method_text}付款，待核对`;
    if (o.status === 'completed') return '已取货，未在 APP 里记录收款';
    return `未付款，取货时收 ${yuan(o.total_cents)}`;
  }

  // 取货完成后问一句：钱收到了吗？
  async function askPaidAfterComplete(o) {
    if (o.pay_status === 'claimed') {
      const ok = await chooseDialog({
        title: '核对付款',
        message: `${o.pickup_name} 说已用${o.pay_method_text}付了 ${yuan(o.total_cents)}，收款记录里查到了吗？`,
        options: [{ label: '查到了，确认已收款', value: 'confirm', kind: 'go' }, { label: '稍后再核对', value: 'later' }],
        cancel: '关闭',
      });
      if (ok === 'confirm') await payAction(o.id, { action: 'confirm' }, '已确认收款');
      return;
    }
    const method = await chooseDialog({
      title: `收到 ${yuan(o.total_cents)} 了吗？`,
      message: `${o.pickup_name} 已取货。记一下这单的钱收没收到，方便以后对账。`,
      options: [
        { label: '当面收了（现金或扫码）', value: 'cash', kind: 'go' },
        { label: '微信收了', value: 'wechat' },
        { label: '支付宝收了', value: 'alipay' },
      ],
      cancel: '还没收，先不记',
    });
    if (method) await payAction(o.id, { action: 'mark_paid', method }, '已记为收款');
  }

  async function payAction(id, body, okMsg) {
    S.busy['pay' + id] = true;
    render();
    try {
      const r = await api('POST', `/api/admin/orders/${id}/payment`, body);
      S.orderDetail[id] = r.order;
      toast(okMsg, 'ok');
      refreshLists();
    } catch (e) {
      toast(e.message, 'error');
      refreshLists();
    }
    delete S.busy['pay' + id];
    render();
  }

  function findOrder(id) {
    return S.orderDetail[id]
      || (S.orders.list || []).find((o) => o.id === id)
      || (S.overview ? S.overview.pending.find((o) => o.id === id) : null)
      || (S.verify.results || []).find((o) => o.id === id)
      || null;
  }

  let refreshTimer = null;
  function refreshLists() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const [a, b] = parseRoute().parts;
      const jobs = [loadOverview().catch(() => {}), loadOrders()];
      if (a === 'o' && b) jobs.push(loadOrder(Number(b)));
      if (a === 'prep') jobs.push(loadPrep());
      await Promise.all(jobs);
      render();
    }, 150);
  }

  async function verifyCode() {
    const v = S.verify;
    v.code = v.code.replace(/\D/g, '');
    if (!/^\d{4,6}$/.test(v.code)) { v.error = '取货码是 4 位数字'; v.results = null; render(); return; }
    v.error = '';
    try {
      const r = await api('GET', `/api/admin/pickup/${v.code}`);
      v.results = r.orders;
      if (r.orders.length === 1 && r.orders[0].status === 'ready') toast(`找到了：${r.orders[0].pickup_name}，核对商品后点完成取货`, 'ok');
    } catch (e) {
      v.error = e.message;
    }
    render();
  }

  // ---------- 商品操作 ----------
  async function compressImage(file, max = 1000) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('这张图片打不开，换一张试试'));
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.max(1, Math.round(im.naturalWidth * scale));
      const h = Math.max(1, Math.round(im.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(im, 0, 0, w, h);
      return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('图片处理失败'))), 'image/jpeg', 0.85));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadImage(file, target) {
    const holder = target === 'product' ? S.edit : S.shopForm;
    if (!holder) return;
    holder.uploading = true;
    render();
    try {
      // 收款码图片保留更高分辨率，保证能扫出来
      const blob = await compressImage(file, target === 'wechat' || target === 'alipay' ? 1400 : 1000);
      const r = await api('POST', '/api/admin/uploads', blob);
      if (target === 'wechat' || target === 'alipay') holder['pay_' + target + '_qr'] = r.url;
      else holder.image = r.url;
      if (target !== 'product') holder.dirty = true;
      toast('图片已上传，记得点保存', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    holder.uploading = false;
    render();
  }

  function collectProduct() {
    const e = S.edit;
    const errors = {};
    if (!e.name.trim()) errors.name = '请填写商品名称';
    const names = new Set();
    const specs = e.specs.map((s, i) => {
      const name = s.name.trim();
      const price = parseYuan(s.price);
      const stockText = String(s.stock).trim();
      const stock = stockText === '' ? null : /^\d{1,6}$/.test(stockText) ? Number(stockText) : NaN;
      if (!name) errors['spec' + i] = '请填写规格名称';
      else if (names.has(name)) errors['spec' + i] = '规格名称重复了';
      else if (price === null) errors['spec' + i] = '价格请填数字，比如 3 或 3.50';
      else if (Number.isNaN(stock)) errors['spec' + i] = '库存请填整数，不限量就留空';
      names.add(name);
      return { id: s.id, name, price_cents: price, stock };
    });
    e.errors = errors;
    if (Object.keys(errors).length) return null;
    return {
      name: e.name.trim(),
      category_id: e.category_id ? Number(e.category_id) : null,
      description: e.description.trim(),
      image: e.image,
      status: e.status,
      specs,
    };
  }

  async function saveProduct() {
    const e = S.edit;
    if (e.saving) return;
    const body = collectProduct();
    if (!body) { e.error = '有内容没填对，请看标红的地方'; render(); return; }
    e.saving = true; e.error = ''; render();
    try {
      if (e.id) await api('PUT', `/api/admin/products/${e.id}`, body);
      else await api('POST', '/api/admin/products', body);
      toast(e.id ? '已保存' : '已添加，客户那边马上能看到', 'ok');
      e.saving = false;
      go('/products');
      return;
    } catch (err) {
      e.error = err.message;
    }
    e.saving = false;
    render();
  }

  async function manageCategories() {
    await modal((box, close) => {
      const draw = () => {
        const cats = S.catalog.categories;
        box.innerHTML = html`
          <h3>管理分类</h3>
          <p class="modal-msg">客户端按这里的顺序显示分类。</p>
          <div>${cats.map((c, i) => html`<div class="cat-row">
            <span class="cr-name">${c.name}</span>
            <button type="button" class="icon-btn" data-c="up" data-id="${c.id}" ${i === 0 ? raw('disabled') : ''} aria-label="上移">↑</button>
            <button type="button" class="icon-btn" data-c="down" data-id="${c.id}" ${i === cats.length - 1 ? raw('disabled') : ''} aria-label="下移">↓</button>
            <button type="button" class="btn sm" data-c="rename" data-id="${c.id}">改名</button>
            <button type="button" class="btn sm danger" data-c="del" data-id="${c.id}">删除</button>
          </div>`)}</div>
          <div class="modal-actions"><button type="button" class="btn" data-c="add">＋ 新建分类</button><button type="button" class="btn primary" data-c="close">完成</button></div>`.s;
      };
      draw();
      box.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-c]');
        if (!b) return;
        const id = Number(b.dataset.id);
        const cmd = b.dataset.c;
        if (cmd === 'close') return close(true);
        try {
          let r;
          if (cmd === 'add') {
            const name = await promptDialog({ title: '新建分类', placeholder: '比如：饮料', maxLength: 12, ok: '添加' });
            if (!name) return;
            r = await api('POST', '/api/admin/categories', { name });
          } else if (cmd === 'rename') {
            const cur = S.catalog.categories.find((c) => c.id === id);
            const name = await promptDialog({ title: '分类改名', value: cur ? cur.name : '', maxLength: 12, ok: '保存' });
            if (!name) return;
            r = await api('PUT', `/api/admin/categories/${id}`, { name });
          } else if (cmd === 'del') {
            if (!(await confirmDialog({ title: '删除这个分类？', message: '分类里有商品时不能删除。', ok: '删除', danger: true }))) return;
            r = await api('DELETE', `/api/admin/categories/${id}`);
          } else {
            r = await api('POST', `/api/admin/categories/${id}/move`, { direction: cmd });
          }
          S.catalog.categories = r.categories;
          draw();
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });
    await loadCatalog();
    render();
  }

  // ---------- 店铺操作 ----------
  async function toggleAccept(el) {
    const next = !S.shop.accepting_orders;
    let pause_message;
    if (!next) {
      const msg = await promptDialog({
        title: '暂停接单？',
        message: '暂停后客户还能看商品，但不能提交新预订。已经收到的订单不受影响。',
        presets: ['今天休息', '正在进货，稍后恢复', '今天的货卖完了'],
        placeholder: '给客户的说明（可不填）',
        value: S.shop.pause_message || '',
        required: false,
        ok: '暂停接单',
        danger: true,
      });
      if (msg === null) { if (el && el.type === 'checkbox') el.checked = true; render(); return; }
      pause_message = msg;
    }
    try {
      const r = await api('POST', '/api/admin/shop/accepting', { accepting: next, pause_message });
      S.shop = { ...S.shop, ...r.shop };
      if (S.overview) S.overview.shop = S.shop;
      if (S.shopForm && pause_message !== undefined) S.shopForm.pause_message = pause_message;
      toast(next ? '已恢复接单' : '已暂停接单', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    render();
  }

  async function saveShop() {
    const f = S.shopForm;
    if (f.saving) return;
    const lead = Number(f.lead_minutes);
    if (!f.name.trim()) { f.error = '请填写店名'; render(); return; }
    if (!Number.isInteger(lead) || lead < 0) { f.error = '提前预订时间请填整数分钟'; render(); return; }
    for (const s of f.slots) {
      if (!s.start || !s.end) { f.error = '取货时段的开始和结束时间都要填'; render(); return; }
      if (s.start >= s.end) { f.error = `时段 ${s.start}-${s.end} 的结束时间要晚于开始时间`; render(); return; }
    }
    f.saving = true; f.error = ''; render();
    try {
      const r = await api('PUT', '/api/admin/shop', {
        name: f.name, image: f.image, phone: f.phone, address: f.address, business_hours: f.business_hours, notice: f.notice,
        pause_message: f.pause_message, lead_minutes: lead, days_ahead: Number(f.days_ahead), pickup_slots: f.slots,
        pay_wechat_qr: f.pay_wechat_qr, pay_alipay_qr: f.pay_alipay_qr, pay_note: f.pay_note,
      });
      S.shop = { ...S.shop, ...r.shop };
      f.slots = r.shop.pickup_slots.map((x) => ({ start: x.start, end: x.end }));
      f.dirty = false;
      toast('店铺设置已保存', 'ok');
    } catch (e) {
      f.error = e.message;
    }
    f.saving = false;
    render();
  }

  // ---------- 交互 ----------
  const actions = {
    back(el) { if (navCount > 0) history.back(); else go(el.dataset.to || '/'); },
    doLogin() { doLogin(); },
    toggleAccept(el) { toggleAccept(el); },
    viewAlerts() {
      const ids = S.alerts.map((a) => a.id);
      clearAlerts();
      if (ids.length === 1) go(`/o/${ids[0]}`);
      else { S.orders.status = 'pending'; S.orders.q = ''; go('/orders?status=pending'); onRouteIfSame('/orders'); }
    },
    dismissAlerts() { clearAlerts(); render(); },
    openOrder(el) { go(`/o/${el.dataset.id}`); },
    accept(el) { runAction(Number(el.dataset.id), 'accept', {}); },
    async payConfirm(el) {
      const id = Number(el.dataset.id);
      const o = findOrder(id);
      const ok = await confirmDialog({ title: '确认已收款？', message: o ? `在${o.pay_method_text}收款记录里查到了 ${yuan(o.total_cents)}（备注取货码 ${o.pickup_code}）。` : '', ok: '确认已收款' });
      if (ok) payAction(id, { action: 'confirm' }, '已确认收款，客户会看到');
    },
    async payReject(el) {
      const id = Number(el.dataset.id);
      const note = await promptDialog({
        title: '没收到这笔钱',
        message: '客户会看到你的说明，可以重新付款或者到店付。',
        presets: ['收款记录里没查到', '金额不对', '到店再付吧'],
        placeholder: '写给客户的说明',
        ok: '告诉客户',
      });
      if (note !== null) payAction(id, { action: 'reject', note }, '已告诉客户没收到');
    },
    async payMark(el) {
      const id = Number(el.dataset.id);
      const o = findOrder(id);
      const method = await chooseDialog({
        title: `收到 ${o ? yuan(o.total_cents) : ''} 了吗？`,
        message: '用哪种方式收的？',
        options: [{ label: '当面收的（现金或扫码）', value: 'cash', kind: 'go' }, { label: '微信', value: 'wechat' }, { label: '支付宝', value: 'alipay' }],
      });
      if (method) payAction(id, { action: 'mark_paid', method }, '已记为收款');
    },
    async payRefund(el) {
      const id = Number(el.dataset.id);
      const note = await promptDialog({
        title: '已经把钱退给客户了？',
        message: '先在微信或支付宝里把钱转回给客户，再在这里记一下。',
        presets: ['已微信转回', '已支付宝转回', '已当面退现金'],
        placeholder: '退款说明（可不填）',
        required: false,
        ok: '已退款',
      });
      if (note !== null) payAction(id, { action: 'refund', note }, '已记为退款');
    },
    ready(el) { runAction(Number(el.dataset.id), 'ready', {}); },
    complete(el) { orderAction(Number(el.dataset.id), 'complete'); },
    reject(el) { orderAction(Number(el.dataset.id), 'reject'); },
    cancel(el) { orderAction(Number(el.dataset.id), 'cancel'); },
    verify() { verifyCode(); },
    otab(el) {
      S.orders.status = el.dataset.id;
      S.orders.pay = '';
      S.orders.list = null;
      history.replaceState(null, '', `#/orders?status=${el.dataset.id}`);
      render();
      loadOrders().then(render);
    },
    reloadOrders() { loadOrders().then(render); },
    reloadPrep() { loadPrep().then(render); },
    prepDate(el) { S.prep.date = el.dataset.id; S.prep.slot = ''; S.prep.data = null; render(); loadPrep().then(render); },
    prepSlot(el) { S.prep.slot = el.dataset.id; render(); loadPrep().then(render); },
    prepView(el) { S.prep.view = el.dataset.id; render(); },
    pcat(el) { S.catFilter = el.dataset.id; render(); },
    async pstatus(el) {
      try {
        await api('POST', `/api/admin/products/${el.dataset.id}/status`, { status: el.dataset.s });
        await loadCatalog();
        toast({ on: '已恢复销售', sold_out: '已设为售罄', off: '已下架' }[el.dataset.s], 'ok');
      } catch (e) { toast(e.message, 'error'); }
      render();
    },
    async pmove(el) {
      try { S.catalog = await api('POST', `/api/admin/products/${el.dataset.id}/move`, { direction: el.dataset.d }); } catch (e) { toast(e.message, 'error'); }
      render();
    },
    manageCats() { manageCategories(); },
    addSpec() { S.edit.specs.push({ id: null, name: '', price: '', stock: '' }); render(); },
    delSpec(el) { S.edit.specs.splice(Number(el.dataset.id), 1); S.edit.errors = {}; render(); },
    estatus(el) { S.edit.status = el.dataset.id; render(); },
    removeImage() { S.edit.image = ''; render(); },
    saveProduct() { saveProduct(); },
    async deleteProduct() {
      const e = S.edit;
      if (!(await confirmDialog({ title: `删除「${e.name}」？`, message: '删除后客户看不到这件商品。已经提交的订单不受影响。\n只是暂时不卖的话，用「下架」就行。', ok: '删除', danger: true }))) return;
      try { await api('DELETE', `/api/admin/products/${e.id}`); toast('已删除', 'ok'); go('/products'); } catch (err) { toast(err.message, 'error'); }
    },
    addSlot() {
      const last = S.shopForm.slots[S.shopForm.slots.length - 1];
      S.shopForm.slots.push(last ? { start: last.end, end: last.end < '23:00' ? String(Number(last.end.slice(0, 2)) + 1).padStart(2, '0') + last.end.slice(2) : '23:59' } : { start: '10:00', end: '12:00' });
      render();
    },
    delSlot(el) { S.shopForm.slots.splice(Number(el.dataset.id), 1); render(); },
    removeShopImage() { S.shopForm.image = ''; render(); },
    removeQr(el) { S.shopForm['pay_' + el.dataset.id + '_qr'] = ''; S.shopForm.dirty = true; render(); },
    saveShop() { saveShop(); },
    async copyLink(el) {
      const url = location.origin + (el.dataset.path || '/');
      try { await navigator.clipboard.writeText(url); toast('链接已复制', 'ok'); }
      catch (_) { promptDialog({ title: '链接', message: '长按复制下面的链接', value: url, required: false, ok: '好了' }); }
    },
    async delApk(el) {
      const which = el.dataset.id;
      if (!(await confirmDialog({ title: '删除这个安装包？', message: '删除后下载页不再提供这个安卓 APP，已经装好的不受影响。', ok: '删除', danger: true }))) return;
      try { S.apps = (await api('DELETE', `/api/admin/apps/${which}`)).apps; toast('已删除', 'ok'); } catch (e) { toast(e.message, 'error'); }
      render();
    },
    toggleSound() { S.sound = !S.sound; store.set('snack.sound', S.sound); if (S.sound) { unlockAudio(); ding(); } render(); },
    testSound() { unlockAudio(); const was = S.sound; S.sound = true; ding(); S.sound = was; },
    async askNotify() { try { await Notification.requestPermission(); } catch (_) { /* ignore */ } render(); },
    async changePw() {
      const pw = S.pwForm;
      if (pw.next.length < 8) { toast('新密码至少 8 位', 'error'); return; }
      try { await api('POST', '/api/admin/password', { old_password: pw.old, new_password: pw.next }); S.pwForm = { old: '', next: '' }; toast('密码已修改', 'ok'); } catch (e) { toast(e.message, 'error'); }
      render();
    },
    async logout() {
      if (!(await confirmDialog({ title: '退出登录？', message: '退出后这台手机收不到新订单提醒。', ok: '退出' }))) return;
      try { await api('POST', '/api/admin/logout'); } catch (_) { /* ignore */ }
      logoutLocal();
      render();
    },
    async clearDemo() {
      if (!(await confirmDialog({ title: '删除全部示例数据？', message: '会删除示例商品、示例分类，以及用示例商品下的订单。你自己添加的商品和订单不受影响。删除后不能恢复。', ok: '删除', danger: true }))) return;
      try {
        const r = await api('POST', '/api/admin/demo/clear');
        toast(`已删除示例商品 ${r.products} 件、订单 ${r.orders} 笔`, 'ok');
        await loadDemo();
      } catch (e) { toast(e.message, 'error'); }
      render();
    },
  };

  function onRouteIfSame(path) { if (parseRoute().path === path) onRoute(); }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    if (e.target.closest('[data-stop]') && el.dataset.act === 'openOrder') return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.type !== 'checkbox') e.preventDefault();
    fn(el, e);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el.dataset && el.dataset.enter && actions[el.dataset.enter]) { e.preventDefault(); actions[el.dataset.enter](el); }
  });

  let searchTimer = null;
  function onModel(e) {
    const el = e.target;
    const path = el.dataset && el.dataset.model;
    if (!path) return;
    const v = el.value;
    const parts = path.split('.');
    if (parts[0] === 'login') S.login[parts[1]] = v;
    else if (parts[0] === 'verify') S.verify.code = v;
    else if (parts[0] === 'orders') {
      S.orders.q = v;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadOrders().then(render), 300);
    } else if (parts[0] === 'prep') {
      if (e.type === 'change' && v) { S.prep.date = v; S.prep.slot = ''; S.prep.data = null; render(); loadPrep().then(render); }
    } else if (parts[0] === 'edit') { S.edit[parts[1]] = v; if (S.edit.errors[parts[1]]) { delete S.edit.errors[parts[1]]; render(); } if (parts[1] === 'category_id') render(); }
    else if (parts[0] === 'spec') { S.edit.specs[Number(parts[1])][parts[2]] = v; if (parts[2] === 'price') render(); }
    else if (parts[0] === 'shop') { S.shopForm[parts[1]] = v; S.shopForm.dirty = true; }
    else if (parts[0] === 'slot') { S.shopForm.slots[Number(parts[1])][parts[2]] = v; S.shopForm.dirty = true; }
    else if (parts[0] === 'pw') S.pwForm[parts[1]] = v;
  }
  document.addEventListener('input', onModel);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.apk && el.files && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      uploadApk(file, el.dataset.apk);
      return;
    }
    if (el.dataset && el.dataset.upload && el.files && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      uploadImage(file, el.dataset.upload);
      return;
    }
    if (el.tagName === 'SELECT' || el.type === 'date' || el.type === 'time') onModel(e);
  });

  let navCount = 0;
  window.addEventListener('hashchange', () => { navCount++; onRoute(); });

  // ---------- 实时推送 ----------
  let events = null;
  let offlineTimer = null;
  function setOnline(ok) {
    clearTimeout(offlineTimer);
    if (ok) { if (!S.online) { S.online = true; render(); } return; }
    offlineTimer = setTimeout(() => { S.online = false; render(); }, 4000);
  }
  function startEvents() {
    if (events) events.stop();
    events = connectEvents(() => (S.token ? `/api/admin/events?token=${encodeURIComponent(S.token)}` : null), {
      onStatus: setOnline,
      onEvent(name, data) {
        if (name === 'order.created') { alertNewOrder(data); refreshLists(); render(); return; }
        if (name === 'order.updated' && data.pay_claimed) {
          const text = `${data.pickup_name} 说已用${data.pay_method_text}付了 ${yuan(data.total_cents)}，请核对`;
          ding();
          toast(text, 'ok');
          if (window.SnackApp && window.SnackApp.showNotice) { try { window.SnackApp.showNotice('客户付款待核对', text, true); } catch (_) { /* ignore */ } }
        }
        if (name === 'order.updated' || name === 'reconnected') {
          if (data && data.id) delete S.orderDetail[data.id];
          refreshLists();
          if (name === 'order.updated' && data.status === 'cancelled' && data.kind !== 'pay') toast(`订单 ${data.order_no} 已取消`, 'error');
          return;
        }
        if (name === 'catalog.changed' && parseRoute().parts[0] === 'products' && !parseRoute().parts[1]) loadCatalog().then(render).catch(() => {});
        if (name === 'shop.changed') loadOverview().then(render).catch(() => {});
      },
    });
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token) refreshLists(); });
  window.addEventListener('online', () => { if (S.token) refreshLists(); });
  // 兜底：每 30 秒刷新一次订单数量，防止推送断开时漏掉新订单
  let lastPending = null;
  setInterval(async () => {
    if (!S.token) return;
    try {
      await loadOverview();
      const p = S.overview.counts.pending;
      if (lastPending !== null && p > lastPending && !S.online) { ding(); toast('有新的待确认预订', 'ok'); }
      lastPending = p;
      render();
    } catch (_) { /* ignore */ }
  }, 30_000);

  // ---------- 启动 ----------
  async function boot() {
    if (S.token) {
      try {
        const r = await api('GET', '/api/admin/me');
        S.admin = r.admin;
        await afterLogin();
      } catch (e) {
        if (e.status !== 401) toast(e.message, 'error');
      }
    }
    await onRoute();
  }

  Lib.registerSW();
  boot();
})();
