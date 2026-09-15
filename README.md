# Trace Web

Trace 的独立产品交付仓库：集中维护可由 Vercel 部署的 **Trace 产品交互介绍、完整 Web 应用、视频路由**，以及与它共享视觉和交互语言的 **Trace 桌宠**。

**在线应用：<https://trace.neutrom.store>**

- 产品交互介绍：<https://trace.neutrom.store/>
- 六个动作的完整演示数据：<https://trace.neutrom.store/app/demo>
- 个人浏览器空间：<https://trace.neutrom.store/app>
- 视频展示：<https://trace.neutrom.store/video>

Vercel 备用地址：<https://traceweb-neutronm.vercel.app>

> 这里不承载 Trace 后端、知乎密钥或用户数据库。Web 正式构建使用浏览器本地存储；桌宠是 Electron 桌面程序，不能由 Vercel 在用户桌面直接运行。

## 仓库内容

| 目录 | 交付物 | 运行方式 |
| --- | --- | --- |
| [`apps/web`](apps/web/) | Trace 产品介绍与浏览器应用，包含首页、事项、对照、理解、工作结果、知乎授权入口和预留视频页 | Vercel 静态页面 + 最小同源 Serverless OAuth；应用数据使用 IndexedDB |
| [`apps/desktop-pet`](apps/desktop-pet/) | Trace 原生桌宠与 DeepSeek Harness Web Overlay | 本机 Electron／Harness 插件构建 |

Web 与桌宠共用已经确认的刘看山、栖息鸟、起飞鸟、字体和交互素材，不从历史原型或构建目录取运行资源。

## Vercel 自动部署

仓库根目录的 [`vercel.json`](vercel.json) 是唯一部署入口：

```text
npm ci
→ npm test
→ npm run build:vercel
→ apps/web/dist-vercel
```

Vercel 项目 `neutronm/traceweb` 已通过原生 Git Integration 连接本仓库：

- push 到 `main` 自动生成 Production Deployment；
- 其它分支和 Pull Request 自动生成 Preview Deployment；
- 构建失败不会替换当前成功部署；
- Vercel 只发布 `apps/web/dist-vercel`，不会上传 SQLite、`.env`、桌宠源码构建目录或测试输出。

当前连接状态、线上验证和恢复步骤见 [Vercel 部署说明](docs/vercel-deployment.md)。

## 本地运行 Web

需要 Node.js 22：

```sh
npm ci
npm run dev
```

开发服务器默认位于 `http://127.0.0.1:4186`。根地址先进入产品交互介绍；`/app/demo` 使用一套与个人空间隔离的完整演示数据；`/app` 是当前浏览器的个人空间；`/video` 固定为视频展示地址。如需验证 Vercel 使用的浏览器存储版本：

```sh
npm test
npm run build:vercel
```

构建结果位于 `apps/web/dist-vercel`。

## 构建桌宠

桌宠使用独立依赖，不进入 Vercel 构建：

```sh
cd apps/desktop-pet
npm ci
npm run build
npm run desktop
```

桌宠会以透明、无边框、置顶的 Electron Overlay 运行；点击角色后可以展开 Trace 卡片与内置讨论页。当前没有安装包签名和自动更新，不把源码构建等同于可发布安装包。

## 数据边界

- 个人空间数据属于当前浏览器配置和当前 origin；清理网站数据可能删除本地内容。
- 完整演示使用独立 IndexedDB，不会混入个人空间；演示中的来源、讨论、理解、对照、工作与结果均明确标记为合成数据。
- Preview、Vercel 默认域名和自定义域名拥有不同的浏览器存储空间。
- Vercel 版不连接 Trace 本机 SQLite、Agent Runtime 或 Codex。仓库包含同源知乎 OAuth 与最小用户资料读取接口；只有部署平台配置后端 Secret、并把知乎回调登记为 `https://trace.neutrom.store/callback` 后才会启用。知乎授权不是 Trace 云账号，也不提供跨设备同步。
- 不提交 `.env*`、Token、数据库、`.vercel/`、构建目录和测试输出。

## 知乎授权部署配置

Serverless 接口把 App Key、Access Secret、授权码与 OAuth Token 留在后端；浏览器只得到授权状态和用户明确请求的少量资料。部署平台需要配置：

```text
ZHIHU_OAUTH_APP_ID=669
ZHIHU_OAUTH_APP_KEY=<Vercel Secret>
ZHIHU_OAUTH_REDIRECT_URI=https://trace.neutrom.store/callback
ZHIHU_ACCESS_SECRET=<Vercel Secret>
```

知乎活动页面登记的回调必须和上面的地址逐字一致。没有配置时，「个人与设置」会显示未配置状态，不会伪造登录成功或返回演示账号。

## 来源与维护

本仓库的首个源码基线来自 `Tracehackthon/trace-portal` 的 Web 运行目录，以及 `trace_backend` 中已经验证的桌宠源码。历史生图过程、原型归档、验证日志和 ZIP 不进入本部署仓库。

对后端、知乎、Agent 和 Codex 接口的修改仍在 [`Tracehackthon/trace_backend`](https://github.com/Tracehackthon/trace_backend) 进行；这里保持为 Web 与桌宠的独立部署来源。
