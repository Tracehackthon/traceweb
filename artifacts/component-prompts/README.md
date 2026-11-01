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


### 全工作台无描边选中态（2026-11-01最新范围）

用户将要求扩展为整个当前工作台，不再只适配素材输入区。唯一状态入口`workbench-states.css`覆盖导航/最近对象/列表/详情Tab/分段/画布节点/表单/设置/菜单及弹窗；装饰框线透明，靠表面与可自定义色阴影表达选中，强制颜色模式保留系统焦点。`--trace-selection-tint`可覆盖状态色，真实运行已验证阴影变化而几何不变。协作记录补充真实aria-current，保留原状态链路。

最终当前构建：23项工作台状态E2E + 14项前轮配色回归通过；前者有重试（初次Radix自动激活等待、异步新建能力换节点及标题由textarea改input的脚本定位修正），最后按真实选中/字段条件等待，并核验两个能力修订实际存入IndexedDB。报告：`.test-results/workbench-shadow-states/browser-current/report.json`，配色回归：`.test-results/component-prompts/focus-palette/after-shadow-states/report.json`。不是完整15组功能验收，安装版/实体触屏/其他浏览器未运行。


### 常用动效接入（2026-11-01）

在无描边状态层之上补充指针按钮按下/释放、选中/悬停阴影层透明度、原生弹窗与遮罩进出、Radix菜单/工具提示原点进出、真实保存提示淡入/收起、真实pending图标与进度反馈。复用现有原语，只用CSS transform/opacity与原生WAAPI，没有新增动画依赖。键盘、IME、正文、画布相机/拖动不加装饰延迟；系统/产品减少动态同时生效且可中途结束动画。明确的指针关闭保留退出挂载，保存命令直接卸载不强行等待动画。

18项动效E2E首次通过（最终增加中途减少动态检查）；23项无描边、14项配色回归重试通过。回归脚本原先在关闭动画尚未结束、背景仍inert时fill，或在阴影opacity首帧即时断言；已改为等待实际隐藏/阴影条件，未用固定sleep掩盖。最终报告：`.test-results/workbench-motion/browser-current/report.json`、`.test-results/workbench-shadow-states/motion-current/report.json`、`.test-results/component-prompts/focus-palette/motion-current/report.json`。过程失败保留；视频：`.test-results/workbench-motion/browser-current/video/interaction.webm`。这些不是安装版或全部功能验收。


### 信息密度与任务下一步（2026-11-01，0.2.24）

| Before | After | Why |
| --- | --- | --- |
| 方法表单连续暴露提示、依据、示例空框 | 方法的补充信息用既有 HaloDisclosure；模板/指令正文仍直接可见 | 先完成核心内容，不把最重要的正文藏起来；折叠保持挂载和原保存 owner |
| 保存区尝试悬浮，遮住上方字段 | 保存/试用与真实回执回到文档流 | 不用“易达”换输入遮挡；窄窗通过真实滚动到达 |
| 保存准备与已有回执/执行解释混排 | 准备保存后明确“查看上次保存的任务”；新执行在先，旧回执另行展开 | 导航只指向最后保存项，既不保存新草稿，也不启动模型 |
| 重复长说明与工程修订编号常驻 | 原文/来源、保存位置用直接文案；页脚只显示内容保存状态和存储位置 | 必要限制保留在相关位置，修订信息留 title，不让内部实现抢过内容 |

固定边界：仍沿用 Halo 材质、现有排版/状态/动效尺度；不新造模拟完成或计时进度。表单折叠不卸载字段，不改变 expectedVersion、步骤/指令/refs 快照、执行权限或明确采纳链。共享提示文案变更时同步现有 E2E 定位，不能删掉保存/重启/失败恢复断言来换通过。

唯一交付与重放证据仍放总控任务 `docs/tasks/trace-frontend-replacement.md` 的 0.2.24 节；独立源/实际包身份见 `.test-results/workbench-visual-ux/accepted-identity.json`，不把本矩阵当业务验收。


### 业务上下文与主从切换（2026-11-01，0.2.25）

| Before | After | Why |
| --- | --- | --- |
| 外部任务页的加号仍新建共同思考 | 加号按当前类型分派：思考新建会话，外部任务只打开独立准备草稿 | 动作必须符合用户正在处理的业务，不误造另一类记录 |
| 选中任务仍先看到另一份长草稿 | 选择任务/搜索深链先展示已保存记录；准备表单收起但保持挂载 | 独立草稿与冻结任务不串写，返回后能继续输入 |
| 同内容重复保存可能生成重复任务 | 权威保存确认后按完整准备指纹阻止重复；上次保存项持久找回 | 按目标/步骤/指令/模板/引用判定，失败和未确认不能冒充已保存 |
| 窄窗常驻列表挤压编辑区域 | 767px及以下用同一列表的按需选择器，明确当前业务/对象与新建动作 | 不复制列表状态；选择、Esc、窗口改变要释放modal焦点，草稿归原owner |
| 任务范围只看到数量 | 从任务已保存refs打开准确引用版本，内容不可用时禁用 | 查看来源不改任务，也不静默换成当前版本 |

