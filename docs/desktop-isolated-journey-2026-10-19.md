# Trace 桌面隔离试用｜2026-10-19

**对象与用途**：供维护者接续本次 Windows 桌面链路修复。这里的成功只表示**隔离运行的解包候选**可用手工结果完成 Product 内容闭环；不代表安装版发布、真实 Agent 执行、自动 Codex 回流或用户数据库恢复验收。

## 固定对象

| 对象 | 身份及边界 |
| --- | --- |
| 开始时的桌面源码 | `traceweb` `3ad1e28fa0bea5cb561c0bf40f17a87dd69c8e6e`；原 `main` 的 2 条未提交状态未触碰。本任务使用独立 `codex/desktop-user-journey` worktree。 |
| 原始 0.2.11 安装包 | `Trace-Desktop-0.2.11-Setup.exe` SHA-256 `32a7cf92a51f6c5842dfab7f7dde92cd2ccbc4313abf9154ad33b9ed87be0f48`；与本地 `latest.yml` SHA-512 相符。安装注册表和默认安装目录未发现已安装实例。仅提取并运行其 payload，**没有安装**。 |
| 安装包内 Runtime | `0.8.0`，源码 `a088b8658d76d1f825366fa8060712592b6460db`，源码内容 SHA-256 `3d41831375e2b54c44d788e6da1de701adf30b90394922bf98e91f1af37ed7b0`；不是 Runtime S1 分支。与已有 `release/win-unpacked` 的 630 个共有文件字节一致，只有 `release-manifest.json` 的 `created_at` 不同；安装包另外含 `app-update.yml`、`elevate.exe`。 |
| 最终修复候选 | 从本分支源码构建 Windows `dir` 包；`runtime-dist` 由上述原始安装包 payload 拷入，打包审计通过。最终重跑时的 `Trace.exe` SHA-256 `0e0b7bdf8bc82ea6db171c07f75583104075b8538d298aa9f0972ff545418cda`、`app.asar` `82dd654eaaef617d47f94acbe18e7a43d673738c60c441736dc564866f0ab28e` 见[重跑报告](../artifacts/desktop-isolated-journey-20261019/report.json)；这不是发布身份。 |

## 首次失败与修正

1. 直接从短生命周期命令管道启动 Electron 时，后台日志写入断开的 stdout，弹出 `EPIPE`。改用独立日志文件启动后未复现。**这是测试启动方式的干扰，不能据此宣称产品本身会在正常启动时崩溃。**故意将 `TRACE_CLOUD_ORIGIN` 设为 HTTP 也触发配置拒绝；改用无外部服务的 `https://127.0.0.1:1` 测试地址。
2. 原始安装包 payload 的内置 Runtime 没有 `/api/runtime/heartbeat`，实际 GET 为 `404`；桌面壳却用它做连通判据，反复重建本机 listener。修复为读取 `/api/product/workspace` 并校验协议、revision 和 storage；Agent 仍单独判定。原始测试进程的正常退出请求受反复恢复影响未及时结束，只对确认属于本任务的 PID 做了强制停止。
3. 原始界面把已保存的**理解**选入本次工作后，`work.run` 误要求它与事项**原话**相等，出现“同一事项已经保存了不同的原话，未覆盖”。修复为已有工作核对其 intake 文本，只有创建新工作时才检查原话冲突。
4. 初版候选在 Agent 关闭时仍显示“交给 Codex”，先写入 `codex/receive` 回执后才报“本机 Agent 尚未启用”，导致随后的手工结果首次保存遇到 revision `409`。按界面明确载入已保存版本、重填隔离草稿后保存成功。后续候选改为先检查 Agent 能力；不可用时显示“保存工作准备”，不派发、不制造 `received` 回执，并保留已识别的项目名称，以免以后启用 Agent 时出现项目身份不匹配。
5. Windows 主产品窗口原有深色系统标题栏。候选采用 Electron `titleBarStyle: hidden` + 浅色 `titleBarOverlay`、顶部 40px 拖动区，保留系统窗口控制。内容截图可见页面铺至顶边；**外层窗口控件的最终视觉和拖动体验尚待人工确认**，不以网页截图代替。

## 可重放验证

在独立 `traceweb` worktree 中，先用 `TRACE_RUNTIME_SOURCE` 指向干净的 Runtime `a088b865...` checkout，依[桌面打包脚本](../scripts/stage-desktop-runtime.mjs)和 [`runtime-contract.json`](../apps/desktop-pet/runtime-contract.json)生成 `runtime-dist`；不要从当前脏 Runtime 工作树重新打包。本轮本机实际使用了安装包中已核验的 `trace-runtime` payload。然后运行：

```powershell
node apps/desktop-pet/tests/run-tests.mjs
npm --prefix apps/desktop-pet run typecheck
npm --prefix apps/desktop-pet run build
node scripts/audit-desktop-package.mjs
Push-Location apps/desktop-pet
node node_modules/electron-builder/cli.js --win dir --x64
Pop-Location
node scripts/desktop-isolated-journey.mjs 'D:\your-isolated-output-directory'
```

最后一条要求输出目录**事先不存在**，会创建独立 `user-data`/`project`、关闭 Agent、把云地址限制为无服务的本机 HTTPS 地址；只启动并关闭自身生成的桌面进程，不访问真实用户库或模型。第一遍 smoke 的断言误将“没有 `codexDelivery` 字段”视为必须显式 `null`，保留失败目录；修正断言后从全新目录重跑通过。

本轮 `21/21` 桌面单测、TypeScript 检查、Vite 构建、Runtime/导入审计与 Windows `dir` 包均通过。Web 套件首次因两处旧测试仍假定 `/api/runtime/heartbeat`/旧请求顺序而 `170/173` 通过、2 失败、1 跳过；更新测试以覆盖实际兼容路径后 **172/173 通过、0 失败、1 跳过**。最终候选重跑 UI 从空库点击“留下一点 → 保存理解 → 保存工作准备 → 只留下结果”，停止后同路径重启：Product revision 在重启前后均为 **8**，事项 `matter-b048c586-bd06-4981-8b16-ff764ab5772f`、工作 `work-f9c2634e-8629-4fe4-a4fa-755cb0d9e285`、结果 `result:1` 均相同。原话、理解、手工结果在 `/api/product/workspace` 可读；工作未连接、`codexDelivery` 不存在，`agent.sqlite` 未创建。[机器可读报告](../artifacts/desktop-isolated-journey-20261019/report.json)及[结果界面](../artifacts/desktop-isolated-journey-20261019/result-ui.png)、[重启后界面](../artifacts/desktop-isolated-journey-20261019/after-restart.png)是此次**解包候选**证据。原始隔离数据仍留在 `D:\AGeneral Workspace\AI-powered\harness\.tmp\trace-desktop-journey-smoke-verified-20261019`，未清除。

## 未验证与下一步

- 未运行 Windows 安装器，也未证实远端发行或用户已安装副本；候选 `dir` 包不是发布物。
- Agent 关闭，**没有** `agent.sqlite`、Agent run、真实模型或自动 Codex 返回。手工结果不能冒充 Agent 回执；`codex/receive` 在旧候选的失败路径仅证明中间接收，不是最终执行成功。
- 没有使用真实用户数据；安装版双库备份/恢复仍须在 Runtime S1 被明确集成后另行验收。
- 需要对 Windows 外层浅色标题栏、拖动与最小化/最大化/关闭做人工目视确认，并由用户确认是否符合“不要黑框”的预期。
