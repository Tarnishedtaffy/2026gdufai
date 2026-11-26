# 模块 2 接口交接文档

> 适用对象：模块 1（语音/文字/图片记账）、模块 3（自然语言查账）、模块 4（预算提醒，同进程）
> 文档版本：v1.5（贷款利息类别 13、`settled_at` 结清标记、`repaymentPart` 入站字段、贷款还款口径 1D/2C）
> 冻结依据：contract-change issue #23（v1.5）；#21 为 v1.4 退款三态基线
> 维护人：模块 2 负责人
> 状态：接口定义已冻结；服务端实现按本文档开发中，联调前以本文档为准

---

## 0. 一分钟看懂边界

| 模块 | 负责 | 不负责 |
|---|---|---|
| 模块 1 | 语音转文字、OCR、字段抽取、把结果组装成批次 JSON、把反馈转成用户话术 | 分类、入库、去重、追问轮次管理 |
| 模块 2（本文档） | 校验、分类、入库、追问状态机、统计、账单一览、类别管理 | 自然语言解析、话术生成、UI |
| 模块 3 | 把「上个月吃饭花了多少」解析成结构化查询参数、把结果组织成回答 | 任何金额聚合、时间换算、分类判断 |
| 模块 4 | 预算 CRUD、超支判断、通知 | 账单入库、统计口径 |

一句话：**模块 1 只给字段，模块 2 只给事实，模块 3 只负责说人话。**

## 0.1 用户与鉴权（v1.2 新增）

- 本期为**单用户演示**：服务端使用固定用户 `DEMO_USER_ID`（环境变量，默认 `u_001`）。
- 入站记录的 `userId` 必须等于 `DEMO_USER_ID`，否则整批返回 `INVALID_BATCH`（`field: records[i].userId`）。
- 读接口（统计、账单一览）不接受 `userId` 参数，统一读取 `DEMO_USER_ID`。
- 鉴权：`APP_AUTH_TOKEN` **为空或等于占位值 `change-me`** 时视为未配置，按开发模式放行；否则所有 `/api/*` 请求必须携带 `Authorization: Bearer <token>`，缺失或不匹配返回 `UNAUTHORIZED`。**生产部署必须设置非占位值 token。**
- 用户数据只存 `users(id, nickname, timezone, currency, created_at)`；`nickname` 默认等于 `userId`，**不存密码、邮箱、手机号等个人信息**。


---

## 1. 模块 1 → 模块 2：批次 JSON

### 1.1 传输方式

- 一个批次一个 JSON 文件（或一次 HTTP POST），**仅支持批量包装**（`records` 数组，一个批次可含多条记录）。
- 推荐接口：`POST /api/transactions/import`，`Content-Type: application/json`。
- 处理结果逐条返回（见 1.4）。

### 1.2 批次结构

```jsonc
{
  "version": 1,
  "batchId": "b_20261115_001",
  "sentAt": "2026-11-15T21:00:00+08:00",
  "records": [
    {
      "recordId": "r_001",
      "userId": "u_001",
      "direction": null,
      "amount": 32.5,
      "merchant": null,
      "occurredAt": "2026-11-14T09:12:00+08:00",
      "chatAt": null,
      "originalTransactionId": null,
      "rawText": "早上瑞幸花了32块5",
      "modality": "text",
      "sourceRef": null,
      "confidence": 0.9,
      "idempotencyKey": "msg_8821"
    }
  ]
}
```

### 1.3 字段说明

| 字段 | 层级 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `version` | 批次 | 是 | number | 固定 `1` |
| `batchId` | 批次 | 是 | string | 模块 1 生成，结果回写对号用 |
| `sentAt` | 批次 | **是** | string | **用户发消息的时刻**（聊天时间），ISO-8601 带 `+08:00`。时间兜底规则依赖它，缺失整批拒收 |
| `records` | 批次 | 是 | array | 非空 |
| `recordId` | 记录 | 是 | string | 模块 1 生成，批次内唯一 |
| `userId` | 记录 | 是 | string | 当前用户 |
| `direction` | 记录 | 否 | `"expense"` \| `"income"` \| `null` | 判断不了就传 `null`，**不要猜** |
| `amount` | 记录 | 否 | number \| `null` | **单位：元**，最多两位小数；识别不出传 `null`，**不要传 0**。若传入 0 或负数，按缺失处理并返回 `MISSING_AMOUNT` |
| `merchant` | 记录 | 否 | string \| `null` | 缺失传 `null`，不要传 `"未知"` |
| `occurredAt` | 记录 | 否 | string \| `null` | 消费发生时间，ISO-8601；日期明确但时间不明可传当天 `T12:00:00+08:00`。**必须是真实存在的日历日期**（如 `2026-02-31` 非法），越界或非法日期整批 `INVALID_BATCH`（`field: records[i].occurredAt`） |
| `chatAt` | 记录 | 否 | string \| `null` | 该条消息本身发出的时刻；不传则用批次 `sentAt` 兜底 |
| `originalTransactionId` | 记录 | 否 | string \| `null` | 退款/还款场景下由模块 1 带回的原账单 id；普通记账传 `null` |
| `rawText` | 记录 | 是 | string | 原始输入文本（语音转写结果也算） |
| `modality` | 记录 | 是 | `"text"` \| `"voice"` \| `"image"` | 输入形态 |
| `sourceRef` | 记录 | 否 | string \| `null` | 语音/图片文件路径，**不要把文件内容 base64 塞进 JSON** |
| `confidence` | 记录 | 否 | number 0–1 \| `null` | 模块 1 对整条抽取的置信度，仅作参考 |
| `idempotencyKey` | 记录 | 是 | string | **同一笔重发必须相同**，模块 2 据此去重 |
| `repaymentPart` | 记录 | 否 | `"principal"` \| `"interest"` \| `"mixed"` \| `null` | 贷款还款的本金/利息属性，仅作提示；`interest` 表示纯利息支付，不进入中性还款流程；不传时按关键词兜底 |
| `principalCents` | 记录 | 否 | integer ≥ 0 \| `null` | 本次还款中的本金（分）；与 `interestCents` 之和必须等于 `yuanToCents(amount)` |
| `interestCents` | 记录 | 否 | integer ≥ 0 \| `null` | 本次还款中的利息（分）；只生成类别 13 的支出，不参与剩余本金计算 |

