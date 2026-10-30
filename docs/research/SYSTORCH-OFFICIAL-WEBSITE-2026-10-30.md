# SysTorch 官网定位与设计说明

更新时间：2026-10-30。目标地址为现有 SysTorch 项目 Pages：<https://arcj137442.github.io/SysTorch/>。维护源是仓库 `site/`；个人主页仓库及其他子站点保持不变。

## 页面任务

- **受众**：接入结构化决策服务的开发者、Agent / Harness 作者、决策工作流操作者，以及想从 UI 直接试用的人。
- **定位**：面向人、模型与 Agent 的结构化决策运行时，不把产品品牌绑定到某一模型或供应商；把 typed decision 从调用、路由与必要的人工作答一路带回原调用方。System One-compatible 是当前协议兼容边界，不是产品品牌。
- **用户承诺**：提交情境与明确问题；看得到请求走过的路径；若任务需要人判断，任务可以持久等待，并把类型明确的结果交回原调用方。
- **主要行动**：了解工作流、查看产品界面预览、下载当前发行版或打开文档。
- **信任摩擦**：预发布未经维护者真机验收；Windows EXE 未作 Authenticode 签名；上游题型与媒体能力不同；合成预览不证明真实模型质量。

## 生态位判断

SysTorch 的品牌定位是结构化决策运行时，不绑定 Jev 或其他单一模型品牌，也不扩成通用 LLM 聊天入口或模型推理 runtime。当前 API 使用 System One-compatible 的 typed request/answer 形状作为互操作协议。最重要的对象不是通用 prompt 或模型目录，而是一条从调用方发出、可经 DAG 路由、可追查 provider attempts、必要时可持久交给人，再回到同一调用方的决策请求。

竞品研究确认了明显的能力交叠，因此官网**不**宣称 SysTorch 独占 Jev/System One 路由，也不宣称竞品缺少某一功能：

- Magpie 是面向 Agent 的通用模型网关，支持多 provider、路由组，也支持 System One 决策模型。SysTorch 的表达重点是把 typed request、尝试轨迹和持久的人工作答作为统一工作流。
- Bud Decision Studio 面向本地决策模型，公开材料覆盖本地运行、评估、模板、训练、服务和 API 集成。SysTorch 不重新实现权重与推理引擎，而连接兼容服务并管理请求生命周期。
- System One 官方项目提供 Agent SDK 与托管决策 API。SysTorch 位于运行工作层：连接决策服务、协调路径、呈现真实尝试，并让人工回答可返回调用方。

官网用“可以互补的不同工作层”说明边界，不对竞品打分或作未验证的优劣断言；不把“其他工具不会做”当产品卖点。

## 设计合同

- **路线**：产品证明 + 决策数据可读性。首屏用一条标注为合成示意的请求轨迹，表达请求、失败尝试、下一条路径、typed answer 与回传。
- **舍弃路线**：通用 SaaS 指标卡/模型目录式首屏会模糊“决策运行时”与一般模型管理器的差异；纯文档长文会让普通用户看不到立即行动入口。
- **视觉语言**：主题默认跟随系统，可显式切换；深色使用石墨表面，浅色使用带品牌色的冷调浅表面。青蓝表达路径与交互焦点，绿色/红色表达成功/失败，暖琥珀表达人工接手。火炬 SVG 与细线 DAG 是品牌图形来源。
- **字体**：英文展示字用紧凑无衬线；中日韩正文按平台回退。站点不依赖远程字体请求。
- **布局**：宽屏将产品叙述与请求轨迹并列；窄屏重排为标题与行动在前、轨迹示意在后，不隐藏下载、导航或安全说明。
- **交互**：中英文切换、明暗主题、窄屏导航与代码复制都支持键盘。唯一签名动效是路由路径轻微发光，`prefers-reduced-motion` 下呈现静态完整结果。
- **发行信息**：从 Pages 工作流生成的 `site/releases/latest.json` 读取当前 tag、预发布状态和真实附件；元数据不可用时回退到 GitHub Releases，不编造版本或文件名。
- **品牌与协议分层**：首屏和分享图只表达 SysTorch 的结构化决策运行层，不把 Jev 或单一模型名作为产品定位。具体兼容协议、adapter 与示例模型 ID 放在技术区，并标明模型 ID 由用户配置。

