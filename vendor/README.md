# 固定本地 Product Workspace 包

当前消费 `0.3.0-frontend.18`（内容schema 2候选、非完整迁移/替换完成）。唯一消费身份由 `product-workspace-source.json`、根 `package.json` 和 `package-lock.json` 固定；当前归档 SHA-256 与来源记录一致。
它是 `trace-runtime/packages/product/workspace` 的内部私有产物，不继承 Infinite Canvas 的 MIT。
Web 旧四模块路径仅作薄导出；不要在安装包、兼容入口或 `node_modules` 中直接修业务规则。

更新：在 Runtime 源合并并验证行为 → 提升包版本 → `npm pack --ignore-scripts` 到本目录 →
记录源提交、dirty 文件字节和 archive/integrity → 安装本地精确 tarball → 核对锁文件差分 →
运行 `node scripts/verify-product-workspace.mjs`、业务套件及真实浏览器/桌面检查。
已消费版本不重写；必要旧版本只放失败/回退证据，不在此目录并列为当前包。

构建验证只读本仓的归档、清单、锁和安装包，不依赖相邻 Runtime 工作树存在。
源提交为 dirty 时不能宣称是纯净提交发布；staged Runtime 与安装器身份仍需独立对齐。

## UI 来源身份（不是另一个业务包）

`ui-source-record.json` 固定本轮 EasyUI 原件提交、8个研究文件hash、实际适配路径和许可补充。研究原件在总项目 assets 中，但正常Web构建只使用本仓清单和 `apps/web/public/licenses`，不依赖相邻Runtime或总项目研究目录。

`node scripts/verify-ui-resources.mjs` 核验精确Radix/Lucide版本、安装图和75份依赖许可；`--research` 才额外核验总项目内的原件。依赖变化先审查，再显式 `--write` 更新通知；不得用自动写入掩盖源漂移。根构建调用只读本地门禁。

## 当前画布源码与旧包去向

`infinite-canvas-source-record.json`固定上游`9cd3deacbcc598361807afc16c059a80dd18b6f9`、7个原件身份、5个实际适配目标和MIT；`node scripts/verify-infinite-canvas.mjs [--research]`区分本仓构建与父目录研究验证。不迁入上游生成/插件/持久化store或示例媒体。

当前 `vendor/` 只保留被 manifest 和 lock 实际引用的 `.18`。在核验唯一消费身份后，已从当前工作树移除被替代的 `.2`—`.17` Product Workspace tarball，以及未消费的 Runtime 误包；不在这里并列留存每个历史版本。需要追溯时使用 Git 历史和对应任务证据，不复制旧包回来冒充当前输入。后续规则改变仍须新身份，不热修安装副本。

安装必须在实际`traceweb`工作目录先核对`npm prefix`，再执行`npm install --ignore-scripts --offline --no-audit --no-fund --save-exact file:vendor/<archive>`。相对file spec不能靠总控目录的`npm --prefix`假定已切cwd。正常构建不依赖相邻Runtime源码；真实业务验收不由包hash门禁代替。
