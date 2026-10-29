# Jev Switch 产品重定位、生态位与命名探索

> **后续材料优先（2026-10-24）**：本文保留 10 月 19 日的调研与当时裁决。新的 SysTorch v2 设计包及[吸收核对](SYSTORCH-DESIGN-INTAKE-2026-10-24.md)、[实施计划](../design/SYSTORCH-IMPLEMENTATION-PLAN.md)承接未来方向；竞争实体、三入口、人工决策、资源与范围的冲突以新材料和用户最新指令为准。旧 HTML 为当时快照，未刷新为新交接报告，不能作为新实现或新竞品事实。

> 研究日期：2026-10-19 ｜ 类型：产品与竞品研究 ｜ 第一次弹窗后：用户选择新品牌 SysTorch；应用与仓库迁移尚未开始

## 弹窗已确认：SysTorch 的产品方向

第一次弹窗确认了三个相互关联的决定：

- **独立品牌：SysTorch。** 用户由 Touch 联想到 Torch（火把），以火把建立视觉形象，联结“1”、系统与探索 System One 模型自身可能性的含义。主题色倾向偏橙的黄色。此处记录命名与视觉方向选择，不代表商标、域名已经查重，也不代表应用标识已经迁移。
- **结构化编辑与用户预填模板。** 开始页保留文本框等低门槛输入，用类似剪贴板常用语的方式预填问题；用户可配置默认模板，或默认使用无需候选选项的 Noul。Noul 仍然需要明确的判断命题；不能把任意输入自动当成一个语义确定的判断。
- **工作台与网关。** 以现有网关技术为基础，兼顾开箱即用与 System One 模型潜力发掘。参考 LM Studio 的可用性，但进一步专注 System One 在日常中的用途。每一个产品决定都需要还原为具体、接地气、会高频发生的用户叙事，不能只以功能清单证明必要性。

下文的命名表保留为作出该选择前的探索；后续不再把未选择的名称与 SysTorch 并列为当前方案。当前需要继续明确的是具体日常任务、输入与问题的关系，以及一次任务如何反复使用。

## 一句话结论

Jev Switch 的机会不在于再做一个“能把 LLM 接起来、让 Jev 帮忙挑 LLM”的通用模型路由器，而在于成为 **Jev 与兼容 System One 决策模型的工作台和运行入口**：人可以立即发起一个有类型的判断，比较不同决策服务的结果，沿一张可解释的图把请求路由到本地或云端的 System One 服务；应用和 Agent 再通过同一套原子 API 调用与管理这些能力。

这保留了最初“Jev 原生入口 + 多上游”的技术根，又把产品体验从“配置完网关后才知道能做什么”推进到“打开就能做一次决策”。它也划清了赛道：Jev 是被使用、测试和路由的对象，不是替其他模型做客服、聊天或分类的一个小部件。

## 先把边界说清楚

TypeSafe 对 System One 的描述强调“decisions, not strings”：请求携带上下文和预先定义的问题，响应是 Noul、Choice、Score 等类型化答案及概率信息，供软件继续判断。它适合回答“这封工单应该进哪个队列”“这条请求是否需要人工审核”“几个候选哪个更符合条件”；它不是一个以续写长文为主的聊天模型。TypeSafe 也把 Jev 介绍为其第一个公开 System One 模型，而不是所有 System One 能力的唯一可能形态。

因此，本产品可以不把“Jev”放进未来品牌名，同时仍坚持“产品只服务 Jev / Jev-compatible System One 决策”。两句话不矛盾：前者是品牌与供应商的关系，后者是产品领域边界。品牌可以独立，协议仍明确支持 Jev；以后若兼容模型增加，用户不会因为品牌把它误认成 TypeSafe 官方客户端。

这里的“不依赖 LLM API”应作为硬边界写进产品定义：无需 OpenAI、Anthropic 或其他文本生成 API，用户也能配置入口、启动本地决策服务、提交 System One 请求、比较结果、查看实际路由并使用 Agent/API 管理。当前源码还含 Vercel、OpenRouter 等结构化决策适配器；它们如果保留，应被视为可选的 Jev 兼容决策后端，而不是把产品扩成通用聊天 API 聚合器。如果“只做 Jev”也意味着禁止任何由普通 LLM 适配出的兼容决策后端，那么这两类现存适配器需要单独重新裁定，本研究不擅自把它们当成核心定位。