> **还款拆分字段校验**：
>
> - `mixed` 时 `principalCents` / `interestCents` 必填，且 `principalCents + interestCents === yuanToCents(amount)`；
> - `repaymentPart='interest'` 时 `principalCents` 为空或 `0`；`repaymentPart='principal'` 时 `interestCents` 为空或 `0`；
> - 只给 `principalCents` 与 `interestCents`、未给 `repaymentPart` 时按 `mixed` 处理；
> - 只给一个分字段时，`amount` 必须等于该字段；
> - `mixed` 且 `amount=null` → `INVALID_BATCH`（`field: records[i].amount`）；
> - 普通消费/退款传这些字段 → `INVALID_BATCH`（`field: records[i].principalCents`）；
> - `principalCents > outstandingCents` → `INVALID_BATCH`（`field: records[i].principalCents`）；
> - 显式字段与文本冲突时以显式字段为准。
>
> **本金规范化与落库**：
>
> ```text
> effectivePrincipalCents =
>   principalCents                     // 显式给出
>   interest 且未给本金时 0             // 纯利息，不写中性还款记录
>   未拆分但按还款处理时 yuanToCents(amount)
> ```
>
> 落库 `principal_cents = effectivePrincipalCents`，**不得因客户端省略字段而写 `NULL`**；`mixed` 缺任一项直接拒绝，不自动猜。

> **关于 `direction` 可以传 `null`**：`null` 只出现在**入站**，含义是「模块 1 没有判定」，不是脏数据。模块 2 收到后按优先级解析：类别能识别就用类别 kind 推断；类别也识别不出时兜底到「其他」并按 `expense` 推断。`MISSING_DIRECTION` 保留但当前不可达（见 §1.5），因此 **`transactions.direction` 是非空字段，入库前方向必然已经确定**，不存在把 `null` 写进库的路径。
>
> 不让模块 1 强制填写方向，是因为它只能靠猜：猜错会直接污染预算与统计（支出一旦记成收入，当月超支判断就失效），而传 `null` 最多触发一次推断或追问，代价小得多。

### 1.4 结果格式

模块 2 返回（HTTP 响应体，或与输入同名的 `.result.json`）：

```jsonc
{
  "batchId": "b_20261115_001",
  "results": [
    {
      "recordId": "r_001",
      "status": "confirmed",
      "transactionId": "tx_01J9Z8Q3K7",
      "matchedTransactionId": null,
      "direction": "expense",
      "occurredAt": "2026-11-14T09:12:00+08:00",
      "category": { "id": 1, "name": "餐饮", "kind": "expense" },
      "confidence": 0.92,
      "feedback": []
    }
  ]
}
```

`matchedTransactionId`：匹配到的原账单 id；未匹配或普通记账为 `null`。

`interestTransactionId`：本次还款产生的利息记录 id；无利息为 `null`。

`status` 四种取值：

| status | 含义 | 模块 1 该做什么 |
|---|---|---|
| `confirmed` | 已入库 | 展示成功；`feedback` 里的 warning 可以转成轻提示 |
| `pending_followup` | 未入库，信息不全 | **按 `feedback` 逐项追问用户**，拿到答案后原样重发同一条记录（同 `idempotencyKey`） |
| `duplicate` | 重复提交 | 按成功处理，直接用返回的 `transactionId`，**不要报错** |
| `rejected` | 放弃处理 | 提示用户手动补录或稍后重试 |

### 1.5 反馈码（`feedback[]`）

```jsonc
"feedback": [
  { "field": "amount", "code": "MISSING_AMOUNT", "severity": "blocking" },
  { "field": "merchant", "code": "MERCHANT_DEFAULTED", "severity": "warning" },
  { "field": "category", "code": "LOW_CONFIDENCE_CATEGORY", "severity": "warning",
    "candidates": [ { "id": 1, "name": "餐饮" }, { "id": 3, "name": "购物" } ] }
]
```

> `candidates` 为可选字段，最多 3 个，仅 `LOW_CONFIDENCE_CATEGORY` 携带；其余码不需要。

