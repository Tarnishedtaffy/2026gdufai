## Request changes：2 项阻塞 + 2 项同批修 + 1 项强烈建议加固

@ONFAIL 我在你的 head `c288019` 上起了 Fastify + better-sqlite3 `:memory:` + `seedCategories`，用 `app.inject` 真跑了导入接口。**下面每条都附实测输出，不是读代码推测。**

先说清一件事：**CI 绿不代表可合。** 你这个 PR 的 CI 确实绿（verify + container 两个 job），但容器 smoke 唯一的 API 断言是 `/api/ci-not-found → 404`，现有 50 个 backend 用例没覆盖下面任何一条。绿灯证明「跑过的用例过了」，不证明「契约被满足」。

另外 **PR 描述里的「47 例全部通过」是过时数字**，实测基线是 **10 文件 50 例**（差的 3 例是 #8 新增的 infra 测试）。请一并更正描述。

---

### 🔴 阻塞 1（A1 · P0）非法日历日期被 V8 静默滚动，回显与落库不一致

**位置**：`backend/src/modules/ledger/validation.ts:22`（`isIsoTime` 只做正则 + `Date.parse` 非 NaN）；滚动发生在 `backend/src/shared/time.ts:10`（`toShanghaiDate`）。

**实测**：入站 `occurredAt = "2026-02-31T12:00:00+08:00"`

```json
{ "status": "confirmed",
  "echoed": "2026-02-31T12:00:00+08:00",
  "stored": { "occurred_date": "2026-03-03" } }
```

响应回显原值，库里存的是另一个日期。

**根因**：V8 对 ISO 的「日」越界是**滚动**而非报错——`Date.parse('2026-02-31T00:00:00+08:00')` 有效（`2026-13-01` 才 NaN）。所以「正则匹配 + 非 NaN」两道关都过。**只改正则拦不住。**

**改法**：在 `isIsoTime` 里用正则提取字面量的 year/month/day，并校验 month 1–12、day 为该月真实天数、hour≤23、minute/second≤59、偏移 hour≤23、偏移 minute≤59；再用 `new Date(Date.UTC(year, month - 1, day))` 检查 `getUTCFullYear()` / `getUTCMonth() + 1` / `getUTCDate()` 与输入字面量完全一致，不等即非法。⚠️ 不要用 `new Date(Date.parse(value)).toISOString().slice(0, 10)` 与输入直接比对——`Date.parse` 返回 UTC 时间戳，+08:00 每天 00:00–07:59 的合法时间会因转 UTC 跨日被全部误判为非法！也不要用 `toShanghaiDate`/任何 `+08:00` 重格式化后比较——输入可能是 `Z`/其他偏移，按上海日期会比字面量跨日，合法输入同样会被误杀。hour 也必须 ≤23：实测 V8 接受 `T24:00:00` 并滚动到次日，与日越界同属静默滚动。

**补测试**：`2026-02-31`、`2026-04-31`、`2025-02-29`（非闰年）、`2026-01-01T24:00:00+08:00` → 拒收；`2024-02-29`（闰年）→ 通过。

**依据**：issue #12 第 3 节第 5 条我已登记为「**#9 的实现必修项**」，并建议契约侧补一句「`occurredAt` 必须是真实存在的日历日期，越界返回 `INVALID_BATCH`」。**代码修复不用等契约裁定，按拒收做。** 不要自行选择「继续滚动但改回显」。

---

### 🔴 阻塞 2（FIX-1 · P0）未来时间给了 24 小时宽限

**位置**：`backend/src/modules/ledger/intake.ts:83`

```ts
return Date.parse(iso) > now.getTime() + 24 * 60 * 60 * 1000;
```

**实测**：`occurredAt = now + 2h`

```json
{ "status": "confirmed", "codes": ["MERCHANT_DEFAULTED"] }
```

`FUTURE_TIME` 不触发，直接入库。

**尺子**：契约 §1.5 写的是「时间在未来（首轮）」，§1.6 同样只说「在未来」，**没有任何容差条款**。24 小时宽限把「明天上午的预约支出」当成合法历史账单静默入库，污染当日统计。