滚动固定：共同思考的正文、输入、保存与执行控制共享真实可滚动的内容流；不能用overflow:hidden把操作裁到主区之外。短窗验收必须用纯坐标滚轮到达输入和保存、真实写入并重载找回，不能由locator自动滚动代替。

视觉固定：选择器不重复展示页面大标题，新增动作在列表后明确出现；复用原生WorkbenchModal、HaloDisclosure、排版/状态与动效token。折叠失败表单后恢复入口移到可见工作台，再展开回原owner，任何时刻只有一个主要重试入口。不隐藏错误、模拟执行成功或以布局替代保存。

实现与真正验收分别记录在总控唯一任务0.2.25节，以及`.test-results/workbench-flow-polish/`的源/包身份、独立报告和实际安装重放；本段不是全产品完成声明。


### 长讨论与大量历史的查找和继续编辑（2026-11-01，0.2.26）

| Before | After | Why |
| --- | --- | --- |
| 同名讨论只能逐条滚，快捷历史只含最后50段 | HaloSearch/HaloSelect＋同一RecordBrowser过滤全部保存原话/任务步骤后分页；目录可查全部段落 | 先缩小目标，再定位，不把可滚动当作可找回 |
| 切换后只保留正文草稿，不知道读到哪里 | 逐讨论保存阅读锚点/查询/窗口/光标，选择器重开恢复自己的页和筛选 | 视图元数据不变成正文副本，也不写业务store |
| 旧原话直接填进输入，容易覆盖未保存文字 | 接入同一SessionComposer，明确追加/替换/取消；保存后才新增，原scope不改 | 沿用真实保存/恢复owner，不造第二条Demo协议 |
| 保存返回前离开再编辑，旧实例可能改写新稿落盘或抢回旧任务 | 卸载撤销旧owner写入/回调；任务只有当前准备仍打开且完整指纹没变时才自动选中 | 真实原请求照常确认，新草稿不自动保存或丢失 |
| 多词过滤正确、预览/打开却各挑不同段 | 共享正文片段选择；跨段命中明说并打开整条讨论 | 搜到、看到与打开必须同源，不能伪称精确段落 |

固定交互：正文窗口20段、目录50段/页、记录30条/页，检索覆盖全部保存对象后再分页；不编造“最近更新”时间。高频跳转/键盘即时，沿用Halo材质、输入、原生Modal、现有焦点和减少动态效果；定位目标与接续动作不能被sticky工具栏盖住。无需新动效/索引/虚拟列表依赖。

0.2.26已按source-06实际包完成新只读独立Review/EXE E2E和原3类迟到回执独立Browser重放后安装。Browser历史49及范围/引用/反馈/找回/材料/能力/业务分组、安装版历史40/业务22/错误恢复58/既有真实结果21各自通过，不累计为功能数。05多词P2、前期真实失败/驱动准备失败保留；原生286与Browser331产物绑定分开。23项应用自有文件在安装和隔离复验后、正常启动前逐项未变，旧0.2.25回退保留，无新模型turn。

