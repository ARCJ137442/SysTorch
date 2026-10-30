# SysTorch 资产与多模态契约（当前实现子集）

> 状态：SysTorch canonical 即时请求入口 `POST /v1/systorch/systemone` 已实现；旧 `/v1/systemone` 保留为 Jev/TypeSafe-compatible 兼容入口。本文件只冻结当前已实现的资产传输、TypeSafe 图片投影与持久多题请求边界，不代表所有音视频 adapter 或 Android 真机路径均已就绪。

## 1. 设计原则

- SysTorch 维护自己的多模态资产表；TypeSafe `model/state/questions/assets` 是兼容投影。图片、音频、视频、文件选择属于输入事实，不能由当前入口提前拦截或因转换失败而静默丢失。
- 资产以稳定引用键关联到 `state` 或某题的 `instructions`。共享背景和单题范围因此可分别呈现；引用键必须作为完整字符串出现，不把“包含同一子串”当成已引用。
- canonical 即时 SysTorch `/v1/systorch/systemone` 保留 TypeSafe-compatible `model/state/questions` 核心，并可增加 `question_order`、`assets` 与 `extensions`。小文件可用 `data_base64`，大文件用加密上传后的 `asset_id`；同一 descriptor 两者必须且只能出现一个。ID 是本机引用，永远不是 URL 或路径。TypeSafe adapter 消费 `question_order` 这类只用于呈现的 SysTorch 元数据，再按能力投影 core 和媒体；持久任务与可恢复聊天一律先上传，不把 bytes/base64 塞入加密会话 JSON。
- Adapter 按实际声明的媒体能力筛选路由候选。无能力的候选不实发、不计失败或辉光；全部候选不兼容时返回可读格式错误并保留调用方原始草稿。
- 不可等价投影时明确报错，不能删字段、重编码成猜测格式或拆成多个上游请求。

## 2. 请求形状

资产由 map 键注册。即时 Jev `JevRequest.assets` 与 SysTorch 持久请求的 `assets` 使用同一 `RequestAsset` 形状。持久请求以 `model/state/questions` 作为 TypeSafe-compatible 核心，再加 `entry`、`idempotency_key`、`ttl_seconds`、`question_order` 等任务字段；旧 M1 `question/context/choices` 仍只作为输入兼容字段：

```json
{
  "image_ref_01": {
    "type": "image",
    "format": "png",
    "mime_type": "image/png",
    "filename": "diagram.png",
    "asset_id": "asset_4f…"
  }
}
```

内联小文件将 `asset_id` 替换为标准 base64（不带 `data:` 前缀）：

```json
{
  "image_ref_01": {
    "type": "image",
    "format": "png",
    "mime_type": "image/png",
    "filename": "diagram.png",
    "data_base64": "iVBORw0KGgo…"
  }
}
```

输入中的引用键放在 SysTorch 命名空间下，原有 state/instructions 内容保持原值；canonical SysTorch 即时请求可额外携带 `question_order`，但它不改变模型问题与答案的 ID 映射：

```json
{
  "state": {
    "text": "请检查附件中的图表",
    "_systorch": { "assets": ["image_ref_01"] }
  },
  "questions": {
    "review": {
      "type": "choice",
      "instructions": {
        "text": "图表是否支持这个结论？",
        "_systorch": { "assets": ["image_ref_01"] }
      },
      "criteria": { "yes": "支持", "no": "不支持" }
    }
  }
}
```

持久人工 `/v1/systorch/decisions` 接受 canonical `model/state/questions` 加任务字段，媒体引用与题型 schema 在同一加密任务中保存；旧 M1 单题/Choice body 兼容读取、提交和幂等重试。普通模型对话经 `/v1/systorch/sessions/{id}/messages` 原子追加，request 保存 TypeSafe-compatible Jev core 与 `question_order`，response 保存完整 JevResponse；媒体与会话在同一 SQLite 事务关联。具体 CAS、权限和保留规则见[契约 10](10-SysTorch开始会话契约.md)。canonical `/v1/systorch/systemone` 将 SysTorchRequest 无损投影到内部 Jev core；旧 `/v1/systemone` wire shape 保持可用。TypeSafe adapter 的 `request_payload` 再把媒体 asset ID 转为官方格式，并从官方路径剔除展示顺序与不兼容扩展。

## 3. 大文件上传与授权读取

上传原始 bytes，而不是 base64 JSON：

```http
POST /v1/systorch/assets
Authorization: Bearer <caller-token>
Content-Type: video/mp4

<raw file bytes>
```

