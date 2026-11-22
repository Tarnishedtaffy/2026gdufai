# M1–M4 模块进度报告（2026-11-22）

> **快照**：`main` = `e4d1c34`（#47 契约 v1.5 已合入）；唯一开放 PR 为 #35（Draft，head `7fabf96`）。
> **数据来源**：仓库代码与测试、[契约 v1.5](contracts/module2-interface-v1.md)、[进度看板](agent-logs/SUMMARY.md)、GitHub PR / Issue 实时状态。
> **估算口径**：按考核功能清单的交付覆盖度估算，含「已合入 + 在途 PR」；不等于代码行数，误差约 ±10%。

---

## 0. 总览

| 模块 | 功能主题 | 完成度 | 状态 | 关键缺口 |
|---|---|---|---|---|
| **M1** | 多模态记账（文本 / 图片 / 语音识别 + 确认提交 + 追问） | **约 65%** | 进行中 | 上传/抽取路由停在 #35；前端多模态未接；音频魔数校验缺失 |
| **M2** | 校验分类入库、统计、账单一览、类别管理、账单纠错 | **约 85%** | 进行中 | #36/#37/#39/#42 四项修复；#38 依赖 M4 |
| **M3** | 自然语言查账 | **约 5%** | 未开始 | 无解析层、无查询接口、无页面、无 issue 跟踪 |
| **M4** | 预算设定与超支提醒 | **约 10%** | 未开始 | 后端 `/api/budgets` 完全未实现；无 CRUD UI、无提醒 |

**一句话**：M2 最接近完成；M1 后端能力已就绪但卡在接口上线与前端接入；M3、M4 基本未动工。

---

## 1. M1 多模态记账（约 65%）

### 1.1 已完成

