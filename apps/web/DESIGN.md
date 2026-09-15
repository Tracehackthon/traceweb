---
name: Trace Web — Ambient Field
description: 浅矿物白与鼠尾草绿上的接续空间，以三个独立周边组件围合留白而不是渲染整幅背景图。
platform: web
colors:
  ink: "#123e35"
  body-ink: "#173c32"
  muted-sage: "#587369"
  action-green: "#0b5942"
  primary-solid: "#115d43"
  focus-green: "#1f7057"
  mineral-base: "#f3f6f1"
  mineral-highlight: "#f7f9f5"
  sage-wash: "#edf4f0"
  glass-surface: "#fbfdf9dc"
  shell-control: "#f7fcf0bf"
  capability-surface: "#f7fbf5a6"
  state-unavailable-surface: "#f0f2ed"
  state-unavailable-ink: "#748177"
  state-neutral-surface: "#e1e8e1"
  state-neutral-ink: "#64776d"
  state-ready-surface: "#f5eacb"
  state-ready-ink: "#7a601f"
  state-available-surface: "#e0f0e7"
  state-available-ink: "#0a674c"
  state-authorized-surface: "#cfe9d9"
  ambient-warm-node: "#d8a94c"
  state-warm-node: "#dfb654"
  intro-deep: "#071d17"
  intro-green: "#087158"
  intro-accent: "#47b68c"
  white: "#ffffff"
typography:
  display:
    fontFamily: '"Trace Web Serif", "Songti SC", SimSun, serif'
    fontSize: "66px"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "-0.015em"
  display-mobile:
    fontFamily: '"Trace Web Serif", "Songti SC", SimSun, serif'
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"Trace Web Sans", "Microsoft YaHei", "Segoe UI Emoji", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Trace Web Sans", "Microsoft YaHei", "Segoe UI Emoji", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  mobile-input:
    fontFamily: '"Trace Web Sans", "Microsoft YaHei", "Segoe UI Emoji", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  intro-display:
    fontFamily: '"TraceSerif", Georgia, serif'
    fontWeight: 400
    lineHeight: 1.05
rounded:
  brand: "11px"
  control: "20px"
  pill: "23px"
  home-composer: "29px"
  mobile-surface: "24px"
  capability: "15px"
  circle: "50%"
spacing:
  mobile-edge: "16px"
  compact-gap: "12px"
  card-gap: "18px"
  desktop-edge: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary-solid}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  button-shell:
    backgroundColor: "{colors.shell-control}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  home-composer:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.home-composer}"
    padding: "22px 26px 17px 32px"
    height: "121px"
    width: "762px"
  home-composer-mobile:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.mobile-input}"
    rounded: "{rounded.mobile-surface}"
    padding: "17px 18px 14px"
    height: "154px"
  capture-select:
    backgroundColor: "{colors.capability-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "18px"
    padding: "0 27px 0 8px"
    height: "36px"
  connection-state-unavailable:
    backgroundColor: "{colors.state-unavailable-surface}"
    textColor: "{colors.state-unavailable-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
  connection-state-ready:
    backgroundColor: "{colors.state-ready-surface}"
    textColor: "{colors.state-ready-ink}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  connection-state-available:
    backgroundColor: "{colors.state-available-surface}"
    textColor: "{colors.state-available-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  connection-state-authorized:
    backgroundColor: "{colors.state-authorized-surface}"
    textColor: "{colors.state-available-ink}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  touch-target-mobile:
    size: "44px"
---

# Design System: Trace Web

## Overview

**Creative North Star: "留白中的接续"**

Mode: **Operate**。部署根入口先呈现浅矿物白、深墨绿与细线网格构成的「连续性仪器」式产品介绍；访客理解产品主张和完整链路后，再进入同一视觉语言下的产品操作表面。介绍页不是截图画廊，而是按「主题 → 产品选择 → 知乎参与思考 → 回到 Codex 工作 → 结果回来」组织的一条可操作叙事。产品 React shell 只挂载一次共享 ambient field；首页、在意的事、一件事、对照、工作现场与痕迹目录都把真实 DOM/SVG 内容置于其上。三个独立周边组件从画面边缘提供关系、萌芽与沉淀的暗示，中间持续保留大面积可读、可操作的负空间。

