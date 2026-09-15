---
name: Trace Web — Ambient Field
description: 浅矿物白与鼠尾草绿上的接续空间，以三个独立周边组件围合留白而不是渲染整幅背景图。
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
    padding: "20px 68px 18px 20px"
    height: "132px"
  touch-target-mobile:
    size: "44px"
---

# Design System: Trace Web

## Overview

**Creative North Star: "留白中的接续"**

Mode: **Operate**。部署根入口现在先呈现深绿、编辑式排版的产品交互介绍；访客明确选择后才进入浅矿物白与鼠尾草绿构成的产品操作表面。产品 React shell 只挂载一次共享 ambient field；首页、在意的事、一件事、对照、工作现场与痕迹目录都把真实 DOM/SVG 内容置于其上。三个独立周边组件从画面边缘提供关系、萌芽与沉淀的暗示，中间持续保留大面积可读、可操作的负空间。

现有关系线、状态节点、异形玻璃与小鸟继续表达「从哪里来、停在哪里、发生了什么」；它们不是用于填空的背景纹理。暖金只标记节点或已发生的变化，不扩张成主色。复杂产品流程、保存边界和历史事实保持原语义，新的 ambient field 只统一视觉环境，不重写业务状态。

**Key Characteristics:**
- 浅矿物白基底、淡鼠尾草洗色与深绿文字构成安静、清晰的操作表面。
- 产品介绍使用深绿现场、真实产品截图和滚动叙事，把「原现场 → 接续 → 结果回来」讲清后再进入产品，而不是用一张营销 Hero 代替产品证据。
- 右上轨道节点、左下枝叶、右下卵石是三个独立 SVG 周边组件；中心不放大型插画。
- 只有右上轨道以 10 秒周期进行低频微位移和微泛光呼吸；其余装饰保持静止。
- 小鸟与关系线保留产品语义；装饰层永远 `aria-hidden`、不接收指针，也不阻塞路由或状态流。

**The Ambient, not Wallpaper Rule.** 运行时表面不得使用全屏环境图片；用浅色 CSS 场与少量独立 SVG 从边缘组织氛围，内容层始终保持权威。

### 当前实现与事实边界

- 默认入口仍是 [web-main.js](src/web-main.js)，但会按路径拆分表面：`/` 加载产品交互介绍，`/app/demo` 与 `/app` 加载 [react-main.tsx](src/react-main.tsx) 中的 React shell，`/video` 加载预留视频页。路由 CSS 在对应模块前显式载入，避免首屏出现未着色内容。
- `/app/demo` 和 `/app` 复用同一套真实产品组件与命令边界，但使用两个独立 IndexedDB；演示空间右侧固定六动作导航，个人空间不继承任何演示记录。
- [web.css](src/product/web.css) 明确把首页、事项、chain、compare、worksite、目录与加载态的 `background-image` 置为 `none`。`ASSETS` 当前只映射字体与小鸟，不含背景角色。
- 旧 `environment*.png` 与锁定记录可以继续留在仓库作为历史/审计资产，但既不是当前 primary/legacy runtime 的视觉入口，也不是新增页面应复用的系统组件。
- 自动模型回复、联网搜索、外部 Agent 真正执行、账号和云同步仍未接入；视觉上的高亮、关联或本地保存不能冒充外部送达和结论采用。

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
- 1050px 及以下的旧桌面窄屏排版补偿仍然存在；目录在 800px 及以下从双栏切为单栏。
- 事项、chain、compare 与 worksite 保留各自内容模块和局部缩放/滚动规则，但底层环境已经统一为 ambient field。不要因共享背景而改写它们的阅读顺序、状态机或 canonical matter。

### 真实 viewport 移动首页

- **720px 断点**：首页不再整体缩放 1672px 场景；scene 改为 `width: 100%`、`height: 100dvh`、`transform: none`，以 16px 左右边距直接排版。
- 标题、说明、composer、空态、关系线、小鸟与横向 thought cards 都按 viewport 重排。thought cards 使用可横向滚动的 278 × 106px 表面，而不是缩小到不可读。
- 主要导航和固定底部操作以 44px 为最小触控目标；提交 orb 为 48 × 48px。390px 与 320px viewport 已验证输入为 16px、主要触控为 44/48px、无水平 overflow，小鸟保持完整可见。
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

