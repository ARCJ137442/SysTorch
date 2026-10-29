# SysTorch 需求、工作包与验收覆盖台账

> 2026-10-24；设计输入与静态代码核对。不是产品验收记录。当前基线 `11253af` / `0.10.3`。

本表「当前基线」列保留设计吸收时的静态映射，不是随后 M1 的能力快照。M1 真实实现与逐项实测以[契约 08](../contracts/08-持久Choice契约.md)和[候选核验](../verification/systorch-m1-2026-10-24.md)衔接；未覆盖的完整服务 AC 不随 Choice 子集自动通过。

本表保留设计包原 ID；完整字段见[机器可读台账](systorch-intake-coverage-2026-10-24.json)。范围与依赖以[实施计划草案](../design/SYSTORCH-IMPLEMENTATION-PLAN.md)为准，事实来源与差距见[吸收核对记录](SYSTORCH-DESIGN-INTAKE-2026-10-24.md)。

## 46 项需求

“来源状态”沿用包内分类；confirmed_direction 不等于实现细节全部获批。已有能力按静态源码核对，新范围尚未实测。

| ID | 需求 | 来源状态 | 当前基线 | 阶段与处理 |
|---|---|---|---|---|
| R01 | 证据与实体必须可追溯 | `confirmed_direction` | 资料治理已有基础 | M0–M4：保留来源与实体校正；复核事实后才更新主张 |
| R02 | 以最强对手作竞争推演 | `confirmed_direction` | 历史研究可复用，当前竞争结论未重查 | M0 / 持续：同任务比较强对手和脚本/表单替代，允许否定优势 |
| R03 | SysTorch名称与渐进品牌重组 | `confirmed_direction` | 新名称已确认，产品尚未迁移 | M4：先识别系统，后展示名/资产/安装迁移 |
| R04 | 独立产品制作人全生命周期能力 | `confirmed_direction` | 非单项应用功能 | M0–M4 / 持续：每阶段连接判断、设计、验证、发行和维护 |
| R05 | 横向案例与纵向SysTorch结合学习 | `confirmed_direction` | 包内学习路径已吸收 | M0–M4 / 持续：用实际迭代案例学习，不额外堆教程功能 |
| R06 | 三方均为合法入口 | `confirmed_direction` | 协调入口已有，另外两类缺独立入口 | M0–M1：建立直接使用/提供判断/协调三条路径 |
| R07 | 保持已有网关/DAG专业价值 | `confirmed_direction` | 网关和DAG已有 | M0–M4：保留既有语义，补必要原子意图与投影一致性 |
| R08 | 开始页面向直接使用决策的人 | `confirmed_direction` | 尚无开始页面 | M0–M1：当前入口、明确问题/候选或模板、结果注解、无入口引导 |
| R09 | 决策台汇聚请求且像IM顺手 | `confirmed_direction` | 尚无持久人工收件箱 | M0–M2：真实待办、答题、草稿、恢复与结果反馈 |
| R10 | 实验场保留并强化人机评估 | `confirmed_direction` | 已有演练场批次/比较/本地历史 | M1 / M3：新增人工独立作答、返回、实验口径与证据 |
| R11 | 不扩成通用聊天或模型训练运行时 | `confirmed_direction` | 当前核心为Jev接口，符合主要边界 | 全部阶段：不增加通用聊天/下载/训练；保留评估与实验 |
| R12 | 同一事务跨工作面保持上下文 | `proposed_design` | 现有样例快照可复用，无持久任务上下文 | M0–M3：请求/修订关联、按权限投影、跨页返回，不强制同一表 |
| R13 | 面向个人和团队的可用性 | `confirmed_direction` | 现有admin/readonly不足逐任务隔离 | M1 / 后续团队：先单人授权范围及双设备冲突，再按真实需要拓展分派 |
| R14 | 火把探索未知应用空间的愿景 | `confirmed_direction` | 品牌愿景，不是现成功能 | M0 / M4 / 持续：以可理解的真实判断任务兑现探索意象 |
| R15 | 路由火炬图形、侧面数字1 | `confirmed_direction` | 最终图标母版未定 | M4，brief可前置：验证火炬/路由/侧面1在小尺寸与单色中的识别 |
| R16 | 视觉听觉与UI/UX概念地图 | `confirmed_direction` | 已有UI token，尚无新品牌视听体系 | M0 / M4：形成概念与识别brief；声音可关闭且服从注意力许可 |
| R17 | 正确ExoMind作为真实反思案例 | `confirmed_direction` | 实体已在包中纠正 | M0 / 可选：只引用正确ExoMind；不延续错误实体推论 |
| R18 | TouchAI日常采用与内存摩擦 | `observed_user_report` | 用户报告，不是本项目泄漏证据 | M0 / M2：实测资源和采用摩擦，区分不同人和任务 |
| R19 | 第一次价值与长期占用一起设计 | `proposed_design` | 尚无新工作面价值/占用证据 | M0 / M2：首用观察和驻留资源分别取证、联合裁决 |
| R20 | 披露配置但不给新手概念考试 | `proposed_design` | 控制台配置已有，新手路径欠缺 | M0–M1 / M4：诚实说明配置，按任务引导，不伪造开箱模型 |
| R21 | 异步请求、状态、查询与有限等待 | `confirmed_direction` | 即时async存在，持久决策服务不存在 | M1：持久接收/查询/取消/修订；有限等待作为显式兼容外观 |
| R22 | 严格投影与薄扩展 | `confirmed_direction` | 现有Jev响应含扩展，非新strict视图 | M1：严格序列化与增强资源分开，验证指定客户端合同 |
| R23 | polyfill自动化且真实来源分层 | `confirmed_direction` | 模型解析已有，人工polyfill未实现 | M1 / M3：观察/派生/证据分层并记录算法版本 |
| R24 | 概率调节低负担且可高级编辑 | `confirmed_direction` | 已有结果显示，缺人工概率交互 | M1 / M3：默认低负担，概率编辑可选；归一和选择保真 |
| R25 | 请求更多信息的有限交互 | `confirmed_direction` | 尚无持久澄清流程 | M1：修订后旧答失效；条件和拒答不偷偷批准 |
| R26 | JSON面向人的保真渲染 | `confirmed_direction` | 已有JSON输入与题型编辑 | M1：安全通用阅读、原始值/路径、大内容和嵌套披露 |
| R27 | 多端通知按人授权与宿主限制 | `confirmed_direction` | 已有网关原生通知，非任务通知 | M2：许可、深链、静音、锁屏隐私与权限拒绝路径 |
| R28 | 快捷键/IME/焦点/触摸完整 | `confirmed_direction` | 已有IME保护/触摸/全局键盘 | M0–M2：分离焦点/选择/提交，补连按与新任务不抢焦点 |
| R29 | 设置注册与命令检索统一 | `confirmed_direction` | 搜索和能力声明分别存在，未统一 | M2：逐步同源化设置/搜索/命令/API和覆盖来源 |
| R30 | 图片Box存在性与专用交互 | `confirmed_direction` | 协议与UI均无Box | M3：存在性、坐标、图像变换、触摸与严格投影失败 |
| R31 | 未来多模态能力协商 | `confirmed_direction` | 仅有媒体扩展传递基础 | M3 / 后续：实际模态协商、附件权限/大小/留存，不能宣称全支持 |
| R32 | 多源对照/影子/聚合等分开 | `confirmed_direction` | 模型生产策略已有，人机语义未设计 | M3：并排实验、shadow、race、聚合、级联分别验收 |
| R33 | 实验导出与科学证据边界 | `confirmed_direction` | 已有样例导入导出，非实验证据包 | M3：JSONL/CSV+manifest，缺失/辅助/原生/派生分列 |
| R34 | 隐私、TTL、容量与安全 | `confirmed_direction` | 现有脱敏与粗粒度鉴权可复用 | M1–M4：正文隐私、最小授权、TTL/容量、备份/删除/加密边界 |
| R35 | 有限可知但协调方有可控责任 | `confirmed_direction` | 现有调用trace可复用 | M1–M3：协调方持久受理、关联、终止和查询；不保证外部动作exactly once |
| R36 | 元决策Harness与规则消费者 | `confirmed_direction` | 只有路由规则，无新元决策Harness | 可选 W20：有界执行、明确预算/trace，不成为核心功能依赖 |
| R37 | 已确认不等于已实现 | `proposed_governance` | 旧证据版本化基础已有 | 全部阶段：计划、原型、代码、实测、发布状态分列 |
| R38 | 宣发是任务证据而不是架构包装 | `confirmed_direction` | 现有README/官网可复用 | M4：以真实任务和演示身份讲价值，不以架构词冒充采用 |
| R39 | 发布、升级、迁移和维护可持续 | `confirmed_direction` | 已有多渠道流水线 | M4：旧格式迁移、候选身份、安装/升级/回滚与支持 |
| R40 | 开放社区和抗替代的积累 | `proposed_strategy` | 策略假设，不是现成壁垒 | M0 / M3–M4 / 持续：开放合同/适配/可复查数据，验证可替代性 |
| R41 | 不把创作者当市场全部用户 | `proposed_research` | 尚无本轮真实用户研究 | M0 / M2：记录任务与熟悉度，不以制作人偏好代表市场 |
| R42 | Astra学习与Luna实现共用裁决 | `confirmed_direction` | 包内交接已阅读，本轮建立统一入口 | M0 / 持续：共享R/D/W/AC与证据，讨论不自动批准实现 |
| R43 | 资源预算影响产品承诺 | `proposed_design` | 已有daemon遥测，缺全进程预算 | M0 / M2：先测再定预算；空闲/隐藏/轻驻留/退出分别测 |
| R44 | 品牌与功能互相兑现 | `proposed_design` | 新品牌承诺尚未由产品验证 | M0 / M4：三条任务路径、截图、安装体验与宣传一致 |
| R45 | 避免一步到位的全量重写 | `proposed_delivery` | 现有栈可复用，无需重写 | 全部阶段：保留即时路径，在daemon增量持久编排 |
| R46 | 持续品鉴、学习与独立判断 | `confirmed_direction` | 学习路线存在，未执行新实验 | 持续，穿过M0–M4：每阶段记录观察/反证/裁决/复盘，不另造功能大包 |