| code | 触发条件 | 严重度 | 模块 1 建议话术（文案可改，语义别变） |
|---|---|---|---|
| `MISSING_AMOUNT` | 金额空/0/负 | blocking | 「这笔大概花了多少钱？」 |
| `MISSING_TIME` | 时间缺失（首轮） | blocking | 「这是哪天的消费？」 |
| `FUTURE_TIME` | 时间超过当前时间 **5 分钟**（容忍时钟偏差，首轮） | blocking | 「这个时间是未来的，是不是记错了？」 |
| `MISSING_DIRECTION` | 方向和类别都判不出 | blocking | 「这笔是支出还是收入？」 |
| `CATEGORY_KIND_MISMATCH` | 方向与类别冲突（首轮） | blocking | 「你说是支出，但类别是工资，以哪个为准？」 |
| `LOW_CONFIDENCE_CATEGORY` | 分类置信度 < 0.75 | warning | 「我把它归到了其他，可以帮我选个类别吗？」（附 `candidates`） |
| `MERCHANT_DEFAULTED` | 商户缺失 | warning | 「商户我填了未知账号，要补吗？」 |
| `TIME_DEFAULTED_TO_CHAT_TIME` | 时间追问不清，已回退聊天时间 | warning | 「时间我按你发消息的时间记了」 |
| `DIRECTION_FORCED_BY_CATEGORY` | 冲突二次以类别为准 | warning | 「按类别记成了收入」 |
| `DUPLICATE_RECORD` | 幂等键重复 | warning | 「这笔已经记过了」 |
| `MISSING_ORIGINAL_TRANSACTION` | 退款/还款但缺少原账单 id（首轮） | blocking | 「这笔退款对应哪一笔账单？请从账单列表重新选择原账单（originalTransactionId）」 |
| `ORIGINAL_NOT_FOUND` | 带了原账单 id 但不存在、已作废或非 normal（首轮） | blocking | 「没找到这笔原账单，请从账单列表重新选择」 |
| `REFUND_RECORDED_NEUTRAL` | 退款已记录为中性，匹配到原账单 | warning | 「已记录为中性，不计入收支；原账单已自动作废」 |
| `REPAYMENT_RECORDED_NEUTRAL` | 还款已记录为中性，匹配到原账单 | warning | 「已记录为中性，不计入收支；原贷款已标记结清（settled_at）」 |
| `ORIGINAL_NOT_FOUND_RECORDED` | 未匹配到原账单，已归入「其他/其他收入」 | warning | 「没找到原账单，已记为其他且不计收支」 |
| `ORIGINAL_AMOUNT_ADJUSTED` | 退款金额小于原账单，已把原账单金额改为剩余金额（v1.5 仅退款；v1.4 历史还款也使用） | warning | 「已按差额调整原账单金额」 |
| `REFUND_EXCESS_AS_INCOME` | 退款金额大于原账单，多余部分已计入收入 | warning | 「超出原账单的部分已计入收入」 |
| `REPAYMENT_EXCESS_AS_EXPENSE` | **deprecated**：v1.5 起还款本金超额返回 `INVALID_BATCH`；该码仅解释 v1.4 历史回执 | warning | 「超出贷款本金的部分已计入支出」 |
| `ORIGINAL_TRANSACTION_AGED` | 原账单距今超过 365 天，仍匹配成功 | warning | 「这笔原账单较早，请确认」 |
| `PARTIAL_REPAYMENT_RECORDED` | 贷款部分还款，尚未结清 | warning | 「已记录本次还款，贷款尚未结清」 |
| `AMBIGUOUS_LOAN_PAYMENT` | 本金/利息无法区分 | blocking | 「这笔是还本金还是还利息？」 |
| `ORIGINAL_ALREADY_SETTLED` | 原贷款已结清 | blocking | 「这笔贷款已结清，无需再还款」 |

> `MISSING_DIRECTION`：兜底到「其他」视为类别识别成功，**不返回该码**；该码保留但当前不可达，存废由 issue #12 决议。
>
> 中性记录的方向固定：退款为 `income`、还款为 `expense`；`direction_source` 记 `category`（方向由 `entry_type` 推导，不取原账单方向）。

### 1.6 追问轮次怎么算

- 追问轮次由模块 2 用 `idempotencyKey` 维护（存数据库），**模块 1 不需要传轮次**。
- 同一笔重发时：`idempotencyKey` 不变，已确认的字段填上，**未确认的字段继续传 `null`**。
- 第 2 轮起，如果时间仍为空或在未来，模块 2 会用 `chatAt`（或批次 `sentAt`）兜底入库，并回 `TIME_DEFAULTED_TO_CHAT_TIME`。
- 同一笔最多追问 **2 次**：第 1、2 次提交返回 `pending_followup`；第 3 次提交仍无法解决时返回 `rejected`，模块 1 提示用户手动补录。轮次由模块 2 按幂等键维护。
- 幂等重发时，`feedback` **按原样返回**（保留 `field`、`severity` 与 `candidates`），不得只回 `code`；模块 2 需在 `intake_log` 中保存完整 feedback 对象。
- 派生记录使用独立幂等键：中性本金记录用 `${idempotencyKey}`，利息记录用 `${idempotencyKey}#interest`，退款超额记录用 `${idempotencyKey}#excess`。重发按主幂等键返回 `duplicate`，并回显 `interestTransactionId`。

### 1.7 模块 1 必须守的三条

1. **空就是 `null`**，不要用 `0`、`""`、`"未知"` 填充——模块 2 靠 `null` 判断「缺失」，填了假值会被当成真实数据。
2. **金额传元、不要传分**，也不要自己四舍五入到整数。
3. **重发必带原 `idempotencyKey`**，否则同一笔会被记两次；模块 2 无法替你纠正。

### 1.8 原账单匹配（1D）

退款/还款只接受显式 `originalTransactionId`，**不做**按金额/日期的自动匹配，也不设固定时间上限。匹配规则：

- 原账单 `occurredAt` 在未来（`Date.parse(original.occurredAt) > now`）→ 按 `ORIGINAL_NOT_FOUND` 处理；
- 原账单距今超过 365 天：warning `ORIGINAL_TRANSACTION_AGED`，仍允许继续；
- 按 id 查询保留「已结清」信息，不因 `settled_at` 非空而隐藏：
  - 存在但已结清 → `ORIGINAL_ALREADY_SETTLED`（blocking）；
  - 不存在、跨用户或已作废 → `ORIGINAL_NOT_FOUND`（blocking）；
  - 已结清与「不存在/跨用户/已作废」必须区分，不能合并成 `ORIGINAL_NOT_FOUND`。

