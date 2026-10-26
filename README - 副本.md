# 零食预订

提前预订、到店自提、线下付款的零食订货工具。客户端和商家端连同一个后台，不同手机上的客户和商家可以同时使用。

- **客户**打开店铺链接 → 挑零食 → 提交预订 → 拿到取货码 → 按时到店取货、当面付款
- **商家**打开 `/admin` → 收到新订单响铃提醒 → 接单、备货 → 客户到店后核对取货码 → 完成

提交预订不需要付款。APP 不接在线支付接口；商家可以上传自己的**微信 / 支付宝收款码**，客户下单后可以扫码提前付款并点「我已付款」，由商家核对后确认（详见[付款规则](#付款收款码可选)）。不上传收款码就是纯到店付款。

界面截图见 [`docs/screenshots`](docs/screenshots/)。

---

## 目录

1. [5 分钟在自己电脑上跑起来](#1-5-分钟在自己电脑上跑起来)
2. [正式营业前要做的事](#2-正式营业前要做的事)
3. [部署到云服务器](#3-部署到云服务器)
4. [手机 APP：安卓和苹果](#4-手机-app安卓和苹果)
5. [配置项](#5-配置项)
6. [命令行工具与备份](#6-命令行工具与备份)
7. [业务规则](#7-业务规则)
8. [数据库结构](#8-数据库结构)
9. [接口一览](#9-接口一览)
10. [测试](#10-测试)
11. [代码结构](#11-代码结构)
12. [已知限制](#12-已知限制)

---

## 1. 5 分钟在自己电脑上跑起来

**只需要 Node.js，不需要 `npm install`**（整个项目没有第三方依赖，数据库用的是 Node.js 自带的 SQLite）。

1. 安装 Node.js **22.13 或更高版本**（推荐 24 LTS）：<https://nodejs.org>
   国内下载慢可以用镜像：<https://npmmirror.com/mirrors/node/>
2. 启动：
   - **Windows**：双击 `start-windows.bat`
   - **Mac / Linux**：在项目目录打开终端，运行 `npm start`
3. 窗口里会显示：

   ```
    本机打开：   http://localhost:3000
    手机打开：   http://192.168.1.23:3000   （手机和电脑连同一个 Wi-Fi）
    商家后台：   在地址后面加 /admin

    已创建商家账号：admin
    初始密码：    xxxxxxxxxxxx    ← 请记下来
   ```

4. 手机连上和电脑**同一个 Wi-Fi**，浏览器打开“手机打开”那个地址就是客户端；地址后面加 `/admin` 是商家端。

> Windows 第一次运行可能弹出“防火墙”提示，要勾选“专用网络”并允许，否则手机打不开。
> 关掉这个窗口服务就停了；数据都保存在 `data` 文件夹里，下次启动还在。

想自己定商家密码：把 `.env.example` 复制一份改名为 `.env`，填上 `ADMIN_PASSWORD=你的密码`（至少 8 位），**在第一次启动之前**改好。已经创建过账号的话，在商家端「店铺」页改密码即可。

## 2. 正式营业前要做的事

第一次启动时会写入一套**示例商品**（可乐、薯片等），方便你试用。正式使用前：

1. 用商家账号登录 `/admin`，到「店铺」页**修改密码**
2. 在「店铺」页填好店名、电话、地址、营业时间、公告、**取货时段**，点保存
3. 「店铺」页最下面点**删除全部示例数据**（只删示例商品和用示例商品下的测试订单，你自己加的不受影响）
4. 到「商品」页添加你的商品（可以拍照上传图片）
5. 想让客户提前付款的话，在「店铺」页的「收款码」上传微信或支付宝收款码（可选）。建议用微信的“个人经营收款码”，不需要营业执照，收款和个人零花钱分开
6. 测试期间用真实商品下过的测试订单，可以运行 `node server/cli.js clear-orders --yes` 一次清空
7. 在「店铺」页复制**给客户的链接**，发到群里

## 3. 部署到云服务器

自己电脑只适合测试（电脑关机服务就停了，也只有同一 Wi-Fi 能访问）。正式营业建议放到一台云服务器上（阿里云、腾讯云等的轻量应用服务器，最低配置就够）。

> **关于域名备案**：用中国大陆的服务器绑定域名对外提供网站，需要先做 ICP 备案。测试阶段可以直接用 `http://服务器公网IP:3000` 访问，不需要域名。记得在云服务器控制台的“防火墙 / 安全组”里放行 3000 端口。

### 方式 A：Docker（推荐）

```bash
# 把整个项目上传到服务器，例如 /opt/snack-preorder
cd /opt/snack-preorder
# 编辑 docker-compose.yml，填上 ADMIN_PASSWORD
docker compose up -d --build
docker compose logs        # 查看启动信息和初始密码
```

数据保存在服务器的 `/opt/snack-preorder/data`，删除容器不会丢。

### 方式 B：直接用 Node.js

```bash
# 服务器装好 Node.js 22.13+ 后
cd /opt/snack-preorder
cp .env.example .env       # 编辑 .env 填上 ADMIN_PASSWORD
npm start                  # 先前台试运行，确认能打开
```

让它在后台常驻、开机自启，用 systemd（新建 `/etc/systemd/system/snack.service`）：

```ini
[Unit]
Description=Snack preorder
After=network.target

[Service]
WorkingDirectory=/opt/snack-preorder
ExecStart=/usr/bin/node server/server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data /opt/snack-preorder/data
sudo systemctl enable --now snack
journalctl -u snack -f     # 看日志
```

### 用 Nginx 配 HTTPS（有备案域名后）

HTTPS 之后才能“安装”成独立 APP、开启系统通知。Nginx 配置要点是**关掉推送接口的缓冲**，否则新订单提醒会延迟：

```nginx
server {
    listen 443 ssl;
    server_name shop.example.com;
    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 60m;           # 允许上传商品图片和安卓安装包

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection "";
        proxy_buffering off;            # 实时推送需要
        proxy_read_timeout 1h;
    }
}
```

同时在 `.env` 里设置 `TRUST_PROXY=true`。

## 4. 手机 APP：安卓和苹果

客户和商家都打开同一个下载页，页面会自动认出是安卓还是苹果手机：

- 客户下载页：`你的地址/download`
- 商家下载页：`你的地址/download?for=merchant`

在微信里打开下载页，会提示“点右上角 ··· 在浏览器打开”，因为微信里不能下载安装包，也不能添加到主屏幕。

| | 安卓手机 | 苹果手机 |
| --- | --- | --- |
| 怎么装 | 下载 APK 安装 | Safari 打开 →「分享」→「添加到主屏幕」 |
| 桌面图标 | 有 | 有 |
| 打开后 | 全屏 APP | 全屏，没有浏览器地址栏 |
| 新订单 / 状态变化 | APP 在后台时弹系统通知 | 打开时页面内提醒 |

### 4.1 打包安卓 APP（GitHub Actions）

不用装 Android Studio，GitHub 会在云端打包：

1. 把整个项目上传到你的 GitHub 仓库，**包括 `.github` 和 `android` 两个文件夹**（`data` 文件夹不要传，里面有客户信息）。
   在 GitHub 网页上传时，`.github` 是以点开头的文件夹，电脑可能默认隐藏，要显示隐藏文件后再拖进去。也可以在 GitHub 上点 Add file → Create new file，文件名填 `.github/workflows/android.yml`，把内容粘贴进去。
2. 在 GitHub 上打开 `android/app-config.properties`，点铅笔图标编辑，把 `SERVER_URL` 改成你的服务器地址（例如 `http://123.45.67.89:3000`），提交。
3. 提交后会自动开始打包，在仓库的 **Actions** 页面能看到「打包安卓 APP」，大约 3～5 分钟。
   也可以在 Actions → 打包安卓 APP → **Run workflow**，临时填一个服务器地址来打包。
4. 打包完成后，点进这次运行，页面底部 **Artifacts** 里下载 `snack-apk-序号.zip`，解压得到两个文件：
   - `snack-customer.apk`：客户版「零食预订」，打开就是店铺首页
   - `snack-merchant.apk`：商家版「商家后台」，打开就是商家登录页
5. 用商家账号登录，在「店铺」页的 **手机 APP** 里分别上传这两个 APK。之后客户打开下载页就能下载。

> 还没有服务器也可以先打包：不改 `SERVER_URL` 的话，APK 照样生成，第一次打开 APP 时会弹窗让你输入店铺地址（比如在自己电脑上运行时窗口里显示的 `http://192.168.x.x:3000`）。

**安卓 APP 的细节**

- 每次打包的版本号自动加 1，新版 APK 可以直接覆盖安装旧版，数据不丢
- 服务器地址变了：APP 连不上时会弹窗，点「修改地址」填新地址即可；也可以改配置重新打包
- 支持 `http://` 地址，测试阶段不用先配 HTTPS
- 商家版打开时屏幕保持常亮；APP 退到后台时，新订单会弹系统通知（第一次打开要允许通知）。APP 被划掉、或手机长时间锁屏后系统可能停掉它，这时收不到通知，重新打开会自动刷新，不会漏单
- 客户版在后台时，预订状态变化（接单、备好、拒单）也会弹通知
- 选商品图片走手机相册；点电话号码会打开拨号

**签名**：默认用项目里的 `android/app/snack-shared.keystore` 签名，保证每次打的包能互相覆盖安装。如果仓库是公开的，别人也能拿到这个文件。正式发给很多人用之前，建议换成你自己的签名：

```bash
# 在装了 Java 的电脑上生成一次，自己保存好，丢了以后就不能覆盖升级了
keytool -genkeypair -keystore my.keystore -alias snack -keyalg RSA -keysize 2048 -validity 10000
# 转成文字
base64 -w0 my.keystore > my.keystore.txt     # Mac 用：base64 -i my.keystore -o my.keystore.txt
```

在 GitHub 仓库 Settings → Secrets and variables → Actions 里添加 4 个 Secret：
`ANDROID_KEYSTORE_BASE64`（my.keystore.txt 的内容）、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`（上面是 snack）、`ANDROID_KEY_PASSWORD`。之后打包会自动用你的签名。换签名后，手机上要先卸载旧版再装新版。

### 4.2 苹果手机

苹果手机不能安装下载来的安装包。下载页会一步步教客户：用 Safari 打开店铺 → 点底部「分享」→「添加到主屏幕」。桌面上会出现店铺图标，点开是全屏的，用起来和 APP 一样。商家同理，添加 `/admin`。

如果以后想做成 App Store 里能搜到的真正 iOS APP，需要：

- 加入苹果开发者计划（Apple Developer Program），每年 99 美元，注册时会显示人民币价格；个人可以注册，未成年人需要家长用自己的 Apple 账户注册
- 在中国大陆的 App Store 上架新 APP，需要填写 APP 的 ICP 备案号
- 通过苹果审核。只是套一层网页的 APP 审核比较严格，可能需要加一些原生功能

准备好开发者账号后，可以再加一个用 GitHub 的 macOS 云端打包 iOS 版本的流程。

### 4.3 不装 APP 也能用

不想装的话，直接用浏览器打开就行，功能完全一样。安卓浏览器菜单里的「添加到主屏幕」也能把网页放到桌面。配好 HTTPS 后，商家在浏览器里也能开启系统通知。

**商家端提醒**：新订单到达时会响铃、振动，并在顶部显示黄色提醒条；没处理的话每 30 秒再响一次（最多 10 次）。重新打开页面时会自动刷新，不会漏单。

## 5. 配置项

写在 `.env` 文件或环境变量里，全部可选：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `data` | 数据库和图片存放目录 |
| `SHOP_TIMEZONE` | `Asia/Shanghai` | 店铺时区，决定“今天”和订单号日期 |
| `ADMIN_USERNAME` | `admin` | 首次启动创建的商家账号 |
| `ADMIN_PASSWORD` | 空（随机生成） | 首次启动的商家密码，至少 8 位 |
| `SEED_DEMO` | `true` | 首次启动是否写入示例商品 |
| `TRUST_PROXY` | `false` | 在 Nginx 后面时设为 `true` |

## 6. 命令行工具与备份

在项目目录运行（Docker 部署时在前面加 `docker compose exec snack`）：

```bash
node server/cli.js create-admin 用户名 密码       # 新建商家账号（比如店员）
node server/cli.js reset-password admin 新密码    # 忘记密码时重置
node server/cli.js list-admins                    # 查看商家账号
node server/cli.js clear-demo                     # 删除示例数据
node server/cli.js clear-orders --yes             # 删除全部订单（上线前清测试单）
node server/cli.js backup                         # 备份数据库到 data/backups
```

**备份**：运行 `backup` 会生成一个完整的数据库副本（服务运行中也能备份）。商品图片在 `data/uploads`，一起复制保存。最简单的做法是定期把整个 `data` 文件夹复制一份。

> `data` 文件夹里有客户的联系方式，不要上传到 GitHub（`.gitignore` 已经排除了它）。

## 7. 业务规则

**订单状态**

```
待商家确认 ──接单──▶ 备货中 ──备货完成──▶ 待取货 ──核对取货码──▶ 已完成
    │                   │                     │
    ├─客户取消─▶ 已取消  └──商家取消（填原因）──┴─▶ 已取消
    └─商家拒单（填原因）─▶ 已拒绝
```

- “已完成”只表示客户已取货，**不代表 APP 收了钱**，钱在店里当面收
- 商家接单前客户可以自己取消；接单后只能联系商家，由商家取消
- 完成取货必须输入客户出示的取货码，输错会被拦下
- 订单里的商品和金额**没有修改入口**。缺货或要换商品，商家先联系客户；客户同意的话取消这单，请客户重新下

### 付款（收款码，可选）

APP 没有接入微信支付接口（那需要营业执照申请商户号），所以采用“扫商家收款码 + 商家人工核对”：

```
未付款 ──客户扫码后点「我已付款」──▶ 客户说已付款 ──商家查到，点「确认已收款」──▶ 已收款
  ▲                                     │
  └──────────商家点「没收到」（写说明）───┘
未付款 ──商家点「标记已收款」（当面 / 微信 / 支付宝）──▶ 已收款
已付款的订单被拒单或取消 ──▶ 待退款 ──商家把钱转回去后点「已退款」──▶ 已退款
```

- 付款是可选的：不付也能下单、接单、取货。“已完成”只表示取货完成，跟有没有收钱是两回事
- 客户付款时备注取货码，商家在收款记录里按取货码核对
- 客户点了「我已付款」不代表钱一定到了，以商家在微信 / 支付宝里看到的为准
- 商家完成取货时，如果这单还没记收款，会问一句“收到了吗”，方便对账
- 退款需要商家自己在微信 / 支付宝里转回给客户，APP 只记录“已退款”
- 商家端概览会提示“几笔客户说已付款等你核对”“几笔需要退款”

**价格与库存**（全部由服务器校验，不依赖页面）

- 提交预订时服务器重新核对每件商品的价格和库存
- 客户确认页打开后如果商家改了价：页面会实时提示新价格；即使没收到提示，提交时服务器发现价格不一致也会拒绝，并让客户确认新价格后再提交
- 提交成功立即**预留库存**；取消、拒单后自动**退回库存**（只退一次）
- 多人同时下单不会超卖（数据库事务串行处理，测试里 12 个人抢 5 件，正好成功 5 单）
- 订单保存下单时的商品名称和单价，之后改价、改名、删除商品都不影响旧订单
- 库存留空表示不限量
- 同一次提交带唯一编号，连点或网络重试只会生成一笔订单
- 网络出错时页面明确提示“没有确认提交成功”，不会显示成成功；再点一次提交是安全的

**权限**

- 客户第一次打开时自动获得一个匿名身份（存在手机浏览器里），只能看到自己的订单；访问别人的订单一律显示“找不到”
- 商家接口必须用商家账号登录，客户身份无法调用；商家账号只能用命令行或首次启动创建，页面上没有注册入口
- 客户联系方式只出现在商家接口里
- 换手机时，客户在「我的预订」页复制恢复码，到新手机上粘贴即可找回订单

**示例数据**：示例商品、示例分类、包含示例商品的订单都带 `is_demo = 1` 标记，可在商家端或命令行一键删除。

## 8. 数据库结构

完整建表语句见 [`server/schema.sql`](server/schema.sql)（带中文注释，服务启动时自动执行）。

| 表 | 内容 |
| --- | --- |
| `shops` | 店铺信息、接单开关、取货时段、提前预订时间、收款码 |
| `admins` / `admin_sessions` | 商家账号（密码用 scrypt 加盐哈希）和登录会话 |
| `customers` | 客户匿名身份（只存令牌哈希）、上次填写的取货人 |
| `categories` | 商品分类 |
| `products` | 商品；`status` 为在售 / 售罄 / 下架；删除是软删除 |
| `product_specs` | 规格、价格（分）、库存（NULL = 不限） |
| `orders` | 订单、取货码、取货时间、状态、拒单/取消原因、付款状态 |
| `order_items` | 订单明细，保存下单时的名称和单价快照 |
| `order_events` | 订单状态变更记录 |
| `counters` | 按天递增的订单号 |

金额一律以“分”为单位的整数保存。所有表都有 `shop_id`，为以后扩展多家店预留。

从旧版本升级时不用做任何操作：启动时会自动给旧数据库补上新字段，原有商品和订单不受影响。

## 9. 接口一览

客户接口带 `Authorization: Bearer <客户令牌>`，商家接口带商家登录令牌。出错时返回 `{ code, message }`，`message` 是可以直接给用户看的中文。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/customer/session` | 创建客户匿名身份 |
| GET | `/api/shop` | 店铺信息和可选取货时段 |
| GET | `/api/catalog` | 分类和在售商品 |
| POST | `/api/cart/quote` | 按最新价格和库存核算购物车 |
| POST | `/api/orders` | 提交预订 |
| GET | `/api/orders`、`/api/orders/:id` | 我的预订 |
| POST | `/api/orders/:id/cancel` | 客户取消（仅待确认） |
| POST | `/api/orders/:id/paid` | 客户：我已付款（`method`: wechat / alipay） |
| GET | `/api/events?token=` | 客户实时推送 |
| POST | `/api/admin/login`、`/logout`、`/password` | 商家登录、退出、改密码 |
| GET | `/api/admin/overview` | 经营概览 |
| GET | `/api/admin/orders?status=&q=&pay=` | 订单列表与搜索；`pay=claimed` 待核对付款，`pay=refund` 待退款 |
| POST | `/api/admin/orders/:id/accept`、`ready`、`complete`、`reject`、`cancel` | 订单操作 |
| POST | `/api/admin/orders/:id/payment` | 商家：`action` = confirm 确认收款 / reject 没收到 / mark_paid 标记已收款 / refund 已退款 |
| GET | `/api/admin/pickup/:code` | 按取货码查找 |
| GET | `/api/admin/prep?date=&slot=` | 备货汇总 |
| GET/POST/PUT/DELETE | `/api/admin/products…`、`/api/admin/categories…` | 商品与分类管理 |
| POST | `/api/admin/uploads` | 上传图片 |
| GET/PUT | `/api/admin/shop`，POST `/api/admin/shop/accepting` | 店铺设置、暂停/恢复接单 |
| POST | `/api/admin/demo/clear` | 删除示例数据 |
| GET | `/api/app-downloads` | 安卓安装包是否已上传 |
| POST/DELETE | `/api/admin/apps/customer`、`/merchant` | 上传、删除安卓安装包 |
| GET | `/api/admin/events?token=` | 商家实时推送 |

## 10. 测试

```bash
npm test
```

会在临时目录启动一个独立服务（不影响正式数据），自动验证：

1. 商家新增商品，客户能看到
2. 两位客户分别下单，商家能区分每个人要什么（含备货汇总、搜索）
3. 接单、备货完成，客户实时收到状态变化
4. 用取货码核对并完成订单（输错会被拒）
5. 不付款也能走完全流程
6. 改价不影响旧订单；取消、拒单、商家取消都正确退回库存
7. 客户看不到别人的订单，也调用不了商家接口
8. 收款码付款：客户标记已付款、商家确认 / 没收到 / 当面收款、拒单后待退款，以及权限隔离

另外还测了：并发下单防超卖、重复提交只生成一笔、暂停接单、取货时段校验、删除商品后旧订单完整。

`test/e2e-browser.py` 是浏览器端到端测试：一个商家加三位客户，各用一台模拟手机把上面的流程在真实页面上点一遍（含新订单提醒、实时状态变化、确认页价格变化提示、断网提示），用法写在文件开头。

## 11. 代码结构

```
server/
  server.js     启动入口
  app.js        全部接口
  orders.js     下单、库存预留/释放、状态流转、备货汇总
  catalog.js    商品、规格、分类
  shop.js       店铺设置、取货时段计算
  auth.js       客户匿名身份、商家登录
  events.js     实时推送
  demo.js       示例数据与清理
  apps.js       安卓安装包上传与下载
  cli.js        命令行工具
  schema.sql    数据库结构
public/
  index.html + js/customer.js + css/customer.css   客户端
  admin.html + js/admin.js + css/admin.css         商家端
  download.html + js/download.js                   下载页
  js/lib.js, css/app.css                           公共部分
  demo/         示例商品图片
android/             安卓 APP 工程（客户版、商家版两个 APK）
.github/workflows/android.yml  GitHub Actions 打包安卓 APP
test/api.test.js     接口自动化测试
test/e2e-browser.py  浏览器端到端测试
docs/screenshots/    界面截图
```

前端没有用任何框架和构建工具，改完文件刷新页面就生效。

## 12. 已知限制

- 客户身份存在手机浏览器里，清理浏览器数据前需要先复制恢复码，否则只能找商家查订单
- 商家端的响铃需要页面开着；安卓 APP 在后台能弹通知，但 APP 被系统停掉后就收不到
- 苹果手机目前用“添加到主屏幕”，没有 App Store 版本
- 第一版只支持一家店；数据表已预留 `shop_id`
- 没有短信/微信通知；客户在浏览器里需要打开「我的预订」查看状态（页面开着时会实时更新），安卓 APP 在后台时会弹通知
