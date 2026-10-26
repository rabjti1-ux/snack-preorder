"""付款流程浏览器测试：商家上传收款码 → 客户扫码后点“我已付款” → 商家核对 / 没收到 / 退款 / 当面收款

用法（需要 Python 和 Playwright）：
  1. 用全新的数据目录启动服务：DATA_DIR=./tmp-pay PORT=3103 ADMIN_PASSWORD=shop-pass-2026 node server/server.js
  2. 另开一个终端运行：python test/e2e-payment.py
"""
import asyncio, os, re
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('BASE', 'http://localhost:3103')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'payshots')
os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME_PATH')  # 留空则用 Playwright 自带的浏览器
errors = []

async def phone(b, name, ua=None):
    kw = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-CN', timezone_id='Asia/Shanghai')
    if ua: kw['user_agent'] = ua
    ctx = await b.new_context(**kw)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'[{name}] {e}'))
    pg.on('console', lambda m: errors.append(f'[{name}] {m.text}') if m.type == 'error' else None)
    return ctx, pg

def step(m): print('✔', m, flush=True)

async def make_qr(b, path, color):
    pg = await b.new_page(viewport={'width': 600, 'height': 760})
    cells = ''.join(f'<i style="background:{"#111" if (x*7+y*3+x*y) % 3 else "#fff"}"></i>' for y in range(21) for x in range(21))
    await pg.set_content(f'<body style="margin:0;background:{color};display:grid;place-items:center;height:100vh"><div style="background:#fff;padding:24px;border-radius:16px"><div style="display:grid;grid-template-columns:repeat(21,18px);grid-auto-rows:18px">{cells}</div></div></body>')
    await pg.screenshot(path=path)
    await pg.close()

