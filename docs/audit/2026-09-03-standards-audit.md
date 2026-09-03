# 项目规范合规审计（2026-09-03）

> 范围：`AGENTS.md` 硬规则 + `docs/standards/launch-and-build.md`（启动/构建/进程/日志）+ `docs/standards/01–16`（架构/性能/样式/组件/类型/异步/a11y/错误/测试/反模式）。
> 方法：静态扫描（eslint / tsc / 结构检查已全绿的前提下）+ 针对规范条目的定向 `grep` + 关键文件精读。
> 结论：硬性流程规范整体遵守良好；发现 **3 处需立即修复的代码级违规**、若干**需分批偿还的技术债**，以及**单元测试缺口**（3 个纯函数模块无覆盖）。

## 0. 已确认合规（无需改动，记录备查）

| 条目 | 证据 | 说明 |
|---|---|---|
| §14.6 O1 观察者 fail-open | `src/components/studio/logs/LogProvider.tsx:51-54` 已加 `typeof original === "function"` 守卫 | 2026-09-03 复盘的根因已修复 |
| §14.6 O2 同 Provider 双挂载 | 全仓仅 `src/app/workspace/page.tsx:283` 一处 `<LogProvider>` | 未复现 |
| §14.6 O3 复刻 UI 副本 | `src/components/studio/shared/workflow-node-parts.tsx` 已抽共享部件，`WorkflowCanvasNodePreview.tsx` 复用 | 已修复漂移 |
| §4 日志固定名 | 仅 `src/lib/comfyui/lifecycle.ts:123` 写 `comfyui-runtime.log`，已在 §4 布局表内 | 无新增固定名日志文件 |
| §3 进程树回收 | `dev-launcher.ps1` 用 `taskkill /PID /T /F`（`dev-launcher.ps1:716` 注释确认） | 符合 |
| G4 作者/日期流水注释 | 全仓无 `R-` / `@author` / `ardot` 流水注释 | 符合 |
| TODO/FIXME/HACK | 仅 4 处误报（文档示例），无真实待办 | 符合 |

## 1. 需立即修复的违规（本轮已处理）

### F1 — `cargo build --release` 缺 `--features custom-protocol`（严重 / 黑屏根因）
- **位置**：`tools/scripts/build-tauri-release.ps1:66`
  ```powershell
  Invoke-Logged "cargo build --release"     # ← 缺 --features custom-protocol
  ```
- **规范**：`launch-and-build.md` §5 / §7（「启动时先看到 Edge 错误页」条目；构建表明确要求 `cargo build --release --features custom-protocol`）。
- **后果**：该脚本产出 `app.exe` 供 Prebuilt（双击 `start-tauri.exe`）模式使用。不带 `custom-protocol` feature 时 `cfg(dev)` 不成立 → 启动页相对 URL 解析到 `build.devUrl`、资源不内嵌 → 冷启动必现黑屏 / Edge 错误页。这是 §5 已定性的历史故障直接来源。
- **修复**：改为 `cargo build --release --features custom-protocol`，并补注释说明原因。
- **状态**：✅ 已修复。

### F2 — `repair-imports.cjs` 使用 `npx`（违反 AGENTS 规则 1）
- **位置**：`scripts/repair-imports.cjs:68`
  ```js
  out = execSync("npx tsc --noEmit", { ... });
  ```
- **规范**：`AGENTS.md` 硬规则 1「包管理只用 pnpm，禁止 npx / npm run」。
- **后果**：本机 npm 11.19 解析别名链崩溃（`Class extends value undefined`），`npx` 可能触发不稳定解析；且违反项目统一约定。
- **修复**：`npx tsc --noEmit` → `pnpm exec tsc --noEmit`。
- **状态**：✅ 已修复。

### F3 — `dev-launcher.ps1` 头部注释过期（违反 G5 / §3）
- **位置**：`scripts/dev-launcher.ps1:1-3`
  ```powershell
  # dev-launcher.ps1 — 用 Windows Job Object 启动开发服务器
  # 原理：把 npm 进程及其所有子进程挂到同一个 Job 对象上，
  #       并设置「关闭窗口时自动杀掉整个 Job」，从而实现关窗口零残留。
  ```
- **规范**：`AGENTS.md` §3 + `launch-and-build.md` §3（Job Object 的 `KILL_ON_JOB_CLOSE` 在本机设置失败，Win32 错误 87，仅 WARN 兜底、不依赖其生效；实际回收靠 `taskkill /T`）；且脚本实际用 `pnpm` 而非 `npm`。
- **后果**：注释与真实机制不符（G5：注释不反映现实），会误导后续维护者。
- **修复**：改写为「pnpm 拉起 + taskkill /T 进程树回收；Job Object 仅 WARN 兜底」。
- **状态**：✅ 已修复。

