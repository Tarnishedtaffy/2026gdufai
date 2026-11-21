# 记账与消费分析 AI 助手

> 2026 GDUF AI Studio 考核 · 方向一 · 选题 A。
> 状态：开发中。本 README 中标注「待补」的部分随开发进度更新，**启动命令必须与实际一致**。

## 项目说明

用一句话、一段语音或一张小票照片完成记账；用自然语言查账（「上个月吃饭花了多少？」）；为类别或总额设定月度预算并在接近或超支时提醒。信息不全时系统主动追问，而不是猜一个数。

## 功能清单

| # | 功能 | 模块 | 状态 | 验证方式 |
|---|---|---|---|---|
| MVP-1 | 自然语言 / 语音记账 + 小票截图 OCR，识别结果可确认修正 | M1 | 开发中（后端识别抽取核心已就绪，待接上传/抽取路由与前端联调） | 单元测试 stub；端到端人工验证待补 |
| MVP-2 | 消费自动分类，按类别 / 时间维度统计 | M2 | 待补 | 待补 |
| MVP-3 | 自然语言查账（真实解析时间范围与类别） | M3 | 待补 | 待补 |
| MVP-4 | 月度预算设定与超支提醒 | M4 | 待补 | 待补 |
| 扩展 | 多轮追问、可视化报表、游戏化、异常消费审计 | — | 待补 | 待补 |

## 技术栈与架构

- 后端：Node.js + TypeScript + Fastify + SQLite（better-sqlite3）
- 前端：Vite + Vue 3 + TypeScript
- AI 能力：OpenAI 兼容协议统一适配（Node 22 原生 `fetch` 调用 Chat Completions JSON 文本/追问抽取、Vision 多模态小票识别与 `/audio/transcriptions` 语音转写，默认模型参考 `gpt-4o-mini` / `whisper-1`，支持阿里百炼、硅基流动等兼容服务商及 OCR/ASR 独立覆盖；选型见 [ADR-0002](docs/decisions/ADR-0002-m1-ai-provider-adapter.md)）
- 工程：pnpm workspace、Vitest、Docker Compose

架构与模块边界见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，选型理由见 [ADR-0001](docs/decisions/ADR-0001-tech-stack.md)。

## 快速开始

### Docker（推荐，评审使用）

```bash
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up --build
# 浏览器打开 http://localhost:3000
```

| 项 | 值 |
|---|---|
| 端口 | 默认 `127.0.0.1:3000`，宿主端口可用 `.env` 中的 `PORT` 调整 |
| 数据持久化 | Compose 命名卷 `app-data`（SQLite）与 `app-uploads`（上传文件） |
| 环境变量 | 见 [.env.example](.env.example) |