现有关系线、状态节点、异形玻璃与小鸟继续表达「从哪里来、停在哪里、发生了什么」；它们不是用于填空的背景纹理。暖金只标记节点或已发生的变化，不扩张成主色。复杂产品流程、保存边界和历史事实保持原语义，新的 ambient field 只统一视觉环境，不重写业务状态。

**Key Characteristics:**
- 浅矿物白基底、淡鼠尾草洗色与深绿文字构成安静、清晰的操作表面。
- 产品介绍从「让值得思考的想法，继续发生」开始，用连续路径图、五级展开交互、真实产品截图和状态刻度把「原现场 → 思考与讨论 → 我的理解 → Codex 工作 → 结果回来」讲清后再进入产品。
- 五级形态不是五个产品：悬浮入口、极简输入、小浮窗与气泡、一件事展开、完整桌面端都承接同一件事；界面只在用户需要时逐步变深。
- 知乎不是内容仓库或品牌装饰：公开内容、授权后的个人内容、全网搜索与知乎直答分别为当前问题提供补充、挑战和限制，来源不会自动成为用户判断。
- Codex 是首要工作宿主。代码生成、命令、检查与交付留在原生 Agent 中；Trace 只补上来处、当前理解、使用范围与结果回流。
- 右上轨道节点、左下枝叶、右下卵石是三个独立 SVG 周边组件；中心不放大型插画。
- 只有右上轨道以 10 秒周期进行低频微位移和微泛光呼吸；其余装饰保持静止。
- 小鸟与关系线保留产品语义；装饰层永远 `aria-hidden`、不接收指针，也不阻塞路由或状态流。

**The Ambient, not Wallpaper Rule.** 运行时表面不得使用全屏环境图片；用浅色 CSS 场与少量独立 SVG 从边缘组织氛围，内容层始终保持权威。

### 当前实现与事实边界

- 默认入口仍是 [web-main.js](src/web-main.js)，但会按路径拆分表面：`/` 加载产品交互介绍，`/app/demo` 与 `/app` 加载 [react-main.tsx](src/react-main.tsx) 中的 React shell，`/video` 加载预留视频页。base shell 的 [web.css](src/product/web.css) 随 React 入口静态加载，局部路由 CSS 再于对应模块挂载前加载；即使路由资源失败，加载态、错误态与恢复操作也不会退回无样式页面。
- `/app/demo` 和 `/app` 复用同一套真实产品组件与命令边界。托管 Web 为两者使用独立的 IndexedDB 命名空间；即使本地开发中的 `/app` 连接个人 SQLite，`/app/demo` 也固定使用独立演示 IndexedDB，不会把合成数据写入个人 SQLite。完整 demo v2 含 4 个 matters 与 2 个 works；其中主事项具有六动作可直达的完整链路。所有演示数据都标记为 `synthetic` / `演示数据 · 未联网`；个人空间不继承任何演示记录。
- [web.css](src/product/web.css) 明确把首页、事项、chain、compare、worksite、目录与加载态的 `background-image` 置为 `none`。`ASSETS` 当前只映射字体与小鸟，不含背景角色。
- 旧 `environment*.png` 与锁定记录可以继续留在仓库作为历史/审计资产，但既不是当前 primary/legacy runtime 的视觉入口，也不是新增页面应复用的系统组件。
- 首页 composer 不再打开 ConnectionCenter，而是内嵌两个紧凑原生 `capture-select`。搜索下拉包含「不联网 / 知乎搜索 / 全网搜索」；Agent 下拉包含「不交给 Agent / Codex 原生 / Codex Harness / 自定义 Agent」。原生 `<select>` 保留浏览器键盘、触控与表单语义，避免在当前 imperative DOM 与 React 边界增加 portal 和焦点恢复风险。
- 公开「知乎搜索 / 全网搜索」与个人 OAuth 分开。只有个人空间设置中的「我的知乎内容」提供 OAuth，根据真实接口状态显示服务未配置、未连接或已连接；演示空间既不出现授权卡，也不伪造游客身份。
- 自动模型回复、联网搜索、外部 Agent 真正执行、账号和云同步仍未接入。搜索下拉只保存本次意图；选中 Agent 时只在本地预填可检查的 handoff，不发送、不创建任务、不伪造回执。视觉高亮、关联或本地保存也不能冒充外部送达和结论采用。
- 能力选择器的可复用视觉方向图保存在 `artifacts/ui-components/trace-capability-kit.png`，生成图说明、哈希及 Radix UI / React Aria / Base UI / Ariakit 调研记录保存在 `artifacts/ui-components/README.md`。该资产不是当前运行时背景。

