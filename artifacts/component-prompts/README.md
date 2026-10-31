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

## 2026-11-01 第二批：Halo 与组合式交互

本轮输入是聊天内16组Demo及7份附件；附件原文已归项目 `sources/`，逐份SHA-256见[来源清单](halo-sources.json)。聊天代码是本节逐项映射的依据，未伪造为可导入源码。附件中的模块导入也不证明被导入组件实现已提供，原文不是已核验的开源许可。没有安装Motion、Sonner、ReactPlayer、Tailwind或useMeasure。

### 复用矩阵与落点

| 来源（聊天名或附件文件） | 真正要学的模式 | Trace落点与处置 | 当前边界 |
| --- | --- | --- | --- |
| HaloSegmented / HaloToggleGroup | 一个受控value、items、onValueChange；选中表面与标签分离 | 详情栏目已接；协作记录类型现以Radix单选组接真实session/task计数，不允许取消成空选中 | 两份Demo形似，不据此认定内部实现或弹簧常数相同 |
| HaloTabs / DirectionAwareTabs | list/trigger/indicator/content组合；方向表达位置关系 | `DetailTabs`已接真实详情，复用现有Radix；普通详情切换不滑动正文 | 不是原组件弹簧/方向动画复刻；不搬min-w-96导致窄窗溢出 |
| BorderBeamInput | 输入、addon、容器分层；焦点可由容器反馈 | 可用于搜索/输入组；沿用已有Halo输入工作，不再造第二套 | 不增加常态绕边循环；真实label和焦点不依赖光束 |
| HaloBadge | 等宽数字、文本与状态点组合 | 已接能力状态/版本、引用数、尚未连接、未决/尚未采用、任务准备/取消；等宽数字 | live只代表真实活跃状态；不把装饰脉冲当连接证据 |
| HaloProgress | 已知/未知两种进度契约 | 已接能力版本真实保存的未知进度，等待期间禁重复提交；导入队列仍用原阶段反馈 | Demo每120ms加2不是上传进度，不接业务；Reset只重置演示不代表取消任务 |
| HaloNotification / halo-toast.txt | 局部通知与全局堆栈分离，status/alert、可关闭、稳定消息身份 | 能力保存与来源摘记已接持久局部HaloNotice，成功status、失败alert；既有全局恢复动作保留 | 不为演示另装Sonner；保存失败/未知不能只留易消失toast；messageKey不等于业务幂等 |
| GradientButtonGroup / BgAnimateButton | 共同动作组的边界、间距、选中层级 | 普通工具动作组吸收组织方式，不新增旋转渐变 | 连续spin-fast/spin/spin-slow不进入高频工作区 |
| MorphSurface | trigger→编辑→提交→成功的同一表面、受控/非受控API | 来源Annotation已接可展开表面，始终挂载原版本草稿，Esc返回触发器、IME期间不收起、折叠有预览 | 500ms延迟+console.log是假提交；错误保留输入，Esc/关闭返回焦点，不能按钮套表单 |
| MinimalCard | image/title/description插槽与安静内容层级 | 能力条目已接CapabilitySummary，真实用途摘要、状态/版本、当前项与键盘列表；不添加占位图 | map必须有稳定key；缺失basic-img不能上线；整卡链接不可嵌套按钮 |
| CutoutCard | media/content/footer/action与角部标记可组合 | 仅可选内容展示，未用于高频画布 | 缺角不能削命中区/焦点；动作不压作者和正文；无占位山景或演示作者 |
| OrganicCard / OrganicCardSmall | 大小信息卡共享媒体/标题/元信息；视觉与内容分离 | 能力详情/资料摘要可借层级，待适配 | 不把示例North、href、日期、Unsplash或固定背景色带入真实记录 |
| HaloCard | header/content/footer/action插槽，共享rim/focus-within | 能力编辑器与已保存任务准备已接HaloSurface；header/表单/动作/版本分层，不批量给普通列表套卡 | Halo视觉不意味着新增业务状态；局部材质不覆盖用户媒体 |
| HoverVideoPlayer / youtube-player.txt | 缩略图→明确播放、放大、关闭与回退 | 参考现有OriginalViewer/媒体定位链路；外部播放器未新增 | 不悬停有声自动播放；键盘/触摸需等价；Vimeo网页URL不等于原生video媒体URL |
| video-section.txt | 可控开合、尺寸测量、内容生命周期 | 原件预览/辅助面板的参考，当前保留既有实现 | 原文重复播放器；固定checkbox id冲突；0.65s高度动画和关闭卸载不直接采用 |
| wizard-expandable.txt | 步骤受控、导航门禁、阻止时聚焦首个错误、最终复核 | 分享/导入/任务带入的后续参考，不新增注册/套餐流程 | 后退/取消不能被前进校验锁住；中文不能按空格“三词”校验；仅setSubmitted不是持久化成功 |
| texture-card.txt | 标题/分隔/内容/动作的统一材质；表单分组 | 既有表单布局参考，保持单一业务表单 | 不复制Google/GitHub登录；type=first/last非业务字段类型规范；品牌来源单独核验 |
| shift-card.txt | 同一媒体跨局部位置，展开补充动作 | 可选摘要展开的参考，当前不替换材料节点 | hover不能是唯一入口；layoutId必须实例隔离；示例Twitter/Loom不是已接集成 |
| mock-browser-window.txt | 可配置窗口壳与内容解耦 | 仅文档/演示候选，不用于正式桌面/原件浏览 | 装饰地址栏不冒充真实Origin、安全状态或可导航浏览器 |