成功响应返回 `asset_id`、校验后的存储 MIME、字节数和到期时间。最大单文件 64 MiB、每调用者临时额度 256 MiB、每请求最多 128 个引用、一次请求最多解析 64 MiB。上传采用随机 ID、加密 payload、密钥绑定摘要和长度复核；不接受任意文件路径，不向客户端返回公开存储 URL。

为持久任务注册的资产链接与 task 行在同一个 SQLite 事务中提交，任务截止时间与终态留存会延长资产保留期。普通 chat 附件通过 `systorch_start_session_assets` 与会话绑定，删除会话时解除关联，并立即清除不再被其他任务/会话引用的 asset。原始 `/v1/systorch/assets/{id}` 仅允许资产所有者读取；决策题目和普通会话分别用 `GET /v1/systorch/decisions/{task_id}/assets/{asset_id}`、`GET /v1/systorch/sessions/{session_id}/assets/{asset_id}`，服务端分别检查对应父资源权限和附件关系。仍被任一资源引用的资产不能单独删除。

## 4. Adapter 投影与拒绝边界

### TypeSafe 官方

- 当前可投影的媒体是 PNG/JPEG 图片。Adapter 验证实际 PNG/JPEG 头、MIME/格式一致、各边 280–1568 px、单图不超过 16 MiB、图像总量不超过 32 MiB；不静默 resize。发送时投影为 TypeSafe `assets` 中的 `{type, format, data_base64}`，并附 `TypeSafe-Danger-Zone-Images: true`。
- Box 问题必须至少引用一张图片。缺图或图像格式不兼容时在上游发送前失败。
- 官方图片与 Box 功能仍属于 TypeSafe 实验能力，按其[官方图片文档](https://docs.typesafe.ai/images)和[Box 文档](https://docs.typesafe.ai/primitives/box)理解。
- 官方 adapter 不宣称原生音频/视频支持；不支持类型会被能力路由跳过，不能伪装成图片或 JSON 文本。

### 明确配置的 SystemOne-compatible 本地端点

当 Provider 启用 `forward_extensions` 时，TypeSafe-compatible 本地端点可以接收音频/视频/文件 descriptor，保留 `format`、`mime_type`、`filename` 与解码后的 bytes。该开关表示调用方明确选择透传协议扩展，并不能证明目标模型确实具备相应能力；实际格式错误仍由目标端点反馈。

Vercel 当前只声明 image；Laya 只有显式开启兼容扩展透传才声明附件能力；OpenRouter 的 chat-completion 转换当前不保留 SysTorch 资产语义，故相关候选会跳过。新增 Adapter 时必须补 `supports_asset_type`、真实投影或明确拒绝及路由回归。

daemon 侧 timing、按需启停等 Adapter wrapper 也必须把 `supports_asset_type` 无损转交给内层 adapter；否则路由器会在 Adapter 实际调用前把受支持媒体误判为格式不兼容。此规则已有 wrapper 回归和真实请求证据。

## 5. 隐私、失败与草稿

- 浏览器仅在内存中持有 `File`、预览 object URL 和当前输入；不写 localStorage、session index、日志、toast 或调用历史。
- 传输失败时保留当前题、共同背景及附件引用；重复提交复用当前草稿上传 ID。删除本地草稿时尝试删除未绑定上传，清理失败由临时到期回收兜底。
- MIME 声明与已上传资产元数据必须相符；TypeSafe image adapter 还校验文件头和尺寸。坏 ID、越权 ID、过期 ID、配额超限和不支持格式使用错误码返回；不附带媒体 bytes 或密钥。
- Android 视图提供 `image/*`、`capture="environment"` 与通用文件输入；浏览器移动端自动化已验证属性与 390px 布局，实际 Tauri Android 相机/相册/权限拒绝仍待真机验收。

## 6. 当前验证证据

2026-10-30 本地工作树已验证：workspace Rust 默认/`ts-rs`、决策资产与四题类型化回答、普通 chat 多轮持久化、caller 隔离、CAS/幂等、附件会话授权、SQLite 重启恢复，UI tests/lint/build；隔离 Edge/Playwright 合成环境验证桌面及 390px 触屏发送、续聊、刷新重开与无横向溢出。详见[会话与开始页核验](../verification/systorch-start-sessions-2026-10-30.md)。2026-10-29 的一次隔离 TypeSafe 官方请求仍见[资产链路核验](../verification/systorch-assets-2026-10-29.md)。官方 TypeSafe 不支持音视频的结论只限当前 adapter；本地兼容端点的音视频协议还需实测；合成 fixture 不证明真实目标模型接受音视频，也不证明 Android 真机文件选择器。