## 从哪里来，又走到了哪里

项目在 2026-09-22 的初始计划中，需求写得很窄：暴露兼容 TypeSafe Jev 的 HTTP 服务，管理多个 Jev 上游，允许其他类 Jev 服务接入，并明确写下“这不与 LLM Agent 有关”。它不是先从“做一个聊天应用”起步，而是从一个开发者痛点起步：业务代码已经依赖 `state + questions → answers`，上游却散在 TypeSafe 官方、Vercel、OpenRouter、Laya 和本地服务里；每次换模型就得改配置或代码。

第一阶段的答案是一个小型本地反向代理。它只需把 Jev 请求接进来，选好上游，失败时按规则尝试下一个。这个答案是对的，但不完整：只有负责网关的人知道怎么调用；普通使用者看见的是 Providers、Endpoints、Routing 等术语，得先学配置结构，才能试一次模型。

后来功能沿着真实使用摩擦逐层长出来：入口将“外部 model ID”与上游资源分开；DAG 允许多跳和复用中间节点；调用历史能区分一个入口请求和多次上游尝试；桌面、Docker、CLI 与 Android 让同一个 daemon 有不同交付方式；本地服务生命周期则把“本机有个 System One-compatible 服务”从手工脚本推进到受控启停与就绪检查。每一步仍然围绕 Jev typed decision 的数据流，没有转成 LLM 生成平台。

现在你提出“默认进入开始页，打开后就能行动”，这不是放弃基础设施，而是为它补上第一位可直接使用的人：原来是开发者先配置网关，再把自己的程序接上；现在是普通用户先在应用里做一次 Jev 决策，再逐步发现这个结果背后可以换模型、看路由、接 API。

这个顺序很关键。一个只展示网关状态的桌面壳，用户必须先相信基础设施；一个先让用户完成一次可信的 typed decision 的工作台，则让路由图、服务启停和 Agent API 都能从具体成果中被理解。

## 赛道地图：我们与谁相邻，和谁不一样

| 产品 / 类别 | 它首先解决什么 | 与 Jev Switch 的真实交集 | 在用户定义的 Jev-only 赛道里如何看 |
|---|---|---|---|
| **Magpie** | 让 Claude Code、Codex 等 Agent 共用一个模型与账号入口，管理 Agent 配置、本地网关、通用模型路由与使用量 | 本地 gateway、provider、routing groups、路由可视化；同时能接 Jev / System One，也能让 Jev 当意图 classifier | **真实的产品与技术交叠，值得持续盯。** 但它的主要路由对象是各类文本生成模型/Agent 流量，Jev 是其路由能力之一。Jev Switch 的主对象应是 System One 决策服务和 typed answers |
| **LiteLLM** | 生产级多供应商 LLM 网关：统一 API、虚拟 key、团队预算、成本、日志、权限与高可用 | 当前支持 `/v1/systemone`、System One playground、负载均衡/故障切换；也能以 Jev 做 Auto Router classifier | **后端能力上的直接压力，产品范围不同。** 它已经证明通用网关可把决策模型纳入现有模型清单。JeV Switch 的空间是轻量、决策模型专用、可同时管理本地服务与人类决策实验，而不是复制企业租户、预算和 100+ LLM provider 面板 |
| **LLMGateway** | 面向开发者的一站式云/自托管多模型 API 与智能 Provider 选择 | 文档提供原生 System One 路由、模型目录、provider 选择、fallback，以及一般 LLM 的自动路由 | **协议入口有重叠。** 若用户只要“一个远程 `/v1/systemone`，背后转发给多个云 provider”，托管网关可以更省运维。Jev Switch 要用本地服务控制、决策工作台、可视 DAG 与个人/小团队可控边界建立理由 |
| **LM Studio** | 在个人电脑下载/加载本地模型、聊天、配置推理参数，并将本地模型作为 API server 暴露 | 它能运行 Jev-compatible endpoint，也提供聊天和 API 测试体验；本地启停与模型可用性是直接参照 | **更像本地推理运行时和体验参照。** Jev Switch 不需要重新实现权重下载、推理引擎或通用模型聊天；可以控制兼容服务、使用其 API，并把本地/云端 Jev 统一到一个决策协议工作台 |
| **Open WebUI** | 一个聊天 UI，连接 Ollama 与云 API，在会话中选择模型并比较 | 能提供“打开即可聊天”和连接本地/云模型的体验 | **是界面与 onboarding 参照，不是 Jev 的语义替代品。** 它的主要体验围绕文本对话；Jev Switch 的每条用户消息必须落到明确的 typed question 和决策结果 |
| **TouchAI** | 桌面 AI Agent：以自然语言作为入口，理解窗口、剪贴板、文件，并调用外部工具完成桌面动作 | 可作为快速唤起、无负担入口以及自然语言日常使用的产品体验参照 | **产品表面与生态邻接，不是底层 Jev 网关竞品。** TouchAI 的能力横向调用多种模型和桌面工具；Jev Switch 若独立命名，应强调专用决策工作区，可与 TouchAI 互补或形成集成 |
| **AutoJev / 同类 Jev-powered LLM router** | 用 Jev 或其它决策手段挑选通用 LLM、Agent、工具或推理档位 | 使用 Jev，甚至有本地 gateway 和 route log，因此技术外观很接近 | **按你的原则排除直接竞品。** 它把 Jev 当成“选择别的模型的 classifier”；Jev Switch 的使命是把 Jev / System One 模型本身交给用户和软件调用、实验和路由。它是边界反例与潜在互操作对象，不是我们的目标赛道 |

