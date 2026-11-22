# 审议模型指派申请：M2 v1.5 遗留 Issue 修复（不含 M4）

> 收件人：主 agent / 调度方
> 发件人：实现 agent（Trae / DeepSeek-V4.1-Flash）
> 日期：2026-11-22（Asia/Shanghai）
> 请求事项：判定本任务的**主审模型**与**契约签字方**，并确认下方范围、口径与验收标准后再开工。

---

## 1. 仓库与基线

| 项 | 内容 |
|---|---|
| 主仓库 | https://github.com/Tarnishedtaffy/2026gdufai |
| 当前主干 | `e4d1c34`（Merge PR #47，契约 v1.5 已合入） |
| 建议实现分支 | `fix/m2-v15-followup-issues`，从 `upstream/main`（`e4d1c34`）切出 |
| 契约文件 | [docs/contracts/module2-interface-v1.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/contracts/module2-interface-v1.md) |
| 术语表 | [docs/GLOSSARY.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/GLOSSARY.md) |
| 协作规则 | [AGENTS.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/AGENTS.md) |
| 个人日志 | [docs/agent-logs/Tarnishedtaffy.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/agent-logs/Tarnishedtaffy.md) |
| 日志规范 | [docs/agent-logs/README.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/agent-logs/README.md) |
| 汇总日志 | [docs/agent-logs/SUMMARY.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/agent-logs/SUMMARY.md) |

当前主干测试基线（来自 `LOG-Tarnishedtaffy-20261122-01`）：

- backend：`tsc --noEmit` / `eslint` 通过，Vitest **307 项**全绿
- frontend：`vue-tsc` 通过，Vitest **75 项**全绿
- `packages/capture-flow`：typecheck / eslint 通过

> 本沙箱没有全局 pnpm，可统一用 `npx -y pnpm@12.21.0 ...` 执行脚本。

---

## 2. 任务范围

### 2.1 纳入本次修复

