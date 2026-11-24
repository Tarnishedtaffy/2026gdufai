# Issue 行动清单（2026-11-24）

> 范围：仓库当前 17 个 open issue、6 个 open PR（#54/#55/#56/#58/#48/#35）。
> 结论：**9 个 issue 需要继续改代码或文档**；4 个随现有 PR 合并关闭；4 个验证后可直接关闭。
> 依据：main `20753bf`、各 PR head、issue 正文与最新评论。

## 一、总表

| Issue | 优先级 | 难度 | 模块 / 负责人 | 当前状态 | 建议动作 |
|---|---|---|---|---|---|
| #24 契约 v1.6 M1 上传与抽取 | P0 | 中 | 契约 / Tarnishedtaffy + ONFAIL / huangsiting546 | 只差前端确认框，§2.10 未写入契约 | 确认后冻结 v1.6，解锁 #35 |
| #62 #56 的 Fixes #19 | P0 | 极低 | M2 / Tarnishedtaffy | #56 仍写 `Fixes #19` | 改 `Refs #19`，避免误关 |
| #59 mock summary 未归零 | P0 | 低 | 前端 / Tarnishedtaffy | PR #58 未修 | 按 entryType 过滤 summary，补测试 |
| #60 matchedTransactionId 口径冲突 | P0 | 中 | 契约 + M2 / Tarnishedtaffy + ONFAIL | 契约与超额入账实现矛盾 | 先定口径，再改契约或后端 |
| #61 mock 退款未拦截已结清原单 | P0 | 低 | 前端 / Tarnishedtaffy | PR #58 未修 | 增加 `settledAt` 判断与测试 |
| #63 预算重算失败无法重试自愈 | P1 | 中 | M2 / ONFAIL | PR #54 的可靠性缺口 | duplicate 也触发重算或记录待重算月份 |
| #19 中性记录自愈 + 金额合理性 | P1 | 中 | M2 / ONFAIL | 需求 2 由 #56 实现；需求 1 未决 | 先决定需求 1 保留或作废 |
| #6 M1 多模态识别与字段抽取 | P1 | 高 | M1 / mianyoubiaoqing | 抽取模块已有，HTTP 路由在 #35；图片/语音真实识别仍待接入 | #35 合并后补 OCR/ASR 与端到端验收 |
| #57 契约新增 matchedTransactionId | P1 | 低 | 契约 / 契约组 | #58 已带字段，但 #60 口径未定 | 与 #60 一起定稿后关闭 |
| #18 前端同步 v1.4/v1.5 | P2 | 低 | 前端 / Tarnishedtaffy | 由 #58 实现 | #59–#61 修复并合并后关闭 |
| #38 PATCH 改 kind 未重算预算 | P2 | 低 | M2 / ONFAIL | 由 #54 实现 | #54 合并后关闭 |
| #40 音频 MIME 可伪造 | P2 | 低 | M1 / mianyoubiaoqing | #35 已补魔数校验 | 随 #35 合并关闭 |
| #41 反馈码白名单未对齐 v1.5 | P2 | 低 | M1 / mianyoubiaoqing | #35 已对齐 22 码 | 随 #35 合并关闭 |
| #7 M1 批次提交与追问 | P2 | 低 | M1 / yukacezar569-blip | #13/#29 已合并，疑似已完成 | 验证后关闭 |
| #12 契约 v1.2 鉴权与接口 | P2 | 低 | 契约 / 契约组 | 鉴权、错误码、类别 12 均已在 main | 验证后关闭 |
| #16 契约 v1.3 中性记录 | P2 | 低 | 契约 / 契约组 | 表结构、入站字段、统计排除均已落地 | 验证后关闭 |
| #21 契约 v1.4 金额三态 | P2 | 低 | 契约 / 契约组 | #47 已实现并合并 | 验证后关闭 |

## 二、需要继续改的 issue

### P0：先处理，否则阻塞合并

#### #24 契约 v1.6：M1 上传与草稿抽取

- 现状：接口边界、错误码、`4000` 字符上限、`draft` 模式互斥约束已达成一致；issue 最新评论说明仅剩 **前端负责人确认框**。
- 动作：
  1. `@Tarnishedtaffy` 勾选 #24 的前端确认框并留言。
  2. 契约维护方（`@ONFAIL` / `huangsiting546`）把 §2.10 和 §2.6 的 4 个错误码写入 `docs/contracts/module2-interface-v1.md`，冻结 v1.6。
  3. #35 转 Ready for Review，合并后自动关闭 #40、#41。
- 完成标准：契约出现 §2.10；#35 CI 全绿；#40/#41 关闭；#6 的 HTTP 路由部分可用。

#### #62 #56 的 `Fixes #19` 会误关 #19

- #56 只实现 #19 的需求 2（唯一冲突自愈），需求 1（退款/还款金额合理性校验）尚未决定。
- 动作：把 #56 描述中的 `Fixes #19` 改为 `Refs #19`；或把 #19 拆成两个 issue。
- 完成标准：#56 合并时不会自动关闭 #19。

