# 契约 10 · SysTorch「开始」会话与模型对话

> 状态：已实现，按本地预览候选 `m1-systorch-20261030.3` 验证。不是 Release 承诺。此契约只描述普通模型聊天记录；持久人工决策任务仍按[契约 08](08-持久Choice契约.md)执行。

## 1. 边界

- 对上游的即时调用仍使用 `POST /v1/systemone`，请求仍是 Jev `JevRequest`，响应仍是 `JevResponse`。本功能不改变路由、adapter、失败回退或调用历史协议。
- 会话正文是另一份独立记录：每条用户消息保存原始 Jev 请求，每条模型回复保存完整 `JevResponse`；失败保存稳定错误码、HTTP 状态、可重试标志与请求 ID。不会把聊天消息伪装成额外的 provider attempt，也不会从仅含路由元数据的 `call_logs` 猜测正文。
- 单个用户消息可包含多个稳定 question ID；`question_order` 保留 UI 次序。SysTorch 题目与 TypeSafe/Jev 的题型结构一致，`JevResponse` 保留完整答案、usage、route trace 和 adapter extra。
- 已有 DAG、route glow、provider 生命周期和持久人工 Choice 仍走原路径。普通模型会话不创建人工作答任务。

## 2. 存储与权限

- SQLite `systorch_start_sessions` 保存调用者、稳定会话 ID、幂等 ID 摘要、revision、时间、置顶/归档/已读标记和加密 payload。消息正文以 owner key AEAD 密文保存，数据库不含可搜索的明文标题；列表标题由授权 daemon 解密首个问题后临时计算。
- `GET`/写入只允许创建该会话的 caller；本机 owner 可恢复其本地数据目录中的会话。其他身份读取时统一得到 `404`，不泄露会话是否存在。管理角色本身不会获得人工作答能力，也不自动变成其他 caller。
- 原始请求、响应、失败正文不会写日志或调用历史。API 响应使用 `Cache-Control: no-store`。调用 Token 不随会话持久化。
- 普通聊天保留到用户删除。owner key 与数据库必须一同备份；缺 key 或错 key 时 daemon 拒绝解密，不能静默重置会话。
- 会话上限为每 caller 10,000 条，每条最多 512 条消息，单次写入与加密会话 payload 最多 8 MiB。附件占用按 caller 的 256 MiB 资产配额计算；超限返回稳定错误，已存内容不被截断或覆盖。

## 3. 原子写操作

所有会话写入是单资源事务，不提供聊天列表、消息数组或全表替换 API。

### 新会话或追加消息

```text
POST /v1/systorch/sessions/{session_id}/messages
Authorization: Bearer <caller-token 或本机 owner>
Content-Type: application/json
```

```json
{
  "expected_revision": 0,
  "message": {
    "kind": "request",
    "id": "msg_7c39...",
    "created_at": 1793290000,
    "question_order": ["publish"],
    "request": {
      "model": "jev-quality",
      "state": {"context": "合成示例"},
      "questions": {
        "publish": {
          "type": "noul",
          "instructions": "现在可以发布吗？",
          "criteria": {"true": "可以发布", "false": "暂缓"}
        }
      }
    }
  }
}
```

新 ID 从 revision `0` 创建，返回 `201` 和 revision `1`。后续每次只追加一条消息，并携带最近读取到的 `expected_revision`。response/failure 必须通过 `reply_to` 指向一个尚未得到回复的 request；重复消息 ID 与相同正文可安全重试，异正文复用 ID 返回 `409`。并发修改返回 `409 session_revision_conflict`，调用方先 `GET` 最新 revision，再重新提交明确的追加操作。

成功回复示例：

```json
{
  "expected_revision": 1,
  "message": {
    "kind": "response",
    "id": "msg_91ad...",
    "created_at": 1793290002,
    "reply_to": "msg_7c39...",
    "response": {"model": "jev-latest", "answers": {"publish": {"type": "noul", "noul": 0.91}}}
  }
}
```

完整结构以 Rust ts-rs 生成的 `StartMessage`、`StartSession`、`StartSessionSummary`、`AppendStartMessage` 为准。失败分支不保存上游原始 body，只保存 `error_code/status/retryable/request_id`。

### 查询与轻量状态

| Method | Path | 作用 |
|---|---|---|
| `GET` | `/v1/systorch/sessions?offset=0&archived=false` | 读取调用者可见的 25 条摘要；标题解密后计算，默认按置顶、最近更新时间排序 |
| `GET` | `/v1/systorch/sessions/{id}` | 读取单个完整会话及完整消息流 |
| `PATCH` | `/v1/systorch/sessions/{id}` | 原子修改 `pinned`、`archived`、`mark_read`，要求 `expected_revision` |
| `DELETE` | `/v1/systorch/sessions/{id}` | 删除单个会话、密文和不再被其他任务/会话引用的附件 |
| `GET` | `/v1/systorch/sessions/{id}/assets/{asset_id}` | 仅在该会话附件关联范围内读取媒体 |

打开会话只更新 `last_read_at` 与 revision，不改变 `updated_at` 排序。向已归档会话追加新消息会自动恢复到最近列表。`archived` 会话和普通决策任务在「开始」历史抽屉中切换查看；设置里的「已归档会话」区也可恢复或删除普通模型聊天。会话 pin/archive 状态保存在 daemon，而不是本地正文缓存。

## 4. 附件

- 为了可恢复，写入会话的 `JevRequest.assets` 必须使用加密上传资产 ID；base64 仅用于不要求留存的即时 API 请求，不能写进会话 payload。
- 开始页为会话请求上传后，在追加 request 的同一 SQLite 事务中绑定会话与资产并延长资产保留。图片/音频/视频/普通文件都可留存；adapter 是否支持该类型仍在实际 `/v1/systemone` 调用边界决定，不能因预选 provider 禁止用户附加。
- 删除会话时解除其附件关系；若资产仍被其他决策或会话引用则保留，否则立即删除密文。上传与会话链接均受 caller 权限和 256 MiB 临时资产配额控制。

## 5. 恢复与失败

- 先原子追加用户请求，再向 `/v1/systemone` 发出请求，最后追加成功 response 或失败记录。窗口关闭/daemon 重启后，已有消息可以读取；若只有 request 而没有回复，摘要标记 `interrupted=true`，开始页明确显示“请求已保存但没有记录回复”，由用户检查状态后手动重试，绝不静默自动重发。
- 若模型成功而 response 密文保存暂时失败，当前窗口仍显示真实响应并提示未能保存；用户可保留窗口或开新会话。已提交的上游调用不可假装从未发生。
- response/failure 必须绑定已存在且未回复的 `reply_to`；重复回复、未知目标、旧 revision 和无效题序都原子拒绝，数据库旧 payload 保持不变。
- 已归档、置顶、删除和回复分别影响元数据或记录；归档不等于删除，删除不保留可解密正文。

## 6. 验证边界

`scripts/verify-systorch-m1.mjs` 在独立临时配置/SQLite 和本地合成上游验证加密/明文搜索、caller 隔离、CAS 冲突、幂等重试、多轮追加、资产范围读取/删除、daemon 重启、桌面及 390px 触屏 UI。该脚本的 `syntheticModelCalls` 不计真实官方 API。具体工作树、候选哈希与未覆盖真机路径见[2026-10-30 M1 会话验证记录](../verification/systorch-start-sessions-2026-10-30.md)。
