# 画布调试模式（渲染链路标签）设计

- 日期：2026-08-24
- 状态：已确认（用户批准方案 A，范围扩展至项目画布）
- 范围：
  - 工作流画布（`src/components/updream/wf-*`）
  - 项目画布（`src/components/updream/ProjectCanvas.tsx` + `canvas/` 系列）

## 背景

画布上的节点不易看出其由本项目哪些代码模块支撑。工作流画布现有 `PackageFooter` 仅展示来源包名（如 "DaSiWa-Nodes"）；项目画布（`ProjectCanvas` + `canvas/CanvasNode`）节点无任何源码定位信息。目标是增加一个"调试模式"：开启后每个节点卡片上直接叠加显示该项目节点实际经过的渲染链路模块，方便开发时定位代码。

## 目标

- 两个画布（工作流画布 + 项目画布）的顶栏均提供"调试模式"开关，开启后节点卡片上常驻显示渲染链路模块标签。
- 零映射表维护：不建 `节点类型 → 文件` 静态表，标签内容跟随实际渲染实现。
- 关闭时不影响现有 UI 与性能。

## 非目标

- 不做自定义节点包源文件的溯源展示（已有 PackageFooter 覆盖）。
- 不做文件跳转打开（Tauri command 等），仅展示路径 + 点击复制。
- 不做开关状态持久化（开发工具，默认关闭）。

## 架构

| 文件 | 变更 | 职责 |
|---|---|---|
| `src/components/updream/debug-store.ts` | 新增 | 顶层 Zustand 单例：`debugMode: boolean` + `toggleDebugMode()`。两个画布共用同一开关（同一时刻仅一个画布打开）。 |
| `src/components/updream/DebugChainFooter.tsx` | 新增 | 通用标签组 UI：小 pill 横向 wrap，点击复制完整相对路径，`title` 显示完整路径。两个画布共用。 |
| `src/components/updream/wf-render-chain.ts` | 新增 | 工作流画布链路计算：`getRenderChainModules(classType): RenderChainModule[]`。`RenderChainModule = { file: string(相对路径), label: string(短名) }`。 |
| `src/components/updream/wf-editor-topbar.tsx` | 修改 | 工作流画布 header 右侧加"调试"toggle 按钮，读写 `debug-store`。 |
| `src/components/updream/wf-node.tsx` | 修改 | 订阅 `debugMode`，开启且非折叠时在 `PackageFooter` 下方渲染 `<DebugChainFooter />`。 |
| `src/components/updream/canvas/canvas-render-chain.ts` | 新增 | 项目画布链路计算：`getCanvasRenderChainModules(kind: NodeKind): RenderChainModule[]`。 |
| `src/components/updream/ProjectCanvas.tsx` | 修改 | 顶栏（内部 header 按钮区）加"调试"toggle 按钮，读写 `debug-store`。 |
| `src/components/updream/canvas/CanvasNode.tsx` | 修改 | 订阅 `debugMode`，开启时在节点卡片底部渲染 `<DebugChainFooter />`。 |

## 项目画布渲染链路计算规则

`getCanvasRenderChainModules(kind)` 判定：

1. 公共链路（所有节点）：
   - `src/components/updream/ProjectCanvas.tsx`（画布容器）
   - `src/components/updream/canvas/CanvasNode.tsx`（节点渲染器）
   - `src/components/updream/canvas/canvas-types.ts`（节点类型/元数据）
   - `src/components/updream/canvas/canvas-store.ts`（项目数据状态）
2. 按 `kind` 追加：
   - `workflow`：`src/components/updream/canvas/WorkflowNode.tsx`、`src/components/updream/shared/workflow-io.ts`
   - `image` / `video`：`src/components/updream/canvas/ImageGenerationPanel.tsx`、`src/components/updream/canvas/canvas-helpers.ts`（startGenerate/pollTask）
   - `script`：`src/components/updream/canvas/canvas-helpers.ts`（runScript）
   - `agent`：`src/lib/agent/agentic.ts`、`src/components/updream/canvas/canvas-helpers.ts`
   - `text` / `picture` / `movie`：`src/components/updream/canvas/ContentAssetNode.tsx`

