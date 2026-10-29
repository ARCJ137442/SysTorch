# SysTorch「开始」与决策工作台实施计划

> 状态：2026-10-30。M1 持久人工作答、普通决策会话、多题消息与资产能力已进入当前源码；当前准备发布 0.11.0 预发布版。本文是设计与实现记录，不替代 CHANGELOG 或候选核验。当前提交、推送和发布授权以维护者本轮明确指令为准；继续留在现有工作树。
>
> 版本边界：本文 S5 的 .3 EXE/APK 与 Android AVD 记录是 2026-10-30 的 M1 本地预览证据，不是 0.11.0 Release 资产。当前 Release 的版本身份和 CI 结果只记录在 0.11.0 核验文档。

## 1. 目标与范围

把产品首屏收敛为标准聊天式的「开始」工作面，让用户无需先进入控制台或演练场就能提交一个或多个决策问题、附加媒体、查看回复并追溯路由。调用方通常是 Agent、Harness 或自动化程序；人类可直接使用同一界面。协调方查看和编辑 DAG、提供商与路由；决策方处理待回答的人类任务。

开始页不是普通长文聊天器：SysTorch 请求以结构化问题为核心。用户消息和成功回复组成可追溯消息流；每个成功决策作为主回复，相关失败尝试显示在该回复下并可展开。调用时间、实际入口、provider attempts、模型、延迟和答案类型按需展开。

本计划保留原有 DAG、Sugiyama 排布、跨层走廊、点击区域、请求/响应辉光和提供商生命周期，不改写其语义。界面工作不得绕开权限、原子配置写入、调用记录和 Android 网关生命周期合同。

## 2. 已确认的设计基线

### 工作区与会话

- 「开始」是标准聊天式布局，默认空白欢迎态，中间留白；输入区贴近工作区底部。输入框不是窄屏居中的小卡片。
- 桌面宽屏使用左侧会话列表 + 右侧当前会话。窄屏和触屏不显示常驻导航栏；顶部菜单打开左侧抽屉，抽屉结合会话管理、角色切换、协调入口与设置入口。抽屉触控目标足够大；键鼠保留快捷键与右键语义。
- 会话支持按最后更新时间排序、置顶、新回复未读点、归档/恢复、删除和搜索。归档会话在设置中查看；清晰区分归档和删除。新建会话和当前模式入口位置稳定。
- 会话模式默认「标准聊天」。旧 B 并排结构已否决，不保留为可选布局。C 结构化编辑偏好作为用户设置，不改变默认聊天。
- 调用/协调/决策图标采用已经挑选的三个独立矢量图标：调用用入口/输出箭头（选中组 1），协调用路由分叉（选中组 1），决策用清单/勾选（选中组 5）。调用用户以 Agent、Harness 和自动化程序为主，不用人物头像隐喻。

### 消息流与编辑器

- 用户问题消息在右，模型/人工回复在左；成功回复作为主回复。回复卡与对应用户消息采用相同的内容自适应宽度规则；窄屏不产生水平滚动条。
- 失败尝试、拒答、超时和路由细节按需展开，仍可审计，不因渐进披露而丢失信息。
- 一条 SysTorch 消息包含共同背景和一个或多个有稳定 ID 的问题；共同背景可折叠且位于编辑器最前，图片/附件粘贴到背景时属于共享上下文，粘贴到问题时属于该题。
- 单题可直接发送；多个问题通过「队列」按钮累积，最后一次作为一个 SysTorch 请求提交。不能将一个批量问题悄悄拆成多个上游请求。队列只包含问题；发送时保留共同背景与每题附件。
- 键盘模式：Enter 发送当前消息；Shift+Enter 换行；Ctrl/Cmd+Enter 将当前问题加入队列并聚焦下一个问题输入框。触屏模式中 Enter 由输入法换行，队列和发送由明确按钮触发。
- 问题类型决定参数的结构，不称「回答形式」。以当前 Jev/TypeSafe 公开能力涉及的 Noul、Choice、Score、Box 为首期 UI 代表；若当前 Jev adapter/protocol 对某类型尚无真实支持，UI 只能标记未支持/开发中，不得把原型字段伪装成可执行格式。
- 选择入口统一称「选择入口」。提供商直连是把提供商节点作为入口，不另造第二套用户概念。
- 附件可从桌面/Android 文件选择器加入；手机额外支持拍照与相册。不能依据预先选择的 provider 阻止附加；发送时由能力适配器处理，不能等价转换时明确报格式/能力不匹配并保留草稿。

