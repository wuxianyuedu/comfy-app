<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/guides/TESTING.md`。改动请回源文件，再重新生成。 -->

# Comfy-APP-T3 测试与文档

> 测试分层:纯函数/store 用 node 环境,组件渲染用 jsdom;断言基于实现语义,
> 禁止为"让测试通过"而弱化断言。最后校准:2026-09-04。

## 快速开始

```bash
pnpm test               # 全量单测(vitest run)
pnpm test:coverage      # 覆盖率(v8,含棘轮阈值门槛)
pnpm typecheck          # tsc --noEmit
```

## 单元测试（Vitest）

### 配置
- 配置文件：`vitest.config.ts`
- 默认环境：node（纯函数/store，不依赖 DOM）
- 组件渲染：测试文件头 `// @vitest-environment jsdom`
- 路径别名：`@/*`、`~/*` → `src/*`
- 测试文件与源码同目录，命名 `*.test.ts(x)`
- `globals: false`：显式 `import { describe, it, expect } from "vitest"`；
  RTL 不自动 cleanup，组件测试需 `afterEach(cleanup)`

### 测试栈与配方

| 层 | 工具 | 要点 |
|----|------|------|
| 纯函数 | vitest | 正常路径 + 边界 + 非法输入；文件名中文描述行为 |
| Zustand store | vitest | 每用例前重置状态（`setState` 初始值或 reset）；派生字段必须通过 action 触发（直接 setState 不会重算） |
| 组件渲染 | @testing-library/react + jsdom | `getByRole`/`getByText` 优先；交互用 `userEvent`；jest-dom 匹配器已在 `tests/setup.ts` 全局注册 |
| hooks | renderHook（@testing-library/react） | ReactFlow 等有 Provider 依赖的需包对应 Provider，否则跳过该分支并注明 |
| Tauri 壳冒烟 | tauri-driver / Playwright WebView（Windows），或脚本层冒烟 | 只测壳级能力：启动、custom-protocol、崩溃兜底/进程树清理、日志出口；业务/画布/数据流去 Web 层测（见规范第 11.10 节）。改动 src-tauri 需 `cargo build --release --features custom-protocol` 重编后跑 |

### 当前覆盖（231 用例 / 17 文件）

| 文件 | 覆盖模块 | 用例数 |
|---|---|---|
| `src/lib/workflow-types.test.ts` | 工作流类型映射（code→类型、类别、分类、边界值） | 7 |
| `src/lib/comfyui/markdown.test.ts` | Markdown 渲染（标题层级、列表、引用、XSS 转义、空输入） | 9 |
| `src/components/studio/workflow-utils.test.ts` | 画布颜色工具（hexToRgba、mixHex、lightenHex、边界） | 12 |
| `src/server/api/middleware/rate-limit.test.ts` | 限流中间件（滑动窗口、独立 key、过期重置） | 5 |
| `src/components/studio/AgentPanel.test.tsx` | AgentPanel（空态、四状态、回调、禁用态、头像兜底） | 8 |
| `src/components/studio/logs/log-store.test.ts` | 日志 store（批量追加/上限裁剪/过滤搜索/serialize/解析） | 53 |
| `src/components/studio/debug/debug-store.test.ts` | 调试开关 store（状态迁移、幂等） | 7 |
| `src/components/studio/workflow-library/CustomNodesSettings/parsing.test.ts` | 解析纯函数（pathKey/deriveRowState/splitPaths/eqArr） | 33 |
| `src/components/studio/workflow-library/WorkflowLibraryHelpers.test.ts` | 库卡片派生（格式标志/同步态/技术名/ago） | 27 |
| `src/lib/media.test.ts` | isVideo（扩展名/大小写/URL/查询串/边界） | 9 |
| `src/components/studio/canvas/SubgraphHeader.test.tsx` | 子图头（标题回退、折叠/钻入回调、IO checkbox 条件） | 12 |
| `src/components/studio/project-canvas/CanvasNode/CanvasNodePrimitives.test.tsx` | Field/StatusDot/StatusBadge/NodeChip | 11 |
| `src/components/studio/project-canvas/CanvasNode/ResultCard.test.tsx` | 结果卡（三分支、mediaType 判定、占位与回退） | 11 |
| `src/components/studio/shared/DynamicWorkflowForm/sections/*.test.tsx` | 表单分区（骨架/空态/I/O 端点 chip） | 10 |
| `src/components/studio/workflow-library/CustomNodesSettings/SettingsParts.test.tsx` | 设置行/值 chip/汇总/进度/报告卡 | 17 |
| （另 2 个文件为既有 lib 测试） | — | — |

