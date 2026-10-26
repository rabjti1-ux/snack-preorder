"""浏览器端到端测试：一个商家 + 三位客户，各用一台模拟手机，走完整个流程并截图。

用法（需要 Python 和 Playwright：pip install playwright && playwright install chromium）：
  1. 用全新的数据目录启动服务：DATA_DIR=./tmp-e2e PORT=3100 ADMIN_PASSWORD=shop-pass-2026 node server/server.js
  2. 另开一个终端运行：python test/e2e-browser.py
截图保存在 test/shots/。
"""
import asyncio, os, sys, re, json, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:3100')
PW = os.environ.get('ADMIN_PW', 'shop-pass-2026')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME_PATH')  # 留空则用 Playwright 自带的浏览器
errors = []

def step(msg):
    print('✔', msg, flush=True)

async def phone(browser, name):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                    locale='zh-CN', timezone_id='Asia/Shanghai')
    page = await ctx.new_page()
    def on_console(m):
        if m.type == 'error' and 'net::ERR_INTERNET_DISCONNECTED' not in m.text and 'Failed to load resource' not in m.text:
            errors.append(f'[{name}] console: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errors.append(f'[{name}] pageerror: {e}'))
    return ctx, page

async def shot(page, name, full=False):
    await page.wait_for_timeout(250)
    await page.screenshot(path=f'{OUT}/{name}.png', full_page=full)

async def add_spec(page, product, spec, qty=1):
    """在首页打开商品，选规格和数量，加入购物车，然后回到首页"""
    await page.click(f'.prod:has(.p-name:text-is("{product}"))')
    await page.wait_for_selector('.pd-name')
    await page.click(f'.opt:has(.opt-main:text-is("{spec}"))')
    for _ in range(qty - 1):
        await page.click('[data-act="dqty"][data-d="1"]')
    await page.click('[data-act="addDetail"]')
    await page.click('.topbar .back')
    await page.wait_for_selector('.shop-name')

async def checkout(page, name, contact, note=''):
    await page.click('.tabbar a[href="#/cart"]')
    await page.click('[data-act="toCheckout"]')
    await page.wait_for_selector('.co-lines')
    await page.fill('[data-model="co.name"]', name)
    await page.fill('[data-model="co.contact"]', contact)
    # 选“明天”的第一个时段，保证无论几点跑测试都可约
    await page.click('.date-chips .opt:has-text("明天")')
    await page.click('#f-slot .opt:not([disabled]) >> nth=0')
    if note:
        await page.fill('[data-model="co.note"]', note)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()

        # ---------- 商家登录 ----------
        actx, a = await phone(browser, '商家')
        await a.goto(BASE + '/admin')
        await a.wait_for_selector('.login')
        await shot(a, 'a01-login')
        await a.fill('[data-model="login.username"]', 'admin')
        await a.fill('[data-model="login.password"]', 'wrong-password')
        await a.click('[data-act="doLogin"]')
        await expect(a.locator('.field-error')).to_contain_text('账号或密码不对')
        await a.fill('[data-model="login.password"]', PW)
        await a.click('[data-act="doLogin"]')
        await a.wait_for_selector('.tiles')
        await shot(a, 'a02-overview-empty')
        step('商家登录成功（错误密码被拒）')

        # ---------- 流程 1：商家新增商品，客户能看到 ----------
        await a.click('.tabbar a[href="#/products"]')
        await a.wait_for_selector('.mprod')
        await shot(a, 'a03-products')
        await a.click('a[href="#/products/new"]')
        await a.wait_for_selector('[data-model="edit.name"]')
        await a.fill('[data-model="edit.name"]', '冰镇柠檬茶')
        await a.select_option('[data-model="edit.category_id"]', label='饮料')
        await a.fill('[data-model="edit.description"]', '店里冰柜现拿，取货时是冰的。')
        await a.fill('[data-model="spec.0.name"]', '单瓶')
        await a.fill('[data-model="spec.0.price"]', '4.5')
        await a.fill('[data-model="spec.0.stock"]', '20')
        await a.click('[data-act="addSpec"]')
        await a.fill('[data-model="spec.1.name"]', '整箱 12 瓶')
        await a.fill('[data-model="spec.1.price"]', '48')
        await a.fill('[data-model="spec.1.stock"]', '2')
        # 上传一张图片（用页面生成一张 PNG）
        img_path = os.path.join(OUT, 'upload-test.png')
        tmp = await actx.new_page()
        await tmp.set_viewport_size({'width': 600, 'height': 600})
        await tmp.set_content('<body style="margin:0;background:#f4f0d0;display:grid;place-items:center;height:100vh"><div style="width:220px;height:380px;border-radius:40px;background:#e8c21f;box-shadow:inset 0 -60px 0 #2c8a3f"></div></body>')
        await tmp.screenshot(path=img_path)
        await tmp.close()
        await a.set_input_files('input[data-upload="product"]', img_path)
        await a.wait_for_selector('.img-edit img.preview[src^="/uploads/"]', timeout=10000)
        await shot(a, 'a04-product-edit', full=True)
        await a.click('[data-act="saveProduct"]')
        await a.wait_for_selector('.mprod:has-text("冰镇柠檬茶")')
        step('商家新增商品「冰镇柠檬茶」（两个规格 + 上传图片）')

        # 客户 A（小李）
        lctx, li = await phone(browser, '小李')
        await li.goto(BASE + '/')
        await li.wait_for_selector('.shop-name')
        await li.fill('[data-model="search"]', '柠檬')
        await li.wait_for_selector('.prod:has-text("冰镇柠檬茶")')
        await expect(li.locator('.prod')).to_have_count(1)
        await shot(li, 'c01-search-new-product')
        await li.fill('[data-model="search"]', '')
        step('流程 1：客户搜索能看到新商品')

        # ---------- 流程 2：两位客户分别下单 ----------
        await add_spec(li, '可乐 330ml', '单罐', 2)
        await add_spec(li, '原味薯片', '大包 75g', 3)
        await shot(li, 'c02-home-with-cart')
        await li.click('.tabbar a[href="#/cart"]')
        await li.wait_for_selector('.cline')
        await shot(li, 'c03-cart')
        await checkout(li, '小李', '13811112222', '可乐要冰的')
        await shot(li, 'c04-checkout', full=True)
        btn = li.locator('[data-act="submit"]')
        await expect(btn).to_have_text('提交预订')
        # 连点三次，只应生成一笔订单
        await btn.click(click_count=3, delay=20)
        await li.wait_for_selector('.od-success')
        await expect(li.locator('.od-success')).to_contain_text('预订成功，等待商家确认')
        code_li = (await li.locator('.t-code').inner_text()).strip()
        li_url = li.url
        await shot(li, 'c05-success')
        step(f'小李提交预订成功，取货码 {code_li}')

        wctx, wang = await phone(browser, '小王')
        await wang.goto(BASE + '/')
        await wang.wait_for_selector('.shop-name')
        await add_spec(wang, '冰镇柠檬茶', '单瓶', 1)
        await add_spec(wang, '麻辣辣条', '整盒 20 包', 1)
        await checkout(wang, '小王', 'wx_xiaowang')
        await wang.click('[data-act="submit"]')
        await wang.wait_for_selector('.od-success')
        code_wang = (await wang.locator('.t-code').inner_text()).strip()
        wang_order_url = wang.url
        step(f'小王提交预订成功，取货码 {code_wang}')

        # 商家端实时收到提醒
        await a.click('.tabbar a[href="#/"]')
        await a.wait_for_selector('.alert-new', timeout=5000)
        await expect(a.locator('.tiles .tile.hot .t-n')).to_have_text('2')
        await shot(a, 'a05-overview-new-orders')
        await a.click('[data-act="viewAlerts"]')
        await a.wait_for_selector('.ocard')
        await expect(a.locator('.ocard')).to_have_count(2)
        await expect(a.locator('.ocard:has-text("小李")')).to_contain_text('可乐 330ml')
        await expect(a.locator('.ocard:has-text("小李")')).to_contain_text('×3')
        await expect(a.locator('.ocard:has-text("小李")')).to_contain_text('可乐要冰的')
        await expect(a.locator('.ocard:has-text("小王")')).to_contain_text('冰镇柠檬茶')
        await expect(a.locator('.ocard:has-text("小王")')).not_to_contain_text('可乐')
        await shot(a, 'a06-orders-pending', full=True)
        step('流程 2：商家实时收到提醒，订单卡片清楚区分两个人')

        # ---------- 流程 3：接单、备货完成，客户看到变化 ----------
        await li.goto(li_url)
        await li.wait_for_selector('.od-status')
        await a.click('.ocard:has-text("小李") [data-act="accept"]')
        await expect(li.locator('.od-status')).to_have_text('备货中', timeout=5000)
        await shot(li, 'c06-preparing')
        await expect(li.locator('[data-act="cancelOrder"]')).to_have_count(0)
        await a.click('.otabs [data-id="preparing"]')
        await a.click('.ocard:has-text("小李") [data-act="ready"]')
        await expect(li.locator('.od-status')).to_have_text('待取货', timeout=5000)
        await shot(li, 'c07-ready', full=True)
        step('流程 3：商家接单、备货完成，小李页面自动变为「备货中」→「待取货」')

        # 备货汇总（明天）
        await a.click('.tabbar a[href="#/prep"]')
        await a.click('[data-act="prepDate"] >> nth=1')
        await a.wait_for_selector('.prep-sec')
        await shot(a, 'a07-prep-by-product', full=True)
        await a.click('.seg [data-id="customer"]')
        await shot(a, 'a08-prep-by-customer', full=True)
        await a.click('.seg [data-id="product"]')
        step('备货汇总：按商品 / 按客户')

        # ---------- 流程 4：到店核对取货码 ----------
        await a.click('.tabbar a[href="#/"]')
        await a.fill('[data-model="verify.code"]', '0000' if code_li != '0000' else '1111')
        await a.click('[data-act="verify"]')
        await a.wait_for_selector('.banner.warn')
        await a.fill('[data-model="verify.code"]', code_li)
        await a.click('[data-act="verify"]')
        await a.wait_for_selector('.ocard:has-text("小李") [data-act="complete"]')
        await shot(a, 'a09-verify-found')
        await a.click('.ocard:has-text("小李") [data-act="complete"]')
        await a.wait_for_selector('.modal textarea')
        await a.fill('.modal textarea', '9' + code_li[1:] if code_li[0] != '9' else '1' + code_li[1:])
        await a.click('.modal [data-r="1"]')
        await a.wait_for_selector('.modal:has-text("取货码不对")')
        await a.fill('.modal textarea', code_li)
        await shot(a, 'a10-verify-dialog')
        await a.click('.modal [data-r="1"]')
        await expect(li.locator('.od-status')).to_have_text('已完成', timeout=5000)
        # 完成取货后会问一句钱收到没有：选“当面收了”
        await a.wait_for_selector('.modal:has-text("收到")')
        await a.click('.modal button:has-text("当面收了")')
        await a.wait_for_selector('.modal', state='detached')
        await shot(li, 'c08-completed', full=True)
        step('流程 4：取货码输错被拦下，输对后完成；小李看到「已完成」')

        # ---------- 流程 6：改价不影响旧订单；取消释放库存 ----------
        zctx, zhao = await phone(browser, '小赵')
        await zhao.goto(BASE + '/')
        await zhao.wait_for_selector('.shop-name')
        await add_spec(zhao, '可乐 330ml', '单罐', 1)
        await checkout(zhao, '小赵', '13700000000')
        await expect(zhao.locator('.co-lines')).to_contain_text('¥3.00')
        # 小赵停在确认页时，商家把可乐单罐改成 3.50
        await a.goto(BASE + '/admin#/products')
        await a.wait_for_selector('.mprod:has-text("可乐 330ml")')
        await a.click('.mprod:has-text("可乐 330ml") a:has-text("编辑")')
        await a.wait_for_selector('[data-model="spec.0.price"]')
        await a.fill('[data-model="spec.0.price"]', '3.5')
        await a.wait_for_selector('.banner.info:has-text("改价只影响之后的预订")')
        await a.click('[data-act="saveProduct"]')
        await a.wait_for_selector('.mprod')
        await zhao.wait_for_selector('.banner.warn:has-text("价格")', timeout=5000)
        await expect(zhao.locator('.co-lines')).to_contain_text('¥3.50')
        await shot(zhao, 'c09-price-changed', full=True)
        await zhao.click('[data-act="submit"]')
        await zhao.wait_for_selector('.od-success')
        await expect(zhao.locator('.lines')).to_contain_text('¥3.50')
        # 小李的旧订单仍是 3.00
        await li.reload()
        await li.wait_for_selector('.od-status')
        await expect(li.locator('.lines')).to_contain_text('¥3.00 / 件')
        step('流程 6a：确认页实时提示价格变化；新单按 3.50，小李旧单仍是 3.00')

        # 小王取消（商家还没接单），库存释放
        def stock_of(product, spec):
            data = json.loads(urllib.request.urlopen(BASE + '/api/catalog').read())
            for pr in data['products']:
                if pr['name'] == product:
                    for s in pr['specs']:
                        if s['name'] == spec: return s['stock']
        before = stock_of('冰镇柠檬茶', '单瓶')
        await wang.goto(wang_order_url.split('?')[0])
        await wang.wait_for_selector('[data-act="cancelOrder"]')
        await wang.click('[data-act="cancelOrder"]')
        await wang.click('.modal [data-preset="选错了商品"]')
        await wang.click('.modal [data-r="1"]')
        await expect(wang.locator('.od-status')).to_have_text('已取消')
        after = stock_of('冰镇柠檬茶', '单瓶')
        assert after == before + 1, (before, after)
        await shot(wang, 'c10-cancelled', full=True)
        step(f'流程 6b：小王取消预订，柠檬茶库存 {before} → {after}')

        # ---------- 流程 7：客户看不到别人的订单，进不了后台 ----------
        li_order_id = re.search(r'#/o/(\d+)', li_url).group(1)
        await wang.goto(BASE + f'/#/o/{li_order_id}')
        await wang.wait_for_selector('.error-box')
        await expect(wang.locator('.error-box')).to_contain_text('找不到这笔预订')
        await expect(wang.locator('body')).not_to_contain_text('13811112222')
        await shot(wang, 'c11-other-order-denied')
        await wang.goto(BASE + '/admin')
        await wang.wait_for_selector('.login')
        await wang.goto(BASE + '/admin#/orders')
        await wang.wait_for_timeout(500)
        assert await wang.locator('.ocard').count() == 0
        await wang.goto(BASE + '/')
        step('流程 7：小王打不开小李的订单，进 /admin 只看到登录页')

        # ---------- 暂停接单 ----------
        await a.goto(BASE + '/admin#/')
        await a.wait_for_selector('.accept-card')
        await a.click('.accept-card .switch')
        await a.click('.modal [data-preset="正在进货，稍后恢复"]')
        await a.click('.modal [data-r="1"]')
        await a.wait_for_selector('.accept-card.off')
        await wang.wait_for_selector('.banner.stop:has-text("暂停接单")', timeout=5000)
        await add_spec(wang, '大面筋', '单包', 1)
        await wang.click('.tabbar a[href="#/cart"]')
        await wang.click('[data-act="toCheckout"]')
        await wang.wait_for_selector('.co-lines')
        await expect(wang.locator('[data-act="submit"]')).to_be_disabled()
        await shot(wang, 'c12-paused', full=True)
        await a.click('.accept-card .switch')
        await a.wait_for_selector('.accept-card:not(.off)')
        await expect(wang.locator('[data-act="submit"]')).to_be_enabled(timeout=5000)
        step('暂停接单：客户能看商品但提交按钮不可用；恢复后可用')

        # ---------- 网络异常：不能把失败显示成成功 ----------
        await wang.fill('[data-model="co.name"]', '小王')
        await wang.fill('[data-model="co.contact"]', 'wx_xiaowang')
        await wang.click('.date-chips .opt:has-text("明天")')
        await wang.click('#f-slot .opt:not([disabled]) >> nth=0')
        await wctx.set_offline(True)
        await wang.click('[data-act="submit"]')
        await wang.wait_for_selector('.banner.stop:has-text("网络异常")', timeout=20000)
        assert await wang.locator('.od-success').count() == 0
        await shot(wang, 'c13-network-error')
        await wctx.set_offline(False)
        await wang.wait_for_timeout(500)
        await wang.click('[data-act="submit"]')
        await wang.wait_for_selector('.od-success', timeout=10000)
        step('网络断开时提示“没有确认提交成功”，恢复后再提交成功')

        # 我的预订列表
        await li.goto(BASE + '/#/orders')
        await li.wait_for_selector('.ocard')
        await shot(li, 'c14-my-orders')
        assert await li.locator('.ocard').count() == 1, '小李只应看到自己的 1 笔预订'

        # 商家端：订单详情、店铺设置
        await a.goto(BASE + '/admin#/orders?status=pending')
        await a.wait_for_selector('.ocard')
        await a.click('.ocard .oc-head >> nth=0')
        await a.wait_for_selector('.kv')
        await shot(a, 'a11-order-detail', full=True)
        await a.goto(BASE + '/admin#/shop')
        await a.wait_for_selector('[data-model="shop.name"]')
        await shot(a, 'a12-shop-settings', full=True)
        await a.goto(BASE + '/admin#/')
        await a.wait_for_selector('.tiles')
        await shot(a, 'a13-overview', full=True)

        # 数据持久化：刷新后订单还在
        await li.reload()
        await li.wait_for_selector('.ocard')
        step('刷新页面后订单仍在')

        await browser.close()
    if errors:
        print('\n页面错误：')
        for e in errors: print('  ', e)
        sys.exit(1)
    print('\n全部通过')

asyncio.run(main())
