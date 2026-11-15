# 第三方来源与许可

本目录是 Trace 的隔离技术验证样例，不是任何上游项目的官方发行版。

- **Drawnix**：`plait-board/drawnix`，MIT。保留三个源码包、根许可证及来源清单；局部改动见 `vendor/drawnix/TRACE-LAB.patch`。原文在 `licenses/drawnix-MIT.txt` 及 `vendor/drawnix/LICENSE`。
- **Plait**：`plait-board/plait`，MIT。`@plait/*` 的实际 npm 版本、包完整性和上游许可来源均在审计清单中；这些包的发布物未包含独立许可文件，另保留固定提交的官方根许可。
- **React Flow / xyflow**：MIT；使用 `@xyflow/react@12.12.0`，锁定官方同名发布标签所指提交及 npm 包完整性。版权与许可原文保留在 `licenses/`。
- **perfect-freehand**：MIT；只用于样例自己的 React Flow 手绘实现，原版权与许可保留。
- **其他运行依赖**：实际 26 个直接依赖的固定版本、SPDX 标识、许可文件与 SHA-256 见 `upstream-audit.json`。部分官方 npm 包省略许可字段／文件时，保留对应官方仓库固定提交及许可原文，不将元数据缺失直接解释为无许可。传递依赖依其原始条款，不将所有依赖笼统称为 MIT。
- **Infinite Canvas**：本轮仅审阅固定提交；未移植代码、运行应用、安装插件或连接其服务。其 MIT 许可文本以 reference-only 名称保留，不能把源码审阅宣称为运行验收。
- **tldraw**：未安装／运行／复制 SDK；仅对照官方授权文档，未购买或申请商业授权。

本样例的 HTML、PNG、PDF、WebM 和 WAV 测试材料均为本地自产，不包含用户资料或下载素材。系统字体由本机提供，未打包第三方字体文件。

若后续将模块正式接入或分发产品，需要按实际分发清单保留相应许可和版权；本样例的审计不替代对未来产品依赖与资产的重新核对。
