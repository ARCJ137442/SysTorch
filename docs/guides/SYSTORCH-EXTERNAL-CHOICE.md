# SysTorch：外部程序提交后退出，人在 APP 回答，再取回结果

适用于 SysTorch 0.11.0 预发布版；新回执默认使用 http://127.0.0.1:11435。脚本不会保存调用 Token。M1 隔离预览及其 11436 沙箱属于历史候选，不能与新 Release 的任务或回执混用。

## 1. 在哪里创建调用 Token

打开 APP 的 **统计 → 访问与活动 → 调用 Token → 创建 Token**，名称可填 `外部决策示例`，权限选择 **只读**，创建后复制一次显示的完整 Token。

这里的「只读」指旧管理权限：不能管理提供商等配置，但可以提交决策、查询自己提交的任务。Token 不是供应商 API key，也不是本机主人作答凭据。不要为了回答而把这个 Token 登录进 APP；原生 APP 的决策台使用独立主人身份。

两次调用必须使用**同一个完整 Token**。另建同名 Token 仍是另一个身份，无权读取旧任务。撤销 Token 会立即阻止它继续查询；创建界面只显示一次 secret，应由使用者保管。

## 2. 第一次运行：提交后进程结束

打开 PowerShell，进入本仓库根目录，复制运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\examples\choice-client.ps1 -Action Submit
```

粘贴刚复制的 Token，输入不会回显。脚本提交的问题是 `Should I review the changes before continuing?`，候选为「先检查修改」和「继续，稍后检查」，仅用于测试，**不会执行任何实际动作**。默认截止时间为一小时。

成功时显示 `Accepted task: choice_… (pending)`，并保存回执到用户主目录的 `SysTorch-choice-demo.json`。调用进程此时已经结束，可以关闭整个调用终端；不需要维持连接或后台轮询。让 APP／本地网关继续运行即可。即便 APP 也完全退出，已接收任务仍存于数据库，重新打开后可继续。

回执只包含网关地址、原始提交、幂等键和任务 ID，没有 Token。它仍包含题目与上下文，所以请当私人文件保存。若提交时网络中断，保留该文件并重跑同一条 Submit：使用原键与原请求恢复同一任务，不能为不确定的提交随意换键。

## 3. 在 APP 决策台作答

1. 打开「决策台」，找到上述问题；若尚未出现，点击刷新。
2. 阅读题目后选择 `Review the changes first`。
3. **点选只是草稿**。再点击「提交回答」，等待权威保存成功反馈。

不要切换 API 地址来查找另一个实例中的任务：任务属于接收它的数据库与调用身份。SysTorch 0.11.0 默认本机端口是 11435；2026-10-24 M1 隔离预览使用独立 11436，旧回执应继续指向原实例。

## 4. 第二次运行：新进程取回原任务

新开 PowerShell，重新进入仓库根目录，复制运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\examples\choice-client.ps1 -Action Query
```

再次输入**同一个 Token**。脚本读取原回执，先获取任务权威状态与原始观察，再获取 `/result`。选择上例第一项后应看到类似：

```json
{
  "kind": "answered",
  "choice_id": "review"
}
```

严格结果的关键部分是：

```json
{
  "answers": {
    "choice": {
      "type": "choice",
      "choice": "review",
      "probabilities": {"review": 1, "continue": 0},
      "confidence": 1
    }
  }
}
```

这是结果的局部示意，实际输出还包含其他协议字段及原始观察时间。one-hot 的 1 是选择编码，不是概率校准、正确率或测得的信心，也不授权调用方自动执行选项中的动作。

如果未作答，会显示 `pending` 并结束本次查询，不取消任务；稍后重跑 Query。拒答、附条件、取消和过期会显示实际状态与原始观察，不会强行转成「同意」。HTTP 完整约定见[契约 08](../contracts/08-持久Choice契约.md)。

## 参数、下一道题与排错

| 需求／现象 | 操作或原因 |
|---|---|
| 创建下一道独立示例题 | 在 Submit 与 Query 两次命令后都加 `-ReceiptPath "$env:USERPROFILE\SysTorch-choice-demo-2.json"`，使用一个新回执文件 |
| 改网关地址 | **首次 Submit** 时加 `-Gateway 'http://127.0.0.1:其他端口'`；已有回执永远使用其记录的网关，避免提交与查询串实例 |
| 提交超时，不知道是否接受 | 原回执已先保存，重跑同一 Submit；成功后补记同一任务 ID |
| Query 说缺少任务 ID | 尚未确认接收；用同一回执重跑 Submit，取回已接收任务，而非手工编造 ID |
| 连接拒绝／超时 | APP／网关未运行，或地址／端口不属于该实例；先在 APP 确认网关状态 |
| 401 | Token 错误、撤销、未提供；不要使用管理员密码或供应商 key |
| 404 | 回执／网关不匹配，或 Token 不是原提交者；不表示应新建任务替代 |
| 一小时后仍未回答 | 已过期；终态不能重新打开，下一题使用新回执与新键 |
| 想修改自己的业务题目 | 修改示例脚本中初次创建的 submission，**使用新回执**；已发出的请求需要走显式 revisions API，不能偷偷复用键换题 |

脚本兼容 Windows PowerShell 5.1 和 PowerShell 7；Linux/macOS 可用 `pwsh -File ./scripts/examples/choice-client.ps1 …`。非 Windows 环境需指定 `-ReceiptPath` 为自己的可写位置，默认地址仍指运行脚本的那台机器。Android 上的 127.0.0.1 是手机自身，从电脑访问手机需明确启用局域网访问并使用手机地址，不会自动穿透网络。

历史核验（2026-10-24）：两个独立 Windows PowerShell 5.1 进程、M1 Standalone 预览和原生决策台完成重复提交、等待、作答与取回验证。该记录不是 SysTorch 0.11.0 人工验收。脚本不注入主人密钥、不读取现用数据、不调用任何付费上游。

机器核验摘要与精确脚本／EXE 哈希见[本轮证据](../verification/systorch-brand-and-external-choice-2026-10-24.json)，可通过 `scripts/verify-choice-example.mjs` 在独立配置和原生 WebView 中复现。该验证器测试时通过进程环境提供合成 Token；这是测试夹具自己的变量，不是 SysTorch 自动注入的产品配置。