### 代码审阅后的取舍

| Before | After | Why |
| --- | --- | --- |
| 两个相似单选Demo再各造一套组件 | 详情选中方式收进一份`detail-tabs.tsx`，Radix负责焦点与ARIA | 复用已有依赖，value仍由真实Inspector持有 |
| 手工方向键、固定全局tab id | Radix roving focus、Arrow/Home/End、自动关联tabpanel | 不同实例不冲突，键盘只有一个Tab停靠点 |
| 固定最小384px、慢弹簧、正文进出场 | 等分minmax(0,1fr)、窄窗44px、立即切换 | 高频信息切换优先可读与速度，不用动效拖慢键盘 |
| 选中状态只有底部细线 | 12px外层/4px内缩/8px内控件，双主题表面+描边+字重 | 吸收Halo的层级，不叠旧underline，不以颜色作为唯一线索 |
| 定时百分比、模拟提交、示例Saved/Live | 只由权威回执/真实总量驱动；其余保留为演示 | 展示完成不等于业务完成 |

### 本轮实际应用与验证

- 已接：`apps/web/src/react/workbench/detail-tabs.tsx`、`detail-tabs.css`及Inspector调用。没有改后端、存储结构、正文内容、引用范围或安装版。
- 完整浏览器构建后，隔离空间执行 `node scripts/halo-tabs-e2e.cjs`。设置 `VITE_TRACE_STORAGE=browser` 后先 `npm run build:web`；每次以 `TRACE_HALO_TABS_RUN`指定新运行名。
- **重试通过：14项**，报告 `.test-results/component-prompts/halo-tabs-browser-verified/report.json`，包含真实创建/保存表达→鼠标/方向键/Home/End切栏→来源/正文→刷新恢复、ARIA连接、浅深色、390px/减少动态、44px目标和控制台。截图已目视复查。构建日志 `halo-build.log`。
- 首次失败：脚本在Radix异步聚焦后过早断言；改为等待选中态。首次重试在窄窗刷新后误点已被详情覆盖的卡片；改为使用已恢复的详情栏目，不强制点击。视觉复查删除旧tab伪元素underline。失败报告保留诊断，不当成当前验收。
- 未运行：Electron/安装版、实体触屏、物理IME和读屏、Safari/Firefox。其余矩阵项为已分析/待适配或明确不采用，不算已实现。存在其他工作中的Halo输入/导入文件，本轮不覆盖、不代其验收。


### 组件颜色与焦点适配（2026-11-01）

