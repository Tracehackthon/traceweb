# Trace Web

Trace 的独立产品交付仓库：集中维护可由 Vercel 部署的 **Trace 产品交互介绍、完整 Web 应用、视频路由**，以及与它共享视觉和交互语言的 **Trace 桌宠**。

**在线应用：<https://trace.neutrom.store>**

**Windows 桌面版：只从 [GitHub Releases 最新版本](https://github.com/Tracehackthon/traceweb/releases/latest) 下载。** README 不固定旧版本号或旧安装包地址，避免拿到已经被替代的构建。

当前桌面发布线为 **0.1.11**。发布构建会从 sibling `trace-runtime` 生成带 source identity 的 Runtime，默认拒绝 dirty/development checkout；安装包、解包目录和 Runtime manifest 均需通过可重放的 smoke 与 SHA-256 检查后，才允许上传到 Releases。具体命令见 [`apps/desktop-pet/README.md`](apps/desktop-pet/README.md)。

- 产品交互介绍：<https://trace.neutrom.store/>
- 六个动作的完整演示数据：<https://trace.neutrom.store/app/demo>
- 个人浏览器空间：<https://trace.neutrom.store/app>
- 视频展示：<https://trace.neutrom.store/video>

Vercel 备用地址：<https://traceweb-neutronm.vercel.app>

> Web 正式构建使用浏览器本地存储；桌宠是 Electron 桌面程序，不能由 Vercel 在用户桌面直接运行。知乎 App Key、Access Secret 和 OAuth Token 只在服务端或加密 HttpOnly Cookie 中处理，不进入静态资源和安装包。

## 仓库内容

| 目录 | 交付物 | 运行方式 |
| --- | --- | --- |
| [`apps/web`](apps/web/) | Trace 产品介绍与浏览器应用，包含首页、事项、对照、理解、工作结果、知乎公开搜索、知乎授权入口和真实使用视频 | Vercel 静态页面 + 同源知乎网关；应用数据使用 IndexedDB |
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

开发服务器默认位于 `http://127.0.0.1:4186`。根地址先进入产品交互介绍；`/app/demo` 使用一套与个人空间隔离的完整演示数据，并展示通过知乎开放平台真实检索后缓存的公开来源摘要；`/app` 是当前浏览器的个人空间；`/video` 播放由当前 Trace 桌面端、桌宠、知乎公开检索与 Local Codex 结果回流录制的 41.7 秒真实使用视频。如需验证 Vercel 使用的浏览器存储版本：

```sh
npm test
npm run build:vercel
```

构建结果位于 `apps/web/dist-vercel`。

## 真实使用视频

视频工程位于 [`video/`](video/)，基于 Remotion 将真实本地使用过程中采集的关键状态编排为可复现的产品演示。发布产物固定输出到 `apps/web/public/video/`，因此 Vercel 部署后会直接出现在 `/video`：

```sh
npm run video:studio   # 预览与逐帧检查
npm run video:render   # 生成 trace-demo.mp4
npm run video:poster   # 生成播放器封面
```

录制画面中的桌面端、桌宠、知乎公开搜索结果和 Local Codex 返回内容均来自同一条已验证链路；无关桌面细节在进入发布素材前会被隐去。原始采集留在本地 `video-source/`，不会进入 Git。

## 已接入的来源与 Agent 能力

- 在个人空间首页保存原话时选择「知乎搜索」或「全网搜索」，Web 会在原话保存成功后调用同源 `/api/search/*`，显示知乎开放平台返回的标题、作者、公开摘要、赞同／评论数与原文链接。
- 搜索结果默认不写入事项。只有点击「保留到这件事」才保存来源、查询和获取时间；不会自动生成对照关系或改写“我的理解”。
- 选择 Codex 原生、Codex Harness 或自定义 Agent 会保存本次交接意图。普通网页不访问本机登录或密钥；桌宠通过受限 Electron IPC 连接 loopback `trace-runtime`，从服务端 profile 选择真正的 `codex` / `model` / `agent` 执行器。
- 桌宠的「查找来源」通过 `https://trace.neutrom.store` 的同源网关调用 `/api/search/zhihu` 或 `/api/search/global`，安装包不携带知乎密钥。知乎登录在独立的 Electron 授权窗口完成，授权 Cookie 留在桌面应用的隔离会话中。从最新 Trace Web 选择 Codex 时，Bridge 只把启动位置或已保存目录作为候选；候选通过 Trace descriptor、Git 仓库和 worktree 身份核验并由用户确认后，才会把当前原话和任务依次送入本机 `product/commands → product/codex/receive → agent/runs → product/codex/return`。
- 页面不会展示或接收项目绝对路径、cwd、endpoint、model、登录信息、密钥和上下文哈希。Codex 返回的事实、解释和待确认项先进入工作复核区，不会自动写成“我的理解”。相同工作可以在页面重开后接回，不会仅凭中间运行成功冒充最终交付完成。

启动本机能力后端的环境与 profile 以 [`trace_backend`](https://github.com/Tracehackthon/trace_backend) 的 Runtime 文档为准。开发模式使用同源 `http://127.0.0.1:4173`，打包版启动内置 Runtime 时由系统分配空闲 loopback 端口；也可用 `TRACE_BACKEND_ORIGIN` 显式指定 loopback HTTP origin。端口只是发现线索，Bridge 会先核验 `/api/runtime/identity` 的协议、服务、installation 与 workspace 身份，并在端口被另一实例复用时停止操作。

## 构建桌宠

桌宠使用独立依赖，不进入 Vercel 构建：

```sh
cd apps/desktop-pet
npm ci
npm run build
npm run desktop
```

桌宠会以透明、无边框、置顶的 Electron Overlay 运行；点击角色后可以展开 Trace 卡片与最新内置 Web，并在本机 Runtime 可用时显示知乎／全网搜索和 Agent profile。启动目录与已保存目录只生成待确认候选，不会因为最近的 `.git` 或同名目录而自动成为执行目标；用户明确配置的 `TRACE_PROJECT_DIR` 也必须通过 descriptor、仓库和 worktree 身份核验。项目路径只在本机主进程与 Runtime 之间传递，不进入 Renderer。

完整的桌宠构建、知乎授权、项目识别和 Codex 往返验证步骤见 [`apps/desktop-pet/README.md`](apps/desktop-pet/README.md)。当前没有安装包签名和自动更新；发布构建只通过 [Releases 最新版本页](https://github.com/Tracehackthon/traceweb/releases/latest) 对外提供，不把源码构建等同于可发布安装包。

## 数据边界

- 个人空间数据属于当前浏览器配置和当前 origin；清理网站数据可能删除本地内容。
- 完整演示使用刷新后重建的会话内存，不依赖 IndexedDB，也不会混入个人空间。事项状态、讨论、理解、工作和结果是合成演示；其中两份知乎来源是 2026-09-15 通过开放平台搜索取得的公开摘要快照，保留作者与原文链接。访客打开 Demo 不会重复联网、消耗额度，也不会把摘要冒充全文或用户理解。
- Preview、Vercel 默认域名和自定义域名拥有不同的浏览器存储空间。
- Vercel 版不连接 Trace 本机 SQLite。公开知乎／全网搜索与知乎 OAuth 由同源网关转发到独立服务；Codex 与自定义 Agent 只由桌宠连接本机 Runtime。知乎 OAuth 只负责“我的知乎内容”，回调固定为 `https://trace.neutrom.store/callback`。知乎授权不是 Trace 云账号，也不提供跨设备同步。
- 不提交 `.env*`、Token、数据库、`.vercel/`、构建目录和测试输出。

## 知乎授权服务

`server/trace-service.mjs` 与 `service-api/` 把 App Key、Access Secret、授权码与 OAuth Token 留在服务端；浏览器只得到授权状态和用户明确请求的少量资料。生产服务运行在受限 systemd 用户下，由 HTTPS 反向代理承接；Vercel 只将 `/callback`、`/api/search/*` 和 `/api/zhihu/*` 同源转发到该服务。服务端需要通过只读环境文件配置：

```text
ZHIHU_OAUTH_APP_ID=669
ZHIHU_OAUTH_APP_KEY=<server secret>
ZHIHU_OAUTH_REDIRECT_URI=https://trace.neutrom.store/callback
ZHIHU_ACCESS_SECRET=<server secret>
```

知乎活动页面登记的回调必须和上面的地址逐字一致。没有配置时，「个人与设置」会显示未配置状态，不会伪造登录成功或返回演示账号。运维文件、Secret 和部署主机状态不进入仓库。

## 来源与维护

本仓库的首个源码基线来自 `Tracehackthon/trace-portal` 的 Web 运行目录，以及 `trace_backend` 中已经验证的桌宠源码。历史生图过程、原型归档、验证日志和 ZIP 不进入本部署仓库。

对后端、知乎、Agent 和 Codex 接口的修改仍在 [`Tracehackthon/trace_backend`](https://github.com/Tracehackthon/trace_backend) 进行；这里保持为 Web 与桌宠的独立部署来源。
