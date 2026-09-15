# Trace capability component kit

本目录保留本轮首页能力选择器的可复用视觉研究资产，与运行时资源分开。

## 生成图

- `trace-capability-kit.png`
- SHA-256：`956B70BF800F9F670D3CD74B43AB928FCAC05A6F88DE1B0BB233E3B353F278AD`
- 四个独立概念：知乎内容搜索、全网搜索、Codex 原生、自定义 Agent。
- 这是视觉方向图，不是整页背景，也不包含产品文字。若后续裁切为运行时资产，应保留本文件，并把派生图片放入 `apps/web/public/` 后单独验收清晰度、体积和暗色透明边缘。

## 组件调研结论

当前首页由 `home.js` 直接管理 DOM，并且只有 3 个搜索选项和 4 个 Agent 选项。为了避免再引入 Portal、定位、焦点恢复和移动端弹层的不稳定性，本轮运行时采用原生 `<select>`，沿用浏览器键盘、触控和表单语义。

如果首页输入区以后完整迁移为 React，可优先重新评估：

- [Radix UI Select](https://www.radix-ui.com/primitives/docs/components/select)：完整焦点管理、键盘导航和 typeahead，适合需要高度自定义弹层时使用。
- [React Aria Select](https://react-spectrum.adobe.com/react-aria/Select.html)：适合需要更系统的国际化、无障碍和状态组合时使用。
- [Base UI Select](https://base-ui.com/react/components/select)：无样式 primitives，提供 trigger、portal、positioner、popup 等完整部件。
- [Ariakit Select](https://ariakit.org/components/select)：基于 WAI-ARIA combobox pattern，适合与 combobox / popover 组合。

本轮不安装这些库：现有选项数量不足以抵消额外运行时、样式和 imperative/React 边界成本。组件外观由 Trace 的现有字体、鼠尾草绿和单行紧凑控件完成，而不是套用组件库默认主题。
