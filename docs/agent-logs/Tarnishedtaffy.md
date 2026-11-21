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

### LOG-Tarnishedtaffy-20261121-01

- **时间**：2026-11-21 14:30（+08:00）
- **工具/模型**：Trae / DeepSeek-V4.1-Flash
- **模块 / 分支 / PR**：M2 / `feat/m2-loan-interest-a` / #32
- **任务**：处理 PR #32 的变更请求，修复迁移重名回滚风险并补齐契约 v1.5 缺口
- **关键提示词**：「先帮我修复 PR #32 和 #33 的变更请求」「都先不合并」
- **代理做了什么**：
  - `backend/src/db/migrations/003_loan_interest.sql`：同名自定义类别改为「唯一后缀」重命名（`(旧)` → `(旧2)`…`(旧4)`），避免撞 `UNIQUE(kind,name)` 导致整个迁移回滚；预设 13 改用普通 `INSERT`，让意外冲突显式失败
  - `backend/test/m2/migration-loan-interest.test.ts`：新增旧库已占用 `贷款利息(旧)`、自定义 13 与同名 14 并存、种子后类别 13 关键词逐项相等、`principal_cents` 拒绝负数、`idx_tx_matched_entry` 存在等 5 条用例
  - `docs/contracts/module2-interface-v1.md`：修正 `MISSING_ORIGINAL_TRANSACTION` / `REPAYMENT_RECORDED_NEUTRAL` 话术；§1.3 补拆分校验与 `effectivePrincipalCents` 落库规则；新增 §1.8 原账单匹配（1D）；§1.6 补 `#interest` 幂等键；§2.9 补作废原贷款口径；统一 `netCents` 措辞
  - `docs/GLOSSARY.md`、`docs/ARCHITECTURE.md`、`frontend/verify2.test.ts`：预设类别 12 → 13
- **决策**：唯一后缀用多段 `UPDATE ... NOT EXISTS` 覆盖 4 级，保持 SQL 可读；超过 4 级仍冲突则让 `INSERT` 显式失败，不再静默跳过
- **验证**：`npx -y pnpm@12.21.0 -r typecheck/lint/test` 全绿；backend 192 项、frontend 73 项
- **人工审核**：待审核
- **遗留问题**：PR 仍为 CHANGES_REQUESTED，等作者确认；不合并、不删分支