**改法**：判据改 `Date.parse(iso) > now.getTime()`；如需容差只保留 `60_000`（1 分钟时钟抖动）。**不要用「天」做容差**——容差只能吸收时钟抖动，不能吸收业务语义。

**补测试**：`now + 2h` → 首轮 `pending_followup` + `FUTURE_TIME`(blocking)。

**为什么现有测试没拦住**：`backend/test/m2/import.test.ts:115-128` 的 `k-future` 用的是 `2030-01-01`，在「严格 > now」和「24h 宽限」两种语义下**都通过**，锁不住语义。请补近未来用例。

---

### 🟡 同批修（非阻断，但请在本 PR 一起做，成本极低）

**FIX-3 · rejected 回放丢失 feedback 的 `field` 与 `severity`**

位置：`intake.ts:150`

```ts
return rejectedResult(record, existing.codes.map((code) => blocking(null, code as FeedbackCode)));
```

根因在 `repository.ts` 的 `saveIntake` / `findIntake`：`intake_log.last_codes` **只存 code 字符串数组**。

实测：首轮 `rawText='退款 32.5'` → `rejected`，feedback `[{field:'rawText', code:'REFUND_NOT_SUPPORTED', severity:'blocking'}]`；同幂等键重发 → `[{field:null, …}]`，**`field` 从 `'rawText'` 丢成 `null`**。severity 同理：历史若为 warning 会被一律升成 blocking。

改法：`intake_log` 改存 `JSON.stringify(feedback)`（整个 item：field/code/severity）；`findIntake` 读回原样返回；rejected 回放**直接返回历史 feedback，不重新构造**。请说明旧数据（只存 code 的存量行）如何迁移或降级读取——单进程 SQLite 演示库可接受重建，但要写明。旧数据兼容可以只做 3 行：`findIntake` 解析 `last_codes` 时，数组元素是字符串就兜底转 `blocking(null, item)`，是对象就原样返回——不必改 `001_init.sql`。

补测试：首轮带 `field` 的 rejected → 重发后 `field` 与 `severity` 逐字段不变。

**FIX-4 · `directionSource` 在强制分支记错来源**

位置：`intake.ts:250`

```ts
directionSource: record.direction !== null ? 'explicit' : 'category',
```

强制分支在 `intake.ts:216-217`（`direction = category.kind` + `DIRECTION_FORCED_BY_CATEGORY`），其前提恰是 `record.direction !== null`（`:210`），所以这里**恒记 `explicit`**。

实测：`direction='expense'` + `rawText='工资 5000'`（类别为 income）→ 首轮 `pending_followup`(`CATEGORY_KIND_MISMATCH`)；重发 → `confirmed`、`direction='income'`、feedback 含 `DIRECTION_FORCED_BY_CATEGORY`，但库里 `direction_source='explicit'`（**应为 `'category'`**）。

改法：用一个变量记录**最终方向的实际来源**，在强制分支写 `'category'`。审计字段要记「实际生效的来源」，不是「入参长什么样」。

补测试：上述两轮场景断言 `direction_source === 'category'`。

---

### 🟠 强烈建议本 PR 做（OPT-2）：写路径原子性 + 唯一冲突转 duplicate

**我已实测证实存在「幂等键永久卡死」，不是理论风险。**

坏路径：

```
insertTransaction 已提交 → saveIntake 未执行（进程被杀 / SQLITE_BUSY / 磁盘 IO 错）
→ intake_log 该 key 无 confirmed 行（首轮直通时为 0 行；首轮追问过时残留 pending_followup 行，followup_round 停在原值）
→ 重发 findIntake 返回 null 或 pending_followup（round 0/1 时都不会被 :135/:149 拦截）→ 字段齐全时再走 confirmed 路径 → 再次 insertTransaction
→ 撞 UNIQUE → SqliteError 非 AppError → app.ts:44 兜底 500 INTERNAL_ERROR
→ intake_log 的 confirmed 行永远写不进去（它在 insert 之后）
⇒ 该幂等键永久卡死，数据改对也没用，只能手工清库
⇒ processBatch 抛错让整个批次 500、results 为 null，殃及批内其他记录
```

