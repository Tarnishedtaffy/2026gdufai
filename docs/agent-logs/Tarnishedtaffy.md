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

### LOG-Tarnishedtaffy-20261122-01

- **时间**：2026-11-22 18:35（+08:00）
- **工具/模型**：Trae / DeepSeek-V4.1-Flash
- **模块 / 分支 / PR**：M2 + 前端 / `feat/m2-v1.5-repayment-refund` / 待建
- **任务**：实现契约 v1.5 的退款与贷款还款口径，并修复全量审查发现的问题
- **关键提示词**：「把全部代码都审查一遍，找一下有没有 bug」「直接修复吧」「再审查一遍 汇报仓库当前状态 如果可以就放GitHub上去」
- **代理做了什么**：
  - `backend/src/modules/ledger/intake.ts`：退款改为显式原单匹配（取消 30 天窗口）；还款保留原单并写 `settled_at`，支持本金/利息拆分、`PARTIAL_REPAYMENT_RECORDED`、`AMBIGUOUS_LOAN_PAYMENT`、`ORIGINAL_ALREADY_SETTLED`、`ORIGINAL_TRANSACTION_AGED`；利息写入 `${idempotencyKey}#interest` 的类别 13 普通支出
  - `backend/src/modules/ledger/{types,validation,repository}.ts`：新增 `repaymentPart` / `principalCents` / `interestCents` 与契约 §1.3 校验；落库 `principal_cents`、`settled_at`；累计已还本金与结清标记
  - `backend/src/{app,shared/money}.ts`：4xx 错误不再泄漏 Fastify 内部码；金额换算增加安全整数边界
  - `backend/src/modules/ledger/{categories,transaction-edit,transactions}.ts`：PATCH 空对象/未知字段 422、删除类别计数与删除同事务、真实日历日期校验、`meta.isEmpty` 计入中性记录
  - 前端：`stats` 支出/净收支拆分请求、`entryType`/`settledAt`/`summary` 字段对齐、204 空响应、空类别安全展示、预算月份改用当前月
  - 测试：`import.test.ts` 重写/新增 v1.5 还款、混息、纯利息、已结清、超 365 天、显式本金超额用例；`validation.test.ts` 补拆分子段校验；同步更新既有回归用例
- **决策**：退款保持 v1.4 三态；还款改为保留原贷款 + `settled_at`；本金/利息拆分按契约严格校验，普通记录或退款携带拆分子段整批 `INVALID_BATCH`；利息记录不参与剩余本金与结清；已结清与不存在/已作废必须区分
- **验证**：`backend` typecheck / eslint 通过，Vitest 307 项全绿；`frontend` vue-tsc 通过，Vitest 75 项全绿；`packages/capture-flow` typecheck / eslint 通过
- **人工审核**：待审核
- **遗留问题**：M1 尚无回传 `originalTransactionId` 的通道；前端类别 CRUD 与账单 PATCH/void 无 UI；#35 仍为 Draft（等 #24 冻结、音频魔数、反馈码对齐）；中性还款作废与利息撤销留给 PR-C

### LOG-Tarnishedtaffy-20261123-01

- **时间**：2026-11-23 18:32（+08:00）
- **工具/模型**：Trae / DeepSeek-V4.1-Flash
- **模块 / 分支 / PR**：M4 + 前端 / `fix/m4-budget-review` / 待建
- **任务**：复审 PR #51（M4 预算读写），修复发现的 bug 与不足，并补前端测试
- **关键提示词**：「检查一下新的pr」「再检查一遍 如果有bug或者不足的地方就给review」「把现在几个issue修一下」「直接推送」「创建 PR 合并到 main」
- **代理做了什么**：
  - `frontend/src/views/BudgetView.vue`：切换月份时清空编辑态与删除确认，避免把旧预算保存到新月份；删除改为二次确认并在请求期间禁用按钮
  - `frontend/src/components/BudgetForm.vue`：编辑态禁用类型/类别选择，避免 PUT 幂等键变化后新建预算；补控件 `id` 供测试定位
  - `frontend/app-budget.test.ts`：新增 3 例（切月清编辑态回归、金额/阈值校验与按分提交、mock 预算幂等覆盖与删除）
  - `frontend/test-support/app-renderer.ts`：测试节点补 `getRootNode()`，让 `v-model` 更新可在自研 renderer 下测试
  - `backend/src/modules/budget/service.ts`：`scope=total` 时严格拒绝非 `null` 的 `categoryId`
  - `backend/src/modules/budget/repository.ts`：移除未使用的 `is_active` 查询字段
  - `docs/GLOSSARY.md`：新增术语行「告警阈值 / `alertThresholds`」
  - `docs/contracts/module2-interface-v1.md` §2.8：告警触发文案改为「M2 接入（#38）后由 recalc 函数触发」，与当前实现一致