### 为什么 Magpie 必须重点观察

Magpie 不是一个简单的“切换配置文件”的小工具。当前官方资料把它描述为 Agent 的统一模型入口：管理 API Key、订阅账号、本地模型、Agent 接线和 route groups；gateway 能服务多个模型 API、重试和故障切换；Usage 记录模型、调用方、token 与成本。它还允许用 Jev/System One 的 Choice 请求来做意图路由，并在 Routing 页面展示 classifier 命中了哪条规则、哪个 model 回答了。

这意味着 Jev Switch 与 Magpie 在**管理表面**确实重叠：都需要 provider 清单、模型选择、路由图、调用历史和本地/云端接入。用户说“定位基本重叠”并非空想。但从官方文档看，Magpie 的中心问题是“每个编码 Agent 用哪个供应商/模型”，其 `/v1/systemone` 则把 Jev 保持为 decision model；Jev Switch 若把中心移到“怎么用一个 System One 模型作一个可执行、可检验的判断”，服务对象就不同。

更有用的竞争问题不是“Magpie 有没有 Jev”，而是：**一个只服务 System One 的产品，能否在决定任务、typed request 编辑、候选输出比较、本地服务生命周期、决策置信度与图路由解释上显著好过通用网关里的一页决策模型设置？** 如果不能，用户会自然选择更宽的 Magpie、LiteLLM 或 LLMGateway。如果能，通用网关可以是集成对象，而不是必须正面复制的全套产品。

### AutoJev 为什么不列为我们的直接竞品

AutoJev 的官网定位很清楚：为 Codex、Claude Code 等 Agent 提供 OpenAI/Anthropic-compatible 本地 gateway，让路由 `autojev/fast` 把通用 LLM 请求送到某个 provider/model；Jev 智能选择接收的是任务特征和候选模型元数据，最终挑出哪个生成式模型来写回答。这个方案很有价值，但优化目标与 Jev Switch 不同。按照你的产品原则，它属于“Jev 作为更大模型系统的挂件”，不能因为同样出现 Jev、providers、routes 就放进我们的核心赛道比较。

它仍然是很好的边界测试：如果 Jev Switch 开始增加 OpenAI/Anthropic 请求、为 Agent 改写配置、靠 Jev 从 LLM 候选里选模型，我们就跨进 AutoJev/Magpie/LiteLLM 的地盘，且弱化了“System One 决策本身”的专用价值。相反，如果 Agent 只是通过 API 调用一个 Jev graph node，并拿到 typed answer，那仍是我们的赛道。

