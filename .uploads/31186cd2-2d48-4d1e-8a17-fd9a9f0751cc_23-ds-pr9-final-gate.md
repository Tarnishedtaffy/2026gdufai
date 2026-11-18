# 23 · DS 终审：PR #9 待发 review × argon(Gemini) 反馈 × 本地核验结果

> **给 DeepSeek（第五轮，提交前最后闸门）。** 你是审议链 DS(17/18 号) → GLM(20 号) → argon/Gemini(22 号) 之后的收尾审议者。
> argon 已交回反馈，reviewer 侧**已在真实代码上逐条核验完毕**（含 4 组新实测）。
> 你的任务**不是重新发现 bug**，而是裁决：「这份待发 review 按下面的修改清单改到什么程度，可以提交到 GitHub PR #9」。
> 本文自包含：离线、禁工具、禁联网，全部依据本文内嵌材料。两步执行（§9），先独立推导再对照观点。

---

## 0. 目前情况说明（一页纸）

**PR #9 真实状态（gh 实测，2026-11-18 本轮两次复查一致）**：

| 项 | 值 |
|---|---|
| 仓库 / PR | `Tarnishedtaffy/2026gdufai` #9，作者 **ONFAIL**，模块 2 导入管线 |
| head | `c28801929b52f86e744ee7a4f748f2febb7953d5`（自审议开始未变） |
| review / comment | **0 条 review、0 条评论**（`reviewDecision` 空）⇒ 作者至今什么都没收到 |
| CI | 2 job 全绿，但容器 smoke 唯一 API 断言是 `/api/ci-not-found → 404`，绿灯不证明契约被满足 |
| mergeable | `MERGEABLE`，state `OPEN`，updatedAt `2026-11-17T13:26:54Z` |
| 基线测试 | backend **10 文件 50 例**、frontend **2 文件 31 例**（修后要求 backend ≥54） |
| 契约 | 本 PR 基于 main `c47e094`，契约 **v1.1**；v1.2 在未合并的 #11 |

**审议链与产物（全部本地未跟踪、未推送，作者看不到）**：
17/18 号 = 你的首轮审议；19 号 = 作者工单（FIX-1..4）；20 号 = GLM 独立复查；
GLM 卡死推演已实跑证实（只加事务仍 500，必须两半都做）；21 号 = 合并闸门工单；
22 号 = 给 argon 的自包含审议提示词；**argon 反馈已交回（本文 §6 摘录其核心）**；
待发 review 正文 = `docs/reviews/2026-11-18-pr9-github-review-request-changes.md`（本文 §5 全文内嵌，**尚未按 argon 反馈修改**）。

**argon 总裁决**：**改后发（Request changes）**——5 处必改 + 5 处建议改 + 6 处明确不改；
同意现有定级（2 阻塞 A1/FIX-1 + 2 同批修 FIX-3/FIX-4 + OPT-2 强烈建议非阻塞 + OPT-1 顺手修 + **FIX-2 本轮不动**）。

**reviewer 侧核验结论（本轮，详见 §7）**：argon 的 5 处必改**全部成立**（其中 2 处用新实测补强）；
4 处「推翻前序结论」全部核实；另发现 **2 处 argon 没提到的边界**（`T24:00:00` 也会被 V8 滚动；
argon 提议的 `Date.UTC` 修法对 0–99 年误拒）和 1 处 backlog 级新发现（金额无上限 → SQLite INTEGER 溢出存 REAL）。
argon 列的 3 项「信息不足」中 2 项已用完整源码补齐（DDL 无触发器；money/errors 全文已核）。

**用户已登记的决策（AI 共识不能覆盖，见 §10）**：
① **FIX-2（`DUPLICATE_RECORD` severity）本轮不动代码**——reviewer 本人 2026-11-17 在 issue #12 §3.2 登记「建议契约改 warning、实现不动」；
② **OPT-2 强烈建议、非阻塞**，但必须两半都做（只加事务会验收失败，已实测）。
argon 对这两点的裁决与用户决策**一致**，未触发「停下来问用户」的条件。

**授权与下一步**：用户已授权「核完反馈、改完 review 后提交 Request changes」；**不合并、不 Approve**。
流程 = 本文交 DS 裁决 → reviewer 应用必改项 → 提交 review 到 PR #9。DS 本轮只产出裁决文本，不做任何平台动作。

---

## 1. 规则

1. **两步独立顺序执行**：先只凭 §2–§5（契约、代码、实测、待发 review 原文）完成 §9 任务 A；**做完任务 A 之前不要读 §6–§8**（那是 argon 观点与 reviewer 观点，会污染独立性）。
2. **证据标注**：每条论断标【事实】/【推理】/【推测】，并附本文内嵌材料的文件名与行号；材料外信息一律标「信息不足」。
3. **行号约定**：§3 代码摘录中 `// ← :NN` 是 reviewer 加的标注（非原代码），其余为原文逐字摘录；契约行号指 `docs/contracts/module2-interface-v1.md`（v1.1，origin/main 与 pr9-gate 一致）。
4. **输出格式**：任务 A 逐题作答；任务 B 对 §8 清单逐项裁决（同意/不同意/修改 + 理由），最后给总裁决「照发 / 改后发」；若改后发，输出必改清单（位置 / 原文 / 改成 / 理由）。
5. 你之前（17/18 号）曾与 GLM 一致把 FIX-2 定为「阻塞必修」，argon 推翻了它。**本轮请凭材料重新推导，不要锚定自己旧结论**；注意 §10 第 3 条的决策权边界。

---

## 2. 材料 A：契约 v1.1 摘录（`docs/contracts/module2-interface-v1.md`）

### §1.1 传输方式（:25-30）——注意：本节没有任何时间/时区字眼

```md
### 1.1 传输方式

- 一个批次一个 JSON 文件（或一次 HTTP POST），**仅支持批量包装**（`records` 数组，一个批次可含多条记录）。
- 推荐接口：`POST /api/transactions/import`，`Content-Type: application/json`。
- 处理结果逐条返回（见 1.4）。
```

### §1.3 字段说明（:59-76，节选关键行）

```md
| 字段 | 层级 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `version` | 批次 | 是 | number | 固定 `1` |                                          // :61
| `batchId` | 批次 | 是 | string | 模块 1 生成，结果回写对号用 |                          // :62
| `sentAt` | 批次 | **是** | string | **用户发消息的时刻**（聊天时间），ISO-8601 带 `+08:00`。时间兜底规则依赖它，缺失整批拒收 |   // :63
| `records` | 批次 | 是 | array | 非空 |                                               // :64
| `recordId` | 记录 | 是 | string | 模块 1 生成，批次内唯一 |                            // :65
| `userId` | 记录 | 是 | string | 当前用户 |                                           // :66
| `direction` | 记录 | 否 | `"expense"` \| `"income"` \| `null` | 判断不了就传 `null`，**不要猜** |   // :67
| `amount` | 记录 | 否 | number \| `null` | **单位：元**，最多两位小数；识别不出传 `null`，**不要传 0** |   // :68
| `merchant` | 记录 | 否 | string \| `null` | 缺失传 `null`，不要传 `"未知"` |            // :69
| `occurredAt` | 记录 | 否 | string \| `null` | 消费发生时间，ISO-8601；日期明确但时间不明可传当天 `T12:00:00+08:00` |   // :70
| `chatAt` | 记录 | 否 | string \| `null` | 该条消息本身发出的时刻；不传则用批次 `sentAt` 兜底 |   // :71
| `rawText` | 记录 | 是 | string | 原始输入文本（语音转写结果也算） |                      // :72
| `idempotencyKey` | 记录 | 是 | string | **同一笔重发必须相同**，模块 2 据此去重 |        // :76
```

`:78`（direction 说明块）：「`null` 只出现在**入站**……类别能识别就用类别 kind 推断，推断不出就追问（`MISSING_DIRECTION`），因此 **`transactions.direction` 是非空字段，入库前方向必然已经确定**」。

### §1.4 结果格式（:104-111）

```md
| status | 含义 | 模块 1 该做什么 |
|---|---|---|
| `confirmed` | 已入库 | 展示成功；`feedback` 里的 warning 可以转成轻提示 |              // :108
| `pending_followup` | 未入库，信息不全 | **按 `feedback` 逐项追问用户**，拿到答案后原样重发同一条记录（同 `idempotencyKey`） |   // :109
| `duplicate` | 重复提交 | 按成功处理，直接用返回的 `transactionId`，**不要报错** |       // :110
| `rejected` | 放弃处理 | 提示用户手动补录或稍后重试 |                                   // :111
```

### §1.5 反馈码（:115-134）

```jsonc
"feedback": [                                                    // :115-120 结构示例：只有 field/code/severity 三字段
  { "field": "amount", "code": "MISSING_AMOUNT", "severity": "blocking" },
  { "field": "merchant", "code": "MERCHANT_DEFAULTED", "severity": "warning" }
]
```

```md
| code | 触发条件 | 严重度 | 模块 1 建议话术（文案可改，语义别变） |                        // :122 表头：仅第 4 列是「建议话术」
|---|---|---|---|
| `MISSING_AMOUNT` | 金额空/0/负 | blocking | 「这笔大概花了多少钱？」 |                  // :124
| `MISSING_TIME` | 时间缺失（首轮） | blocking | 「这是哪天的消费？」 |                   // :125
| `FUTURE_TIME` | 时间在未来（首轮） | blocking | 「这个时间是未来的，是不是记错了？」 |     // :126
| `MISSING_DIRECTION` | 方向和类别都判不出 | blocking | 「这笔是支出还是收入？」 |         // :127
| `CATEGORY_KIND_MISMATCH` | 方向与类别冲突（首轮） | blocking | …… |                   // :128
| `LOW_CONFIDENCE_CATEGORY` | 分类置信度 < 0.75 | warning | 「我把它归到了其他，可以帮我选个类别吗？」（附 `candidates`） |   // :129
| `MERCHANT_DEFAULTED` | 商户缺失 | warning | …… |                                     // :130
| `TIME_DEFAULTED_TO_CHAT_TIME` | 时间追问不清，已回退聊天时间 | warning | …… |          // :131
| `DIRECTION_FORCED_BY_CATEGORY` | 冲突二次以类别为准 | warning | …… |                  // :132
| `DUPLICATE_RECORD` | 幂等键重复 | blocking | 「这笔已经记过了」 |                       // :133 ← 与 :110 冲突
| `REFUND_NOT_SUPPORTED` | 文本是退款/退货 | blocking | …… |                            // :134
```

