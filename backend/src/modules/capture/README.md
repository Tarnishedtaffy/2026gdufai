# M1 确认、提交与追问流程

对应团队工单 #7。维护人：`yukacezar569-blip`。识别端工单 #6 由 `mianyoubiaoqing` 负责。

## 当前交付边界

- `prepare` 接收识别草稿，`update` 合并用户修正，两者都不调用 M2。
- 用户明确确认后调用 `submit`，通过注入的导入函数提交契约 v1.1 批次。
- M2 返回后按 `batchId`、`recordId` 对应每一条结果；`duplicate` 展示为已经记过。
- 仅待追问记录参与下一次提交，已完成或已放弃记录不重发。
- 传输失败或响应无法对应时保留原批次，重试使用完全相同的载荷。
- 不访问数据库、不分类、不统计、不维护追问轮次，不新增 HTTP 路由。

## 与识别端的内部交接提案

以下为基于现有契约的实现提案，需由双方评审确认；不是已经冻结的新接口。
所有调用只经 `index.ts` 导出内容完成。

`CaptureDraft` 包含现有入站字段：

```ts
{
  amount: 24.5,                         // 元
  merchant: null,
  occurredAt: '2026-11-17T12:00:00+08:00',
  direction: 'expense',
  confidence: 0.9,
  rawText: '午饭麻辣烫24.5元',
  modality: 'text',
  sourceRef: null
}
```

不确定的信息保留 `null`。语音和图片也使用同一结构；`sourceRef` 只能来自上传/识别流程，不能以浏览器文件名代替。

`CaptureContext` 单独来自可信会话，包含 `sessionId`、`userId`、`sentAt`、`chatAt`。
程序生成 `batchId`、`recordId`、`idempotencyKey`，不接受识别结果覆盖身份。
`sessionId` 只用于内部关联，不发送到 M2。

主要文件归属提案：

- 本工单维护 `types.ts`、`session.ts`、`validation.ts`、`feedback.ts`、`index.ts` 及 `backend/test/capture/`。
- 识别同学在独立文件中提供草稿，引用公开类型，避免同时修改 `session.ts`。
- 前端接入为共享范围，PR 单列并请求 `Tarnishedtaffy` 审核。

## 接入方式

创建 `createCaptureSession({ importBatch, newId })`，将 M2 客户端与 ID 生成器作为依赖传入。
流程不决定 HTTP、鉴权或模型服务商；服务端调用者必须先取得经过鉴权的可信上下文。

1. `prepare(context, drafts)`：准备单笔或多笔草稿。
2. `update(recordId, patch)`：合并用户明确修改的字段，未提及字段不变。
3. 用户点击确认后执行 `await submit()`。
4. 从 `getSnapshot()` 读取独立副本，用实际反馈展示追问或轻提示。

原消息时间保持不变。缺失发生时间不会自动补成当前时刻，时间兜底由 M2 决定。
状态为 `retry` 时不允许改写原记录或新建一笔，以免在服务端已入库但响应丢失后重复记账。

## 验证与限制

仓库根目录运行：

```powershell
corepack pnpm -r typecheck
corepack pnpm -r lint
corepack pnpm -r test
corepack pnpm --filter frontend build
corepack pnpm dev:frontend
```

以根 `package.json` 为准，当前要求 Node >=22.18、pnpm 12.21.0。
前端默认使用模拟模式，演示结果存于内存，刷新后不会保留。
本流程单元测试使用契约 stub。主仓库当前尚未合并 M2 导入实现；PR #9（c288019）可用于临时真实 Fastify/SQLite 联调，结论与 stub 分开记录。鉴权、OCR/ASR 及完整对话入口仍需和相应负责人完成接入。
前端真实模式必须由应用注入可信会话上下文，不能复用演示用户身份。

### 临时真实 M2 联调（2026-11-18）

基于上游 `c47e094`，在临时副本覆盖未合并 PR #9 的 `c28801929b52f86e744ee7a4f748f2febb7953d5`，
通过真实 Fastify `app.inject` 和 SQLite 内存数据库执行契约第 4 节 M1 的 8 项检查，另加三轮终止、部分成功、多模态统一提交，共 11/11 场景通过。
M2 响应没有使用 stub；该分支没有包含或修改队友的 M2 实现。

虚构请求、`batchId` / `recordId` 和原始响应保存在
`backend/test/capture/fixtures/m2-pr9-evidence.json`。这是固定版本的验证证据，不是 CI 中自动重放的服务端。
缺 `sentAt` 场景分别验证 M1 阻止发送和直接非法请求被 M2 返回 `INVALID_BATCH`。
网络场景在真实入库后丢弃回执，重试得到 `duplicate` 且账单仍只有一笔。

观察到 M2 实际将 `DUPLICATE_RECORD` 严重度返回为 `warning`，契约 1.5 登记为 `blocking`；
本流程原样保留严重度，并依据 `duplicate` 状态完成，差异交由 M2 维护人核对。
这次联调不验证可信鉴权、生产界面、OCR、ASR 或上传；语音/图片从虚构字段草稿开始。

未知反馈码会保留并展示，不擅自解释为入库、退款或时间修正。
M1/M3 的对外对话和上传接口仍按团队的 contract-change 流程确认。