## 一个更精准的产品定义

### 面向人

**Jev Switch 是 Jev / System One 的决策工作台：用户打开即能发起一次有明确问题类型的判断，看到可理解的结果，并沿结果查看来源、模型、请求状态和真实路由。**

### 面向开发者

**它是 Jev-compatible System One 服务的本地优先运行入口：统一连接、探测、启停、测试、比较和路由本地/远程决策服务，并将同一份图与调用历史通过稳定 API 提供给应用和 Agent。**

### 不是什么

- 不是通用 LLM API 网关，不提供 OpenAI/Anthropic chat completion 作为核心入口。
- 不是通用聊天模型客户端，也不让自由文本生成伪装成 Jev 的 typed decision。
- 不是模型权重/推理 runtime；本地推理由 Laya、OpenJev、LM Studio、vLLM 等兼容服务负责，Jev Switch 管理其连接与可选生命周期。
- 不是用 Jev 挑 Claude/GPT/Qwen 的“智能路由器”。Jev 的主要价值在于结果可成为软件分支条件。

这可以概括为：**决策工作台（人） + System One 网关（应用） + 决策路由图（运行时）**。仪表盘是管理首页，开始页是立即行动的首页候选，路由/提供商/统计/设置是控制面。

## “开始”怎么把协议优势变成普通人能用的东西

你已确认的基本路径可以写成：

```text
选择当前入口（默认一个明确入口）
   → 输入这次要判断的情境
   → 选择/编辑要问的 typed question
   → 发送
   → 展示决策结果
   → 按需展开依据、实际入口、图路由与 provider attempts
```

在没有入口时，页面不应该给空白“聊天框”让用户猜下一步，而应直接带到“创建第一个决策入口”向导。入口配置完后再回到同一份编辑内容，尽可能让用户当天就得到第一个结果。这是把基础设施转译成任务路径，而不是把管理员控制台缩小版搬到首页。

结果卡片仍然用模型的原生语义：Choice 呈现最终选项和选项概率；Score 呈现分值、范围和解释；Noul 呈现支持某命题的概率。顶部给出人能采取的结论，随后显示模型、confidence、延迟和回答是否符合 schema。用户展开“本次为什么得到这个结果”时，再看到入口、DAG 路径、失败尝试和最终 provider。这不是自由生成的长文；它是一个类型化结果的可读包装。

**关键 UX 张力：**TypeSafe 的 System One 请求必须带 `questions`，而“只用 Jev、不要通用 LLM API”的原则意味着应用不能偷偷调用另一个 LLM，把任意一句话翻译成问题类型、选项和 criteria。可行办法是把文本输入分成“情境”与“要判断的问题”，在同一 composer 中有一个可见但轻量的 typed question editor；再用决策模板把重复结构变成一击即可复用的表单。这会稍微不如自由聊天神奇，却保住了可检验、可比较和零 LLM 依赖。

本地服务未就绪时，开始页应报告具体 provider 当前未运行，并给出“启动服务”“换另一个已就绪入口”“打开配置”三个去向；自动启动需要入口/提供商明确设置为受控且用户选择允许，所有路由范围均为本地时，不得在失败后静默转发到云端。已配置本地优先+云端备援的用户，则在该入口本身显示策略和本次真实路径。

“自动选择”保留为高级智能入口：决策模型本身（可为 Jev/System One 服务）接收问题与候选决策服务特征，在给定候选中选择哪个决策服务；它不挑通用 LLM。若还可用本地 JavaScript policy，则展示确定性规则和结果；Jev 分类决策要说明增加的一次请求、延迟与可能成本。它必须是 opt-in、可预览、可回退，并且在决策服务不可用时有清晰本地兜底。

## 产品演变：从一根网线长成一张决策工作台

### 第一幕：把“上游切换”变成配置，不改业务代码