---

## 2. 模块 3 → 模块 2：查询调用

### 2.1 原则

模块 3 **只做两件事**：把用户问题解析成参数、把返回结果转成话术。**不要自己算金额、不要自己推时间范围、不要自己分类。**

### 2.2 统计查询 `GET /api/stats`

| 参数 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `dimension` | 是 | `day` \| `month` \| `year` \| `recent7` | 时间维度 |
| `date` | dimension=day 时必填 | `YYYY-MM-DD` | 精确到某天 |
| `month` | dimension=month 时必填 | `YYYY-MM` | 精确到某月 |
| `year` | dimension=year 时必填 | `YYYY` | 精确到某年 |
| `breakdownBy` | 否 | `category` | 同时按类别拆分 |
| `direction` | 否 | `all`（默认）\| `expense` \| `income` | 收支过滤 |
| `categoryIds` | 否 | `1,2` | 限定类别 |
| `order` | 否 | `asc` \| `desc` | 桶/类别的排序方向 |

- `dimension=recent7` **不接受** `date/month/year`，固定 `[今天-6, 今天]`，固定 7 个日桶（空日补 0）。
- 精确模式（day/month/year）返回 **1 个桶**，`summary` 与 `buckets[0]` 数值相同。
- **统计只包含 `entry_type='normal'` 的记录**：退款/还款等中性记录会保留，但不计入 `expenseCents / incomeCents / netCents / count`。

响应：

```jsonc
{
  "dimension": "month",
  "range": { "start": "2026-11-01", "end": "2026-11-30" },
  "direction": "all",
  "summary": {
    "expenseCents": 268400,
    "incomeCents": 800000,
    "netCents": 531600,
    "count": 23,
    "topCategory": { "categoryId": 1, "name": "餐饮", "totalCents": 98000, "ratio": 0.365 }
  },
  "buckets": [
    {
      "period": "2026-11",
      "expenseCents": 268400,
      "incomeCents": 800000,
      "netCents": 531600,
      "count": 23,
      "categories": [
        { "categoryId": 1, "name": "餐饮", "kind": "expense", "custom": false,
          "color": "#F97316", "totalCents": 98000, "count": 11, "ratio": 0.365 }
      ]
    }
  ],
  "meta": {
    "unit": "cent",
    "basis": { "dateField": "occurred_date", "timezone": "Asia/Shanghai", "includeVoid": false },
    "generatedAt": "2026-11-15T22:10:00+08:00",
    "isEmpty": false
  }
}
```

模块 3 使用约定：

- **金额字段全部是「分」**（`meta.unit = "cent"`），展示前除以 100。
- `netCents = incomeCents - expenseCents`，可为负，**不要叫「余额」**。
- `netCents` 是「**项目收支净额（排除中性本金还款）**」，不等于现金流，也不等于损益；贷款本金仍记收入，真正的现金流/负债模型留给后续 `loans` 维度。
- `ratio` 分母是**同方向**合计：支出类别 ÷ `expenseCents`，收入类别 ÷ `incomeCents`。
- `meta.isEmpty = true` 时回答「这个月还没有记录」，而不是「花了 0 元」。`meta.isEmpty` 依据**区间内是否有任何记录（含中性记录）**，并跟随 `direction` / `categoryIds` 筛选；它不等同于 `summary.count === 0`。`meta.isEmpty` 只表示**区间内没有任何记录**（含退款/还款中性记录），因此可能与 `summary.count = 0` 同时出现「有记录但无收支」的情况。
- 想回答「哪类花得最多」，直接读 `summary.topCategory`，不要遍历 `buckets` 自己排。

### 2.3 账单一览 `GET /api/transactions`

| 参数 | 说明 |
|---|---|
| `categoryId` | 按类别筛选 |
| `from` / `to` | `YYYY-MM-DD`，闭区间 |
| `direction` | `expense` \| `income`，默认全部 |
| `limit` | 默认 20，上限 100 |
| `entryType` | 默认 `normal`；可选 `all`（含退款/还款中性记录）、`refund`、`repayment` |
| `cursor` | 上一页返回的 `nextCursor`，首页不传 |

```jsonc
{
  "filter": { "categoryId": 1, "from": "2026-11-01", "to": "2026-11-30", "direction": "expense", "entryType": "normal" },
  "summary": { "count": 23, "expenseCents": 98000, "incomeCents": 0 },
  "items": [
    { "id": "tx_...", "amountCents": 3250, "merchant": "瑞幸咖啡",
      "occurredAt": "2026-11-14T12:30:00+08:00", "occurredDate": "2026-11-14",
      "direction": "expense",
      "category": { "id": 1, "name": "餐饮", "color": "#F97316", "icon": "🍜" },
      "sourceModality": "image", "sourceRef": "uploads/2026/11/r.jpg",
      "entryType": "normal", "settledAt": null,
      "categoryConfidence": 0.92, "status": "confirmed", "anomalyFlag": false }
  ],
  "page": { "limit": 20, "hasMore": true, "nextCursor": "eyJkIjoiMjAyNi0xMS0xNCIsImlkIjoidHhfLi4uIn0" },
  "meta": { "unit": "cent", "isEmpty": false }
}
```

