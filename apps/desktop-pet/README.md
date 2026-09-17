# Trace Harness Plugin · Web + 原生桌面

同一套 Trace 体验有两个本机入口：DeepSeek Harness Web profile 插件，以及独立运行的原生桌面悬浮插件。原生 Electron 入口通过受限 IPC 连接本机 `trace-runtime`，把最新 Trace Web 中准备好的工作真正交给 Codex，并把结果带回 Trace 复核区。

## Windows 桌面端 0.1.11

始终从 [Trace Desktop 最新 Release](https://github.com/Tracehackthon/traceweb/releases/latest) 下载；不要保存或传播带固定旧版本号的安装包链接。

首版 Windows x64 安装包把 Trace Web、桌宠和本机 Runtime 一起打包。普通用户不需要先克隆 `trace_backend`、安装 Node.js 或手动启动服务：安装后打开 Trace，会同时出现桌宠与主界面。

首次接入 Codex：

1. 先安装并登录 Codex CLI。
2. 打开 Trace，点顶部的「Codex 设置」。
3. 点「更换项目」选择要工作的项目文件夹；绝对路径只保存在本机，不会显示在页面里。
4. 点「检查 Codex」。显示“已登录并通过检查”后，即可在工作页把内容交给 Codex，并让结果回到 Trace 复核。
5. 需要从 Codex 内主动读取 Trace 时，再点「在 Codex 中使用 Trace」安装可选插件；这不是 Trace → Codex 工作链路的前置条件。

本机 Runtime 会把状态保存在应用数据目录。知乎公开搜索和个人账号授权连接 `https://trace.neutrom.store` 的同源服务，不会把 App Secret 打进安装包。点「授权连接知乎」后，Trace 会打开一个独立的知乎授权窗口；成功回到 Trace 后窗口自动关闭，Token 只保存在桌面应用的加密 HttpOnly Cookie 中。服务不可用时界面只显示清楚的用户提示，不暴露内部接口字段。

构建安装包：

```powershell
npm ci
npm run dist:win
```

产物位于 `release/Trace-Desktop-<version>-Setup.exe`。0.1.11 尚未进行 Windows 代码签名，系统可能显示未知发布者提示。

发布前必须从干净的 `trace-runtime` checkout 重新 stage；脚本会把 Runtime 的版本、commit/tree、内容摘要、API surface 和 Codex host compatibility 写入 `runtime-dist/desktop-runtime-source.json`，并校验 `runtime.json` 与 `release-manifest.json` 的逐文件 SHA-256。正式 staging 默认拒绝 dirty/development Runtime；本地调试若确实需要，可显式使用 `TRACE_DESKTOP_RUNTIME_MODE=development`，该产物会保持 `development-dirty`，不能作为 Release 上传。

可重放检查（不构建、不上传）：

```powershell
# 检查已解包目录中的 Electron、桌面 UI 和 Runtime manifest
npm run release:smoke -- --unpacked apps/desktop-pet/release/win-unpacked --expected-version 0.1.11

# 输出安装包或目录的 SHA-256 清单；目录摘要按稳定路径顺序计算
npm run release:checksum -- --artifact apps/desktop-pet/release/Trace-Desktop-0.1.11-Setup.exe

# 工具自身的离线回归
npm run test:release-tools
```

`release:smoke` 只把 `--allow-development` 作为明确的本地调试例外；默认拒绝非 `release-ready` identity。上传前还应保留命令输出与安装包 SHA-256，避免把旧版本或未验证的解包目录当成当前 Release。

## 本地构建

```powershell
npm install
npm run build
```

构建会生成 `lib/index.js`（宿主入口）和 `lib/client.js`（Harness 浏览器模块加载器格式）。

同时生成 `lib/desktop/`：Electron 原生入口、透明桌面 Overlay，以及从 `apps/web` 现场编译的最新 Trace Web。桌宠不再复制不可直接运行的 TSX 源文件，也不会携带一份与正式 Web 分叉的旧页面。

## 安装到 Web profile

从 `traceweb` 仓库根目录执行：

```powershell
dsh plugin --profile web add .\apps\desktop-pet
```

重启或重新启动 Harness Web 后，右下角可以打开 Trace V1。

## 运行原生桌面插件

```powershell
npm ci
npm run desktop
```

运行后，刘看山以透明、无边框、置顶的桌面 Overlay 出现在主显示器工作区。透明区域不阻挡其他应用；点刘看山后，卡片与面板在当前桌面展开。系统托盘菜单可以显示、隐藏或退出插件。

“继续讨论”会打开插件内置的 Trace Web，不要求另行启动 Web 开发服务器。Renderer 开启 `contextIsolation` 与 sandbox，不直接获得 Node 权限；只有 preload 暴露的白名单能力可以访问本机 Runtime。

### 连接本机能力

先按 `trace_backend` 的 Runtime 文档启动产品、知乎和 Agent 模块。桌宠默认连接：

```text
http://127.0.0.1:4173
```

需要改本机端口时，在启动桌宠前设置 `TRACE_BACKEND_ORIGIN`。为避免把本机 Codex、用户内容或密钥暴露给远程页面，这个值只接受 `127.0.0.1`、`localhost` 或 `::1` 的 HTTP origin。

桌宠会从启动位置向上寻找最近的 `.git`，自动识别当前项目。需要固定到另一个项目时可显式设置 `TRACE_PROJECT_DIR`。绝对路径只会通过本机 IPC 送给 Runtime，不会进入页面、工作卡片或返回给 Renderer。

连接后面板会分别显示：

- 知乎搜索／全网搜索：调用 Trace 同源服务的 `/api/search/*`，返回公开摘要与原文链接；用户点击后才保留为当前会话观察，密钥不进入本机安装包。
- Agent 执行器：读取 `/api/agent/capabilities` 的安全 profile 描述，不接收浏览器提交的 endpoint、model、cwd 或 secret。
- Agent 运行：先通过 `/api/product/commands` 保存原话，再创建 `/api/agent/runs`；结果保持为未采纳候选，点击「保留为观察」才进入桌宠当前会话。
- Trace Web 工作交接：页面只提交工作 ID、事项 ID、原话、任务和本次使用方式；Bridge 自动补齐当前项目位置，依次调用 `product/commands → product/codex/receive → agent/runs → product/codex/return`，最后只把事实、解释、待确认项和建议理解送回页面。

### 验证一次完整工作链路

1. 从项目目录启动 `trace-runtime`，并启用一个 `kind: codex` 的 Agent profile。
2. 在同一项目目录运行 `npm run desktop`。
3. 在 Trace 首页写下原话，Agent 下拉选择「Codex 原生」，保存后进入「带去工作」。
4. 页面会显示“当前项目已自动识别”，但不会显示项目绝对路径；填写任务后点击「交给 Codex」。
5. Codex 完成后，Trace 自动进入工作结果页。事实、解释和仍需确认内容先处于复核状态，不会自动改写“我的理解”。

相同 `workId` 的重试会优先读取已返回结果；Bridge 不会因页面重开而重复创建另一份工作。

## 当前范围

- 刘看山悬浮入口与展开/收起，Web 与原生桌面复用同一组件
- 先接住面板：当前会话记录、继续讨论提示
- 本机 Runtime 的知乎／全网公开搜索
- 本机 Runtime 的 Codex、受限模型和自定义 Agent profile
- 当前项目自动识别、Codex 上下文交付与结果回收
- 三条历史观察卡片
- 五类节点的静态非线性思考图
- 候选判断的采用/暂存/拒绝内存操作

桌宠观察列表本身仍是进程内会话状态；模拟语音、图片识别文案、图谱拖拽缩放、安装包签名与自动更新尚未实现。后端产品事项、Codex 交付和 Agent run 由 `trace-runtime` 持久化，但返回结果不会伪装成已经修改用户理解。当前原生入口先验证 Windows 桌面交互，尚未完成 macOS / Linux 验证，也没有接管系统开机启动。
