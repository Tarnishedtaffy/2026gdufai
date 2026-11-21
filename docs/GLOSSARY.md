# 项目术语规范表（GLOSSARY）

> 适用范围：代码标识符、接口字段、数据库字段、提示词、文档、PR 描述、答辩材料。
> 规则：同一概念只用本表的「标准中文」和「代码标识」；「禁用 / 易混说法」一栏不得出现在代码与对外文案中。
> 维护：新增或修改术语走 PR，PR 标题前缀 `docs(glossary):`；与接口相关的术语以 [契约 v1](contracts/module2-interface-v1.md) 为准，冲突时先改契约再改本表。

## 1. 命名约定

| 场景 | 风格 | 示例 |
|---|---|---|
| TS 变量、函数、JSON 字段、查询参数 | camelCase | `occurredAt`、`idempotencyKey` |
| TS 类型、接口、类、Vue 组件 | PascalCase | `ImportBatch`、`StatsQuery`、`BudgetCard.vue` |
| 常量、枚举成员值以外的全局常量 | UPPER_SNAKE_CASE | `MAX_FOLLOWUP_ROUNDS` |
| 反馈码、错误码 | UPPER_SNAKE_CASE | `MISSING_AMOUNT`、`INVALID_BATCH` |
| 枚举取值（`status`、`direction` 等） | 小写 snake_case 字符串 | `pending_followup`、`expense` |
| 数据库表名、列名 | snake_case，表名复数 | `transactions`、`occurred_date` |
| HTTP 路径 | 小写复数名词，kebab-case | `/api/transactions/import` |
| 金额变量 | 单位后缀：分用 `Cents`，元只在 M1 入站出现 | `amountCents`、`amount`（元） |
| 文件与目录 | kebab-case（Vue 组件除外） | `followup-state.ts` |

## 2. 业务模块

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 模块 1 · 多模态记账 | `M1` / 目录 `capture` | 语音转写、OCR、字段抽取，组装批次 JSON，把反馈转成用户话术 | 「录入模块」「识别模块」混用 |
| 模块 2 · 分类入库与统计 | `M2` / 目录 `ledger` | 校验、分类、入库、追问状态机、统计、账单一览、类别管理 | 「数据库模块」 |
| 模块 3 · 自然语言查账 | `M3` / 目录 `query` | 把问句解析为结构化查询参数，把查询结果组织成回答；不做任何金额计算 | 「问答模块」「聊天模块」 |
| 模块 4 · 预算提醒 | `M4` / 目录 `budget` | 预算增删改查、超支判断、通知；与 M2 同进程、同一组负责，代码目录独立 | 「预警模块」 |
| 游戏化 | `gamification` | 宠物 / 种树等记账激励机制（扩展项，形态待定） | 「养成」「小游戏」混用 |
| 异常消费审计 | `audit` | 排查异常金额、缺失信息的扩展模块；结果体现在 `anomalyFlag` | 「风控」 |

## 3. 记账入站（M1 → M2）

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 批次 | `batch` / `batchId` | 一次提交的包装体，含 `records` 数组；仅支持批量包装 | 「请求包」 |
| 记录 | `record` / `recordId` | 批次中的单条待入库数据，尚未成为账单 | 与「账单」混用 |
| 发送时间 | `sentAt` | 批次级，用户发消息的时刻；时间兜底依赖它，缺失整批拒收 | 「上传时间」 |
| 聊天时间 | `chatAt` | 记录级，该条消息发出时刻；缺省用 `sentAt` 兜底 | 「消息时间」与 `sentAt` 混用 |
| 发生时间 | `occurredAt` | 消费实际发生的时刻（ISO-8601，`+08:00`） | 「记账时间」「创建时间」 |
| 发生日期 | `occurred_date` / `occurredDate` | 由发生时间按 `Asia/Shanghai` 截取的日期，统计口径字段 | — |
| 原始文本 | `rawText` | 用户输入原文或语音转写结果 | 「描述」 |
| 输入形态 | `modality` | `text` / `voice` / `image` | 「来源类型」「渠道」 |
| 源文件引用 | `sourceRef` | 语音/图片文件路径；不得内联 base64 | 「附件内容」 |
| 抽取置信度 | `confidence` | M1 对整条抽取的置信度，0–1，仅参考 | 与「分类置信度」混用 |
| 幂等键 | `idempotencyKey` | 同一笔重发必须相同；M2 据此去重并维护追问轮次 | 「去重 ID」「请求 ID」 |
| 缺失值 | `null` | 未识别 / 未判定；禁止用 `0`、`""`、`"未知"` 代替 | 「空值填 0」 |

## 4. 处理结果与追问

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 处理状态 | `status` | `confirmed` 已入库 / `pending_followup` 待追问 / `duplicate` 重复 / `rejected` 放弃 | 「成功/失败」二分 |
| 追问 | `followup` | 信息不全时向用户反问，同一笔最多 3 轮，轮次由 M2 按幂等键维护 | 「澄清」「补充」混用 |
| 追问轮次 | `followupRound` | 同一幂等键的第几次提交；M1 不传 | — |
| 反馈 | `feedback[]` | `{ field, code, severity }` 列表 | 「错误信息」 |
| 反馈码 | `code` | 见契约 1.5，如 `MISSING_AMOUNT`、`TIME_DEFAULTED_TO_CHAT_TIME` | 自造未登记的码 |
| 严重度 | `severity` | `blocking` 阻断入库 / `warning` 已入库但需提示 | 「error/info」 |
| 时间兜底 | time fallback | 第 2 轮起时间仍缺失或在未来，用 `chatAt`/`sentAt` 入库 | 「默认时间」 |
| 退款 | refund | 记为中性记录（`entry_type='refund'`），保留但不计入收支；匹配到原账单时自动作废原单或调整其金额 | 「负支出」「退款收入」 |
| 中性记录 | neutral entry | `entry_type` 为 `refund` / `repayment` 的记录，保留可查但不计入收支统计 | 与「作废」混用 |
| 贷款利息 | loan interest | 预设类别 13（expense）；关键词不含裸「利息」 | 「利息收入」 |
| 已结清 | settled | 原贷款 `settled_at` 非空，不能再被还款匹配 | 与 `status='void'` 混用 |

