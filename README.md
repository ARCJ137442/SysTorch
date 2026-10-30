# SysTorch

[English](README.en.md) · [官网](https://arcj137442.github.io/SysTorch/) · [发布与下载](https://github.com/ARCJ137442/SysTorch/releases) · [文档索引](docs/README.md)

<p align="center">
  <img src="ui/src/brand/systorch.svg" width="112" alt="SysTorch 火炬标识">
</p>

> **把眼前的问题，变成下一步。**
>
> Turn questions into next steps.

SysTorch 是面向人、模型与 Agent 的**结构化决策运行时**：把一个判断请求送进可检查的 DAG 路由，在合适的决策服务间流转；需要人工接手时，将任务持久交给指定的人，再把严格映射的结果交还原调用方。

![SysTorch 0.12.0 开始页预览，含合成的成功决策与路由轨迹](docs/gallery/images/start-desktop.png)

> 图册截图来自合成数据的本地界面预览，不是 0.12.0 EXE／APK 的版本截图；具体证据边界见[图册说明](docs/gallery/README.md)。

<p align="center">
  <a href="docs/gallery/README.md">浏览截图图册 · View the product gallery</a>
</p>

## 为什么使用 SysTorch

普通模型 API 只回答“哪个服务收到了请求”。SysTorch 还记录“这个决策走了哪条路径、经过哪些尝试、是否交给人判断，以及结果怎样回到调用方”。

一个典型流程：

1. Agent、Harness 或使用者提交一个或多个有稳定 ID 的结构化问题。
2. SysTorch 沿 DAG 在本地或云端决策服务间选择；路由辉光显示实际请求与响应。
3. 某个任务需要人判断时，决策台保存请求。调用方可以退出后再回来取结果。
4. 成功回复、失败尝试、重试与路由轨迹保留在同一会话中，方便追踪和复核。

这套核心可以在没有 OpenAI、Anthropic 等通用文本生成 API 的情况下运行。连接远端决策服务时，请求会发送到你所配置的上游；“本地模式”不等于离线。

## 产品能力

- **开始**：标准聊天式入口；支持 Noul、Choice、Score、Box 结构化问题、一次发送多题、共享背景和附件。
- **持久人工作答**：提交后退出调用程序，在决策台作答，再由同一调用方取回；支持鉴权、幂等、过期、原子多题答案与重启恢复。
- **可编辑 DAG**：组织公开入口、可复用路由节点和提供商出口；每条边独立绘制，按请求事件发光。图编辑按原子操作提交，非法更新会回滚。
- **本地服务生命周期**：提供商可配置启动、停止、状态探测与进程策略；权限门默认关闭。
- **附件与媒体**：图片、音频、视频和普通文件统一登记。界面不因当前提供商提前拦截；适配器不能无损转换时给出明确的格式/能力错误。官方 TypeSafe 图片投影限制为 PNG/JPEG；其他媒体需目标服务显式兼容。
- **可追溯历史**：入口视角按父请求聚合，提供商视角列出真实上游尝试；调用正文、答案和凭据不写入普通路由历史。
- **Agent API 与 CLI**：人类操作与调用方身份走同一套鉴权和持久数据边界。

当前内置上游适配器：Vercel、Laya、TypeSafe SystemOne 和 OpenRouter。OpenRouter 是上游转换适配器，不是 OpenAI/Anthropic 聊天兼容入口。对外服务仍使用 Jev/SystemOne 决策协议；SysTorch 是产品名，不绑定单一模型或供应商。

## 预发布说明 · v0.12.0

v0.12.0 是 SysTorch 的预发布版，收口 canonical SysTorch API、结构化路由轨迹和「开始／决策台」对调用历史的呈现。它面向 Windows x64 与 Android arm64，**尚未经维护者人工验收**。

- Windows 提供单文件 Standalone EXE。当前没有 Authenticode 证书，Windows 可能显示未知发布者提示。
- Android 提供 arm64 APK，使用稳定 Android 签名；安装身份保留旧值以支持覆盖升级和读取既有任务数据，应用显示名与界面品牌为 SysTorch。
- Android 真机相机/相册、权限拒绝、后台生命周期等仍需维护者在设备上验收。
- 预发布版本用于测试，不表示所有上游都支持所有题型或媒体格式。

[下载 v0.12.0 预发布版](https://github.com/ARCJ137442/SysTorch/releases/tag/v0.12.0)

## 快速开始

### Windows / Android

从 [GitHub Release](https://github.com/ARCJ137442/SysTorch/releases) 下载对应附件。Android 可通过安装器覆盖更新已安装的稳定版；若 Android 报签名不一致，请停止安装并联系维护者，不要先卸载旧版，以免丢失其私有数据。

### 从源码运行

需要 Rust stable、Node.js 20 和 npm。

~~~powershell
$env:SYSTORCH_CONFIG = "rs\providers.example.toml"
cargo run --manifest-path rs/Cargo.toml
~~~

另开终端启动前端开发服务器：

~~~powershell
npm ci --prefix ui
npm run dev --prefix ui
~~~

设置了 SYSTORCH_CONFIG 时，daemon 会使用该配置。旧的 JEV_SWITCH_CONFIG 等环境变量仍作为升级兼容别名；新部署请使用 SYSTORCH_* 名称。

### Agent / 调用方

完整的外部 Choice 示例、调用 Token 配置位置和“提交—退出—人工作答—取回”步骤见[外部调用指南](docs/guides/SYSTORCH-EXTERNAL-CHOICE.md)。HTTP 请求与错误语义见[契约目录](docs/contracts/00-INDEX.md)。

## 架构与安全边界

Rust daemon 持有上游凭据、DAG、SQLite、事件与加密的 SysTorch 会话；React 界面通过本机或远程 gateway API 访问；Tauri 壳提供 Windows 与 Android 应用容器。桌面与 Android 的显示品牌为 SysTorch，持久用户数据目录、已安装身份、owner key、历史协议和旧环境变量作为兼容锚点保留。

每次模型请求都会发送到其实际选择的上游。上游 API key 由 daemon 持有，普通聊天与人工作答正文使用 owner key 加密；路由历史只保留安全元数据和 provider attempt。备份数据库时必须同时保管匹配的 SysTorch owner key，否则无法解密既有会话。

## 开发与验证

~~~powershell
cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline
cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline
cargo clippy --manifest-path rs/Cargo.toml --workspace --all-targets --locked --offline
npm test --prefix ui
npm run lint --prefix ui
npm run build --prefix ui
~~~

Release 与兼容标识说明见[发版手册](docs/RELEASE.md)；未来方向见[路线图](ROADMAP.md)。旧版 Jev Switch 的截图、tag 和故障核验保留在历史档案中，不代表 SysTorch 0.12.0 当前状态。