### §1.6 追问轮次（:138-141）与 §1.7（:145-147）

```md
- 追问轮次由模块 2 用 `idempotencyKey` 维护（存数据库），**模块 1 不需要传轮次**。          // :138
- 同一笔重发时：`idempotencyKey` 不变，已确认的字段填上，**未确认的字段继续传 `null`**。     // :139
- 第 2 轮起，如果时间仍为空或在未来，模块 2 会用 `chatAt`（或批次 `sentAt`）兜底入库，并回 `TIME_DEFAULTED_TO_CHAT_TIME`。   // :140
- 同一笔追问满 **3 轮** 仍无法解决，模块 2 返回 `rejected`，模块 1 提示用户手动补录。       // :141
```

```md
1. **空就是 `null`**，不要用 `0`、`""`、`"未知"` 填充——模块 2 靠 `null` 判断「缺失」，填了假值会被当成真实数据。   // :145
2. **金额传元、不要传分**，也不要自己四舍五入到整数。                                                        // :146
3. **重发必带原 `idempotencyKey`**，否则同一笔会被记两次；模块 2 无法替你纠正。                                // :147
```

### §2.6 错误码（:271-278）——恰好 6 个

```md
| code | HTTP | 场景 |
|---|---|---|
| `INVALID_BATCH` | 400 | 批次缺必填字段 |
| `INVALID_DIMENSION_PARAM` | 422 | dimension 与参数不匹配 |
| `CATEGORY_NOT_FOUND` | 404 | 类别不存在 |
| `CATEGORY_IN_USE` | 409 | 删除有数据的类别，返回 `counts` |
| `UNAUTHORIZED` | 401 | 缺少/错误的鉴权头 |
| `INTERNAL_ERROR` | 500 | 未捕获异常，返回通用错误信息 |
```

**已核事实**：契约全文**不存在**「严重度必须逐字一致」这句话（前轮全文 grep 零命中；该句出自 20 号审议提示词第 50 行，不是契约原文）。

---

## 3. 材料 B：代码摘录（head `c288019`，逐字；`// ← :NN` 为 reviewer 标注）

### 3.1 `backend/src/modules/ledger/intake.ts`（:56-295）

```ts
/** 追问超过该轮次仍未解决则放弃（第 3 次提交转 rejected）。 */
export const MAX_FOLLOWUP_ROUNDS = 2;                                        // ← :57
/** 分类置信度低于该值时提示用户确认。 */
const LOW_CONFIDENCE_THRESHOLD = 0.75;
/** 商户缺失时的默认值，契约 §1.5 MERCHANT_DEFAULTED。 */
const DEFAULT_MERCHANT = '未知账号';

function blocking(field: string | null, code: FeedbackCode): FeedbackItem {
  return { field, code, severity: 'blocking' };
}
function warning(field: string | null, code: FeedbackCode): FeedbackItem {
  return { field, code, severity: 'warning' };
}
function toView(category: CategoryRow | null): RecordResult['category'] {
  return category === null ? null : { id: category.id, name: category.name, kind: category.kind };
}
/** 按方向选兜底类别：支出取「其他」，收入取「其他收入」。 */
function fallbackCategory(categories: readonly CategoryRow[], direction: Direction | null): CategoryRow | null {
  const kind: Direction = direction ?? 'expense';
  const name = kind === 'expense' ? '其他' : '其他收入';
  return categories.find((item) => item.kind === kind && item.name === name) ?? null;
}

function isFuture(iso: string, now: Date): boolean {
  return Date.parse(iso) > now.getTime() + 24 * 60 * 60 * 1000;              // ← :83 FIX-1：24h 宽限
}

function rejectedResult(record: RawRecord, codes: FeedbackItem[]): RecordResult {
  return {
    recordId: record.recordId,
    status: 'rejected',
    transactionId: null,
    direction: record.direction ?? 'expense',                                // ← :91 direction=null 时捏造 'expense'
    occurredAt: null,
    category: null,
    confidence: null,
    feedback: codes
  };
}

function persistPending(
  db: Db, batch: RawBatch, record: RawRecord, round: number,
  feedback: FeedbackItem[], rejected = false
): RecordResult {
  saveIntake(db, {                                                           // ← :107 首轮追问也会写 intake_log
    idempotencyKey: record.idempotencyKey,
    recordId: record.recordId,
    batchId: batch.batchId,
    status: rejected ? 'rejected' : 'pending_followup',                      // ← :111
    followupRound: round,
    transactionId: null,
    codes: feedback.map((item) => item.code)                                 // ← :114 FIX-3 根因：只存 code 字符串
  });
  const result = rejected
    ? rejectedResult(record, feedback)
    : {
        recordId: record.recordId,
        status: 'pending_followup' as const,
        transactionId: null,
        direction: record.direction ?? 'expense',                            // ← :122 同样捏造
        occurredAt: record.occurredAt,
        category: null,
        confidence: null,
        feedback
      };
  return result;
}

function processRecord(db: Db, batch: RawBatch, record: RawRecord, categories: CategoryRow[]): RecordResult {
  const existing = findIntake(db, record.idempotencyKey);
  const round = existing === null ? 0 : existing.followupRound + 1;          // ← :133

  if (existing !== null && (existing.status === 'confirmed' || existing.status === 'duplicate')) {   // ← :135 只拦这两种
    const view = existing.transactionId === null ? null : getTransactionView(db, existing.transactionId);
    return {
      recordId: record.recordId,
      status: 'duplicate',
      transactionId: existing.transactionId,
      direction: view?.direction ?? record.direction ?? 'expense',
      occurredAt: view?.occurredAt ?? null,
      category: view?.category ?? null,
      confidence: null,
      feedback: [warning(null, 'DUPLICATE_RECORD')]                          // ← :145 FIX-2：现为 warning（本轮不动）
    };
  }

  if (existing !== null && existing.status === 'rejected') {                 // ← :149
    return rejectedResult(record, existing.codes.map((code) => blocking(null, code as FeedbackCode)));   // ← :150 FIX-3：重建丢 field/severity
  }

  // 追问轮次用尽后不再反复询问，直接放弃，避免死循环。
  if (round > MAX_FOLLOWUP_ROUNDS) {                                         // ← :154 前轮实测不可达（rejected 在 :149 提前返回）
    return persistPending(db, batch, record, round, [blocking(null, 'MISSING_AMOUNT')], true);   // ← :155 硬编码 MISSING_AMOUNT
  }

  // 退款/退货不计收入，也不生成新账单。
  if (isRefund(record.rawText)) {
    return persistPending(db, batch, record, round, [blocking('rawText', 'REFUND_NOT_SUPPORTED')], true);
  }

  // 金额缺失或非正数：必须追问，绝不猜。
  if (record.amount === null || record.amount <= 0) {                        // ← :164
    const feedback = [blocking('amount', 'MISSING_AMOUNT')];
    return persistPending(db, batch, record, round, feedback, round >= MAX_FOLLOWUP_ROUNDS);   // ← :166 提前返回，不检查时间/方向
  }

  // 时间：缺失或在未来先追问；第二轮起回退到聊天时间。
  const now = new Date();
  let occurredAt = record.occurredAt;
  let timeSource: 'explicit' | 'chat_time' = 'explicit';
  let chatAt: string | null = null;
  const timeFeedback: FeedbackItem[] = [];

  if (occurredAt === null) {
    if (round === 0) {                                                       // ← :177
      const feedback = [blocking('occurredAt', 'MISSING_TIME')];
      return persistPending(db, batch, record, round, feedback);
    }
    chatAt = record.chatAt ?? batch.sentAt;                                  // ← :181 sentAt 兜底传导
    occurredAt = chatAt;                                                     // ← :182 非 +08:00 的 sentAt 会原样入库
    timeSource = 'chat_time';
    timeFeedback.push(warning('occurredAt', 'TIME_DEFAULTED_TO_CHAT_TIME')); // ← :184
  } else if (isFuture(occurredAt, now)) {
    if (round === 0) {                                                       // ← :186
      const feedback = [blocking('occurredAt', 'FUTURE_TIME')];
      return persistPending(db, batch, record, round, feedback);
    }
    chatAt = record.chatAt ?? batch.sentAt;
    occurredAt = chatAt;
    timeSource = 'chat_time';
    timeFeedback.push(warning('occurredAt', 'TIME_DEFAULTED_TO_CHAT_TIME'));
  }

  // 分类：先按全类别匹配，冲突检测才有依据。
  const userRules = listUserRules(db, record.userId);
  const classification = classify(
    { merchant: record.merchant, rawText: record.rawText, direction: null },
    { categories, userRules }
  );
  let category: CategoryRow | null =
    classification.source === 'fallback'
      ? fallbackCategory(categories, record.direction)
      : categories.find((item) => item.id === classification.categoryId) ?? null;

  const feedback: FeedbackItem[] = [...timeFeedback];                        // ← :207
  let direction: Direction;

  if (record.direction !== null && category !== null && category.kind !== record.direction) {   // ← :210 强制分支前提 direction!==null
    if (round === 0) {                                                       // ← :211
      return persistPending(db, batch, record, round, [
        blocking('direction', 'CATEGORY_KIND_MISMATCH')
      ]);
    }
    direction = category.kind;                                               // ← :216
    feedback.push(warning('direction', 'DIRECTION_FORCED_BY_CATEGORY'));     // ← :217
  } else if (record.direction !== null) {
    direction = record.direction;
  } else if (category !== null) {
    direction = category.kind;
  } else {
    const missing = [blocking('direction', 'MISSING_DIRECTION')];            // ← :223
    return persistPending(db, batch, record, round, missing, round >= MAX_FOLLOWUP_ROUNDS);   // ← :224 只传 missing，丢 timeFeedback
  }

  if (category === null) {
    category = fallbackCategory(categories, direction);
  }
  if (classification.confidence < LOW_CONFIDENCE_THRESHOLD) {
    feedback.push(warning('category', 'LOW_CONFIDENCE_CATEGORY'));
  }
  const merchant = record.merchant?.trim() === '' || record.merchant === null ? DEFAULT_MERCHANT : record.merchant;
  if (merchant === DEFAULT_MERCHANT) {
    feedback.push(warning('merchant', 'MERCHANT_DEFAULTED'));
  }

  const amountCents = yuanToCents(record.amount);                            // ← :240 真正的元转分
  const occurredDate = toShanghaiDate(occurredAt);                           // ← :241
  const transactionId = `tx_${randomUUID()}`;
  const nowIso = nowIsoShanghai();                                           // ← :243

  ensureUser(db, record.userId);                                             // ← :245 先于 insert
  insertTransaction(db, {                                                    // ← :246 写 transactions（无事务包裹）
    id: transactionId,
    userId: record.userId,
    direction,
    directionSource: record.direction !== null ? 'explicit' : 'category',    // ← :250 FIX-4：强制分支恒记 'explicit'
    amountCents,
    merchant,
    note: record.rawText,
    occurredAt,
    occurredDate,
    timeSource,
    chatAt,
    categoryId: category?.id ?? null,
    categorySource: classification.source,
    categoryConfidence: classification.confidence,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    idempotencyKey: record.idempotencyKey,
    createdAt: nowIso,
    updatedAt: nowIso
  });

  saveIntake(db, {                                                           // ← :268 写 intake_log（第二段，非原子）
    idempotencyKey: record.idempotencyKey,
    recordId: record.recordId,
    batchId: batch.batchId,
    status: 'confirmed',                                                     // ← :272
    followupRound: round,
    transactionId,
    codes: feedback.map((item) => item.code)                                 // ← :275
  });

  return {
    recordId: record.recordId,
    status: 'confirmed',
    transactionId,
    direction,
    occurredAt,
    category: toView(category),
    confidence: classification.confidence,
    feedback
  };
}

/** 处理一个批次：逐条判定并入库，返回与输入 recordId 对应的结果。 */
export function processBatch(db: Db, batch: RawBatch): BatchResult {         // ← :291
  const categories = listCategories(db);
  const results = batch.records.map((record) => processRecord(db, batch, record, categories));   // ← :293 逐条顺序执行
  return { batchId: batch.batchId, results };
}
```