## 5. 账单与类别

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 账单 | `transaction` / `transactionId`（`tx_` 前缀） | 已入库的一笔收支，表 `transactions` | 「流水」「订单」「记录」 |
| 收支方向 | `direction` | `expense` 支出 / `income` 收入；入站可为 `null`，入库必非空 | 「类型」「正负」 |
| 金额（分） | `amountCents` | 整数，单位分；入库与出站统一使用 | 「价格」 |
| 金额（元） | `amount` | 仅出现在 M1 入站，最多两位小数 | 在出站接口中使用元 |
| 商户 | `merchant` | 消费对象；缺失时 M2 填默认并回 `MERCHANT_DEFAULTED` | 「商家」「店名」混用 |
| 类别 | `category` / `categoryId` | 分类条目；预设 ID 固定（1–13），不得硬编码到前端或话术 | 「标签」「分组」 |
| 类别性质 | `kind` | 类别所属方向：`expense` / `income` | 与 `direction` 混用 |
| 预设类别 | `isPreset: true` | 契约第 3 节的 13 个系统类别 | 「默认类别」 |
| 贷款 | `loan` | 收入类别，ID 12；借款到账计入收入 | 「借款」「网贷」混用 |
| 自定义类别 | `custom` / `isPreset: false` | 用户新增的类别 | — |
| 分类置信度 | `categoryConfidence` | M2 分类结果置信度；< 0.75 回 `LOW_CONFIDENCE_CATEGORY` | 与「抽取置信度」混用 |
| 作废 | void | 账单逻辑删除，统计默认不计（`includeVoid: false`） | 「删除」 |
| 异常标记 | `anomalyFlag` | 账单被审计规则标为异常 | 「风险标记」 |
| 入站日志 | `intake_log` | M2 记录每次导入请求的表，联调排查依据 | — |

## 6. 统计与查询

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 时间维度 | `dimension` | `day` / `month` / `year` / `recent7` | 「粒度」「周期」混用 |
| 近 7 日 | `recent7` | 固定 `[今天-6, 今天]`，7 个日桶，空日补 0 | 「本周」「一周」 |
| 桶 | `bucket` / `period` | 统计结果按时间切分的单元 | 「分组」 |
| 按类别拆分 | `breakdownBy=category` | 桶内附各类别合计 | — |
| 支出合计 / 收入合计 | `expenseCents` / `incomeCents` | 区间内同方向金额合计（分） | 「花费」「进账」混用 |
| 净额 | `netCents` | 收入合计 − 支出合计，可为负 | **「余额」「结余」** |
| 占比 | `ratio` | 分母为同方向合计（支出类别 ÷ `expenseCents`） | 用总额作分母 |
| 最高类别 | `topCategory` | 区间内金额最高的类别，直接读取，不自行排序 | — |
| 空结果 | `meta.isEmpty` | 区间无记录；回答「还没有记录」而非「0 元」 | — |
| 账单一览 | transaction list / `GET /api/transactions` | 账单筛选与游标分页列表 | 「明细页」「流水页」 |
| 游标 | `cursor` / `nextCursor` | 分页令牌，原样回传 | `offset`、`page` |

## 7. 预算

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 预算 | `budget` | 月度预算，单位分（`amountCents`） | 「限额」「额度」 |
| 预算范围 | `scope` | `total` 总预算 / `category` 类别预算 | — |
| 已用 / 剩余 | `spentCents` / `remainingCents` | 当月该范围已支出 / 剩余额度 | 「余额」 |
| 使用率 | `usageRatio` | `spentCents ÷ amountCents` | — |
| 预算等级 | `level` | `normal` / `near`（≥ 80%）/ `over`（≥ 100%） | 「警告/危险」 |
| 超支提醒 | budget alert | `level` 变为 `near` 或 `over` 时触发的通知（邮件 / QQ 机器人，待定） | 「预警」 |

## 8. 协作与工程

| 标准中文 | 代码标识 | 定义 | 禁用 / 易混说法 |
|---|---|---|---|
| 上游仓库 | `upstream` | 团队主仓库，PR 的目标 | 「总仓」 |
| 个人仓库 | `origin` / fork | 协作者 fork 的仓库，日常推送目标 | — |
| 审核人 | reviewer | 主仓库负责人，负责审 PR、合并、维护汇总日志 | 「管理员」 |
| 接口契约 | contract（`contract v1`） | `docs/contracts/` 下的冻结接口文档 | 「接口约定」「口头约定」 |
| 架构决策记录 | ADR | `docs/decisions/` 下记录技术选型及原因的文档 | — |
| 个人日志 | agent log | `docs/agent-logs/<github-id>.md`，本人代理只追加 | 「工作记录」 |
| 汇总日志 | summary log | `docs/agent-logs/SUMMARY.md`，仅 reviewer 代理维护 | — |
| 日志条目编号 | `LOG-<github-id>-YYYYMMDD-NN` | 单条会话日志的唯一编号 | — |