- `summary` 是**整个筛选集**的合计，不是本页；
- `summary` **恒只统计 `entry_type='normal'` 且满足 `entryType` 筛选**的记录，中性记录只出现在 `items` 中；因此 `entryType=all` 或 `entryType=refund` 时，`summary.count` 可能与 `items` 条数不一致，金额字段也不含中性记录。
- 游标分页：把 `nextCursor` 原样回传，不要自己拼 `offset`。

### 2.4 类别字典 `GET /api/categories`

```jsonc
[ { "id": 1, "name": "餐饮", "kind": "expense", "isPreset": true,
    "color": "#F97316", "icon": "🍜", "isActive": true } ]
```

模块 3 解析「吃饭」「打车」时用这张表的 `name` 和 `id` 做映射，**不要在前端或话术里硬编码 ID**。

### 2.5 预算状态 `GET /api/budgets?month=2026-11`（模块 4 提供）

```jsonc
[ { "id": 1, "scope": "total", "category": null, "amountCents": 300000,
    "spentCents": 268400, "remainingCents": 31600, "usageRatio": 0.895, "level": "near",
    "alertThresholds": [80, 100] } ]
```

- `level`：`normal` / `near`（≥80%）/ `over`（≥100%）；
- `category` 统一为 `{ "id": 1, "name": "餐饮" }` 或 `null`；`scope=total` 时必为 `null`，且不返回 `kind`/`color`/`icon`；
- `spentCents` 只统计 `direction='expense'`、`entry_type='normal'`、`status='confirmed'` 的账单，按 `occurred_date` 的 `Asia/Shanghai` 自然月聚合；
- `remainingCents = amountCents - spentCents`，允许为负；
- `alertThresholds` 为该预算已保存的阈值，去重升序；空数组表示关闭该预算的提醒；该字段随 `GET`/`PUT` 返回，便于前端回显。

### 2.6 错误格式

```jsonc
{ "error": { "code": "INVALID_DIMENSION_PARAM", "message": "dimension=day 需要 date 参数", "field": "date" } }
```

| code | HTTP | 场景 |
|---|---|---|
| `INVALID_BATCH` | 400 | 批次缺必填字段 |
| `INVALID_DIMENSION_PARAM` | 422 | dimension 与参数不匹配 |
| `INVALID_QUERY_PARAM` | 422 | 查询参数非法（分页、筛选、游标等） |
| `CATEGORY_NOT_FOUND` | 404 | 类别不存在 |
| `CATEGORY_IN_USE` | 409 | 删除有数据的类别，返回 `counts` |
| `TRANSACTION_NOT_FOUND` | 404 | 账单不存在，`field` 为 `id` |
| `CATEGORY_NAME_TAKEN` | 409 | 同一 `kind` 下类别重名 |
| `CATEGORY_PRESET_PROTECTED` | 403 | 尝试删除或迁移预设类别 |
| `CATEGORY_KIND_MISMATCH` | 409 | 迁移类别（`reassign`）时，目标类别 `kind` 与账单 `direction` 不一致 |
| `BUDGET_NOT_FOUND` | 404 | 预算不存在 |
| `BUDGET_CONFLICT` | 409 | 迁移预算时目标类别同月已有预算，`details` 返回冲突双方预算 id |
| `UNAUTHORIZED` | 401 | 缺少/错误的鉴权头 |
| `INTERNAL_ERROR` | 500 | 未捕获异常，返回通用错误信息 |

> 错误响应可选携带 `details` 字段承载结构化附加信息，例如 `CATEGORY_IN_USE` 的 `counts`：
>
> ```jsonc
> { "error": { "code": "CATEGORY_IN_USE", "message": "该类别下还有 12 笔账单", "field": "categoryId",
>              "details": { "counts": { "transactions": 12, "budgets": 1, "rules": 3 } } } }
> ```

> `CATEGORY_KIND_MISMATCH` 同时存在于 §1.5（记录级反馈码，`blocking`）与本节（接口级错误码，409），二者分层独立，**不得互相替代**：入站冲突仍按 §1.5 返回反馈码，不得直接抛 409。

---

## 2.7 类别管理

| 方法 | 路径 | 成功码 | 说明 |
|---|---|---|---|
| POST | `/api/categories` | 201 | 创建自定义类别 |
| PATCH | `/api/categories/:id` | 200 | 改名 / 颜色 / 图标 / 关键词 / 停用 |
| DELETE | `/api/categories/:id` | 204 | 删除自定义类别（无响应体） |
| POST | `/api/categories/:id/reassign` | 200 | 批量迁移账单、预算与学习规则到目标类别 |

```jsonc
// 创建（ID 12/13 已被「贷款」「贷款利息」占用，自定义类别从 14 起自增）
POST /api/categories
{ "name": "宠物", "kind": "expense", "color": "#0EA5E9", "icon": "🐱",
  "keywords": ["狗粮", "猫粮"], "sortOrder": 20 }
→ 201 { "id": 14, "name": "宠物", "kind": "expense", "color": "#0EA5E9",
        "icon": "🐱", "isPreset": false, "isActive": true }

// 修改：kind 创建后不可变，传 kind 返回 422
PATCH /api/categories/14
{ "name": "宠物开销", "color": "#0284C7", "isActive": false }
→ 200 { "id": 14, "name": "宠物开销", "kind": "expense", "color": "#0284C7",
        "icon": "🐱", "isPreset": false, "isActive": false }

// 删除：成功 204 无响应体；有引用返回 409
DELETE /api/categories/14
→ 204
→ 409 { "error": { "code": "CATEGORY_IN_USE", "message": "类别下还有账单", "field": "categoryId",
                    "details": { "counts": { "transactions": 10, "budgets": 1, "rules": 3 } } } }

// 迁移：账单、预算、学习规则一起迁到目标类别
POST /api/categories/14/reassign
{ "targetCategoryId": 5 }
→ 200 { "targetCategoryId": 5, "movedTransactions": 12, "movedBudgets": 1, "movedRules": 3 }
```

