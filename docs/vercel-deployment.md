# Vercel Git 自动部署

## 部署对象

Vercel 只部署 `apps/web` 的浏览器本地保存版本。`apps/desktop-pet` 是 Electron／Harness 桌面交付物，由本地构建或后续桌面发行流程负责，不会被静态站点伪装成桌面安装包。

## 仓库约定

- GitHub 仓库：`Tracehackthon/traceweb`
- Production Branch：`main`
- Root Directory：仓库根目录
- Framework：Vite
- Install Command：`npm ci`
- Build Command：`npm test && npm run build:vercel`
- Output Directory：`apps/web/dist-vercel`
- Node.js：22.x

这些值已经写入 `vercel.json`。不要在 Vercel Dashboard 另外维护一套不同命令。

## 首次连接

1. 在 Vercel 中创建或选择项目 `traceweb`。
2. 通过 Vercel Git Integration 连接 `https://github.com/Tracehackthon/traceweb`。
3. 确认 GitHub App 对 `Tracehackthon/traceweb` 有读取权限。
4. 确认 Production Branch 是 `main`，Root Directory 是仓库根目录。
5. 触发一次 `main` 部署并核验 Git SHA、构建日志和最终状态 `Ready`。

连接成功后不需要 GitHub Actions 中保存 `VERCEL_TOKEN`：Vercel 原生 Git Integration 会在 push 时自动构建和部署。

## 自动部署语义

- `main` push：Production Deployment。
- 其它分支／Pull Request：Preview Deployment。
- 构建和测试失败：保留上一个成功部署，不切换 Production。
- `vercel.json` 中 `git.deploymentEnabled=true`，仓库本身允许 Git 触发；是否真正生效仍以 Vercel 项目的 Git 连接和一次实际 push 验证为准。

## 线上验收

每次首次连接或修改部署配置后至少检查：

1. 首页可以加载，静态资源 MIME 正确。
2. 新建事项后刷新仍保留。
3. 保存理解、创建工作、记录结果、导出均可完成。
4. 浏览器 Network 中没有 `/api/web/*` 请求。
5. 深链接返回应用，而 `/api/*` 不会被 SPA rewrite 伪装成成功 HTML。
6. 部署详情中的 Git SHA 与 `origin/main` 一致。

## 恢复

代码问题优先 `git revert <commit>` 后 push `main`；紧急情况下可在 Vercel 将 Production Alias 回退到上一成功部署。代码回退不会恢复用户已经清除的浏览器数据。