若残留 pending 行的 `followup_round=2`，重发 `round=3` 会先命中 `:154` 的 `round > MAX` 返回 `rejected`（不再 500，但已插入的 tx 与 intake 仍不一致；这是手工/异常状态的边缘分支）。

**可确定性复现的配方**（不需要真制造崩溃）：① seed 好库；② 手工 SQL 插一条 `transactions`（如 `idempotency_key='k-wedge'`），模拟语句 1 已提交；③ **不写** `intake_log`；④ POST 同 key 的正常记录；⑤ 再 POST 一次。

我在 `c288019` 上跑这个配方的结果：**两次都 `http 500` / `INTERNAL_ERROR`，`intake_log` 前后 0 行（首轮直通变体），`transactions` 恒 1 行，`results: null`。**

**⚠️ 必须两半都做，只做一半会验收失败（我实测过）：**

1. `db.transaction(() => { insertTransaction(...); saveIntake(...) })()` —— 防新增单条中间态（这是记录级原子性；要批级回滚需包在 processBatch 外层）；
2. **唯一冲突转 `duplicate`** —— 治存量卡死并自愈 `intake_log`。

**只加第 1 半，上述配方仍然两次 500**：事务管的是未来，卡死场景里不一致数据**已经落盘**了，事务碰不到它。

补上第 2 半后我实测：`http 201` / `status duplicate` / `transactionId` 指回原账单 / `intake_log` 自愈成 1 行 / `transactions` 仍 1 行，且 **backend 10 文件 50 例零回归**。

第 2 半的最小实现（已验证可行，供参考）：`catch` 到 `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` 时，按 `idempotency_key` 回查已有 tx，补写 `saveIntake(status:'confirmed', transactionId: 已有 tx.id)`，返回 `duplicate`；查不到则原样 `throw`。**不要把任意异常都吞成 duplicate。** 注意现有 `getTransactionView`（`repository.ts:177`）按主键 `t.id` 查；捕获 `SQLITE_CONSTRAINT_UNIQUE` 时要按 `t.idempotency_key` 查出已有账单的 `id` 与视图（新增查询或改造），并补写 `saveIntake(status:'confirmed', codes:['DUPLICATE_RECORD'])`。

**不要按「会重复入账」去大改**：普通顺序重发是安全的（第二次 `duplicate`、账单数仍 1，`transactions.idempotency_key` 的 UNIQUE 挡住了）。触发本卡死需一次外部故障，窗口微秒级，所以**我不把它列为合并阻塞**；但后果已实证为永久 + 批级，两半合计约 20 行、零回归，**请在本 PR 一起做**。若你决定跳过，请写明理由。

---

### 🟢 顺手修（OPT-1 · 两行）

`repository.ts:83`（`users.created_at`）、`:121`（`intake_log.created_at/updated_at`）的裸 `new Date().toISOString()` → `nowIsoShanghai()`。违反「时间统一 `+08:00`、禁裸 `toISOString()`」硬约束；只是内部审计字段、不进契约响应，故不阻断，但既然只两行就顺手修。

---

### ⛔ 本轮不要动：FIX-2 与契约待裁项

**`DUPLICATE_RECORD` 的 severity（`intake.ts:145` 现为 `warning`）—— 保持不动。**

契约自相矛盾：§1.5 表格 `:133` 写 **blocking**，§1.4 `:110` 写 `duplicate`「按成功处理，直接用返回的 `transactionId`，**不要报错**」。我在 issue #12 第 3 节第 2 条已登记意见：**建议把 §1.5 改成 `warning` 与 §1.4 一致，实现不动**。

补充两点事实，供你理解为什么这条不是「照表格改一行」就完事：

