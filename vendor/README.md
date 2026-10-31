# 固定本地 Product Workspace 包

当前消费 `0.3.0-frontend.2`（内容schema 2候选、非完整迁移/替换完成）。唯一消费身份由 `product-workspace-source.json` 和根 `package-lock.json` 固定。
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

Product的`0.2.0-frontend.5`与`0.3.0-frontend.1`归档只保留于本任务`.test-results/frontend-replacement/workbench/package-history/`及必要Git历史；当前目录只保留被依赖和锁引用的.2。.1后发现完整画布/历史和等长原件损坏检查缺口，因此另发.2，不复写旧版本。后续规则改变仍须新身份，不热修安装副本。

安装必须在实际`traceweb`工作目录先核对`npm prefix`，再执行`npm install --ignore-scripts --offline --no-audit --no-fund --save-exact file:vendor/<archive>`。相对file spec不能靠总控目录的`npm --prefix`假定已切cwd。正常构建不依赖相邻Runtime源码；真实业务验收不由包hash门禁代替。
