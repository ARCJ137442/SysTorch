# SysTorch 资产链路核验 · 2026-10-29

## 范围与身份

- 源码版本字段：`0.10.3`；工作树有未提交更改，本记录不对应 commit。
- 范围：SysTorch asset descriptors、加密临时存储、任务链接与删除、provider media capability skip、TypeSafe image/Box wire projection、开始页附件输入及 scoped task media retrieval。
- 按维护者授权，使用既有 TypeSafe 配置完成 1 次真实上游请求；没有提交、推送或发布。
- 候选 .7 是本轮本地预览身份：Windows EXE SHA-256 E50E54D6D457A8EFE39CAD2BC165AE204DC4D6782FEBDF285B252A9B104ECBE2，Android arm64 APK SHA-256 37DA56079A9F119C2261A38100AE164BE773299AF64BE43D1B8AD6BE8B559B6B。未提交的预览包不属于 Release 资产。

## 自动验证

- `cargo check --manifest-path rs/Cargo.toml --workspace --locked --offline`：通过。
- `cargo test --manifest-path rs/Cargo.toml -p jev-core --locked --offline`：63 项通过，含不兼容 shadow 媒体跳过且不计实发。
- `cargo test --manifest-path rs/Cargo.toml -p jev-adapters --locked --offline`：TypeSafe PNG 投影/必需 header、尺寸与 MIME 拒绝、Box image 要求、原生 Noul/Choice/Score wire fixtures 及现有 adapter 回归通过；实时官方测试仍按原标记 ignored。
- `cargo test --manifest-path rs/Cargo.toml -p systorch-daemon --locked --offline --lib decision_asset`：2 项通过，覆盖跨 caller 拒绝/事务回滚、合法任务绑定和清除资产；精确引用校验有独立断言。
- 完整 `cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline` 与 `cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline` 均通过。类型门禁已于 2026-10-29 重新执行，退出码为 0；不固定记录会随候选持续变化的分 crate 测试数量。
- `npm test --prefix ui`：90 项通过。
- `npm run lint --prefix ui`、`npm run build --prefix ui`：通过。
- `cargo fmt --manifest-path rs/Cargo.toml --all -- --check` 与 `git diff --check`：通过。
- `node scripts/verify-systorch-start-assets.cjs http://127.0.0.1:5175`：Playwright 拦截全部 `/v1/*` 并使用合成 fixture。一个多模态持久 Choice 请求包含共享图片与单题视频，各自映射到不同引用；两份媒体经加密资产 API 上传，按 task 权限读取。另一个即时模型请求以 inline base64 发送小图片。上传头、文件长度、MIME、资产范围、路由请求数和页面错误均核验。
- `node scripts/verify-choice-example.mjs`：通过 7 项隔离原生 EXE 检查；两个独立 PowerShell 调用方进程在提交后退出，持久任务仍可由拥有者作答并按题目 ID 取回，多题请求保持同一父任务；无真实模型调用。
- Tauri MCP 当前会话不可用；桌面验证改用隔离 Windows EXE、Playwright 与 Chrome DevTools Protocol。Android 使用既有 `Medium_Phone_API_35` AVD 做安装、启动和首屏 smoke；这不是实体手机验收。

## 既有 TypeSafe 上游实测

- 从用户旧 runtime snapshot 仅复制 `runtime_config`、`global_config`、`service_endpoints` 到临时隔离数据库；未复制 13,278 条历史调用记录，未改原 `providers.toml`/数据库。测试结束后已停掉专属 daemon，并清除临时数据库、owner key、配置硬链接和图片。
- 经公开入口 `jev-rime` → provider `jev-typesafe` → upstream model `jev-latest` 发出 1 个真实请求，包含 Noul、Choice、Score、Box 四题和一张 300×300 合成 PNG；HTTP 200、`upstream_calls=1`，四类答案均返回；usage 为 1261 input / 77 output tokens，request ID `jev-2`。成本字段为 unknown，不能据此断言零费用。
- 首次真实预检在上游发送前发现 daemon 的 `TimedUpstream` 和 `LifecycleGateUpstream` wrappers 没转交 `supports_asset_type`，导致图片被误跳过；修复后加了 wrapper 回归并成功完成上述实测。

## 本地预览包

- Windows EXE `SysTorch-m1-preview-20261029.7-windows-x64.exe` 已通过图标门禁和隔离 native PowerShell/Chromium smoke。原生检查覆盖调用方进程退出后等待、权限隔离、并发幂等、冲突答案、重启恢复、四类混合问题、取消/过期/澄清/修订、备份恢复及多视口 UI；没有向真实模型发送请求。候选文件没有 Authenticode 签名。
- 候选 .7 是本轮本地预览身份：Windows EXE SHA-256 E50E54D6D457A8EFE39CAD2BC165AE204DC4D6782FEBDF285B252A9B104ECBE2，Android arm64 APK SHA-256 37DA56079A9F119C2261A38100AE164BE773299AF64BE43D1B8AD6BE8B559B6B。未提交的预览包不属于 Release 资产。
- Windows native waiting page 的字母 `J` 占位和重复图片元素已删除，改为 `src-tauri/shell/icon.svg` 单一品牌图，并将装饰辉光调低；SVG 与 `src-tauri/app-icon.svg` 完全一致。`ui/tests/systorch-loading-brand.test.mjs` 静态回归通过，确保启动页不再渲染旧 J 或重复 logo。APK 使用 `index.html` 启动入口，本次不包含桌面 waiting 页面。

## 视口证据

- 桌面：`1280×820`，文档宽度等于视口宽度，composer 底边约 `759px`，附件图像和视频预览可见。
- 移动视口：`390×844`，文档宽度等于视口宽度，composer 底边约 `765px`；相机输入含 `accept="image/*"` 与 `capture="environment"`；无页面错误。
- Edge/Playwright 截图使用本机合成附件，未纳入公开资料；可查看 docs/gallery 中明确标注为预览的截图。

## 未覆盖

- 真实 Android 设备上的 Tauri 文件选择器、相机应用、相册、权限拒绝、后台恢复与生命周期；AVD 首屏 smoke 不能替代这些真机路径。
- 真实 TypeSafe 图片/Box 请求已通过一次 synthetic PNG；仍需更多样本、失败/重试和真实模型准确性人工确认；真实本地音视频兼容端点仍未测。
- 哈希/密文损坏、配额上限与到期资产 HTTP 集成、多人/跨设备 permission matrix、拖放输入。
- 普通即时模型回复的跨会话持久化仍待完成；Android 相机/相册及实体设备权限矩阵仍待测；TypeSafe audio/video 官方投影与本地兼容端点仍待真实验证。