规则：

- 预设类别（`isPreset=true`）只能停用，删除或作为 `POST /reassign` 的源均返回 `403 CATEGORY_PRESET_PROTECTED`；
- 同一 `kind` 下类别名唯一，重名返回 `409 CATEGORY_NAME_TAKEN`；
- `PATCH` 不允许修改 `kind`：`kind` 创建后不可变，传入返回 `422 INVALID_QUERY_PARAM`（`field: kind`）；
- 删除前统计三类引用：`counts.transactions` **包含 `status='void'` 的已作废账单**（作废只改状态，仍保留 `category_id` 引用）；`counts.budgets`、`counts.rules` 同样统计全部引用；
- 仅当 `transactions`、`budgets`、`rules` 三项计数**全部为 0** 时才允许删除；否则返回 `409 CATEGORY_IN_USE` 并带 `counts`；
- `rules > 0` 同样返回 `409 CATEGORY_IN_USE`；只有 `POST /reassign` 会迁移学习规则，删除不会清理规则；
- `POST /reassign` 同时迁移 `transactions`（含已作废账单）、`budgets`、`user_category_rules`；
- 迁移学习规则时，若目标类别已有同 `(user_id, pattern)` 规则，**保留目标规则并删除源规则**，`hit_count` 合并到目标规则，不返回冲突；
- `reassign` 的目标类别必须存在且 `isActive=true`，不存在返回 `404 CATEGORY_NOT_FOUND`，已停用返回 `422 INVALID_QUERY_PARAM`；
- 迁移时若目标类别在同一月份已有预算，返回 `409 BUDGET_CONFLICT`，`details` 给出 `{ sourceBudgetId, targetBudgetId, month }`，**不做静默合并**；
- `reassign` 的 `targetCategoryId` 的 `kind` 必须与账单 `direction` 一致，否则返回 `409 CATEGORY_KIND_MISMATCH`；
- `reassign` 的校验与三类更新（`transactions`、`budgets`、`user_category_rules`）在**同一个数据库事务**内执行；目标类别不存在、`kind` 冲突或预算冲突任一项失败时**整体回滚**，不允许出现部分迁移；
- 停用类别（`isActive=false`）不再参与自动分类，历史账单仍正常展示；
- 自定义类别与预设类别一样参与自动分类，`kind` 只能为 `expense` / `income`。

## 2.8 预算写入

| 方法 | 路径 | 成功码 | 说明 |
|---|---|---|---|
| PUT | `/api/budgets` | 200 | 新增或修改月度预算（幂等覆盖） |
| DELETE | `/api/budgets/:id` | 204 | 删除预算（无响应体） |

```jsonc
PUT /api/budgets
{ "month": "2026-11", "scope": "category", "categoryId": 1,
  "amountCents": 100000, "alertThresholds": [80, 100] }
→ 200 { "id": 7, "scope": "category", "category": { "id": 1, "name": "餐饮" },
        "amountCents": 100000, "spentCents": 98000, "remainingCents": 2000,
        "usageRatio": 0.98, "level": "near", "alertThresholds": [80, 100] }

DELETE /api/budgets/7
→ 204
```

规则：

- `GET` / `PUT` 的响应顶层都包含上例全部字段，`id` 供 `DELETE` 使用；
- `scope=total` 时 `categoryId` 必须为 `null`；`scope=category` 必须提供 `categoryId`，否则 `422 INVALID_QUERY_PARAM`；
- `scope=category` 时目标类别必须存在且 `kind='expense'`；不存在返回 `404 CATEGORY_NOT_FOUND`，收入类别返回 `422 INVALID_QUERY_PARAM`（`field: categoryId`）；
- `amountCents` 必须是**正整数**（单位分，且 > 0），非法返回 `422 INVALID_QUERY_PARAM`（`field: amountCents`）；
- `alertThresholds` 为 **1–200 的整数数组**，去重后升序存储，最多 5 个，缺省 `[80, 100]`；**空数组表示关闭该预算的提醒**（不写入任何告警）；越界、非整数或超过 5 个返回 `422 INVALID_QUERY_PARAM`（`field: alertThresholds`）。该范围与 `budget_alerts.threshold` 的 `CHECK (BETWEEN 1 AND 200)` 保持一致；
- 同一 `(month, scope, categoryId)` 幂等覆盖，不产生重复预算，响应始终包含预算 `id`，供 `DELETE /api/budgets/:id` 使用；
- 删除不存在的预算返回 `404 BUDGET_NOT_FOUND`；删除成功返回 `204` 无响应体；
- 预算读写接口不使用 `409`；`BUDGET_CONFLICT` 只用于类别迁移（§2.7）的目标同月预算冲突；
- 本期不提供告警查询端点；告警由 `PUT /api/budgets` 触发；M2 账单写操作接入（#38）后，由 `recalcBudgetForTransaction` / `recalcBudgetsForMonth` 在账单写入/变更后触发，写入 `budget_alerts` 供后续通知模块消费。

## 2.9 账单纠错

| 方法 | 路径 | 说明 |
|---|---|---|
| PATCH | `/api/transactions/:id` | 修改分类 / 金额 / 商户 / 时间 |
| POST | `/api/transactions/:id/void` | 软作废（统计与预算排除） |