## Colors

配色以低对比矿物白和鼠尾草洗色建立空气感，再用深绿形成可读层级；暖金只承担稀少的时间/变化信号。

### Primary
- **行动深绿**（`action-green`、`primary-solid`）：品牌、主要按钮、提交与明确可操作节点。两者分别来自共享变量和现有实心按钮，不应被合并成未经实现验证的新色值。
- **焦点绿**（`focus-green`）：键盘焦点轮廓。可见焦点不能只依赖阴影或色相微差。

### Secondary
- **环境暖金**（`ambient-warm-node`）：新轨道与卵石 SVG 中的少数亮点。
- **状态暖金**（`state-warm-node`）：既有事项变化节点与徽记。两种暖金都只用于点状强调，不能铺成大按钮、大标题或整面渐变。

### Neutral
- **主墨绿与正文墨绿**（`ink`、`body-ink`）：前者是当前 shell 的主文字，后者保留给现有 Web 正文层级。
- **辅助鼠尾草**（`muted-sage`）：说明、元数据和较弱导航。
- **矿物基底**（`mineral-base`）：`body` 与 shell 的统一底色。
- **高光与洗色**（`mineral-highlight`、`sage-wash`、`white`）：组合成 ambient field 的径向与线性渐变，不作为整幅位图的替身。
- **半透明表面**（`glass-surface`、`shell-control`）：分别用于首页 composer 与 shell 控件；透明度必须让底层洗色可见，但不能降低正文对比。
- **选择与授权状态表面**（`capability-surface`、`state-*-surface`）：`capture-select` 维持接近 composer 的轻玻璃感；「服务未配置 / 未连接」使用中性灰绿或克制暖黄，「已连接」使用浅绿。绿色只说明真实 OAuth 状态；下拉选中状态不代表外部搜索或 Agent 已经执行。

**The Warm Node Ration Rule.** 一个局部关系或变化只需要一个暖金焦点；若暖金开始比正文或主操作更先被看见，就已经使用过量。

## Typography

- **共享别名**：`Trace Web Serif` 与 `Trace Web Sans` 是当前产品 shell 的字体入口，分别加载本地 `TraceHomeSerif-fixed.woff2` 与 `TraceHomeSans-fixed.woff2`，并使用 `font-display: swap`。
- **路由映射**：首页通过 `--serif` / `--sans`，事项通过 `--matters-serif` / `--matters-sans` 接入共享 Web 别名；chain、compare、worksite 保留模块别名和系统 fallback，但不应重新引入环境图来证明各自身份。
- **层级**：宋体承担首页展示标题、事项标题与理解/判断层级；黑体承担正文、导航、按钮、输入和状态说明。桌面首页主标题使用 `display`，720px 及以下使用 `display-mobile`；350px 及以下再降为源码中的 36px 局部修正。
- **动态文字**：标题、停点、来源摘录、输入与按钮必须继续是可选择、可换行的文字。固定字体字节不等于覆盖所有罕见字和 emoji，系统 fallback 必须保留。
- **移动输入**：720px 及以下首页 textarea 使用 `mobile-input`（16px / 1.55），不能降到 16px 以下。

