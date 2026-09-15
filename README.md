# Trace Web

Trace 的独立产品交付仓库：集中维护可由 Vercel 部署的 **Trace Web 应用**，以及与它共享视觉和交互语言的 **Trace 桌宠**。

> 这里不承载 Trace 后端、知乎密钥或用户数据库。Web 正式构建使用浏览器本地存储；桌宠是 Electron 桌面程序，不能由 Vercel 在用户桌面直接运行。

## 仓库内容

| 目录 | 交付物 | 运行方式 |
| --- | --- | --- |
| [`apps/web`](apps/web/) | Trace 浏览器应用，包含首页、事项、对照、理解、工作结果，以及鸟形交互入口 | Vercel 静态部署；同一 origin 的 IndexedDB |
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

开发服务器默认位于 `http://127.0.0.1:4186`。如需验证 Vercel 使用的浏览器存储版本：

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

- Web 数据属于当前浏览器配置和当前 origin；清理网站数据可能删除本地内容。
- Preview、Vercel 默认域名和自定义域名拥有不同的浏览器存储空间。
- Vercel 静态版不连接 Trace 本机 SQLite、知乎 OAuth、Agent Runtime 或 Codex。
- 不提交 `.env*`、Token、数据库、`.vercel/`、构建目录和测试输出。

## 来源与维护

本仓库的首个源码基线来自 `Tracehackthon/trace-portal` 的 Web 运行目录，以及 `trace_backend` 中已经验证的桌宠源码。历史生图过程、原型归档、验证日志和 ZIP 不进入本部署仓库。

对后端、知乎、Agent 和 Codex 接口的修改仍在 [`Tracehackthon/trace_backend`](https://github.com/Tracehackthon/trace_backend) 进行；这里保持为 Web 与桌宠的独立部署来源。
