# SysTorch「开始」会话与 M1 候选核验 · 2026-10-30

## 身份与范围

- 候选 build ID：`m1-systorch-20261030.3`。产品版本仍是 `0.10.3`；此为本地预览包，不是 commit、tag 或 Release。
- 本记录覆盖普通模型对话的 AEAD 会话、单消息原子追加/CAS、caller 隔离、历史附件、跨 daemon 重启恢复、桌面/触屏 UI；也回归既有人工多题 Choice/Score/Box、DAG/适配器、权限与备份路径。
- 本轮浏览器和 HTTP E2E 使用隔离 SQLite/owner key、合成请求与本机 fixture upstream；该合成套件 `realModelCalls=0`。另有一条独立 TypeSafe 官方 API smoke，见下文“Windows / Android 候选”。
- 完整 Edge/HTTP/SQLite 回归报告由本地合成夹具生成，不随公开文档分发；realModelCalls=0。真实上游 smoke 如有执行，另按单独记录描述。

## 会话 API 与存储

- Migration 011 新增 `systorch_start_sessions` 和 `systorch_start_session_assets`。会话正文、`JevRequest`、完整 `JevResponse`、错误码与路由 trace 用同一 SysTorch owner key AEAD 加密；元数据只包含 caller、revision、时间、置顶/归档/已读状态。
- API 只开放每条消息追加、revision 条件 PATCH、读取、单会话删除和父会话授权媒体读取；没有全表/消息列表替换写入。相同消息 ID/正文重试幂等，冲突 revision 返回 `409`；失败事务保留原 payload。
- 人工等待任务继续保存在 `decision_tasks`，普通调用仍写 `call_logs` 路由元数据。三者不混表。`GET /v1/systemone` 的 TypeSafe/Jev wire 请求与响应形状没有因会话落盘改变。
- UI 在调用上游前保存用户请求，响应回来后追加完整结果；失败保存稳定错误码/HTTP 状态/retryable/request ID，不持久化未经脱敏的上游错误 body。daemon 在第一步和第二步之间退出时，会话保留未完成请求并明确提示人工检查后再重试。
- 开始页附件强制上传到加密 asset store 后再发推理请求，`asset_id` 随 request 密文留存；`question_order` 保留用户输入顺序。删除会话时立即删除没有其他任务/会话引用的原始 asset 密文。

## 自动验证

- `cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline`：通过；包含 daemon 128 项单测、HTTP/监听/迁移集成测试。真实 TypeSafe live test 按设计 ignored。
- `cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline`：通过；新 `StartMessage`、`StartSession`、`StartSessionSummary`、追加与状态 PATCH 类型由 Rust 导出。
- `cargo clippy --manifest-path rs/Cargo.toml --workspace --all-targets --locked --offline`：通过，无 Clippy 警告。
- `cargo fmt --manifest-path rs/Cargo.toml --all -- --check`、`git diff --check`：通过；Git 仅提示现存 LF/CRLF 转换信息。
- `npm test --prefix ui`：90/90 通过；`npm run lint --prefix ui` 和 `npm run build --prefix ui` 通过。
- 完整 Edge/HTTP/SQLite 回归报告由本地合成夹具生成，不随公开文档分发；realModelCalls=0。真实上游 smoke 如有执行，另按单独记录描述。
- 一次较早的 UI 自动化运行发生过标签等待超时；后续完整回归成功。早期调试日志没有纳入公开档案。
- Edge/Playwright 触屏回归确认最新响应卡完整显示在窄屏 composer 之上、发送按钮留在 composer 内且无横向溢出；截图使用合成 fixture，不是发布版截图。
- scripts/verify-choice-example.mjs 对本机 M1 Standalone 预览完成两个独立 PowerShell 调用进程、主人作答、多题任务返回和普通会话恢复；realModelCalls=0。完整本机报告没有随公开文档发布。

## Windows / Android 候选

- Windows Standalone `SysTorch-m1-preview-20261030.3-windows-x64.exe` SHA-256：`5748998E39E18CEA4928BDDB36298F20F44794F3824E1A94A0B6755A1D08B69E`。`verify-windows-app-icon.ps1` 通过；Windows EXE 未做 Authenticode 签名，因为没有证书。
- `.3` Windows EXE 中的 `systorch-daemon.exe` 与本轮真实 API smoke 使用的 daemon 二进制逐字节一致，SHA-256：`05DBEA03F67A0B7C4BE169D707A43229AED98919502F5727E775FE609AF8EBE1`。
- 单独使用隔离配置通过 TypeSafe 官方 `jev-latest` 路由发送 1 个无敏感内容的 Noul 请求：HTTP 200、选中 `typesafe_live`、`upstream_calls=1`、耗时 397 ms、请求 ID `jev-1`，使用 333 输入 / 22 输出 tokens。完整 Noul 响应写入 AEAD 会话并重新读取成功；provider key 仅在进程内使用，扫描确认不在 daemon 日志或核验报告中。此项是真实模型请求，不属于上面的 synthetic 回归。
- Android arm64 APK `SysTorch-m1-preview-20261030.3-aarch64.apk` SHA-256：`ADBB1477DEDC34F9052E9BEAC459812E56A6C4F324DAEC8646117E969D9705CB`；大小 16,639,419 bytes。
- APK 签名：M1 专属预览密钥，与 `.7` 相同证书 SHA-256：`2C15DAA0102605E959ABCA45BAC21AEC07FE38F48C59C7E43A2ABEFE05B5B685`。这是测试签名，不是正式发布签名。
- Windows 图标从唯一 SysTorch 火炬母版派生，通过 ICO 彩色帧门禁。Windows EXE 没有 Authenticode 签名；本轮没有 Windows 证书。
- Android 17 个 launcher/task raster/themed icon、包身份 `.m1preview`、SysTorch 名称、新 native library、manifest 权限与签名静态门禁通过。APK 使用 `adb install -r` 覆盖更新既有 M1 AVD 安装，未清除 app data；`MainActivity` 前台、进程存活，内置 gateway `/health` 返回 `build_revision=m1-systorch-20261030.3`，首页显示 backend ok 和开始输入。本地 AVD 截图未纳入公开档案。
- AVD 是 `Medium_Phone_API_35` 的 x86_64 模拟设备，不是实体 Android 手机。没有在 APK 上配置真实上游，未进行 Android 真实模型调用、系统相机/相册授权或后台服务/通知/Tile 真机验收。

## 明确未覆盖

- 单次真实请求仅验证 TypeSafe 官方上游的连通、路由、Noul 响应解析与加密会话往返，不证明模型判断质量、其他模型或媒体能力。Edge/HTTP 合成回归仍保持 `realModelCalls=0`。
- TypeSafe 官方 adapter 目前仅能无损投影 PNG/JPEG；音频/视频仍需兼容 endpoint 与真实 adapter 的专门验证。
- 没有实体 Android 设备证据；不能用 AVD 安装/健康检查替代手机权限、键盘、相机/相册和后台生命周期验收。
- 会话 API 已支持 HTTP Agent caller token 的 caller 隔离；本轮没有单独扩展 CLI 命令或 OpenAPI Schema。
- 未提交、推送或发布；更大的 SysTorch 目标仍有设备验收与后续协议/媒体工作。
