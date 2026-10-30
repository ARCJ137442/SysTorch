# SysTorch 文档 / Documentation

> **把眼前的问题，变成下一步。**<br>
> **Turn questions into next steps.**

SysTorch 是面向人、模型与 Agent 的结构化决策运行时。它保留可检查的 DAG 路由、提供商服务启停、真实请求辉光、普通决策会话和持久人工作答。Jev / System One 是协议与模型系列，不是产品品牌。

SysTorch is a structured decision runtime for people, models, and agents. It keeps inspectable DAG routing, provider lifecycle controls, request glow, ordinary decision sessions, and durable human answers. Jev / System One names a protocol and model family, not the product brand.

## 当前预发布 / Current pre-release

0.12.0 是当前 SysTorch 预发布版本，收口 canonical SysTorch API、结构化路由轨迹与「开始／决策台」对调用历史的呈现，提供 Windows Standalone EXE 和稳定签名 Android arm64 APK。发布状态、准确附件、兼容边界和未完成人工验收见 [0.12.0 发布说明](releases/0.12.0.md) 与 [候选核验](verification/v0.12.0-pre-release-2026-10-30.md)。自动测试、CI 构建与设备人工验收是不同证据，不互相替代。

Version 0.12.0 is the current SysTorch pre-release. It consolidates the canonical SysTorch API, structured route traces, and call-history disclosure in Start / Decision Desk. It provides a Windows Standalone EXE and a stable-signed Android arm64 APK. See the [0.12.0 release notes](releases/0.12.0.md) and [candidate verification](verification/v0.12.0-pre-release-2026-10-30.md) for exact assets, compatibility, and remaining hands-on checks. Automated tests, CI builds, and device acceptance are separate evidence.

## 从这里开始 / Start here

| 需要 / Need | 文档 / Document |
|---|---|
| 产品介绍、能力与快速开始 / Product overview and quick start | [README 中文](../README.md) · [README English](../README.en.md) |
| 下载、升级和版本边界 / Download, upgrade, release boundaries | [0.12.0 发布说明](releases/0.12.0.md) · [发版手册](RELEASE.md) |
| Agent 提交 Choice、离开后由人作答、再取回结果 / Agent submits a Choice, leaves, then retrieves a human answer | [外部调用指南](guides/SYSTORCH-EXTERNAL-CHOICE.md) |
| SysTorch 请求、资产与多模态字段 / Request, asset, and multimodal fields | [契约索引](contracts/00-INDEX.md) · [HTTP 契约](contracts/05-HTTP契约.md) · [资产契约](contracts/09-SysTorch资产与多模态契约.md) |
| 普通「开始」会话、加密和恢复 / Start sessions, encryption, and recovery | [会话契约](contracts/10-SysTorch开始会话契约.md) |
| 入口、节点、提供商及 DAG / Entries, nodes, providers, and DAG | [当前实施计划](design/SYSTORCH-IMPLEMENTATION-PLAN.md) · [入口网关对齐计划](design/ENDPOINT-GATEWAY-ALIGNMENT-PLAN.md) |
| 本地模型启动、停止、状态探测 / Local model lifecycle commands | [生命周期计划](design/LOCAL-MODEL-LIFECYCLE-PLAN.md) · [脚本指南](design/LOCAL-MODEL-SERVICE-SCRIPTS.md) |
| Android 构建与设备证据 / Android build and device evidence | [Android 计划](design/ROADMAP-PLAN-ANDROID-EXPERIMENTAL.md) |
| 图标、界面与预览 / Logo, interface, and previews | [产品图册](gallery/README.md) · [图标源](../ui/src/brand/systorch.svg) |
| 未来工作 / Future work | [路线图](../ROADMAP.md) · [执行计划索引](design/ROADMAP-EXECUTION-PLANS.md) |

## 验证记录 / Verification records

日期化核验只证明其标明版本、构建身份、设备和测试范围。0.12.0 发行资产的验证结论见 [0.12.0 核验记录](verification/v0.12.0-pre-release-2026-10-30.md)；canonical SysTorch request 与 TypeSafe 投影的专项证据见 [请求超集核验](verification/systorch-request-superset-2026-10-30.md)。此前 Android、Windows、路由和上游测试记录继续作为各自版本的历史证据，不自动扩展到新工作树。

Dated verification proves only the revision, build identity, device, and scope it names. The [0.12.0 verification record](verification/v0.12.0-pre-release-2026-10-30.md) is authoritative for release assets; the [request-superset verification](verification/systorch-request-superset-2026-10-30.md) records the canonical SysTorch API and TypeSafe projection work. Earlier Android, Windows, routing, and provider records remain historical evidence for their versions.

## 历史档案 / Historical archive

早期设计、旧版本验收和 Jev Switch 名称只在说明其发生时的产品、包身份、协议或兼容性时保留。历史原文不做机械全局替换；这可以避免伪造旧版本截图、发行页面或测试证据。当前产品名称、公开链接与新安装包使用 SysTorch。

Early designs, old release checks, and the Jev Switch name remain only where they identify the product, package identity, protocol, or compatibility behavior of that time. Historical source records are not mechanically rewritten, so old screenshots, releases, and test evidence are not falsified. Current product copy, public links, and new package names use SysTorch.
