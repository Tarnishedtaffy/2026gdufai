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