## 22 个工作包

M0 后续已完成本机自动基线、资料维护、导航状态合同与模拟原型核验，见[证据](../verification/systorch-m0-2026-10-24.md)。原生性能和实际用户采用仍未验证；其余实现包未开始。

| ID | 工作包 | 原依赖 | 实施阶段 | 本轮状态 |
|---|---|---|---|---|
| W00 | 读取当前工程与运行证据基线 | 无 | M0 | `AUTOMATED_BASELINE_DONE_NATIVE_EVIDENCE_SCOPED` |
| W01 | 建立需求裁决与证据入口 | W00 | M0 | `INTAKE_AND_PROGRESS_ENTRY_MAINTAINED` |
| W02 | 三入口任务路径与导航合同 | W01 | M0 | `NAVIGATION_AND_STATE_CONTRACT_DRAFT_READY` |
| W03 | 状态完整的交互原型 | W02 | M0 | `SIMULATED_PROTOTYPE_BROWSER_VALIDATED` |
| W04 | 持久异步Choice事务服务 | W00, W01 | M1 | `NOT_STARTED` |
| W05 | Human Provider与人工作答闭环 | W03, W04 | M1 | `NOT_STARTED` |
| W06 | polyfill与严格兼容投影 | W04 | M1 | `NOT_STARTED` |
| W07 | 可读JSON与渐进证据层 | W03, W05 | M1 | `NOT_STARTED` |
| W08 | 设置与命令统一索引 | W02, W06 | M2 | `NOT_STARTED` |
| W09 | 驻留模式与资源基线 | W00, W05 | M2 | `NOT_STARTED` |
| W10 | 跨端通知与注意力许可 | W05, W08, W09 | M2 | `NOT_STARTED` |
| W11 | Box与媒体能力专项 | W04, W06, W07 | M3 | `NOT_STARTED` |
| W12 | 实验场人机对照与返回 | W05, W06, W07 | M3 | `NOT_STARTED` |
| W13 | 路由火炬与语义设计系统 | W02, W03 | M4 | `NOT_STARTED` |
| W14 | 官网README与首用演示 | W05, W07, W13 | M4 | `NOT_STARTED` |
| W15 | 实际任务研究与Astra复盘 | W03, W05, W09 | M2 | `NOT_STARTED` |
| W16 | 品牌迁移与发布候选门禁 | W09, W10, W14, W15 | M4 | `NOT_STARTED` |
| W17 | 可维护诊断与支持循环 | W04, W08, W16 | M4 | `NOT_STARTED` |
| W18 | 与正确ExoMind的可选合同集成 | W05, W07, W10 | OPTIONAL | `NOT_STARTED` |
| W19 | 实验导出与开放适配包 | W12 | M3 | `NOT_STARTED` |
| W20 | 有界元决策Harness实验 | W04, W06, W07 | OPTIONAL | `NOT_STARTED` |
| W21 | 强对手与替代路径复核 | W01 | M0_AND_RECURRING | `NOT_STARTED` |

