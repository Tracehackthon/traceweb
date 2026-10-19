# 隔离桌面 Agent 回流证据（2026-10-19）

这些文件只含本任务创建的合成事项和临时项目，不含真实 Trace 用户库。全部来自 Windows `dir` 候选，不是安装器、已安装副本或发布验收。

- [`pre-fix-backend-report.json`](pre-fix-backend-report.json)：**UI 修正前**的一次真实本机 Codex run，`agent.sqlite` 的 run 为 `succeeded`，Product Workspace 的 `codexDelivery` / `codexReturns` 和待复核结果在同路径重启后保留。报告的 `status` 只指后端返回与重启；**当时 UI 并未成功显示结果**。
- 该旧报告的 `resultHash` 是运行中 `agent.sqlite` 文件的摘要，**不是** SQLite 在线备份、双库一致性或恢复验收证据。
- [`pre-fix-ui.png`](pre-fix-ui.png)：同次运行中页面用旧 revision 再写 `RESULT_DRAFT`，报“另一处已有更新”，仍显示“这项工作还未交给 Agent”。这是首次失败，不是验收截图。
- [`reopen-report.json`](reopen-report.json)、[`reopened-result-ui.png`](reopened-result-ui.png)：修正后以**同一已返回的隔离数据**重新打开候选；点击“结果已回来”后页面展示对应事实，Product revision 保持 `8`，没有第二次结果写入或模型调用。它验证重新接回路径，不等于从空库重新跑通自动回调。
- [`native-window.png`](native-window.png)：Windows `PrintWindow` 截取产品窗口，顶部已无原来的黑色系统栏；该方法未可靠呈现窗口控制按钮，最小化/最大化/关闭及拖动手感仍待人工确认。

最终候选（上述重新打开时）`Trace.exe` SHA-256 `67118970529d97844a1d96cef11795a63a0571aef13ca00662447d68ee7420a6`，`app.asar` SHA-256 `e3d6e6a7a441873158fa4d20b575cf7cb62d4e16e0b616758b0bcab84e3bd9f4`；内置 Runtime 仍来自 `a088b8658d76d1f825366fa8060712592b6460db`。原始隔离日志和数据库保留在总控工作区 `.tmp` 任务目录，不在 Git 中上传。

修正后尝试从**全新空库**再次运行真实 Codex：首次资格生成因 C: 无空间失败；在 D: 临时目录重试后曾发生 no-model `initialize` 超时；复用已成功的隔离资格记录后 `/api/agent/check` 返回 `CODEX_DISCONNECTED`。本机 C: 当时空闲空间为 `0`，CLI 也输出无法创建 PATH alias 的空间警告。**因此修正后完整自动回流尚未从空库重验，不得把重新打开成功代替该验收。**