**The Writable Text Rule.** 不把标题、停点、输入、状态或按钮栅格化进装饰资产；用户内容长度由换行、滚动和真实布局处理。

## Layout

### 共享 ambient field

- `.trace-ambient` 固定铺满 viewport，只使用 CSS 径向/线性渐变；内容 route root 位于其上方。
- 右上轨道节点宽 330px，右侧轻微出界；左下枝叶宽 220px；右下卵石宽 290px。三者围绕边缘布置，中央光场约 660 × 430px，不能再叠加第四个中央主视觉。
- 首页使用装饰默认透明度；非首页路由把周边组件降至 0.35、中央光场降至 0.46，让事项、chain、compare、worksite 与痕迹库共享同一环境但不过度抢占阅读。

### 桌面与中间宽度

- 首页在 721px 及以上继续使用 1672 × 941 场景坐标并居中等比缩放；这是桌面构图策略，不是手机适配。
- 桌面首页 composer 在场景坐标中是 762 × 121px；输入、两个紧凑下拉和提交 orb 在同一玻璃表面内排布，不再嵌套大型能力卡。
- 1050px 及以下只保留必要的辅助面板位移，不反向放大标题和 composer 字号；目录在 800px 及以下从双栏切为单栏。
- 事项、chain、compare 与 worksite 保留各自内容模块和局部缩放/滚动规则，但底层环境已经统一为 ambient field。不要因共享背景而改写它们的阅读顺序、状态机或 canonical matter。

### 真实 viewport 移动首页

- **720px 断点**：首页不再整体缩放 1672px 场景；scene 改为 `width: 100%`、`height: 100dvh`、`transform: none`，以 16px 左右边距直接排版。
- 标题、说明、composer、空态、关系线、小鸟与横向 thought cards 都按 viewport 重排。composer 高 154px；thought cards 使用可横向滚动的 278 × 106px 表面，而不是缩小到不可读。
- 主要导航、两个 `capture-select` 和固定底部操作以 44px 为最小触控目标；提交 orb 为 48 × 48px。390px 与 320px viewport 已验证输入为 16px、主要触控为 44/48px、无水平 overflow，小鸟保持完整可见。
- **350px 断点**：隐藏项目胶囊文字、主标题降至 36px，并微调 composer/空态纵向位置；这仍是 viewport 布局，不回退到场景缩放。

**The Real Mobile Layout Rule.** 720px 及以下首页必须重排真实控件；不允许通过缩小桌面场景来伪装适配。尚未按同一矩阵验证的其他复杂路由，不得仅因共享 ambient field 宣称完成移动验收。

## Elevation & Depth

- ambient field 的深度来自淡渐变和边缘组件的低强度 `drop-shadow`，不是景深位图或厚色蒙层。中央光场用 18px blur，只负责柔化留白。
- 首页 composer 使用半透明近白表面、20px blur、极浅外影与内侧白高光；focus-within 仅增加一圈低透明绿，不产生发光面板。
- 既有异形气泡和大阅读面仍可用薄边、乳白中心、局部 backdrop blur 与轻投影；大正文表面不能叠加全幅折射或把装饰纹理压到文字下方。
- 右上轨道的 `trace-orbit-breathe` 在 10 秒内只移动（-8px, 7px）并轻调透明度/阴影。`prefers-reduced-motion: reduce` 与产品内减少动效设置都必须停止或近乎即时结束动效；枝叶、卵石不动画。

**The One Breathing Ornament Rule.** 同一 viewport 只有右上轨道可以持续呼吸；不要让三件装饰、小鸟、按钮和关系线一起漂浮。

## Shapes

- 三个装饰资产保持独立 viewBox 和透明边界：轨道是开放曲线与三个节点，枝叶是细茎/叶片，卵石是两块叠置石形与一条地线。不得把它们合并成一张大图。
- 品牌 tile 使用 11px 圆角；主要短操作使用约 20–23px 圆角；首页 composer 桌面为 29px、移动为 24px；提交与头像保持圆形。
- 首页与事项的关系气泡保留各自不对称 SVG 轮廓。移动 thought card 隐藏复杂 material SVG，改用 24px 圆角轻表面，以可读性和滚动稳定性优先。
- 小鸟只使用已锁定的栖息与起飞姿态。它与关系线指向对象/停点，不增加第三种鸟身份，也不烘焙进 ambient SVG。

