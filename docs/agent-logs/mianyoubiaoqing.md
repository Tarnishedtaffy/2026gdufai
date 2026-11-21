# Agent 日志 · `mianyoubiaoqing`

> 写入者：`mianyoubiaoqing` 本人的代理，只追加到文件末尾。格式见 [README.md](README.md#条目模板)。
> 负责模块：见 [README 团队分工](../../README.md#团队分工)。

<!-- 在此线以下按时间顺序追加条目 -->

### LOG-mianyoubiaoqing-20261116-01

- **时间**：2026-11-16 14:40（+08:00）
- **工具/模型**：Antigravity / Claude Opus
- **模块 / 分支 / PR**：docs / `main`（项目初始化，经人同意直接提交至主仓库）/ 不适用
- **任务**：为团队 agent 制定协作与项目规范文档，搭建仓库文档骨架
- **关键提示词**：
  - 依据考核说明「方向一 · 选题 A」与模块 2 接口交接文档，制定 AGENTS.md、CLAUDE.md、术语规范表、分人日志与汇总日志
  - 立项会议纪要先脱敏再参考；技术栈以人确认的选型为准
- **代理做了什么**：
  - 新增 `AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`，重写 `README.md`
  - 新增 `docs/GLOSSARY.md`、`docs/ARCHITECTURE.md`、`docs/CODING_STANDARDS.md`、`docs/AI_CODING_POLICY.md`、`docs/PROBLEMS_AND_GAPS.md`
  - 将模块 2 交接文档收录为 `docs/contracts/module2-interface-v1.md`
  - 新增 `docs/decisions/ADR-0001-tech-stack.md` 与 ADR 模板
  - 新增 `docs/agent-logs/`：日志规范、5 份个人日志、`SUMMARY.md`
  - 新增 `.github` PR / issue 模板、`.gitignore`、`.env.example`、`.editorconfig`、`.gitattributes`
- **决策**：
  - 技术栈：Fastify + better-sqlite3 + Vite/Vue 3 + pnpm + Vitest（与纪要差异记入 ADR-0001）
  - 模块划分采用契约 v1 的 M1–M4；M2 与 M4 由同一组负责
  - 日志文件以 GitHub 用户名命名；因仓库公开，不使用以 QQ 号或真名拼音为前缀的邮箱命名
  - `CLAUDE.md` 通过 `@AGENTS.md` 导入，规则单一来源
- **验证**：文档类改动，无代码；人工核对仓库内未出现真实姓名、邮箱、QQ 号
- **人工审核**：分工、技术栈、日志命名方式已由人确认
- **遗留问题**：M2+M4 第二位协作者的 GitHub 用户名待补，由其在首次提交时重命名 `member-e.md` 并更新 README 分工表

### LOG-mianyoubiaoqing-20261116-02

- **时间**：2026-11-16 18:10（+08:00）
- **工具/模型**：Codex / GPT-6
- **模块 / 分支 / PR**：docs / `docs/docs-member-e-identity` / 待建
- **任务**：将协作文档中的成员占位更新为 `huangsiting546`
- **关键提示词**：用户要求将 `member-e` 占位更新为 `huangsiting546`
- **代理做了什么**：更新 README 团队分工及个人日志链接；重命名空白日志模板并更新标题、写入者，移除已完成的重命名提示
- **决策**：按用户明确要求修改共享文档及该成员的空白模板；保留已有日志条目，上一条日志的用户名待补事项现已解决；不改变 M2 / M4 分工和接口契约
- **验证**：`git diff --check` 通过；全文检索确认当前分工表与日志模板使用新用户名，旧占位仅保留于历史记录；仓库没有 `package.json`，typecheck / lint / test 不适用
- **人工审核**：用户名由用户明确指定；改动待 PR 审核
- **遗留问题**：PR 待创建及 reviewer 审核

### LOG-mianyoubiaoqing-20261117-01

- **时间**：2026-11-17 13:45（+08:00）
- **工具/模型**：Codex / GPT-6
- **模块 / 分支 / PR**：M1 分工、infra / `codex/chore-infra-cicd` / 待建
- **任务**：同步最新主仓库，创建 M1 双人分工工单，并通过 PR 完善 CI/CD。
- **关键提示词**：用户确认按前述双人分工创建主仓库 issue，要求先同步最新提交；要求提交 CI/CD PR，并选择 main 合入后发布 Docker 镜像到 GHCR。
- **代理做了什么**：
  - fetch/rebase 到 `f22d134` 后创建功能分支；创建并指派 [#6](https://github.com/Tarnishedtaffy/2026gdufai/issues/6)（本人：识别与抽取）、[#7](https://github.com/Tarnishedtaffy/2026gdufai/issues/7)（`yukacezar569-blip`：批次与反馈追问），补充阶段验收和相互依赖。
  - 在现有 CI 上增加容器构建、启动/持久化验证、构建产物保存，以及仅主仓库 main push 可执行的 GHCR 发布。
  - 新增 Dockerfile、Compose、构建上下文排除规则、容器验证脚本；后端通过 `@fastify/static` 托管 Vue 构建与既有页面路由，补充测试；更新 README 和 `.env.example`。
- **决策**：
  - 用户已确认 M1 双人分工与 GHCR 交付目标；发布直接复用通过验证的镜像，使用 main/SHA 标签，旧提交重跑不覆盖 main 标签。
  - 按已采纳架构使用单端口、非 root 容器和 SQLite/上传命名卷；生产构建关闭前端 mock。CI 不调用真实 AI，也不使用真实业务密钥。
  - 本次共享目录及后端入口改动是用户请求 CI/CD 所需，在 PR 中单列并请 reviewer 与后端负责人审核；业务接口契约不变。
- **验证**：`pnpm install --frozen-lockfile`、`pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`（后端 16、前端 31）、`VITE_USE_MOCK=false pnpm --filter frontend build`、生产 Node 服务 4 个页面与 API 404 检查、`docker compose config --quiet`、`node --check tools/container-smoke.mjs`、`git diff --check` 通过。当前 lint 仅后端已声明。
- **人工审核**：用户已采纳分工与交付方案；代码待 PR 审核。
- **遗留问题**：本机 Docker Desktop 引擎未就绪，容器构建与持久化检查待 GitHub runner 执行；GHCR 实际发布需合并后验证。业务路由仍在开发，容器验证不代表 M1/M2 功能验收完成。

### LOG-mianyoubiaoqing-20261117-02

- **时间**：2026-11-17 14:00（+08:00）
- **工具/模型**：Codex / GPT-6
- **模块 / 分支 / PR**：infra / `codex/chore-infra-cicd` / [#8](https://github.com/Tarnishedtaffy/2026gdufai/pull/8)
- **任务**：验证 Actions 配置，检查 PR 运行情况，记录远端执行前提。
- **关键提示词**：延续本次用户要求的 CI/CD PR 与 GHCR 交付方案。
- **代理做了什么**：推送本人 fork 的功能分支，创建主仓库 PR #8 并请求 `Tarnishedtaffy`、`ONFAIL` 审核；验证 #6/#7 的负责人；在 README 补充私有仓库 fork PR 的 Actions 设置说明。
- **决策**：主仓库当前为私有仓库，PR 未产生 Actions 检查；当前账号有 write、无 admin 权限，设置读取 API 返回 404，因此是否禁用了 fork PR 工作流需管理员确认，未将推测写成已证实根因。无需向 fork 开放 secrets 或写权限。
- **验证**：官方 actionlint v1.7.12 压缩包通过 SHA-256 校验，工作流检查通过；`gh pr view` 确认 PR 开放且可合并，reviewer 请求已送达；`gh pr checks` 返回没有检查记录。源码与生产服务验证结果见上一条。
- **人工审核**：PR 待 reviewer 审核；已向用户说明需要管理员确认的设置。
- **遗留问题**：本机 Docker 引擎仍未可用，容器构建/持久化与远端 CI 尚未验证，GHCR 实际发布待合并后验证；没有把这些检查标为通过。

### LOG-mianyoubiaoqing-20261117-03

- **时间**：2026-11-17 21:02（+08:00）
- **工具/模型**：Codex / GPT-6
- **模块 / 分支 / PR**：infra、前端托管 / `codex/chore-infra-cicd` / [#8](https://github.com/Tarnishedtaffy/2026gdufai/pull/8)
- **任务**：处理评审中的 Node 镜像固定、已有数据卷权限、静态资源缓存三项非阻塞建议。
- **关键提示词**：用户要求按代理判断处理三项建议，数据卷必须保留数据；先完成本地验证并更新 PR，远端 CI 等负责人开启后再运行。
- **代理做了什么**：
  - 同步上游后，将构建/运行镜像固定为 `node:22.23.5-bookworm-slim` 及 manifest digest；新增 `.node-version`，两个 CI job 读取同一版本。
  - 新增仅手动执行的 `repair-volume-permissions` 维护命令；README 给出停服、离线备份到宿主机、检查归档、修复现有卷、以 node 用户重启的流程，备份目录排除出 Git 和构建上下文。
  - 对 Vite hash 资源设置一年 immutable 缓存，HTML 与未版本化文件使用 no-cache；增加缓存/条件请求测试，并在容器冒烟中加入旧卷属主和权限异常的修复回归。
- **决策**：
  - 对照 Docker 官方清单及 registry manifest 核实 22.23.5 标签、digest 和 Linux amd64 平台，使用该精确补丁版本，避免宽泛主版本标签漂移。
  - 权限修复不删除卷或文件、不跟随符号链接、不开放组/其他用户权限；维护命令要求 root 且先检查两个目录，正常服务仍以 node 用户运行。真实卷未被操作。
- **验证**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`（后端 18、前端 31）、`VITE_USE_MOCK=false pnpm --filter frontend build`、`docker compose config --quiet`、`node --check tools/container-smoke.mjs`、`bash -n tools/repair-volume-permissions.sh`、actionlint v1.7.12、`git diff --check` 均通过。实际 Node 服务的 5 个 HTML 路由与 2 个 Vite 构建资源缓存头通过检查；WSL Ubuntu 的临时 chroot 执行原样权限脚本，离线归档/字节不变/属主与权限修复/node 写入/符号链接保护/root 与目录检查均通过。
- **人工审核**：用户已授权处理三项建议；新增改动待 PR 复核。
- **遗留问题**：本地 Node 检查使用现有 Node 24.14.0；固定 Node 22 镜像的实际构建、容器集成及 GHCR 发布仍待验证。本机 Docker 引擎不可用；按用户要求未手动触发远端 CI。

### LOG-mianyoubiaoqing-20261117-04

- **时间**：2026-11-17 21:14（+08:00）
- **工具/模型**：Codex / GPT-6
- **模块 / 分支 / PR**：infra / `codex/chore-infra-cicd` / [#8](https://github.com/Tarnishedtaffy/2026gdufai/pull/8)
- **任务**：负责人开启 fork PR 工作流后验证 CI，重点检查容器构建与保留数据的权限修复。
- **关键提示词**：用户要求重新触发 PR #8 的 CI，发现问题就修好并推送。
- **代理做了什么**：
  - 检查时最新提交 `b4aca9f` 已触发 [CI 44089360555](https://github.com/Tarnishedtaffy/2026gdufai/actions/runs/44089360555)，跟进该运行，源码检查与 Docker build / smoke 全部通过。
  - 核对容器日志及对应脚本：固定 Node 22.23.5 镜像构建、四个页面、API 404、SQLite 迁移和类别、非 root 运行、旧卷故障后的权限修复、数据保留和上传写入均通过；重建后的容器健康，隔离测试卷正常清理。
  - 发现 Actions 的 Node 20 弃用警告；对照官方 release、commit SHA 与 action.yml，将 checkout/setup-node/pnpm/artifact/login actions 升级为原生 Node 24 版本，继续固定完整 SHA。应用 Node 版本和发布权限条件不变。
- **决策**：首轮未发现 Docker 或权限修复失败；处理实际出现的 Action 运行时弃用提示后推送复跑。PR 事件不发布 GHCR，发布 job 跳过符合设计。
- **验证**：首轮 CI 的源码检查 54 秒、Docker job 63 秒通过；日志包含 `node: v22.23.5`、重建后 `Healthy` 和 `Container smoke passed: frontend, API 404, SQLite, non-root user, repaired persistent volumes.`。Action 元数据已核对均使用 node24、现有输入仍受支持；本地 actionlint 与 diff 检查在提交前执行，升级后的远端结果将在 PR 验证区更新。
- **人工审核**：用户已授权重跑与修复；PR 仍待 reviewer 复核。
- **遗留问题**：Action 升级需新提交 CI 再验证；GHCR 的实际推送仍需合入 main 后验证。

### LOG-mianyoubiaoqing-20261119-01

- **时间**：2026-11-19 22:56（+08:00）
- **工具/模型**：Antigravity / Orchestrator
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-extraction` / 待建（关联 [#6](https://github.com/Tarnishedtaffy/2026gdufai/issues/6)、[#21](https://github.com/Tarnishedtaffy/2026gdufai/issues/21)、[#24](https://github.com/Tarnishedtaffy/2026gdufai/issues/24)、PR [#13](https://github.com/Tarnishedtaffy/2026gdufai/pull/13)）
- **任务**：同步上游最新提交，review 契约 v1.4（#21）与 PR #13 交接，并完成 M1 #6 多模态识别与字段抽取核心。
- **关键提示词**：
  - 拉取仓库远端最新提交，review #21 号 issue，再完成 M1 模块本人部分（#6）
  - 人确认：在 #21 评论确认 M1 知悉（不代勾含 M3 的复选框）、在 PR #13 评论确认交接；一次完成 #6 后端核心并另提 contract-change issue；采用 OpenAI 兼容协议统一适配；本地提交暂不推送
- **代理做了什么**：
  - 同步本地 `main` 至 `upstream/main`（`e7180fe`）并切出功能分支 `feat/m1-capture-extraction`。
  - 在 [#21](https://github.com/Tarnishedtaffy/2026gdufai/issues/21#issuecomment-7012527951) 评论确认 M1 识别端知悉契约 v1.4；在 PR [#13](https://github.com/Tarnishedtaffy/2026gdufai/pull/13#issuecomment-7012529049) 评论确认 `CaptureDraft` / `Partial<CaptureDraft>` 交接口径与文件防冲突边界；创建契约变更议题 [#24](https://github.com/Tarnishedtaffy/2026gdufai/issues/24) 提议新增 `POST /api/capture/uploads` 与 `POST /api/capture/extract` 及对应 §2.6 错误码。
  - 新增 `backend/src/config/ai.ts` 并在 `backend/src/config/index.ts`、`.env.example`、`README.md` 同步新增 AI 环境变量说明；新增 [ADR-0002](docs/decisions/ADR-0002-m1-ai-provider-adapter.md)。
  - 新增 M1 多模态识别与抽取核心：`backend/src/modules/capture/{types,normalizers,schema,storage,provider,extractor,index}.ts` 与版本化提示词 `prompts/{extract-text,extract-followup,extract-receipt}.ts`。
  - 新增 5 组 stub 单元与真实 M2 联调测试：`backend/test/capture/{text-extraction,followup-extraction,multimodal-pipeline,openai-compatible-provider,m1-m2-handoff}.test.ts`（18 例）。
- **决策**：
  - 统一采用基于 Node 22 原生 `fetch` / `FormData` / `Blob` 的 OpenAI 兼容协议适配器，支持 `OCR_*` / `ASR_*` 未配置时自动回退至 `LLM_*`，不引入厂商专有依赖，不改动 `pnpm-lock.yaml`。
  - 提示词初始版本分别为 `m1-text-v1`、`m1-followup-v1`、`m1-receipt-v1`（首次建立，无旧版本对比）；严格剥离模型夹带的身份、幂等键与 `originalTransactionId`，将 `0` 与「未知」等占位词规整为 `null`，并将日期/时间统一规范化为合法 `+08:00` 日历时间。
  - 不修改 `backend/src/modules/ledger/`、`docs/contracts/` 或 PR #13 的 `capture/README.md`；对外上传/抽取路由待 #24 经契约组与前端确认后再挂载。
- **验证**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend test`（20 文件 100 项，含 M1 新增 5 文件 18 项）、`pnpm --filter frontend test`（2 文件 33 项）、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 全部通过。
- **人工审核**：方案、交付范围与 GitHub 回复策略已由人确认；本地提交待人复核后再推送与发起 PR。
- **遗留问题**：本机暂无 `.env` 与真实 AI 密钥，真实第三方模型服务的人工联调验证待配置密钥后补记；`POST /api/capture/uploads` 与 `POST /api/capture/extract` 路由挂载与前端接入待 #24 与 PR #13 推进后跟进；游戏化与异常消费审计待后续开发。

### LOG-mianyoubiaoqing-20261120-01

- **时间**：2026-11-20 13:50（+08:00）
- **工具/模型**：Antigravity / Orchestrator
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-extraction` / 待建（关联 [#6](https://github.com/Tarnishedtaffy/2026gdufai/issues/6)、[#24](https://github.com/Tarnishedtaffy/2026gdufai/issues/24)）
- **任务**：rebase 至包含 #13 与 #17 的最新主干 `9d28ec4`，对齐 `@gduf/capture-flow` 与 #24 校验约束，使用本机环境变量中的真实 `DEEPSEEK_API_KEY` 完成真实 AI + M2 联调测试并提交 PR。
- **关键提示词**：
  - 使用环境变量中的 key 进行测试，并提交 PR
- **代理做了什么**：
  - 将 `feat/m1-capture-extraction` rebase 到 `upstream/main`（`9d28ec4`），合并解决 `README.md` 与 `backend/src/modules/capture/index.ts` 冲突（保留 `@gduf/capture-flow` 导出与全部鉴权文档），执行 `pnpm install --frozen-lockfile`。
  - 统一 `backend/src/modules/capture/types.ts` 直接复用 `@gduf/capture-flow` 的 `CaptureDraft`，在 `normalizers.ts` 与 `extractor.ts` 新增 `ACTIVE_CONTRACT_FEEDBACK_CODES` 与 `validatePendingFeedbackHints`：调用 AI 前校验 `pendingFeedback`，拒绝未知或已废弃历史码并返回 `INVALID_CAPTURE_INPUT`。
  - 在 `backend/src/config/ai.ts` 增加 `DEEPSEEK_API_KEY` 可选回退（未配置 `LLM_API_KEY` 时默认回退为 `https://api.deepseek.com/v1` + `deepseek-chat`），并同步 `.env.example`、`README.md` 与 [ADR-0002](docs/decisions/ADR-0002-m1-ai-provider-adapter.md)。
  - 补充单元测试与 `@gduf/capture-flow` → `createCaptureExtractor` → 真实 M2 的闭环集成测试；在仓外临时脚本使用环境变量 `DEEPSEEK_API_KEY`（模型 `deepseek-chat`）执行 5 项真实 AI + M2 v1.4 内存 SQLite 联调。
- **决策**：
  - 本次仅提交配置、M1 抽取核心、ADR、测试与个人日志，不修改 `docs/contracts/`（待 #23 v1.5 冻结后再按 #24 推进 v1.6 契约与 HTTP 路由挂载）。
  - 真实 API 联调通过仓外临时脚本执行，仓库内 `backend/test/capture/*.test.ts` 仍保持 100% stub 与零网络依赖，确保 CI 稳定与无密钥泄漏。
- **验证**：
  - 真实 `deepseek-chat` + `@gduf/capture-flow` + 真实 M2（v1.4）联调 5 项全部通过（不记录任何密钥内容）：
    - 单笔中文口语与相对日期（1071ms）：`b_live_2` / `r_live_1` → `confirmed`（`tx_95569e57-3298-4a74-ae1a-d54a6af55dc7`，3250 分，`2026-11-19`）；
    - 单句多笔拆分（1099ms）：`b_live_5` / `r_live_3`、`r_live_4` → 2 条均 `confirmed`；
    - 缺金额/时间追问补丁（486ms + 516ms）：首轮 `b_live_7` / `r_live_6` `pending_followup`（`MISSING_AMOUNT`）→ 追问补丁 `{ amount: 18.5, occurredAt: "2026-11-20T12:30:00+08:00" }` 保留商户「学校食堂」→ `b_live_8` `confirmed`（1850 分）；
    - v1.4 退款表述（845ms）：抽取正数 45 元并保留「退款」原文 → 首轮 `b_live_10` `MISSING_ORIGINAL_TRANSACTION` → 次轮 `b_live_11` `confirmed` 中性记录（`ORIGINAL_NOT_FOUND_RECORDED`）；
    - 文本端点调用图像 Vision 边界（89ms）：显式返回 `AI_UPSTREAM_ERROR`（HTTP 400），不抛未捕获异常、不伪造草稿。
  - 全仓静态与单测：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend test`（27 文件 205 项，含 M1 5 文件 20 项）、`pnpm --filter frontend test`（12 文件 73 项）、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 全部通过。
- **人工审核**：待团队 reviewer 审核本 PR；#24 契约增补待 v1.5 冻结后跟进。
- **遗留问题**：本机当前仅配置了文本模型密钥 `DEEPSEEK_API_KEY`，多模态 Vision OCR 与 ASR 语音转写端点的真实服务验证待配置支持图像/音频的模型密钥后补记；`POST /api/capture/uploads` 与 `POST /api/capture/extract` 路由挂载与前端附件闭环待 #23/#24 冻结后推进。

### LOG-mianyoubiaoqing-20261120-02

- **时间**：2026-11-20 14:04（+08:00）
- **工具/模型**：Antigravity / Orchestrator
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-extraction` / [#30](https://github.com/Tarnishedtaffy/2026gdufai/pull/30)
- **任务**：依据 DeepSeek 官方 API 文档与实时模型列表接入 `deepseek-flash`、`/v1/tools/ocr` 与 `/v1/tools/asr`，完成文字、小票图片 OCR 与语音 ASR 三模态真实联调并更新 PR #30。
- **关键提示词**：
  - deepseek 的 api 有提供 ocr、asr 等服务，查阅相关文档，应该也可以使用
- **代理做了什么**：
  - 核对 DeepSeek 官方文档与 `GET /v1/models` 实时响应：确认当前多模态主模型 ID 为 `deepseek-flash`，并分别提供独立文档/图片 OCR 端点 `POST /v1/tools/ocr`（`purpose="text_recognition"` + `file` → `pages[].text`）与语音转写端点 `POST /v1/tools/asr`（`file`，支持 16-bit PCM WAV / Ogg Opus，≤ 8 MiB / 120s → `{ request_id, text, duration_ms }`）。
  - 更新 `backend/src/config/ai.ts` 与 `backend/src/config/index.ts`：DeepSeek 默认模型调整为 `deepseek-flash`，新增 `OcrProtocol`（`openai-vision` / `deepseek-ocr`）与 `AsrProtocol`（`openai-asr` / `deepseek-asr`），按服务商域名自动判别并支持 `OCR_PROTOCOL` / `ASR_PROTOCOL` 显式覆盖；同步更新 `.env.example`、`README.md` 与 [ADR-0002](docs/decisions/ADR-0002-m1-ai-provider-adapter.md)。
  - 新增 `backend/src/modules/capture/deepseek-tools.ts` 并在 `provider.ts` 接入双协议分派：`deepseek-ocr` 先识别票面文字（空白则直接判不可读，不再调用 LLM）再由 `deepseek-flash` 结构化为 `CaptureDraft`；`deepseek-asr` 直接调用 `/v1/tools/asr` 转写语音后进入统一文字抽取链。
  - 在 `backend/test/capture/openai-compatible-provider.test.ts` 新增 `deepseek-ocr` / `deepseek-asr` 配置与 stub `fetch` 测试；在仓外临时脚本使用 `DEEPSEEK_API_KEY` 完成全 3 模态 8 项真实联调。
- **决策**：
  - 保留 `openai-vision` 与 `openai-asr` 兼容分支，仅在 DeepSeek 域名下默认切换至 `/v1/tools/ocr` 与 `/v1/tools/asr`，确保阿里百炼、硅基流动、OpenAI 等服务商仍可直接沿用既有配置。
  - 空白小票 OCR 结果或 `deepseek-flash` 判定的无关字符噪点均通过 `UNREADABLE_RECEIPT` 结构化失败返回，不伪造草稿。
- **验证**：
  - 真实 `DEEPSEEK_API_KEY` 全模态端到端联调 8 项全部通过（含 `@gduf/capture-flow` 与真实 M2 v1.4 SQLite 落库）：
    - 文字 4 项（`deepseek-flash`）：单笔中文口语（1257ms → `confirmed`）、单句多笔拆分（2054ms → 2 条 `confirmed`）、缺金额追问补丁（1823ms + 1051ms → `confirmed` 保留商户）、v1.4 退款文本（1330ms → `MISSING_ORIGINAL_TRANSACTION` → `ORIGINAL_NOT_FOUND_RECORDED`）；
    - 小票图片 OCR 2 项（`/v1/tools/ocr` + `deepseek-flash`）：多金额 PNG 小票（`SUBTOTAL 58.00 / DISCOUNT -8.00 / PAID 50.00 RMB`，3799ms）准确抽取实付 `50` 元与受控 `sourceRef`，写入 SQLite `amount_cents=5000, source_modality='image'`；纯白空白 PNG（9077ms）判定 `UNREADABLE_RECEIPT` 不伪造草稿；
    - 语音 ASR 2 项（`/v1/tools/asr` + `deepseek-flash`）：合成中文语音 WAV（`昨天下午打车去高铁站花了三十八块五`，2271ms）准确转写并抽取 `38.5` 元与受控 `sourceRef`，写入 SQLite `amount_cents=3850, source_modality='voice'`；1 秒静音 PCM WAV（171ms）返回 `EMPTY_TRANSCRIPT`。
  - 全仓静态与单测：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend test`（27 文件 206 项）、`pnpm --filter frontend test`（12 文件 73 项）、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 全部通过。
- **人工审核**：PR [#30](https://github.com/Tarnishedtaffy/2026gdufai/pull/30) 已更新并提交，待 reviewer 审核。
- **遗留问题**：`POST /api/capture/uploads` 与 `POST /api/capture/extract` 路由挂载及前端附件闭环待 #23（v1.5）冻结后按 #24 写入 v1.6 契约推进。

### LOG-mianyoubiaoqing-20261120-03

- **时间**：2026-11-20 15:17（+08:00）
- **工具/模型**：Antigravity / Orchestrator
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-extraction` / [#30](https://github.com/Tarnishedtaffy/2026gdufai/pull/30)
- **任务**：全面修复 PR #30 复审指出的 1 项 P1、2 项 P2 与 6 项 P3 问题，补齐回归测试并更新 PR 回复。
- **关键提示词**：
  - 读一下 PR 的 comment
  - 开始吧（用户确认修复 PR #30 复审提出的 P1 + P2 + 全部 P3 问题）
- **代理做了什么**：
  - **P1 凭据防错发**：清空 `.env.example` 中的 `LLM_API_BASE_URL`、`LLM_MODEL`、`ASR_MODEL` 默认值（保留注释说明），并在 `backend/src/config/ai.ts` 为 `DEEPSEEK_API_KEY` 回退增加跨厂商拦截（回退密钥流向非 DeepSeek 地址时直接抛出配置错误）；补充基于真实 `.env.example` 解析的回归测试。
  - **P2 反馈码与超时保护**：在 `normalizers.ts` 的 `ACTIVE_CONTRACT_FEEDBACK_CODES` 补全 `#23`（v1.5 §6）已冻结的 4 个反馈码（`ORIGINAL_TRANSACTION_AGED`、`PARTIAL_REPAYMENT_RECORDED`、`AMBIGUOUS_LOAN_PAYMENT`、`ORIGINAL_ALREADY_SETTLED`）；重写 `provider.ts` 为 `runRequestWithTimeout`，用统一 `AbortController` + `Promise.race` 覆盖响应头等待及 `response.json()`/`text()` 读取全生命周期，并补充响应体卡住回归测试。
  - **全部 P3 收口**：`deepseek-tools.ts` 增加 WAV/Ogg Opus 与 ≤8 MiB 预检；`normalizers.ts` `normalizeOccurredAt` 保留输入毫秒精度；`ai.ts` 增加 `AI_TIMEOUT_MS <= 2_147_483_647` 上限；`extractor.ts` 语音路径在调用付费 ASR 前先校验 `referenceTime`；`schema.ts` 移除模型 `patch.rawText` 覆写分支、仅保留 `appendRawText` 追加；同步更新 PR #30 正文明确 `#24` 待冻结状态及内部失败码与 HTTP 错误码映射关系。
- **决策**：
  - 同时采用「模板留空 + 运行时跨厂商校验」双重防线，既满足复制 `.env.example` 后仅填 `DEEPSEEK_API_KEY` 的快捷体验，也杜绝显式改坏 URL 时把 DeepSeek Key 发往第三方。
  - `ACTIVE_CONTRACT_FEEDBACK_CODES` 在本 PR 内直接补全 22 个现行码（v1.4 18 码 + `#23` v1.5 4 码），待 `@gduf/capture-flow` 后续统一注册表后再复用，确保 v1.5 合入后不阻断追问。
- **验证**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend exec vitest run`（27 文件 210 项，含 M1 #6 5 文件 25 项）、`pnpm --filter frontend exec vitest run`（12 文件 73 项）、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 与 LF/EOF 检查全部通过。
- **人工审核**：PR #30 修复已推送并回复复审人 `@Tarnishedtaffy`，待复审通过。
- **遗留问题**：`#24` 仍处于「有条件确认 / 待正文冻结」阶段，待 `#23`（v1.5）合并且 `#24` 补齐 §2.10/§2.6 确认后再挂载 `/api/capture/*` 路由并执行内部失败码到契约 HTTP 错误码的映射。

### LOG-mianyoubiaoqing-20261120-04

- **时间**：2026-11-20 16:02（+08:00）
- **工具/模型**：Antigravity / Orchestrator
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-extraction` / [#30](https://github.com/Tarnishedtaffy/2026gdufai/pull/30)
- **任务**：修复 PR #30 二轮复审及追加 P3（`@Tarnishedtaffy`、`@yukacezar569-blip`）指出的上传存储安全边界（P1/P2/P3）、DeepSeek ASR 时长预检与跨服务源密钥守卫。
- **关键提示词**：
  - 读一下 PR 的新 comment
  - 读一下新 comment，然后一起修了吧
- **代理做了什么**：
  - **P1/P3 受控存储安全边界（`backend/src/modules/capture/storage.ts`）**：读写路径均先校验 `uploadDir` 与各层子目录 `YYYY`/`MM` 非符号链接且 `realpath` 严格位于 `realpath(uploadDir)` 内；`saveCaptureUpload` 取消跟随符号链接的 `mkdir(..., { recursive: true })`，改为逐级 `mkdir` + `lstat` + `realpath` 并以 `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` 独占创建常规文件（Windows `O_NOFOLLOW` 为 `undefined` 时安全回退为 `0` 且保留逐级 `lstat` + `realpath` 校验）；`readCaptureUpload` 改为先逐级 `lstat`/`realpath`，再以 `O_RDONLY | O_NOFOLLOW` 打开句柄，交叉校验 `handle.stat()` 与 `realpath` 的 `dev`/`ino`、拒绝 `nlink > 1` 多硬链接，并在读取前按图片 ≤ 10 MiB / 语音 ≤ 15 MiB 校验 `size`（防 TOCTOU 与大文件读入内存）。
  - **P2 原型链继承键防护**：将 `storage.ts` 的 `MIME_SPECS`、`EXT_TO_MEDIA` 及 `deepseek-tools.ts` 的 `MIME_TO_IMAGE_EXT` 全部重构为 `Map`，彻底拒绝 `constructor`、`__proto__`、`toString` 等继承属性。
  - **P3 ASR WAV 120s 预检与跨源密钥守卫**：在 `deepseek-tools.ts` 增加 RIFF/WAVE 头解析 `estimateWavDurationSeconds`，对超 120 秒 WAV 本地拦截并返回 `UPLOAD_TOO_LARGE`（Ogg Opus 时长约束同步记入 README/ADR-0002）；将 `backend/src/config/ai.ts` 的跨主机拦截推广到全部配置——`OCR_API_BASE_URL` / `ASR_API_BASE_URL` 与 `LLM_API_BASE_URL` 不同源（origin）且未独立配置密钥时直接抛错，防止非 DeepSeek 场景跨主机透传 `LLM_API_KEY`。
  - **回归测试**：在 `backend/test/capture/multimodal-pipeline.test.ts` 与 `openai-compatible-provider.test.ts` 新增原型链 MIME 键拒绝、年/月两级父目录 symlink（Windows junction / POSIX dir）读写拒绝、多硬链接拒绝、读取超大文件拒绝、WAV > 120s 预检与非 DeepSeek 跨源 Key 拦截至 28 项 M1 #6 单元测试全部覆盖。
- **决策**：
  - `readCaptureUpload` 与 `saveCaptureUpload` 同时采用逐级 `lstat`/`realpath` 与 `fd.stat()` 节点比对，既消除 POSIX TOCTOU / hardlink / O_NOFOLLOW 风险，也保证跨平台（Windows + Linux 容器）一致生效。
  - 仅在相同 `origin`（scheme + host + port）时允许 OCR/ASR 回退复用 `LLM_API_KEY`，协议降级或不同域名一律要求显式配置独立密钥。
- **验证**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend exec vitest run`、`pnpm --filter frontend exec vitest run`、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 与 LF/EOF 检查全部通过。
- **人工审核**：PR #30 修复已推送并回复 `@Tarnishedtaffy` 与 `@yukacezar569-blip`，待复审通过。
- **遗留问题**：`#24` 对外路由与完整上传识别闭环、Ogg Opus 路由层时长校验以及 `CaptureResult` 新增字段待 `#23`（v1.5）合并与后续 PR 推进。

### LOG-mianyoubiaoqing-20261121-01

- **时间**：2026-11-21 12:38（+08:00）
- **工具/模型**：Antigravity / Gemini
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-routes` / 本地暂存待发（关联 [#6](https://github.com/Tarnishedtaffy/2026gdufai/issues/6)、[#23](https://github.com/Tarnishedtaffy/2026gdufai/issues/23)、[#24](https://github.com/Tarnishedtaffy/2026gdufai/issues/24)）
- **任务**：对齐契约 #23（v1.5）与 #24（v1.6）讨论口径，在 PR #30 合入后的 `upstream/main` 上预备实现 M1 `/api/capture/uploads` 与 `/api/capture/extract` 路由、`storage.ts` 有界分块读与过程问题文档更新。
- **关键提示词**：
  - 还有我们的工作吗？ / 一起做了吧 / pr30 已合并，继续吧（用户选择：拉取 `upstream/main` 切新分支提前写好 `/api/capture/*` 路由、测试与 `PROBLEMS_AND_GAPS.md`，本地验证后暂留待 `#24` 勾选冻结再提正式 PR）
- **代理做了什么**：
  - **GitHub 契约协作推进**：按 `@ONFAIL` 与 `@yukacezar569-blip` 达成的约束更新 [Issue #24](https://github.com/Tarnishedtaffy/2026gdufai/issues/24) 正文与标题为 **v1.6**（写入 §2.10 `mode`/`modality` 独立、`pendingFeedback` 调用前 `422 INVALID_CAPTURE_INPUT` 整次拒绝、`sourceRef` 双校验与不写库边界、§2.6 4 个最终错误码及 `#23` 版本依赖），@ 三位负责人复核勾选；并在 [Issue #23](https://github.com/Tarnishedtaffy/2026gdufai/issues/23) 补充 M1 识别端最终知悉确认。
  - **受控上传存储再加固（`backend/src/modules/capture/storage.ts`）**：抽出共享句柄打开校验 `openVerifiedUpload` 与有界分块读 `readHandleBounded`（以 64 KiB 分块读取并在超限时立即中止，消除读取瞬间文件追加导致的瞬时超限内存分配）；新增并导出 `verifyCaptureUploadRef` 供 `followup` 抽取校验 `sourceRef` 存在且与模态一致而不读文件内容进内存。在 `normalizers.ts` 补充 `pendingFeedback[i].field` 字符串校验。
  - **M1 对外 HTTP 路由实现（零新增 npm 依赖）**：在 `backend/src/shared/errors.ts` 新增 4 个契约错误码；新增 `backend/src/modules/capture/routes.ts` 注册 `POST /api/capture/uploads`（作用域流式受限 `multipart/form-data` 解析器，上限 15 MiB + 128 KiB 封装头，转调 `saveCaptureUpload` 返回 `201`，严格区分 `400/413/415 INVALID_UPLOAD`）与 `POST /api/capture/extract`（区分 `mode` 与 `modality`，`followup` 禁止改写原有 `modality`，验证 `sourceRef` 并严禁写库，精确映射 `CaptureFailureCode` 到 `400/413/415/422/502/503`）；在 `backend/src/app.ts` 接入 `AppDeps.captureExtractor`（缺省时安全回退为 `loadAiConfig({})` + `createOpenAiCompatibleProvider`）并注册 `registerCaptureRoutes`。
  - **文档与测试**：新增 `backend/test/capture/routes.test.ts`（覆盖 401 鉴权、>1 MiB 合法语音上传、大小/魔数/缺字段错误映射、`mode`/`modality` 冲突、`pendingFeedback` 422 且 0 AI 调用、空识别 422、AI 未配置 503 与上游 502、DeepSeek ASR 超 120s 413、HTTP 上传→抽取→`capture-flow` 确认→M2 落库完整闭环）并在 `multimodal-pipeline.test.ts` 补充多分块读取与 `verifyCaptureUploadRef` 测试；在 `docs/PROBLEMS_AND_GAPS.md` 追加 `P-003`–`P-006` 与未完成项；在 `README.md` 补充 `UPLOAD_DIR` 真实目录与 Linux/Windows 符号链接防护差异说明。
- **决策**：
  - `POST /api/capture/uploads` 在不新增 `@fastify/multipart` 依赖的前提下，通过路由作用域 `addContentTypeParser('multipart/form-data', { bodyLimit })` 流式累加字节并在超限时立刻终止，再由 Node 22 原生 `Response.formData()` 解析校验单文件，保持 `backend/package.json` 与 Docker 镜像依赖面不变。
  - 遵照 `AGENTS.md` §2 与用户选择，本次仅提交在本地 `feat/m1-capture-routes` 分支，等待 `#24` 获契约维护方与前端负责人勾选冻结（并视情况同步 `docs/contracts/module2-interface-v1.md` v1.6 正文）后再发起正式 PR。
- **验证**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend exec vitest run`、`pnpm --filter frontend exec vitest run`、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 与 LF/EOF 检查全部通过。
- **人工审核**：代码与测试已在本地分支完成自验，待用户确认是否先行推 Draft PR 或等 `#24` 冻结后推正式 PR。
- **遗留问题**：`docs/contracts/module2-interface-v1.md` v1.6 正文待 `#24`（并顺接 `#23` v1.5）正式冻结后由契约组或在对应 PR 中落盘；前端 `CaptureAttachmentEntry.vue` 对 `/api/capture/*` 的接入与浏览器端到端验收待后端路由与前端联调推进。

### LOG-mianyoubiaoqing-20261121-02

- **时间**：2026-11-21 16:22（+08:00）
- **工具/模型**：Antigravity / Gemini
- **模块 / 分支 / PR**：M1 / `feat/m1-capture-routes` / [#35](https://github.com/Tarnishedtaffy/2026gdufai/pull/35)（Draft）
- **任务**：回应 `#24` `@yukacezar569-blip` 正文补充意见并推送 Draft PR #35；随后按 `@Tarnishedtaffy` 在 PR #35 初审的 P1 与 P3 意见完成修改、补测并回复。
- **关键提示词**：
  - 2 吧（推送并创建 Draft PR #35）
  - 方案 B 吧（P1 选择先把反馈码白名单回退对齐当前 `main` 的 v1.4 18 码，并同步完成初审全部 P3）
- **代理做了什么**：
  - **同步 `#24` 与发起 Draft PR #35**：在 `#24` 正文 §2.10.2 与 §2.6 补充明确「`draft` 校验顶层 `modality`、`followup` 校验 `currentDraft.modality` 且不要求顶层 `modality`」，回复 `@yukacezar569-blip`；推送 `feat/m1-capture-routes` 至 fork 并发起 Draft PR #35。
  - **P1（方案 B）**：按 `#24` §2.10.2 回退兜底原则与用户确认的方案 B，从 `backend/src/modules/capture/normalizers.ts` `ACTIVE_CONTRACT_FEEDBACK_CODES` 暂时移除尚未并入 `main` 的 `#23` v1.5 四个反馈码（严格对齐当前 `main` §1.5 的 18 个现行码），并将 `followup-extraction.test.ts` 与 `routes.test.ts` 改为断言这 4 个未合并码在当前 `main` 基线下被 422 拒绝、同时放行现行 v1.4 码。
  - **P3 全部收口**：在 `backend/src/modules/capture/routes.ts` 的 `multipart/form-data` 解析器补充有界缓冲（≈3 倍峰值 ≈45 MB/并发）设计注释；在 `mode: "draft"` 分支对 `pendingFeedback`、`followupText`、`currentDraft` 三个仅属 `followup` 阶段的字段严格返回 `422 INVALID_CAPTURE_INPUT`；在 `routes.test.ts` 补齐 `currentDraft.modality === 'text'` 携带非 null `sourceRef`（422）、`pendingFeedback[0].field` 非字符串（422）及 `draft` 模式拒绝追问字段的回归用例。
- **决策**：
  - P1 采用方案 B（对齐当前 `main` 18 码），使 PR #35 与 `#23`/`#32` 合入顺序解耦——一旦 `#24` 完成冻结确认即可独立合入，待 `#23`（v1.5）落地 `main` 后再单独补回 4 个新码。
  - 确认 `buildApp` 缺省 `captureExtractor` 且未配 `config.ai` 时回退 `loadAiConfig({})` 返回 `503 AI_UPSTREAM_ERROR` 属于预期隔离设计。
- **验证**：`pnpm -r typecheck`、`pnpm -r lint`、`pnpm --filter @gduf/backend exec vitest run`、`pnpm --filter frontend exec vitest run`、`VITE_USE_MOCK=false pnpm --filter frontend build`、`git diff --check` 与 LF/EOF 检查全部通过。
- **人工审核**：Draft PR #35 已更新并回复 `@Tarnishedtaffy`；等待 `#24` 全部确认框勾选冻结后转为 Ready for Review。
- **遗留问题**：`#23`（v1.5）合并至 `main` 后需在 M1 `ACTIVE_CONTRACT_FEEDBACK_CODES` 补回其 4 个贷款反馈码；`docs/contracts/module2-interface-v1.md` v1.6 与前端附件闭环待 `#24` 冻结后按计划推进。
