// 客户端：店铺首页、商品详情、购物车、预订确认、我的预订、订单详情
(function () {
  'use strict';
  const {
    html, raw, patch, yuan, fmtTime, fmtDay, request, uuid, toast, confirmDialog, promptDialog,
    connectEvents, store, parseRoute, go, statusPill, isPhone, telHref,
  } = Lib;

  const root = document.getElementById('app');

  const S = {
    token: store.get('snack.token'),
    customer: null,
    shop: null,
    catalog: null,
    specIndex: new Map(),
    cart: sanitizeCart(store.get('snack.cart', [])),
    orders: null,
    orderDetail: {},
    orderError: {},
    search: '',
    cat: 'all',
    payTab: 'wechat',
    detail: { productId: null, specId: null, qty: 1 },
    co: { name: '', contact: '', date: '', slot: '', note: '', requestId: null, quote: null, quoteError: '', submitting: false, notice: null, errors: {} },
    online: true,
    loadError: '',
    booted: false,
  };

  function sanitizeCart(c) {
    return Array.isArray(c) ? c.filter((x) => x && Number.isInteger(x.spec_id) && Number.isInteger(x.qty) && x.qty > 0) : [];
  }

  const api = (method, url, body) => request(method, url, body, { token: S.token });
  // 已经在安卓 APP 里，或者已经添加到主屏幕打开的，就不再提示下载
  const IN_WECHAT = /MicroMessenger/i.test(navigator.userAgent);
  // 商家有没有上传收款码
  const payQrs = () => {
    const p = (S.shop && S.shop.pay) || {};
    return [p.wechat_qr ? { key: 'wechat', label: '微信', img: p.wechat_qr } : null, p.alipay_qr ? { key: 'alipay', label: '支付宝', img: p.alipay_qr } : null].filter(Boolean);
  };
  const IN_APP = /SnackPreorderApp\//.test(navigator.userAgent)
    || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // ---------- 图标 ----------
  const ICON = {
    shop: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5c0 1.4 1.2 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8h13v-8"/><path d="M10 20v-4.5h4V20"/></svg>'),
    cart: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M3 4h2.2l2.2 11h10.4l2-8H6.3"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>'),
    list: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>'),
    search: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>'),
    pin: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'),
    phone: raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h3.5l1.5 4-2 1.5a10 10 0 0 0 6.5 6.5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>'),
  };

  // ---------- 数据加载 ----------
  async function ensureSession() {
    if (S.token) {
      try {
        const r = await api('GET', '/api/customer/me');
        S.customer = r.customer;
        return;
      } catch (e) {
        if (e.status !== 401) throw e;
      }
    }
    const r = await request('POST', '/api/customer/session');
    S.token = r.token;
    store.set('snack.token', r.token);
    S.customer = r.customer;
    S.orders = [];
  }

  async function loadShop() {
    const r = await request('GET', '/api/shop');
    S.shop = r.shop;
    Lib.setTimeZone(r.time_zone);
  }

  async function loadCatalog() {
    const r = await request('GET', '/api/catalog');
    S.catalog = r;
    S.specIndex = new Map();
    for (const p of r.products) for (const s of p.specs) S.specIndex.set(s.id, { product: p, spec: s });
    // 用最新的商品名称更新购物车里的显示信息
    for (const line of S.cart) {
      const ent = S.specIndex.get(line.spec_id);
      if (ent) { line.name = ent.product.name; line.spec_name = ent.spec.name; line.image = ent.product.image; }
    }
    saveCart();
  }

  async function loadOrders() {
    const r = await api('GET', '/api/orders');
    S.orders = r.orders;
  }

  async function loadOrder(id) {
    try {
      const r = await api('GET', `/api/orders/${id}`);
      S.orderDetail[id] = r.order;
      delete S.orderError[id];
    } catch (e) {
      S.orderError[id] = e.message;
    }
  }

  const today = () => (S.shop ? S.shop.pickup.today : Lib.todayInShop());

  // ---------- 购物车 ----------
  function saveCart() { store.set('snack.cart', S.cart); }
  const cartQty = (specId) => { const l = S.cart.find((x) => x.spec_id === specId); return l ? l.qty : 0; };
  const cartCount = () => S.cart.reduce((s, x) => s + x.qty, 0);

  function lineInfo(line) {
    const ent = S.specIndex.get(line.spec_id);
    if (!ent) return { ok: false, problem: '已下架', price: 0 };
    const { product, spec } = ent;
    if (product.status !== 'on' || spec.stock === 0) return { ok: false, problem: '已售罄', price: spec.price_cents, ent };
    if (spec.stock !== null && spec.stock < line.qty) return { ok: false, problem: `库存只剩 ${spec.stock} 件`, price: spec.price_cents, ent, max: spec.stock };
    return { ok: true, price: spec.price_cents, ent };
  }
  function cartTotal() {
    return S.cart.reduce((s, l) => { const i = lineInfo(l); return i.ok ? s + i.price * l.qty : s; }, 0);
  }

  function setQty(specId, qty, { silent = false } = {}) {
    const ent = S.specIndex.get(specId);
    let line = S.cart.find((x) => x.spec_id === specId);
    if (qty <= 0) {
      S.cart = S.cart.filter((x) => x.spec_id !== specId);
    } else {
      if (ent && ent.spec.stock !== null && qty > ent.spec.stock) {
        qty = ent.spec.stock;
        if (!silent) toast(ent.spec.stock === 0 ? '已经卖完了' : `库存只剩 ${ent.spec.stock} 件`, 'error');
      }
      if (qty > 99) { qty = 99; if (!silent) toast('单件商品最多订 99 件', 'error'); }
      if (qty <= 0) S.cart = S.cart.filter((x) => x.spec_id !== specId);
      else if (line) line.qty = qty;
      else if (ent) S.cart.push({ spec_id: specId, qty, name: ent.product.name, spec_name: ent.spec.name, image: ent.product.image });
    }
    saveCart();
    S.co.requestId = null; // 购物车变了，下次确认时生成新的提交编号
  }

  // ---------- 公共片段 ----------
  function img(src, alt, cls = 'thumb') {
    if (!src) return html`<div class="${cls} empty-img" aria-hidden="true">${(alt || '').slice(0, 1)}</div>`;
    return html`<img class="${cls}" src="${src}" alt="${alt || ''}" loading="lazy">`;
  }

  function tabbar(active) {
    const activeOrders = (S.orders || []).filter((o) => ['pending', 'preparing', 'ready'].includes(o.status)).length;
    const n = cartCount();
    return html`<nav class="tabbar" aria-label="主导航">
      <a href="#/" class="${active === 'home' ? 'on' : ''}">${ICON.shop}<span>店铺</span></a>
      <a href="#/cart" class="${active === 'cart' ? 'on' : ''}">${ICON.cart}<span>购物车</span>${n ? html`<span class="badge">${n}</span>` : ''}</a>
      <a href="#/orders" class="${active === 'orders' ? 'on' : ''}">${ICON.list}<span>我的预订</span>${activeOrders ? html`<span class="badge">${activeOrders}</span>` : ''}</a>
    </nav>`;
  }

  function topbar(title, back = '/') {
    return html`<header class="topbar"><button class="back" type="button" data-act="back" data-to="${back}" aria-label="返回">‹</button><h1>${title}</h1></header>`;
  }

  const offlineBar = () => (S.online ? '' : html`<div class="offline-bar">网络连接中断，正在重新连接…</div>`);

  function pausedBanner() {
    if (!S.shop || S.shop.accepting_orders) return '';
    return html`<div class="banner stop"><strong>店铺暂停接单</strong>，现在可以看商品，但暂时不能提交预订。${S.shop.pause_message ? html`<br>${S.shop.pause_message}` : ''}</div>`;
  }

  function priceText(p) {
    if (p.min_price_cents === p.max_price_cents) return html`${yuan(p.min_price_cents)}`;
    return html`${yuan(p.min_price_cents)}<small>起</small>`;
  }

  // ---------- 页面：店铺首页 + 商品浏览 ----------
  function pageHome() {
    const shop = S.shop;
    const cat = S.catalog;
    const kw = S.search.trim().toLowerCase();
    let products = cat.products;
    if (kw) {
      products = products.filter((p) => (p.name + ' ' + p.description + ' ' + p.specs.map((s) => s.name).join(' ')).toLowerCase().includes(kw));
    } else if (S.cat !== 'all') {
      products = products.filter((p) => String(p.category_id) === S.cat);
    }
    let body;
    if (!cat.products.length) {
      body = html`<div class="empty"><p class="big">店里还没有上架商品</p><p>过一会儿再来看看。</p></div>`;
    } else if (!products.length) {
      body = html`<div class="empty"><p class="big">没有找到「${S.search}」</p><p>换个词试试，比如“可乐”“薯片”。</p></div>`;
    } else if (kw || S.cat !== 'all') {
      body = html`<div class="plist">${products.map(productRow)}</div>`;
    } else {
      const groups = [];
      for (const c of cat.categories) {
        const list = products.filter((p) => p.category_id === c.id);
        if (list.length) groups.push({ name: c.name, list });
      }
      const known = new Set(cat.categories.map((c) => c.id));
      const other = products.filter((p) => !known.has(p.category_id));
      if (other.length) groups.push({ name: '其他', list: other });
      body = groups.map((g) => html`<h2 class="cat-title">${g.name}</h2><div class="plist">${g.list.map(productRow)}</div>`);
    }

    const n = cartCount();
    return html`
      ${offlineBar()}
      <header class="shop-head">
        <div class="shop-id">
          ${shop.image ? html`<img class="shop-logo" src="${shop.image}" alt="">` : ''}
          <div class="grow">
            <h1 class="shop-name">${shop.name}</h1>
            ${shop.business_hours ? html`<p class="shop-hours">营业 ${shop.business_hours}</p>` : ''}
          </div>
        </div>
        ${shop.address || shop.phone ? html`<div class="shop-meta">
          ${shop.address ? html`<div class="row">${ICON.pin}<span>${shop.address}</span></div>` : ''}
          ${shop.phone ? html`<div class="row">${ICON.phone}<a href="${telHref(shop.phone)}">${shop.phone}</a></div>` : ''}
        </div>` : ''}
        <div class="how" aria-label="怎么买">
          <div>提前预订<small>在这里选好下单</small></div>
          <div>到店取货<small>按约定时间来拿</small></div>
          <div>线下付款<small>${payQrs().length ? '当面付或扫码付' : '取货时当面付'}</small></div>
        </div>
        ${shop.notice ? html`<p class="notice"><b>公告</b>${shop.notice}</p>` : ''}
      </header>
      ${pausedBanner()}
      <div class="browse-bar">
        <label class="search">${ICON.search}<input class="input" type="search" placeholder="搜零食，比如 可乐" value="${S.search}" data-model="search" aria-label="搜索商品"></label>
        ${!kw && cat.categories.length ? html`<div class="chips" role="tablist">
          <button type="button" class="chip ${S.cat === 'all' ? 'on' : ''}" data-act="cat" data-id="all">全部</button>
          ${cat.categories.filter((c) => cat.products.some((p) => p.category_id === c.id)).map((c) => html`<button type="button" class="chip ${S.cat === String(c.id) ? 'on' : ''}" data-act="cat" data-id="${c.id}">${c.name}</button>`)}
        </div>` : ''}
      </div>
      ${body}
      ${!IN_APP ? html`<p class="install-tip"><a href="/download">把店铺装到手机桌面</a>，下次点图标就能打开</p>` : ''}
      ${n ? html`<div class="cartbar">
        <div class="cb-total"><span class="num">${yuan(cartTotal())}</span><div class="cb-count">已选 ${n} 件 · 到店付款</div></div>
        <a class="btn primary" href="#/cart">去下单</a>
      </div>` : ''}
      ${tabbar('home')}`;
  }

  function productRow(p) {
    const single = p.specs.length === 1 ? p.specs[0] : null;
    const out = !p.orderable;
    const inCart = p.specs.reduce((s, sp) => s + cartQty(sp.id), 0);
    let action;
    if (out) action = html`<span class="soldout-tag">${p.status === 'sold_out' ? '售罄' : '已售罄'}</span>`;
    else if (single) {
      const q = cartQty(single.id);
      action = q
        ? html`<div class="stepper" data-stop>
            <button type="button" data-act="dec" data-id="${single.id}" aria-label="减少">−</button>
            <span class="qty">${q}</span>
            <button type="button" data-act="inc" data-id="${single.id}" aria-label="增加" ${single.stock !== null && q >= single.stock ? raw('disabled') : ''}>+</button>
          </div>`
        : html`<button type="button" class="add-btn" data-act="inc" data-id="${single.id}" aria-label="加入购物车">+</button>`;
    } else {
      action = html`<button type="button" class="spec-btn" data-act="open" data-id="${p.id}">选规格${inCart ? html`<span class="badge">${inCart}</span>` : ''}</button>`;
    }
    const stockNote = single && single.stock !== null && single.stock > 0 && !out ? html`<span class="p-stock">库存 ${single.stock}</span>` : '';
    return html`<article class="prod ${out ? 'out' : ''}" data-act="open" data-id="${p.id}" data-key="p${p.id}">
      ${img(p.image, p.name)}
      <div class="p-body">
        <h3 class="p-name">${p.name}</h3>
        ${p.description ? html`<p class="p-desc">${p.description}</p>` : ''}
        <p class="p-specs">${p.specs.map((s) => s.name).join(' / ')}</p>
        <div class="p-foot">
          <div><span class="price p-price">${priceText(p)}</span> ${stockNote}</div>
          ${action}
        </div>
      </div>
    </article>`;
  }

  // ---------- 页面：商品详情 ----------
  function pageProduct(id) {
    const p = S.catalog.products.find((x) => x.id === id);
    if (!p) {
      return html`${topbar('商品详情')}<div class="empty"><p class="big">这件商品已下架</p><p><a href="#/">回到店铺</a></p></div>`;
    }
    const d = S.detail;
    let spec = p.specs.find((s) => s.id === d.specId);
    if (!spec) spec = p.specs.find((s) => s.stock === null || s.stock > 0) || p.specs[0];
    d.specId = spec.id;
    const inCart = cartQty(spec.id);
    const specOut = p.status !== 'on' || spec.stock === 0;
    const maxAdd = spec.stock === null ? 99 - inCart : Math.min(99, spec.stock) - inCart;
    if (d.qty > Math.max(1, maxAdd)) d.qty = Math.max(1, maxAdd);
    const canAdd = !specOut && maxAdd >= 1 && S.shop;
    let hint = '';
    if (p.status === 'sold_out') hint = '这件商品暂时售罄';
    else if (spec.stock === 0) hint = '这个规格已售罄，换一个规格看看';
    else if (maxAdd < 1) hint = `库存 ${spec.stock} 件已经全在你的购物车里了`;

    return html`
      ${topbar(p.name)}
      ${offlineBar()}
      ${img(p.image, p.name, 'pd-img')}
      <div class="pd-info">
        <h2 class="pd-name">${p.name}</h2>
        ${p.description ? html`<p class="pd-desc">${p.description}</p>` : ''}
        <p class="price pd-price">${yuan(spec.price_cents)}</p>
      </div>
      ${pausedBanner()}
      <section class="section">
        <div class="section-head"><h2>规格</h2></div>
        <div class="pad opt-grid">
          ${p.specs.map((s) => {
            const out = p.status !== 'on' || s.stock === 0;
            return html`<button type="button" class="opt ${s.id === spec.id ? 'on' : ''}" data-act="spec" data-id="${s.id}">
              <span class="opt-main">${s.name}</span>
              <span><span class="opt-price">${yuan(s.price_cents)}</span> <span class="opt-sub">${out ? '售罄' : s.stock === null ? '' : `库存 ${s.stock}`}</span></span>
            </button>`;
          })}
        </div>
        <div class="pad row between">
          <span class="strong">数量</span>
          <div class="stepper">
            <button type="button" data-act="dqty" data-d="-1" ${d.qty <= 1 || !canAdd ? raw('disabled') : ''} aria-label="减少">−</button>
            <span class="qty">${canAdd ? d.qty : 0}</span>
            <button type="button" data-act="dqty" data-d="1" ${!canAdd || d.qty >= maxAdd ? raw('disabled') : ''} aria-label="增加">+</button>
          </div>
        </div>
        ${inCart ? html`<p class="pad small muted" style="padding-top:0">购物车里已有 ${inCart} 件</p>` : ''}
        ${hint ? html`<p class="pad small" style="padding-top:0;color:var(--red)">${hint}</p>` : ''}
      </section>
      <div class="actionbar">
        <div class="ab-total"><span class="price">${yuan(spec.price_cents * (canAdd ? d.qty : 0))}</span><span class="small faint">到店付款</span></div>
        <button type="button" class="btn primary lg" data-act="addDetail" ${canAdd ? '' : raw('disabled')}>加入购物车</button>
      </div>`;
  }

  // ---------- 页面：购物车 ----------
  function pageCart() {
    if (!S.cart.length) {
      return html`<header class="topbar"><h1>购物车</h1></header>
        <div class="empty"><p class="big">购物车是空的</p><p style="margin-bottom:16px">先去店里挑几样零食吧。</p><a class="btn primary" href="#/">去挑零食</a></div>
        ${tabbar('cart')}`;
    }
    const infos = S.cart.map((l) => ({ line: l, info: lineInfo(l) }));
    const bad = infos.filter((x) => !x.info.ok);
    return html`
      <header class="topbar"><h1>购物车</h1><button type="button" class="link-btn" data-act="clearCart">清空</button></header>
      ${offlineBar()}
      ${pausedBanner()}
      ${bad.length ? html`<div class="banner warn">有 ${bad.length} 件商品现在订不了（标红的），请删除或减少数量后再下单。</div>` : ''}
      <section class="section">
        ${infos.map(({ line, info }) => html`<div class="cline ${info.ok ? '' : 'bad'}" data-key="c${line.spec_id}">
          ${img(line.image, line.name, 'thumb sm')}
          <div class="c-body">
            <div class="row between" style="align-items:flex-start">
              <div class="grow"><div class="c-name">${line.name}</div><div class="c-spec">${line.spec_name}${info.price ? html` · <span class="num">${yuan(info.price)}</span>` : ''}</div></div>
              <button type="button" class="c-del" data-act="remove" data-id="${line.spec_id}">删除</button>
            </div>
            ${info.problem ? html`<div class="c-problem">${info.problem}</div>` : ''}
            <div class="c-row">
              <div class="stepper">
                <button type="button" data-act="dec" data-id="${line.spec_id}" aria-label="减少">−</button>
                <span class="qty">${line.qty}</span>
                <button type="button" data-act="inc" data-id="${line.spec_id}" aria-label="增加" ${!info.ent || (info.ent.spec.stock !== null && line.qty >= info.ent.spec.stock) ? raw('disabled') : ''}>+</button>
              </div>
              <span class="price">${info.ok ? yuan(info.price * line.qty) : ''}</span>
            </div>
          </div>
        </div>`)}
      </section>
      <p class="pad small faint">价格以提交预订时为准，取货时当面付款。</p>
      <div class="actionbar above-tabs">
        <div class="ab-total"><span class="price">${yuan(cartTotal())}</span><span class="small faint">共 ${cartCount()} 件</span></div>
        <button type="button" class="btn primary lg" data-act="toCheckout" ${bad.length ? raw('disabled') : ''}>去确认预订</button>
      </div>
      ${tabbar('cart')}`;
  }

  // ---------- 页面：预订确认 ----------
  function pageCheckout() {
    const c = S.co;
    const shop = S.shop;
    if (!S.cart.length && !c.submitting) {
      return html`${topbar('确认预订', '/cart')}<div class="empty"><p class="big">购物车是空的</p><p><a href="#/">回到店铺</a></p></div>`;
    }
    const q = c.quote;
    const changedIds = new Set(((c.notice && c.notice.changedIds) || []));
    let linesHtml;
    if (!q) {
      linesHtml = c.quoteError
        ? html`<div class="error-box"><p>${c.quoteError}</p><button class="btn" type="button" data-act="requote">重新加载</button></div>`
        : html`<div class="loading">正在核对价格和库存…</div>`;
    } else {
      linesHtml = html`<ul class="lines co-lines">
        ${q.lines.map((l) => html`<li>
          <span class="l-name">${l.product_name}<span class="l-spec">${l.spec_name}</span>
            <br><span class="l-price ${changedIds.has(l.spec_id) ? 'changed' : ''}">${yuan(l.unit_price_cents)} / 件</span>
            ${l.problem ? html`<br><span style="color:var(--red);font-size:14px;font-weight:600">${l.message}</span>` : ''}</span>
          <span class="l-qty">×${l.quantity}</span>
          <span class="l-sum">${l.problem ? '—' : yuan(l.subtotal_cents)}</span>
        </li>`)}
        <li class="total-row"><span class="strong">合计</span><span class="price">${yuan(q.total_cents)}</span></li>
      </ul>`;
    }
    const dates = shop.pickup.dates;
    const day = dates.find((d) => d.date === c.date);
    const err = c.errors;
    const notice = c.notice;
    const canSubmit = q && q.ok && shop.accepting_orders && !c.submitting;

    return html`
      ${topbar('确认预订', '/cart')}
      ${offlineBar()}
      ${pausedBanner()}
      ${notice ? html`<div class="banner ${notice.kind}" role="alert">
        <strong>${notice.title}</strong>
        ${notice.lines && notice.lines.length ? html`<br>${notice.lines.map((t, i) => html`${i ? html`<br>` : ''}${t}`)}` : ''}
        ${notice.action === 'cart' ? html`<br><a href="#/cart">回购物车调整</a>` : ''}
      </div>` : ''}
      <section class="section">
        <div class="section-head"><h2>商品清单</h2><a class="small" href="#/cart">修改</a></div>
        ${linesHtml}
      </section>

      <section class="section">
        <div class="section-head"><h2>取货信息</h2></div>
        <label class="field"><span class="label">取货人</span>
          <input class="input ${err.name ? 'invalid' : ''}" id="f-name" maxlength="20" placeholder="姓名或昵称，取货时报这个名字" value="${c.name}" data-model="co.name" autocomplete="name">
          ${err.name ? html`<p class="field-error">${err.name}</p>` : ''}
        </label>
        <label class="field"><span class="label">联系方式</span>
          <input class="input ${err.contact ? 'invalid' : ''}" id="f-contact" maxlength="30" placeholder="手机号或微信号，缺货时商家会联系你" value="${c.contact}" data-model="co.contact" inputmode="text" autocomplete="tel">
          ${err.contact ? html`<p class="field-error">${err.contact}</p>` : ''}
        </label>
        <div class="field"><span class="label">取货日期</span>
          <div class="date-chips">
            ${dates.map((d) => {
              const any = d.slots.some((s) => s.available);
              return html`<button type="button" class="opt ${c.date === d.date ? 'on' : ''}" data-act="date" data-id="${d.date}" ${any ? '' : raw('disabled')}>
                <span class="opt-main">${d.rel || d.text.split(' ')[1]}</span><span class="opt-sub">${d.text.split(' ')[0]}</span></button>`;
            })}
          </div>
        </div>
        <div class="field" id="f-slot"><span class="label">取货时段</span>
          ${day ? html`<div class="opt-grid">
            ${day.slots.map((s) => html`<button type="button" class="opt ${c.slot === s.value ? 'on' : ''}" data-act="slot" data-id="${s.value}" ${s.available ? '' : raw('disabled')}>
              <span class="opt-main num">${s.start} – ${s.end}</span><span class="opt-sub">${s.available ? '可预约' : '来不及了'}</span></button>`)}
          </div>` : html`<p class="muted small">先选取货日期</p>`}
          ${err.slot ? html`<p class="field-error">${err.slot}</p>` : ''}
          ${shop.lead_minutes ? html`<p class="hint">需要至少提前 ${shop.lead_minutes} 分钟预订。</p>` : ''}
        </div>
        <label class="field"><span class="label">备注 <span class="faint small">（可不填）</span></span>
          <textarea class="input" maxlength="200" rows="2" placeholder="比如：可乐要冰的" data-model="co.note">${c.note}</textarea>
        </label>
      </section>

      <div class="pay-note">${payQrs().length
        ? html`<strong>不会自动扣款。</strong>提交后可以扫商家的收款码提前付 ${q ? yuan(q.total_cents) : ''}，也可以取货时当面付。`
        : html`<strong>到店付款。</strong>这里只是预订，不会在线扣款。商家确认后会备好货，取货时当面付 ${q ? yuan(q.total_cents) : ''}。`}</div>
      ${shop.address ? html`<p class="pad small muted">取货地点：${shop.address}</p>` : ''}

      <div class="actionbar">
        <div class="ab-total"><span class="price">${q ? yuan(q.total_cents) : '—'}</span><span class="small faint">到店付款</span></div>
        <button type="button" class="btn primary lg" data-act="submit" ${canSubmit ? '' : raw('disabled')}>${c.submitting ? '正在提交…' : '提交预订'}</button>
      </div>`;
  }

  // ---------- 页面：我的预订 ----------
  function itemsSummary(o) {
    return o.items.map((i) => `${i.product_name}${i.spec_name ? `（${i.spec_name}）` : ''} ×${i.quantity}`).join('，');
  }

  function pageOrders() {
    let body;
    if (S.orders === null) body = html`<div class="loading">正在加载…</div>`;
    else if (!S.orders.length) {
      body = html`<div class="empty"><p class="big">还没有预订</p><p style="margin-bottom:16px">挑好零食提交预订后，会显示在这里。</p><a class="btn primary" href="#/">去挑零食</a></div>`;
    } else {
      body = html`<div class="olist">${S.orders.map((o) => {
        const active = ['pending', 'preparing', 'ready'].includes(o.status);
        return html`<a class="ocard ${active ? '' : 'closed'}" href="#/o/${o.id}" data-key="o${o.id}">
          <div class="o-top"><span class="o-when">${fmtDay(o.pickup_date, today())} <span class="num">${o.pickup_slot}</span></span>${statusPill(o.status)}</div>
          <p class="o-items">${itemsSummary(o)}</p>
          <div class="o-foot">
            <span>${active ? html`取货码 <span class="code-tag">${o.pickup_code}</span>` : html`订单号 <span class="num">${o.order_no}</span>`}</span>
            <span><span class="price">${yuan(o.total_cents)}</span>${payHint(o) ? html` <span class="pay-hint ph-${payHint(o)[1]}">${payHint(o)[0]}</span>` : ''}</span>
          </div>
        </a>`;
      })}</div>`;
    }
    return html`
      <header class="topbar"><h1>我的预订</h1><button type="button" class="link-btn" data-act="refreshOrders">刷新</button></header>
      ${offlineBar()}
      ${body}
      <div class="recover">
        预订记录保存在这台手机的浏览器里。换手机或清理浏览器数据之前，先复制恢复码，到新手机上点「恢复记录」粘贴即可。
        <div class="btn-row"><button type="button" class="btn sm" data-act="copyCode">复制恢复码</button><button type="button" class="btn sm" data-act="restore">恢复记录</button></div>
      </div>
      ${tabbar('orders')}`;
  }

  // ---------- 页面：订单详情 ----------
  const EXPLAIN = {
    pending: '商家还没确认。确认前你可以取消这笔预订。',
    preparing: '商家已接单，正在备货。',
    ready: '已经备好了，请按约定时间到店，出示取货码。',
    completed: '已取货，这笔预订完成了。',
    rejected: '商家没有接这笔预订。',
    cancelled: '这笔预订已取消。',
  };

  function pageOrder(id, isNew) {
    const o = S.orderDetail[id];
    if (!o) {
      if (S.orderError[id]) {
        return html`${topbar('预订详情', '/orders')}<div class="error-box"><p>${S.orderError[id]}</p><a class="btn" href="#/orders">回到我的预订</a></div>`;
      }
      return html`${topbar('预订详情', '/orders')}<div class="loading">正在加载…</div>`;
    }
    const shop = S.shop;
    const active = ['pending', 'preparing', 'ready'].includes(o.status);
    const closed = o.status === 'rejected' || o.status === 'cancelled';
    const stepIdx = { pending: 0, preparing: 1, ready: 2, completed: 3 }[o.status];
    const STEP = ['已提交', '商家接单', '备好待取', '已取货'];
    const reasonWho = o.closed_by === 'customer' ? '你取消了这笔预订' : o.status === 'rejected' ? '商家拒绝了这笔预订' : '商家取消了这笔预订';

    return html`
      ${topbar('预订详情', '/orders')}
      ${offlineBar()}
      ${isNew && o.status === 'pending' ? html`<div class="od-success"><p class="big">预订成功，等待商家确认</p><p>${payQrs().length ? '可以在下面扫码提前付款，也可以取货时当面付。' : '不用在线付款，取货时当面付。'}</p></div>` : ''}
      <section class="od-head">
        <h2 class="od-status">${o.status_text}</h2>
        <p class="od-explain">${EXPLAIN[o.status]}</p>
        ${closed ? html`<p class="reason">${reasonWho}${o.close_reason ? html`。原因：${o.close_reason}` : ''}</p>` : ''}
        ${stepIdx !== undefined ? html`<div class="steps">${STEP.map((t, i) => html`<div class="${i <= stepIdx ? 'done' : ''} ${i === stepIdx ? 'now' : ''}">${t}</div>`)}</div>` : ''}
      </section>

      <div class="ticket ${active ? '' : 'dim'}">
        <div><div class="t-label">取货码</div><div class="t-code">${o.pickup_code}</div></div>
        <div class="t-side">${active ? '到店出示给店主' : o.status === 'completed' ? '已使用' : '已作废'}<br><strong>${fmtDay(o.pickup_date, today())}</strong><br><span class="num">${o.pickup_slot}</span></div>
      </div>

      <section class="section">
        <div class="section-head"><h2>商品</h2><span class="small muted">共 ${o.item_count} 件</span></div>
        <ul class="lines pad" style="padding-top:0">
          ${o.items.map((i) => html`<li><span class="l-name">${i.product_name}<span class="l-spec">${i.spec_name}</span><br><span class="small faint num">${yuan(i.unit_price_cents)} / 件</span></span><span class="l-qty">×${i.quantity}</span><span class="l-sum">${yuan(i.subtotal_cents)}</span></li>`)}
          <li class="total-row"><span class="strong">合计</span><span class="price">${yuan(o.total_cents)}</span></li>
        </ul>
      </section>

      ${paySection(o)}

      <section class="section">
        <div class="section-head"><h2>取货信息</h2></div>
        <dl class="kv pad" style="padding-top:0">
          <dt>取货时间</dt><dd>${fmtDay(o.pickup_date, today())} <span class="num">${o.pickup_slot}</span></dd>
          <dt>取货人</dt><dd>${o.pickup_name}</dd>
          <dt>联系方式</dt><dd>${o.pickup_contact}</dd>
          ${o.note ? html`<dt>备注</dt><dd>${o.note}</dd>` : ''}
          ${shop.address ? html`<dt>取货地点</dt><dd>${shop.address}</dd>` : ''}
          ${shop.phone ? html`<dt>商家电话</dt><dd><a href="${telHref(shop.phone)}">${shop.phone}</a></dd>` : ''}
          <dt>订单号</dt><dd class="num">${o.order_no}</dd>
          <dt>下单时间</dt><dd>${fmtTime(o.created_at)}</dd>
        </dl>
      </section>

      ${o.events && o.events.length ? html`<section class="section">
        <div class="section-head"><h2>进度</h2></div>
        <ul class="timeline pad" style="padding-top:2px">${[...o.events].reverse().map((e) => html`<li><span class="tl-main">${eventText(e)}</span> · ${fmtTime(e.created_at)}${e.note && !['pay_claimed', 'pay_confirmed'].includes(e.status) ? html`<br>${e.status.startsWith('pay') || e.status === 'refunded' ? '说明' : '原因'}：${e.note}` : ''}</li>`)}</ul>
      </section>` : ''}

      <div class="pad stack" style="margin-top:6px">
        ${o.status === 'pending' ? html`<button type="button" class="btn danger block" data-act="cancelOrder" data-id="${o.id}">取消预订</button>` : ''}
        ${o.status === 'preparing' || o.status === 'ready' ? html`<p class="small muted">商家已接单。如需取消或修改，请直接联系商家。</p>
          ${shop.phone && isPhone(shop.phone) ? html`<a class="btn block" href="${telHref(shop.phone)}">打电话给商家</a>` : ''}` : ''}
        <a class="btn ghost block" href="#/">再去逛逛</a>
      </div>`;
  }

  // 列表上的付款小标签
  function payHint(o) {
    if (o.refund_due) return ['待退款', 'warn'];
    if (o.pay_status === 'refunded') return ['已退款', 'muted'];
    if (o.status === 'rejected' || o.status === 'cancelled') return null;
    if (o.pay_status === 'paid') return ['已付款', 'ok'];
    if (o.pay_status === 'claimed') return ['等商家核对', 'warn'];
    return null;
  }

  // 订单详情里的付款区：收款码、我已付款、核对结果、退款
  function paySection(o) {
    const active = ['pending', 'preparing', 'ready'].includes(o.status);
    const amount = yuan(o.total_cents);
    const qrs = payQrs();
    const methodText = o.pay_method_text || '';
    let inner;
    if (o.refund_due) {
      inner = html`<p class="banner warn" style="margin:0">你已付款 ${amount}${methodText ? `（${methodText}）` : ''}，这笔预订${o.status === 'rejected' ? '被拒绝' : '已取消'}了，商家会把钱退给你。有问题请联系商家。</p>`;
    } else if (o.pay_status === 'refunded') {
      inner = html`<p>商家已退款 ${amount}。${o.pay_note ? html`<br><span class="muted small">${o.pay_note}</span>` : ''}</p>`;
    } else if (o.status === 'rejected' || o.status === 'cancelled') {
      return '';
    } else if (o.pay_status === 'paid') {
      inner = html`<p class="pay-done">商家已确认收到 ${amount}${methodText ? `（${methodText}）` : ''}。${active ? '取货时不用再付。' : ''}</p>`;
    } else if (o.pay_status === 'claimed') {
      inner = html`<p>你已告诉商家用${methodText}付了 ${amount}，等商家核对收款记录。</p>
        <p class="small muted" style="margin-top:6px">核对后这里会显示“商家已确认收到”。</p>`;
    } else if (!active) {
      inner = html`<p class="muted">已到店取货，付款在店里当面完成。</p>`;
    } else if (!qrs.length) {
      inner = html`<p><strong>到店付款</strong>：取货时当面付 ${amount}，APP 不在线收款。</p>`;
    } else {
      let tab = qrs.find((x) => x.key === S.payTab) || qrs[0];
      const shopNote = (S.shop.pay && S.shop.pay.note) || '';
      inner = html`
        ${o.pay_note ? html`<p class="banner warn" style="margin:0 0 12px">商家没查到你的付款：${o.pay_note}。可以重新付款，或者联系商家。</p>` : ''}
        <p>可以现在扫码付 <strong class="num">${amount}</strong>，也可以取货时当面付。</p>
        ${qrs.length > 1 ? html`<div class="seg" style="margin-top:10px">${qrs.map((x) => html`<button type="button" class="${x.key === tab.key ? 'on' : ''}" data-act="payTab" data-id="${x.key}">${x.label}</button>`)}</div>` : ''}
        <figure class="pay-qr-wrap">
          <img class="pay-qr" src="${tab.img}" alt="${tab.label}收款码">
          <figcaption>${tab.key === 'wechat'
            ? (IN_WECHAT ? '长按二维码，选「识别图中的二维码」付款' : '长按保存图片（或截图），再打开微信「扫一扫」→ 右上角「相册」选这张图')
            : '长按保存图片（或截图），再打开支付宝「扫一扫」→「相册」选这张图'}</figcaption>
        </figure>
        <p class="small muted">付款时请备注取货码 <span class="code-tag">${o.pickup_code}</span>，方便商家核对。${shopNote ? html`<br>${shopNote}` : ''}</p>
        <button type="button" class="btn primary block lg" style="margin-top:12px" data-act="claimPaid" data-id="${o.id}" data-method="${tab.key}">我已用${tab.label}付款 ${amount}</button>`;
    }
    return html`<section class="section">
      <div class="section-head"><h2>付款</h2>${payHint(o) ? html`<span class="pay-hint ph-${payHint(o)[1]}">${payHint(o)[0]}</span>` : ''}</div>
      <div class="pad" style="padding-top:0">${inner}</div>
    </section>`;
  }

  async function claimPaid(id, method) {
    const o = S.orderDetail[id];
    const label = method === 'wechat' ? '微信' : '支付宝';
    const ok = await confirmDialog({
      title: `确认已经用${label}付了 ${o ? yuan(o.total_cents) : ''}？`,
      message: '商家会在收款记录里核对。还没付的话先别点。',
      ok: '已经付了',
    });
    if (!ok) return;
    try {
      const r = await api('POST', `/api/orders/${id}/paid`, { method });
      S.orderDetail[id] = r.order;
      toast('已告诉商家，等商家核对', 'ok');
      loadOrders().then(render).catch(() => {});
    } catch (e) {
      toast(e.message, 'error');
      await loadOrder(id);
    }
    render();
  }

  function eventText(e) {
    const map = {
      pay_claimed: `你说已付款${e.note ? `（${e.note}）` : ''}`,
      pay_confirmed: `商家确认收到付款${e.note ? `（${e.note}）` : ''}`,
      pay_rejected: '商家没查到付款',
      refunded: '商家已退款',
      pending: '提交预订',
      preparing: '商家接单，开始备货',
      ready: '备货完成，等你来取',
      completed: '已取货',
      rejected: '商家拒单',
      cancelled: e.actor === 'customer' ? '你取消了预订' : '商家取消了预订',
    };
    return map[e.status] || e.status;
  }

  // ---------- 渲染 ----------
  let lastRouteKey = null;
  const scrollMemo = {};
  function render() {
    const r = parseRoute();
    let content;
    let cls = 'app';
    if (!S.booted || !S.shop || !S.catalog) {
      content = S.loadError
        ? html`<div class="error-box" style="margin-top:40px"><p>${S.loadError}</p><button class="btn primary" type="button" data-act="reload">重新加载</button></div>`
        : html`<div class="loading" style="margin-top:80px">正在打开店铺…</div>`;
    } else {
      const [a, b] = r.parts;
      if (!a) { content = pageHome(); cls += cartCount() ? ' with-cartbar' : ''; }
      else if (a === 'p' && b) { content = pageProduct(Number(b)); cls += ' with-actionbar'; }
      else if (a === 'cart') { content = pageCart(); cls += S.cart.length ? ' with-cartbar' : ''; }
      else if (a === 'checkout') { content = pageCheckout(); cls += ' with-actionbar'; }
      else if (a === 'orders') content = pageOrders();
      else if (a === 'o' && b) content = pageOrder(Number(b), r.query.get('new') === '1');
      else content = html`<div class="empty"><p class="big">页面不存在</p><p><a href="#/">回到店铺</a></p></div>`;
    }
    root.className = cls;
    patch(root, content);
    const key = r.path;
    if (key !== lastRouteKey) {
      // 列表页返回时回到原来的位置，其他页面从顶部开始
      const restore = (key === '/' || key === '/orders') ? scrollMemo[key] || 0 : 0;
      lastRouteKey = key;
      window.scrollTo(0, restore);
    }
  }
  window.addEventListener('scroll', () => { if (lastRouteKey) scrollMemo[lastRouteKey] = window.scrollY; }, { passive: true });

  // ---------- 路由切换时准备数据 ----------
  async function onRoute() {
    const r = parseRoute();
    const [a, b] = r.parts;
    if (a !== 'checkout') S.co.submitting = false;
    if (a === 'p' && b) {
      const id = Number(b);
      if (S.detail.productId !== id) S.detail = { productId: id, specId: null, qty: 1 };
    }
    if (a === 'checkout') await enterCheckout();
    if (a === 'o' && b) {
      render();
      await loadOrder(Number(b));
    }
    if (a === 'orders' && S.token) {
      render();
      try { await loadOrders(); } catch (e) { toast(e.message, 'error'); }
    }
    render();
  }

  function firstAvailable() {
    for (const d of S.shop.pickup.dates) {
      const s = d.slots.find((x) => x.available);
      if (s) return { date: d.date, slot: s.value };
    }
    return { date: '', slot: '' };
  }

  async function enterCheckout() {
    const c = S.co;
    if (!S.cart.length) return;
    if (!c.requestId) c.requestId = uuid();
    c.notice = null;
    c.errors = {};
    c.quote = null;
    c.quoteError = '';
    if (!c.name) c.name = store.get('snack.name') || (S.customer && S.customer.last_name) || '';
    if (!c.contact) c.contact = store.get('snack.contact') || (S.customer && S.customer.last_contact) || '';
    try { await loadShop(); } catch (_) { /* 用已有的店铺信息 */ }
    ensureSlotValid();
    render();
    await refreshQuote();
  }

  function ensureSlotValid() {
    const c = S.co;
    const d = S.shop.pickup.dates.find((x) => x.date === c.date);
    const s = d && d.slots.find((x) => x.value === c.slot);
    if (!d || !d.slots.some((x) => x.available)) { Object.assign(c, firstAvailable()); return; }
    if (c.slot && (!s || !s.available)) c.slot = '';
  }

  async function refreshQuote({ detectChange = false } = {}) {
    const c = S.co;
    if (!S.cart.length) return;
    try {
      const q = await request('POST', '/api/cart/quote', { items: S.cart.map((x) => ({ spec_id: x.spec_id, quantity: x.qty })) });
      if (detectChange && c.quote) {
        const old = new Map(c.quote.lines.map((l) => [l.spec_id, l.unit_price_cents]));
        const changes = q.lines.filter((l) => old.has(l.spec_id) && old.get(l.spec_id) !== l.unit_price_cents);
        if (changes.length) {
          c.notice = {
            kind: 'warn',
            title: '价格刚刚有变化，请看一下新价格再提交',
            lines: changes.map((l) => `${l.product_name}（${l.spec_name}）：${yuan(old.get(l.spec_id))} → ${yuan(l.unit_price_cents)}`),
            changedIds: changes.map((l) => l.spec_id),
          };
          toast('价格有变化，请重新确认', 'error');
        }
      }
      c.quote = q;
      c.quoteError = '';
      if (!q.ok && !(c.notice && c.notice.kind === 'stop')) {
        c.notice = { kind: 'stop', title: '有商品库存不足或已下架', lines: q.lines.filter((l) => l.problem).map((l) => `${l.product_name}（${l.spec_name}）：${l.message}`), action: 'cart' };
      }
    } catch (e) {
      if (!c.quote) c.quoteError = e.message;
      else toast(e.message, 'error');
    }
    render();
  }

  function validateCheckout() {
    const c = S.co;
    const e = {};
    c.name = c.name.trim();
    c.contact = c.contact.trim();
    if (!c.name) e.name = '请填写取货人姓名或昵称';
    if (!c.contact) e.contact = '请填写手机号或微信号';
    else if (c.contact.length < 3) e.contact = '联系方式至少 3 个字符';
    if (!c.date || !c.slot) e.slot = '请选择取货时段';
    c.errors = e;
    return Object.keys(e)[0] || null;
  }

  async function submitOrder() {
    const c = S.co;
    if (c.submitting) return;
    const firstErr = validateCheckout();
    if (firstErr) {
      render();
      const el = document.getElementById(firstErr === 'slot' ? 'f-slot' : `f-${firstErr}`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (el.focus && el.tagName === 'INPUT') el.focus(); }
      return;
    }
    if (!c.quote || !c.quote.ok) return;
    if (!c.requestId) c.requestId = uuid();
    c.submitting = true;
    c.notice = null;
    render();
    try {
      const r = await api('POST', '/api/orders', {
        client_request_id: c.requestId,
        items: c.quote.lines.map((l) => ({ spec_id: l.spec_id, quantity: l.quantity, unit_price_cents: l.unit_price_cents })),
        expected_total_cents: c.quote.total_cents,
        pickup_name: c.name,
        pickup_contact: c.contact,
        pickup_date: c.date,
        pickup_slot: c.slot,
        note: c.note.trim(),
      });
      // 只有服务器确认成功才清空购物车并显示成功
      S.cart = [];
      saveCart();
      store.set('snack.name', c.name);
      store.set('snack.contact', c.contact);
      c.requestId = null;
      c.quote = null;
      c.note = '';
      S.orderDetail[r.order.id] = r.order;
      S.orders = [r.order, ...(S.orders || []).filter((o) => o.id !== r.order.id)];
      // 用 replace 跳转：在订单页点返回不会回到已提交的确认页
      location.replace(`#/o/${r.order.id}?new=1`);
      return;
    } catch (e) {
      await handleSubmitError(e);
    }
    c.submitting = false;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmitError(e) {
    const c = S.co;
    const d = e.data || {};
    switch (e.code) {
      case 'PRICE_CHANGED':
        if (d.quote) c.quote = d.quote;
        c.notice = {
          kind: 'warn',
          title: '价格有变化，请看一下新价格，确认后再点「提交预订」',
          lines: (d.price_changes || []).map((p) => `${p.name}：${yuan(p.old_price_cents)} → ${yuan(p.new_price_cents)}`),
          changedIds: (d.price_changes || []).map((p) => p.spec_id),
        };
        try { await loadCatalog(); } catch (_) { /* ignore */ }
        break;
      case 'ITEMS_UNAVAILABLE':
        if (d.quote) c.quote = d.quote;
        c.notice = { kind: 'stop', title: e.message, lines: (d.problems || []).map((p) => `${p.name}：${p.message}`), action: 'cart' };
        try { await loadCatalog(); } catch (_) { /* ignore */ }
        break;
      case 'SHOP_PAUSED':
        c.notice = { kind: 'stop', title: e.message, lines: ['商品可以先放在购物车里，等商家恢复接单后再提交。'] };
        try { await loadShop(); } catch (_) { /* ignore */ }
        break;
      case 'PICKUP_INVALID':
      case 'PICKUP_EXPIRED':
        c.notice = { kind: 'warn', title: e.message };
        try { await loadShop(); } catch (_) { /* ignore */ }
        c.slot = '';
        ensureSlotValid();
        break;
      case 'CUSTOMER_AUTH':
        try { await ensureSession(); } catch (_) { /* ignore */ }
        c.notice = { kind: 'warn', title: '身份信息已更新，请再点一次「提交预订」。' };
        break;
      case 'NETWORK':
        c.notice = { kind: 'stop', title: '网络异常，预订没有确认提交成功', lines: [e.message, '可以放心再点一次「提交预订」，不会重复下单。'] };
        break;
      default:
        c.notice = { kind: 'stop', title: e.message || '提交失败，请稍后再试' };
    }
    toast(c.notice.title, 'error');
  }

  async function cancelOrder(id) {
    const reason = await promptDialog({
      title: '取消这笔预订？',
      message: (S.orderDetail[id] && ['claimed', 'paid'].includes(S.orderDetail[id].pay_status))
        ? '商家还没接单，可以直接取消。你已经付过款，取消后商家会把钱退给你。'
        : '商家还没接单，可以直接取消。',
      presets: ['不想要了', '时间来不及', '选错了商品'],
      placeholder: '取消原因（可不填）',
      required: false,
      ok: '确认取消',
      danger: true,
    });
    if (reason === null) return;
    try {
      const r = await api('POST', `/api/orders/${id}/cancel`, { reason });
      S.orderDetail[id] = r.order;
      toast('预订已取消', 'ok');
      loadOrders().then(render).catch(() => {});
      loadCatalog().then(render).catch(() => {});
    } catch (e) {
      toast(e.message, 'error');
      await loadOrder(id);
    }
    render();
  }

  async function copyRecovery() {
    const code = S.token;
    try {
      await navigator.clipboard.writeText(code);
      toast('恢复码已复制，请保存好，不要发给别人', 'ok');
    } catch (_) {
      await promptDialog({ title: '恢复码', message: '长按下面的文字全选复制。不要发给别人，拿到恢复码的人能看到你的预订。', value: code, required: false, ok: '好了' });
    }
  }

  async function restoreRecovery() {
    const code = await promptDialog({ title: '恢复预订记录', message: '粘贴旧手机上复制的恢复码。恢复后，这台手机会显示旧手机上的预订。', placeholder: '粘贴恢复码', ok: '恢复' });
    if (!code) return;
    const t = code.trim();
    try {
      const r = await request('GET', '/api/customer/me', undefined, { token: t });
      S.token = t;
      store.set('snack.token', t);
      S.customer = r.customer;
      S.orderDetail = {};
      await loadOrders();
      events && events.restart();
      toast('已恢复预订记录', 'ok');
    } catch (e) {
      toast(e.status === 401 ? '恢复码不对，请检查后再试' : e.message, 'error');
    }
    render();
  }

  // ---------- 交互 ----------
  const actions = {
    back(el) {
      if (navCount > 0) history.back();
      else go(el.dataset.to || '/');
    },
    reload() { location.reload(); },
    cat(el) { S.cat = el.dataset.id; render(); },
    open(el) { go(`/p/${el.dataset.id}`); },
    inc(el) { const id = Number(el.dataset.id); setQty(id, cartQty(id) + 1); render(); },
    dec(el) { const id = Number(el.dataset.id); setQty(id, cartQty(id) - 1); render(); },
    remove(el) { setQty(Number(el.dataset.id), 0); render(); },
    async clearCart() {
      if (await confirmDialog({ title: '清空购物车？', ok: '清空', danger: true })) { S.cart = []; saveCart(); render(); }
    },
    spec(el) { S.detail.specId = Number(el.dataset.id); S.detail.qty = 1; render(); },
    dqty(el) { S.detail.qty = Math.max(1, S.detail.qty + Number(el.dataset.d)); render(); },
    addDetail() {
      const d = S.detail;
      const before = cartQty(d.specId);
      setQty(d.specId, before + d.qty);
      const added = cartQty(d.specId) - before;
      if (added > 0) toast(`已加入购物车 ${added} 件`, 'ok');
      d.qty = 1;
      render();
    },
    toCheckout() { S.co.requestId = null; go('/checkout'); },
    requote() { refreshQuote(); },
    date(el) { S.co.date = el.dataset.id; S.co.slot = ''; delete S.co.errors.slot; ensureSlotValid(); render(); },
    slot(el) { S.co.slot = el.dataset.id; delete S.co.errors.slot; render(); },
    submit() { submitOrder(); },
    cancelOrder(el) { cancelOrder(Number(el.dataset.id)); },
    payTab(el) { S.payTab = el.dataset.id; render(); },
    claimPaid(el) { claimPaid(Number(el.dataset.id), el.dataset.method); },
    async refreshOrders() {
      try { await loadOrders(); toast('已刷新', 'ok'); } catch (e) { toast(e.message, 'error'); }
      render();
    },
    copyCode() { copyRecovery(); },
    restore() { restoreRecovery(); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    // 商品行里的按钮不要同时触发“打开商品”
    if (el.dataset.act === 'open' && e.target.closest('[data-stop]')) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    const path = el.dataset && el.dataset.model;
    if (!path) return;
    if (path === 'search') { S.search = el.value; render(); return; }
    const [obj, key] = path.split('.');
    if (obj === 'co') {
      S.co[key] = el.value;
      if (S.co.errors[key]) { delete S.co.errors[key]; render(); }
    }
  });

  // 记录站内跳转次数：有上一页就用浏览器返回，否则回到默认页面
  let navCount = 0;
  window.addEventListener('hashchange', () => { navCount++; onRoute(); });

  // ---------- 实时更新 ----------
  let events = null;
  let catalogTimer = null;
  function scheduleCatalog() {
    clearTimeout(catalogTimer);
    catalogTimer = setTimeout(async () => {
      try { await loadCatalog(); } catch (_) { return; }
      if (parseRoute().parts[0] === 'checkout') await refreshQuote({ detectChange: true });
      render();
    }, 250);
  }

  async function refreshAll() {
    try {
      await Promise.all([loadShop(), loadCatalog(), S.token ? loadOrders() : null]);
      const [a, b] = parseRoute().parts;
      if (a === 'o' && b) await loadOrder(Number(b));
      if (a === 'checkout') { ensureSlotValid(); await refreshQuote({ detectChange: true }); }
      render();
    } catch (_) { /* 网络问题由提示条显示 */ }
  }

  let offlineTimer = null;
  function setOnline(ok) {
    clearTimeout(offlineTimer);
    if (ok) { if (!S.online) { S.online = true; render(); } return; }
    offlineTimer = setTimeout(() => { S.online = false; render(); }, 4000);
  }

  function startEvents() {
    events = connectEvents(() => (S.token ? `/api/events?token=${encodeURIComponent(S.token)}` : null), {
      onStatus: setOnline,
      async onEvent(name, data) {
        if (name === 'reconnected') { if (S.booted) refreshAll(); return; }
        if (name === 'catalog.changed') scheduleCatalog();
        if (name === 'shop.changed') { try { await loadShop(); if (parseRoute().parts[0] === 'checkout') ensureSlotValid(); render(); } catch (_) { /* ignore */ } }
        if (name === 'order.updated') {
          try { await loadOrders(); } catch (_) { /* ignore */ }
          const [a, b] = parseRoute().parts;
          if (a === 'o' && Number(b) === data.id) await loadOrder(data.id);
          else delete S.orderDetail[data.id];
          if (data.kind === 'pay') {
            const msg = { paid: '商家已确认收到你的付款', unpaid: '商家没查到你的付款，请看订单详情', refunded: '商家已退款' }[data.pay_status];
            if (msg) {
              toast(`预订 ${data.order_no}：${msg}`, data.pay_status === 'unpaid' ? 'error' : 'ok');
              if (window.SnackApp && window.SnackApp.showNotice) { try { window.SnackApp.showNotice('付款状态更新', `预订 ${data.order_no}：${msg}`, true); } catch (_) { /* ignore */ } }
            }
            render();
            return;
          }
          if (data.status_text && data.status !== 'pending' && window.SnackApp && window.SnackApp.showNotice) {
            // 在安卓 APP 里：APP 在后台时弹系统通知
            const why = data.close_reason ? `，原因：${data.close_reason}` : '';
            try { window.SnackApp.showNotice('预订状态更新', `预订 ${data.order_no}：${data.status_text}${why}`, true); } catch (_) { /* ignore */ }
          }
          if (data.status_text && data.status !== 'pending') toast(`预订 ${data.order_no}：${data.status_text}`, data.status === 'rejected' || data.status === 'cancelled' ? 'error' : 'ok');
          if (navigator.vibrate) { try { navigator.vibrate(120); } catch (_) { /* ignore */ } }
          render();
        }
      },
    });
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.booted) refreshAll(); });
  window.addEventListener('online', () => { setOnline(true); refreshAll(); });
  window.addEventListener('offline', () => { S.online = false; render(); });
  // 兜底：推送断开时每 45 秒刷新一次有进行中预订的列表
  setInterval(() => {
    if (!S.booted || !S.orders) return;
    if (S.orders.some((o) => ['pending', 'preparing', 'ready'].includes(o.status))) refreshAll();
  }, 45_000);

  // ---------- 启动 ----------
  async function boot() {
    render();
    try {
      await Promise.all([loadShop(), loadCatalog()]);
      await ensureSession();
      await loadOrders();
      S.loadError = '';
    } catch (e) {
      S.loadError = e.message || '打开失败，请检查网络后重试';
    }
    S.booted = true;
    if (S.loadError && (!S.shop || !S.catalog)) { S.booted = false; render(); return; }
    await onRoute();
    startEvents();
  }

  Lib.registerSW();
  boot();
})();