- 契约里**没有**「严重度必须逐字一致」这句话（全文检索零命中）。§1.5 表头仅第 4 列是「建议话术」（前 3 列 code/触发条件/严重度仍是规范），且 `:133` 的 blocking 与 §1.4 `:110`「按成功处理…不要报错」直接自相矛盾。之前审议材料里那句硬要求出自审议提示词，不是契约原文。
- M1 侧（PR #13）`backend/src/modules/capture/feedback.ts:17` 明写「严重度原样保留；duplicate 是否成功只由结果 status 判断」，`capture/validation.ts:91` 两种严重度都接受 ⇒ **M1 是 severity 无关的**，改哪边都不会破坏 M1。

⇒ 这条属**契约决议**，等 #12 定稿。定稿为 warning 就改契约（走 #11 或单独契约 PR），代码零改动；定稿为 blocking 再开一行修复 + 一条 severity 断言用例。**你不要自行选边，也不要在本 PR 里改契约文档。**

**以下同样不要动**（需契约澄清，部分尚未登记到 #12）：

| 项 | 位置 | 说明 |
|---|---|---|
| `MISSING_DIRECTION` 存废 | `intake.ts:223` | 低置信度兜底到「其他」时类别已判出，`LOW_CONFIDENCE_CATEGORY` 正是为此设计；可能是**删契约码**而非改代码。该分支在 11 预设齐备时不可达（我实测：停用「其他/其他收入」后才可达） |
| `candidates` 字段 | `intake.ts:34-38` | 契约把 feedback item 钉成 `{field,code,severity}`，实现没违规；缺的是契约字段（#12 §3.4） |
| 输入侧时区口径 | `validation.ts:5` | `ISO_PATTERN` 接受 `Z`/任意偏移且原样入库；契约 §1.3 `:63` 要求批次 `sentAt`「ISO-8601 带 `+08:00`」，但 `:70/:71` 对记录 `occurredAt/chatAt` 仅写 ISO-8601。实测 `sentAt=...T20:00:00Z` 被放行，第 2 轮兜底时 Z 串原样入库且 `occurred_date` 跨日；`001_init.sql:2` 也注明时间存 `+08:00`。究竟统一只收 `+08:00` 还是收任意偏移后归一化，等 #12 定稿，本轮先不动 |
| `amount=0` 语义 | — | §1.3「不能填 0」与 §1.5「0 → MISSING_AMOUNT」冲突 |
| `MAX_FOLLOWUP_ROUNDS` 口径 | `intake.ts:57` | 现值 2 实际是「问 2 次」，§1.6「满 3 轮」更自然读法是问 3 次，需与前端 mock 对齐 |
| 幂等 payload 比对 / 用户作用域 | — | 契约未要求，属加固，要动先改契约 |

**明确驳回、不要改**：`validation.ts:30` 的 `value * 100` 是**两位小数精度校验**（`isAmount`，`:26-32`），不是分/元换算；金额始终走 `intake.ts:240` 的 `yuanToCents`，且 `money.ts` 自己也用 `yuan * 100`。想抽 `isTwoDecimal()` 到 `money.ts` 另开重构 PR。

**记录即可、演示期不修**（我实测确认存在，但不要求本 PR 处理）：同批重复幂等键会批内推进轮次（实测同批 3 条同 key + `amount=null` → 第 3 条无真实交互即 `rejected`）；`rejectedResult` 回显 `direction` 兜底 `'expense'` 系捏造值（若做 FIX-3 可顺手回 `null`）；`MISSING_DIRECTION` rejected 时已累积的 `TIME_DEFAULTED_TO_CHAT_TIME` warning 被丢（实测确认）；`intake_log` 的 `'duplicate'` 状态从不写入（死分支）；`round > MAX_FOLLOWUP_ROUNDS` 分支不可达且命中时硬编码 `MISSING_AMOUNT`（实测第 4 轮返回历史码，证明走的是提前返回）；`isRefund` 正则误伤「查一下上次退货的运费谁出」这类查询；`listUserRules` 每条记录查一次（N+1，100 条上限内无碍）；批内 `recordId` 重复未校验（契约 `:65` 要求批次内唯一；实测同批两条同名 recordId 均 confirmed，结果对号被破坏）；同条记录同时缺 `amount` 与 `occurredAt` 时，首轮因 `MISSING_AMOUNT` 提前返回，次轮跳过 `MISSING_TIME` 追问直接按聊天时间兜底（实测轮 0 feedback 仅 MISSING_AMOUNT、轮 1 confirmed 带 TIME_DEFAULTED_TO_CHAT_TIME、time_source=chat_time）。

