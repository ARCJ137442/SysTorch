# SysTorch 请求超集与 TypeSafe 投影核验

**状态：**此记录证明 canonical SysTorch request 与 TypeSafe 投影在基线 `0ce7c1e` 上的独立本地回归；它是 0.12.0 开发过程中的工作树检查点，不等同于最终候选构建。路由错误轨迹 UI、版本身份、打包与 Release CI 以[0.12.0 预发布核验](v0.12.0-pre-release-2026-10-30.md)为准。

## API 边界

- canonical 即时请求为 `POST /v1/systorch/systemone`，调用 token 权限与旧入口相同。
- Rust 生成的 `SysTorchRequest` 在 TypeSafe-compatible `model/state/questions/assets/extensions` 形状上增加 `question_order`。若提供，题序必须精确覆盖所有问题 ID 一次；非法题序以 `400` 拒绝，零 provider dispatch。
- Gateway 消费题序后，把 core 请求交给同一 DAG/provider adapter pipeline；TypeSafe WireMock 收到的 body 仅包含 `model/state/questions`，请求资产和兼容字段仍按现有 adapter 规则投影。SysTorch 和兼容 request ID header 同时返回，`Cache-Control: no-store` 防止调用正文被 HTTP/WebView 缓存。
- 旧 `POST /v1/systemone` 保持 Jev/TypeSafe-compatible wire shape，Playground 和旧 Agent 不需迁移。

## 验证证据

- `cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline`：通过，daemon/adapter/core/CLI 单元与集成测试全通过。
- `cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline`：通过，`SysTorchRequest.ts` 由 Rust 导出。
- `cargo clippy --manifest-path rs/Cargo.toml --workspace --all-targets --locked --offline -- -D warnings`：通过。
- `cargo fmt --manifest-path rs/Cargo.toml --all -- --check`：通过。
- `npm test --prefix ui`：93/93 通过；`npm run lint --prefix ui` 和 `npm run build --prefix ui` 通过。
- `scripts/verify-systorch-start-ui.cjs`：用浏览器合成 fixture 通过桌面、390px 触屏、360px 短窗口检查；请求经 `/v1/systorch/systemone` 发送，题序与 UI 显示顺序一致。该脚本拦截所有 `/v1/*`，不连接真实 gateway/provider。
- `scripts/verify-systorch-m1.mjs`：用本机编译的 Windows daemon、隔离 SQLite/owner key、真实 HTTP 和 Chromium 通过 28 项检查；覆盖 canonical 与 legacy 请求路由、TypeSafe 投影、非法题序不 dispatch、四种题型、人工作答权限/并发/过期、会话加密/重启/附件授权与 4 个视口。`realModelCalls=0`，`syntheticModelCalls=9`。本次 daemon binary SHA-256：`acf1cca5df6ef75dbe8d9054672ac510c5e7e05762317ec588b5ed41252a405c`。

## 仍未由本记录证明

- WireMock 与本地合成 upstream 证明了请求投影与调用链，不证明真实 TypeSafe 官方服务对新的 `/v1/systorch/systemone` 路径完成调用；已有官方 live 请求证据来自旧兼容 `/v1/systemone` 路径。
- 这次运行的是 Windows daemon 二进制和普通 Chromium，不是 Tauri Standalone 外壳，也不是当前代码重新构建的 APK。
- 当前 ADB 只发现共享开发模拟器；没有操作它。当前未取得实体 Android 的文件/相机/相册/权限或后台生命周期证据。
- 入口父回复与多条上游 attempt 的 UI 聚合、失败分支渐进展开、重开页面后辉光不重播仍按实施计划 S4 验收。
