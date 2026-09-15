# Trace Web 应用

当前入口：`index.html → src/web-main.js`。启动、配置、测试与范围统一见[仓库 README](../../README.md)。

- `src/product/bridge.mjs`：同一事项的跨页面状态、版本与回执。
- `web-store.mjs`：本机 SQLite、同源写入、revision CAS 和命令幂等。
- `server.mjs`：loopback HTTP 服务，数据默认保存在仓库内 `.trace/state/web.sqlite`。
- `public/`：运行所需的固定图片、完整字体、历史子集字体与第三方许可。
- `tests/`：原首页/事项模型、跨模块接续、资源锁、SQLite HTTP 测试。

[产品定义](PRODUCT.md)、[视觉规范](DESIGN.md)、[固定资产锁](approved-assets.lock.json)随应用保留。

`legacy.html` 只保留旧讨论原型的兼容入口；本仓库不携带 Electron 插件或后端运行时，不声称已验证桌面打包。旧产物来源路径仅用于追溯，不是运行依赖。