| Issue | 标题 | 类型 | 预估改动 |
|---|---|---|---|
| [#36](https://github.com/Tarnishedtaffy/2026gdufai/issues/36) | PATCH 改分类时 `category_source` / `category_confidence` 处理不完整 | 代码 + 契约 | 1 个源文件、1 个测试文件、契约 §2.9 |
| [#37](https://github.com/Tarnishedtaffy/2026gdufai/issues/37) | 类别 reassign 与契约 §2.7 的两处偏差（预设源 / 事务范围） | 代码 + 契约 | 1 个源文件、1 个测试文件、契约 §2.7 |
| [#39](https://github.com/Tarnishedtaffy/2026gdufai/issues/39) | v1.5 收尾仍残留「13 起」与废弃码口径 | 文档 + 话术 | 契约 2 处、`feedback.ts` 1 处 |
| [#42](https://github.com/Tarnishedtaffy/2026gdufai/issues/42) | 迁移 003 会重命名任意 id 的同名自定义类别，需确认并写入说明 | 文档 | 契约 §3 |

### 2.2 明确排除

| Issue | 排除原因 |
|---|---|
| #38 | 依赖 M4 预算重算，M4 尚未实现；按用户要求本轮不涉及 M4 |
| #40、#41 | 属于 M1 / #35 分支，不在本次 M2 范围 |
| #22、#34 | 功能已在 #47 落地，只需在合并后做 issue 状态收口，不产生代码改动 |

### 2.3 范围边界

- 不删除、不改名任何既有契约字段；只做**语义补充与文案修正**。
- 不修改他人模块目录；本次只触达 `backend/src/modules/ledger/`、`backend/test/m2/`、`docs/contracts/`、`packages/capture-flow/src/feedback.ts`。
- `docs/contracts/` 由 M2 组维护，PR 描述中需 @ `Z_Wen`、`huangsiting546`。

---

## 3. 逐 Issue 现状、方案与验收

### 3.1 #36 PATCH 分类来源与置信度

**主干现状（已实测）**

- 同类别保护**已部分存在**：[transaction-edit.ts](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/backend/src/modules/ledger/transaction-edit.ts#L174-L181) 只在 `changedCategory === true` 时写 `category_source='manual'`。
- 但 UPDATE 语句没有处理 `category_confidence`，见同文件 L197-L199；改类别后旧置信度仍然保留。
- 现有用例只覆盖「同类别不写学习规则」，没有断言来源与置信度。

**修复方案**

1. `changedCategory === true` 时，在 assignments 中同时写入：
   ```ts
   assignments.push('category_id = ?', "category_source = 'manual'", 'category_confidence = NULL');
   ```
2. 仅改金额、商户、时间时不触碰 `category_source` / `category_confidence`。
3. 契约 §2.9 写明：手动改类别后 `categoryConfidence` 置 `null`，表示该值不再代表自动分类置信度。
4. 补三条断言：
   - 相同 `categoryId`：来源与置信度均不变；
   - 改为不同类别：`categorySource='manual'` 且 `categoryConfidence=null`；
   - 只改金额：来源与置信度均不变。

**验收标准**

- 上述三条测试通过；
- 契约 §2.9 有明确说明；
- 既有 307 项 backend 测试不回归。

**需确认**

- `categoryConfidence` 用 `NULL` 还是 `1.0`。当前方案选 `NULL`，理由：AGENTS.md 要求缺失值传 `null`；`1.0` 会被误读为「自动分类非常确信」。

---

### 3.2 #37 reassign 预设源与事务范围

**主干现状（已实测）**

- [categories.ts](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/backend/src/modules/ledger/categories.ts#L253-L300) 的校验（目标存在、启用、kind 冲突、预算冲突）全部在 `db.transaction()` **之前**；
- 事务从 L308 才开始，只包住三类 UPDATE；
- 没有拒绝 `source.isPreset === true`；
- 契约 §2.7 L425 明确要求「校验与三类更新在同一个数据库事务内执行」。

**修复方案**

1. 在 source 查出后增加：
   ```ts
   if (source.isPreset) {
     throw new AppError('CATEGORY_PRESET_PROTECTED', 403, '预设类别只能停用，不能迁移', {
       field: 'categoryId'
     });
   }
   ```
2. 把 source/target 查询、全部校验、三类更新整体包进一个 `db.transaction(() => { ... })()`，返回 `ReassignResult`。
3. 契约 §2.7 补一条：`reassign` 的源类别为预设时返回 `403 CATEGORY_PRESET_PROTECTED`（`field: categoryId`）；该错误码已存在于 §2.6，不新增字段或错误码。
4. 补测试：
   - 预设 13 作为源 → 403 `CATEGORY_PRESET_PROTECTED`；
   - 目标不存在 → 404；目标停用 → 422；
   - kind 冲突 → 409 且三类表均未变化（回滚断言）；
   - 预算冲突 → 409 且无部分迁移；
   - 同 id → 0 迁移的幂等行为保持不变；
   - 既有自定义类别 reassign 用例继续通过。

**验收标准**

- 所有校验与更新在同一事务内；
- 预设源被拒绝且有测试；
- 冲突场景下 `transactions` / `budgets` / `user_category_rules` 均无残留变更；
- 契约 §2.7 与实际行为一致。

**需确认**

- 「预设类别只能停用」是否覆盖 `reassign`。当前按「禁止」实现，因为允许 reassign 会把预设类别搬空，与契约语义冲突。
- 若契约方决定允许，则改为在 §2.7 明确写出「reassign 不受预设保护」，并撤销第 1 步代码与对应测试。

---

### 3.3 #39 v1.5 收尾残留

**主干现状（逐项核对）**

| 项 | 现状 | 动作 |
|---|---|---|
| 1. 契约 §2.7 示例仍为 `POST /api/categories/13/reassign` | 仍在 [L407](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/contracts/module2-interface-v1.md#L407) | 改为自定义类别示例，例如 `POST /api/categories/14/reassign` |
| 2. 类别测试仍写「ID 从 13 起」 | **已修复**：`categories-crud.test.ts` L57 标题为「从 14 起」，L61 断言 `toBe(14)` | 无需改动，issue 中注明已由 #44/#46 收口 |
| 3. §2.6 `TRANSACTION_NOT_FOUND` 未写 `field` | 仍在 [L357](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/contracts/module2-interface-v1.md#L357) | 补 `field: id`，与实现一致 |
| 4. `REPAYMENT_EXCESS_AS_EXPENSE` 话术未标注历史码 | [feedback.ts L23](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/packages/capture-flow/src/feedback.ts#L23) 仍是旧文案 | 文案前加「（仅解释 v1.4 历史回执）」或等价说明 |

**验收标准**

- 全仓库检索不再出现「ID 12/13 起」「13/reassign」等过期示例；
- 契约 §2.6 与实现返回的 `field` 一致；
- `packages/capture-flow` typecheck / lint 通过；
- 不改变任何运行时行为。

**注意**

- 若 #37 采纳「预设不可 reassign」，则 #39 的示例必须使用非预设源，不能只是把 13 改成 14 却仍保留预设语义。

---

### 3.4 #42 迁移 003 同名类别重命名说明

**主干现状**

- [003_loan_interest.sql](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/backend/src/db/migrations/003_loan_interest.sql#L40-L43) 会把**任意 id** 的 `is_preset=0 AND kind='expense' AND name='贷款利息'` 改名为 `贷款利息(旧)`、`贷款利息(旧2)`……；
- 迁移测试已覆盖同名自定义 id=20 的重命名与引用迁移；
- 契约 §3「数据字典」没有升级说明。

**修复方案**

在契约 §3 增加一段升级说明，至少写明：

1. v1.5 升级会插入预设类别 `13 = 贷款利息`；
2. 若自定义类别已占用 id 13，该自定义类别整体迁移到 `MAX(id)+1`，其账单、预算、学习规则同步迁移；
3. 任意 id 的自定义「贷款利息」会被重命名为 `贷款利息(旧N)`，以保证 `UNIQUE(kind, name)`；
4. 该过程不删除数据、不改变账单归属关系；
5. 升级前建议备份数据库文件。

**验收标准**

- 契约 §3 有上述说明；
- 不修改迁移 SQL，不改变现有迁移测试结果；
- 文档措辞与 `003_loan_interest.sql` 实际行为逐条对应。

**需确认**

- 产品是否接受「自定义类别被改名」。若不接受，需要另开迁移改造任务（保留自定义名称、预设换名），本轮不做。

---

## 4. 实施顺序与提交拆分

建议一个 PR、四个提交，便于逐项审议：

```text
fix(m2): reset category confidence when category changes        #36
fix(m2): guard preset source and wrap reassign in one transaction  #37
docs(m2): align v1.5 category examples and deprecated feedback text  #39
docs(m2): document migration 003 category rename behavior        #42
```

分支：`fix/m2-v15-followup-issues`，基于 `e4d1c34`。
PR 标题建议：`fix(m2): 收口 v1.5 遗留的类别来源、reassign 事务与文档口径`。

验证命令：

```bash
npx -y pnpm@12.21.0 -r typecheck
npx -y pnpm@12.21.0 -r lint
npx -y pnpm@12.21.0 -r test
```

定向验证：

```bash
cd backend && npx vitest run test/m2/transaction-edit.test.ts test/m2/categories-crud.test.ts
```

---

## 5. 审议模型判定请求

### 5.1 硬性条件

1. **不得由实现方自审**：本任务实现模型为 `Trae / DeepSeek-V4.1-Flash`，主审必须是不同模型。
2. **代码正确性主审需独立于被审代码作者**：#31/#32/#33/#44/#45/#46 的原始作者为 `Z_Wen`，因此 `Z_Wen` 不宜单独担任 #36/#37 的代码主审，但应作为契约签字方。
3. 主审需具备：
   - TypeScript + better-sqlite3 同步事务语义；
   - 契约一致性审查能力（字段只增不删、错误码语义、`field` 对齐）；
   - 能读懂 Vitest 断言并判断是否真正覆盖回滚与边界；
   - 足够上下文窗口，能同时容纳本 MD、4 个 issue、契约 §2.6/§2.7/§2.9/§3 与相关源码。
4. 主审需按 **P0/P1/P2/P3** 输出问题，并给出文件与行号证据。

### 5.2 候选审议角色与评分

评分维度权重：契约语义 25%、SQLite 事务/回滚 25%、测试有效性 20%、迁移兼容 15%、长上下文 15%。

| 候选 | 契约语义 | 事务/回滚 | 测试有效性 | 迁移兼容 | 长上下文 | 适用结论 |
|---|---|---|---|---|---|---|
| P1 独立强推理长上下文模型（不同厂商高推理档） | 强 | 强 | 强 | 强 | 强 | **推荐主审** |
| P2 代码专精模型（若模型池中有专用代码模型） | 中 | 强 | 强 | 中 | 中 | 可作主审或第二审 |
| P3 轻量快速模型 | 弱 | 中 | 中 | 弱 | 中 | 仅适合跑命令/复述 diff，不适合主审 |
| P4 M2 契约维护方（`Z_Wen` / `huangsiting546`） | 强 | 中 | 中 | 强 | 中 | **契约签字**，不作为唯一代码主审 |

### 5.3 推荐结论

- **主审**：P1，独立强推理长上下文模型；若主 agent 模型池中有与实现方不同厂商的高推理档，优先选择该档。
- **契约签字**：`Z_Wen` 或 `huangsiting546`，只对 #37 预设源语义、#42 迁移 UX、#36 置信度置空三项给出书面结论；不替代代码主审。
- **合并人**：`Tarnishedtaffy`（人类账号）；其代理不得对本任务给出最终 APPROVE。
- **可选双审**：第二个模型只审「事务回滚断言 + 测试是否假绿」，适合在上下文预算允许时启用。

### 5.4 主审必查清单

- [ ] #36：同类别不改来源/置信度；改类别写 `manual` + `NULL`；只改金额不误伤。
- [ ] #37：预设源 403；校验确实在事务内；冲突时三类表零残留；既有 reassign 用例不回归。
- [ ] #39：无「13 起」残留；`TRANSACTION_NOT_FOUND` 有 `field: id`；废弃码话术明确标注历史语义。
- [ ] #42：升级说明与迁移 SQL 逐条对应；未擅自改迁移行为。
- [ ] 通用：无契约字段删除；无密钥/个人信息；日志条目已追加；PR 模板逐项填写。

### 5.5 请主 agent 按以下格式回复

```text
主审模型：<模型名>
契约签字：<Z_Wen / huangsiting546 / 其他>
是否启用第二审：<是 / 否>
理由：<2-3 句>
附加要求：<如有>
是否批准开工：<是 / 否 / 先澄清问题>
```

---

## 6. 工程日志

### 6.1 规则

- 只追加到 [docs/agent-logs/Tarnishedtaffy.md](https://github.com/Tarnishedtaffy/2026gdufai/blob/main/docs/agent-logs/Tarnishedtaffy.md) 末尾；
- 已提交条目不改写，更正时追加新条目；
- 日志必须与代码改动在同一个 PR；
- `SUMMARY.md` 只由 reviewer 的代理维护，本任务不修改。

### 6.2 与本任务直接相关的既有日志

| 日志编号 | 内容 | 与本任务的关系 |
|---|---|---|
| `LOG-Tarnishedtaffy-20261122-01` | #47 实现契约 v1.5 退款/还款、修复全量审查问题；backend 307 项 | 本任务的测试基线 |
| `LOG-Tarnishedtaffy-20261121-02` | #33 账单纠错边界、`changedCategory` 收窄 | #36 的前置改动 |
| `LOG-Z_Wen-20261122-01` | #32 迁移 003 后缀边界、§2.9 过渡口径 | #37/#42 的契约背景 |
| `LOG-Z_Wen-20261122-02` | #33 中性记录校验顺序 | #36 的代码背景 |
| `SUMMARY.md` #44/#45/#46 | 类别 CRUD、迁移 003、账单纠错合并记录 | 遗留 #36/#37/#39/#42 的来源 |

### 6.3 本任务计划追加的日志条目

编号：`LOG-Tarnishedtaffy-20261122-02`（当前文件最后一条为 `-01`）。

```markdown
### LOG-Tarnishedtaffy-20261122-02

- **时间**：2026-11-22 HH:MM（+08:00）
- **工具/模型**：Trae / DeepSeek-V4.1-Flash
- **模块 / 分支 / PR**：M2 / `fix/m2-v15-followup-issues` / 待建
- **任务**：收口 v1.5 遗留的 #36、#37、#39、#42（不含 M4）
- **关键提示词**：「你来负责完成这几个issue 先做不涉及m4的部分」
- **代理做了什么**：
  - `transaction-edit.ts`：改类别时重置 `category_confidence`
  - `categories.ts`：拒绝预设源 reassign，校验与更新合并到单事务
  - 契约 §2.6 / §2.7 / §2.9 / §3：补齐字段、预设源、置信度与迁移说明
  - `feedback.ts`：历史废弃码话术加注
  - 补对应测试与回滚断言
- **决策**：置信度置 `NULL`；预设源按禁止处理；迁移只改文档不改 SQL
- **验证**：`npx -y pnpm@12.21.0 -r typecheck/lint/test` 全绿；backend 新增 N 项
- **人工审核**：待审议模型 + 契约签字
- **遗留问题**：#38 等 M4；#40/#41 归 M1
```

---

## 7. 风险与需人类确认事项

| # | 事项 | 默认方案 | 若否决的替代 |
|---|---|---|---|
| 1 | #37 预设类别是否允许 reassign | 禁止，403 `CATEGORY_PRESET_PROTECTED` | 契约明确允许，撤销代码与测试 |
| 2 | #42 自定义「贷款利息」被改名是否可接受 | 接受，补升级说明 | 另开迁移改造任务，本轮不做 |
| 3 | #36 手动改类别后置信度取值 | `NULL` | 契约明确写 `1.0` 并改测试 |
| 4 | 契约文件由 M2 组维护 | PR 中 @ `Z_Wen`、`huangsiting546` | 由主 agent 指定签字人 |

---

## 8. 交付物清单

- [ ] `fix/m2-v15-followup-issues` 分支与 4 个提交
- [ ] 代码与测试改动
- [ ] 契约 §2.6 / §2.7 / §2.9 / §3 更新
- [ ] `LOG-Tarnishedtaffy-20261122-02`
- [ ] PR（模板逐项填写，注明契约改动与 @ 维护方）
- [ ] 本 MD 作为 PR 描述附件或交接材料
- [ ] 审议模型结论与契约签字记录