（`FeedbackItem` 接口 :34-38 只有 `field/code/severity` 三字段；`RecordResult` :40-49 含 `recordId/status/transactionId/direction/occurredAt/category/confidence/feedback`。）

### 3.2 `backend/src/modules/ledger/validation.ts`（:1-32、:123-165）

```ts
import type { Modality, RawBatch, RawRecord } from './types.ts';

const MODALITIES: readonly Modality[] = ['text', 'voice', 'image'];
const DIRECTIONS = ['expense', 'income'] as const;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;   // ← :5 接受 Z/任意偏移；小数秒 ≤3 位
const MAX_RECORDS = 100;                                                                     // ← :6
// …（isObject / isNonEmptyString 略）
/** 只接受带时区偏移的 ISO-8601，避免把本地时间当成 UTC。 */
function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));   // ← :22 A1：拦不住越界日历日期
}
/** 金额必须是有限数字且最多两位小数；非法金额属于模块 1 的字段错误。 */
function isAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {          // ← :27 无上限约束
    return false;
  }
  const scaled = value * 100;                                          // ← :30 精度校验，不是元转分
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}
```

```ts
/**
 * 校验并规范化模块 1 的批次 JSON。
 * 任一条必填字段缺失或类型非法，整批拒收（契约 1.1 / R1）。              // ← :125 注释里的「契约 1.1」指整批拒收条款
 */
export function parseBatch(input: unknown): ParseResult {
  if (!isObject(input)) { return fail('批次必须是 JSON 对象'); }
  if (input.version !== 1) { return fail('version 必须为 1', 'version'); }
  if (!isNonEmptyString(input.batchId)) { return fail('batchId 必填', 'batchId'); }        // ← :134
  if (!isIsoTime(input.sentAt)) {                                                          // ← :137 sentAt 走同一个 isIsoTime
    return fail('sentAt 必填且必须带时区（ISO-8601）', 'sentAt');
  }
  if (!Array.isArray(input.records) || input.records.length === 0) { return fail('records 必须是非空数组', 'records'); }
  if (input.records.length > MAX_RECORDS) { return fail(`records 最多 ${MAX_RECORDS} 条`, 'records'); }

  const records: RawRecord[] = [];
  for (const [index, item] of input.records.entries()) {                                   // ← :148 逐条 parseRecord
    const parsed = parseRecord(item, index);
    if ('ok' in parsed && parsed.ok === false) { return parsed; }
    records.push(parsed as RawRecord);                                                     // ← :153 无 recordId 批内去重
  }
  return { ok: true, batch: { version: 1, batchId: input.batchId, sentAt: input.sentAt, records } };
}
```

（`parseRecord` :61/:70 校验 `recordId`/`idempotencyKey` 非空字符串；:90/:93 `occurredAt`/`chatAt` 走 `isIsoTime`。）

### 3.3 `backend/src/modules/ledger/repository.ts`（:78-143、:176-206）