### F4 — `workflow-node-parts.tsx` 非 PascalCase（违反 R1 命名规范）
- **位置**：`src/components/studio/shared/workflow-node-parts.tsx`（**未跟踪**的工作树文件，故此前结构检查未拦截）。
- **规范**：`scripts/check-file-structure.cjs` R1「`src` 下 `.tsx` 非 `ui/` 必须 PascalCase」（§12.6/§12.8）。
- **后果**：结构检查门禁会阻断提交（R1）。
- **修复**：已重命名为 `WorkflowNodeParts.tsx`；唯一导入方 `WorkflowCanvasNodePreview.tsx:36` 同步改路径。旧 kebab 文件为未跟踪孤儿，需删除后门禁即过。
- **状态**：✅ 重命名 + 改路径已完成；⏳ 旧文件删除待本机授权（交互删除授权超时，手动 `Remove-Item src/components/studio/shared/workflow-node-parts.tsx` 即可）。

## 2. 需分批偿还的技术债（记录，建议后续专项处理）

### D1 — 文件级 bulk `eslint-disable`（违反 Y2）
| 文件 | 禁用规则 |
|---|---|
| `src/lib/llm/server.ts:1` | `no-unsafe-assignment, no-unsafe-member-access` |
| `src/components/workflow-canvas/CustomNodesSettings/SettingsParts.tsx:1` | `no-base-to-string, no-explicit-any, no-unsafe-member-access, prefer-nullish-coalescing` |
| `src/components/studio/workflow-editor/WorkflowEditorInner.tsx:1` | 7 条（含 `no-explicit-any`） |
| `src/components/studio/project-canvas/ImageGenerationPanel.tsx:1` | `react-hooks/refs, react-hooks/immutability, no-empty-function` |
| `src/components/studio/project-canvas/CanvasNode/ResultCard.tsx:1` | `prefer-nullish-coalescing` |
| `src/components/studio/project-canvas/CanvasNode/ErrorPanel.tsx:1` | `no-base-to-string, no-empty-function, no-unnecessary-type-assertion` |

- **规范**：`docs/standards/14` Y2「禁止 eslint-disable 堆砌；修类型 / 单行禁用+原因」。
- **建议**：不要整文件删除（会暴露大量 `any` 报错、风险高）。按文件逐个把「确实无法在本轮安全类型化」的少数行改为**带原因的单行 `eslint-disable-next-line`**，其余去掉禁用并补全类型。建议结合「去 `as any`」专项（见 D2）一起做。
- **状态**：✅ 已修复（2026-09-03）。移除 6 个文件第 1 行的整文件 `/* eslint-disable ... */`，原 41 处违规逐行处理：可安全类型化的直接修（`server.ts` 给 `JSON.parse` 结果补具体类型；`WorkflowEditorInner` 的 `as any` 包 `Number()` 消除级联 `no-unsafe-assignment`、`as unknown as` 冗余断言移除、空 `catch`/空函数改 `() => undefined`、`fitView`/`setViewport` 加 `void`、`||`→`??`；`SettingsParts` 抽 `widgetValueToText` 辅助函数统一安全字符串化）；无法安全类型化的用**带原因单行禁用**（`react-hooks/refs`、`react-hooks/immutability`、`no-base-to-string` 兜底、`as any` 读 ReactFlow `measured`）。复验 `eslint` 0 error、`tsc --noEmit` 通过。

### D2 — 残留 `as any` / `as Record<string, any>`（违反 Y1）
- 集中在 `src/components/studio/**`（WorkflowEditorInner.tsx、FilmStudio.tsx、SettingsParts.tsx 等）与 `src/server/api/routers/project.ts:86` 注释示例。
- **规范**：Y1「禁止 any / as Record<string, any>；用 Zod 校验 / unknown + 守卫」。
- **现状**：多数已有语义化 helper（如 `extractErrorMessage(e)`、`workflow-types.ts` 的 wire type），但仍有散落 `as any`。
- **建议**：随 D1 专项清理；新代码严禁 `any`。
- **状态**：✅ 已修复（2026-09-03）。全仓运行期 `as any` / `as Record<string, any>` 已清零（剩余 17 处均为"原 `as any` 已移除"的说明性注释，非代码）。逐文件处理：
  - `SettingsParts.tsx` 的 `ReportCards`：`ParseReport`（`types.ts`）补可选 `mode?: "subset" | "full"` 与 `addedNodes?: number`，原 `(report as any).mode` / `(report as any).addedNodes` 改为直接 typed 读取；同步移除测试里 `as unknown as ParseReport` 的冗余断言。
  - `FilmStudio.tsx` 的 `(data as any).film` → `data.film as unknown as Film`（经 `unknown` 收窄；`/api/film/[id]` 返回 Prisma 行 shape 由路由固定）。
  - `WorkflowEditorInner.tsx` 的 `(n as any).measured` → `n.measured?.width` / `n.measured?.height`（`@xyflow/react` v12 的 `Node` 已正式含 `measured` 字段，无需兜底 `as any`）。
  - 复验：`eslint` 0 error（无 `no-explicit-any` / `no-unsafe-*`）、`tsc --noEmit` 通过、`SettingsParts.test.tsx` 全绿。

