# M4 预算 / #38 开工前待确认问题

> 提问方：`Z_Wen` 的 agent
> 日期：2026-11-23
> 基线：`main = e4d1c34`
> 相关文档：`jiaojie.md`（交接说明）、`docs/M4-budget-task.md`（M4 任务说明）
> 相关 issue：[#38](https://github.com/Tarnishedtaffy/2026gdufai/issues/38)

我已按交接文档核对过 `main = e4d1c34`，也确认 #36 / #38 仍是 open。下面这些问题会直接影响 M4 的目录、接口和 PR 顺序，想先和你对齐，避免做完再返工。

每项都附了我的建议默认值；如果你同意，直接回复「Q1 同意、Q2 按 B」这种形式即可。

---

## A. 归属与范围

### Q1. M4 到底由谁负责？前端是否也归我？

**冲突点：**

- `docs/M4-budget-task.md:3` 写「负责人：huangsiting546」。
- `jiaojie.md` §4.1 写「负责人：`Z_Wen` / `huangsiting546`」。
- `jiaojie.md` §4.3 和 §5 的分工表又把 `BudgetView.vue`、`frontend/src/api/index.ts`、`frontend/src/mock/*` 划给我，写「你独占」。

另外，此前我收到的直接约束是「不要改 `frontend/`」，所以现在不能直接按交接文档开工。

**需要确认：**

1. M4 后端是否由我负责？
2. 前端 CRUD 是否也由我改？还是只做后端，前端交回 `huangsiting546` 或你？
3. 如果 `huangsiting546` 已不活跃，是否可以由我一人承接前端，并在 PR 描述中注明？

**我的建议：** 后端 + #38 由我负责；前端由我改 `BudgetView.vue`、`api/index.ts`、mock，但需要你明确解除「禁改 frontend」的旧约束。若不能解除，我只交后端和接口说明。

---

### Q2. M4 代码放新模块还是塞进 `ledger/`？

**冲突点：**

- `docs/M4-budget-task.md:76-83` 要求新建：

  ```text
  backend/src/modules/budget/{repository,service,routes}.ts
  backend/test/m4/
  ```

- `jiaojie.md` §4.2 要求：

  ```text
  backend/src/modules/ledger/budgets.ts
  backend/src/modules/ledger/routes.ts
  backend/test/m2/budgets.test.ts
  ```

两份文档的目录和测试位置完全相反。交接文档 §5 又说 `routes.ts` 由我独占，但 `ledger/routes.ts` 同时是 M2 的共享文件，容易和 #36 冲突。

**需要确认：** 以哪份为准？

**我的建议（B）：** 新模块 `backend/src/modules/budget/` + `backend/test/m4/`，在 `app.ts` 只加一行注册；不动 `ledger/`。这样和 #36/#37 的冲突最小，也符合 `docs/M4-budget-task.md`。如果你希望按交接文档走 A，我也可以改。

- A：`backend/src/modules/ledger/budgets.ts` + `ledger/routes.ts` + `backend/test/m2/budgets.test.ts`
- B：`backend/src/modules/budget/*` + `backend/test/m4/*`（建议）

---

## B. 契约与字段

### Q3. GET / PUT 的 `category` 形状为什么不一致？

**冲突点：**

- `docs/M4-budget-task.md:26` 的 GET 响应：`"category": null`
- `docs/M4-budget-task.md:49` 的 PUT 响应：`"category": { "id": 1, "name": "餐饮" }`

同一个字段，GET 返回 null、PUT 返回对象，前端无法用同一套类型。

**需要确认：**

1. GET 是否也应返回 `{ id, name }` 对象？
2. `scope=total` 时固定 `null`，对吗？
3. `category` 是否要包含 `kind`（expense/income）？

**我的建议：** GET 和 PUT 统一返回 `{ id, name }`；`scope=total` 时为 `null`；不额外返回 `kind`，需要时由前端按类别字典取。

---

### Q4. GET 是否返回 `alertThresholds` 和告警记录？

`docs/M4-budget-task.md:21-33` 的 GET 响应没有 `alertThresholds`，也没有 `alerts`；但 PUT 请求要求传 `alertThresholds`（`:47`）。

**需要确认：**

1. GET 是否要回 `alertThresholds`，让编辑弹窗能回填？
2. 是否要回 `alerts`（已触发的阈值/时间）？
3. 如果不回，是否需要单独的 `GET /api/budgets/:id/alerts`？

**我的建议：** GET 增加 `alertThresholds`；本期内不新增 alerts 端点，告警只落库、不做通知渠道；如果前端需要展示，再在 GET 里加 `alerts` 数组。

---

### Q5. 预算统计范围是否只算支出？

`docs/M4-budget-task.md:124` 只写了 `entry_type='normal' AND status='confirmed'`，没有写 `direction`。类别里有工资、贷款等 income 类别，如果 total 把收入也算进 `spentCents`，语义会反。

**需要确认：**

1. `scope=total` 是否只统计 `direction='expense'` 的 normal + confirmed 账单？
2. `scope=category` 是否只允许 expense 类别？传 income 类别时返回 422 还是 409？
3. 退款/还款中性记录、void 原单是否都不计入？
4. 月份按 `Asia/Shanghai` 的 `occurred_date` 归月，对吗？

**我的建议：** 只统计 `direction='expense'`、`entry_type='normal'`、`status='confirmed'`；中性记录和 void 不计；category 预算只允许 expense 类别，传 income 类别返回 `422 INVALID_QUERY_PARAM`（`field: categoryId`）；月份按 `Asia/Shanghai`。

---

## C. 告警口径

### Q6. 告警在什么时机写？只写一次还是每次都更新？

`docs/M4-budget-task.md:108-113` 说「预算状态跨过阈值时写」「同一预算同一阈值只写一次」；`jiaojie.md` §4.2 又明确问「每个月份 + 类别只写一次，还是每次写入都更新」。

另外，如果只在 PUT 预算时判断，那么日常导入/改账导致超支时不会触发告警；如果每次交易变化都判断，又需要 M2 调用重算函数。

**需要确认：**

1. 写入时机：只在 PUT 预算时？还是 PUT + M2 交易变化（`recalcBudgetForTransaction`）都判断？
2. 预算金额/阈值被修改后，旧的 `budget_alerts` 是否保留？
3. 如果阈值被删除，是否删除对应告警行？
4. 删除预算时是否级联删除告警？
5. 同一预算先超 80%、再超 100%，应写两条（80 和 100），对吗？

**我的建议：**

- PUT 时判断一次；M2 交易变化通过 `recalcBudgetForTransaction` 再判断一次；
- `UNIQUE(budget_id, threshold)` 保证同一阈值只写一次；
- 修改预算时保留已触发的旧告警，只删除「被移除的阈值」对应行；
- 删除预算时级联删除告警；
- 80% 和 100% 各写一条。

---

### Q7. `BUDGET_CONFLICT` 在预算 API 里什么时候返回？

`shared/errors.ts` 已有 `BUDGET_CONFLICT`，但 `docs/M4-budget-task.md` 的规则里只写了 404（删除不存在）和 422（参数非法），没有 409 场景。`jiaojie.md` §4.2 说这个码用于 §2.7 的 reassign 冲突。

**需要确认：** `PUT /api/budgets` 是否会出现 409？例如同月同 scope/category 重复创建时，是幂等覆盖（200），还是 409？

**我的建议：** 按任务文档，`(month, scope, categoryId)` 幂等覆盖，返回 200；`BUDGET_CONFLICT` 只保留给 reassign，不在预算 API 使用。

---

## D. #38 与流程

### Q8. #38 用动态聚合，还是物化 `spent` + recalc？

**冲突点：**

- `docs/M4-budget-task.md:68` 的 `budgets` 表没有 `spent_cents` 列；GET 是实时算 `spentCents`。
- 同文档 §5（`:95-106`）又要求提供 `recalcBudgetForTransaction`，说 M2 会在 PATCH / void 后调用。
- issue #38 正文说：若用动态聚合，PATCH 改 kind 后 GET 自动正确；若未来物化 `spent`，才需要 recalc。

这三处没有统一。

**需要确认：**

1. M4 是否采用动态聚合（不新增 `spent_cents`）？
2. 如果动态聚合，`recalcBudgetForTransaction` 还需要吗？还是只保留一个「重算告警」的函数？
3. 如果必须物化，是否要新迁移 004 + 改契约？这会扩大 M4 范围。

**我的建议（动态聚合）：** 不新增 `spent_cents`；GET 每次实时聚合；`recalcBudgetForTransaction` 只负责重算告警，不做金额落库；#38 的验收改为「PATCH 改 kind/金额/void 后，GET 预算的 `spentCents` 与 `level` 正确」的跨模块测试。这样不会出现预算与账单不一致。

---

### Q9. M4 PR 能否先于 #36/#37/#39/#42 合并？

`jiaojie.md` §4.4 要求等四项全部关闭后再改 `transaction-edit.ts`；但 M4 本身是新增模块，理论上可以先合并，不必等。

**需要确认：**

1. M4 PR 是否可以先合？还是必须等 #36/#37/#39/#42 全部关闭？
2. 如果先合，M4 PR 只动 `app.ts` + 新模块 + 前端，不碰 `ledger/`，可以吗？
3. #38 是否单独开一个 PR（推荐），还是并进 M4 PR？

**我的建议：** M4 先合（只动新模块、`app.ts`、前端）；#38 等四项关闭后单独开 `fix/m2-budget-recalc`，避免和 #36 抢 `transaction-edit.ts`。

---

### Q10. M4 跟踪 issue 和签字怎么处理？

`jiaojie.md` §4.1 要求先建 M4 跟踪 issue。当前 GitHub 上没有 M4 实施 issue，只有 #38。

**需要确认：**

1. 是否由我建 M4 issue？assignee 写谁（`Z_Wen` / `huangsiting546`）？
2. `jiaojie.md` §9 要求 `Z_Wen` / `huangsiting546` 对 #36（confidence=NULL）、#37（预设源 403）、#42（接受改名）做书面确认。`huangsiting546` 若不在，是否我一人签字即可？
3. #22 / #23 / #34 由谁关闭？我确认 #47 覆盖后留言，由你关闭，还是我可以直接关？

**我的建议：** 我建 M4 issue，assignee 写 `Z_Wen`，描述里注明 `huangsiting546` 为共同负责人；#36/#37/#42 的三个口径我在对应 issue 下书面确认，并注明「huangsiting546 未反对」；#22/#23 我核对后留言，由你或 repo owner 关闭；#34 等你 #39 补 `field: id` 后关闭。

---

### Q11. 日志编号用哪个？

`jiaojie.md` §4.6 / §8 写「下一条编号 `LOG-Z_Wen-20261122-03`」，但我在本地未合并的 #36 分支里已经追加过 `LOG-Z_Wen-20261122-03`。该分支不会推送，但编号已被占用。

**需要确认：** M4 用 `LOG-Z_Wen-20261123-01` 可以吗？

**我的建议：** 按实际日期用 `LOG-Z_Wen-20261123-01`，避免和废弃分支的 `-03` 冲突。

---

## 附：我理解的时间线（供你核对）

| 时间（+08:00） | 事件 |
|---|---|
| 17:11–17:16 | #31 / #32 / #33 合并 |
| 17:24 | `964c97c` 回滚（含 M1 #29） |
| 17:33–17:38 | #44 / #45 / #46 重新 cherry-pick 合并 |
| 18:46 | #47（v1.5）合并 |
| 当前 | `main = e4d1c34`；#35 Draft；#36 / #38 open |

如果这份时间线有误，也请顺手指出。
