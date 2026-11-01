# Trace Web 设计入口

<!-- impeccable:design-schema 1 -->

## 当前权威与模式

Operate：浅色中性内容工作台，石墨主操作。三大工作区为思考画布、能力库、Agent 协作；激活、回流和演变围绕当前对象展开。用户已确认中性主画布方向及完整流程位置。

唯一详细规范在项目正文，不在这里再定义一套主题：

- [设计语言与组件规范](../../../manunl/产品界面与交互设计/设计语言与组件规范.md)：token、字阶、几何、交互、图标、组件合同。
- [整体交互形态](../../../manunl/产品界面与交互设计/整体交互形态.md)：位置、流程及返回路径。
- [开源复用与素材规范](../../../manunl/产品界面与交互设计/开源复用与素材规范.md)：固定源、许可及依赖边界。
- [唯一任务与缺口](../../../docs/tasks/trace-frontend-replacement.md)：15组功能、跨区行为和验收证据。

## 实现入口与过渡事实

`src/react/ui/trace-ui.css` 负责新组件颜色/排版 token；`../../shared/ui-geometry.css` 是全站（含旧页面、介绍/视频及桌面悬浮界面）唯一几何数值所有者，4px网格及4/8/12/16/24px圆角，连续角渐进增强，药丸/圆形保留round。`src/react/ui/icon.tsx` 是 Lucide 映射。Radix 负责菜单、提示及 Tabs 行为，EasyUI 的已核源码按正文适配，不迁入其暗色主题、网站内容或 Motion/Tailwind 依赖。

当前三工作区由 `src/react/workbench/workbench-app.tsx` 承接，找回/准确版本由 `workspace-search.tsx`／`capability-history.tsx` 实现，明确版本包由 `capability-sharing.tsx` 接同源Product命令。`library-workspace.tsx`及旧场景仅承接仍需兼容的旧入口，不能据它另起三工作区导航或恢复旧主题。`workbench-theme.css`、`workbench-typography.css`和`workbench-states.css`是当前工作台在共享令牌上的正式映射；未接通的语义/完整兼容与验收仍回唯一任务。

三工作区壳及 Infinite Canvas 真实交互已在正式代码和0.2.25安装范围中成立，完整W1—W7功能、所有旧对象兼容和最终替换仍未完成。旧 sage-green/Ambient Field、共享鸟、六动作导航及“五套原型分别权威”不再是新实现的设计约束；不能据旧页面恢复过时默认，也不能用本批版本包或某个组件宣告完整替换。源码Product`.7`与安装0.2.25的`.5`分开记录；不自动安装/迁移用户库。

不引入第二主题、画布引擎或业务 owner。保留旧数据、深链、草稿和桌面桥，支持真实失败、焦点恢复、中文输入法与减少动效。`.impeccable` 旧派生缓存不能覆盖本文及项目正文；本轮不顺手修改其工具内部格式。

几何及后续实现以当前源码/当前构建实测为准；不再查看过时产品截图，也不从旧截图恢复视觉约束。历史截图仅为其当时任务的证据，不是现在的设计输入。

## 英文字体选型（2026-10-31 用户确认）

Bricolage Grotesque 为英文比例字体；中文改用 MiSans；字号行高和等宽代码字体保持不变。具体范围和来源以权威设计规范的“字体、字阶与数字”为准。字体及OFL许可位于 `public/fonts/`，不依赖在线字体服务。

2026-10-31：用户确认中文统一 MiSans，英文保持 Bricolage Grotesque。MiSans 使用官方原始 WOFF2，许可与使用声明随 `public/fonts/` 分发。