精确源/包/安装身份、首失败和重放仍只看[唯一任务](../../../docs/tasks/trace-frontend-replacement.md#history-polish-current)与 `.test-results/workbench-history-polish/` 的accepted/installation/delivery回执。390是实际renderer viewport，不冒充880最小物理窗；多窗口、物理IME/读屏和完整跨入口Goal未据本轮签收。

<a id="short-window-reading"></a>

### 短窗阅读、查找与段落目录（2026-11-01）

| Before | After | Why |
| --- | --- | --- |
| 390短窗阅读工具栏112px，查找224px | 阅读单行60px、查找两行120px；前后20段移至正文页尾 | 阅读优先，保留44px目标，不靠缩小字/点击区省空间 |
| 清除与关闭都是X，关闭就丢搜索词 | 清除保留输入焦点；“完成”/Esc只收起，重开继续同词 | 行为不同就不能长得一样，减少重输和误清空 |
| 内联和目录重复查找，切换会重置页 | 点击匹配计数直达同词目录；普通目录独立保留查询/页/滚动 | 一次输入即可查找，临时内联词不破坏目录上下文 |
| 目录外层和列表一起滚，翻页/查找易失联 | 视口有界Modal，搜索/页码固定，唯一结果列表滚动 | 短窗也能纯滚轮和键盘找遍全部原话 |
| 查看后再找编辑，工具栏重复放两个跳转 | 段落旁铅笔/Ctrl+Enter直接走同一明确接续；继续写/返回原话共用一项 | 减少重复点击，不绕过占用草稿的追加/替换/取消 |
| 空/短讨论收起空查找后丢编辑焦点 | 工具栏消失时回原编辑owner和光标；长讨论回可见查找入口 | Esc后可直接打字，不让快捷键成为操作死路 |
| 退出中的悬停提示可吞掉Esc，目录明明打开却关不掉 | Modal自身键盘域明确处理Esc；子下拉/菜单先关闭、IME组合时不关闭 | 退场视觉层不应改变真正操作owner，不用延迟测试掩盖问题 |

固定：每个讨论只持有视图元数据，不复制正文，不写Product；目录第2/3页及滚动不能被内联查找清空。Enter/Shift+Enter即时定位并保留搜索焦点；少于2个匹配禁用多余前后动作；选段查看收起重复搜索面。沿用Halo材质与原焦点/Modal/减少动效，高频交互不新添装饰动画；取消/查看不保存，真实确认才出现新记录提示，不模拟进度/成功。

本轮0.2.27最终source11由已签收source06/Product10加十项显式overlay，排除并发C5/Product11与桌宠WIP。09首次安装后Esc真实缺口被独立复现并阻断，11修正后新独立Review/实际EXE通过才替换；用户确认短暂重启后立即恢复正常程序，安装后隔离复验不再占用个人窗口。版本、原始失败、精确身份与最终状态只看[唯一任务](../../../docs/tasks/trace-frontend-replacement.md#short-window-current)及`.test-results/workbench-short-window-polish/`，不拿此标准段落代替业务签收。390为renderer，不冒充原生880最小物理窗；物理IME/读屏/多窗口未验证。

<a id="search-context-reading"></a>

### 长讨论逐处命中、上下文与阅读返回（2026-11-01）

| Before | After | Why |
| --- | --- | --- |
| 搜索按段计数、同段只标前10处，Enter直接跳下一段 | 按真实出现位置计数与逐处导航；当前命中有独立材质底与细下划线，保留原字重/行高 | 看得出此刻是哪一处，不因强调导致正文跳动 |
| 长段只对齐段首，深处命中仍要手找 | 命中露出前后文，段落身份贴在工具栏下方且没有文字泄漏缝隙 | 读到原话的语境，不只是知道搜到了某段 |
| 查找之后只能回最新或编辑，丢失之前读到的位置 | 查找首次移动前保留独立阅读检查点；返回阅读恢复窗口、锚点与像素偏移，保留查询/草稿 | 查找是临时绕路，不等于放弃原阅读，也不混用编辑返回 |
| 换讨论、重载或缩窗后深处定位失联 | 每个讨论保留当前命中与原阅读检查点；主动定位可随视口重排，用户滚动后停止自动跟随 | 接续真实上下文，避免强制吸回命中抢控制 |
| 取消占用草稿的接续后，临时几何状态把编辑返回让给查找返回 | 明确编辑detour保留返回原话责任，直到真正阅读导航；回原话后仍能回查找前的阅读位置 | 两层返回不互相吞掉，取消不改稿、不写正文 |
| 无结果时浏览器原生caret滚动让正文上移 | 搜索工具栏持有焦点时不向浏览器重复申请正文scroll-padding | 无结果/清空不改变阅读位置，不靠改断言或延迟掩盖107px偏移 |

固定：多词同段AND、字面正则符号、大小写不敏感及#段号语义不改；视图只存身份/偏移/查询，不复制原文或写Product。明确接续仍经同一草稿追加/替换/取消和真实保存回执，原消息正文与scope不可改。高频查找即时，不加装饰运动；44px目标、Halo材质、短窗最多两行及原减少动效设置保留。

验证与发行只以[唯一任务](../../../docs/tasks/trace-frontend-replacement.md#search-context-current)及`.test-results/workbench-search-context/`精确源/产物回执为准。headless全App视觉与原生SQLite保存分开证明；不显示测试窗口、不发OS键鼠、不用先show后hide，也不把DOM几何称为原生截图。

本批按source04／单独冻结的6文件driver07完成同源Review、headless视觉及实际EXE真实SQLite链路后，0.2.30已安装。安装/恢复前最新25项自有文件逐项未变，正常入口立即恢复并仅只读核可见窗口；不再并发同EXE原生测试。03取消返回缺口、05复合首失败、ENOSPC及诊断修正均保留，原生raster仍not_run，029气泡partial不消账。精确版本、回退与分范围回执只看上述唯一任务及accepted/installation/delivery记录。