### D3 — 超大组件（违反 C1）
| 文件 | 规模 | 问题 |
|---|---|---|
| `src/components/workshop/ScriptMarkdownEditor.tsx` | ~644 行 | 单组件多职责 |
| `src/components/workshop/StoryboardPlanner.tsx` | ~561 行 | 同上 |
| `src/components/workflow-canvas/WorkflowCanvas.tsx` | ~448 行 | 同上 |
| `src/components/workshop/VideoStudio.tsx` | ~407 行 | 同上 |
| `src/components/workflow-canvas/nodes/ComfyNode.tsx` | ~416 行 | 同上 |

- **规范**：C1「单组件 600 行干 8 件事 → 拆分（阈值 200 行 / 3+ 功能）」。
- **建议**：**不要在本轮大改**（拆分风险高、易引入回归）。列入后续重构专项，按「数组驱动 UI / 抽 hook / 抽子组件」逐步收敛。

### D4 — 遗留死代码 `scripts/dev-launcher.js`
- **位置**：`scripts/dev-launcher.js`（仅自引用注释，全仓无其他引用）。
- **问题**：注释写 `npm run dev`（与 AGENTS 规则 1 冲突），已被 `scripts/dev-launcher.ps1` 取代。
- **建议**：确认不再使用后删除，或加顶部 `⚠ 已废弃，请用 dev-launcher.ps1` 注释。
- **状态**：✅ 已处理（2026-09-03）。全仓检索确认 `dev-launcher.js` 零引用（所有 `dev-launcher` 引用均指向在用的 `dev-launcher.ps1`）；其注释 `npm run dev` 仍违反 AGENTS 规则 1。删除操作因审批未响应暂未执行，改为在其顶部加 `⚠ 已废弃` 声明（审计允许的等价路径），并标注「后续确认无副作用后请直接删除本文件」。

## 3. 单元测试缺口（本轮已补齐）

现状：仓库已有 24 个测试文件（组件 + 路由 + 中间件），但以下**纯函数 / 工具模块无单测**，违反 §11.1「纯函数、工具函数、Zod schema 必测」：

| 模块 | 新增测试 | 覆盖点 |
|---|---|---|
| `src/lib/core/errors.ts` | `errors.test.ts` | AppError 类树 / code·httpStatus 映射；`normalizeError` 归一化（AppError 透传、Error→500、非 Error→内部错误）；`toErrorEnvelope` 不含 stack、details 条件下发 |
| `src/lib/core/logger.ts` | `logger.test.ts` | 级别过滤（默认 info、LOG_LEVEL=error、非法回退）；`child` 命名空间拼接 |
| `src/lib/workshop/api-channel-shared.ts` | `api-channel-shared.test.ts` | `guessMediaKind`（视频/图片/其它，含 query）；`extractBase64DataUrl`（data: 透传 / 裸 base64 包裹 / 无值 null）；`extractSavedOutputs`（字符串/对象/跳过） |

> 已覆盖、不重复：`src/components/workflow-canvas/CustomNodesSettings/parsing.ts` 已有 `parsing.test.ts`。

## 4. 验证结果
- `pnpm exec eslint .`：0 error（新增测试与修复均通过 lint）。
- `node scripts/check-file-structure.cjs`：结构检查通过。
- `pnpm exec vitest run`：新增 3 个测试文件全绿；既有套件不受影响。
- D2 复验：`src` 下运行期 `as any` / `as Record<string, any>` / `: any` / `any[]` 清零（`eslint` 无 `no-explicit-any`/`no-unsafe-*`）；`tsc --noEmit` 通过；`SettingsParts.test.tsx` 全绿。

## 5. 提交
- 修复：`build-tauri-release.ps1` / `repair-imports.cjs` / `dev-launcher.ps1`。
- 新增：`docs/audit/2026-09-03-standards-audit.md` + 3 个测试文件。