```ts
/** 确保用户存在，避免 transactions 外键失败。演示阶段用户由入站数据携带。 */
export function ensureUser(db: Db, userId: string): void {                   // ← :79
  db.prepare('INSERT OR IGNORE INTO users (id, nickname, created_at) VALUES (?, ?, ?)').run(
    userId, userId,
    new Date().toISOString()                                                 // ← :83 OPT-1：裸 UTC（#12 §2.3 将来要取消 ensureUser）
  );
}
/** 查询幂等键对应的入站记录。 */
export function findIntake(db: Db, idempotencyKey: string): IntakeRow | null {
  const row = db.prepare(
      'SELECT status, followup_round, transaction_id, last_codes FROM intake_log WHERE idempotency_key = ?'
    ).get(idempotencyKey) as /* … */ | undefined;
  if (row === undefined) { return null; }
  return {
    status: row.status,
    followupRound: row.followup_round,
    transactionId: row.transaction_id,
    codes: JSON.parse(row.last_codes) as string[]                            // ← :104 FIX-3 读回点
  };
}
/** 写入或更新入站记录，轮次与状态用于跨进程的追问控制。 */
export function saveIntake(db, input: { /* idempotencyKey/recordId/batchId/status/followupRound/transactionId/codes */ }): void {
  const now = new Date().toISOString();                                      // ← :121 OPT-1：裸 UTC
  db.prepare(
    `INSERT INTO intake_log
       (idempotency_key, record_id, batch_id, status, followup_round, transaction_id, last_codes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET                              // ← :126 主键冲突被 upsert 吸收，不抛错
       status = excluded.status, followup_round = excluded.followup_round,
       transaction_id = excluded.transaction_id, last_codes = excluded.last_codes,
       updated_at = excluded.updated_at`
  ).run(
    input.idempotencyKey, input.recordId, input.batchId, input.status,
    input.followupRound, input.transactionId,
    JSON.stringify(input.codes),                                             // ← :139
    now, now
  );
}
```

```ts
/** 按 id 读取账单视图，用于幂等重复时回显已有结果。 */
export function getTransactionView(db: Db, transactionId: string): TransactionView | null {   // ← :177
  const row = db.prepare(
      `SELECT t.direction, t.occurred_at, c.id AS category_id, c.name AS category_name, c.kind AS category_kind
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?`                                                      // ← :183 按主键 id 查，不是按 idempotency_key
    ).get(transactionId) as /* … */ | undefined;
  // …（row===undefined → null；否则映射 direction/occurredAt/category）
}
```

（`insertTransaction` :146-174：普通 INSERT，`.run(` 在 :153；`transactions.idempotency_key` 有 UNIQUE 约束，见 3.5。）

### 3.4 `backend/src/shared/time.ts`（全文 23 行）与 `money.ts`（全文 25 行）

```ts
/** 上海时区固定 UTC+8，无夏令时。 */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
/** 把任意可解析时间转成上海本地日期（YYYY-MM-DD），统计口径字段用它。 */
export function toShanghaiDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) { throw new RangeError(`无法解析时间: ${iso}`); }
  return new Date(time + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);     // ← :10 A1 滚动发生处
}
/** 当前时刻的 ISO-8601 字符串，带 +08:00 偏移（不含毫秒）。 */
export function nowIsoShanghai(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().replace(/\.\d{3}Z$/, '+08:00');
}
/** 上海时区的今天，YYYY-MM-DD。 */
export function todayShanghai(now: Date = new Date()): string { return toShanghaiDate(now.toISOString()); }
```

```ts
export const CENTS_PER_YUAN = 100;
/** 元转分。入站金额最多两位小数，超过直接报错，避免静默四舍五入。 */
export function yuanToCents(yuan: number): number {
  if (!Number.isFinite(yuan)) { throw new RangeError('金额必须是有限数字'); }
  const scaled = yuan * CENTS_PER_YUAN;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6) { throw new RangeError(`金额最多两位小数，当前值: ${yuan}`); }
  return cents;                                                              // ← 无上限检查（见 §4 新实测 7）
}
/** 分转元，仅用于展示或测试。 */
export function centsToYuan(cents: number): number { return cents / CENTS_PER_YUAN; }
/** 分格式化为「12.34」形式的字符串。 */
export function formatCents(cents: number): string { return (cents / CENTS_PER_YUAN).toFixed(2); }
```

### 3.5 `backend/src/db/migrations/001_init.sql`（:36-63、:97-108；**全文 109 行已通读，无任何 `CREATE TRIGGER`**）

```sql
CREATE TABLE transactions (
  id                  TEXT    PRIMARY KEY,
  user_id             TEXT    NOT NULL REFERENCES users(id),
  direction           TEXT    NOT NULL CHECK (direction IN ('expense', 'income')),
  direction_source    TEXT    NOT NULL CHECK (direction_source IN ('explicit', 'category')),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  merchant            TEXT    NOT NULL,
  note                TEXT,
  occurred_at         TEXT    NOT NULL,
  occurred_date       TEXT    NOT NULL,
  time_source         TEXT    NOT NULL DEFAULT 'explicit' CHECK (time_source IN ('explicit', 'chat_time')),
  chat_at             TEXT,
  category_id         INTEGER REFERENCES categories(id),
  category_source     TEXT    CHECK (category_source IN ('rule', 'user_rule', 'llm', 'fallback', 'manual')),
  category_confidence REAL,
  status              TEXT    NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'void')),
  source_modality     TEXT    NOT NULL CHECK (source_modality IN ('text', 'voice', 'image', 'csv')),
  source_ref          TEXT,
  anomaly_flag        INTEGER NOT NULL DEFAULT 0 CHECK (anomaly_flag IN (0, 1)),
  anomaly_reason      TEXT,
  idempotency_key     TEXT    NOT NULL UNIQUE,                               -- ← :60 OPT-2 撞的就是它
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);
-- …（idx_tx_* 三个索引、budgets/budget_alerts 与本题无关，略）
CREATE TABLE intake_log (
  idempotency_key TEXT    PRIMARY KEY,                                       -- ← :98
  record_id       TEXT    NOT NULL,
  batch_id        TEXT,
  status          TEXT    NOT NULL CHECK (status IN ('confirmed', 'pending_followup', 'rejected', 'duplicate')),
  followup_round  INTEGER NOT NULL DEFAULT 0,
  transaction_id  TEXT,                                                      -- ← :104 可空、无外键
  last_codes      TEXT    NOT NULL DEFAULT '[]',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
```

文件头注释 :2：「金额一律整数『分』；**时间存 ISO-8601（+08:00）**并冗余本地日期 occurred_date」。
其余表（users :4-10、categories :12-24、user_category_rules :26-34）已通读，无影响 intake_log/transactions 写入的隐藏约束或触发器。

### 3.6 `backend/src/shared/errors.ts`（:1-8）与 `app.ts:44`

```ts
/** 契约 2.6 中登记的错误码。新增错误码必须先改契约。 */
export type ErrorCode =
  | 'INVALID_BATCH' | 'INVALID_DIMENSION_PARAM' | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_IN_USE' | 'UNAUTHORIZED' | 'INTERNAL_ERROR';                   // 恰好 6 个 = v1.1 §2.6
```

`app.ts:44`：全局错误兜底 `void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', … } })`（非 AppError 一律 500）。
`routes.ts:13`：同步调用 `processBatch`；better-sqlite3 全同步 API ⇒ 单进程内一次 processBatch 不会与另一请求交织。

### 3.7 测试基线（前轮已逐条核实）

- `backend/test/m2/import.test.ts:115-128` `k-future` 用 `2030-01-01`（两种未来语义下都过，锁不住 24h 宽限）；`:130-140` `k-dup` 只断言 status/transactionId/行数，**不断言 severity**。
- `backend/test/m2/validation.test.ts:98-106` 只有 101 条拒收，**无恰好 100 条通过的边界用例**。
- 全文无 `LOW_CONFIDENCE_CATEGORY` / `MISSING_DIRECTION` 端到端断言；无越界日历日期用例；无 rejected 重放 field 断言；无 direction_source 断言。
- M1 侧（PR #13）`capture/feedback.ts:17`「严重度原样保留；duplicate 是否成功只由结果 status 判断」、`capture/validation.ts:91` 两种 severity 都接受 ⇒ **M1 对 severity 无感**。

---

## 4. 材料 C：实测输出

### 4.0 前轮已实测（JSON 已内嵌在 §5 review 正文中，不重复）

A1 越界日期（回显 2026-02-31 / 落库 occurred_date=2026-03-03）、FIX-1（now+2h 首轮 confirmed）、
FIX-3（重放 field 从 rawText 丢成 null）、FIX-4（direction_source 恒 explicit）、
OPT-2 卡死配方（手工插 tx 不写 intake_log → 两次 500；**只加 db.transaction 仍两次 500**；事务+catch UNIQUE+回查+补写 → 201 duplicate、intake_log 自愈、backend 50 例零回归）。
基线：`pnpm --filter @gduf/backend test` = **10 文件 50 例**；frontend **2 文件 31 例**。

### 4.1 新实测 1：B-5 时区陷阱复现（node v24.18.0，本轮）

```text
Date.parse("2026-02-31T12:00:00+08:00") 有效: true
该串 toShanghaiDate → 2026-03-03
陷阱1: "2026-03-01T02:00:00+08:00" 按 UTC 切片 → 2026-02-28（输入字面量是 2026-03-01 → 误杀）
陷阱2: "2026-02-28T20:00:00Z" 按上海日期 → 2026-03-01（输入字面量是 2026-02-28 → 误杀）
```

### 4.2 新实测 2：原 isIsoTime vs argon 提议修法（正则拆字面量 + Date.UTC 回环）接受面对比

argon 提议实现（照抄其伪代码）：`ISO_PARTS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/`，
时分秒/偏移范围检查（hour≤23、min/sec≤59、offsetHour≤23、offsetMin≤59），
`new Date(Date.UTC(year, month-1, day))` 的 getUTCFullYear/getUTCMonth+1/getUTCDate 与字面量比对，最后 `!Number.isNaN(Date.parse(value))`。

```text
DIFF  2026-02-31T12:00:00+08:00  orig=true argon=false   ← A1 目标，正确拒收
DIFF  2026-02-29T12:00:00+08:00  orig=true argon=false   ← 平年 2/29，正确拒收
SAME  2024-02-29T12:00:00+08:00  orig=true argon=true    ← 闰年，正确放行
DIFF  2026-04-31T00:00:00+08:00  orig=true argon=false   ← 小月 31，正确拒收
SAME  2026-03-01T02:00:00+08:00  orig=true argon=true    ← 凌晨 +08:00，不误杀
SAME  2026-02-28T20:00:00Z      orig=true argon=true    ← 跨上海午夜 Z，不误杀
SAME  2026-13-01 / 2026-00-10 / 2026-01-00  两者均 false
DIFF  2026-01-01T24:00:00+08:00  orig=true argon=false   ← ★新发现 N-a：V8 接受 T24:00:00 并滚动到次日
SAME  .123 小数秒两者均 true；.1234 两者均 false（原正则本就限 1–3 位，argon 正则兼容）
DIFF  0099-01-01T00:00:00+08:00  orig=true argon=false   ← ★新发现 N-b：Date.UTC(99,…)→1999，0–99 年被误拒
DIFF  0000-01-01T00:00:00+08:00  orig=true argon=false   ← 同上
SAME  +14:00 两者 true；+24:00 两者 false（Date.parse NaN）
Date.UTC(99,0,1) → 1999-01-01T00:00:00.000Z（JS 把 0–99 年映射到 1900–1999）
```

### 4.3 新实测 3：探针 A——批内 recordId 重复（契约 :65 要求批次内唯一）

同批两条记录 `recordId` 均为 `r_001`（idempotencyKey 不同，其余合法）→ **http 201，两条都 confirmed**，
results 出现两个同名 recordId（tx_66bd3e8d… / tx_ea8023d3…），破坏 :62 结果对号语义。
`validation.ts:147-154` 无去重检查。【事实·实测】

### 4.4 新实测 4：探针 B——多字段同时缺失，首轮提前返回 → 次轮跳过时间追问直接兜底

```text
轮0（amount=null, occurredAt=null, rawText='一笔开销'）→ http 201 pending_followup
  feedback 仅 [{field:'amount', code:'MISSING_AMOUNT', severity:'blocking'}]   ← 没有 MISSING_TIME
轮1（同 idempotencyKey，amount=50，occurredAt 仍 null，符合契约 :139）→ http 201 confirmed
  occurredAt='2026-11-15T21:00:00+08:00'（= batch.sentAt）
  feedback=[TIME_DEFAULTED_TO_CHAT_TIME(warning), LOW_CONFIDENCE_CATEGORY(warning), MERCHANT_DEFAULTED(warning)]
落库: {"occurred_at":"2026-11-15T21:00:00+08:00","occurred_date":"2026-11-15","time_source":"chat_time"}
```

⇒ 模块 2 **从未就时间追问过用户**，却按「第 2 轮追问不清」静默兜底（:164-167 提前返回 + :177 round===0 门）。【事实·实测】

### 4.5 新实测 5：探针 C——sentAt 传 Z（契约 :63 明写 +08:00）被放行并污染兜底入库

```text
批次 sentAt='2026-11-15T20:00:00Z'，记录 occurredAt=null、chatAt=null、amount=50
轮0 → 201 pending_followup [MISSING_TIME]
轮1 → 201 confirmed，回显 occurredAt='2026-11-15T20:00:00Z'
落库: {"occurred_at":"2026-11-15T20:00:00Z","occurred_date":"2026-11-16","time_source":"chat_time","chat_at":"2026-11-15T20:00:00Z"}
```

⇒ 非 +08:00 字符串原样进 `transactions.occurred_at`（也违反 001_init.sql:2 内部注释），且字面量 11-15 与统计列 11-16 **跨日分裂**。
对 sentAt 而言这是**真偏离契约 :63**；occurredAt/chatAt（:70/:71）才是口径未定。【事实·实测】

### 4.6 新实测 6：残留 pending_followup 行的卡死变体（验证 argon 对 review「0 行」断言的推翻）

构造：users 插 u_001；transactions 手工插 `k_wedge2`（模拟次轮 insertTransaction 已提交）；
intake_log 插 `('k_wedge2','pending_followup',followup_round=0,transaction_id=NULL)`（模拟首轮追问已落库、次轮 saveIntake 未执行）。
POST 完整合法记录（amount=50、occurredAt 合法）×2：

```text
重发1: http 500 {"error":{"code":"INTERNAL_ERROR","message":"服务器内部错误"}}
重发2: http 500 同上
  错误栈: SqliteError UNIQUE constraint failed: transactions.idempotency_key
          at insertTransaction (repository.ts:153) → processRecord (intake.ts:246) → processBatch (intake.ts:293)
intake_log: {"status":"pending_followup","followup_round":0,"transaction_id":null}   ← 永不推进
tx 行数: 1
```

⇒ review 原文「intake_log 该 key 0 行 / saveIntake 是首次 intake 写入」**不总成立**；
残留 pending 行同样永久 500（:135/:149 都不拦 pending_followup；saveIntake 不执行 ⇒ followup_round 恒 0 ⇒ :154 出口永远到不了）。【事实·实测】

### 4.7 新实测 7：金额无上限 → SQLite INTEGER 溢出存 REAL（backlog 级，非本 review 范围）

```text
isAmount(1e17) 通过: true            （Number.isFinite + 两位小数检查都过）
yuanToCents(1e17) = 1e19 > SQLite INTEGER max 9223372036854775807: true
better-sqlite3 绑定 1e19 到 INTEGER 列后: {"ty":"real","x":10000000000000000000}
```

⇒ 极端大额不报错、静默存成 REAL（类型/精度失真）。触发需异常输入，演示期无实际风险；**建议只进 backlog，不进本 review**。【事实·实测】

---

## 5. 材料 D：待发 review 全文（当前草稿，**尚未按 argon 反馈修改**）

> 来源 `docs/reviews/2026-11-18-pr9-github-review-request-changes.md`，从粘贴标题起逐字内嵌（本地用法说明块省略）。
> 这就是准备提交到 GitHub PR #9 的 Request changes 正文。提交人 Tarnishedtaffy，对象 @ONFAIL。

## Request changes：2 项阻塞 + 2 项同批修 + 1 项强烈建议加固

@ONFAIL 我在你的 head `c288019` 上起了 Fastify + better-sqlite3 `:memory:` + `seedCategories`，用 `app.inject` 真跑了导入接口。**下面每条都附实测输出，不是读代码推测。**

先说清一件事：**CI 绿不代表可合。** 你这个 PR 的 CI 确实绿（verify + container 两个 job），但容器 smoke 唯一的 API 断言是 `/api/ci-not-found → 404`，现有 50 个 backend 用例没覆盖下面任何一条。绿灯证明「跑过的用例过了」，不证明「契约被满足」。

另外 **PR 描述里的「47 例全部通过」是过时数字**，实测基线是 **10 文件 50 例**（差的 3 例是 #8 新增的 infra 测试）。请一并更正描述。

---

### 🔴 阻塞 1（P0）非法日历日期被 V8 静默滚动，回显与落库不一致

**位置**：`backend/src/modules/ledger/validation.ts:22`（`isIsoTime` 只做正则 + `Date.parse` 非 NaN）；滚动发生在 `backend/src/shared/time.ts:10`（`toShanghaiDate`）。

**实测**：入站 `occurredAt = "2026-02-31T12:00:00+08:00"`

```json
{ "status": "confirmed",
  "echoed": "2026-02-31T12:00:00+08:00",
  "stored": { "occurred_date": "2026-03-03" } }
```

响应回显原值，库里存的是另一个日期。

**根因**：V8 对 ISO 的「日」越界是**滚动**而非报错——`Date.parse('2026-02-31T00:00:00+08:00')` 有效（`2026-13-01` 才 NaN）。所以「正则匹配 + 非 NaN」两道关都过。**只改正则拦不住。**

**改法**：在 `isIsoTime` 里加**日历回环校验**——把解析出的年月日重新格式化并与输入比对，不等即非法（或等价地逐字段范围校验 + 月末日校验）。

**补测试**：`2026-02-31`、`2026-04-31`、`2025-02-29`（非闰年）→ 拒收；`2024-02-29`（闰年）→ 通过。

**依据**：issue #12 第 3 节第 5 条我已登记为「**#9 的实现必修项**」，并建议契约侧补一句「`occurredAt` 必须是真实存在的日历日期，越界返回 `INVALID_BATCH`」。**代码修复不用等契约裁定，按拒收做。** 不要自行选择「继续滚动但改回显」。

---

### 🔴 阻塞 2（P0）未来时间给了 24 小时宽限

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

改法：`intake_log` 改存 `JSON.stringify(feedback)`（整个 item：field/code/severity）；`findIntake` 读回原样返回；rejected 回放**直接返回历史 feedback，不重新构造**。请说明旧数据（只存 code 的存量行）如何迁移或降级读取——单进程 SQLite 演示库可接受重建，但要写明。

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

### 🟠 强烈建议本 PR 做：写路径原子性 + 唯一冲突转 duplicate

**我已实测证实存在「幂等键永久卡死」，不是理论风险。**

坏路径：

```
insertTransaction 已提交 → saveIntake 未执行（进程被杀 / SQLITE_BUSY / 磁盘 IO 错）
→ intake_log 该 key 0 行（注意：不是 pending，confirmed 路径下 saveIntake 是首次 intake 写入）
→ 重发 findIntake 返回 null → 永远走 confirmed 路径 → 再次 insertTransaction
→ 撞 UNIQUE → SqliteError 非 AppError → app.ts:44 兜底 500 INTERNAL_ERROR
→ intake_log 的 confirmed 行永远写不进去（它在 insert 之后）
⇒ 该幂等键永久卡死，数据改对也没用，只能手工清库
⇒ processBatch 抛错让整个批次 500、results 为 null，殃及批内其他记录
```

**可确定性复现的配方**（不需要真制造崩溃）：① seed 好库；② 手工 SQL 插一条 `transactions`（如 `idempotency_key='k-wedge'`），模拟语句 1 已提交；③ **不写** `intake_log`；④ POST 同 key 的正常记录；⑤ 再 POST 一次。

我在 `c288019` 上跑这个配方的结果：**两次都 `http 500` / `INTERNAL_ERROR`，`intake_log` 前后 0 行，`transactions` 恒 1 行，`results: null`。**

**⚠️ 必须两半都做，只做一半会验收失败（我实测过）：**

1. `db.transaction(() => { insertTransaction(...); saveIntake(...) })()` —— 防新增中间态 + 批级回滚；
2. **唯一冲突转 `duplicate`** —— 治存量卡死并自愈 `intake_log`。

**只加第 1 半，上述配方仍然两次 500**：事务管的是未来，卡死场景里不一致数据**已经落盘**了，事务碰不到它。

补上第 2 半后我实测：`http 201` / `status duplicate` / `transactionId` 指回原账单 / `intake_log` 自愈成 1 行 / `transactions` 仍 1 行，且 **backend 10 文件 50 例零回归**。

第 2 半的最小实现（已验证可行，供参考）：`catch` 到 `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` 时，按 `idempotency_key` 回查已有 tx，补写 `saveIntake(status:'confirmed', transactionId: 已有 tx.id)`，返回 `duplicate`；查不到则原样 `throw`。**不要把任意异常都吞成 duplicate。**

**不要按「会重复入账」去大改**：普通顺序重发是安全的（第二次 `duplicate`、账单数仍 1，`transactions.idempotency_key` 的 UNIQUE 挡住了）。触发本卡死需一次外部故障，窗口微秒级，所以**我不把它列为合并阻塞**；但后果已实证为永久 + 批级，两半合计约 20 行、零回归，**请在本 PR 一起做**。若你决定跳过，请写明理由。

---

### 🟢 顺手修（两行）

`repository.ts:83`（`users.created_at`）、`:121`（`intake_log.created_at/updated_at`）的裸 `new Date().toISOString()` → `nowIsoShanghai()`。违反「时间统一 `+08:00`、禁裸 `toISOString()`」硬约束；只是内部审计字段、不进契约响应，故不阻断，但既然只两行就顺手修。

---

### ⛔ 本轮不要动：FIX-2 与契约待裁项

**`DUPLICATE_RECORD` 的 severity（`intake.ts:145` 现为 `warning`）—— 保持不动。**

契约自相矛盾：§1.5 表格 `:133` 写 **blocking**，§1.4 `:110` 写 `duplicate`「按成功处理，直接用返回的 `transactionId`，**不要报错**」。我在 issue #12 第 3 节第 2 条已登记意见：**建议把 §1.5 改成 `warning` 与 §1.4 一致，实现不动**。

补充两点事实，供你理解为什么这条不是「照表格改一行」就完事：

- 契约里**没有**「严重度必须逐字一致」这句话（全文检索零命中）。§1.5 表头实际是「模块 1 **建议**话术（文案可改，语义别变）」。之前审议材料里那句硬要求出自审议提示词，不是契约原文。
- M1 侧（PR #13）`backend/src/modules/capture/feedback.ts:17` 明写「严重度原样保留；duplicate 是否成功只由结果 status 判断」，`capture/validation.ts:91` 两种严重度都接受 ⇒ **M1 是 severity 无关的**，改哪边都不会破坏 M1。

⇒ 这条属**契约决议**，等 #12 定稿。定稿为 warning 就改契约（走 #11 或单独契约 PR），代码零改动；定稿为 blocking 再开一行修复 + 一条 severity 断言用例。**你不要自行选边，也不要在本 PR 里改契约文档。**

**以下同样不要动**（需契约澄清，部分尚未登记到 #12）：

| 项 | 位置 | 说明 |
|---|---|---|
| `MISSING_DIRECTION` 存废 | `intake.ts:223` | 低置信度兜底到「其他」时类别已判出，`LOW_CONFIDENCE_CATEGORY` 正是为此设计；可能是**删契约码**而非改代码。该分支在 11 预设齐备时不可达（我实测：停用「其他/其他收入」后才可达） |
| `candidates` 字段 | `intake.ts:34-38` | 契约把 feedback item 钉成 `{field,code,severity}`，实现没违规；缺的是契约字段（#12 §3.4） |
| 输入侧时区口径 | `validation.ts:5` | `ISO_PATTERN` 接受 `Z`/任意偏移且原样入库；契约 §1.1 只写「带时区」，实现不算违反。需定「只收 +08:00」还是「收任意偏移并归一化」 |
| `amount=0` 语义 | — | §1.3「不能填 0」与 §1.5「0 → MISSING_AMOUNT」冲突 |
| `MAX_FOLLOWUP_ROUNDS` 口径 | `intake.ts:57` | 现值 2 实际是「问 2 次」，§1.6「满 3 轮」更自然读法是问 3 次，需与前端 mock 对齐 |
| 幂等 payload 比对 / 用户作用域 | — | 契约未要求，属加固，要动先改契约 |

**明确驳回、不要改**：`validation.ts:30` 的 `value * 100` 是**两位小数精度校验**（`isAmount`，`:26-32`），不是分/元换算；金额始终走 `intake.ts:240` 的 `yuanToCents`，且 `money.ts` 自己也用 `yuan * 100`。想抽 `isTwoDecimal()` 到 `money.ts` 另开重构 PR。

**记录即可、演示期不修**（我实测确认存在，但不要求本 PR 处理）：同批重复幂等键会批内推进轮次（实测同批 3 条同 key + `amount=null` → 第 3 条无真实交互即 `rejected`）；`rejectedResult` 回显 `direction` 兜底 `'expense'` 系捏造值（若做 FIX-3 可顺手回 `null`）；`MISSING_DIRECTION` rejected 时已累积的 `TIME_DEFAULTED_TO_CHAT_TIME` warning 被丢（实测确认）；`intake_log` 的 `'duplicate'` 状态从不写入（死分支）；`round > MAX_FOLLOWUP_ROUNDS` 分支不可达且命中时硬编码 `MISSING_AMOUNT`（实测第 4 轮返回历史码，证明走的是提前返回）；`isRefund` 正则误伤「查一下上次退货的运费谁出」这类查询；`listUserRules` 每条记录查一次（N+1，100 条上限内无碍）。

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

**预期数字**：修前 backend **10 文件 50 例**、frontend **2 文件 31 例**。修后 backend **至少 54**（A1 / FIX-1 / FIX-3 / FIX-4 各至少 1 例；做 OPT-2 再加卡死用例），frontend 仍 31。

**交付请逐条回填，不要只回「已全部修复」**：

```
A1    已修 + 已补用例（贴测试名）
FIX-1 已修 + 已补用例（贴测试名）
FIX-3 已修（说明 last_codes 存储格式怎么改、旧数据是否兼容）
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

仓库约定 **#11 → #9 → #10**。#11（契约 v1.2）目前 `CHANGES_REQUESTED`、4 项 P1 未修，它提供 `INVALID_QUERY_PARAM` 与 `DEMO_USER_ID` 口径。#12 第 2 节的 10 项实现清单里，**第 3 项（入站 `userId` 必须等于 `DEMO_USER_ID`、取消按入站 userId 自动补建用户）直接落在你这个 PR 上**——所以 #11 先合能避免你返工。

修完推分支、等 CI，然后回填上面的格式。**合并由我本人按顺序点。**

核 CI 绿灯请对三判据：① 日志 `HEAD is now at … Merge <head> into <sha>` 的 `<sha>` 等于当前 main；② job 齐全（verify + container）；③ action 为固定 SHA。任一不对，绿灯不算数——#10 就出现过「基于过时 main、跑的是旧版 ci.yml、只有 1 个 job」的假绿。

（§5 完）

---

## 6. 材料 E：argon(Gemini) 反馈核心（原文摘录；其完整任务 A 独立发现多为前轮已知问题的再确认）

### 6.1 总裁决（B-10）

> **改后发（Request changes）**。核心证据链扎实、定级合理；但存在 **5 处必改项**（1 处契约条款号误引、1 处 A1 修法时区误判陷阱、2 处技术表述失准、1 处验收编号断层），按必改清单替换对应句子后即可直接发出。

### 6.2 必改清单（5 项，原文 → argon 建议改法）

**M1 · 代号断层**：正文 4 个标题未标代号，但「✅ 验收」「禁止事项」直接用 `A1/FIX-1/OPT-1/OPT-2`，作者看不到本地工单文件无法对应。
改法：标题分别改为 `### 🔴 阻塞 1（A1 · P0）…`、`### 🔴 阻塞 2（FIX-1 · P0）…`、`### 🟠 强烈建议本 PR 做（OPT-2）：…`、`### 🟢 顺手修（OPT-1 · 两行）`。

**M2 · A1 修法时区陷阱**：原文「把解析出的年月日重新格式化并与输入比对」会诱导作者写 `new Date(Date.parse(value)).toISOString().slice(0,10) === value.slice(0,10)`，
把 +08:00 每天 00:00–07:59 的合法时间因转 UTC 跨日全部误杀（`toShanghaiDate` 版则误杀跨上海午夜的非 +08:00 合法时间）。
改法：改为「用正则提取字面量 year/month/day（及时分秒与偏移量范围 ≤23:59），通过 `new Date(Date.UTC(year, month-1, day))` 检查 `getUTCFullYear()/getUTCMonth()+1/getUTCDate()` 与输入字面量完全一致」，并附 ⚠️ 警示句。argon 附完整伪代码（见 §4.2，已实测）。

**M3 · 坏路径图两处技术失准**：
① 原文「intake_log 该 key 0 行（注意：不是 pending，confirmed 路径下 saveIntake 是首次 intake 写入）」过头——首轮 pending 已写 intake_log（:107-115），次轮 confirmed 失败时残留 pending_followup 行，同样永久 500。
改为「intake_log 该 key 无 confirmed 行（首轮直通时为 0 行；追问后次轮 confirmed 时残留 pending_followup 行，两边重发都不会被 findIntake 拦截）」。
② 原文「db.transaction(…) —— 防新增中间态 + **批级回滚**」错误——两句写操作在 processRecord 内，只包它们只能**单条记录级**回滚；批级回滚需包 processBatch 外层。
改为「防新增单条中间态（若包在 processBatch 外层则兼顾批级回滚）」。

**M4 · 契约条款号误引**：原文「契约 §1.1 只写『带时区』，实现不算违反」错误——§1.1（:25-30）讲传输方式，全文无时区字眼；§1.3 :63 对 sentAt 明写「ISO-8601 带 +08:00」，:70/:71 对 occurredAt/chatAt 仅写 ISO-8601。
改为「契约 §1.3 :63 要求批次 sentAt『ISO-8601 带 +08:00』，但 :70/:71 对记录 occurredAt/chatAt 仅写 ISO-8601。究竟统一只收 +08:00 还是收任意偏移后归一化，等 #12 定稿，本轮先不动」。
（argon 同时指出：对 sentAt 而言实现**确实偏离 :63**，不能整条归为「契约未定」；但修法方向未定，本轮仍不动代码。）

**M5 · FIX-3 回填模板漏补测**：验收数字段要求「A1/FIX-1/FIX-3/FIX-4 各至少 1 例」、FIX-3 正文有「补测试」，但回填代码块 FIX-3 行只写「已修（说明 last_codes 存储格式怎么改、旧数据是否兼容）」。
改为「FIX-3 已修 + 已补用例（贴测试名，并说明 last_codes 存储格式怎么改、旧数据是否兼容）」。

### 6.3 建议改清单（5 项）

- **S1**：FIX-3 改法补一行旧数据兼容提示——findIntake 解析 last_codes 时元素为 string 则兜底转 `blocking(null, item)`、为对象则原样返回，3 行零成本兼容，无需改 001_init.sql。
- **S2**：OPT-2 第 2 半补提示——现有 `getTransactionView`（repository.ts:177）按主键 `t.id` 查；捕获 SQLITE_CONSTRAINT_UNIQUE 时需按 `t.idempotency_key` 查出已有账单 id 与视图，并补写 `saveIntake(…, codes:['DUPLICATE_RECORD'])`。
- **S3**：「⛔ 本轮不要动」第一段论据微调——「§1.5 表头实际是『建议话术』」易被读成整张表都是建议；改为聚焦「表头仅第 4 列是建议话术 + :133 与 :110 自相矛盾 + 契约无『逐字一致』硬话术 + M1 对 severity 无感」。
- **S4**：合并顺序段补两步执行——「第一步（现在即可做）：严格按 v1.1 修完 A1/FIX-1/FIX-3/FIX-4/OPT-2 推分支；第二步（等 #11 合入 main 后）：rebase 到最新 main，#12 §2.3 的 DEMO_USER_ID 校验在本 PR 顺手补还是另开小 PR，届时我在评论区通知你」，消除「禁止改 v1.2」与「#12 §2.3 落在本 PR」的执行歧义。
- **S5**：「记录即可」段补两条真实发现——① 批内 recordId 唯一性未校验（契约 :65 vs validation.ts:147-154）；② 多字段同时缺失时首轮 MISSING_AMOUNT 提前返回 → 次轮跳过 MISSING_TIME 追问直接兜底（intake.ts:164-184）。

### 6.4 明确不改清单（6 项，防执行方白干）

① DUPLICATE_RECORD severity 保持 warning（契约 :110/:133 自相矛盾 + M1 severity 无关 + 等 #12 §3.2）；
② isAmount 的 `value*100` 是精度校验不是换算；
③ MISSING_DIRECTION 分支与 classifier 兜底（11 预设齐备时不可达，属契约待裁）；
④ 不给 FeedbackItem 加 candidates（契约未定义 schema，#12 §3.4）；
⑤ 不新增 v1.2 的 4 个错误码（6 码 = v1.1 §2.6，缺口属 #11）；
⑥ 不动 MAX_FOLLOWUP_ROUNDS=2（「满 3 轮」口径待与前端 mock 统一）。

### 6.5 argon 推翻的前序结论（4 项）

1. **推翻三方链（DS/GLM/19 号工单）把 FIX-2 定为「阻塞必修」**：契约无「逐字一致」原文（出自 20 号提示词第 50 行）；:110 与 :133 自相矛盾；M1 severity 无关；reviewer 已在 #12 §3.2 登记「改契约为 warning、实现不动」⇒ 赞成路径 C（本轮不动）。
2. **推翻 review「输入侧时区：契约 §1.1 只写带时区」**（见 M4）。
3. **推翻 review A1 修法表述**（见 M2）。
4. **推翻 review「0 行/首次写入」与「批级回滚」**（见 M3）。

### 6.6 定级与关键裁决

- **B-2 定级**：同意 2 阻塞（A1/FIX-1）+ 2 同批修（FIX-3/FIX-4）+ OPT-2 强烈建议非阻塞 + OPT-1 顺手修 + FIX-2 不动。
- **B-3 FIX-2**：同意路径 C；并认为 #12 最终落点应选「契约 §1.5 改 warning」（:110 更能代表契约意图；blocking 对应非成功态、warning 对应成功态，duplicate 语义与 blocking 互斥）。防悬空：#9 作者 ONFAIL 本人是契约维护方，合并顺序 #11→#9→#10，#11 合入前把 #12 §3.2 一并敲定即可闭环。
- **B-4 OPT-2 不升阻塞**：独立逐字段核对 intake_log DDL 与 saveIntake 后结论——insertTransaction 已成功的前提下，saveIntake **不存在业务输入触发的确定性抛错路径**（PK 冲突被 ON CONFLICT 吸收、status 在 CHECK 白名单、transaction_id 无外键、last_codes 恒合法 JSON、时间戳恒非空），除非进程被杀/磁盘 IO/SQLITE_BUSY/schema 被外部篡改。「事务只防新增、治不了存量」成立（前轮第二组实验是构造性证明）。
- **B-5 A1 修法**：方向正确但原表述有时区误判陷阱，必须改正则拆字面量 + Date.UTC（伪代码见 §4.2）；与 toShanghaiDate 职责正交不冲突。
- **B-9 治理**：现在修 A1/FIX-1/FIX-3/FIX-4/OPT-2 与 #11/#12 §2.3 几乎零冲突（唯一 1 行交集是 OPT-1 改 ensureUser 内的时间戳，将来取消 ensureUser 时一并删掉，返工≈0）。

### 6.7 argon 自报「信息不足」（3 项）

① 001_init.sql 除 transactions/intake_log 外的其余行（users/categories/触发器？）——影响 B-4 隐藏约束判断；
② money.ts/errors.ts 完整源码——影响极端金额溢出边界判断；
③ 前端 mock 对 MAX_FOLLOWUP_ROUNDS 的实际预期——影响「满 3 轮」口径裁定。
**①② 已由 reviewer 本轮补齐（§3.5/§3.4/§4.7），③ 仍开放（本轮不动，等 #12）。**

---

## 7. reviewer 侧核验结论（观点区——完成任务 A 后再读）

核验环境：`C:/temp/gdufai-conflict` @ `pr9-gate` = `c288019`（#9 真实 head），工作区干净，node v24.18.0，探针跑完即删。
方法：不采信 argon 自述，逐条回一手文件/实跑核对。

### 7.1 对 argon 必改 5 项的裁决

| # | argon 断言 | 裁决 | 证据 |
|---|---|---|---|
| M1 | 标题缺代号、验收用代号 | **成立** | 【事实】草稿标题行 vs 验收段（§5 逐字比对）；本地文件全未推送，作者确实看不到代号定义 |
| M2 | A1 原修法表述有时区误杀陷阱 | **成立** | 【事实·实测】§4.1 两个陷阱复现；§4.2 argon 修法对 17 组样本行为正确 |
| M3① | 「0 行/首次写入」不总成立 | **成立** | 【事实·代码】:107-115 首轮 pending 写 intake_log；:135/:149 不拦 pending；【事实·实测】§4.6 残留 pending 行两次 500、round 恒 0 |
| M3② | 「批级回滚」表述错误 | **成立** | 【事实·代码】两句写在 processRecord（:246/:268），processBatch :291-295 逐条 map；只包两句 = 记录级 |
| M4 | §1.1 误引、sentAt 明写 +08:00 | **成立** | 【事实】契约 :25-30 无时区字眼、:63 明写；【事实·实测】§4.5 sentAt=Z 放行且兜底原样入库、occurred_date 跨日 |
| M5 | FIX-3 回填漏「贴测试名」 | **成立** | 【事实】草稿回填行 vs 验收数字段/正文补测试要求不一致 |

**补充（argon 没改到的一处连带句）**：坏路径图第 3 行「重发 findIntake 返回 null」在 pending 残留变体下也不准（返回的是 pending 行，round=1，仍走 confirmed 路径）。§8 E3 已把第 2–3 行一并替换。【事实·实测 §4.6】

### 7.2 对建议改 5 项的裁决

S1–S5 **全部建议采纳**：S1 兼容提示与 :104 读回点吻合（3 行降级读取，避免作者动 DDL）；S2 的按 id 查已核实（:183 `WHERE t.id = ?`）；S3 表头仅第 4 列「建议」已核实（:122）；S4 消除的真实歧义存在（禁止事项 #2 vs 合并顺序段）；S5 两条新发现已有本轮实测支撑（§4.3/§4.4），够格进「记录即可」。

### 7.3 对「推翻前序结论」4 项的复核

全部核实成立。特别地：
- **FIX-2 方向**：argon 与用户已登记决策（#12 §3.2）一致。注意决策权归属——这是 reviewer 本人的登记意见，不是 AI 共识的产物；DS 若有新证据只能标「待用户裁定」。
- **「严重度必须逐字一致」非契约原文**：前轮全文 grep 零命中，本轮契约摘录（§2）可再验证。此点无需再推导。

### 7.4 B-4 独立复核（OPT-2 是否升阻塞）

【事实·DDL 核对】001_init.sql 全文 109 行无触发器；intake_log 各列约束与 saveIntake 入参逐一匹配（§3.5）；ON CONFLICT :126 吸收 PK 冲突；transaction_id 无外键。
【推理】在 insertTransaction 已成功前提下，saveIntake 无业务输入触发的确定性抛错路径 ⇒ **同意 OPT-2 维持强烈建议非阻塞**。若 DS 主张升阻塞，必须给出反例路径（§9 任务 B4）。

### 7.5 本轮新发现（argon 未提）

- **N-a**【事实·实测 §4.2】：原 isIsoTime 连 `T24:00:00+08:00` 也接受（V8 滚动到次日）——A1 的滚动问题不止「日越界」。argon 修法的 hour≤23 检查顺带拦住它（是收益不是回归）。建议在 A1 改法句补一个分句（§8 X1）。
- **N-b**【事实·实测 §4.2】：argon 修法对 0000–0099 年误拒（`Date.UTC` 把 0–99 映射到 1900–1999；原实现接受这些年份）。可用 `u.setUTCFullYear(year)` 一行修正。演示场景无公元 0–99 年账单，**默认建议不进 review 正文**（避免噪音），DS 可裁（§8 X2）。
- **N-c**【事实·实测 §4.7】：金额无上限 → 1e17 元通过校验 → 1e19 分超 SQLite INTEGER max → better-sqlite3 静默存 REAL。**backlog 级，不进本 review**（触发需异常输入；且 review 禁止事项 #4 不动 money.ts）。

### 7.6 信息不足项补齐结果

argon ①② 已补齐（§3.4/§3.5/§4.7），B-4 结论在完整 DDL 下仍成立；③（前端 mock 轮次预期）仍开放，维持「本轮不动、等 #12」。

### 7.7 治理备注（不进 review，供用户参考）

- 「输入侧时区口径」**尚未登记进 #12**（只在本地 backlog）。review 改后写「等 #12 定稿」，用户宜在 #12 定稿时把该项一并登记（sentAt 部分已有实测偏离证据 §4.5）。
- 用户自己的克隆 `Desktop/2026gdufai` main 仍 `fd18dc9`（落后 origin/main 3）、契约还是 v1.0；**核行号一律用 origin/main 或临时克隆**，本轮全部核对基于后者。
- #11/#12 自留言后仍零回复（球在对方场上）；#10 需要一次基于当前 main 的新 CI 运行（推荐作者 rebase）。这些不影响本 review 提交。

---

## 8. 待 DS 裁决的修改清单（合并 argon 必改/建议改 + 本地补充）

> 每项给出：位置（§5 草稿中的原文锚点）→ 建议改法 → 依据。**DS 逐项裁决：同意 / 不同意 / 修改（给替代文本）**。
> 应用方式：reviewer 在草稿上执行字符串替换后提交；替换文本以本清单为准，不要凭记忆手抄。

### E1（=argon M1）四个标题补代号

- `### 🔴 阻塞 1（P0）非法日历日期被 V8 静默滚动，回显与落库不一致` → `### 🔴 阻塞 1（A1 · P0）非法日历日期被 V8 静默滚动，回显与落库不一致`
- `### 🔴 阻塞 2（P0）未来时间给了 24 小时宽限` → `### 🔴 阻塞 2（FIX-1 · P0）未来时间给了 24 小时宽限`
- `### 🟠 强烈建议本 PR 做：写路径原子性 + 唯一冲突转 duplicate` → `### 🟠 强烈建议本 PR 做（OPT-2）：写路径原子性 + 唯一冲突转 duplicate`
- `### 🟢 顺手修（两行）` → `### 🟢 顺手修（OPT-1 · 两行）`

依据：验收/禁止事项使用这些代号而作者看不到本地工单（§5、§6.2 M1）。FIX-3/FIX-4 标题已有代号，不动。

### E2（=argon M2 + 本地 X1）A1 改法句替换

原文：`**改法**：在 \`isIsoTime\` 里加**日历回环校验**——把解析出的年月日重新格式化并与输入比对，不等即非法（或等价地逐字段范围校验 + 月末日校验）。`

改成：

> **改法**：在 `isIsoTime` 里用正则提取字面量的 year/month/day（并校验时分秒与偏移量范围：hour≤23、minute/second≤59），再用 `new Date(Date.UTC(year, month - 1, day))` 检查 `getUTCFullYear()` / `getUTCMonth() + 1` / `getUTCDate()` 与输入字面量完全一致，不等即非法。⚠️ 不要用 `new Date(Date.parse(value)).toISOString().slice(0, 10)` 与输入直接比对——`Date.parse` 返回 UTC 时间戳，+08:00 每天 00:00–07:59 的合法时间会因转 UTC 跨日被全部误判为非法！hour 也必须 ≤23：实测 V8 接受 `T24:00:00` 并滚动到次日，与日越界同属静默滚动。

依据：§4.1 陷阱实测、§4.2 修法验证、N-a。补测试句（2026-02-31/04-31/2025-02-29 拒收、2024-02-29 通过）保留不动。

### E3（=argon M3 + 连带句）坏路径图第 2–3 行与第 1 半说明替换

原文（坏路径块内相邻两行）：

```
→ intake_log 该 key 0 行（注意：不是 pending，confirmed 路径下 saveIntake 是首次 intake 写入）
→ 重发 findIntake 返回 null → 永远走 confirmed 路径 → 再次 insertTransaction
```

改成：

```
→ intake_log 该 key 无 confirmed 行（首轮直通时为 0 行；首轮追问过时残留 pending_followup 行，followup_round 停在原值）
→ 重发 findIntake 返回 null 或 pending_followup（两种都不被拦截）→ 字段齐全时再走 confirmed 路径 → 再次 insertTransaction
```

原文：`1. \`db.transaction(() => { insertTransaction(...); saveIntake(...) })()\` —— 防新增中间态 + 批级回滚；`
改成：`1. \`db.transaction(() => { insertTransaction(...); saveIntake(...) })()\` —— 防新增单条中间态（这是记录级原子性；要批级回滚需包在 processBatch 外层）；`

依据：§4.6 实测（pending 残留变体两次 500、round 恒 0）、§3.1 :107-115/:135/:149/:291-295。

### E4（=argon M4 + 可选 X3）「本轮不要动」表「输入侧时区口径」行替换

原文：`| 输入侧时区口径 | \`validation.ts:5\` | \`ISO_PATTERN\` 接受 \`Z\`/任意偏移且原样入库；契约 §1.1 只写「带时区」，实现不算违反。需定「只收 +08:00」还是「收任意偏移并归一化」 |`

改成：

> | 输入侧时区口径 | `validation.ts:5` | `ISO_PATTERN` 接受 `Z`/任意偏移且原样入库；契约 §1.3 `:63` 要求批次 `sentAt`「ISO-8601 带 `+08:00`」，但 `:70/:71` 对记录 `occurredAt/chatAt` 仅写 ISO-8601。究竟统一只收 +08:00 还是收任意偏移后归一化，等 #12 定稿，本轮先不动 |

**X3（可选，DS 裁）**：是否在上行末尾再补一句实测锚点——「实测：sentAt 传 `…T20:00:00Z` 被放行，第 2 轮兜底时 Z 串原样入库且 occurred_date 跨日」。默认建议：加（让作者明白 sentAt 部分是真偏离、只是修法方向待定）。

依据：§2 契约 :25-30/:63/:70-71、§4.5 实测。

### E5（=argon M5）验收回填 FIX-3 行替换

原文：`FIX-3 已修（说明 last_codes 存储格式怎么改、旧数据是否兼容）`
改成：`FIX-3 已修 + 已补用例（贴测试名，并说明 last_codes 存储格式怎么改、旧数据是否兼容）`
依据：与「修后至少 54（各至少 1 例）」及 FIX-3 正文「补测试」一致。

### S1–S5（=argon 建议改，reviewer 已建议采纳，DS 复核）

- **S1**：FIX-3「改法」段末尾追加——「旧数据兼容可以只做 3 行：`findIntake` 解析 `last_codes` 时，数组元素是字符串就兜底转 `blocking(null, item)`，是对象就原样返回——不必改 `001_init.sql`。」
- **S2**：OPT-2「第 2 半的最小实现」段末尾追加——「注意现有 `getTransactionView`（`repository.ts:177`）按主键 `t.id` 查；捕获 `SQLITE_CONSTRAINT_UNIQUE` 时要按 `t.idempotency_key` 查出已有账单的 `id` 与视图（新增查询或改造），并补写 `saveIntake(status:'confirmed', codes:['DUPLICATE_RECORD'])`。」
- **S3**：FIX-2 段「补充两点事实」第 1 条中「§1.5 表头实际是「模块 1 **建议**话术（文案可改，语义别变）」。」改为——「§1.5 表头仅第 4 列是「建议话术」（前 3 列 code/触发条件/严重度仍是规范），且 `:133` 的 blocking 与 §1.4 `:110`「按成功处理…不要报错」直接自相矛盾。」
- **S4**：合并顺序段「——所以 #11 先合能避免你返工。」后追加——「**两步执行**：第一步（现在即可做）：严格按 v1.1 修完 A1 / FIX-1 / FIX-3 / FIX-4 / OPT-2 并推分支；第二步（等 #11 合入 main 后）：rebase 到最新 main，#12 §2.3 的 `DEMO_USER_ID` 校验是在本 PR 顺手补还是另开小 PR，我会在评论区通知你。」
- **S5**：「记录即可、演示期不修」段末尾追加两条——「批内 `recordId` 重复未校验（契约 `:65` 要求批次内唯一；实测同批两条同名 recordId 均 confirmed，结果对号被破坏）；同条记录同时缺 `amount` 与 `occurredAt` 时，首轮因 `MISSING_AMOUNT` 提前返回，次轮跳过 `MISSING_TIME` 追问直接按聊天时间兜底（实测轮 0 feedback 仅 MISSING_AMOUNT、轮 1 confirmed 带 TIME_DEFAULTED_TO_CHAT_TIME、time_source=chat_time）。」

### X1–X3（本地补充，DS 裁）

- **X1**（已并入 E2 文本）：A1 改法补「hour≤23 / T24:00:00 滚动」分句。默认建议：采纳。
- **X2**：是否在 E2 文本再加括号注「（若需接受 0–99 年，`Date.UTC` 会映射到 1900–1999，用 `setUTCFullYear(year)` 校正；演示场景不需要）」。默认建议：**不加**（噪音大于收益），仅记录在案。
- **X3**（见 E4）：时区行是否补实测锚点句。默认建议：加。

### 不改清单（与 argon 6.4 一致，DS 复核有无遗漏）

FIX-2 severity / isAmount*100 / MISSING_DIRECTION 分支与 classifier / candidates / v1.2 错误码 / MAX_FOLLOWUP_ROUNDS——本轮全部不动。
N-c（金额上限）进 backlog 不进 review。定级结构不变（2 阻塞 + 2 同批修 + OPT-2 强烈建议非阻塞 + OPT-1 顺手修）。

---

## 9. 任务

### 任务 A（独立推导；只允许用 §2–§5 材料，做完前不要读 §6–§8）

逐题作答，每条标【事实】/【推理】/【推测】+ 材料行号：

- **A1**：§5 草稿中 A1 的「改法」表述（日历回环校验）是否存在时区误判风险？若作者照字面实现，哪些合法输入会被误杀？给出与时区偏移解耦的正确修法（可附伪代码）。
- **A2**：OPT-2 坏路径中断言「intake_log 该 key 0 行 / saveIntake 是首次 intake 写入」是否总成立？穷举「insertTransaction 已提交、saveIntake 未执行」时 intake_log 的可能状态，并推导每种状态下重发的行为（提示：关注首轮追问是否已写库、:135/:149 拦截哪些状态、followup_round 会不会推进）。
- **A3**：在 processRecord 内用 db.transaction 包住 insertTransaction+saveIntake，能否实现「批级回滚」？为什么？
- **A4**：契约对 sentAt / occurredAt / chatAt 的时区要求分别是什么（逐字引用）？草稿「契约 §1.1 只写『带时区』，实现不算违反」是否准确？若不准确，应如何表述（注意：本轮是否要求作者改代码是另一个问题）？
- **A5**：草稿各节标题与「✅ 验收」「禁止事项」使用的代号是否对得上？FIX-3 回填行与验收数字段、FIX-3 正文是否一致？
- **A6**：草稿还有无其他事实错误、过头表述或漏项（限 v1.1 范围；「记录即可」段可补充的实测级发现也算）？

### 任务 B（对照裁决；读完 §6–§8 后执行）

- **B1**：对 §8 的 E1–E5 逐项裁决（同意/不同意/修改 + 理由），并核对 argon 必改清单有无「改错方向」或「漏改连带句」。
- **B2**：对 S1–S5 与 X1–X3 逐项裁决（采纳/不采纳/修改）。
- **B3**：复核 argon 的 4 项推翻（§6.5），尤其 FIX-2：注意「本轮不动」是 reviewer 在 #12 §3.2 的登记决策；若你有新证据，标「待用户裁定」，不要直接改写决策。
- **B4**：复核定级（§6.6 B-2）。若主张 OPT-2 升阻塞，必须给出 saveIntake 在业务输入下（非崩溃/非外部故障）的确定性抛错路径，并逐条反驳 §7.4 的 DDL 核对；否则维持非阻塞。
- **B5**：总裁决：**照发 / 改后发（Request changes）**。若改后发，输出最终必改清单（位置/原文/改成/理由），reviewer 将据此修改草稿并提交。

---

## 10. 禁止事项与决策权边界

1. **离线审议**：不联网、不执行命令、不读本文以外的文件；所有论断基于内嵌材料，材料外标「信息不足」。
2. **不要把「严重度必须逐字一致」当契约原文**——已证实出自审议提示词（20 号第 50 行），契约全文零命中。这是定案事实，不要重新推导。
3. **FIX-2 方向是用户登记决策**（#12 §3.2：契约改 warning、实现不动，本轮代码保持 warning）。AI 共识不能覆盖用户已登记意见；新证据只能标「待用户裁定」。
4. **不越界到 v1.2/#11**：不建议在本 PR 新增 4 个错误码、DEMO_USER_ID 校验、candidates、契约文档改动。
5. **不扩大必修面**：「记录即可」项与 backlog（N-c）不得升级为阻塞/必修；本轮不重构状态机、不改 MAX_FOLLOWUP_ROUNDS。
6. **不做平台动作**：不建议合并/Approve/改设置；本轮交付物只有裁决文本。提交 review 由 reviewer 执行（已获用户授权）。
7. **标注纪律**：每条论断标【事实】/【推理】/【推测】+ 文件名行号；引用原文逐字，不凭记忆转述。
8. **替换文本以 §8 为准**：不要手抄改写；若认为 §8 文本本身有问题，给出完整替代句。

---

## 11. 附录：复现环境与治理备注（reviewer 侧，DS 无需执行）

- 核验克隆：`C:/temp/gdufai-conflict` @ `pr9-gate` = `c288019`（#9 真实 head），工作区干净，探针已删，从未推送。
- node v24.18.0（≥22.18，原生 TS strip 可直接 import `.ts`）。行为探针骨架：

```js
import { buildApp } from './src/app.ts';
import { openDatabase } from './src/db/client.ts';
import { seedCategories } from './src/db/seed/categories.ts';
const config = { port:0, nodeEnv:'test', databasePath:':memory:', uploadDir:'./uploads', authToken:null };
const db = openDatabase(':memory:'); seedCategories(db);
const app = buildApp({ config, db });
// app.inject({method:'POST', url:'/api/transactions/import', payload:{version:1,batchId:'b',sentAt:'…+08:00',records:[…]}})
```

- 基线命令：`pnpm --filter @gduf/backend test` → 10 文件 50 例；`pnpm -r test` 含 frontend 2 文件 31 例。
- 本轮新实测脚本：`C:/temp/argon-pattern-check.mjs`（保留可复跑）；行为探针跑完即删（§4.3–4.7 输出已存档在本文）。
- 用户克隆 `Desktop/2026gdufai`：main `fd18dc9` 落后 origin/main 3，契约 v1.0（核行号用临时克隆或 origin/main）；两份日志草稿（SUMMARY/Tarnishedtaffy）仍待用户审阅后自行提交。
- 授权状态：**提交 Request changes 到 PR #9 已授权**（改完即发）；不合并、不 Approve、不动 #12 知悉复选框、不降 collaborator 权限。
- 后续治理（与本 review 并行，不阻塞提交）：输入侧时区口径宜登记进 #12；#10 需基于当前 main 的新 CI 运行；#11 四项 P1 与 #12 五项决议仍等作者/契约维护方回复。

（全文完）