### 新增测试指引
- 纯函数模块（lib 层、utils）优先补 `*.test.ts`
- 组件测试范例：`AgentPanel.test.tsx`（轻量交互）、`SubgraphHeader.test.tsx`（真实 Provider 包装）
- 断言基于实现语义编写，禁止为"让测试通过"而弱化断言

### 组件测试（@testing-library/react）

- 依赖已装：`@testing-library/react` / `user-event` / `jest-dom`（匹配器在 `tests/setup.ts` 全局注册）
- vitest 是 `globals: false`，RTL 不会自动 cleanup——测试文件里手动 `afterEach(cleanup)`
- 交互用 `userEvent.click`（比 `fireEvent` 更接近真实事件序列）
- jsdom 未实现的 Web API（clipboard、HTMLMediaElement.play）用 `vi.fn` 桩替换

## 覆盖率策略（棘轮制）

`pnpm test:coverage` 跑 v8 覆盖率并对**已覆盖目录**设硬阈值（低于即失败）：

| 目录 | 门槛（lines/funcs/stmts/branches） |
|------|------|
| `src/server/api/middleware/**` | 75 / 75 / 75 / 70 |

**规则**：新覆盖一个目录（测试补齐到 70%+）就把它加进 `vitest.config.ts` 的
`thresholds` 表并抬高数字；阈值只升不降。全库整体数字（当前 ~3%，组件库为主）
仅作参考，不设全局门槛——组件库的覆盖随功能测试逐步爬坡。

## 视觉回归（Playwright screenshot）

> 像素基线捕获布局/配色退化（画布、空态、弹窗、断点、深浅色），见规范
> [11-测试与可观测性.md](standards/11-测试与可观测性.md#118-视觉回归像素基线)。
> 方案**只此一套**（`toHaveScreenshot`），不引入 Chromatic / Vitest browser mode。

### 目录与运行

```bash
# 仅视觉基线用例
pnpm test:visual
# 全量 E2E（含 e2e/visual，测试全量时用）
pnpm test:e2e
```

- 用例放 `e2e/visual/*.visual.spec.ts`，命名带 `.visual` 便于 CI 单独筛选。
- 基线 PNG 与 spec 同目录（Playwright 默认 `*-snapshots/`），**提交入库**。
- 基线变更（合法 UI 改动）重录 + 人工 review：
  ```bash
  pnpm exec playwright test e2e/visual --update-snapshots
  ```
  重录后在 PR 描述标注「视觉基线已更新：<原因>」。失败 actual/diff 产物在
  `test-results/`（已 gitignore）。

### 确定性约束（防 flaky）

- 只截**钉死内容**：不碰时间戳/动画/骨架屏/DB 驱动列表；需要时用固定数据/mock。
- `playwright.config.ts` 已对截图统一关动画、隐藏光标、设 `threshold: 0.1`
  吸收抗锯齿差异。

### DOM 快照边界

Vitest `toMatchSnapshot` **禁止新增**用于断言整棵 DOM 结构（易碎且非像素退化）。
存量 `src/components/studio/**/__snapshots__/*.snap` 逐步按行为断言迁移，
视觉防退化统一走本节 Playwright 基线。

## API 文档（TypeDoc）

- 配置：`typedoc.json`
- 入口：`src/lib`、`src/server`、`src/trpc` 下非测试 TS 文件
- 输出：`docs/api`（HTML）
- 排除：`*.test.ts`、`node_modules`、`workflows`

## 已知边界与路线图

- [ ] `DynamicWorkflowForm` 主组件与 `CanvasNode` 主组件的行为测试（依赖 ReactFlow Provider，需 Provider 包装方案）
- [ ] tRPC router 集成测试（需 db mock 方案）
- [ ] Playwright 关键 E2E（登录 → 画布 → 生成链路）
- [ ] 存量 `.snap` DOM 快照按行为断言迁移，删除整棵结构快照（见 §11.9）
- [ ] `log-store.parseFileLogs`：`[WARNING]` 行当前回退 info 级（源码怪癖，测试已按现状断言并标注）
- [ ] Tauri 壳冒烟自动化落地：先按规范第 11.10 节定壳级清单与边界，壳改动 PR 跑 `cargo build --release --features custom-protocol` 重编 + 冒烟（Windows 环境）
