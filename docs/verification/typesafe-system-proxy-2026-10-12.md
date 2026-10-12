# TypeSafe HTTP 451 与 Windows 系统代理调查

## 已确认事实

运行实例为 `v0.10.2`，build revision `c531c3c7ab3b50fcf9a617b093388c988481df5d`。上游配置使用官方 `https://api.typesafe.ai/v1/systemone`、`kind=typesafe` 和 `jev-latest`。从 v0.10.1 到 v0.10.2 的 TypeSafe adapter 差异只有测试断言，实际请求构造没有变化。

HTTP 客户端采用 `reqwest 0.12.28`。workspace 设置 `default-features=false`，只启用 `json` 与 `rustls-tls`，因此移除了默认的 `system-proxy` feature。Windows 的 WinINET 系统代理已启用，但 daemon 没有代理环境变量，旧客户端实际直连。

## 同机网络对照（2026-10-12）

| 路径 | 官方 GET `/v1/systemone`，无密钥/正文 | 官方 POST `{}`，无密钥 | Cloudflare trace 地区 |
|---|---|---|---|
| curl 显式直连 | 451，地区不可用 | 451，相同地区错误 | CN |
| curl 使用现有系统代理端口 | 405，仅允许 POST | 403，明确缺少 API key | HK |
| Rust 原 features | 451 | 451 | CN |
| Rust 仅恢复 `system-proxy` | 405 | 403，明确缺少 API key | HK |

修复后的 Rust 客户端还使用现有 provider 凭据访问官方 `GET /v1/models`：HTTP 200，返回 2 个模型。旧运行 daemon 的同一目录探测仍为 451。该验证不调用推理，也不导出密钥、IP、cookie 或运行数据；这里只记录状态和数量。

451 在没有模型请求正文时已经产生，且同机只改变网络路径即可进入方法/鉴权处理。因此本次有证据支持的原因是系统代理未被采用，而非请求 JSON 格式变化。Cloudflare 的 `CF-RAY` 机房后缀不等于客户端出口 IP 的归属地区；直连可以命中 LAX 节点，同时 trace 仍识别来源为 CN。trace 是旁证，官方 URL 的路径对照是直接证据。

本次未查到 TypeSafe 文档公布的完整地区允许列表；上述 HK 结果仅证明当时该出口通过地区门禁，不构成持续可用承诺。

## 本地源码修复与边界

- `jev-adapters` 仅对 Windows target 恢复 reqwest `system-proxy`；原有环境变量代理优先级保留。
- 上游调用、API 探测、模型发现与生命周期 readiness 共用 HTTP 代理边界。
- `localhost`、`.localhost`、127/8、IPv6 `::1` 与映射回环地址始终直连；公网及普通 LAN 地址继续遵守配置的代理策略。
- 该回环例外必须存在：启用系统代理后，代理可能为未启动的本地端口返回 HTTP 502 等页面，原先“任意 HTTP 响应等于可达”的 probe 会误报健康。实际回归先复现该失败，再由回环直连修复。
- 修复未改变 TypeSafe 请求体、Bearer 鉴权、TLS 校验、路由策略或调查时的运行实例；该补丁纳入 v0.10.3 fix，构建与发布后验收状态见[版本核验](v0.10.3-release-2026-10-12.md)。
- 新建客户端时读取代理配置。旧实例需完整退出后重启，重新双击仍驻留的旧实例不会更新 HTTP 客户端。

本轮 Windows 本地验证：Rust workspace 默认与 `ts-rs` 测试全部通过（adapter 38 项、daemon 105/167 项及集成测试），新增回环边界与 451 非重试测试通过；未启动端口 probe、11 项监听重绑定回归通过。`cargo fmt --check`、Clippy `--all-targets --all-features -D warnings`、Tauri `cargo check --locked --offline` 和 `git diff --check` 通过；ts-rs 仍有既有属性解析提示。新的真实模型推理和原生应用候选尚未执行，模型目录成功不能替代这些验收。

## 复用的排查方法

1. 通过 `/health` 确认实际 daemon 版本和 revision。
2. 确认官方 base 与模型；查询调用历史，区分入口父请求与直接 provider 请求。
3. 对同一官方 URL 比较直连与已配置代理，用无密钥 GET/空 POST 排除推理成本与正文因素。
4. 用同一 Rust/reqwest feature 配置复现，而非仅用浏览器的出口 IP 推断 daemon 出口。
5. 以模型目录进行非推理鉴权验证；保持密钥在本地内存内，不写日志或文档。
6. 同时验证本地模型未启动时不得被代理错误页误判为可达。

来源：[reqwest 0.12.28 features](https://docs.rs/reqwest/0.12.28/reqwest/#optional-features)、[TypeSafe 官方 API](https://docs.typesafe.ai/api)；传输行为也核对了本地锁定依赖的源代码。