## Components

### 产品介绍与视频入口

- **信息顺序**：先回答 Trace 为什么存在，再回答它为何 local-first、为何不重复做 Agent、为何选择 Codex；随后才进入知乎思考链路、工作承接和六个核心动作。功能不能脱离这条因果顺序单独堆叠。
- **介绍首屏**：左侧是主题、定位和两条产品选择，右侧用同一件事的轨迹把知乎阅读、思考、理解、Codex 工作与结果回流放在一张连续地图里。首屏不使用巨幅截图或深色遮罩抢走主题。
- **从极简到完整桌面**：五个可点阶段在同一预览面中切换真实 Electron / Trace Web 证据；每一步同时说明形态、发生的动作和对用户的直接帮助。
- **知乎与思考**：四个页签依次展示在知乎停住、从断点接着、用知乎／全网找真实对照、写成自己的理解；对照卡显式标注补充、限制与未确认。
- **回到工作**：带入、工作、回来、复核四阶段复用真实 Trace Web 截图，并用状态刻度区分「已带到工作、参与具体做法、结果已回来、理解已确认修改」，不得把中间状态冒充最终效果。
- **完整能力入口**：六动作列表负责收束产品模型，`/app/demo` 才承担逐个操作完整数据的职责；介绍页不复制一套假的静态桌面。
- **视频页**：`/video` 是稳定地址。`public/video/trace-demo.mp4` 缺失时显示可交付的占位状态，存在时自动切换为原生播放器。

### 完整演示导航

`.demo-guide` 仅在 `/app/demo` 出现，默认收起，列出「留下一点、从这里接着、找个对照、我的理解、带去用、结果回来」六个动作及 6/6 完整状态。demo v2 用同一套产品命令建立 4 个 matters 和 2 个 works；首页四个气泡分别表现一份理解、一个工作承接、一次全新重读和一个待验证停点；六个直达入口都打开主事项的真实记录，不使用静态截图冒充可操作产品。恢复演示只重建演示数据库，不触碰 `/app` 的个人数据。

### AmbientFrame 与 route surface

`AmbientFrame` 是 shell 级、`aria-hidden`、无指针事件的装饰层，包含中央光场与三个独立 SVG。route surface 的背景强制透明，非首页由 shell 的 `data-route` 降低装饰透明度。装饰加载失败不能改变路由、输入、保存或焦点顺序。

### 操作与输入

- **主 / 次操作**：主操作保持深绿实心或既有深绿渐变，次操作为浅色薄面；hover/active 只提供短促反馈。移动主要触控下限为 44px，圆形提交为 48px。
- **首页 composer**：桌面为 762 × 121px 玻璃表面，在输入下方并列搜索范围与 Agent 引擎两个 `capture-select`；移动改为左右 16px、154px 高的真实 viewport 表面，两个下拉各保持 44px，textarea 为 16px，提交 orb 固定在右下。
- **`capture-select`**：原生 `<select>` 与小图标、自定义箭头组成紧凑单行控件。桌面高 36px，移动高 44px；长选项「Codex Harness」必须完整可见，不能为了保留旧能力卡尺寸而截断。
- **个人知乎授权**：ConnectionCenter 已移除。「我的知乎内容」只在个人空间设置中出现，分开陈述公开搜索与 OAuth，并按服务未配置、未连接或已连接显示真实接口状态。
- **焦点**：按钮和链接使用可见 `focus-visible` 轮廓；输入由容器 `focus-within` 或输入轮廓表达焦点。shell 对话记录打开前的触发控件，关闭后于下一帧恢复焦点；不能因为局部 input 清除默认 outline 就宣称整站已完成无障碍验证。
- **目录**：痕迹库卡片保持真实数据、两栏到单栏的响应变化与内容截断；背景透明以露出 ambient field，而不是再次加载事项环境图。

