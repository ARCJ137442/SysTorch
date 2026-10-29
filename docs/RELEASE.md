# SysTorch 发版手册 / Release guide

流水线位于 .github/workflows/release.yml；Android 稳定签名构建位于 .github/workflows/android.yml。GitHub 仓库为 [ARCJ137442/SysTorch](https://github.com/ARCJ137442/SysTorch)，官网为 [arcj137442.github.io/SysTorch](https://arcj137442.github.io/SysTorch/)。

The release pipelines are .github/workflows/release.yml and .github/workflows/android.yml. The repository is [ARCJ137442/SysTorch](https://github.com/ARCJ137442/SysTorch), and the website is [arcj137442.github.io/SysTorch](https://arcj137442.github.io/SysTorch/).

## 当前版本 / Current release

0.11.0 是 SysTorch 的预发布版本。发布页只提供两个面向用户的附件：Windows x64 Standalone EXE 与稳定签名 Android arm64 APK。CI 仍验证 Rust、UI、Tauri、CLI、Docker 和 Android 构建，但 CLI、安装器、便携 ZIP、签名状态清单及 Android manifest 不作为此版本的 Release 附件。

Version 0.11.0 is a SysTorch pre-release. The public release contains exactly two assets: the Windows x64 Standalone EXE and stable-signed Android arm64 APK. CI still validates Rust, UI, Tauri, CLI, Docker, and Android builds; CLI packages, installers, portable ZIPs, signing status files, and the Android manifest are not attached to this release.

| 平台 / Platform | 附件 / Asset | 身份与限制 / Identity and limits |
|---|---|---|
| Windows x64 | SysTorch-0.11.0-windows-x64.exe | 单文件 Standalone；目前没有 Authenticode 证书，Windows 可能显示未知发布者。 |
| Android arm64 | SysTorch-0.11.0-android-aarch64.apk | 使用现有稳定签名；显示名为 SysTorch，applicationId 保持旧值以支持覆盖升级与原沙箱数据。 |

发布状态、CI run、SHA-256、签名指纹及未完成人工项目必须更新在 [0.11.0 核验记录](verification/v0.11.0-pre-release-2026-10-30.md)。新版本发布为 GitHub prerelease；版本号本身仍是 SemVer 0.11.0，不加 pre 后缀。

Record the release status, CI run, SHA-256, signer fingerprint, and remaining hands-on checks in the [0.11.0 verification record](verification/v0.11.0-pre-release-2026-10-30.md). Publish it as a GitHub prerelease; the SemVer remains 0.11.0 without a pre suffix.

## 版本一致性 / Version consistency

发布前，下列版本必须与 tag 去掉 v 后完全一致：

Before publishing, these version fields must match the tag without its leading v:

- ui/package.json
- src-tauri/tauri.conf.json
- src-tauri/tauri.android.conf.json
- rs/Cargo.toml workspace package version
- src-tauri/Cargo.toml package version
- rs/Cargo.lock、src-tauri/Cargo.lock 和 ui/package-lock.json 应与 manifest 同步

Release meta job 还检查 CHANGELOG.md 中有版本章节和完整用户叙事：起点、问题、操作、结果、对照、边界。预发布标签通过 workflow 输出标记为 GitHub prerelease。

The release meta job also requires a version section and a complete user narrative in CHANGELOG.md: starting point, problem, action, result, comparison, and boundary. The workflow marks this tag as a GitHub prerelease.

## 发版前验证 / Pre-release validation

在当前分支和最终提交上运行：

Run these commands on the final commit:

~~~powershell
cargo fmt --manifest-path rs/Cargo.toml --all -- --check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path rs/Cargo.toml --workspace --locked --offline
cargo test --manifest-path rs/Cargo.toml --workspace --features ts-rs --locked --offline
cargo clippy --manifest-path rs/Cargo.toml --workspace --all-targets --locked --offline -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm ci --prefix ui
npm test --prefix ui
npm run lint --prefix ui
npm run build --prefix ui
~~~

按发布范围再验证 Android manifest、权限、签名和 Tauri/浏览器界面。CI 成功只能证明自动化覆盖的检查，不能替代 Windows 人工启动、Android 真机安装、相机/相册权限、后台生命周期或真实上游调用验收。

Run Android manifest, permission, signature, and Tauri/browser checks appropriate to the release. Passing CI only proves the checks it runs; it does not replace Windows hands-on launch, Android device installation, camera/gallery permissions, background lifecycle, or real upstream-call acceptance.

## Android 稳定签名 / Android stable signing

保持仓库已配置的四个 Actions Secrets：ANDROID_KEYSTORE_BASE64、ANDROID_KEYSTORE_PASSWORD、ANDROID_KEY_ALIAS、ANDROID_KEY_PASSWORD。它们必须指向同一把历史稳定密钥。不能为了新产品名生成另一把 key、卸载现有应用或清理数据。Android applicationId、owner key、应用数据库和 WebView 存储是迁移兼容锚点；显示名称与 Kotlin namespace 使用 SysTorch。

Keep the four configured Actions secrets: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD. They must refer to the same stable historical key. Do not generate a different key, uninstall the existing app, or clear app data for the rebrand. Android applicationId, owner key, app database, and WebView storage are migration anchors; the displayed name and Kotlin namespace use SysTorch.

Release job 只在签名 APK 构建成功时继续发布。Android 构建产物包含签名 APK 与内部 manifest；Release staging 只复制 APK 到公开附件。CI 将 signer SHA-256 与既有稳定指纹 5A8CB27A0C4484F140EDE57500B6ADC14DB7C66B9B52D607E8E422420DEDA1AB 比较，并在发布核验中记录，不上传 keystore 或密码。

The release job proceeds only after the signed APK succeeds. The Android build artifact contains the APK and an internal manifest; release staging copies only the APK into the public assets. CI compares the signer SHA-256 with the established fingerprint 5A8CB27A0C4484F140EDE57500B6ADC14DB7C66B9B52D607E8E422420DEDA1AB and records it in verification. Never upload the keystore or passwords.

## Windows Authenticode / Windows code signing

当前 WINDOWS_SIGNING_REQUIRED 未开启，因此 Windows EXE 无 Authenticode 签名，Release 说明必须如实告知。若之后要切换正式签名，在 GitHub Actions Variables 设置 WINDOWS_SIGNING_REQUIRED=true，并在 Actions Secrets 配置 WINDOWS_CERTIFICATE_BASE64 与 WINDOWS_CERTIFICATE_PASSWORD。缺少受信任证书时不能宣称“已签名”。

WINDOWS_SIGNING_REQUIRED is currently not enabled, so the Windows EXE is not Authenticode-signed. The release notes must say so. To enable signing later, set the GitHub Actions variable WINDOWS_SIGNING_REQUIRED=true and configure WINDOWS_CERTIFICATE_BASE64 and WINDOWS_CERTIFICATE_PASSWORD secrets. Do not claim the app is signed when a trusted certificate is missing.

## 提交和发布 / Commit and publish

1. 核对根目录规则、当前实施计划与代码差异；保留旧 ID、协议和存储兼容性。
2. 只暂存该版本需要的源码、图标、文档和工作流；排除 .tmp、.vite、构建目录、密钥和本机配置。
3. 检查 git diff --cached --check、git diff --cached --stat 与完整 staged diff。若 whitespace 检查只标到 ts-rs 原样生成的 ui/src/generated 文件，不要手工改类型；以 CI 再生成后的 diff 门禁为准。
4. 提交到当前 main，推送 origin；origin 必须为 https://github.com/ARCJ137442/SysTorch.git。
5. 确认 main CI 通过后，创建并推送 v0.11.0 tag。
6. 等待 Release workflow 所有必需 jobs 结束；失败时修复原因并重新验证。
7. 核对 GitHub prerelease 状态、页面说明和公开资产数量；必须恰好只有一个 Windows EXE 与一个 Android APK。
8. 下载两个资产到临时目录，核对 SHA-256、Windows 签名状态、APK signer SHA-256 和 APK applicationId；不得把临时目录或签名材料提交。
9. Release published 事件触发 Pages；确认首页展示 0.11.0 预发布标识和这两个正确附件。

1. Review the repository rules, active plan, and diff; preserve legacy IDs, protocols, and storage compatibility.
2. Stage only source, icons, docs, and workflows for this release. Exclude .tmp, .vite, build folders, secrets, and machine-local configuration.
3. Review git diff --cached --check, the staged stat, and the full staged diff. If whitespace checking flags only canonical ts-rs output under ui/src/generated, do not hand-edit generated types; use the CI regeneration diff gate as the source of truth.
4. Commit on main and push origin; verify origin is https://github.com/ARCJ137442/SysTorch.git.
5. Wait for main CI to pass, then create and push tag v0.11.0.
6. Wait for all required Release jobs; fix failures and revalidate if needed.
7. Verify GitHub prerelease status, release text, and public asset count: exactly one Windows EXE and one Android APK.
8. Download both assets to a temporary directory and verify SHA-256, Windows signing status, APK signer SHA-256, and APK applicationId. Never commit build scratch space or signing material.
9. The published Release event refreshes Pages; confirm the site shows the 0.11.0 prerelease and the two correct downloads.

## 远端品牌信息 / GitHub metadata

GitHub About description 使用英文与中文各一句、用竖线分隔，并与口号和 README 一致：

The GitHub About description uses one English sentence and one Chinese sentence separated by a vertical bar:

Turn questions into next steps with a traceable decision runtime | 用可追溯的决策运行时，把问题变成下一步

官网 Pages 自动读取最近发布的 Release，包含 prerelease；不能使用只返回最新正式版的 /releases/latest API。