镜像以非 root 用户运行，由 Fastify 在同一端口托管 Vue 构建产物和 API。
构建和运行固定使用 `node:22.23.5-bookworm-slim` 及 Dockerfile 中的 digest，CI 使用 `.node-version` 中的同一版本；升级时同步更新这两处并重新验证。该标签已对照 [Docker 官方镜像清单](https://github.com/docker-library/official-images/blob/master/library/node) 和 registry manifest 核实。
`assets/` 中符合 Vite 默认八位 hash 命名的资源使用一年 immutable 缓存；所有 HTML（含 Vue 页面回退）及未版本化文件使用 `no-cache`，浏览器通过 ETag 重新验证。
镜像中的前端固定使用真实 API（`VITE_USE_MOCK=false`）。采集页支持手动填写/核对草稿并明确确认后提交 M2；图片/语音识别仍待接入，保留附件入口与提示。容器启动检查和记账流程回归分别验证。
数据库与上传目录在容器内固定为 `/app/data/app.db`、`/app/uploads`；`docker compose down` 保留数据，`down --volumes` 会删除数据。
部署与本地运行时，`UPLOAD_DIR` 应指向真实受控目录（勿经由不可控符号链接）；受控读写在 Linux 下通过 `O_NOFOLLOW`、`fstat` 与逐级 `realpath` 拦截符号链接与 TOCTOU，Windows 下 `O_NOFOLLOW` 回退并由逐级 `lstat` + `realpath` 校验兜底。

### 用户与鉴权变量（契约 v1.2）

| 变量 | 默认值 | 用途 | 实现状态 |
|---|---|---|---|
| `DEMO_USER_ID` | `u_001` | 单用户演示的唯一用户；入站记录的 `userId` 必须与之一致，否则整批 `INVALID_BATCH` | 已实现（服务端校验 + 前端 `VITE_DEMO_USER_ID`） |
| `APP_AUTH_TOKEN` | `change-me` | Bearer 鉴权令牌；为空或 `change-me` 时按开发模式放行 | 已实现（`/api/*` Bearer 校验） |
| `VITE_DEMO_USER_ID` | `u_001` | 前端构建期变量；必须与 `DEMO_USER_ID` 相同 | 已实现（未配置时按 `u_001`） |

Compose 构建自动使用 `DEMO_USER_ID` 设置前端的 `VITE_DEMO_USER_ID`。更换演示用户后执行 `docker compose up --build`；直接运行 Docker build 时可用同名 build arg 设置前端用户，并确保运行时 `DEMO_USER_ID` 相同。分开开发前后端时，在根 `.env` 中同时设置这两个变量。

启用 `APP_AUTH_TOKEN` 后，在页面的会话鉴权入口输入同一令牌。API 请求携带 Bearer 头；令牌仅保存在当前页面内存，刷新后重新输入。不要把令牌改成 `VITE_*` 变量或写入前端代码。生产必须配置非占位值。

### AI 服务变量（M1 多模态识别与抽取）

| 变量 | 默认值 | 用途 | 实现状态 |
|---|---|---|---|
| `LLM_API_BASE_URL` | `https://api.openai.com/v1`（仅设 `DEEPSEEK_API_KEY` 时为 `https://api.deepseek.com/v1`） | OpenAI 兼容服务基址 | 已接入 `loadAiConfig` 与适配器 |
| `LLM_API_KEY` | 空（`null`） | 文本与追问抽取密钥；未配置且无回退时返回 `AI_NOT_CONFIGURED` | 已接入（仅服务端读取，不入前端） |
| `LLM_MODEL` | `gpt-4o-mini`（DeepSeek 域名默认 `deepseek-flash`） | 文本与追问抽取模型名 | 已接入 |
| `DEEPSEEK_API_KEY` | 空（`null`） | 可选快捷回退密钥；未配置 `LLM_API_KEY` 时自动回退为 DeepSeek 默认地址与 `deepseek-flash`，并启用 `/tools/ocr` 与 `/tools/asr` | 已接入 |
| `OCR_API_BASE_URL` / `OCR_API_KEY` / `OCR_MODEL` / `OCR_PROTOCOL` | 地址默认复用 `LLM_*`；仅同源回退复用 `LLM` 密钥（跨源须配 `OCR_API_KEY`）；DeepSeek 默认 `deepseek-ocr` | 小票图片识别独立端点与协议覆盖 | 已接入 |
| `ASR_API_BASE_URL` / `ASR_API_KEY` / `ASR_PROTOCOL` | 地址默认复用 `LLM_*`；仅同源回退复用 `LLM` 密钥（跨源须配 `ASR_API_KEY`）；DeepSeek 默认 `deepseek-asr` | 语音转写独立端点与协议覆盖（DeepSeek 预检 WAV / Ogg Opus、≤ 8 MiB 及 WAV ≤ 120 秒；Ogg Opus 时长由上游与后续路由层约束） | 已接入 |
| `ASR_MODEL` | `whisper-1`（仅 `openai-asr` 使用） | 语音转写模型名 | 已接入 |
| `AI_TIMEOUT_MS` | `30000` | 外部 AI HTTP 请求超时毫秒数（`1–2147483647`，含响应体读取） | 已接入 |

#### 已有数据卷出现权限错误

镜像构建时的 `chown` 不会修复已经存在的命名卷。遇到 `EACCES` 或 SQLite 无法写入时，在原部署目录、使用原 Compose project 和镜像执行下面的维护流程。先停止所有写入这两个卷的服务；任何一步失败都先停止排查，备份未成功落盘前不要修改权限。

下面的备份目录和临时容器名称仅为示例，每次改用新的唯一名称；不要覆盖历史备份。离线归档同时保存整个 data 目录（含 SQLite WAL/SHM）和上传目录。
首次使用时先执行 `mkdir backups` 创建父目录；父目录已存在则跳过。

```bash
docker compose stop app
mkdir backups/permission-repair-20261117-01
docker compose run --name gdufai-backup-20261117-01 --no-deps --user 0:0 --entrypoint sh app -c 'tar -cpf /tmp/gdufai-volumes.tar -C /app data uploads'
docker cp gdufai-backup-20261117-01:/tmp/gdufai-volumes.tar ./backups/permission-repair-20261117-01/volumes.tar
tar -tf ./backups/permission-repair-20261117-01/volumes.tar
```

确认宿主机备份可以列出内容后，再运行修复并重新启动：

```bash
docker compose run --rm --no-deps --user 0:0 --entrypoint repair-volume-permissions app
docker compose up -d --no-build --wait
docker compose exec app id
```

修复脚本只调整两个现有卷中的属主以及属主的读写/目录进入权限，不跟随符号链接，不清空数据，也不使用 `chmod 777`。维护容器临时使用 root；正常应用仍以 `node` 用户运行。确认历史账单和上传文件可读后，可以用 `docker rm gdufai-backup-20261117-01` 删除备份临时容器，保留宿主机归档。
如果应用仍报错，保留卷、归档和临时容器继续排查；不要用 `down --volumes` 修复权限。宿主机 `backups/` 已排除出 Git 和 Docker 构建上下文。

### 本地开发

```bash
pnpm install
cp .env.example .env
mkdir backend/data          # 首次运行创建默认数据库目录
pnpm dev                    # 后端
# 另一个终端：pnpm dev:frontend
```

### 演示数据

待补：`data/samples/` 下的示例账单 CSV 与导入命令。

### CI/CD

[GitHub Actions](https://github.com/Tarnishedtaffy/2026gdufai/actions/workflows/ci.yml) 对面向 `main` 的 PR 和 `main` 提交执行：

- 冻结锁文件安装、前后端类型检查、已声明的 lint（当前为 backend）、全部 Vitest 测试及前端构建；前端构建产物保存 7 天。
- Docker 构建与启动，验证首页、Vue 路由、API 404、SQLite 迁移/预设类别、非 root 运行，以及重建容器后数据库和上传卷的持久化。
- 仅主仓库 `main` 的 push 在两项检查均通过后发布 **同一个已验证镜像**（Linux amd64）到 `ghcr.io/tarnishedtaffy/2026gdufai`，标签为 `main` 和 `sha-<完整提交 SHA>`。PR、fork 和手动检查均不发布；旧提交重跑只发布 SHA 标签。

发布使用该仓库的 `GITHUB_TOKEN`，只给发布 job `packages: write`；不需要新增 PAT 或 AI 密钥。
首次发布需仓库允许 Actions 写入 Packages；若同名包已存在，需为本仓库授予该包的 Actions 访问权限。包的可见性由负责人在 GHCR 设置，私有包拉取需先登录。
建议 reviewer 将 `install / typecheck / lint / test / build` 和 `Docker build / smoke` 设为 main 的必需检查；工作流本身不修改仓库保护规则。
本仓库使用私有仓库 Fork + PR 协作，管理员还需在 Settings → Actions → General 中允许 `Run workflows from fork pull requests`；无需开启向 fork 发送 secrets 或写权限。设置说明见 [GitHub 官方文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#enabling-workflows-for-forks-of-private-repositories)。

发布完成后，在 `.env` 中设置 `IMAGE_NAME=ghcr.io/tarnishedtaffy/2026gdufai:sha-<完整提交 SHA>`，执行：

```bash
docker compose pull
docker compose up -d --no-build --wait
```

`IMAGE_NAME` 只供 Compose 选择镜像。Compose 仅将非敏感的 `DEMO_USER_ID` 作为前端构建参数；其余服务端配置在运行时注入，不打包进前端。预构建镜像必须与其构建时的演示用户一致。
镜像回滚可切换到之前的 SHA 标签；已有数据库迁移需另外评估兼容性并备份。此流程提供持续交付，服务器部署仍由团队执行。

## 团队分工

> 仅使用 GitHub 用户名。日志文件名与用户名一致：`docs/agent-logs/<github-id>.md`。

| GitHub 用户名 | 角色 | 负责模块 | 个人日志 |
|---|---|---|---|
| `Tarnishedtaffy` | 主仓库负责人 / reviewer | 前端框架、Docker、代码审核、汇总日志 | [Tarnishedtaffy.md](docs/agent-logs/Tarnishedtaffy.md) |
| `mianyoubiaoqing` | 开发 | M1 多模态记账；游戏化、异常消费审计（暂领） | [mianyoubiaoqing.md](docs/agent-logs/mianyoubiaoqing.md) |
| `yukacezar569-blip` | 开发 | M1 多模态记账；M3 自然语言查账；答辩 PPT | [yukacezar569-blip.md](docs/agent-logs/yukacezar569-blip.md) |
| `Z_Wen` | 开发 | M2 分类入库与统计（主做分类算法）；M4 预算提醒 | [Z_Wen.md](docs/agent-logs/Z_Wen.md) |
| `huangsiting546` | 开发 | M2 分类入库与统计；M4 预算提醒 | [huangsiting546.md](docs/agent-logs/huangsiting546.md) |

M2 与 M4 同进程、由同一组负责；`docs/contracts/` 由该组维护。

## 项目文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) | AI 编码代理工作规则 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Fork + PR 流程、分支与 commit 规范 |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | 项目术语规范表 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 方案设计与模块边界 |
| [docs/contracts/](docs/contracts/) | 模块间接口契约 |
| [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | 编码规范 |
| [docs/AI_CODING_POLICY.md](docs/AI_CODING_POLICY.md) | AI 辅助编码规范 |
| [docs/decisions/](docs/decisions/) | 架构决策记录（ADR） |
| [docs/agent-logs/](docs/agent-logs/) | AI 辅助编码过程记录 |
| [docs/PROBLEMS_AND_GAPS.md](docs/PROBLEMS_AND_GAPS.md) | 遇到的问题与未完成项 |

## 在线 Demo

待补。