### API 与数据语义

- SysTorch API 是自有的规范超集；保留 TypeSafe-compatible `model/state/questions` 核心，扩展任务身份、状态、修订、资产、多个稳定问题 ID 和完整 SysTorch 答案映射。
- TypeSafe API 是可投影子集。只有剔除 SysTorch 扩展字段后不丢语义时才能投影；图片/音频/视频可使用小文件 inline base64 或大文件资产引用。provider adapter 负责必要格式转换；不得丢弃不支持/影响效果的字段。无法保真时返回可读错误和格式范围，而非静默降级、拆分请求或损失媒体。
- 媒体作为统一资产登记，声明稳定 asset ID、MIME、文件名/大小、hash、传输形式及其归属（共同背景或单题）。大文件资产由本机/daemon 资产存储引用；具体加密、配额、过期清理和鉴权须在实现前与现有存储契约合并，禁止引入未授权的公开资产 URL。
- 持久人工任务必须服从已有 M1 权限、幂等、截止时间、冲突与重启恢复语义。新增题型与多题任务必须原子地保存所有问题/回答，不能沿用单题结构后在读取时猜测映射。
- 失败上游 attempt、成功回复与入口级父请求关系可追溯到同一 SysTorch 消息；入口聚合一次调用的多个出口 attempt，提供商视角仍是单纯上游请求列表。

## 3. 当前实现状态（2026-10-30，源码核对）

| 能力 | 当前生产状态 | 目标/剩余 |
|---|---|---|
| 标准聊天式开始页与三角色 shell | 已有首轮 React 外壳、空态、消息流与响应式入口 | 完整视觉回归、键鼠/触屏交互和七页/既有 shell 回归 |
| 会话索引与会话抽屉 | 人工任务与普通模型会话共用抽屉；会话正文在 daemon AEAD 密文保存，列表只返回授权的解密摘要；聊天置顶/归档/未读/删除写入服务端，任务视图偏好保留在本地索引 | 普通消息复制/变体、归档设置页与无障碍继续打磨；会话正文不进入浏览器持久存储 |
| 调用方即时请求 | `/v1/systemone` 仍是推理入口；成功回复、失败结果、问题序与调用 trace 现在用独立 `/v1/systorch/sessions` 原子追加到加密聊天，不与 call_logs 或人工任务混表 | Agent 创建/继续普通会话的公开示例与服务端查询策略可继续扩展；不改变上游格式和路由调用语义 |
| 决策方持久任务 | 已支持加密任务列表、单题/多题、四种题型的作答与拒答/附条件观察；兼容 canonical `model/state/questions` 和旧 M1 envelope | 完成旧密文任务读取、版本并发和权限/失败边界的 Windows 真包复测；最终 API/Agent 描述需继续收口 |
| 多问题与问题类型 | 一条消息可一次提交 Noul/Choice/Score/Box 混合问题；问题 ID、队列顺序和答案映射保留，答案原子批量保存并投影为 Jev `answers` | 完成稳定请求写入契约、全部题型 UI/API 多轮回归；Box 框选当前为归一化坐标输入，后续可优化图片上的直接框选 |
| 图片、音频、视频 | SysTorch 资产描述符、加密上传/任务绑定、共享/单题引用、React 文件/粘贴/相机入口、TypeSafe 图片投影和 Box 图片关联已落地 | 官方 TypeSafe 只投影 PNG/JPEG image；本地音视频只对显式兼容 endpoint 透传；Android 原生 file chooser/camera 和更多 adapter 实测待验 |
| route glow / Dagre / provider lifecycle | 既有生产功能保留 | 本轮回归证明无 UI 路由切换重复辉光、配置/生命周期能力未退化 |
| Windows/Android 包 | `.3` 已从当前工作树构建；Windows native EXE smoke 覆盖人工作答、两轮普通模型聊天恢复，Android APK 通过同签名覆盖安装，在 `Medium_Phone_API_35` AVD `/health` 返回 build `.3`、首页 backend ok | 实体 Android 设备、相机/相册/权限拒绝与后台生命周期仍待人工真机验收；Windows EXE 未做 Authenticode 签名 |