一个小应用用 Jev 判工单归属。原来代码中按 TypeSafe key、Vercel 路由和 Laya 本机端口写三段 if-else。上游一坏就发版，换上游就改部署。System One Gateway 让它们都发到一个固定本机地址，DAG 负责 failover 或明确策略。这个故事里，图和 provider 管理直接有价值：一个模型入口可以连不同的 Jev 后端，业务程序不需要懂后端名字。

### 第二幕：从能通，走到能解释

上游失败并重试时，用户要知道“入口调用最终成功”与“provider 第一次失败”可以同时为真。父请求和每个实际 attempt 分开记录；路由图只展示真实 trace；热力图用所选时间范围的持久调用结果，不把未观测补成绿灯。这个阶段的产品价值是证据：路径、HTTP 状态、延迟、尝试顺序、实际赢家能被追溯。对 Agent 来说，调用和人工点击共享同一审计和 API，避免 UI 是一套真相、自动化又造一套。

### 第三幕：从配置台，走到“开始”工作区

普通用户不想先学什么是 provider、endpoint 和 route edge。她打开“开始”，若没有入口，就配置一个官方 Jev 或本地兼容服务；若本地服务没开，页面教她启动；输入情境并选一个 Choice/Noul 问题后，得到明确的决策结果。她能展开看“这次走了本地 Laya，使用 12 ms；另一候选未尝试”，但默认不需要读原始 JSON。

这让“开始”成为人的入口，“仪表盘”成为运行概览，“控制台”成为管理区域。设置项只决定开屏策略：仪表盘、开始、最近一次访问；不必把“首页”误当成某一业务页的同义词。手机和桌面都沿同一顺序工作，只按长宽比重排。

### 第四幕：图不再是美化过的箭头，而是用户的决策结构

路由 DAG 可从“入口 → 中间节点 → provider”升级为公开/内部节点与出口的同一 GraphDocument。入口承载公开的 decision endpoint 和策略；内部节点复用判断分支；provider 绑定本地/远程 System One 服务。用户在开始页调用图中的入口，图负责实际执行，历史结果可反查整条路径。Agent 通过同一套图写入事务创建/修改一个节点，失败就整体不变，不能用整表替换覆盖用户配置。

后续的模型画像与属性路由，应当只帮助 System One 候选筛选：模型能答哪些 typed question、语言范围、运行位置、时延/资源、人工证据和自动探测的来源。它不是 LLM capabilities catalog 的仿版。智能入口让 Jev 在这个已过滤的决策候选集里作 Choice；可先影子测试，证明收益后再允许影响真实路由。

### 第五幕：从个人电脑，扩展为同一套决策运行面

桌面端可以同时连接本机 Laya、家中 NAS OpenJev、开发服务器和官方 TypeSafe；云端部署只暴露需要的 Jev endpoints 和权限。个人或小团队在一个界面维护图与服务；不同客户端通过 token 访问已发布入口；Agent 通过 capability discovery 查配置 schema，用有限 scope 操作一次 provider 或一条 route transaction。不同部署共享相同 typed protocol 与审计结构，而不变成“所有 AI 的 API 管理器”。

## 三个未来剧本

### 最可能：专用的 Jev 决策工作台 + 本地优先网关

核心用户是已经接入 Jev 的开发者、模型实验者和懂少量结构化问题的高阶用户。开始页可以临时验证一个决策，Playground做批量比较，图管理生产路由，Provider 管理本地/云服务启停，API/CLI 给 Agent 与应用使用。流量比通用 LLM 低，但用户价值密度高。

### 最危险：被卷进通用 LLM 网关赛道

当团队为了“看起来完整”加上 Chat Completions、100 个 LLM providers、agent config rewrites、tokens/cost dashboard、会话/工具/MCP/文件/语音时，项目便同时与 Magpie、AutoJev、LiteLLM、LLMGateway、Open WebUI 和 TouchAI 争资源。每一边都已经有更宽的兼容面，Jev 反而只剩一个 model option。这是范围膨胀风险，不是市场扩张。

### 最乐观：成为 System One 的“实验桌 + 发布台 + 执行器”