### 产品语义与状态规则

| 状态/组件 | 保留的真实语义 |
| --- | --- |
| 静默总览与聚焦 | 对象、当前停点、细连线、小鸟与已有对照提示；hover/focus 不写入变化。 |
| 重新进入 | 当时为什么在意 / 上次真正停在 / 后来发生了什么；原现场、继续与不带回旧理解是独立操作。 |
| 新的对照 | 当时在意 / 原来的理解 / 新的对照 / 当前停点保持阅读顺序；正文、关系决定与输入分区。 |
| 搜索 / 全部痕迹 | 结果、分类与数量来自当前保存对象，保留来路、筛选与返回位置，不复制一份演示数据。 |
| 不联网 / 知乎搜索 / 全网搜索 | 下拉选择只保存本次搜索意图；当前 Web 不发起联网请求或伪造结果。demo 明示「演示数据 · 未联网」。 |
| 「我的知乎内容」OAuth | 只在个人空间出现，按环境显示服务未配置、未连接或已连接；只有明确操作才读取，且不自动保存进 Trace。 |
| 不交给 Agent / Codex 原生 / Codex Harness / 自定义 Agent | 选中 Agent 只在本地预填 handoff 目的地、原话、角色和说明；不发送、不创建外部任务、不伪造回执。 |
| 工作现场 / 结果回来 | 工作保留当时快照；结果确认后才修订当前理解。视觉高亮不等于外部 Agent 已执行。 |

- **关系与判断分开**：“接为挑战”等关系选择不自动采用材料结论；“这次无关”不删除来源。没有对照源时关系按钮禁用。
- **提交边界**：空白不能提交；Enter 保存、Shift + Enter 换行，输入法组合期间不提交。保存当前判断、保存我的理解、材料关联和外部送达是不同动作。
- **持久化边界**：URL 只标识对象与位置，不承载正文；刷新与返回以 canonical matter 和持久化状态为准。失败时保留草稿并提供重试/导出，版本冲突拒绝静默覆盖。

**The Decoration Never Decides Rule.** ambient 透明度、暖金节点、泛光或鸟的位置都不能触发、替代或证明状态写入。

## Do's and Don'ts

### Do:
- **Do** 在所有主路由复用同一个浅矿物白 / 鼠尾草 ambient field，并在非首页降低装饰存在感。
- **Do** 把轨道、枝叶、卵石保留为三个独立、可单独定位和降级的 SVG 周边组件，持续保护中央负空间。
- **Do** 在 720px 及以下使用首页真实 viewport 布局，保持 16px 输入字号、44px 主要触控下限和 48px 提交目标。
- **Do** 在 composer 内用两个原生下拉区分搜索意图与 Agent 意图，并用「演示数据 · 未联网」、个人 OAuth 实时状态和本地 handoff 说明守住边界。
- **Do** 保留小鸟、关系线、异形表面与暖金节点的产品语义，并以 DOM/SVG 文字和控件承载真实状态。
- **Do** 对持续动效尊重 `prefers-reduced-motion` 与产品内减少动效偏好。

### Don't:
- **Don't** 在 primary 或 legacy runtime 重新引用任何 `environment*.png`、六张背景角色或新的全屏背景图。
- **Don't** 把三个周边组件合并成一张全画布插画，或在中央留白新增大面积装饰。
- **Don't** 同时动画轨道、枝叶、卵石、小鸟和关系线；持续呼吸只属于右上轨道。
- **Don't** 用整体缩放 1672px 桌面场景冒充 720px 以下首页适配，也不要把首页 390/320 验证外推为所有复杂路由已验收。
- **Don't** 用打开页面、悬停、暖金高亮、材料关系选择或本地保存伪造用户已采用判断或外部工作已送达。
- **Don't** 把搜索下拉的选中状态写成联网已发生，也不要把本地预填的 Codex / Harness / 自定义 Agent handoff 写成任务已经创建或执行完成。
