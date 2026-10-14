## Fixed

- **全仓「失效指路」扫尾**：#1920 那轮清的是炼丹功能删除后的引用，这一轮按同一口径
  （规范 §12.4.2：指路必须为真，历史归 `git log`）把**其余仍在指向已搬走 / 已改名落点**
  的引用一并纠正 —— 它们同样能编译、能过门禁，错的是「读它的人得到的事实」。
  - **文档（`docs/standards` / `docs/guides` / `docs/glossary.md` / `docs/DESIGN.md`）**：
    模块进子域后仍写旧路径的当前态指路全部改到真身 ——
    `src/lib/app-runtime-log.ts` → `src/lib/log/app-runtime-log.ts`、
    `src/lib/log-file-client.ts` → `src/lib/log/log-file-client.ts`、
    `src/lib/log-session-scope.ts` → `src/lib/log/log-session-scope.ts`、
    `src/lib/capture-streams.server.ts` → `src/lib/log/capture-streams.server.ts`、
    `src/lib/log-paths.ts` → `src/lib/log/log-paths.ts`、
    `src/lib/dev-server-id.ts` → `src/lib/shell/dev-server-id.ts`、
    `src/lib/code-update-since-load.ts` / `stale-store-instance.ts` / `stale-store-notify.ts`
    / `shell-tabs-store.ts` / `window-controls-client.ts` → `src/lib/shell/**`、
    `src/lib/comfy-embed.ts` / `comfy-tab-client.ts` / `comfy-readiness-client.ts` → `src/lib/comfy/**`、
    `src/lib/open-in-browser.ts` → `src/lib/shell/open-in-browser.ts`、
    `src/lib/process-launch.ts` → `src/lib/process/process-launch.ts`、
    `src/lib/materials.ts` → `src/lib/media/materials.ts`、
    `src/lib/workflow-types.ts` / `workflow-io-types.ts` / `workflow-run-store.ts` → `src/lib/workflow/**`。
    另纠正三处**改名/大小写**漂移：`src/env.ts` → `src/env.js`、
    `src/components/ui/Icon.tsx` → `src/components/ui/icon.tsx`、
    `tests/overlay-z-scale.test.ts` → `src/lib/shell/overlay-z.test.ts`；
    日志契约测试 `src/server/lib/logger.test.ts` → `src/lib/core/pino-contract.test.ts`。
  - **源码注释**：`api/logs/app-runtime/route.ts`、`log/log-file-client.ts`、`log/log-paths.ts`、
    `media/media-kind.ts`、`studio/logs/LogProvider.tsx`、`studio/TitleBarTabs.tsx`、
    `lib/shell/overlay-z.ts` 里指向旧落点的引用同步改到真身；
    `media-kind.ts` 那句「为什么放 `src/lib/` 根」的论据已随目录归位失真，改写为当前真实理由
    （叶子判据与带 IO 的 `materials.ts` 分层，不是目录归属）。
  - **术语表**：`设置浮层（SettingsOverlay）` 这一条已随该形态退役彻底过期，
    改写为当前形态 `设置视图（SettingsView）`（挂工作区页签与 `/route` 两个点）。
  - **审计台账**：`docs/guides/PRODUCTION-GAPS.md` 里 `errorSuggestion` 规则表的落点由
    已删的 `CanvasNode/error-suggestions.ts` 纠正为真身 `src/lib/comfyui/error-advice.ts`。
  - 生成物 `docs/generated/**` 与 `docs/api/**` 同步重生成（不手改）。

  刻意**不动**的三类（与 #1920 同口径）：`changelog.d/**` 与 `docs/audits/**` 历史台账；
  已用 `~~删除线~~` / 「已删 / 已迁 / 当时」明确标成历史形态的叙述（含排障手册的症状→根因
  快照）；以及本就存在的**构建产物路径**（`src/generated/customNodes.manifest.json`、
  `scripts/executor-host.runtime.mjs` 等，不构建即不存在）。
