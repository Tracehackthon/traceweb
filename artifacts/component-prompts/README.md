# 用户组件素材接入

日期：2026-11-01。用户明确选择保留玻璃、黏液视觉，并调整对应规范。不是 Prompt 能力发布，也不改变 Agent 的权限或真实连接状态。

## 分类与唯一来源

| 类型 | 保存的原文 | SHA-256 | 接入 |
| --- | --- | --- | --- |
| 搜索／形变 | `sources/gooey-input.txt` | `b78969a396a8e5fb8be5e338339258ea1a4e8468fc1da7a1536129fc4533adb1` | 顶栏 `GooeySearch`：SVG 黏连表面、分离搜索圆泡、展开输入；Enter 接现有内容搜索 |
| 按钮／材质 | `sources/liquid-glass-button.txt` | `c7a18ef0c4b55a78ac6be70a7849dc1c8590665663e5fcb8e26976b728731434` | `LiquidButton`：玻璃折射、内高光、原生按钮；开始画布、保存表达／能力、保存任务准备、保存设置等现有主操作 |
| 协作／多行输入 | `sources/ai-prompt-box.txt` | `c2f47e3b6eeff8cbb9d78bae4dbf71d1517c52886a19a8a920a015c57f73e981` | 现有 `ThinkingComposer`：圆角输入表面、底部操作、多行自适应、金属渐变提交；保留历史与可靠保存 |

5份附件中最后3份逐字节相同（AI Prompt Box），项目只保存1份。上游原文与派生代码分离，不执行原文中自动安装或填入 Unsplash 的通用指令。

## 与原文不同的地方

- 现有工程是 React + TypeScript + CSS/Radix token，不为3个组件强行迁移到 Tailwind/shadcn。未新增依赖；黏液使用 SVG + CSS，不引入第二套 Motion。
- Gooey 只过滤装饰表面，不模糊文字和焦点。修复原文 button 嵌套 input、无可访问名称、收起清空查询等问题；Esc保留查询并返回触发器。键盘与减少动态模式即时切换；指针展开采用250ms形变，不照搬400ms弹簧。
- 玻璃保持来源中的 turbulence/displacement 参数，唯一 SVG id，原生 disabled/type 语义；背景提供不依赖折射的可读表面。金属用于讨论提交，不增加金／铜色业务状态。
- AI 输入框沿用真实讨论保存和最近50条输入历史，不复制另一份消息状态。原文的录音仅 console.log、停止按钮无真实取消；Search/Think/Canvas只是文本前缀。这些不接入，避免伪装为已连接功能。
- 附件导入继续走现有画布原件入口，不把原文的图片专用上传冒充完整的材料链路。无自动外链图片、无全局 paste/focus 样式污染。
- 保留当前浅深色、中文输入法、多行Enter、异步保存时新草稿保护；不是原演示页面逐像素克隆。

## 验证

在 `traceweb` 执行（PowerShell）：

```powershell
$env:VITE_TRACE_STORAGE='browser'
npm run build:web
$env:TRACE_EXPRESSIVE_RUN='your-new-run'
node scripts/expressive-controls-e2e.cjs
```

只测完整构建应用和隔离浏览器，核验真实 IndexedDB，不使用单元或孤立组件测试。报告、截图、初次失败保留在 `.test-results/component-prompts/`。桌面安装版、触屏实体机、Safari/Firefox未验证；SVG backdrop-filter不同浏览器可能仅使用CSS材质回退。素材未附独立授权文件，不将用户提供代码宣称为已核验的MIT上游发布物。

### 本轮结果

最终隔离浏览器运行 `browser-verified`：18项端到端检查全部通过，包含玻璃按钮真实提交能力修订、讨论消息权威存储唯一性、IME、输入历史、浅深色重载、窄屏和减少动态。报告：`.test-results/component-prompts/browser-verified/report.json`。构建日志：`build-browser-verified.log`。

过程不是首次全绿：初次使用了服务端存储构建而无API；随后修正脚本中的检索标签、讨论入口、刷新后重开讨论和主题设置方式。视觉复查另发现主题选择器覆盖玻璃文字颜色，已提高局部材质选择器优先级，并新增两种主题的实际文字颜色检查。此前失败和修复前截图保留为诊断证据，不作为当前验收截图。