注：`WorkflowNode.ardot.tsx` 为 ardot 场景变体（ProjectCanvas nodeTypes 中 `workflowArdot`），workflow 链路按实际渲染组件二选一：常规节点追加 `WorkflowNode.tsx`；ardot 节点追加 `WorkflowNode.ardot.tsx`。

## 工作流画布渲染链路计算规则

`getRenderChainModules(classType)` 判定：

1. 公共链路（所有节点）：
   - `src/components/updream/wf-node.tsx`（节点渲染器）
   - `src/lib/comfyui/types.ts`（端口/类型推断）
   - `src/lib/comfyui/node-titles.ts`（标题本地化）
2. 内置节点（`NODE_TYPE_REGISTRY` 命中 `classType`）追加：
   - `src/lib/comfyui/node-registry.ts`（节点配置定义处）
3. 自定义节点（`CUSTOM_NODE_TYPES` / `getCustomNodePackage` 命中）追加：
   - `src/config/customNodes.ts`（manifest 加载）
   - `src/app/api/custom-nodes/route.ts`（后端处理）

短名示例：内置 KSampler → `wf-node.tsx · node-registry.ts · types.ts · node-titles.ts`；
自定义节点 → `wf-node.tsx · customNodes.ts · types.ts · node-titles.ts · api/custom-nodes/route.ts`。

## UI 细节

- 开关按钮：工作流画布沿用 topbar 现有紫色 pill 按钮风格（如 RAW/API view switch）；项目画布在内部 header 按钮区加同风格 toggle。激活态高亮，`title="调试模式"`。
- 标签样式：延续 `PackageFooter` 的 monospace 小字（约 9-10px）、hairline border、rounded pill；多个标签 `flex-wrap` 排列；颜色使用琥珀/青色系与 PackageFooter 区分。
- 交互：每个标签 `title` 显示完整相对路径；`onClick` 复制完整路径到剪贴板（`navigator.clipboard.writeText`，失败静默）；`onPointerDown/onMouseDown` 必须 `stopPropagation`，防止 ReactFlow 拖拽干扰。
- 折叠节点不显示（工作流画布与 `PackageFooter` 的 `!isCollapsed` 条件一致；项目画布若节点卡片有折叠态同理）。

## 数据流

```
topbar toggle ──set──> debug-store (debugMode)
                              │ subscribe
                              ▼
WfNode ──debugMode=true──> DebugChainFooter ──classType──> getRenderChainModules ──> 标签组
CanvasNode ──debugMode=true──> DebugChainFooter ──kind──> getCanvasRenderChainModules ──> 标签组
```

## 错误处理与边界

- 无匹配 registry 且非自定义节点的 classType：只显示公共链路。
- note / subgraph 节点：只显示公共链路。
- 项目画布未知 kind：只显示公共链路。
- 剪贴板写入失败：静默忽略，不弹错。
- 开关默认关闭；store 为内存态，刷新即重置；两个画布共用开关，打开一个画布调试不影响另一个画布的数据，仅共享开关状态。

## 测试

- `pnpm tsc --noEmit` 类型检查通过。
- 手动验证（工作流画布）：
  1. 打开工作流画布，默认无调试标签。
  2. 点击"调试"开关，内置节点（如 KSampler）显示 4 个模块标签；自定义节点（如 rgthree）显示 6 个模块标签。
  3. 点击标签复制完整路径成功。
  4. 折叠节点不显示标签。
  5. 拖拽节点不受标签干扰。
  6. 关闭开关后标签消失，布局复原。
- 手动验证（项目画布）：
  1. 打开项目画布，默认无调试标签。
  2. 点击"调试"开关，workflow 节点显示 6 个模块标签；image 节点显示 6 个模块标签；text 节点显示 5 个模块标签。
  3. 标签显示/复制/拖拽行为与工作流画布一致。
  4. 关闭开关后标签消失。
