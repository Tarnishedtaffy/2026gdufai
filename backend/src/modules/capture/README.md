# M1 确认、提交与追问流程

对应团队工单 #7。维护人：`yukacezar569-blip`。识别端工单 #6 由 `mianyoubiaoqing` 负责。

## 当前交付边界

- `prepare` 接收识别草稿，`update` 合并用户修正，两者都不调用 M2。
- 用户明确确认后调用 `submit`，通过注入的导入函数提交契约 v1.2 批次。
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

- 本工单维护 `packages/capture-flow/src/` 中的纯流程及 `backend/test/capture/`。后端本目录的 `index.ts` 保留兼容公共入口，前端通过 `@gduf/capture-flow` 使用共享包，不跨目录引用后端源码。
- 识别同学在独立文件中提供草稿，引用公开类型，避免同时修改 `session.ts`。
- 前端接入为共享范围，PR 单列并请求 `Tarnishedtaffy` 审核。

## 接入方式

创建 `createCaptureSession({ importBatch, newId })`，将 M2 客户端与 ID 生成器作为依赖传入。
流程不决定 HTTP、鉴权或模型服务商。应用层依照契约 v1.2 的单用户方案提供稳定会话和 `getDemoUserId()`；识别草稿不能覆盖身份或幂等键。

1. `prepare(context, drafts)`：准备单笔或多笔草稿。
2. `update(recordId, patch)`：合并用户明确修改的字段，未提及字段不变。
3. 用户点击确认后执行 `await submit()`。
4. 从 `getSnapshot()` 读取独立副本，用实际反馈展示追问或轻提示。

原消息时间保持不变。缺失发生时间不会自动补成当前时刻，时间兜底由 M2 决定。
状态为 `retry` 时继续冻结原记录与重试载荷，以免在服务端已入库但响应丢失后重复记账。
用户可先到账单一览核对，再二次确认“放弃本次提交，重新填写”；`discard()` 仅清除本地状态，不撤销服务端账单、不自动重发。提交仍在执行时禁止放弃；新草稿不会复用已放弃记录的标识。
遇到用户 ID 不一致的永久 `INVALID_BATCH`，仍须修正前后端配置并重新构建；放弃不会替用户修改部署身份。

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
单元测试使用契约 stub；`backend/test/capture/` 的集成测试直接使用真实 Fastify/M2 和 SQLite 内存数据库，包含本地 HTTP 鉴权、确认前不入库、补字段、网络重试及时间规则。前端保留 App/provider/组件 renderer 和 API stub 回归，不导入后端源码；前端回归与后端真实联调分开记录。

识别草稿也要经过共享金额校验，换算整数分超出 JavaScript 安全表示范围时在请求前拦截。零和负数保留给 M2 按契约判为缺金额；M1 不重写元金额。单条回执类型使用 `CaptureResult`，与前端整批响应 `ImportResult` 区分。

### 真实模式接入

Docker 前端使用真实 API。Compose 构建时将 `DEMO_USER_ID` 同步给前端的 `VITE_DEMO_USER_ID`；更换用户后必须重新构建。分开启动前后端时也必须保证两者一致。

配置了非占位 `APP_AUTH_TOKEN` 时，在页面的会话鉴权入口输入同一令牌。令牌仅在本页内存使用，由 API 客户端发送 Bearer 请求头；不写入浏览器存储、不放入前端构建变量，刷新后需重新输入。未配置或为 `change-me` 时按契约开发模式放行；生产必须设置非占位值。

图片/语音保留附件入口与待接入提示。真实识别结果通过 `acceptDrafts` 交接 `modality` 与服务端 `sourceRef`；本地文件名不作为上传引用。OCR、ASR 和上传接口仍由 #6 及契约变更流程接入，本 PR 未实现这些能力。

旧 PR #9 `c288019` 的静态 fixture 已被当前 M2 自动回归取代，历史日志保持原文。当前契约规定 `DUPLICATE_RECORD` 为 `warning`，不再存在旧日志中记载的契约差异。M1 原样保留反馈严重度与可选分类候选，不重算追问轮次或未来时间容差。

### 与 #17 的合并顺序

采用复审给出的第二种顺序：#13 先合，再由 #17 / #18 完成 v1.3 迁移。当前 main 仍是 v1.2，旧 `REFUND_NOT_SUPPORTED` 保留兼容；话术已预兼容 #17 最新的 7 个退款/还款反馈码，而非早期 review 的 5 个。退款真实用例按 `entry_type` 迁移是否存在分别断言旧版拒绝和新版追问/中性记录，两个分支分别联调。

本 PR 不发送尚未在 main 冻结的 `originalTransactionId`，不实现匹配选择、`entryType` 列表或中性记录 mock；这些由 #16 / #17 / #18 跟踪。恢复的是附件入口，上传、识别和 `sourceRef` 回填仍待 #6，不能据此标记多模态记账已通。

未知反馈码会保留并展示，不擅自解释为入库、退款或时间修正。
M1/M3 的对外对话和上传接口仍按团队的 contract-change 流程确认。