#### #59 mock summary 未按 entryType 归零

- 文件：`frontend/src/mock/db.ts` 的 `mockListTransactions`。
- 问题：summary 在 entryType 过滤前累加，`entryType=refund/repayment` 时仍统计 normal 记录；后端此时为 0。
- 动作：summary 仅在 `entryType=all` 或 `normal` 时累加；补 `entryType=refund` 的 `count=0` 断言。

#### #60 matchedTransactionId 对超额退款 normal 记录的语义

- 契约写 normal 记录为 `null`，但后端 `insertExcessEntry` 生成 normal 记录并写 `matched_transaction_id`；#58 的 mock 也这样实现。
- 动作：二选一并由契约组确认：
  1. 契约增加例外：「超额退款/还款生成的 normal 入账记录除外」；或
  2. 后端不写 `matched_transaction_id`。
- 完成标准：契约、后端、mock、前端类型四处一致。

#### #61 mock 退款未拦截已结清原单

- 文件：`frontend/src/mock/refund.ts` 的 `originalUsable`。
- 问题：只检查 status / entryType / 时间，未检查 `settledAt`；后端会返回 `ORIGINAL_ALREADY_SETTLED`。
- 动作：增加 `settledAt === null`，补已结清原单的 mock 测试。

### P1：不阻塞现有 PR，但需要排期

#### #63 导入 / 类别迁移的预算重算失败后无法自愈

- 文件：`backend/src/modules/ledger/routes.ts`。
- 问题：导入事务提交后才重算；重算抛错后重试全是 duplicate，`months` 为空，告警永久缺失。
- 动作（任选）：
  - duplicate 结果按 `transactionId` 回查月份并重算；
  - 记录待重算月份，提供幂等补偿；
  - 重算失败降级为可观测告警，不返回 500。
- 完成标准：模拟重算失败后再次请求能修复预算告警。

#### #19 中性记录自愈与金额合理性

- 需求 2 已由 #56 实现；需求 1 需要明确：
  - 保留：实现 `REFUND_EXCEEDS_ORIGINAL` warning / 金额校验并补契约；
  - 作废：由 issue 作者/reviewer 在 #19 记录决策，删除需求 1 并关闭。
- 完成标准：#19 只剩已交付内容，或需求 1 有明确结论。

#### #6 M1 多模态识别与字段抽取

- 现状：`backend/src/modules/capture/` 已有 extractor、normalizer、prompt；HTTP 路由在 #35；真实图片 OCR / 语音转写仍未接入。
- 动作：
  1. 先合并 #35（依赖 #24）。
  2. 接入 OCR/ASR 或明确降级方案，输出 `rawText/modality/sourceRef`。
  3. 补图片、语音、缺失字段、外部服务失败的端到端测试。
- 完成标准：上传图片/语音可得到可确认草稿；失败时有可恢复提示；不写库。

#### #57 契约新增 `matchedTransactionId`

- #58 已包含字段、类型和 mock；但 #60 的口径未定。
- 动作：随 #60 一起定稿；#58 合并后关闭。

## 三、随现有 PR 合并关闭

| Issue | 依赖 PR | 关闭条件 |
|---|---|---|
| #18 前端 v1.4/v1.5 同步 | #58 | #59/#60/#61 修复、CI 全绿、合并 |
| #38 PATCH 改 kind 预算重算 | #54 | #54 合并；#63 可另开跟进 |
| #40 音频魔数校验 | #35 | #24 冻结、#35 合并 |
| #41 反馈码白名单 | #35 | 同上 |

## 四、验证后可直接关闭

逐项在 main 上抽查后关闭，不需要新代码：

- **#7**：`#13`（真实确认/批次提交/反馈追问）与 `#29`（枚举严格校验）已合并；核对 capture 流程与 4 种状态回执即可。
- **#12**：`APP_AUTH_TOKEN` 中间件、6 个错误码、类别 12「贷款」均已在 main。
- **#16**：`entry_type` / `matched_transaction_id`、入站字段、统计排除中性记录均已落地。
- **#21**：v1.4 三态（作废/改额/超额入账）由 #47 实现并合并。

## 五、推荐执行顺序

1. **#24 确认 + 契约写入** → #35 Ready → 合并 #35 → 关闭 #40/#41
2. **#62 改 PR 描述** → 合并 #56
3. **#59/#60/#61** → 合并 #58 → 关闭 #18/#57
4. **#63** → 合并 #54 → 关闭 #38
5. **#19** 需求 1 决策 → 关闭 #19
6. **#6** OCR/ASR 接入与端到端验收
7. 抽查并关闭 **#7/#12/#16/#21**

## 六、非 issue 依赖

- #55（纯日志）可与 #56/#58 一起合并；三者都改 `docs/agent-logs/Tarnishedtaffy.md`，后合并的需先同步 main 解决日志冲突。
- #48 是 M1 草稿卡片金额修复，属 #35/#6 链路的前端配套，暂为 Draft。