用户把一次判断从草稿变成模板，能用固定样本比较本机/云端服务；模板中的 typed questions 经过人工确认后生成公开入口；入口被图节点复用；生产调用的 attempt trace 回流到历史分析；Agent 读取同一份 capabilities 和图事务，执行人机等价的配置操作。用户第一次来只需“开始”，专业能力逐层揭开。这是从一个按钮到一套基础设施的自然弧线，而不是从 Jev 跳去做通用 AI OS。

实现这一剧本不要求马上做市场、模板社区或自我训练。先证明三件事：用户能在首次打开后完成一次有效 System One 判断；一次 provider 失败或本地服务未启动能被解释并恢复；相同请求在比较模式中的真实差异能让用户作出一个具体选择。

## 命名：品牌独立，领域专一

### 命名约束

好的新名字不必含 Jev，但应该让人联想到“用决策模型做事、看懂结果、接入服务”，而不是一般 chatbot。它同时需要：中英文能顺口说，作为桌面应用、workspace 和 API 控制面都成立；不会暗示它会帮用户生成长文；不会让用户误以为它由 TypeSafe 官方出品；品牌名可以独立于协议和兼容模型名。

建议把品牌、品类和兼容标签分开：

```text
[独立短品牌]
Decision Workspace / System One Decision Workbench
支持 Jev 与 Jev-compatible System One 服务
```

“Jev”可留在上游型号、请求协议、文档集成标签、模板示例和兼容徽标；不再承担整个产品品牌。代码仓、binary 和旧配置 ID 可以先保持兼容，品牌迁移不要求一次重命名所有内核和 API。

### 当前候选方向，不是已选名

| 名称方向 | 好处 | 代价 / 风险 | 判断 |
|---|---|---|---|
| **TouchJev** | 一听就有“把 Jev 带给普通人”的故事；与你熟悉的 TouchAI 使用体验有家庭相似感 | 名称仍绑定 Jev；可能让人误会是 TouchAI 模块、官方 Jev 客户端或另一个聊天应用 | 可作为 TouchAI 内的 Jev 模式 / 活动入口名；不适合作为满足“去 Jev 品牌依赖”的最终产品名 |
| **TouchOne** | 借 System One 的概念，听感亲近 | One 含义模糊；也会靠近 TouchAI 品牌和 TypeSafe System One 专有措辞，容易产生归属误会 | 暂不推荐作为产品主品牌 |
| **Jev Studio / Jev Desk** | 明确、好理解，延续已有用户认知 | 若 System One 生态不再只由 Jev 代表，产品名未来会显得过窄 | 短期迁移别名可用，长期主品牌不稳 |
| **Decision Studio / Decision Workbench** | 品类清楚，准确描述实验、比较、路由和执行 | 更像副标题而非独特品牌，搜索区分度和口头记忆需要再设计 | 建议作为产品描述词，不必占主品牌位 |
| **Branch / Switchboard 一类图形隐喻** | 直接表达决策分支、路由图，能连起 DAG 的可视化亮点 | 容易把产品说窄成 router；很多软件已使用相似普通词，名字检索/域名冲突风险高 | 可用来探索命名方向，但需先查重再讨论 |
| **独立短品牌 + “System One Decision Workspace”副标题** | 主品牌可以长寿，品类一眼可懂，Jev 只作为兼容能力 | 需要从候选池中筛选一个不冲突且中英文顺口的短词 | **目前最符合方向；名称本身仍未产生** |

TouchJev 的灵感很有用：它证明产品要亲近、行动路径要短。但“好体验像 TouchAI”不必等于“产品名称也像 TouchJev”。可以学习触手可及的入口设计，而把底层品牌留给更宽的 System One 决策服务范围。最终名字前还需做商标、域名、GitHub、应用商店和相邻产品检索；这次研究没有做名称可用性审查。

## 这轮的建议与尚未决定的事

### 建议