```jsonc
PATCH /api/transactions/tx_xxx
{ "categoryId": 3, "amountCents": 2500, "merchant": "某商户",
  "occurredAt": "2026-11-14T12:00:00+08:00" }
→ 200 { "id": "tx_xxx", "direction": "expense", "amountCents": 2500, "merchant": "某商户",
        "occurredAt": "2026-11-14T12:00:00+08:00", "status": "confirmed",
        "category": { "id": 3, "name": "购物" } }

POST /api/transactions/tx_xxx/void
{ "reason": "退款" }
→ 200 { "id": "tx_xxx", "status": "void" }
```

字段与校验：

| 字段 | 规则 |
|---|---|
| `categoryId` | 必须存在，否则 `404 CATEGORY_NOT_FOUND`；允许改到另一侧 `kind`，此时按副作用翻转 `direction` 并重算预算 |
| `amountCents` | 正整数（`> 0`），否则 `422 INVALID_QUERY_PARAM`（`field: amountCents`） |
| `merchant` | 非空字符串，最长 100 字符；传 `null` 或空串返回 `422 INVALID_QUERY_PARAM`（不允许清空） |
| `occurredAt` | 必须是真实日历日期且带时区偏移，否则 `422 INVALID_QUERY_PARAM`（`field: occurredAt`） |

规则：

- PATCH 请求体必须是普通对象，且至少包含 `categoryId` / `amountCents` / `merchant` / `occurredAt` 之一，否则 `422 INVALID_QUERY_PARAM`（`field: body`）；
- 仅 `status='confirmed'` 的账单可修改；已作废账单返回 `422 INVALID_QUERY_PARAM`（`field: status`）；
- 中性记录（`entry_type != 'normal'`，含 `refund` / `repayment`）不允许 PATCH 或 void，返回 `422 INVALID_QUERY_PARAM`（`field: entryType`）；中性 `repayment` 的撤销由 PR-C 承载（PR-C 落地后允许作废，重算原贷款 `settled_at`，并作废 `${idempotencyKey}#interest` 记录），本端点届时扩展；
- 校验顺序：先判 `entry_type`，再判 `status`；两者同时命中时返回 `field: entryType`；
- 作废原贷款：关联还款与利息记录保留，但不再参与剩余本金计算；
- `void` 幂等：重复调用返回 `200` 与当前 `status='void'`，不重复写入学习规则；
- `occurredAt` 目前允许未来时间是有意为之（与导入路径的 `FUTURE_TIME` 校验区分），便于用户补录计划内账单；
- 修改分类时写入 `user_category_rules`（下次同商户自动命中）；只有类别实际变化时才写入并递增 `hit_count`，同时把 `category_source` 置为 `manual`、`category_confidence` 置为 `NULL`；改到另一侧 `kind` 时翻转 `direction`、把 `direction_source` 置为 `category` 并重算当月预算；作废后该账单从统计与预算中排除，但记录保留。

---

## 3. 数据字典（预设分类，ID 固定）

### 支出（kind = expense）

| ID | 名称 | 颜色 | 关键词 |
|---|---|---|---|
| 1 | 餐饮 | `#F97316` | 早餐、午餐、晚餐、夜宵、外卖、餐厅、饭店、食堂、咖啡、奶茶、瑞幸、星巴克、麦当劳、肯德基、火锅、烧烤、聚餐、AA |
| 2 | 交通 | `#3B82F6` | 地铁、公交、打车、滴滴、出租车、高铁、火车、机票、加油、停车、过路费、共享单车 |
| 3 | 购物 | `#EC4899` | 淘宝、京东、拼多多、超市、便利店、商场、衣服、鞋、数码、日用品、化妆品 |
| 4 | 居住 | `#10B981` | 房租、租金、水费、电费、燃气、物业、宽带、家政、维修 |
| 5 | 娱乐 | `#8B5CF6` | 电影、游戏、会员、订阅、KTV、旅游、酒店、演出、健身、剧本杀 |
| 6 | 医疗 | `#EF4444` | 医院、药店、挂号、体检、门诊、药、牙科 |
| 7 | 教育 | `#F59E0B` | 学费、课程、教材、书、培训、考试、网课 |
| 8 | 其他 | `#6B7280` | （兜底） |

### 收入（kind = income）

| ID | 名称 | 颜色 | 关键词 |
|---|---|---|---|
| 9 | 工资 | `#22C55E` | 工资、薪资、月薪、发薪、薪酬、奖金、年终奖、绩效、提成、兼职、外快、稿费、劳务 |
| 10 | 转账 | `#F472B6` | 转账、收款、入账、红包、礼金、压岁钱 |
| 11 | 其他收入 | `#9CA3AF` | 利息、分红、基金、股票、理财、收益、报销 |
| 12 | 贷款 | `#0EA5E9` | 贷款、借款、借到、放款、下款、借钱 |
| 13 | 贷款利息 | `#14B8A6` | 贷款利息、借款利息、房贷利息、还款利息、利息支出、分期利息、还利息、付利息、还息 |

> 自定义类别从 **14** 起自增；预设 13 冻结占用。类别 13 的关键词**不包含裸「利息」**，避免与类别 11「其他收入」竞争。

