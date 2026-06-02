# 🚀 Beacon CM — Cloudflare Workers 边缘隧道 + 安全管控平台

基于 edgetunnel 深度二开，集成完整用户管理、流量追踪、D1 数据库与安全风控体系。

---

## ✨ 核心特性

| 模块 | 能力 |
|------|------|
| 🛡️ **协议支持** | VLESS、Trojan、Shadowsocks，深度集成加密传输 |
| 👥 **用户系统** | 注册/登录/UUID 授权，用户仪表盘，流量配额管理 |
| 📊 **管理面板** | 总览 / 用户管理 / 审计日志 / 注册管控 / 策略配置 五大模块 |
| 📈 **流量追踪** | D1 持久化用户流量统计，全站上行/下行/在线人数实时展示 |
| 💓 **在线人数** | 心跳机制——每 10s 写 D1+KV，35s 过期自动剔除，跨全球节点统一 |
| 🔄 **订阅系统** | 自动生成订阅地址，适配 Clash/Sing-box/Surge 等主流客户端 |
| 🎯 **风控防护** | 频率限制、IP 扩散检测、无效令牌封禁、流量超限自动停服 |
| 🗄️ **D1 数据库** | 用户管理已从 KV 迁移至 D1（KV 自动回退），性能大幅提升 |
| 🌐 **多端适配** | Windows、Android、iOS、macOS 及各种软路由固件 |

---

## 💡 后台预览

![后台总览](./img/overview.png) ![用户管理](./img/users.png) ![审计日志](./img/events.png) ![注册管控](./img/registration.png) ![策略配置](./img/config.png)

---

## 🚀 快速部署

### Workers 部署

1. 在 CF Worker 控制台创建 Worker，粘贴 [`_worker.js`](_worker.js)
2. 添加环境变量 **`ADMIN`**（管理员密码）
3. 绑定 **KV** 命名空间（变量名 `KV`）
4. 绑定 **D1** 数据库（变量名 `DB`，数据库名 `beacon-users`）
5. 执行 `schema.sql` 初始化表结构
6. （可选）绑定 **Durable Objects**（变量名 `STATESTORE`）提升大规模场景性能
7. 绑定自定义域名，访问 `/admin` 登录

### Pages + GitHub 部署（推荐）

1. Fork 本项目 + [Beacon-Pages.github.io](https://github.com/shuaidaoya/Beacon-Pages.github.io)
2. CF Pages 连接 Git → 部署 `Beacon-Pages.github.io` 仓库
3. 设置环境变量 `ADMIN`，绑定 `KV`、`D1`（`DB`）
4. Worker 端 `Pages静态页面` 指向 Pages 域名
5. 访问自定义域名 `/admin` 登录

---

## 🔑 环境变量

### 必需

| 变量 | 说明 |
|:---|:---|
| `ADMIN` | 管理员密码 |
| `UUID` | 节点 UUID（可选，不设则自动生成） |

### D1 数据库

| 绑定名 | 说明 |
|:---|:---|
| `DB` | D1 数据库绑定，用于用户管理、流量统计、在线心跳 |

### KV 命名空间

| 绑定名 | 说明 |
|:---|:---|
| `KV` | 用于配置存储、事件日志、注册日志等 |

---

## 🗄️ D1 数据库

用户管理已从 KV 迁移至 D1（KV 自动回退）。数据库表结构见 [`schema.sql`](schema.sql)。

### 迁移策略

- 首次部署：`CREATE TABLE IF NOT EXISTS` 创建基础表
- 新增列：`ALTER TABLE ADD COLUMN` + `try-catch` 忽略重复
- 不修改已有 `CREATE TABLE` 语句

### 表一览

| 表 | 用途 |
|:---|:---|
| `users` | 用户主表（17 列：UUID、流量、封禁状态等） |
| `global_traffic` | 全站流量累计（上行/下行字节） |
| `online_heartbeat` | 在线用户心跳（UUID + 最后心跳时间） |

---

## 📊 用户仪表盘

用户登录后跳转 `/user` 页面：

- 🌍 当前网络信息（国内/国外/CF/墙外四卡片）
- 📊 个人流量用量（已用 / 配额）
- 📡 全站流量统计（上行 / 下行）
- 👥 实时在线人数（10s 心跳刷新）
- 🔗 订阅链接一键复制

---

## 💓 在线人数心跳机制

Cloudflare Workers 全球多节点部署，跨节点统计的核心方案：

1. 每个活跃连接在 `connectStreams` 中启动 `setInterval(用户心跳, 10000)`
2. 每 10 秒向 D1 `online_heartbeat` 表写入 UUID + 时间戳
3. `/api/stats` 查询：`SELECT COUNT(*) WHERE last_beat > now-35s`
4. 连接断开后心跳自然停止，35 秒自动剔除，异常断开不留残留

---

## 🛡️ 安全后台

### API 端点

| 端点 | 方法 | 功能 |
|:---|:---:|:---|
| `/register` | GET | 注册/登录页面 |
| `/register/api` | POST | 用户注册 |
| `/register/login` | POST | 用户登录 |
| `/register/config` | GET | 注册配置（使用须知弹窗频率） |
| `/admin` | GET | 管理后台 |
| `/admin/system/*` | GET/POST | 安全管理 API |
| `/admin/system/users/traffic` | POST | 修改用户流量配额 |
| `/admin/system/tg-config` | GET/POST | TG 通知配置 |
| `/api/stats` | GET | 全站统计（流量+在线人数） |
| `/user` | GET | 用户仪表盘 |

### 安全配置项

| 配置 | 默认值 | 说明 |
|:---|:---:|:---|
| UUID 每秒 | 240 | 单 UUID 每秒请求上限 |
| IP 每小时 | 30000 | 单 IP 每小时请求上限 |
| 订阅每小时 | 6 | 每小时订阅拉取上限 |
| IP 扩散阈值 | 6 | 同用户不同 IP 数超限即封禁 |
| 无效令牌 | 4 | 无效令牌触发封禁阈值 |
| 基础封禁秒数 | 900 | 首次封禁时长 |
| 新用户默认流量 | 10 GB | 注册即送 |
| 使用须知弹窗 | 每次 | 可改为仅首次 |

---

## 🔧 订阅动态参数

```bash
# 自定义反代 IP
/?proxyip=proxyip.example.com

# SOCKS5 代理
/socks5=user:password@127.0.0.1:1080

# HTTP 代理
/http=user:password@127.0.0.1:8080
```

---

## 💻 客户端适配

| 平台 | 推荐客户端 |
|:---|:---|
| Windows | v2rayN, FlClash, Clash Verge Rev |
| Android | ClashMetaForAndroid, v2rayNG |
| iOS | Surge, Shadowrocket, Stash |
| macOS | FlClash, Clash Verge Rev, Surge |

---

## 🧪 测试

```bash
node --test tests/security.test.mjs
node scripts/security-smoke.mjs
```

---

## 🙏 鸣谢

- [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)
- [zizifn/edgetunnel](https://github.com/zizifn/edgetunnel)
- [6Kmfi6HP/EDtunnel](https://github.com/6Kmfi6HP/EDtunnel)

---

## ⚠️ 免责声明

本项目仅供教育、科学研究及个人安全测试之目的。使用者必须严格遵守所在地区的法律法规。
