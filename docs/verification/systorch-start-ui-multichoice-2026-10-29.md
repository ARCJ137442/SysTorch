# SysTorch 开始页与多题 Choice 验证

日期：2026-10-29<br>
工作树版本字段：`0.10.3`  ；未提交、未推送、未发布。此记录只描述当前工作树，不代表 Release 能力。

## 本轮范围

- 持久人工 Choice 任务可包含 1–32 个稳定 question ID，保留队列顺序，并要求旧 M1 `question/choices` 镜像首题。
- 一次消息创建一个父任务。调用方可以逐题提交观察，或一次原子提交多题答案；部分完成时任务仍为 `pending`，全题回答后完成。
- 单题重复答案幂等；同题不同答案冲突；未知 ID 或批次任一无效时，不保存批次中的其他观察。
- 新任务的严格 Jev `answers` 以问题 ID 为键；旧单题仍以 `choice` 为键。条件或拒答保持为原始观察，严格投影返回可读错误。
- 开始页人工 Choice 队列接入多题任务；决策台逐题展示与选择，并批量提交答案。旧单题 M1 载荷和请求体仍可读写。
- 完成的回复及部分已回答任务可在会话列表显示未读点；阅读后记录 last-read 时间。
- 修正开始页可选提示行缺失时的 CSS Grid 自动排布，避免 composer 的发送控件溢出输入框。

## 自动验证

| 检查 | 结果 | 范围 |
|---|---|---|
| `cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline` | 通过 | Rust workspace；局域网重绑定测试因本机默认出口不是私网，跳过依赖私网地址的子断言；没有伪报真机/LAN 验收 |
| `cargo test --manifest-path rs/Cargo.toml -p systorch-daemon --features ts-rs --locked --offline --lib` | 188 项通过 | 含新生成的 ChoiceQuestion、Submission、AnswerSubmission、Task TypeScript binding |
| `npm test --prefix ui` | 87 项通过 | 现有 UI 单元测试 |
| `npm run lint --prefix ui` | 通过 | TypeScript 无类型错误 |
| `npm run build --prefix ui` | 通过 | Vite production build |
| `rustfmt --edition 2021 --check`（4 个改动 Rust 源文件） | 通过 | decisions API/store/tests 与 LAN 测试辅助函数 |
| `git diff --check` | 通过 | 无 whitespace 错误 |
| `node scripts/verify-systorch-start-ui.cjs http://127.0.0.1:5175` | 通过 | 独立 Chromium + 合成 API fixture，不连真实 daemon/模型/上游 |

## 本地预览包

候选 ID 为 m1-systorch-20261029.1，应用版本字段为 0.10.3。本地 Windows/Android 预览包与哈希已记录；这些包不是 GitHub Release 附件，不能代表 0.11.0。

| 平台 | 文件 | SHA-256 | 核验 |
|---|---|---|---|
| Windows x64 | `SysTorch-m1-preview-20261029.1-windows-x64.exe` | `21D147C90BECF1115F6FC0511F7F90FD2197FA4569E3DEB51ADE70D0E38EFAEA` | Tauri Standalone Release tests 19 passed / 6 ignored；图标校验比较真实 PE 资源与 canonical SVG 衍生资产通过；本机隔离配置运行后，外部 PowerShell caller 提交/退出/查询、原生 UI 回答、两题单任务和按 ID 结果回取通过。无真实 provider 请求。Windows Authenticode 未签名。 |
| Android arm64 | `SysTorch-m1-preview-20261029.1-aarch64.apk` | `7F4F5F2080AD7CB55A87592108977E7A757D9C4A7028D9A2810145C9626720BB` | APK 签名校验通过；沿用 M1 预览 signer SHA-256 `2C15DAA0102605E959ABCA45BAC21AEC07FE38F48C59C7E43A2ABEFE05B5B685`；aapt 校验 M1 测试 applicationId、SysTorch 名称、新 native library、16 个 canonical 图标栅格和 1 个 Android 13 themed mask 通过。没有可用的专用 `SysTorch_M1_API_35` AVD；未安装到共享 AVD 或真实手机。 |

两个预览包用隔离 M1 application identity，不是正式稳定包；Android 包可与正式版并存。Windows 包为未经 Authenticode 签名的本地候选。候选已交付用于人工验收，但 Android 手势/输入法/前后台、通知与真机生命周期尚待维护者测试。

Windows 原生 smoke 的 7 项检查通过，覆盖两个独立 PowerShell 5.1 调用进程、多题任务、主人一次回答两题和按 ID 取回答案；realModelCalls=0。完整运行 JSON 使用本地合成数据，不随公开文档分发。

## 浏览器回归细节

- 桌面视口 `1280×820`：单个持久人工 POST 包含两题和稳定顺序；决策台一次 POST 原子提交两个 question ID 的观察；task 完成后列表显示新回复点。
- 直接模型路径：两题在一个 `/v1/systemone` Mock 请求中发送；人工作答路径没有调用 SystemOne。
- 触屏窄屏 `390×844`：全局导航隐藏，会话抽屉可打开，横向宽度不溢出；桌面与窄屏的 composer 操作按钮都落在输入框边框内且没有被窗口底部裁切。回归发现并修复了可选登录提示缺席时 CSS Grid 行自动错位的问题。
- 浏览器 localStorage 索引保存新任务 ID，但不含两道问题的正文。
- 模拟 API 将 `/v1/*` 全部拦截；`pageErrors=[]`。该测试证明 UI 请求形状与布局，不证明真实 daemon HTTP handler、真实模型推理、图片/音视频、原生 Tauri 或 Android APK 已通过。

## 未完成边界

- 当前持久任务多题实现只支持 Choice 子集；Noul、Score、Box 和图片/音频/视频资产未接入。
- M1 custom submission 尚不是稳定 SysTorch `model/state/questions` 标准超集；也没有完成 TypeSafe 双向保真 adapter 和多题事实修订。
- 即时模型回复正文仍只驻留当前窗口状态，完整会话持久化尚未落地。
- 已构建并做 Windows 隔离 native test；APK 完成静态资源/签名核验。尚未做 Android AVD/真机完整交互和全生命周期验收；未发真实 provider 请求。
- Codex 原生 Goal 未能重设：现有 Goal 处于 paused，Goal API 拒绝创建第二个未完成目标，且不支持编辑旧目标的 objective。本地执行基线保存在[实施计划](../design/SYSTORCH-IMPLEMENTATION-PLAN.md)。