W05/W07 的最小渲染、W15 的早期观察、W13 的前置 brief、W17 的基础诊断调整详见实施计划第 6 节；没有删除原始依赖记录。

## 24 项验收

正式持久服务的验收仍全部 `NOT_RUN`；M0 模拟与基线证据不改变这些状态。机器台账保留每项的 given/when/then，可供无上下文 Agent 直接转为测试；不是只有标题。包内历史 fixture、报告阅读器截图、旧版人工测试不为这些新验收提供通过证据。M1 首个闭环需要其中的 Choice 子集；M3 才覆盖 Box 等新增范围。

| ID | 验收 | 关联需求 | 阶段 | 状态 |
|---|---|---|---|---|
| AC01 | 多个请求不串答 | R09, R21 | M1 | `NOT_RUN` |
| AC02 | 重复提交与双设备冲突 | R21, R35 | M1 | `NOT_RUN` |
| AC03 | 过期或旧修订答案 | R12, R25, R35 | M1 | `NOT_RUN` |
| AC04 | 断网草稿与权威反馈 | R27, R28 | M1 | `NOT_RUN` |
| AC05 | 关闭工作台与重启恢复 | R19, R21 | M1/M2 | `NOT_RUN` |
| AC06 | 弹窗/输入法/焦点安全 | R28 | M0/M1/M2 | `NOT_RUN` |
| AC07 | 演示与真实模型分开 | R08, R20 | M0/M4 | `NOT_RUN` |
| AC08 | 协调视图权限与实际trace | R07, R12, R35 | M1/M3 | `NOT_RUN` |
| AC09 | 人工独立实验与返回 | R10, R12, R33 | M3 | `NOT_RUN` |
| AC10 | 实验统计口径 | R23, R32, R33 | M3 | `NOT_RUN` |
| AC11 | 带条件导出可复查 | R33, R34 | M3 | `NOT_RUN` |
| AC12 | 资源隐藏态 | R19, R43 | M2 | `NOT_RUN` |
| AC13 | 完整退出语义 | R19, R43 | M2 | `NOT_RUN` |
| AC14 | 压力睡眠恢复 | R19, R43 | M2 | `NOT_RUN` |
| AC15 | 品牌到安装的承诺一致 | R03, R38, R39, R44 | M4 | `NOT_RUN` |
| AC16 | 严格与增强视图 | R22 | M1 | `NOT_RUN` |
| AC17 | 概率补全保真 | R23, R24 | M1/M3 | `NOT_RUN` |
| AC18 | 条件/拒答不可变批准 | R23, R25, R35 | M1/M3 | `NOT_RUN` |
| AC19 | 任意JSON安全且可回溯 | R26, R34 | M1 | `NOT_RUN` |
| AC20 | 设置搜索与覆盖来源 | R29 | M2 | `NOT_RUN` |
| AC21 | Box不存在与几何映射 | R30, R31 | M3 | `NOT_RUN` |
| AC22 | 清理与配额 | R21, R34 | M1/M3 | `NOT_RUN` |
| AC23 | 通知隐私与静音 | R27, R34 | M2 | `NOT_RUN` |
| AC24 | 维护证据不漂移 | R37, R39, R42 | M0–M4 | `NOT_RUN` |

## 原话、历史意见和审计覆盖

31 条用户原话的归属映射、历史 17 组意见、D01–D13 裁决级别、H01–H08 待验证假设和 C01–C28 审计 ID 均保留在机器台账。原始对话未复制到公开文档；助手索引不冒充助手完整回复。原包全部 25 项来源本轮已阅读其登记，外部内容没有重新联网核实。

## 更新规则

- 只有对应代码、候选身份、测试范围和证据路径齐全后，才把某项实现/验收改为完成。
- 改变范围或依赖时，保留旧决定、原因与替代项，不静默抹去拒答、隐私或恢复要求。
- 新用户指令优先；讨论建议不自动变为发布授权。