## 4. 分阶段推进

### S0 · 基线与恢复

- [x] 检查开始页现有 shell、路由、M1 task API、i18n 与响应式样式。
- [x] 根据维护者批注确定标准聊天为默认、并排 B 淘汰、C 为可选结构化偏好。
- [x] 确认调用箭头/协调路由/决策清单图标方向，保持图标为 SVG/React vector，不用 emoji。
- [x] 检查窄屏无常驻侧栏；回复卡宽度匹配问题卡片。
- [x] 恢复并复核迭代计划文档，依据 M0/M1/品牌迁移合同重建当前计划，校正代码能力与文档陈述一致。

### S1 · 开始页 React 外壳（当前阶段）

- [x] 将「开始」加入主导航并保持其他专业工作面可达。
- [x] 实现桌面历史栏、窄屏抽屉、角色入口、模式偏好、空态与底部 composer。
- [x] 实现会话 pin/archive/unarchive/delete 与设置中的归档入口；本地索引不存问题正文。
- [x] 接入 durable task 并展示问题/状态，支持回答和刷新恢复。
- [x] 允许一条持久人工消息包含混合题型；所有题共用同一上下文和任务 ID，旧 Choice 请求保持可读可答。
- [x] 人工决策台以一道题为一个作答区；单次提交可原子回答多题，部分题的外部提交会保持 `pending`，重复同答案幂等、冲突答案返回 409。
- [x] 任务取回将答案按稳定 question ID 返回；旧单题严格响应键仍是 `choice`，新多题严格响应键与输入题目 ID 一致。
- [x] 新回复未读点在 completed 任务和部分已回答的 pending 多题任务上可见，打开对应会话后记为已读。
- [x] 修正可选身份/错误提示导致 CSS Grid 空行错位、挤压 composer 的情况；桌面和窄屏发送按钮必须位于输入框内且在首屏可见。
- [x] 普通模型 request/response 与人工任务分表；会话正文 AEAD 加密，附件与会话原子关联，caller scope、CAS revision、重复消息重试、归档/置顶/已读/删除和 daemon 重启恢复。
- [x] 开始页通过统一会话抽屉恢复普通模型对话；桌面续聊、刷新后打开与 390px 触屏布局经 Edge/Playwright + 合成 upstream 验证。
- [ ] 完成标准聊天所有响应状态、渐进披露和 Windows/Android 真包端到端验证。

### S2 · SysTorch 多题消息协议与存储

- [x] 持久任务接受 TypeSafe-compatible `model/state/questions` 核心与 SysTorch `entry/idempotency_key/ttl_seconds/question_order/assets/extensions` 加法字段；旧 `question/context/choices` 仍作为受校验的兼容输入。
- [x] 一任务多稳定 question ID；UI 一次提交整个问题集，回答用 `observations` 原子批量写入，任务完整性由全部题目都有观察来判断。
- [x] 复用现有 SQLite 事务与加密任务载荷，未新增迁移表；旧 M1 Task 缺少 `questions/order/observations` 时安全默认值可读。
- [x] 幂等键基于规范化 TypeSafe 子集与任务字段；会读取旧加密任务以识别跨旧 envelope/新 canonical body 的同语义重试。
- [x] 人工答案扩展到 Noul、Choice、Score、Box；服务端逐题匹配类型、范围和 Box 图片引用，无效批次原子拒绝。
- [x] 单题/多题人工结果投影为严格 JevResponse `answers`，保持题目 ID；Score 使用零起始 level index，Box 坐标归一化，拒答/附条件不伪造结果。
- [x] 覆盖多题部分/全部应答、重复/冲突提交、请求顺序镜像校验、旧 payload/旧 answer JSON 兼容与严格映射；决策专项单测通过。
- [ ] 扩展真实 EXE HTTP/SQLite/Chromium 回归，覆盖混合四题、多题权限、拒答/附条件、过期/取消、跨格式幂等、并发、重启恢复和 Agent caller 查询。