---

### ✅ 验收

```bash
pnpm install --frozen-lockfile
pnpm --filter @gduf/backend typecheck
pnpm --filter @gduf/backend lint
pnpm --filter @gduf/backend test
pnpm -r test
git diff --check      # 预期无输出
```

**预期数字**：修前 backend **10 文件 50 例**、frontend **2 文件 31 例**。修后 backend **至少 54**（A1 / FIX-1 / FIX-3 / FIX-4 各至少 1 例；做 OPT-2 再加卡死用例，≥55），frontend 仍 31。

**交付请逐条回填，不要只回「已全部修复」**：

```
A1    已修 + 已补用例（贴测试名）
FIX-1 已修 + 已补用例（贴测试名）
FIX-3 已修 + 已补用例（贴测试名，并说明 last_codes 存储格式怎么改、旧数据是否兼容）
FIX-4 已修 + 已补用例（贴测试名）
FIX-2 未动（等 #12 §3.2 定稿）
OPT-1 已修 / 跳过（原因）
OPT-2 已修（两半都做了吗？贴卡死配方修前 500 / 修后 duplicate 的对照 + 账单数不增）／跳过（理由）
测试数：修前 50 → 修后 N（贴 vitest 输出末尾两行）
```

---

### 禁止事项

1. **不要自己点合并、不要 Approve、不要 force push 到 main**；只推你自己的功能分支。历史上 5 个已合并 PR 全部作者自合，这个行为已被纠正。私有 + Free 仓设不了必需检查（分支保护 API 403），所以「CI 绿」只是建议，不是许可。
2. 不新增错误码、不改契约文档、不改 GLOSSARY（本 PR 严格按 v1.1）。当前 `shared/errors.ts` 的 6 个码与 v1.1 §2.6 一致，**「6 vs 10」的缺口属 #11 的 v1.2 新增 4 码，不要在本 PR 里补**。
3. 不重构未点名部分；不「顺手」修格式（仓库无 Prettier，格式化整改另开 PR）。
4. 不动 `classifier.ts` 优先级常量、`money.ts`、`time.ts`、`001_init.sql` 既有列——除非 FIX-3 明确要求改 `intake_log` 存储格式。
5. 日志只追加到 `docs/agent-logs/` 你自己的文件末尾，按 README 模板；**不改他人日志**。
6. PR 页面上的「8 of 12 tasks」是模板的**否定式声明**（不适用就留空），不是未完成阻塞项，不用去勾。

---

### 合并顺序

仓库约定 **#11 → #9 → #10**。#11（契约 v1.2）目前 `CHANGES_REQUESTED`、4 项 P1 未修，它提供 `INVALID_QUERY_PARAM` 与 `DEMO_USER_ID` 口径。#12 第 2 节的 10 项实现清单里，**第 3 项（入站 `userId` 必须等于 `DEMO_USER_ID`、取消按入站 userId 自动补建用户）直接落在你这个 PR 上**——所以 #11 先合能避免你返工。**两步执行**：第一步（现在即可做）：严格按 v1.1 修完 A1 / FIX-1 / FIX-3 / FIX-4 / OPT-2 并推分支；第二步（等 #11 合入 main 后）：rebase 到最新 main，#12 §2.3 的 `DEMO_USER_ID` 校验是在本 PR 顺手补还是另开小 PR，我会在评论区通知你。

修完推分支、等 CI，然后回填上面的格式。**合并由我本人按顺序点。**

核 CI 绿灯请对三判据：① 日志 `HEAD is now at … Merge <head> into <sha>` 的 `<sha>` 等于当前 main；② job 齐全（verify + container）；③ action 为固定 SHA。任一不对，绿灯不算数——#10 就出现过「基于过时 main、跑的是旧版 ci.yml、只有 1 个 job」的假绿。