async def order(c, name, contact):
    await c.goto(BASE + '/')
    await c.wait_for_selector('.prod')
    await c.click('.prod:has(.p-name:text-is("冰红茶 500ml")) .add-btn')
    await c.click('.tabbar a[href="#/cart"]')
    await c.click('[data-act="toCheckout"]')
    await c.wait_for_selector('.co-lines')
    await c.fill('[data-model="co.name"]', name)
    await c.fill('[data-model="co.contact"]', contact)
    await c.click('.date-chips .opt:has-text("明天")')
    await c.click('#f-slot .opt:not([disabled]) >> nth=0')
    await c.click('[data-act="submit"]')
    await c.wait_for_selector('.od-success')
    return re.search(r'#/o/(\d+)', c.url).group(1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()
        wq, aq = os.path.join(OUT, 'wechat-qr.png'), os.path.join(OUT, 'alipay-qr.png')
        await make_qr(b, wq, '#1aad19')
        await make_qr(b, aq, '#1677ff')

        # 没上传收款码时：客户只看到“到店付款”
        _, c = await phone(b, '客户')
        oid0 = await order(c, '小吴', '13700001111')
        await expect(c.locator('section:has(h2:text-is("付款"))')).to_contain_text('到店付款')
        assert await c.locator('.pay-qr').count() == 0
        step('没有收款码时只显示到店付款')

        # 商家上传收款码
        _, a = await phone(b, '商家')
        await a.goto(BASE + '/admin')
        await a.fill('[data-model="login.username"]', 'admin')
        await a.fill('[data-model="login.password"]', 'shop-pass-2026')
        await a.click('[data-act="doLogin"]')
        await a.wait_for_selector('.tiles')
        await a.goto(BASE + '/admin#/shop')
        await a.wait_for_selector('.qr-edit')
        await a.set_input_files('input[data-upload="wechat"]', wq)
        await a.wait_for_selector('.qr-slot img[alt="微信收款码"]')
        await a.set_input_files('input[data-upload="alipay"]', aq)
        await a.wait_for_selector('.qr-slot img[alt="支付宝收款码"]')
        await a.fill('[data-model="shop.pay_note"]', '付款时备注取货码')
        await a.click('[data-act="saveShop"]')
        await a.wait_for_selector('#toast.show:has-text("已保存")')
        await a.locator('section:has(h2:text-is("收款码（可选）"))').screenshot(path=f'{OUT}/a1-qr-settings.png')
        step('商家上传微信、支付宝收款码')

        # 客户下单，看到收款码
        oid = await order(c, '小李', '13811112222')
        await c.wait_for_selector('.pay-qr')
        await expect(c.locator('.od-success')).to_contain_text('扫码提前付款')
        await c.locator('section:has(h2:text-is("付款"))').scroll_into_view_if_needed()
        await c.screenshot(path=f'{OUT}/c1-pay-qr.png')
        sec = c.locator('section:has(h2:text-is("付款"))')
        await sec.screenshot(path=f'{OUT}/c1-pay-section.png')
        await c.click('[data-act="claimPaid"]')
        await c.click('.modal [data-r="1"]')
        await expect(sec).to_contain_text('等商家核对收款记录')
        await sec.screenshot(path=f'{OUT}/c2-claimed.png')
        step('客户扫码后点「我已付款」')

        # 商家实时看到，概览出现待核对
        await a.goto(BASE + '/admin#/')
        await a.wait_for_selector('.pay-banner:has-text("1 笔客户说已付款")')
        await a.screenshot(path=f'{OUT}/a2-overview.png')
        await a.click('.pay-banner')
        await a.wait_for_selector('.oc-pay')
        await expect(a.locator('.oc-pay')).to_contain_text('小李')
        await a.screenshot(path=f'{OUT}/a3-claimed-list.png')
        # 没收到
        await a.click('[data-act="payReject"]')
        await a.click('.modal [data-preset="收款记录里没查到"]')
        await a.click('.modal [data-r="1"]')
        await expect(sec).to_contain_text('商家没查到你的付款', timeout=5000)
        await c.screenshot(path=f'{OUT}/c3-rejected.png', full_page=True)
        step('商家点「没收到」，客户看到说明')

        # 客户改用支付宝付，商家确认
        await c.click('[data-act="payTab"][data-id="alipay"]')
        await expect(c.locator('.pay-qr')).to_have_attribute('alt', '支付宝收款码')
        await c.click('[data-act="claimPaid"]')
        await c.click('.modal [data-r="1"]')
        await a.goto(BASE + '/admin#/orders?pay=claimed')
        await a.wait_for_selector('.oc-pay:has-text("支付宝")')
        await a.click('[data-act="payConfirm"]')
        await a.click('.modal [data-r="1"]')
        await expect(sec).to_contain_text('商家已确认收到', timeout=5000)
        await sec.screenshot(path=f'{OUT}/c4-paid.png')
        step('客户改用支付宝付，商家确认收款')

        # 接单 → 备货 → 完成：已付款就不再问
        await a.goto(BASE + f'/admin#/o/{oid}')
        await a.wait_for_selector('.kv')
        await expect(a.locator('.kv')).to_contain_text('已收款')
        await a.click('[data-act="accept"]')
        await a.click('[data-act="ready"]')
        code = (await c.locator('.t-code').inner_text()).strip()
        await a.click('[data-act="complete"]')
        await a.fill('.modal textarea', code)
        await a.click('.modal [data-r="1"]')
        await expect(c.locator('.od-status')).to_have_text('已完成', timeout=5000)
        await a.wait_for_timeout(800)
        assert await a.locator('.modal').count() == 0, '已付款的订单完成时不应再问收款'
        await a.screenshot(path=f'{OUT}/a4-detail-paid.png', full_page=True)
        step('已付款订单完成取货时不再询问收款')

        # 付了钱又被拒单 → 待退款 → 已退款
        _, c2 = await phone(b, '客户2', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 MicroMessenger/8.0.50')
        oid2 = await order(c2, '小王', 'wx_xiaowang')
        await expect(c2.locator('.pay-qr-wrap figcaption')).to_contain_text('识别图中的二维码')
        await c2.click('[data-act="claimPaid"]')
        await c2.click('.modal [data-r="1"]')
        await a.goto(BASE + f'/admin#/o/{oid2}')
        await a.wait_for_selector('[data-act="reject"]')
        await a.click('[data-act="reject"]')
        await expect(a.locator('.modal')).to_contain_text('拒单后请把钱退给客户')
        await a.click('.modal [data-preset="商品缺货"]')
        await a.click('.modal [data-r="1"]')
        await a.wait_for_selector('.oc-pay.refund')
        await a.screenshot(path=f'{OUT}/a5-refund-due.png')
        sec2 = c2.locator('section:has(h2:text-is("付款"))')
        await expect(sec2).to_contain_text('商家会把钱退给你', timeout=5000)
        await a.click('[data-act="payRefund"]')
        await a.click('.modal [data-preset="已微信转回"]')
        await a.click('.modal [data-r="1"]')
        await expect(sec2).to_contain_text('商家已退款', timeout=5000)
        await sec2.screenshot(path=f'{OUT}/c5-refunded.png')
        step('付款后被拒单：商家看到待退款，退款后客户看到已退款')

        # 没在 APP 里付款的订单：完成取货时问“收到了吗”
        await a.goto(BASE + f'/admin#/o/{oid0}')
        await a.wait_for_selector('[data-act="accept"]')
        await a.click('[data-act="accept"]')
        await a.click('[data-act="ready"]')
        code0 = (await c.evaluate(f"fetch('/api/orders/{oid0}',{{headers:{{Authorization:'Bearer '+JSON.parse(localStorage.getItem('snack.token'))}}}}).then(r=>r.json()).then(d=>d.order.pickup_code)"))
        await a.click('[data-act="complete"]')
        await a.fill('.modal textarea', code0)
        await a.click('.modal [data-r="1"]')
        await a.wait_for_selector('.modal:has-text("收到")')
        await a.screenshot(path=f'{OUT}/a6-ask-paid.png')
        await a.click('.modal button:has-text("当面收了")')
        await expect(a.locator('.ocard .paytag')).to_have_text('已收款·当面', timeout=5000)
        step('未付款订单完成取货时询问收款，记为当面收款')

        await b.close()
    if errors:
        print('页面错误：', *errors, sep='\n  ')
        raise SystemExit(1)
    print('付款流程全部通过')

asyncio.run(main())
