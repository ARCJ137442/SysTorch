# GitHub Pages 官网部署与维护

**当前状态（2026-10-30）**：SysTorch 官方网站部署在 <https://arcj137442.github.io/SysTorch/>，由本仓库 `site/` 维护。GitHub Pages workflow 使用官方 `actions/configure-pages`、`upload-pages-artifact` 和 `deploy-pages`；Release 发布后读取 GitHub Release JSON，更新当前版本与附件链接。本轮定位、内容结构和视觉说明见[官网设计说明](../research/SYSTORCH-OFFICIAL-WEBSITE-2026-10-30.md)。

## 现有部署合同

- 只维护 `site/` 下的静态页面和本地素材；不复制 React 控制台、daemon 或任何本机配置。
- 使用仓库项目 Pages `/SysTorch/`，不覆盖 `ARCJ137442.github.io` 个人主页中的其他站点。
- `.github/workflows/pages.yml` 在 `site/**` 变更、Pages workflow 变更、Release published 与手动 dispatch 时部署。
- 构建时从 GitHub Releases 获取当前发行元数据到 `site/releases/latest.json`；`site/index.html` 只读取安全展示字段与公开附件 URL，不解析 Release 正文为 HTML。
- Release 资产名必须精确匹配当前工作流文件；找不到平台附件时回退到 Release 页面。
- 官网可以解释当前 capability、产品边界与下载路径；详细契约以 README 和 `docs/contracts` 为准，发布限制以对应 Release 与核验记录为准。

## 官网内容原则

- 以“把眼前的问题，变成下一步。”为品牌口号；品牌名 SysTorch 与 Jev / System One 协议身份分离。
- 说明 SysTorch 面向 typed System One decisions：结构化问题、可检查的 DAG 路由、provider attempts、持久人工作答与原调用方取回。
- 诚实承认 Magpie、Bud Decision Studio 和 System One 服务已有相邻或重叠能力；强调 SysTorch 的工作流中心，不宣称独占路由、独家技术或未经实测的优劣。
- 截图若使用自动化 fixture 或合成请求，必须标为界面预览，不可称为 Release 二进制截图、实时流量或人工验收。
- 不发布未经来源支持的客户、数据、性能、准确率、遥测、下载量或市场份额承诺。
- 中英文文案需成对维护；导航、主题、页面元信息、截图替代文本、发行状态和下载限制都要覆盖两个语言。

## 发布核对

1. 静态相对路径适用于 `/SysTorch/` 子路径；图标、截图、CSS、Release JSON 和 sitemap 均从项目根相对路径读取。
2. 本地预览检查桌面、紧凑笔记本、390px 与 360px 窄屏；确认无横向溢出、导航可用、焦点可见、语言/主题切换与减弱动效可读。
3. 每个下载入口指向 Release API 当前确实存在的 Windows x64 Standalone 或 Android arm64 APK；UI 不推断用户设备上的 provider 可用性。
4. Pages workflow 成功后访问官网及 `/releases/latest.json`，核对 version、prerelease、attachment count 和公开下载链接。
5. 页面更新后同步 README、GitHub About 与发布说明的品牌口号和官网链接；不要让 Release 说明与当前网站互相冲突。

旧版页面结构、v0.2.0/v0.4.0 部署验收和此前“尚待部署”的记录只证明各自历史状态，不覆盖当前 Pages 流程。
