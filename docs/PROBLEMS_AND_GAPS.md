# 问题记录与未完成项

> 考核交付物第 5 项要求「遇到的问题与解决方式、未完成的部分及原因」。各模块负责人随开发进度追加，答辩前由 reviewer 整理。

## 1. 问题与解决

| 编号 | 日期 | 模块 | 问题描述 | 原因分析 | 解决方式 | 关联 PR / 日志 |
|---|---|---|---|---|---|---|
| P-001 | 2026-11-16 | M2 | `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS`（esbuild） | pnpm 10+ 默认拦截依赖安装脚本；esbuild 需要 postinstall 下载平台二进制 | `pnpm-workspace.yaml` 增加 `onlyBuiltDependencies: esbuild` 后重装 | LOG-Z_Wen-20261116-02 |
| P-002 | 2026-11-16 | M2 | 担心 `better-sqlite3` 在 Node 26 无预编译包 | 版本 12 的预编译按 Node ABI 发布，Node 26 ABI 147 较新 | 实测 v13.2.0 自带 NAPI `prebuilds/win32-x64.node`，无需编译 | LOG-Z_Wen-20261116-02 |
| P-003 | 2026-11-19 | M1 | 模型输出裹挟 Markdown 代码块、夹带幂等键或将缺失字段填为 `0` /「未知」 | 大模型自由输出易破坏 `CaptureDraft` 空值规范与 M2 入站校验口径 | 在 `normalizers.ts` 与 `schema.ts` 实现代码块剥离、白名单重构（剥离身份/幂等字段）、占位词转 `null` 与日历时间验证，失败重试 1 次并保留 `+08:00` 毫秒精度 | PR #30 / LOG-mianyoubiaoqing-20261119-01、20261120-03 |
| P-004 | 2026-11-20 | M1 / Config | `.env.example` 填写 OpenAI 默认基址导致仅配 `DEEPSEEK_API_KEY` 时向 OpenAI 发送密钥，且非 DeepSeek 跨主机地址也可能透传 `LLM_API_KEY` | 模板默认值覆盖了代码层回退逻辑，早期仅校验了 DeepSeek 回退 | 清空 `.env.example` 的默认地址/模型；在 `backend/src/config/ai.ts` 用 `getEndpointOrigin` 强制同源（origin）才回退复用 `LLM_API_KEY`，跨源未配独立密钥直接报错 | PR #30 / LOG-mianyoubiaoqing-20261120-03、20261120-04 |
| P-005 | 2026-11-20 | M1 / AI | DeepSeek 未采用 Vision/Whisper 同形路径，而是提供独立 `/v1/tools/ocr` 与 `/v1/tools/asr`（WAV/Ogg Opus ≤ 8 MiB / 120s），且响应体流卡住不受 headers 超时保护 | 各兼容厂商 OCR/ASR 协议形状与音频容器限制差异大 | 在 `provider.ts` 以 `runRequestWithTimeout` 统一覆盖响应头与读体超时；新增 `OcrProtocol`/`AsrProtocol` 双协议分派及 `deepseek-tools.ts` 格式、8 MiB 与 WAV 120s 头部本地预检 | PR #30 / LOG-mianyoubiaoqing-20261120-02、20261120-03、20261120-04 |
| P-006 | 2026-11-20 | M1 / Storage | 上传存储曾存在父目录 symlink 逃逸、`MIME_SPECS` 命中原型链键、`lstat/readFile` 间 TOCTOU 与多硬链接/无读取大小上限隐患 | 仅检验末级文件并用普通对象索引 MIME；Windows 与 Linux `O_NOFOLLOW` 常量存在差异 | 查表全改用 `Map`；读写均逐级对 `uploadDir/YYYY/MM` 做非递归 `mkdir` + `lstat` + `realpath` 校验；读采用 `open(O_NOFOLLOW ?? 0)`、`fd.stat()` 核对 `nlink === 1` 与 `dev/ino` 及有界分块读（`readHandleBounded`） | PR #30 / LOG-mianyoubiaoqing-20261120-04、20261121-01 |

填写要点：写清现象 → 根因 → 方案 → 效果；涉及 AI 能力边界（模型输出不稳定、OCR 识别错误等）的问题，注明采用了哪种约束或绕过手段。

## 2. 未完成项

| 功能 | 完成程度 | 未完成原因 | 后续计划 |
|---|---|---|---|
| M1 `#6` 前端附件联调与端到端闭环 | 识别抽取/存储核心已合入（PR #30），`/api/capture/uploads` 与 `/api/capture/extract` 路由及单测已在 `feat/m1-capture-routes` 就绪 | `#24`（契约 v1.6）正文已对齐并待 `#23`（v1.5）冻结后由契约组/前端勾选确认；前端 `CaptureAttachmentEntry.vue` 仍待接入新接口 | `#24` 冻结确认后推进后端路由 PR 合入，并协同 `yukacezar569-blip` 与 `Tarnishedtaffy` 联调完整附件上传→识别→确认入库闭环 |
| DeepSeek ASR Ogg Opus 120 秒本地预检 | 已支持 8 MiB 预检与 WAV 容器 120s 头部解析拦截；Ogg Opus 时长暂由上游校验 | Ogg Opus 页头与 granule position 解析需额外容器解码逻辑 | 若线上大量使用 Ogg Opus 超长语音，再视需要补充轻量 Ogg 时长探测 |
| 扩展功能：游戏化与异常消费审计 | 暂领，尚未开始开发 | 团队优先保证 MVP-1 至 MVP-4 主链路与契约 v1.5/v1.6 收口 | 主链路合入后立项评估设计方案、库表扩展与前端展示位置 |