| 能力 | 状态 | 证据 |
|---|---|---|
| 文本 / 图片 / 语音三模态抽取核心 | 已合入 #30 | [capture/](file:///workspace/backend/src/modules/capture) 下 extractor、provider、schema、prompts、deepseek-tools |
| OpenAI 兼容 + DeepSeek OCR/ASR 双协议适配 | 已合入 | [provider.ts](file:///workspace/backend/src/modules/capture/provider.ts) |
| 受控上传存储（防路径穿越、符号链接、TOCTOU） | 已合入 | [storage.ts](file:///workspace/backend/src/modules/capture/storage.ts) |
| 草稿准备 / 修改 / 确认提交 / 追问 / 放弃 / 重试 | 已合入 #13 | [packages/capture-flow](file:///workspace/packages/capture-flow/src)、[useCaptureFlow.ts](file:///workspace/frontend/src/composables/useCaptureFlow.ts) |
| 反馈码白名单对齐契约 v1.5 | 主干已完成 | [normalizers.ts](file:///workspace/backend/src/modules/capture/normalizers.ts) 共 22 码（21 现行 + 1 兼容） |
| M1 后端测试 | 15 个测试文件 | [backend/test/capture](file:///workspace/backend/test/capture) |

### 1.2 进行中

| 事项 | 状态 | 说明 |
|---|---|---|
| `/api/capture/uploads`、`/api/capture/extract` HTTP 路由 | **PR #35，约 90%** | head `7fabf96`，CI 全绿、`mergeable=clean`；仍是 Draft，等待 #24 契约 v1.6 §2.10 冻结 |
| 反馈码测试断言修复 | 已完成 | `7fabf96` 已修正白名单与 `followup-extraction` / `routes` 断言 |

### 1.3 未完成

| 缺口 | 影响 | 依据 |
|---|---|---|
| 音频魔数校验 | 伪造 MIME 的音频可绕过上传校验 | issue #40；[storage.ts](file:///workspace/backend/src/modules/capture/storage.ts#L196) 当前只校验图片 |
| 前端附件上传 / 抽取调用 | 即使 #35 合并，UI 仍无法使用 OCR/ASR | [CaptureAttachmentEntry.vue](file:///workspace/frontend/src/components/capture/CaptureAttachmentEntry.vue) 只展示文件名；[api/index.ts](file:///workspace/frontend/src/api/index.ts) 无 upload/extract 调用 |
| 端到端真实识别联调 | 文本记账目前是手工填字段，不经过 AI | [CaptureView.vue](file:///workspace/frontend/src/views/CaptureView.vue) 的 `prepareManual()` |
| 契约 §2.10 与 M1 错误码 | 路由无法正式定稿 | issue #24 |

### 1.4 完成度拆分

| 子项 | 权重 | 完成 |
|---|---|---|
| 识别抽取核心 + 适配器 + 存储 | 35% | 100% |
| 确认 / 提交 / 追问流程 | 20% | 100% |
| 上传 / 抽取 HTTP 路由 | 20% | 90%（未合并） |
| 前端多模态接入 | 15% | 10% |
| 音频安全与端到端联调 | 10% | 0% |
| **合计** | 100% | **约 65%** |

---

## 2. M2 分类入库与统计（约 85%）

### 2.1 已完成

| 能力 | 证据 |
|---|---|
| 批次校验、分类、入库、幂等与去重 | [intake.ts](file:///workspace/backend/src/modules/ledger/intake.ts)、[validation.ts](file:///workspace/backend/src/modules/ledger/validation.ts) |
| 退款 / 还款中性记录（v1.4）与贷款还款 2C（v1.5） | #17、#47 |
| 统计 `/api/stats`（day/month/year/recent7、direction、categoryIds、breakdownBy、order） | [stats.ts](file:///workspace/backend/src/modules/ledger/stats.ts)、[routes.ts](file:///workspace/backend/src/modules/ledger/routes.ts) |
| 账单一览 `/api/transactions`（游标分页、entryType 筛选） | [transactions.ts](file:///workspace/backend/src/modules/ledger/transactions.ts) |
| 类别 CRUD、预设类别保护、reassign、迁移 003 / 类别 13 | #44、#45；[categories.ts](file:///workspace/backend/src/modules/ledger/categories.ts) |
| 账单纠错 PATCH / void | #46；[transaction-edit.ts](file:///workspace/backend/src/modules/ledger/transaction-edit.ts) |
| 契约 v1.5 冻结并落地 | [module2-interface-v1.md](file:///workspace/docs/contracts/module2-interface-v1.md) |
| M2 测试 | 14 个测试文件，[backend/test/m2](file:///workspace/backend/test/m2) |

### 2.2 未完成

| Issue | 优先级 | 内容 | 影响 |
|---|---|---|---|
| #36 | P2 | PATCH 改分类时 `category_source` / `category_confidence` 处理不完整 | 全量提交表单会把自动分类误标成人工 |
| #37 | P2 | 类别 reassign 允许预设类别作源；事务范围与契约 §2.7 有偏差 | 预设类别可能被搬空 |
| #39 | P2 | v1.5 收尾残留「13 起」与废弃码口径 | 文档与测试断言不一致 |
| #42 | P2 | 迁移 003 会重命名任意 id 的同名自定义类别 | 升级行为需写入契约 / 发布说明 |
| #38 | P2（暂不可复现） | PATCH 改 kind 未重算当月预算 | 依赖 M4 落地后处理 |

### 2.3 完成度拆分

| 子项 | 权重 | 完成 |
|---|---|---|
| 入站校验 / 分类 / 入库 / 中性记录 | 35% | 100% |
| 统计与账单一览 | 25% | 100% |
| 类别管理与账单纠错 | 25% | 95% |
| 遗留缺陷修复与文档收口 | 15% | 40% |
| **合计** | 100% | **约 85%** |

---

## 3. M3 自然语言查账（约 5%）

### 3.1 已具备的前置条件

| 前置条件 | 状态 | 证据 |
|---|---|---|
| 契约定义 M3 → M2 查询调用 | 已完成 | [契约 §2](file:///workspace/docs/contracts/module2-interface-v1.md#L225-L300) |
| 统计接口 | 已完成 | `GET /api/stats`，支持 M3 所需全部参数 |
| 账单一览接口 | 已完成 | `GET /api/transactions` |
| 类别字典 | 已完成 | `GET /api/categories` |
| AI 配置预留 | 已有 | [config/ai.ts](file:///workspace/backend/src/config/ai.ts) 注释明确 M1/M3 共用 |

### 3.2 未完成（实质全部）

| 缺口 | 说明 |
|---|---|
| 自然语言解析层 | 无「上个月吃饭花了多少」→ 结构化查询参数的解析器 |
| 查询编排接口 | 无 M3 自己的路由或服务；当前只有 M2 的结构化接口 |
| 结果话术生成 | 无金额、类别、时间范围的自然语言回答模板 |
| 前端查账页面 | [router/index.ts](file:///workspace/frontend/src/router/index.ts) 无 query 路由；[StatsView.vue](file:///workspace/frontend/src/views/StatsView.vue) 是下拉筛选 |
| 测试 | M3 无任何测试 |
| 跟踪 issue | GitHub 上搜不到 M3 issue，未进入排期 |

> 注意：`ledger/intent.ts` 只识别退款/还款关键词，**不是** M3 的查账意图解析。

### 3.3 完成度拆分

| 子项 | 权重 | 完成 |
|---|---|---|
| M2 查询底座 | 30% | 100%（已具备） |
| NL → 查询参数解析 | 30% | 0% |
| 结果话术生成 | 20% | 0% |
| 前端查账入口 | 20% | 0% |
| **合计** | 100% | **约 5%** |

---

## 4. M4 预算设定与超支提醒（约 10%）

### 4.1 已完成

| 能力 | 证据 |
|---|---|
| 数据库表 `budgets`、`budget_alerts` | [001_init.sql](file:///workspace/backend/src/db/migrations/001_init.sql#L69-L95) |
| 类别 reassign 时同步迁移预算 | [categories.ts](file:///workspace/backend/src/modules/ledger/categories.ts) |
| 契约定义预算读取与写入 | [契约 §2.5 / §2.8](file:///workspace/docs/contracts/module2-interface-v1.md#L335-L360) |
| 前端预算只读页面 + mock 数据 | [BudgetView.vue](file:///workspace/frontend/src/views/BudgetView.vue)、`mockGetBudgets` |

### 4.2 未完成

| 缺口 | 说明 |
|---|---|
| `GET /api/budgets` | 后端无任何预算路由；真实模式下 [BudgetView.vue](file:///workspace/frontend/src/views/BudgetView.vue) 会请求 404 |
| `PUT /api/budgets` / `DELETE /api/budgets/:id` | 契约 §2.8 已定义，代码未实现 |
| `level` 计算（normal / near ≥80% / over ≥100%） | 无服务端实现 |
| 超支提醒 | `budget_alerts` 表存在，但无写入与通知逻辑 |
| 预算 CRUD UI | 前端只有查看，没有新增 / 编辑 / 删除 |
| 测试 | 无预算接口或提醒的专项测试 |

### 4.3 完成度拆分

| 子项 | 权重 | 完成 |
|---|---|---|
| 表结构与契约 | 15% | 100% |
| 预算读取接口与 level 计算 | 30% | 0% |
| 预算写入 / 删除与校验 | 25% | 0% |
| 超支提醒 | 15% | 0% |
| 前端 CRUD | 15% | 20%（只读壳） |
| **合计** | 100% | **约 10%** |

---

## 5. 测试与质量现状

| 范围 | 现状 |
|---|---|
| M1 后端测试 | 15 个测试文件（抽取、追问、上传路由、回归、联调） |
| M2 后端测试 | 14 个测试文件（入库、统计、账单、类别、纠错、迁移） |
| 前端测试 | 13 个测试文件（采集流程、反馈、鉴权、错误处理） |
| M3 测试 | 0 |
| M4 测试 | 0 个专项测试 |
| CI | `main` 与 #35 head `7fabf96` 均全绿 |

---

## 6. 关键路径与建议

### 6.1 推荐优先级

| 顺序 | 动作 | 解锁内容 |
|---|---|---|
| 1 | 实现 #40 音频魔数校验并补 415 测试 | 解除 #35 的 P1 阻塞 |
| 2 | 推动 #24 契约 §2.10 冻结，合并 #35 | M1 后端接口正式上线 |
| 3 | 新建「前端接入 M1 上传/抽取」任务 | M1 端到端可演示 |
| 4 | 批量处理 M2 的 #36 / #37 / #39 / #42 | M2 从 85% 收口到完成 |
| 5 | 新建 M3 跟踪 issue，明确解析层 / 页面 / 验收标准 | M3 从 0 进入可执行 |
| 6 | 新建 M4 issue，实现 `/api/budgets` 与预算 UI | 解锁 #38 与预算提醒 |

### 6.2 主要风险

1. **M1 双重阻塞**：#24 契约冻结 + #40 音频校验，任一未完成都无法合并 #35。
2. **前端断链**：#35 合并 ≠ M1 可用，前端仍需单独的接入任务。
3. **M3 无排期、无 issue**：负责人同时承担 M1，按时交付风险最高。
4. **M4 真实模式不可用**：前端预算页在真实 API 下直接 404。
5. **看板滞后**：#41、#22 等已完成事项仍 open，会误导进度判断。

---

## 7. 验收口径对照

| 考核功能 | 当前可演示程度 |
|---|---|
| MVP-1 自然语言 / 语音 / 小票记账 | 文本可手工录入并提交；AI 抽取仅后端库与 #35 路由，UI 未接；图片 / 语音不可用 |
| MVP-2 自动分类与统计 | 可演示：入库、分类、统计、账单、类别管理、纠错均已实现 |
| MVP-3 自然语言查账 | 不可演示：无解析与页面 |
| MVP-4 预算与超支提醒 | 仅 mock 只读页可看；真实 API 与写入 / 提醒均不可用 |
