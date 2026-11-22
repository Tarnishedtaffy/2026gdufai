# 工程交接说明（2026-11-22）

> **读者**：接手 M1 收尾、PR 复审与全仓库问题清理的 AI 编码代理。
> **用途**：快速了解仓库当前进度、唯一在途 PR 的准确状态、剩余阻塞项与下一步操作。
> **快照时间**：2026-11-22（Asia/Shanghai）。
> **权威来源**：以 [AGENTS.md](../AGENTS.md)、[契约 v1.5](contracts/module2-interface-v1.md)、[README 团队分工](../README.md#团队分工) 和 GitHub 实际状态为准；本文件只是交接快照，发现不一致时先核对线上再更新本文件。

---

## 1. 一分钟状态

| 项 | 当前值 |
|---|---|
| 主仓库 | `Tarnishedtaffy/2026gdufai` |
| `main` HEAD | `e4d1c34`（`Merge pull request #47`，M2 契约 v1.5 已合入） |
| 开放 PR | **仅 #35 一个**（Draft） |
| #35 head | `7fabf96`（本次已由维护者快进推送） |
| #35 可合并性 | `mergeable=true`、`mergeable_state=clean`、`maintainer_can_modify=true` |
| #35 CI | 全绿：`install/typecheck/lint/test/build` success、`Docker build/smoke` success |
| #35 评审 | 最近一次仍是旧提交上的 `CHANGES_REQUESTED`（2026-11-22T10:40Z，早于 `7fabf96`），需复审 |
| 契约版本 | v1.5（类别 13、`settled_at`、`repaymentPart`、退款 1D / 还款 2C） |
| 阻塞 #35 合入的外部项 | #24（契约 v1.6 §2.10 M1 路由）尚未冻结 |

**一句话**：主干已到契约 v1.5；M1 路由 PR #35 的反馈码断言刚修完并已全绿，但仍是 Draft，卡在 #24 契约冻结与 #40 音频魔数校验。

---

## 2. 已完成进度（已合入 main）

| 方向 | 内容 | 相关 PR |
|---|---|---|
| 前端框架 | Vue 3 框架、Docker 同端口托管、真实 API 切换 | #13 等 |
| M1 采集链路（前端） | 草稿确认、批次提交、反馈追问、`@gduf/capture-flow` 共享流程 | #13 |
| M1 识别抽取核心 | 文本 / 图片 / 语音三模态抽取、受控上传存储、OpenAI 兼容与 DeepSeek OCR/ASR 适配、版本化提示词 | #30 |
| M1 枚举校验 | 严格校验反馈码与状态枚举，避免坏回执误报已入库 | #43（替代已回滚 #29） |
| M2 中性记录 | v1.4 退款/还款中性记录与金额三态 | #17 |
| M2 类别管理 | 类别 CRUD、迁移 003 与预设类别 13「贷款利息」、账单纠错 PATCH / void | #44（替代 #31）、#45（替代 #32）、#46（替代 #33） |
| M2 契约 v1.5 | 退款显式原单匹配（1D，取消 30 天窗口）、贷款还款保留原单 + `settled_at`（2C）、利息记录、`repaymentPart` | #47 |

> 说明：主仓库当前 clone 历史较浅，精确提交列表与逐条评审结论以 [docs/agent-logs/SUMMARY.md](agent-logs/SUMMARY.md) 和 GitHub PR 记录为准。

---

## 3. 当前唯一在途项：PR #35

### 3.1 基本信息

- **标题**：`feat(capture): 实现 M1 上传与抽取 HTTP 路由（Draft，待 #24 冻结）`
- **作者**：`mianyoubiaoqing`
- **分支**：`mianyoubiaoqing/2026gdufai-contrib:feat/m1-capture-routes`
- **基线**：`main`
- **规模**：3 个提交、12 个文件、+1390 / -70
- **状态**：Draft；`mergeable=clean`；`maintainer_can_modify=true`

### 3.2 本轮已完成的修复（`7fabf96`）

提交：`fix(capture): 对齐契约 v1.5 反馈码白名单`，已快进推送到作者分支（`3e5422c..7fabf96`）。

改动文件：

| 文件 | 改动 |
|---|---|
| `backend/src/modules/capture/normalizers.ts` | `ACTIVE_CONTRACT_FEEDBACK_CODES` 补齐 v1.5 四个码：`ORIGINAL_TRANSACTION_AGED`、`PARTIAL_REPAYMENT_RECORDED`、`AMBIGUOUS_LOAN_PAYMENT`、`ORIGINAL_ALREADY_SETTLED`；保留 deprecated 的 `REPAYMENT_EXCESS_AS_EXPENSE` 兼容历史回执，共 **21 个现行码 + 1 个兼容码 = 22** |
| `backend/test/capture/followup-extraction.test.ts` | 无效码用例收敛为 `REFUND_NOT_SUPPORTED` / `NON_EXISTENT_CODE`；正向用例改为放行 v1.5 现行反馈码 |
| `backend/test/capture/routes.test.ts` | 删除 `ORIGINAL_ALREADY_SETTLED` 应返回 422 的错误断言；新增该码路由级 200 正向用例 |

验证结果（基于 `7fabf96`）：

- backend `tsc --noEmit` 通过
- backend `eslint` 通过
- `capture/followup-extraction` + `capture/routes` 共 10 项测试全部通过
- GitHub Actions 全绿（含 Docker build / smoke）
- 已在 #35 发布说明评论：<https://github.com/Tarnishedtaffy/2026gdufai/pull/35#issuecomment-7078753675>

### 3.3 #35 合并前仍未完成

| 优先级 | 事项 | 依据 |
|---|---|---|
| P1 | 上传接口只校验图片魔数，音频 MIME 可伪造。需校验 WebM `1A 45 DF A3`、WAV `RIFF....WAVE`、MP3 `ID3`/`FF Ex`、MP4/M4A `ftyp`、OGG `OggS`，并补假音频 415 用例 | issue #40 |
| P0/阻塞 | 契约 §2.10 与 4 个 M1 路由错误码需等 #24 冻结（契约维护方 `@Z_Wen`、`@huangsiting546`） | issue #24 |
| P3 | `sourceRef` 收紧为 UUID；`rawText` / `followupText` 增加长度上限；补 sourceRef 不存在 / 跨目录的 422 用例 | #35 复审意见 |
| 流程 | 复审通过后 Dismiss 旧的 `CHANGES_REQUESTED`，再转 Ready for review | GitHub |

### 3.4 建议的合并顺序

1. 复审 `7fabf96` 的 3 个文件改动（确认白名单与测试断言符合契约 v1.5）。
2. 验证后关闭 #41（该 issue 描述的问题已由 `7fabf96` 修复）。
3. 实现 #40 音频魔数校验并补测试。
4. 等 #24 冻结后补 §2.10 路由契约与错误码映射。
5. 全量跑 `typecheck / lint / test`，Dismiss 旧 review、转 Ready、合并 #35。

---

## 4. 开放 Issue 看板

> 仅列当前 open 状态；优先级为交接建议，最终以模块负责人确认为准。

### 4.1 与 #35 / M1 相关

| Issue | 优先级 | 摘要 | 建议动作 |
|---|---|---|---|
| #40 | P1 | 上传接口音频魔数未校验，MIME 可伪造 | 在 #35 分支实现并补 415 测试 |
| #41 | 已修复待关闭 | #35 白名单仍是 v1.4 18 码 | `7fabf96` 已修复，验证后关闭 |
| #24 | 阻塞 | 契约 v1.6 §2.10 新增 M1 上传/草稿抽取接口 | 推动契约维护方冻结；#35 转 Ready 的前提 |
| #6 / #7 | 需 triage | M1 多模态识别与追问衔接的旧需求 issue | 确认是否已被 #30 / #13 覆盖后关闭 |

> 注：#40 正文里的分支名 `feat/m1-upload-extract-routes` 已过时，实际分支是 `feat/m1-capture-routes`。

### 4.2 M2 / M4 相关

| Issue | 优先级 | 摘要 | 备注 |
|---|---|---|---|
| #36 | P2 | PATCH 改分类时 `category_source` / `category_confidence` 处理不完整 | `backend/src/modules/ledger/transaction-edit.ts` |
| #37 | P2 | 类别 reassign 允许预设类别作为源、事务范围与契约 §2.7 有偏差 | 需契约/产品确认预设是否可搬空 |
| #38 | P2（暂不可复现） | PATCH 改 kind 未重算当月预算（契约 §2.9） | M4 未落地，落地时一起处理 |
| #39 | P2 | v1.5 收尾残留「13 起」与废弃码口径（契约示例、测试断言） | 文档 + `categories-crud.test.ts` |
| #42 | P2 | 迁移 003 会重命名任意 id 的同名自定义类别 | 在契约 §3 / 迁移说明中写明升级行为 |
| #22 | 需确认 | 「贷款利息归类与还款口径（v1.5）」 | #47 已实现，确认后关闭 |
| #34 | 契约 | 新增 `TRANSACTION_NOT_FOUND` 错误码 | 确认是否已写入契约并关闭 |
| #19 / #20 / #18 / #16 / #12 | 需 triage | 历史增强 / 契约变更 issue | 逐条对照当前实现确认状态 |

---

## 5. 代码地图

```
backend/src/modules/
  capture/                 # M1：上传、抽取、归一化、提示词
    storage.ts             # 受控上传（魔数校验入口，见 #40）
    extractor.ts           # 文本 / 图片 / 语音抽取
    provider.ts            # OpenAI 兼容 + DeepSeek OCR/ASR 适配
    normalizers.ts         # 反馈码白名单、金额/时间/方向归一化
    schema.ts, types.ts, prompts/
  ledger/                  # M2：校验、分类、入库、统计、类别、纠错
    intake.ts, validation.ts, repository.ts, classifier.ts
    categories.ts, stats.ts, transaction-edit.ts, routes.ts
packages/capture-flow/     # M1 共享流程与冻结反馈话术
frontend/src/              # Vue 3 前端
backend/test/capture/      # M1 测试（#35 的 followup-extraction / routes 在此）
backend/test/m2/           # M2 测试
docs/contracts/module2-interface-v1.md   # 契约 v1.5（唯一口径来源）
docs/agent-logs/SUMMARY.md               # reviewer 维护的合并汇总
```

---

## 6. 本地验证与沙箱注意事项

### 6.1 本沙箱的 pnpm 问题

当前环境 `corepack` 期望 `pnpm.cjs`，但缓存中的 pnpm 12.21.0 只有 `pnpm.mjs`，直接运行 `pnpm` 会报 `Cannot find module .../pnpm.cjs`。可用下面的方式代替：

```bash
PNPM="node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs"
$PNPM install --frozen-lockfile
```

### 6.2 标准验证命令

```bash
# 依赖（沙箱重启后 node_modules 不保留，需重装）
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs install --frozen-lockfile

# 后端
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs --filter @gduf/backend typecheck
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs --filter @gduf/backend lint
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs --filter @gduf/backend test

# 前端（包名为 frontend，无 lint 脚本）
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs --filter frontend typecheck
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs --filter frontend test

# 只跑 #35 相关
node /root/.cache/node/corepack/v1/pnpm/12.21.0/bin/pnpm.mjs --filter @gduf/backend exec vitest run \
  test/capture/followup-extraction.test.ts test/capture/routes.test.ts
```

### 6.3 分支与远程

- 本沙箱只配置了 `origin = https://github.com/Tarnishedtaffy/2026gdufai`，没有 `upstream`。
- 本地分支是临时的（当前为 `trae/agent-*`），可能被重置；**以远端 ref 为准**：
  - `origin/main` = `e4d1c34`
  - `origin/fix/m1-v15-feedback-codes` = `7fabf96`（修复备份分支）
  - `mianyoubiaoqing/2026gdufai-contrib:feat/m1-capture-routes` = `7fabf96`（#35 实际分支）
- `maintainer_can_modify=true`，维护者可直接快进推送作者分支；操作后在 PR 评论说明。

---

## 7. 必须遵守的协作规则（摘自 AGENTS.md）

1. **只改本人模块**；改共享目录（`backend/src/shared/`、`docs/contracts/`、根配置）需在 PR 中单列并 @ 负责人。
2. **契约字段只增不删、语义不变**；新增字段/接口先开 `contract-change` issue。
3. **金额口径**：入站 `amount` 单位为元；入库和出站用整数分（`*Cents`）；时间 ISO-8601 带 `+08:00`；缺失值用 `null`，不要用 `0` / `""` / `"未知"` 填充。
4. **日志**：只追加本人 `docs/agent-logs/<github-id>.md`，格式见 [agent-logs/README.md](agent-logs/README.md)。
5. **密钥与个人信息**：真实 Key/Token 只放本地 `.env`；仓库内只用 GitHub 用户名和虚构数据。
6. **Git**：Conventional Commits；`push --force` 仅限自己的功能分支且用 `--force-with-lease`。

---

## 8. 接手第一步清单

- [ ] `git fetch origin`，确认 `origin/main` 仍是 `e4d1c34`（若已前进，先看是否有人合并了新 PR）。
- [ ] 安装依赖并跑一遍主干 `typecheck / lint / test`，确认基线。
- [ ] 拉取 `7fabf96`（或 #35 分支），复核 3 个文件的修复 diff 是否与契约 v1.5 §1.5 一致。
- [ ] 关闭 #41，并在 #35 复审旧 review。
- [ ] 实现 #40 音频魔数校验（含假音频 415 测试）。
- [ ] 跟踪 #24 冻结进度；冻结后补 §2.10 与错误码映射。
- [ ] 全绿后把 #35 从 Draft 转 Ready，Dismiss 旧 `CHANGES_REQUESTED`，合并。
