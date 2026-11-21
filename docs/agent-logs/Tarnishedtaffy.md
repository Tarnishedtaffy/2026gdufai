# Agent 日志 · `Tarnishedtaffy`

> 写入者：`Tarnishedtaffy` 本人的代理，只追加到文件末尾。格式见 [README.md](README.md#条目模板)。
> 负责模块：见 [README 团队分工](../../README.md#团队分工)。本文件只记录本人开发会话；PR 汇总写入 [SUMMARY.md](SUMMARY.md)。

<!-- 在此线以下按时间顺序追加条目 -->

## LOG-Tarnishedtaffy-20261118-01

- 时间：2026-11-18 19:51 +08:00
- 工具 / 模型：Trae / DeepSeek-V4.1-Flash
- 模块：前端
- 任务：把契约 v1.2 新增的贷款类别同步到前端 mock，并消除「色值只打日志不断言」的隐性漂移
- 关键提示词 / 上下文：复审 #9 时发现后端 seed 已到 12 类，但 `frontend/src/mock/data.ts` 仍是 1–11；`frontend/verify2.test.ts` 的 B4 只 `console.log`、没有断言，CI 不会报错
- 做了什么：
  - `frontend/src/mock/data.ts` 补 `id: 12 贷款（income，#0EA5E9，icon: bank）`
  - `frontend/verify2.test.ts` 的 B4 改为 12 个色值，并加 `toHaveLength(12)`、`toEqual` 与 `isPreset/isActive` 断言
- 决策：
  - 图标字符串用 `bank`，与前端现有命名风格一致；当前视图不渲染 icon 字段，不影响 UI
  - B4 从日志核对改为硬断言，避免下次契约扩类时再次静默漂移
- 验证：`pnpm -r typecheck` / `lint` / `test` 通过；frontend 31 例、backend 18 例（main 基线，未含 #9）
- 人工审核：待审核
- 遗留问题：无

## LOG-Tarnishedtaffy-20261118-02

- 时间：2026-11-18 20:20 +08:00
- 工具 / 模型：Trae / DeepSeek-V4.1-Flash
- 模块：前端
- 任务：修复真实模式下前端 `userId` 与后端 `DEMO_USER_ID` 不一致导致整批 `INVALID_BATCH`
- 关键提示词 / 上下文：审查 #13 时发现 `CaptureView.vue` 硬编码 `userId: 'demo-user'`，而 #9 合入后服务端要求入站 `userId` 等于 `DEMO_USER_ID`（默认 `u_001`），真实模式提交必失败
- 做了什么：
  - `frontend/src/api/request.ts` 新增 `getDemoUserId()`，读 `VITE_DEMO_USER_ID`，未配置时回退 `u_001`
  - `CaptureView.vue` 改用 `getDemoUserId()`，删除硬编码 `demo-user`
  - `frontend/env.d.ts`、`.env.example`、`README.md` 同步 `VITE_DEMO_USER_ID` 与实现状态
  - `frontend/bugtest.test.ts` 增加默认值与覆盖值两条用例
- 决策：前端身份走构建期变量并默认对齐服务端默认值，不引入运行时接口；部署若改 `DEMO_USER_ID`，需同时传 `VITE_DEMO_USER_ID`
- 验证：`pnpm -r typecheck` / `lint` / `test` 通过；frontend 33 例、backend 82 例；`VITE_USE_MOCK=false pnpm --filter frontend build` 成功
- 人工审核：待审核
- 遗留问题：#13 的真实模式会话 provider 仍需补齐

### LOG-Tarnishedtaffy-20261121-02

- **时间**：2026-11-21 14:30（+08:00）
- **工具/模型**：Trae / DeepSeek-V4.1-Flash
- **模块 / 分支 / PR**：M2 / `feat/m2-transaction-edit` / #33
- **任务**：处理 PR #33 的变更请求，收紧账单纠错边界并补齐契约说明
- **关键提示词**：「先帮我修复 PR #32 和 #33 的变更请求」「都先不合并」
- **代理做了什么**：
  - `backend/src/modules/ledger/transaction-edit.ts`：PATCH 增加 body 校验（非普通对象或缺全部可编辑字段 → `422 INVALID_QUERY_PARAM`，`field: body`）；`voidTransactionById` 先判 `entry_type` 再判 `status`，中性记录即使已 void 也返回 422；`changedCategory` 仅在类别实际变化时为真；`merchant` 长度按 Unicode 码点计算
  - `backend/src/modules/ledger/repository.ts`：为 `voidTransaction` 补 JSDoc，明确仅供 intake 内部使用，外部走 `transaction-edit.ts`
  - `backend/test/m2/transaction-edit.test.ts`：新增空对象 / 数组 body、同类别不写学习规则、中性且已 void 仍 422、emoji 长度边界 4 组用例
  - `docs/contracts/module2-interface-v1.md` §2.9：写明 body 校验、中性记录禁止 PATCH / void（`field: entryType`）、PR-C 承接撤销、`occurredAt` 允许未来时间
  - 新建 contract-change issue #34（新增 `TRANSACTION_NOT_FOUND` 错误码）并关联本 PR
- **决策**：body 校验放在 `patchTransaction` 入口，路由层保持薄；`TRANSACTION_NOT_FOUND` 虽然是新错误码，但只增不删，按流程单独开 issue 而不直接改契约基线
- **验证**：`npx -y pnpm@12.21.0 -r typecheck/lint/test` 全绿；backend 204 项、frontend 73 项
- **人工审核**：待审核
- **遗留问题**：PR 仍为 CHANGES_REQUESTED，等作者确认；中性还款撤销需 PR-C 实现；不合并、不删分支

