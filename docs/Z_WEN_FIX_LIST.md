# Z_Wen 修复清单（2026-11-28）

> 范围：M2 / M4 / 契约维护。按 main `e3d2338` 与当前 open PR/issue 整理。
> 原则：先定契约版本，再改实现；契约先于 #35/#58 合并。

## 一、优先级总表

| Issue | 优先级 | 需要做什么 | 关联 PR |
|---|---|---|---|
| #71 | P0 | 统一 v1.6 版本归属，修契约头部/§5/术语 | #24 #57 #58 |
| #24 | P0 | 把 M1 §2.10 与 4 个错误码写入契约（建议 v1.7） | #35 #65 |
| #57 / #60 | P0 | 定 `matchedTransactionId` 口径并正式走契约变更 | #58 #64 |
| #63 | P1 | 补预算重算失败后的可重试/补偿 | #54 |
| #19 | P1 | 决定需求 1 保留或作废；需求 2 已由 #56 实现 | #56 |
| #12 / #16 | P2 | 验证 main 已实现后关闭，不改代码 | — |

另需 review：#54（M2/M4 预算重算）、#56（中性记录自愈）、#58（契约章节）。

---

## 二、逐项说明

### 1. #71 契约 v1.6 版本冲突（P0）

**问题**

- #24 把 M1 上传/抽取 §2.10 定为 v1.6；
- #57/#58 把账单一览 `matchedTransactionId` 也定为 v1.6；
- #58 分支头部写「v1.6 / 已冻结」，但 §5 仍写「当前 v1.5」，且没有 v1.6 变更条目；
- #57 仍 OPEN，#60 口径未定。

**建议动作**

1. 与 #24/#57 负责人确认版本归属，建议：
   - **#57 = v1.6**（`matchedTransactionId`）
   - **#24 = v1.7**（M1 §2.10）
2. 修改 `docs/contracts/module2-interface-v1.md`：
   - 头部版本、冻结依据与 §5「当前 vX」保持一致；
   - 在 §5 增加 v1.6（以及后续 v1.7）变更条目；
   - `docs/GLOSSARY.md` 增加 `matchedTransactionId` 术语。
3. #57/#60 关闭前，不要把状态写成「接口定义已冻结」。

**验收**

- 全仓库搜索 `v1.6` / `v1.7`，头部、§5、issue 版本号一致；
- #58 的契约 diff 不再出现「头部 v1.6、§5 v1.5」。

---

### 2. #24 契约 v1.6/v1.7：M1 上传与草稿抽取（P0）

**现状**

- §2.10 尚未写入 `docs/contracts/module2-interface-v1.md`；
- #35 已实现 `/api/capture/uploads`、`/api/capture/extract`，但仍是 Draft；
- #24 只差前端负责人确认框。

**动作**

1. 等 `@Tarnishedtaffy` 勾选前端确认框后：
   - 按 #24 正文把 §2.10、§2.6 的 4 个错误码写入契约；
   - 版本号按 #71 的结论顺延（建议 v1.7）；
   - 更新 §5 变更条目。
2. 在 #24 勾选契约维护方确认项，并通知 #35 转 Ready。
3. 检查 §2.10 与 #35 实现字段一致：
   - 上传：`file`、`sourceRef`、`modality`；
   - 抽取：`mode=draft/followup`、`rawText`、`sourceRef`、`currentDraft`、`followupText`、`pendingFeedback`；
   - 4 个错误码与 415/422 映射。

**验收**

- 契约出现 §2.10，且与 #35 路由/测试字段一致；
- #35 从 Draft 转 Ready 后 CI 全绿。

---

### 3. #57 / #60 `matchedTransactionId` 口径（P0）

**问题**

- 契约 §2.3 写 normal 记录为 `null`；
- 后端超额退款会生成 `entry_type='normal'` 的入账记录，并写 `matched_transaction_id`；
- #58 的 mock 也这样实现；#64 已把契约改成「派生的普通收支记录如果已关联原单，也返回该 id」。

**动作**

1. 在 #57 正式登记为 `contract-change`（补 label、确认区）。
2. 确认采用以下口径（推荐）：
   - 退款/还款中性记录：返回匹配原单 id；
   - 未匹配原单：`null`；
   - **超额退款/还款生成的 normal 入账记录：保留原单 id**；
   - 普通手工/导入记账：`null`。
