# SysTorch 品牌与技术标识迁移

更新日期：2026-10-30。SysTorch 是当前唯一产品品牌，GitHub 仓库已公开迁移为 ARCJ137442/SysTorch。本记录描述 0.11.0 预发布的品牌迁移和兼容边界；新名称覆盖公开界面、包、图标、文档与发行附件。旧标识只在协议、历史记录和用户数据兼容点上保留。

## 产品与品牌

产品定位为面向人、模型和 Agent 的结构化决策运行时：把一个或多个判断问题送入可检查的路由路径，必要时由人接手，再把结果交回原调用方。核心仍包含可编辑 DAG、提供商服务启停、请求/响应辉光和专业控制台。Jev / System One 是协议和模型系列；SysTorch 不绑定某一家供应商，也不需要通用 LLM API 才能使用持久人工作答。

品牌口号：

- 中文：把眼前的问题，变成下一步。
- English: Turn questions into next steps.

图形母版是 [ui/src/brand/systorch.svg](../../ui/src/brand/systorch.svg)，由 scripts/generate-systorch-icons.ps1 生成各平台图标。应用、窗口、任务栏、Android launcher、最近任务和启动页统一使用 SysTorch 火炬图形。小尺寸系统表面可以使用同轮廓单色派生图，不回退到旧 J 或 Tauri 模板图。CI 验证母版、PNG、ICO 和 APK 编译资源；界面审美仍以维护者实际预览为准。

## 新名称与必须保留的兼容身份

| 接触面 | 0.11.0 品牌 | 保留的兼容身份 |
|---|---|---|
| 界面、窗口与下载名 | SysTorch | 旧 localStorage 键和用户偏好继续读取 |
| 前端与 Rust 包 | systorch-ui、systorch-daemon、systorch-cli、systorch-shell | 旧命令可作为同一入口的兼容别名；Jev adapter/crate 名指向 Jev 协议实现 |
| Windows 桌面 | SysTorch.exe 与 SysTorch Standalone | Tauri identifier 和用户数据目录不变，避免 WebView 存储、凭据和历史变成孤立副本 |
| Android | 显示名 SysTorch、Kotlin namespace io.github.arcj137442.systorch、库 libsystorch_shell.so | installed applicationId 与现有稳定签名保持不变；旧 Activity、service、tile 类以兼容包装维持快捷方式和系统引用 |
| API 与健康检查 | 新 SysTorch 会话通道使用 /v1/systorch | 既有 /v1/systemone、管理 API、health.product=jev-switch、旧配置环境变量和 Android 偏好键继续兼容 |
| 普通聊天与人工作答 | SysTorch 会话和资产契约 | 数据库、owner key、调用 Token 与既有任务不跨沙箱复制、不重新生成身份密钥 |
| 新发布 | ARCJ137442/SysTorch；附件名 SysTorch-* | 旧 Release、旧标签和旧证据仍保留在 Git 历史中，不伪造为新产品产物 |

旧 applicationId、health.product 和协议字段是机器读取的兼容身份，不是面向用户的品牌。改掉 Android applicationId 会安装成第二个应用，无法读取旧沙箱数据；更换稳定签名也会阻止覆盖升级。因此 0.11.0 原位升级，不引入跨沙箱迁移和第二把签名 key。

## 构建和发布范围

版本字段统一为 0.11.0。GitHub Release 作为 prerelease 发布，公开附件恰好两个：

- Windows x64：SysTorch-0.11.0-windows-x64.exe，单文件 Standalone。当前没有 Authenticode 证书，系统可能提示未知发布者。
- Android arm64：SysTorch-0.11.0-android-aarch64.apk，沿用稳定签名与 applicationId，可覆盖稳定版本。

CI 可构建其他诊断和内部工件，但本次不把 CLI、MSI、NSIS、Portable ZIP、APK manifest 或签名清单作为 GitHub Release 附件。需要人工在 Windows 与 Android 上验收的内容见 0.11.0 核验记录，不用 CI 截图或模拟器代替真机结论。

## 历史证据

2026-10-24 的 M0/M1 候选文件、哈希和核验继续作为各自候选的历史记录；它们不是 0.11.0 构建身份。版本身份、CI run、资产哈希和人工验收边界统一更新在[0.11.0 预发布核验](../verification/v0.11.0-pre-release-2026-10-30.md)。旧材料中的 Jev Switch 字样仅在准确说明当时的名称、协议或兼容标识时保留。
