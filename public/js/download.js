// 下载页：安卓给安装包，苹果教“添加到主屏幕”，微信里提示去浏览器打开
(function () {
  'use strict';
  const { html, raw, patch, request } = Lib;
  const root = document.getElementById('app');

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const inWeChat = /MicroMessenger/i.test(ua);
  const inOtherApp = /\bQQ\/|AlipayClient|Weibo|DingTalk|Lark|Feishu/i.test(ua);
  const inOurApp = /SnackPreorderApp\//.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|MQQBrowser|UCBrowser|Quark|baidu/i.test(ua);

  const forMerchant = new URLSearchParams(location.search).get('for') === 'merchant';
  const appKey = forMerchant ? 'merchant' : 'customer';
  const openPath = forMerchant ? '/admin' : '/';

  const S = {
    shop: null,
    apps: null,
    error: '',
    tab: isIOS ? 'ios' : 'android',
    hideInApp: false,
  };

  const SHARE = raw('<svg class="share-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="分享按钮"><path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>');
  const ARROW = raw('<svg viewBox="0 0 100 100" fill="none" stroke="#ffd23c" stroke-width="5" stroke-linecap="round"><path d="M20 90 C 40 50, 60 30, 88 12"/><path d="M68 12 88 12 84 32"/></svg>');

  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
  const appName = () => (forMerchant ? '商家后台' : (S.shop ? S.shop.name : '零食预订'));

  function inAppOverlay() {
    if (!(inWeChat || inOtherApp) || S.hideInApp) return '';
    const where = inWeChat ? '微信' : '这个 APP';
    return html`<div class="inapp" role="dialog" aria-label="请在浏览器中打开">
      ${ARROW}
      <p class="ia-text">${where}里不能下载安装。<br>请点右上角 <b>···</b><br>选择 <b>${isIOS ? '在 Safari 中打开' : '在浏览器打开'}</b></p>
      <p class="ia-sub">打开后按页面提示操作就行。</p>
      <button type="button" data-act="closeOverlay">我知道了</button>
    </div>`;
  }

  function androidCard() {
    const a = S.apps && S.apps[appKey];
    if (!S.apps) return html`<div class="dl-card"><p class="muted">正在查询安装包…</p></div>`;
    if (!a || !a.available) {
      return html`<div class="dl-card">
        <p class="strong">安卓 APP 还没准备好</p>
        <p class="note">可以先把网页放到桌面：用浏览器打开${forMerchant ? '商家后台' : '店铺'}，在浏览器菜单里选「添加到主屏幕」或「添加到桌面」。</p>
        <a class="btn primary lg" style="margin-top:14px" href="${openPath}">打开${forMerchant ? '商家后台' : '店铺'}</a>
      </div>`;
    }
    return html`<div class="dl-card">
      <a class="btn primary lg" href="${a.url}" download>下载安卓 APP</a>
      <p class="meta">${appName()} · ${mb(a.size)}</p>
      <p class="note">下载完成后点开安装包安装。手机提示“未知来源”或“有风险”时，选择允许或继续安装就行——这个 APP 不是从应用商店下载的，所以手机会多问一句。</p>
      ${forMerchant ? html`<p class="note">商家版打开时屏幕保持常亮；有新订单时，APP 在后台也会弹出系统通知。第一次打开请允许通知。</p>` : ''}
    </div>`;
  }

  function iosCard() {
    const name = forMerchant ? '商家后台' : '店铺首页';
    return html`<div class="dl-card">
      <ol class="steps-list">
        <li><div class="s-title">用 Safari 浏览器</div>
          <div class="s-sub">${isIOS && !isSafari ? '你现在用的不是 Safari。复制这个网址，到 Safari 里打开。' : '苹果自带的浏览器，图标是蓝色指南针。'}</div></li>
        <li><div class="s-title">打开${name}</div>
          <a class="btn dark" href="${openPath}">打开${name}</a></li>
        <li><div class="s-title">点屏幕底部的分享按钮 ${SHARE}</div>
          <div class="s-sub">方框加向上箭头的图标。iPad 在右上角。</div></li>
        <li><div class="s-title">选「添加到主屏幕」，再点「添加」</div>
          <div class="s-sub">选项在分享菜单靠下的位置，看不到就往上滑。</div></li>
      </ol>
      <p class="note">桌面上会出现「${forMerchant ? '商家后台' : appName()}」图标，点开就是全屏的${forMerchant ? '商家后台' : '店铺'}，用起来和 APP 一样。苹果手机不能直接安装 APP 文件，这是苹果的规定。</p>
    </div>`;
  }

  function render() {
    let body;
    if (inOurApp || standalone) {
      body = html`<div class="dl-card"><p class="strong">你已经在用 APP 了</p><p class="note">不需要再下载。</p><a class="btn primary" style="margin-top:12px" href="${openPath}">回到${forMerchant ? '商家后台' : '店铺'}</a></div>`;
    } else {
      body = html`
        <div class="dl-seg" role="tablist">
          <button type="button" class="${S.tab === 'android' ? 'on' : ''}" data-act="tab" data-id="android">安卓手机</button>
          <button type="button" class="${S.tab === 'ios' ? 'on' : ''}" data-act="tab" data-id="ios">苹果手机</button>
        </div>
        ${S.tab === 'android' ? androidCard() : iosCard()}
        ${!isIOS && !isAndroid ? html`<p class="dl-foot">请用手机打开这个网址：<br><strong>${location.href}</strong></p>` : ''}
        <p class="dl-foot">不想装也可以直接用浏览器：<a href="${openPath}">打开${forMerchant ? '商家后台' : '店铺'}</a></p>`;
    }
    const icon = forMerchant ? '/icons/admin-192.png' : (S.shop && S.shop.image) || '/icons/icon-192.png';
    patch(root, html`
      <header class="dl-head">
        <img class="dl-icon" src="${icon}" alt="">
        <h1>${appName()}</h1>
        <p>${forMerchant ? '商家用：接单、备货、核对取货码' : '装到手机上，下次点桌面图标就能打开'}</p>
      </header>
      ${S.error ? html`<p class="banner stop">${S.error}</p>` : ''}
      ${body}
      ${inAppOverlay()}`);
    document.title = `下载 ${appName()}`;
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'tab') { S.tab = el.dataset.id; render(); }
    if (el.dataset.act === 'closeOverlay') { S.hideInApp = true; render(); }
  });

  async function boot() {
    render();
    try {
      const r = await request('GET', '/api/app-downloads');
      S.apps = r.apps;
      S.shop = r.shop;
      S.error = '';
    } catch (e) {
      S.apps = {};
      S.error = e.message;
    }
    render();
  }
  boot();
})();