3. 按该口径同步：
   - 契约 §2.3 与 §1.4 回执说明；
   - `backend/src/modules/ledger/intake.ts` 的 `insertExcessEntry`（若保留字段）；
   - 前端类型与 mock（#58/#64）。
4. 关闭 #60，并在 #57 记录确认结论。

**验收**

- 契约、后端、mock 三处对 normal 超额记录的说法一致；
- #58 不再出现「契约写 null、实现非 null」。

---

### 4. #63 预算重算失败后的重试（P1）

**问题**

#54 在导入事务提交后才重算预算。若重算抛错：

- 接口返回 500，但账单已入库；
- 客户端重试同一批次时结果全是 `duplicate`，`months` 为空，重算不会再次执行；
- 类别 reassign 的重算失败也有同样问题。

**建议动作（任选，优先前两项）**

1. `duplicate` 结果也按 `transactionId` 回查 `occurredAt`，触发相关月份重算；
2. 记录「待重算月份」，提供幂等补偿任务；
3. 重算失败降级为可观测告警，不返回 500。

**涉及文件**

- `backend/src/modules/ledger/routes.ts`
- 如需要：`backend/src/modules/budget/service.ts`

**验收**

- 构造一次重算失败 → 再次请求同一批次 → 预算告警/花费恢复正确；
- 补对应 backend 回归测试。

---

### 5. #19 中性记录需求 1 决策（P1）

**现状**

- 需求 2（唯一冲突自愈）已由 #56 实现并改为 `Refs #19`；
- 需求 1（退款/还款金额合理性校验，`REFUND_EXCEEDS_ORIGINAL` warning + 契约变更）未决。

**动作**

二选一，并在 #19 记录结论：

- **保留**：在 M2 入站校验中实现金额合理性 warning，补契约条目与测试；
- **作废**：由 issue 作者/reviewer 明确同意后，删除需求 1 并关闭 #19。

**验收**

- #19 要么只剩已交付内容，要么需求 1 有明确实现与测试；
- 不再使用 `Fixes #19` 在未决时自动关闭。

---

### 6. #12 / #16 验证后关闭（P2）

不需要新代码，逐项抽查后关闭：

- **#12**：`APP_AUTH_TOKEN` 中间件、6 个错误码、类别 12「贷款」均已在 main；
- **#16**：`entry_type` / `matched_transaction_id`、入站字段、统计排除中性记录均已落地。

关闭时在 issue 留验证命令/文件依据。

---

## 三、需要 Z_Wen review 的 PR

| PR | 关注点 |
|---|---|
| #54 | M2 写路径接入预算重算；重点看 `routes.ts` 和 #63 |
| #56 | 中性记录唯一冲突自愈；需求 2 是否覆盖退款/还款/利息三条路径 |
| #58 | 契约 §2.3、头部版本、§5 变更条目、GLOSSARY；先合 #64 再合 #58 |
| #64 | #59/#61 的前端修复；base 是 #58 分支，不能直接合 main |

---

## 四、不建议 Z_Wen 接的项

| Issue/PR | 归属 |
|---|---|
| #59 / #61 | 前端，已由 #64 修复 |
| #70 | 前端 mock 统计，等 #64/#66/#69 统一 |
| #72 | README 进度表，reviewer/文档维护 |
| #35 / #65 / #40 / #41 / #6 / #7 | M1 |
| #18 | 前端 |
| #55 | 日志，reviewer |

---

## 五、建议执行顺序

1. **#71** 定版本 → **#24 写 §2.10** → #35 Ready
2. **#57/#60** 定 `matchedTransactionId` → 合 #64 → 合 #58
3. **#63** → 合 #54 → 关 #38
4. **#19** 需求 1 决策 → 关 #19
5. 验证关闭 **#12/#16**
6. 更新 README 进度（#72）

## 六、验证命令

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
VITE_USE_MOCK=false pnpm --filter frontend build
```

涉及契约改动时，额外确认：

```bash
grep -n "当前 \*\*v1\." docs/contracts/module2-interface-v1.md
grep -n "v1\.[0-9]" docs/contracts/module2-interface-v1.md | tail
```
