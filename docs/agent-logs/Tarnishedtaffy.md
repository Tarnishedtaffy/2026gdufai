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

## LOG-Tarnishedtaffy-20261119-01

- 时间：2026-11-19 21:04 +08:00
- 工具 / 模型：Trae / DeepSeek-V4.1-Flash
- 模块：前端（评审 / 契约协作）
- 任务：在 #22 追加贷款利息 v1.5 计划评审（2 个 P1、2 个 P2、3 个 P3），并核对 #13 / #17 是否有新提交及其复审问题状态
- 关键提示词 / 上下文：本轮只发评论、不改代码、不合并；重点检查 2C-consistent 的 outstanding 口径、纯利息判定、已结清原单话术、本金收入口径，以及 #13 反馈表与 #17 v1.4 的同步
- 做了什么：
  - 在 issue #22 发布计划评审评论，链接 https://github.com/Tarnishedtaffy/2026gdufai/issues/22#issuecomment-7009893136
  - 核对 #13：head 由 `265136b` 更新为 `f16f13c`，新增「对齐 v1.4 反馈并统一共享话术」
  - 核对 #17：head 由 `04fb0c0` 更新为 `64e58c9`，新增「修正退款话术与日志说明」「补充 v1.5 贷款还款口径预告」
- 决策：
  - #22 评审只提计划层问题，不代替 #17 的正式 review；#13 / #17 均不合并
  - #13 判定上一轮 P1 已修复：共享包 `captureFeedbackText` 已补齐 v1.4 八码，前端 `feedbackText` 改为同一冻结对象的别名，`feedback-source.test.ts` 断言对象同一性
  - #17 判定上一轮 3 个 P2：契约话术已改为「原账单已自动作废」，#18 正文已更新到 v1.4，但 #21 的「受影响模块负责人已知悉」仍未勾选，属部分修复
- 验证：沙箱 `echo ok` 正常；`gh auth status` 为 Tarnishedtaffy；`gh issue view 22` 为 OPEN；评论提交返回 URL；`gh pr checks` 显示 #13（run 44491401514）与 #17（run 44494531974）的 typecheck/lint/test/build 与 Docker smoke 均 pass；#13 / #17 仍为 `CHANGES_REQUESTED`、`MERGEABLE / CLEAN`
- 人工审核：待审核
- 遗留问题：#17 的 #21 受影响方确认仍未勾选；#18 标题仍写 v1.3（正文已 v1.4）；#13 描述中的验证基线仍是 #17 `04fb0c0`（当前 head `64e58c9`，八码未变）。本轮无提交、未推送

