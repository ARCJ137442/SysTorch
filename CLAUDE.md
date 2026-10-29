# SysTorch — 项目规则

## 产品边界

SysTorch 是面向人、模型与 Agent 的结构化决策运行时。产品显示名、图形标识、包名、文档和新发行附件统一使用 SysTorch；Jev / System One 是协议与模型系列。为支持原位升级，旧 Tauri identifier、Android applicationId、数据目录、owner key、协议字段及历史证据按品牌迁移记录保留。这些兼容身份不是展示品牌。

当前产品包含「开始／决策台」、普通加密会话、持久人工作答、既有 Jev 网关、可编辑 DAG、提供商服务启停、路由辉光和专业控制台。当前内置上游 adapter 为 Vercel、Laya、TypeSafe SystemOne 与 OpenRouter。OpenRouter 是上游转换 adapter，不是对外 OpenAI/Anthropic 聊天入口；TypeSafe 本地使用要求 SystemOne-compatible HTTP endpoint。

- local 表示网关运行位置，不代表离线；本地网关仍可连接远程上游。
- 对外服务入口与提供商配置是不同对象；不要混淆网关调用 Token 与上游 API key。
- 普通会话和持久 Choice 分开保存；普通 provider 调用历史不记录会话正文。
- 上游密钥只由 daemon 持有；不得输出、写入公开文档、日志、测试产物或提交。管理 API 仅返回掩码状态。
- 常规配置写入必须是原子资源操作；不得重新开放会破坏用户现有配置的整表覆盖入口。
- Android、Windows 旧标识、签名和用户数据目录是升级兼容边界；没有迁移方案前不得改 installed identity。
- 不要新开 worktree，除非用户明确要求。
- 不要提交、推送或发布，除非用户明确授权。当前任务已授权发布 SysTorch 0.11.0 预发布版。

## 当前交付状态

0.11.0 是 SysTorch 品牌迁移与「开始／决策台」的预发布候选；以 docs/verification/v0.11.0-pre-release-2026-10-30.md 中的证据为准。只有实际 Release workflow 完成后才能说 CI 与发布附件成功。该版本未经维护者人工实测；自动测试、CI 构建、模拟器核验和真机验收必须分别陈述。

GitHub Release 预期只公开 Windows x64 Standalone EXE 与稳定签名 Android arm64 APK。Windows 当前没有 Authenticode 证书。Android applicationId 与稳定密钥保留以支持原位覆盖升级。

## 设计和实施入口

- 当前工作与验收边界：docs/design/SYSTORCH-IMPLEMENTATION-PLAN.md
- HTTP/入口与网关契约：docs/contracts/05-HTTP契约.md、docs/contracts/07-入口网关修订.md
- 普通会话：docs/contracts/10-SysTorch开始会话契约.md
- 持久 Choice：docs/contracts/08-持久Choice契约.md
- 媒体资产：docs/contracts/09-SysTorch资产与多模态契约.md
- 原子配置写入：docs/design/ATOMIC-CONFIG-WRITE-PLAN.md
- 路线图：ROADMAP.md；规划不是当前发布承诺
- 文档导航：docs/README.md
- Android 构建与设备证据：docs/design/ROADMAP-PLAN-ANDROID-EXPERIMENTAL.md

## Android 约束

Android APK 面向没有 Termux 的普通用户。APK 必须包含 Android daemon 核心，且提供应用内启停；首次启动恢复本机网关，只有用户明确停止后才保持关闭。应用、通知和 Quick Settings tile 共用启停状态机。服务、通知、tile、权限、触摸和后台生命周期结论必须对应真实设备证据。稳定签名只使用 SysTorch 既有专属密钥。

## 仓库与验证命令

Rust workspace 位于 rs/，React UI 位于 ui/，Tauri 桌面和 Android 壳位于 src-tauri/。TypeScript 生成类型来自 Rust 的 ts-rs 导出。

| 任务 | 命令 |
|---|---|
| Rust workspace 测试 | cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline |
| Rust ts-rs 门禁 | cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline |
| Rust Clippy | cargo clippy --manifest-path rs/Cargo.toml --workspace --all-targets --locked --offline -- -D warnings |
| UI 测试、lint、构建 | npm test --prefix ui；npm run lint --prefix ui；npm run build --prefix ui |
| Tauri 测试 | 先 npm run build --prefix ui，再 cargo test --manifest-path src-tauri/Cargo.toml --locked |
| 本地 daemon | 设置 SYSTORCH_CONFIG=rs/providers.example.toml 后运行 cargo run --manifest-path rs/Cargo.toml |
| 网关健康 | http://127.0.0.1:11435/health |

新部署优先使用 SYSTORCH_* 环境变量。必要的 JEV_*、JEV_SWITCH_* 名称只作为旧配置兼容别名；不要把它们继续作为新产品的默认品牌或新文档主路径。版本、Release 文件名、README、网站与核验记录必须一致。

## GitHub 与发布

GitHub About 描述保持“英文一句话 | 中文一句话介绍”，与 README、官网和当前产品定位一致。发布步骤见 docs/RELEASE.md；发布页面文案见 docs/releases/。提交前检查所有跟踪及未跟踪改动；只暂存本次任务文件，排除 .tmp、.vite、构建输出、密钥和本机配置。