1. 对外定位先改成“Jev / System One 决策工作台与本地优先网关”，而不是“LLM 网关”或“Agent 路由器”。
2. 继续把“开始”做为用户直达入口：若无 entry 提供创建向导；默认当前 entry 明确可见；提交后显示 typed decision；路线、provider attempts 和诊断采用结果注解/渐进披露。
3. 把 Magpie 列为重点竞争监测：观察其 System One provider、Graph/route editing、playground、native decision comparison 与本地 service lifecycle 是否向 Jev 主工作流深入，而不是只记录“它支持 Jev”。
4. 保持 AutoJev 与通用路由器在核心竞品集合之外。它们可作互操作或边界案例，不应诱导本产品开始代理 LLM 请求。
5. 名字先不拍板。先用“独立品牌 + 决策工作台副标题 + Jev-compatible 能力标识”的命名架构写一版首页/开始页文案，再对真实用户做快速识别测试；候选名称还要查冲突。

### 必须明确的一个范围问题

“只做 Jev”与当前存在的 Vercel/OpenRouter 上游适配器之间，需要一个准确的产品措辞。推荐解释为：**所有公开请求、输入结构和决策结果都以 Jev / System One 为中心；可以支持可选的 Jev-compatible translator backend，但不接受一般聊天请求、也不依赖通用 LLM API 才能完成核心工作。** 如果你的原则是“不允许产品在任何路径上调用普通 LLM，只能调用原生 System One 模型”，则现有 translator adapters 需要另行处理。这个边界会影响 README、导航、市场页和未来 provider 增减，不能被名字掩盖。

## 资料来源与证据范围

### 项目内一手材料

- Jev Switch 初始计划与需求边界：<https://github.com/ARCJ137442/jev-switch/blob/main/docs/01-Jev-Switch-%E5%8E%9F%E5%A7%8B%E8%AE%A1%E5%88%92%E4%B9%A6-DeepSeek.md>
- 当前产品与兼容边界：<https://github.com/ARCJ137442/jev-switch/blob/main/README.md>
- 当前路线图：<https://github.com/ARCJ137442/jev-switch/blob/main/ROADMAP.md>
- DAG 节点引擎计划：<https://github.com/ARCJ137442/jev-switch/blob/main/docs/design/DAG-NODE-ENGINE-ARCHITECTURE-PLAN.md>

### 官方产品 / 技术资料

- TypeSafe：System One Models & Jev 定义及博客：<https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- Magpie 官方 GitHub 定位：<https://github.com/yetone/magpie>
- Magpie 快速开始与路由组：<https://usemagpie.ai/docs/start>
- Magpie 意图路由及 classifier 输入范围：<https://usemagpie.ai/docs/intent>
- Magpie 系统一/远程兼容说明：<https://usemagpie.ai/docs/remote>
- Magpie 应用集成协议与路由 API：<https://usemagpie.ai/docs/integrate>
- LiteLLM `/v1/decisions`、`/v1/systemone` 及 Decision Playground：<https://docs.litellm.ai/docs/decisions>
- LiteLLM Auto Router 支持 Jev classifier：<https://docs.litellm.ai/docs/auto_router/>
- LLMGateway System One endpoint：<https://docs.llmgateway.io/features/system-one>
- LM Studio 本地 server、native / compatible APIs（含 Jev）：<https://lmstudio.ai/docs/developer/core/server>
- Open WebUI local + cloud providers：<https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/>
- TouchAI 桌面上下文、BYOK 和行动入口：<https://touch-ai.org/>
- AutoJev 的模型路由与 agent 配置（作为被排除的邻接类别）：<https://autojev.ai/features/smart-routing>、<https://autojev.ai/features/one-click-agent-setup>

### 范围说明

公开产品页能够证明产品方当前公开承诺的功能，不等于实测质量、稳定性或市场占有率。本文不做不可靠的 TAM、市占率和未经来源支持的用户数推算；竞品能力基于其官方文档快照，具体功能可能迭代。名称候选未做商标/域名法律审查。项目历史来自仓库当前可见文档和 Git 时间线；早期用户画像是原计划书中的假设，不等于真实用户访谈。

---

**本轮研究裁决（按用户明确边界）：**产品赛道只做 Jev / System One typed decisions；不扩成通用 LLM 网关；AutoJev 不列作直接竞品；Magpie 保留为重点跟踪的相邻/重叠产品；品牌可不含 Jev，协议标签继续明确兼容 Jev；开始页默认明确当前入口，智能入口留作可选高级路线。命名未决定，研究未授权代码实现。
