# SysTorch CLI

**状态：** v0.4.0 CLI Phase 1（尚未经人工实测）<br>
**作者：** GPT-6 Luna xhigh（OpenAI Codex）<br>
**AI 披露：** 本文由 AI 协助整理；命令边界、鉴权和发布范围以项目维护者确认的 HTTP 契约为准。

SysTorch CLI 是 daemon HTTP API 的轻量客户端，适合 Termux、SSH、脚本和没有浏览器的调试环境。它不复制路由内核、SQLite 或 provider key 管理；Web 控制台和 Tauri 仍是完整交互主战场。TUI 尚未包含在本阶段。源码保留 Jev Switch CLI 命令别名，旧脚本仍使用同一命令解析器；历史发行附件保持其原名。

## 安装

从源码构建：

```bash
cargo install --path rs/crates/systorch-cli --locked
```

Termux/Android arm64 使用设备本机 Rust 工具链执行同一命令。已有 [Termux 核验](verification/termux-build-deployment-2026-09-27.md)证明 daemon、`/health`、`/v1/models` 和同源 Web UI 烟测可行，但不把它外推成 Tauri Android 或预编译 Android CLI 发布支持。

Windows/Linux Release 会提供对应主机的 CLI 二进制；Termux 仍建议本机编译，以匹配 Android host 工具链。

## 鉴权与地址

```bash
export SYSTORCH_URL=http://127.0.0.1:11435
export SYSTORCH_TOKEN='网关调用 token'
export SYSTORCH_ADMIN_TOKEN='cloud 模式下的 admin managed token'
```

SYSTORCH_TOKEN 只用于 /v1/models 和 /v1/systemone；SYSTORCH_ADMIN_TOKEN 只用于 status 的 admin 状态、routes 和 events。local loopback 按 daemon 现有边界可不设置 token。JEV_SWITCH_URL、JEV_SWITCH_TOKEN 和 JEV_SWITCH_ADMIN_TOKEN 仍可作为旧脚本兼容别名；新脚本请使用 SYSTORCH_* 名称。不要把 token 放进命令行参数、shell history、请求文件或日志。

## 命令

```bash
systorch-cli status
systorch-cli --format json models
systorch-cli routes
systorch-cli events --since 0 --limit 50
systorch-cli invoke --file request.json
cat request.json | systorch-cli --format json invoke
```

`request.json` 必须是 Jev 原生 `{model,state,questions}` 请求。CLI 对 stdin/文件输入限制为 2 MiB；`events --limit` 最大为 500。`routes` 和 `events` 当前只读，写路由仍通过 Web 控制台/API 完成。

表格输出面向人阅读；`--format json` 输出稳定 JSON，适合脚本。`invoke` 的表格输出会显示 request ID 和结构化答案摘要，原始响应仍可用 JSON 模式取得。

## 替代方案

普通 Android 用户优先使用自带 daemon 的 APK，无需 Termux。只有需要 SSH、脚本或终端自动化时才选择 CLI／Termux 路径。CLI 只承诺当前 API 的薄转发，不承诺复制完整 Web/Tauri 功能。

M1 本地候选的持久 Choice 使用独立 HTTP 通道，当前 CLI 尚无 `decisions` 子命令。调用方／Agent 可按[契约 08](contracts/08-持久Choice契约.md)用 HTTP 提交、查询、取回或取消任务，不把旧同步 `invoke` 命令当持久等待接口。

— GPT-6 Luna xhigh（OpenAI Codex），AI 辅助整理