## 页面顺序

1. 产品定位与请求轨迹示意；首屏即可了解结果并找到下一步。
2. “typed decision，而非通用续写”说明，展示 state、问题、类型化结果。
3. 调用 → DAG 协调 → provider attempts → typed answer 的路径。
4. 人工作答：提交、离开、人在决策台回答、原调用方取回。
5. 生态定位：以 Bud Decision Studio、本地模型工作台；Magpie、通用 Agent 网关；System One、决策 API / SDK 为相邻工作层实例，说明能力可重叠、可组合，不把产品绑定某一模型品牌。
6. 当前产品界面预览及截图证据边界。
7. 当前发行版、兼容限制、文档与 GitHub。

## 素材与事实边界

- 保留仓库火炬 SVG；使用本地生产界面截图。若截图使用合成 fixture，必须标注；无法证明来自 0.12.0 二进制的画面不能称为真机或发行截图。
- 当前产品能力以 [README](../../README.md)、[品牌迁移记录](../design/SYSTORCH-BRAND-MIGRATION.md) 和 API 契约为准。
- Noul / Choice / Score / Box 的支持与附件格式取决于目标 adapter/model；页面说明此差异，不暗示所有上游完全兼容。
- 不出现客户、采用量、性能、模型准确率、市场份额或“零遥测”等未验证宣传。

## 来源台账（2026-10-30）

| 来源 | 类型与可证明内容 | 使用限制 |
|---|---|---|
| SysTorch [README](../../README.md) 与仓库 API 契约 | 当前产品定位、能力、边界与请求格式 | 官网事实主源；历史测试不扩展为当前证据 |
| [Magpie 官方仓库](https://github.com/yetone/magpie)、[网关路由文档](https://github.com/yetone/magpie/blob/main/docs/subsystems/gateway-routing.md)、[远端 Magpie 文档](https://usemagpie.ai/docs/remote) | 通用 Agent 网关、多个 provider/路由组，以及可被列为决策模型的 System One provider | 证明直接能力交叠；不据此推断其没有持久人工任务，也不评价质量 |
| [Bud Decision Studio 官方发布](https://www.budecosystem.com/introducing-bud-decision-studio-the-open-source-engine-for-decision-models) 与[官方仓库](https://github.com/BudEcosystem/Bud-Decision-Studio) | 本地决策模型的运行、评估、模板、训练、服务和 API 集成 | 它是模型工作台参照；SysTorch 不实现权重下载/推理引擎 |
| [System One 官方 About](https://system-one.dev/en/about) | Agent SDK、共享决策接口与托管 Jev API | SysTorch 强调连接、路由、追踪和人工作答的运行生命周期 |
| [缀形 GitHub Pages](https://arcj137442.github.io/zhuixing/) 与[仓库](https://github.com/ARCJ137442/zhuixing) | 静态、带版本说明的 GitHub Pages 站点 | 参考静态托管与边界说明；SysTorch 沿用自己的 `/SysTorch/` Pages 和 Release 元数据刷新链 |

公开材料证明产品方当前公开承诺的能力，不证明准确率、性能、用户满意度或市场份额。

## 上线验收

- 页面、README、GitHub About 和 Release 使用同一产品名/口号；版本信息与 GitHub 最新 Release 一致。
- 中英文切换覆盖所有可见文案；主题变化同步 SVG、示意图、焦点与弹层。
- 桌面、紧凑笔记本、宽屏、390px 与 360px 窄屏无横向溢出；短视口首屏仍有可用 CTA。
- 键盘导航、可见焦点、导航开合、代码复制和 reduced-motion 都有完整结果。
- 合成请求轨迹和本地预览不能冒充真实上游、实时流量或真机验收。
