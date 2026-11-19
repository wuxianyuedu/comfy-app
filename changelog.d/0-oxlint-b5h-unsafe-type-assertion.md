## Changed

- **B5 子批 8：20 份 / 35 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批是画布核心与外壳族：`project-canvas/CanvasNode/hooks/**`、`project-canvas/hooks/**`、
  画布面板与 `ProjectCanvas`，以及 `VideoQueueModal` / `WindowControls` 与 4 份外壳测试。
  修法仍是「运行时校验 + 类型守卫」：
  - 拖放载荷：`JSON.parse` 落 `unknown`，`isMediaDropPayload` 按 `MediaDragPayload` 的
    真实档位（`image|video|audio|doc`）与必填字段逐项校验，畸形载荷直接丢弃。
  - SSE 帧：先判 `typeof ev.data === "string"`，再经 `isSseFrame` / `isStepLogEntry` /
    `isValidationErrorList` 逐层收窄，合法帧行为不变。
  - `Object.keys(NODE_META)` 统一改 `filter(isNodeKind)`（`Object.hasOwn`）；`shots` 逐项
    `isShot` 过滤；MiniMap 的 `node.data` 经 `isPlainRecord` + `isNodeKind` 收窄。
  - `statusMetaFor` 用 `isTaskStatus`（`Object.hasOwn`）索引状态表；拖拽目标用
    `instanceof Element` 收窄；`setNodes` 适配器改为显式块体，避免 void 表达式回传。
  - 测试侧：`delete window.__TAURI_INTERNALS__` 改 `Reflect.deleteProperty`；
    `use-history-panel` 的 fetch mock 直传真实返回形状，不再 `as never`。
- 语义未变：合法输入结果一致；对畸形载荷才按运行时校验回落。
- 台账：B5 行改「清账中（子批1–8：160 份 / 335 处已清）」。

Refs #3181
