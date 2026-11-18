# Agent 日志 · `Tarnishedtaffy`

> 写入者：`Tarnishedtaffy` 本人的代理，只追加到文件末尾。格式见 [README.md](README.md#条目模板)。
> 负责模块：见 [README 团队分工](../../README.md#团队分工)。本文件只记录本人开发会话；PR 汇总写入 [SUMMARY.md](SUMMARY.md)。

<!-- 在此线以下按时间顺序追加条目 -->

## LOG-Tarnishedtaffy-20261118-03

- 时间：2026-11-18 20:45 +08:00
- 工具 / 模型：Trae / DeepSeek-V4.1-Flash
- 模块：M1（维护者代修）
- 任务：修复 #13 删除附件入口导致的能力回归，恢复小票图片 / 语音附件选择
- 关键提示词 / 上下文：审查 #13 时发现 `CaptureView.vue` 移除了 main 上的 `input[type=file]`，而 README MVP-1 要求语音记账与小票截图，契约保留 `modality` / `sourceRef`
- 做了什么：
  - `CaptureView.vue` 恢复附件选择控件（`accept="image/*,audio/*"`），选择后写入 `sourceRef`（文件名）与 `modality`
  - 手工草稿提交时透传 `modality` / `sourceRef`，新建记录时重置
  - 新增 `frontend/src/utils/attachment.ts` 的 `modalityFromMimeType()`，音频按 `voice`、其余按 `image`
  - `capture-flow.test.ts` 增加 2 条模态推断用例
- 决策：本期只恢复附件引用，不读取文件内容、不做 OCR / 语音识别；识别未接入前 `rawText` 仍必填
- 验证：`pnpm -r typecheck` / `lint` / `test` 通过；frontend 42 例、backend 58 例
- 人工审核：待 M1 负责人确认
- 遗留问题：#13 的 fork 已 404，无法直接推送；#13 另有真实模式会话 provider 与构建耦合问题未处理