### S3 · 统一附件与 TypeSafe 投影

- [x] SysTorch asset descriptor：稳定引用、MIME、文件名、格式、inline base64 或上传 ID；`state`/`instructions` 中的 `_systorch.assets` 保存共享背景或单题归属；逐个精确引用校验。
- [x] daemon raw upload 使用受控 ID、加密负载、内容摘要、每文件/用户配额和过期时间；决策任务与资产链接在同一 SQLite 事务提交/清除，不暴露文件系统路径或公开 URL。
- [x] 开始页支持相册/图片、相机 capture、通用文件、粘贴和预览；共享背景与当前题分别入队。运行中的浏览器视口回归通过；拖放与实际 Android 原生选择器/相机仍待真机确认。
- [x] Provider 能力由 adapter 声明；无能力候选跳过且不计为实际请求，shadow 不兼容时记录为未发送；支持文件编写后在提交/适配边界给出可恢复错误。
- [x] TypeSafe 官方图片投影输出严格 `{type, format, data_base64}`，检查 PNG/JPEG 签名、尺寸和官方大小限制并加必需图片 header；Box 题缺少图像时明确拒绝。其他 TypeSafe-compatible 本地端点须显式启用 extension forwarding，音频/视频 descriptor 保真透传。
- [ ] 转换前后摘要与完整 route/call trace 关联；目前只保留原 SysTorch 请求的稳定 asset reference 和 adapter 边界错误。
- [x] 当前覆盖子集：TypeSafe 官方图片投影/header与非图片类型明确不支持、本地兼容 endpoint 保留 audio/video/file descriptor；加密 registry 覆盖 image/audio/video/file 上传、内容字节往返、caller/父会话授权与删除回收；UI 覆盖小文件内联、大文件 ID 复用、桌面/触屏通用文件选择器与 PDF 发送。另覆盖 PNG MIME 冒充/尺寸、TypeSafe Box 缺图、引用精确匹配、跨 caller 拒绝、任务/资产原子链接与 Box 图像关联。
- [ ] 后续矩阵：损坏密文/hash、过期 ID、配额/64 MiB 边界、重复 ID、失败/重试后缓存清理、超过 TypeSafe 图像限制时保留草稿、每种系统 adapter 能力、真实 Android 文件/相机/相册与权限拒绝。

### S4 · 消息聚合、路由追踪与桌面/移动打磨

- [ ] 成功的每个决策作为主回复；失败分支附在相关回复下，按需展开。每个答案通过 question ID 回链到问题。
- [ ] 开始页展示当前入口和本次路径的轻量注解；详情可以追到 route graph、provider attempts、状态码和调用记录。
- [ ] 一条父请求产生多条上游 attempt 时，历史与统计分别遵循入口聚合、提供商平铺语义。
- [ ] 恢复/打开聊天不重播旧辉光；仅真实新 route event 驱动视觉反馈。保留 Dagre、长边避让和 pointer interaction。
- [ ] 键盘、鼠标、触屏、多行输入、IME、长按上下文、窗口宽窄、移动端状态栏与输入法顶起均覆盖；避免横向滚动条和底部遮挡。
- [ ] 全面中英国际化；SVG 图标、焦点环、ARIA 状态和减少动态效果偏好齐全。

### S5 · 构建与交付候选（2026-10-30 .3 历史快照）

