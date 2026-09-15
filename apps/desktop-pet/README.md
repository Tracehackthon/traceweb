# Trace Harness Plugin · Web + 原生桌面

同一套 Trace Overlay 现在有两个入口：DeepSeek Harness Web profile 插件，以及独立运行的原生桌面悬浮插件。不构建 Harness 源码；原生 Electron 入口可以通过受限 IPC 连接本机 `trace-runtime`。

## 本地构建

```powershell
npm install
npm run build
```

构建会生成 `lib/index.js`（宿主入口）和 `lib/client.js`（Harness 浏览器模块加载器格式）。

同时生成 `lib/desktop/`：Electron 原生入口、透明桌面 Overlay，以及内置的深度讨论页。

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

“继续讨论”会打开插件内置的原生讨论窗口，不要求另行启动 `apps/desktop` 的 `4173` 开发服务。候选状态会回到悬浮插件中的对应观察。Renderer 开启 `contextIsolation` 与 sandbox，不直接获得 Node 权限。

### 连接本机能力

先按 `trace_backend` 的 Runtime 文档启动产品、知乎和 Agent 模块。桌宠默认连接：

```text
http://127.0.0.1:4173
```

需要改本机端口时，在启动桌宠前设置 `TRACE_BACKEND_ORIGIN`。为避免把本机 Codex、用户内容或密钥暴露给远程页面，这个值只接受 `127.0.0.1`、`localhost` 或 `::1` 的 HTTP origin。

连接后面板会分别显示：

- 知乎搜索／全网搜索：调用本机 `/api/search/*`，返回公开摘要与原文链接；用户点击后才保留为当前会话观察。
- Agent 执行器：读取 `/api/agent/capabilities` 的安全 profile 描述，不接收浏览器提交的 endpoint、model、cwd 或 secret。
- Agent 运行：先通过 `/api/product/commands` 保存原话，再创建 `/api/agent/runs`；结果保持为未采纳候选，点击「保留为观察」才进入桌宠当前会话。

## 当前范围

- 刘看山悬浮入口与展开/收起，Web 与原生桌面复用同一组件
- 先接住面板：当前会话记录、继续讨论提示
- 本机 Runtime 的知乎／全网公开搜索
- 本机 Runtime 的 Codex、受限模型和自定义 Agent profile
- 三条历史观察卡片
- 五类节点的静态非线性思考图
- 候选判断的采用/暂存/拒绝内存操作

桌宠观察列表本身仍是进程内会话状态；模拟语音、图片识别文案、图谱拖拽缩放、安装包签名与自动更新尚未实现。后端产品事项与 Agent run 由 `trace-runtime` 持久化，但“保留为观察”不会伪装成已经修改用户理解。当前原生入口先验证 Windows 桌面交互，尚未完成 macOS / Linux 验证，也没有接管系统开机启动。