> 口径说明（v1.5）：**转账计入收入**；**贷款计入收入**；**退款**保持 v1.4 三态（等额作废 / 小于调整原单金额 / 大于作废 + 超出记收入）；**还款**保留原贷款、写 `settled_at`、不改原单金额。
>
> 还款计算：
>
> ```text
> outstandingCents = 原贷款金额 - SUM(principal_cents)
> diffCents = (principalCents ?? yuanToCents(amount)) - outstandingCents
> ```
>
> 判断顺序：**先**判「未提供拆分且 `yuanToCents(amount) > outstandingCents`」→ `AMBIGUOUS_LOAN_PAYMENT`；**再**判「显式 `principalCents > outstandingCents`」→ `INVALID_BATCH`。
>
> - `diffCents = 0`：写 `settled_at`，返回 `REPAYMENT_RECORDED_NEUTRAL`；
> - `diffCents < 0`：返回 `PARTIAL_REPAYMENT_RECORDED`；
> - `diffCents > 0`：理论上不可达（前面已按未拆分/显式本金分别拦截）；若出现，返回 `INVALID_BATCH`（`field: records[i].principalCents`）；
> - `interestCents` 只生成类别 13 的 `entry_type='normal'` 支出，**不参与** `outstanding`、`settled_at`、超额判断；
> - 退款超额仍产生两条记录：中性记录 + 超出部分的 `normal` 记录。
>
> **现金流口径**：贷款本金记收入、还款本金记中性、利息记支出，`netCents` 是「项目收支净额（排除中性本金还款）」，不等于现金流，也不等于损益；真正的负债/损益模型留给后续 `loans` 维度。
>
> **v1.5 已生效**：贷款还款改为「保留原单 + `settled_at`」；退款仍按三态（等额作废 / 小于调整 / 大于作废 + 超出记收入）。

---

## 4. 联调检查清单

模块 1 侧：

- [ ] 最简单记录（金额 + 时间齐全）→ 期望 `confirmed`
- [ ] 缺金额 → `pending_followup` + `MISSING_AMOUNT`；补发后 `confirmed`
- [ ] 缺时间，连续两轮不补 → 第二次回 `TIME_DEFAULTED_TO_CHAT_TIME` 且入库
- [ ] 未来时间 → 首轮 `FUTURE_TIME`，第二轮兜底
- [ ] 同一 `idempotencyKey` 重发 → `duplicate`，账单数不变
- [ ] 方向与类别冲突 → 首轮 `CATEGORY_KIND_MISMATCH`，第二轮按类别覆盖
- [x] 文本含「退款」→ 不带 id 首轮 `MISSING_ORIGINAL_TRANSACTION`；带无效 id 首轮 `ORIGINAL_NOT_FOUND`；次轮 → 中性记录 `entry_type='refund'`
- [x] 退款/还款金额等于原单 → 作废原单 + 中性记录；小于原单 → 调整原单金额 + 中性记录；大于原单 → 作废原单 + 中性记录 + 超出部分记收入/支出
- [ ] 缺 `sentAt` → 整批 `INVALID_BATCH`
- [ ] 入站 `userId` 与 `DEMO_USER_ID` 不一致 → 整批 `INVALID_BATCH`

模块 3 侧：

- [ ] 四种 `dimension` 各调一次，`recent7` 返回 7 个连续日桶
- [ ] `breakdownBy=category` 时 `ratio` 分母正确
- [ ] 无数据月份 → `meta.isEmpty = true`
- [ ] 未传 `date` 却用 `dimension=day` → `422`
- [ ] 账单一览翻页用 `nextCursor`，两页无重复无遗漏

---

## 5. 变更与沟通约定

1. 本文档对应 `contract v1.x`（当前 **v1.5**），**字段只增不删**；破坏性改动会提前在群里通知并升版本号。语义修正均不改变字段与端点形状，属澄清而非破坏性变更：
   - v1.2：`DUPLICATE_RECORD` 严重度由 `blocking` 改为 `warning`，与 §1.4「按成功处理」一致；
   - v1.2：`FUTURE_TIME` 增加 5 分钟时钟容差，把「未来」的判定边界写死；
   - v1.2：`occurredAt` 要求真实日历日期，拒绝 `2026-02-31` 这类 V8 会静默滚动的输入；
   - v1.3：退款/还款改为中性记录（`entry_type`），保留但不计入收支；移除 `REFUND_NOT_SUPPORTED`，新增 5 个反馈码；`summary` 恒只统计 normal，`meta.isEmpty` 依据区间是否有任何记录；
   - v1.4：退款/还款按金额三态——等额作废原单，少于原单调整原单金额，超出部分记收入（退款）/支出（还款）；新增 `ORIGINAL_AMOUNT_ADJUSTED`、`REFUND_EXCESS_AS_INCOME`、`REPAYMENT_EXCESS_AS_EXPENSE` 三个反馈码。
   - v1.5：新增预设类别 13「贷款利息」（自定义从 14 起）、入站 `repaymentPart` / `principalCents` / `interestCents`、`settled_at` 结清标记；贷款还款改为保留原单并标记结清（2C），显式原单匹配取消 30 天上限（1D）；新增 `ORIGINAL_TRANSACTION_AGED`、`PARTIAL_REPAYMENT_RECORDED`、`AMBIGUOUS_LOAN_PAYMENT`、`ORIGINAL_ALREADY_SETTLED`；明确现金流口径；升级迁移会把任意 id 的同名自定义「贷款利息」重命名为「贷款利息(旧N)」，并同步迁移其账单、预算与学习规则引用。
2. 模块 2 的实现在 `backend/` 下，接口以本文档为准；代码合并后如有差异，以代码为准并同步更新本文档。
3. 模块 1 / 3 需要新增字段或接口（比如「按商户统计」），先在群里提，确认后由模块 2 加，**不要各自约定后直接改**。
4. 联调问题优先带三样东西：`batchId` / `recordId` / 接口返回原文，方便直接查 `intake_log`。