- [x] UI 测试 90 项、Rust workspace 默认与 `ts-rs`、lint/build、`cargo fmt --check`、`git diff --check` 与混合四题 Playwright 回归通过；详细证据见核验记录。
- [x] Windows Standalone `.3` 已构建，图标门禁与 native isolated E2E smoke 通过；覆盖权限、并发幂等/冲突、重启恢复、四题混合、取消/过期/澄清/修订、备份恢复、两轮普通模型聊天持久化与多视口 UI。全部模型响应来自本地合成 upstream。
- [x] Android arm64 `.3` 已构建，包名、稳定测试签名、图标与权限静态门禁通过；同签名覆盖安装到既有 `Medium_Phone_API_35` AVD 后，确认 MainActivity 前台、进程存活、gateway `/health` `build_revision=m1-systorch-20261030.3`、首页 backend ok。这不是实体设备验收。
- [x] TypeSafe 官方路径在隔离测试数据库中完成 1 次真实 API 请求：Noul、Choice、Score、Box 与一张合成 PNG 同批返回 HTTP 200；费用未知，详见核验记录。没有复制或触碰原调用历史。
- [x] 已生成可复核 `.3` 预览 EXE/APK、哈希与核验说明；候选不是 Release，仍未提交或推送。EXE SHA-256 `5748998E39E18CEA4928BDDB36298F20F44794F3824E1A94A0B6755A1D08B69E`；APK SHA-256 `ADBB1477DEDC34F9052E9BEAC459812E56A6C4F324DAEC8646117E969D9705CB`。

## 5. 跨层安全与兼容约束

- 不创建第二条隐式默认入口，不因本地服务未启动暗中切到云端；提示可启动本地 provider 或选择其他入口。
- 不在浏览器 localStorage、调试日志或 toast 写入问题正文、媒体 bytes、token 或 secret；敏感媒体和待答内容服从 daemon 加密与访问授权。
- 请求接受与答题提交使用持久化原子事务。UI 中的加载/动画只反映真实状态，不把已发送当已接受，也不把人工来源伪装成 provider HTTP attempt。
- 稳定 ID 保持 request/question/answer/asset 层级；记录与路由源信息可追踪，老数据迁移和 unknown fields 不被静默丢弃。
- provider 不支持特定媒体或题型时，允许用户完成编写并保留草稿，在提交/适配边界报告具体原因和可行替代，不提前用所选 provider 限制用户表达。
- 保留 daemon HTTP/RPC 鉴权、Android start/stop 原生 RPC、provider lifecycle 所有权和 DAG 原子配置写入；UI 不拥有或重实现后端权限。

## 6. 终止条件与状态记录

阶段只有在代码、自动测试、预览或设备证据和文档四者一致时才可标记完成。每个结果必须写清 commit/build identity（本轮未提交时写工作树状态）、平台/视口、数据是否合成、实际/模拟 provider、通过项、未覆盖项。自动测试不能替代 Android 真机记录；预览页面不能被称为 production UI。

当前状态：S1 的标准聊天外壳、多题队列、决策台和普通模型聊天持久化已实现；request/response/failure 为独立加密会话消息，附件通过同一 SQLite 写事务绑定父会话，UI 可以重开和继续会话。S2 实现 canonical `model/state/questions` 持久任务、M1 旧格式兼容、混合 Noul/Choice/Score/Box 和严格映射；workspace 默认/`ts-rs`、UI、Clippy、Windows native isolated E2E、Edge/Playwright 多视口和 Android AVD 冒烟均已通过。S3 加密资产存储、会话/任务附件读取授权、TypeSafe 图片/Box wire projection 和显式 local multimodal forwarding 已实现；隔离 TypeSafe 官方路径已有一次真实合成 PNG 请求成功证据。音频/视频没有官方 TypeSafe 原生投影；实体 Android 的文件/相机/权限路径仍无设备证据。真实上游请求、桌面/Android 包 smoke 和浏览器合成验证分开记录；浏览器合成回归拦截全部 `/v1/*`。

生产页面合成回归：运行本地 Vite（仅绑定 `127.0.0.1`），再执行 `node scripts/verify-systorch-start-ui.cjs http://127.0.0.1:5175`。Playwright 将拦截所有 `/v1/*` 并使用合成 fixture，验证单条持久多题请求、批量回答、未读点、桌面/390px 触屏抽屉和无横向溢出；它不连接真实 daemon、模型或上游。Playwright 不作为 npm 依赖，需由开发环境提供模块解析路径。
