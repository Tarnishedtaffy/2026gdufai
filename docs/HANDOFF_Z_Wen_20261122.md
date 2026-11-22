# 交接说明： 三项 PR 收尾 × M2/M4 赶工并行

> 交接方：实现 agent（Trae / DeepSeek-V4.1-Flash，替 `Tarnishedtaffy` 工作）
> 接收方：`Z_Wen` 的 agent（DeepSeek Harness / deepseek-flash）
> 日期：2026-11-22（Asia/Shanghai）
> 仓库：https://github.com/Tarnishedtaffy/2026gdufai
> 基线：`main = e4d1c34`

---

## 0. 一句话结论

今天 `Z_Wen` 的三个 PR（#31 / #32 / #33）已合并后回滚，并以 #44 / #45 / #46 重新合并；由此产生的 **#36 / #37 / #39 / #42 由我负责收尾**，**#38 与 M4 由你继续赶工**。

**重要：我的收尾工作目前尚未开始写代码**，只完成了方案与审议指派文档。`main` 上这些 issue 仍然存在，不要假设已修复。

---

## 1. 今天发生了什么

> 下表时间已由 GitHub UTC 换算为 `+08:00`。

| 时间（+08:00） | 事件 |
|---|---|
| 17:11–17:16 | #31（类别 CRUD）、#32（迁移 003 / 贷款利息 13）、#33（账单纠错 PATCH / void）合并 |
| 17:21 | 维护者基于审查结果创建 #36–#42 |
| 17:24 | 按维护者要求回滚（`964c97c`）；同一回滚还包含 M1 的 #29，后者以 #43 重新合并 |
| 17:33–17:38 | #44 / #45 / #46 从回滚后的 main 重新 cherry-pick，保留原作者 `Z_Wen` 后合并 |
| 18:46 | #47（M2 契约 v1.5 退款 / 贷款还款）合并 |
| 当前 | `main = e4d1c34`；#35（M1 路由）仍为 Draft，不属本次范围 |

结论：#44 / #45 / #46 的代码已进入 main，但审查遗留问题没有关闭。

---

## 2. 责任边界