- **介绍首屏**：左侧深绿叙事板与右侧真实知乎阅读现场组成一屏；三段真实 Electron Overlay 可点选，移动端改为上下阅读而不是缩小桌面画布。
- **证据链路**：六张真实 Trace Web 截图随滚动切换，文案明确区分真实界面、人工演示数据和当前尚未连接的外部能力。
- **理解前后对照**：范围控件直接比较 v1 与确认后的 v2；键盘与指针使用同一原生 range 语义。
- **视频页**：`/video` 是稳定地址。`public/video/trace-demo.mp4` 缺失时显示可交付的占位状态，存在时自动切换为原生播放器。

### 完整演示导航

`.demo-guide` 仅在 `/app/demo` 出现，固定列出「留下一点、从这里接着、找个对照、我的理解、带去用、结果回来」六个动作及 6/6 完整状态。每个入口打开同一份合成事项在权威产品组件中的对应记录，不使用静态截图冒充可操作产品。恢复演示只重建演示数据库，不触碰 `/app` 的个人数据。

### AmbientFrame 与 route surface

`AmbientFrame` 是 shell 级、`aria-hidden`、无指针事件的装饰层，包含中央光场与三个独立 SVG。route surface 的背景强制透明，非首页由 shell 的 `data-route` 降低装饰透明度。装饰加载失败不能改变路由、输入、保存或焦点顺序。

### 操作与输入

- **主 / 次操作**：主操作保持深绿实心或既有深绿渐变，次操作为浅色薄面；hover/active 只提供短促反馈。移动主要触控下限为 44px，圆形提交为 48px。
- **首页 composer**：桌面保留 762 × 121px 玻璃表面；移动改为左右 16px、132px 高的真实 viewport 表面，textarea 为 16px，提交 orb 固定在右下。
- **焦点**：按钮和链接使用可见 `focus-visible` 轮廓；输入由容器 `focus-within` 或输入轮廓表达焦点。不能因为局部 input 清除默认 outline 就宣称整站已完成无障碍验证。
- **目录**：痕迹库卡片保持真实数据、两栏到单栏的响应变化与内容截断；背景透明以露出 ambient field，而不是再次加载事项环境图。

### 产品语义与状态规则

| 状态/组件 | 保留的真实语义 |
| --- | --- |
| 静默总览与聚焦 | 对象、当前停点、细连线、小鸟与已有对照提示；hover/focus 不写入变化。 |
| 重新进入 | 当时为什么在意 / 上次真正停在 / 后来发生了什么；原现场、继续与不带回旧理解是独立操作。 |
| 新的对照 | 当时在意 / 原来的理解 / 新的对照 / 当前停点保持阅读顺序；正文、关系决定与输入分区。 |
| 搜索 / 全部痕迹 | 结果、分类与数量来自当前保存对象，保留来路、筛选与返回位置，不复制一份演示数据。 |
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
- **Do** 保留小鸟、关系线、异形表面与暖金节点的产品语义，并以 DOM/SVG 文字和控件承载真实状态。
- **Do** 对持续动效尊重 `prefers-reduced-motion` 与产品内减少动效偏好。

### Don't:
- **Don't** 在 primary 或 legacy runtime 重新引用任何 `environment*.png`、六张背景角色或新的全屏背景图。
- **Don't** 把三个周边组件合并成一张全画布插画，或在中央留白新增大面积装饰。
- **Don't** 同时动画轨道、枝叶、卵石、小鸟和关系线；持续呼吸只属于右上轨道。
- **Don't** 用整体缩放 1672px 桌面场景冒充 720px 以下首页适配，也不要把首页 390/320 验证外推为所有复杂路由已验收。
- **Don't** 用打开页面、悬停、暖金高亮、材料关系选择或本地保存伪造用户已采用判断或外部工作已送达。