用户允许对素材颜色作局部适配，并拒绝突兀高亮。搜索反白黑改为低饱和蓝灰表面；讨论提交从绿改为墨蓝灰；玻璃表面、光标、文本选区、聚焦投影统一使用 `--trace-material-*` token。保留黏液/玻璃结构；搜索和讨论输入不再叠加亮绿外圈/5px光晕，用底色对比与有方向的色阴影反馈，按钮键盘焦点及强制颜色模式仍可辨。

验证：`node scripts/material-palette-e2e.cjs`（已运行环境 `TRACE_PALETTE_RUN=browser-final`，默认URL为当前4326预览），14项端到端重试通过。初次脚本在requestAnimationFrame移焦前即时断言，已改为等待真实焦点条件，不加入固定等待。浅/深色搜索文本对比度13.84/8.74，主操作最弱渐变端点6.86/7.50，均超过4.5:1。报告：`.test-results/component-prompts/focus-palette/browser-final/report.json`。未增加功能或模型调用，未验证安装版/实体触屏/其他浏览器。

### 后续真实界面接入（2026-11-01）

本轮不是展示页：新增`halo-surfaces.tsx/.css`的一组组件已接正式Workbench的能力库、协作工作区、来源详情及材料节点。上表已原位更新，不将之前“待适配”继续作为当前结论；先前14项结果只保留其历史范围。

| Before | After | Why |
| --- | --- | --- |
| 能力列表只有名称与两行元信息 | MinimalCard层级的原生列表按钮，展示真实用途、状态、版本和当前项 | 更快辨认用途；仍使用唯一内容对象，支持原键盘列表 |
| 能力表单无统一表面、保存仅一行文字 | HaloSurface分层、HaloNotice持久反馈、真实等待的HaloProgress | 真实回执才成功；错误为alert且保留草稿，不用计时模拟 |
| 两个独立协作切换按钮 | Radix非空单选组、已保存记录计数 | 同一项再次点击不会清空；保留讨论与任务状态，不造第二份列表 |
| 来源摘记总占编辑空间 | HaloAnnotationSurface展开/收起、预览、焦点返回 | 沿用版本草稿，收起不卸载；IME Escape不触发折叠 |
| 多处零散状态文字 | 能力发布/停用/恢复、任务准备/取消、未连接与引用计数共用徽标 | 颜色不替代文字；“准备”不能冒充交接、“未连接”不能冒充Live |

- 正式构建通过；新专项**36项重试通过**：[browser-accepted-final](../../.test-results/halo-real-ui/browser-accepted-final/report.json)。真实隔离存储中创建能力/材料/摘记/讨论/任务，核验保存、版本、发布/停用/恢复、准备/取消、刷新恢复、键盘、IME合成负例、390px和减少动态。首轮聚焦等待不足、测试错认Radix radio角色、第二条能力创建未等待完成、重试保存时过早读取均已修正；旧失败只作诊断，当前截图只引用browser-accepted-final。
- 有意故障：暂停真实命令哈希以检查保存中，不改变业务响应；能力和摘记各一次真实workspace写事务失败以检查保留、告警、原命令重试及只增加一个版本。它们是故障注入，不是自然故障或真实网络测试。
- 最终构建回归：详情14项、搜索/材质/讨论18项均通过。报告分别在`.test-results/component-prompts/halo-tabs-real-ui-accepted/`和`real-ui-accepted/`；范围交叠，不合计成全产品验收。
- 复放（工作目录`traceweb`）：`$env:VITE_TRACE_STORAGE='browser'; npm run build:web`，然后`$env:TRACE_HALO_REAL_RUN='fresh-run-name'; node scripts/halo-real-ui-e2e.cjs`。截图、报告与运行时存储快照都留项目`.test-results/halo-real-ui/`，不写C盘临时目录。
- 未新增依赖/演示页面/存储schema，也没有触碰安装版用户库。Electron、实体触屏、物理IME、读屏及Safari/Firefox未运行。其余矩阵项仍未接入，不将本轮UI复用冒充15组功能完成。