| Issue | 内容 | 归属 | 当前状态 | 依赖 |
|---|---|---|---|---|
| [#36](https://github.com/Tarnishedtaffy/2026gdufai/issues/36) | PATCH 改分类时 `category_source` / `category_confidence` | **我** | 未开工 | 无 |
| [#37](https://github.com/Tarnishedtaffy/2026gdufai/issues/37) | reassign 预设源 / 事务范围 | **我** | 未开工 | 需你方契约签字 |
| [#39](https://github.com/Tarnishedtaffy/2026gdufai/issues/39) | v1.5「13 起」与废弃码文案 | **我** | 未开工 | 与 #37 的示例联动 |
| [#42](https://github.com/Tarnishedtaffy/2026gdufai/issues/42) | 迁移 003 同名类别改名说明 | **我** | 未开工 | 需你方产品确认 |
| [#38](https://github.com/Tarnishedtaffy/2026gdufai/issues/38) | PATCH 改 kind 未重算预算 | **你** | 阻塞 | M4 预算接口先落地 |
| M4 预算与超支提醒 | 后端 `/api/budgets`、level、alerts、前端 CRUD | **你** | 未开始 | 无 |
| #40 / #41 | M1 音频魔数、#35 反馈码 | M1 组 | 不属你我 | — |
| #22 / #34 | v1.5 贷款、`TRANSACTION_NOT_FOUND` | 合并后收口 | 待关闭 | #39 补齐 `field` 后关 #34 |

**不要动我的四项**；**我不会动 M4 与 #38**。

> **GitHub assignee 说明**：当前 #36 / #37 / #39 / #42 在 GitHub 上的 assignee 都是 `ONFAIL`（即 `Z_Wen`），与本文档的分工相反。**以本文档为准**；实现 agent 接手时会在四个 issue 下留言说明「由 Tarnishedtaffy 的 agent 执行，Z_Wen 只做契约签字」，避免接收方按 assignee 误认领。

---

## 3. 我的收尾工作流（尚未执行）

### 3.1 分支与提交

```text
fix/m2-v15-followup-issues（从 e4d1c34 切出）

fix(m2): reset category confidence when category changes            #36
fix(m2): guard preset source and wrap reassign in one transaction   #37
docs(m2): align v1.5 category examples and deprecated feedback text #39
docs(m2): document migration 003 category rename behavior           #42
```

### 3.2 我会触碰的文件（你的禁改区，直到我合并）

```text
backend/src/modules/ledger/transaction-edit.ts        #36
backend/src/modules/ledger/categories.ts              #37
backend/test/m2/transaction-edit.test.ts              #36
backend/test/m2/categories-crud.test.ts               #37
docs/contracts/module2-interface-v1.md                #36 §2.9 / #37 §2.7 / #39 §2.6、§2.7 / #42 §3
packages/capture-flow/src/feedback.ts                 #39
docs/agent-logs/Tarnishedtaffy.md                     LOG-Tarnishedtaffy-20261122-02
```

> 我的 PR 会改动共享目录 `docs/contracts/` 与 M1 共享包 `packages/capture-flow/src/feedback.ts`。按 AGENTS.md，PR 描述中会单列说明，并 @ `Z_Wen`、`huangsiting546`（契约）与 `yukacezar569-blip`（capture-flow）。

### 3.3 我的口径（需要你方确认）

- #36：改类别时 `category_confidence = NULL`（不是 1.0），并在契约 §2.9 写明。
- #37：预设类别作为 reassign 源直接 `403 CATEGORY_PRESET_PROTECTED`；所有校验与三类更新包进同一个 `db.transaction`。
- #39：契约示例从 `13/reassign` 改为自定义类别（14）；`TRANSACTION_NOT_FOUND` 补 `field: id`；`REPAYMENT_EXCESS_AS_EXPENSE` 话术标注「仅解释 v1.4 历史回执」。
  - 补充：#39 第 2 条（测试「ID 从 13 起自增」）在 `main` 上已由 #44/#46 修复，无需改代码，只需在 issue/PR 中注明已收口。
- #42：只改契约 §3 升级说明，不改迁移 SQL。

### 3.4 我的验证与审议

```bash
npx -y pnpm@12.21.0 -r typecheck
npx -y pnpm@12.21.0 -r lint
npx -y pnpm@12.21.0 -r test
```

我的 PR 会交给独立审议模型，详见 [REVIEW_ASSIGNMENT_20261122.md](REVIEW_ASSIGNMENT_20261122.md)；你方只做契约签字，不做代码主审。

---

## 4. 你的 M2/M4 赶工工作流

### 4.1 第一步：建 M4 跟踪 issue

当前 GitHub 上没有 M4 实施 issue，先建一条，写清：

- 范围：`GET/PUT/DELETE /api/budgets`、`level` 计算、`budget_alerts` 写入、前端 CRUD；
- 契约依据：§2.5（读取）与 §2.8（写入）；
- 验收：真实模式不再 404，预算是可增删改查，超支提醒可验证；
- 负责人：`Z_Wen` / `huangsiting546`。

### 4.2 第二步：M4 后端最小闭环

建议新增：

```text
backend/src/modules/ledger/budgets.ts         # 读写、level、冲突校验
backend/src/modules/ledger/routes.ts          # 挂载 GET/PUT/DELETE /api/budgets
backend/test/m2/budgets.test.ts               # 读取、写入、冲突、level、提醒
```

已有基础：

- 表 `budgets`、`budget_alerts` 已在 `001_init.sql` 建好；
- 类别 reassign 已会迁移 `budgets`；
- `shared/errors.ts` 已含 `BUDGET_NOT_FOUND` / `BUDGET_CONFLICT`，M4 不需要改共享目录；
- 契约 §2.5 已定义读取路径、字段与 `level` 阈值；§2.8 定义写入/删除与 `BUDGET_NOT_FOUND`；`BUDGET_CONFLICT` 见 §2.7（reassign 冲突场景）。

需要确认：

- `level` 直接按契约 §2.5 的 `normal` / `near`（≥80%）/ `over`（≥100%）执行，无需再确认；
- 提醒写入时机：每个「月份 + 类别」只写一次，还是每次写入都更新；
- 若契约未写清 alert 口径，先开 `contract-change` issue，不要自行约定新口径。

### 4.3 第三步：M4 前端接真实 API

```text
frontend/src/views/BudgetView.vue       # 新增/编辑/删除预算
frontend/src/api/index.ts               # getBudgets / putBudget / deleteBudget
frontend/src/mock/*                     # 保持 mock 可演示
```

当前真实模式下 `BudgetView` 会请求不存在的 `/api/budgets`，这是 M4 的首个可见故障。

### 4.4 第四步：再做 #38

`PATCH /api/transactions/:id` 改 `kind` 后要重算当月预算占用与 `level`。

**顺序要求**：等我的 #36 合并后再改 `transaction-edit.ts`，否则同一文件必然冲突。你可以先把 M4 的预算重算函数写好并在 `budgets.ts` 暴露，等 rebase 后接入 PATCH。

**合并信号**：以 **#36 / #37 / #39 / #42 全部关闭**（或对应 PR `mergedAt` 非空）为准。届时执行：

```bash
git fetch upstream
git rebase upstream/main
```

然后再改 `transaction-edit.ts` 接 #38。

### 4.5 第五步：收口 M2 状态

- #23：v1.5 已随 #47 落地，可确认后关闭；
- #22：确认 #47 已覆盖后关闭；
- #34：等我 #39 补完 `field: id` 后关闭；
- #38：M4 完成后关闭；
- 其余 open issue 逐条确认。

### 4.6 标准工作流（每个 PR 都走一遍）

1. `git fetch upstream && git switch -c feat/m4-budgets upstream/main`
2. 实现 + 同步补测试
3. `npx -y pnpm@12.21.0 -r typecheck / lint / test`
4. 追加 `docs/agent-logs/Z_Wen.md` 条目（下一条编号 `LOG-Z_Wen-20261122-03`）
5. 按 PR 模板提交，契约改动 @ `Z_Wen`、`huangsiting546`
6. 等 repo owner 指定审核，不要自审自合
7. 合并后由 reviewer 的代理更新 `SUMMARY.md`，你不要改 SUMMARY

---

## 5. 并行冲突规则

| 文件 / 区域 | 我 | 你 | 规则 |
|---|---|---|---|
| `transaction-edit.ts` | #36 | #38 | **我先合并，你再 rebase 接 #38** |
| `categories.ts` | #37 | 不碰 | 你只会在 `budgets` 表层面受影响 |
| `routes.ts` | 不碰 | M4 路由 | 你独占；注意 import 冲突 |
| 契约 §2.6 / §2.7 / §2.9 / §3 | 我改 | 不碰 | 你若要改，等合并信号（定义见 §4.4）后 rebase |
| 契约 §2.5 / §2.8 | 不碰 | M4 可能补充 | 只在段末追加，不重排既有文本 |
| 迁移文件 | 不碰 | 可新增 004 | 编号顺延，不修改 001–003 |
| M2 测试文件 | 我改两个 | 你新增 `budgets.test.ts` | 互不覆盖 |
| 前端 | 不碰 | BudgetView / api / mock | 你独占 |

**推荐并行方式**：

1. 我现在开 `fix/m2-v15-followup-issues`，先完成 #36/#37/#39/#42；
2. 你同时从 `e4d1c34` 开 `feat/m4-budgets`，先做新增文件 `budgets.ts`、`budgets.test.ts` 和前端；
3. 契约与 `transaction-edit.ts` 相关改动暂缓；
4. 我的 PR 合并（#36/#37/#39/#42 全部关闭）后，你执行 `git fetch upstream && git rebase upstream/main`，再补 #38 与契约段末说明；
5. 你的 M4 PR 合并后再关闭 #38。

这样既不互相阻塞，也不会在同一文件上反复解冲突。

---

## 6. 环境与验证

本沙箱没有全局 pnpm，统一使用：

```bash
npx -y pnpm@12.21.0 install --frozen-lockfile
npx -y pnpm@12.21.0 -r typecheck
npx -y pnpm@12.21.0 -r lint
npx -y pnpm@12.21.0 -r test
```

定向测试：

```bash
cd backend && npx vitest run test/m2/transaction-edit.test.ts test/m2/categories-crud.test.ts
```

当前基线（`LOG-Tarnishedtaffy-20261122-01`）：

- backend 307 项；
- frontend 75 项；
- 改动不影响启动方式时，不必跑 `docker compose up --build`。

> **Windows 本地验证注记**：frontend 套件在 Windows 本地可能出现约 13 项环境性失败（`CaptureDraftCard.vue` SFC 编译相关，CI/Linux 同一 commit 全绿）。回归判定以 GitHub CI 与 backend 计数为准，不要把这类失败误判为代码回归。

---

## 7. 日志与 Git 规则（摘自立库规范）

- 只追加自己的 `docs/agent-logs/<github-id>.md`；你写 `Z_Wen.md`，下一条编号 `LOG-Z_Wen-20261122-03`。
- 已提交条目不改写；更正就追加新条目。
- 日志与代码在同一个 PR。
- 只在自己的 fork 功能分支提交；`push --force` 仅限自己的分支且用 `--force-with-lease`。
- 密钥只走 `.env`；提交内容只用 GitHub 用户名与虚构数据。
- 契约字段只增不删；新增字段/接口先开 `contract-change` issue。

---

## 8. 交接检查清单

### 你接手后立即确认

- [ ] `main` 是否为 `e4d1c34`；若已前进，先看是否有人合并了新 PR。
- [ ] 是否已建 M4 跟踪 issue。
- [ ] `feat/m4-budgets` 是否从最新 `upstream/main` 切出。
- [ ] 是否避开第 3.2 节列出的我的禁改区。
- [ ] 契约 §2.5 / §2.8 是否已足够实现 M4；缺字段先开 issue。

### 我的交付（完成后回填）

- [ ] `fix/m2-v15-followup-issues` 四个提交
- [ ] #36 / #37 / #39 / #42 的测试与契约更新
- [ ] `LOG-Tarnishedtaffy-20261122-02`
- [ ] 独立审议模型通过
- [ ] 在 #36 / #37 / #39 / #42 留言说明分工变更
- [ ] PR 合并并关闭 #36 / #37 / #39 / #42

### 你的交付

- [ ] M4 issue + `feat/m4-budgets` PR
- [ ] `/api/budgets` 读写、level、alerts、前端 CRUD
- [ ] `LOG-Z_Wen-20261122-03`
- [ ] 收到合并信号（#36/#37/#39/#42 全部关闭）后再 rebase
- [ ] rebase 后完成 #38
- [ ] M4 PR 合并并关闭 #38
- [ ] #22 / #23 / #34 状态收口

---

## 9. 待你方书面确认的三个口径

**签字主体**：`Z_Wen` / `huangsiting546`。agent 在 issue 下的留言必须注明「已由人工确认」，否则不视为契约签字。

| 项 | 我的默认方案 | 需要你方确认 |
|---|---|---|
| #37 预设源 reassign | 禁止，403 `CATEGORY_PRESET_PROTECTED` | 是否同意；若同意请在 issue #37 留言 |
| #42 自定义「贷款利息」被改名 | 接受，补契约 §3 升级说明 | 产品是否接受 |
| #36 改类别后置信度 | `NULL` | 是否同意，或改为 1.0 |

确认方式：直接在对应 issue 下留言，不要只在聊天里说；我的 PR 会引用这些结论。

若上述默认方案被否决，替代路径见 [REVIEW_ASSIGNMENT_20261122.md](REVIEW_ASSIGNMENT_20261122.md) §7；修改后仅复审受影响章节。

---

## 10. 参考文档

- [审议指派申请](REVIEW_ASSIGNMENT_20261122.md)
- [M1–M4 进度报告](MODULE_PROGRESS_20261122.md)
- [工程交接说明](AGENT_HANDOFF_20261122.md)
- [契约 v1.5](contracts/module2-interface-v1.md)
- [汇总日志](agent-logs/SUMMARY.md)

> 上述前三份文档目前不在 `main`，而是随本文件存放于 `trae/agent-PhqOdE` 分支。单独分发本文档时，请连同这三份一起附上，否则链接会断。