- **决策**：在 #51 最新 head 上追加修复并单独向 `main` 提 PR，合并后由作者关闭 #51，避免重复评审；契约只改文案、不增删字段，仍在 #50 契约变更范围内；共享测试基建改动需在 PR 中 @ 前端框架负责人
- **验证**：`pnpm -r typecheck` / `lint` / `test` 与 `frontend build` 全绿；backend 340 项、frontend 78 项；`git diff --check` 无输出
- **人工审核**：待审核
- **遗留问题**：合并后需关闭 #51；M2 写路径接入预算告警仍在 #38；PR #48 的测试交叉场景与空行问题未处理

### LOG-Tarnishedtaffy-20261123-02

- **时间**：2026-11-23 21:05（+08:00）
- **工具/模型**：Trae / DeepSeek-V4.1-Flash
- **模块 / 分支 / PR**：M2 + docs / `fix/m2-open-issues` / #53
- **任务**：清理仓库开放 issue 中可在本人模块内直接修复的项
- **关键提示词**：「把上面能修的issue都修复了吧 先做一下难度分析 如果太难的issue就交给Gemini和glm修复 其他简单的交给你修」
- **代理做了什么**：
  - #36 `backend/src/modules/ledger/transaction-edit.ts`：类别实际变化时同时把 `category_confidence` 置 `NULL`；补「同类别不改来源/置信度」「改类别清空置信度」「跨 kind 置 direction_source=category」断言
  - #37 `backend/src/modules/ledger/categories.ts`：`reassignCategory` 增加预设源 `403 CATEGORY_PRESET_PROTECTED`；把目标校验、kind/预算冲突校验与三类更新收进同一个 `db.transaction`；补预设源用例
  - #39 `docs/contracts/module2-interface-v1.md`：reassign 示例 13→14、`TRANSACTION_NOT_FOUND` 补 `field: id`；`packages/capture-flow/src/feedback.ts` 给 `REPAYMENT_EXCESS_AS_EXPENSE` 补 deprecated 注释
  - #42 `docs/contracts/module2-interface-v1.md`：v1.5 变更记录写明迁移会把任意 id 的同名自定义「贷款利息」重命名为「贷款利息(旧N)」并迁移引用
  - #20 `backend/test/m2/validation.test.ts`：补 `1e20`、安全整数分边界、Infinity/NaN、多位小数用例（`isAmount` 已在 `feat/m2-v1.5-repayment-refund` 修复）
  - 契约 §2.7 规则同步「预设类别不能作为 reassign 源」，错误表文案同步删除或迁移
- **决策**：#38（所有 M2 写路径接入预算告警重算）与 #18（前端 v1.4/v1.5 全量同步）范围大、跨模块，留给 Gemini/GLM；#40/#41 属于 M1 的 #35 分支，不代改；#19 中性记录唯一冲突自愈涉及退款/还款多调用点，列为中等，暂不处理
- **验证**：`node .../pnpm.cjs -r typecheck/lint/test` 全绿；backend 312 项（新增 6 项）、frontend 75 项
- **人工审核**：待审核
- **遗留问题**：#38、#18、#19 待分配；#40/#41 由 M1 负责人在 #35 处理

