# 性能审计整改报告（2026-09-26）

> 依据 `docs/standards/02-性能规范.md`（2.1/2.6/2.7/2.11）、`01-架构与状态管理.md`（1.1/1.2/1.10）、
> `08-异步与副作用.md`（8.5/8.6）、`14-反模式速查表.md`（P1–P7 / S1–S5 / C7）逐条排查。
> 整改跟随分支 `feat/perf-audit-fixes`，碎片落 `changelog.d/`，不直改 `CHANGELOG.md`。

## 总览

- **状态层质量高**：整库订阅 / 内联新对象选择器 / Context 承载高频态 / tRPC 抄 Zustand（S1–S3、1.1/1.2/1.7）—— 合规。
- **数据层合规**：N+1、热点列索引、Object URL 释放、竞态守卫、猴子补丁 —— 合规。
- **真实缺口**：无上限数组（内存泄漏）、定时器/监听器卸载泄漏、该虚拟化却直接 `.map`、布局属性动画、画布节点未 memo。

## 整改清单

### 🔴 P0 — 无上限数组（§2.1 / P1）—— 已修

| 文件 | 行 | 整改 |
|------|----|------|
| `src/components/workshop/hooks/use-workshop-agent.ts` | 85-92 | `messages`/`toolRuns` 加 `slice(-2000)` 环形截断 |
| `src/components/studio/project-canvas/hooks/use-task-step-log-stream.ts` | 158-164, 250-267 | 本地 `logs` 复用 `MAX_LOGS_PER_TASK=2000` + `tailWindow` |
| `src/components/studio/workflow-library/CustomNodesSettings/hooks/use-custom-nodes-settings.ts` | 419-422 | 解析日志加 `slice(-2000)` 截断 |

碎片：`changelog.d/0-perf-bounded-arrays.md`

### 🟠 P1 — 应修

**P1-a 定时器/监听器卸载泄漏（§8.5 / P7）—— 已修**

碎片：`changelog.d/0-perf-timer-listener-cleanup.md`
- `use-library-wire-flow.ts:141`、`use-workflow-import.ts:94`：4s 提示 `setTimeout` 无 `clearTimeout`。
- `ui/ToastProvider.tsx:78-98`：全局 `timers` Map 无卸载清理 effect。
- `WorkflowRunRawCliModal.tsx:155`、`use-custom-nodes-settings.ts:343`（裸 `setTimeout`）。
- `WorkflowCanvasDecorations.tsx:193-194`：拖拽中卸载泄漏 `window` 监听器。
- `src/lib/external-open.ts:134`：`addEventListener("blur")` 仅在条件 `settle()` 内移除。

**P1-b 大列表未虚拟化（§2.6）**
- `GlobalStepLogPanel.tsx:332`、`WorkflowRunLogModal.tsx:354`：300 行日志直接 `.map`，接入既有 `log-virtual` 基建。

**P1-c 布局属性动画（§2.7 / P3）**
- `AppUpdateSection.tsx:83`、`water-fill-progress.tsx:39`、`ui/sidebar.tsx:227/239/409/484`、`ui/navigation-menu.tsx:113/118`、`ui/progress-bar.tsx:132/135`、`ui/progress.tsx:48`：改 `transform`/`grid` 列宽。

**P1-d 画布节点未 memo（§2.11）—— 已修**
- `WorkflowLibraryCanvasNodes.tsx:39/83/115/130`：四个节点组件（`LibraryParamsNode`/`LibraryOutputsNode`/`LibraryHostNode`/`LibraryBackdropNode`）补 `React.memo`。

碎片：`changelog.d/0-perf-canvas-node-memo.md`

### 🟡 P2 — 合规债 / 低危（待排期）

- `ModelCard.tsx:58`、`WorkflowListItem.tsx:176`：`React.memo` 被 inline 对象/回调击穿（4.8/C7）。
- 9 处渲染期 `setState`（§2.4 / Y3）：`use-model-library`、`use-settings-page`、`use-model-adapters`、`use-llm-config`、`editable-label`、`use-content-asset-gallery`。
- 3 处 `eslint-disable react-hooks/set-state-in-effect` 压制：`use-task-step-log-stream.ts:137`、`workspace/page.tsx:123,164`。
- `src/app/api/health/route.ts:2-3,32`：越界直连 `db`+`drizzle-orm`（§1.10）。
- `repository-user.ts:240-258`：`replaceAll()` 循环内逐条 `update/insert` → 批量 upsert/事务。
- `CharacterPortraitStudio.tsx:108`：点击拉取未加 `AbortController`/`cancelled`。
- `workspace/page.tsx:131` 导航历史栈只 dedup 不 trim；`use-workshop-pipeline.ts:306` `session.log` 无 slice；`use-training-studio.ts:164` 数据集逐张追加。

## 已合规（对照，不改动）

- 状态层：S1–S3、1.1/1.2/1.7。
- 数据层：N+1、热点列索引、Object URL、竞态守卫、猴子补丁。
- 正例：`ModelLibrary.tsx`/`LogPanel.tsx` 虚拟滚动；`message-center-store`/`stepLogCache`/`workflow-run-store`/`character-portrait` 环形缓冲；`nodeTypes` 模块级常量。
