# SysTorch 品牌与原位升级核验

2026-10-24；本地候选 **m1-systorch-20261024.5**，基础版本 0.10.3。所有结论按下列精确产物界定；没有提交、推送、远端 CI 或发行。设计依据与技术取舍见[迁移决定](../design/SYSTORCH-BRAND-MIGRATION.md)，使用者从[新版验收](../guides/SYSTORCH-M1-ACCEPTANCE.md)开始。

## 产物

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| SysTorch-m1-preview-20261024.5-windows-x64.exe | 18582016 | `e3c83788c2c292dc98c18f223f24375c7611219fc48c0dbb17194e505f9bd5e3` |
| SysTorch-m1-preview-20261024.5-aarch64.apk | 16151995 | `6e6340f4187dc1f3df27ad76dc3e867e79c93b9e4047f309d64dce8a2d39745a` |
| SysTorch-m1-preview-20261024.5-x86_64.apk | 17790392 | `05b9a6ef8d989e7f67ff40dc97e2206632e7da2b62f793a3abb4fee979c744af` |

Windows EXE 未做 Authenticode。两种 APK 复用原 M1 专属证书，SHA-256：`2c15daa0102605e959abca45bac21aec07fe38f48c59c7e43a2abefe05b5b685`。M1 与正式包并存；覆盖原 M1，不应先卸载。旧 m1-local-20261024.1 文件／证据保持冻结。

## 实测结果

- Windows 真实旧 EXE → 新 Standalone：8 组升级断言，涵盖相同 owner／加密密钥、调用 Token、任务状态、幂等墓碑、provider／route／生命周期配置、语言／主题／137% 偏好；新原生 UI 回答旧任务，原调用方取回；再次冷启动仍保留。
- Android 真实旧签名 APK → install -r 新 APK：12 组断言；installed ID／UID 保持，未在升级中清数据；旧显式停止标记保留，通过原生 RPC 启动后端，无需先有 HTTP 网关。新 namespace／JNI、兼容旧组件、前台 service 与启动 intent 实测可用。
- 通知／tile 的 **launch intent** 在 Start／Routing 可启停，并验证冷启动接收一次与 UI 重载不重播。它不等于逐个 OEM 通知抽屉或 QS UI 的人工验收。修正包含根级监听、inlined plugin 最小监听权限、Kotlin camelCase 通道配对和已消费 intent 清除。
- 两个独立 Windows PowerShell 5.1 进程：5 组断言，包括接受后退出、重复提交复用原键、等待中查询、无人驻留调用进程时原生作答、新进程取回；回执无 Token。创建位置是“统计 → 访问与活动 → 调用 Token”，与 provider API key 不同。
- 真实 daemon／HTTP／SQLite／Chromium：20 组；权限隔离、重复提交、冲突、过期、撤销、删除墓碑、缺失／错误密钥、恢复及断网草稿等；仅 3 次合成上游调用，付费调用 0。
- Rust workspace 288 项通过；ts-rs 门禁 372 项通过；UI 87 项、lint、生产构建通过；Windows native 19 项通过／6 项 ignored。两工作区 Clippy -D warnings 与 fmt --check 通过。ts-rs 既有 serde 属性解析提示不宣称已修复。
- M0 原型 20 组、路由编辑器 4 组通过；包含亮度保持、响应淡出、返回不重播和路由编辑意图／并发草稿保护。核心 DAG 几何、辉光、提供商生命周期面板和 Router 与迁移前私有基线逐文件哈希一致。
- 彩色母版 SVG／PNG／全部 ICO 帧与实际 Windows PE 一致；APK aapt 资源内的 16 个栅格图标逐像素匹配母版派生结果，Android 13 adaptive monochrome 与新原生库检查通过。全色应用图与单色系统适配来自同一几何。

## 证据与复现

精确断言、哈希和输入范围见[机器记录](systorch-brand-upgrade-2026-10-24.json)。截图均为合成任务，不含用户配置或凭据：[Windows 原生](assets/systorch-brand-upgrade-2026-10-24/windows-upgrade.png)、[Android 原生](assets/systorch-brand-upgrade-2026-10-24/android-upgrade.png)、[Android 最近任务](assets/systorch-brand-upgrade-2026-10-24/android-recents.png)。

复现入口：scripts/verify-systorch-windows-upgrade.mjs、verify-systorch-android-upgrade.mjs、verify-choice-example.mjs、verify-systorch-m1.mjs，以及 scripts/android/verify-systorch-apk-brand.ps1。Windows 驱动隔离 APPDATA／WebView；Android 驱动只接受专用 SysTorch_M1_API_35 模拟器、ADB server 5041／端口 5583，不能改成用户真机后随意清数据。Playwright 路径通过本机 NODE_PATH 提供，SDK／测试密钥由本机私有配置提供，公开记录不复制它们。

## 边界

- Windows EXE 没有 Authenticode 签名。
- Android 原生升级／启动指令在独立 API 35 x86_64 模拟器测试；ARM64 APK 已构建、签名和检查，没有 ARM 真机证据。
- Android 作答输入实测为 100%；137% 偏好保留已验证，原生高缩放触控未验收。
- 没有运行正式安装器／稳定密钥 APK、远端 CI、Docker 或官网迁移。
- Logo 是基于交接包的候选；识别效果与最终审美仍待维护者验收。

Android 的 137% 存储保留已断言，但该 API 35 WebView 的高缩放点击检查未可靠通过；测试随后明确改为 100% 执行作答，未使用强制点击冒充高缩放通过。截图／像素门禁也不能证明视觉审美或真机触控已经被维护者接受。正式签名覆盖、安装器、云容器、官网及更广题型／人工 DAG 策略仍按后续阶段验证。
