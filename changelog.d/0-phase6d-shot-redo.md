## Added

- **单镜「退回让 AI 重做」（Phase 6 · P6-3b）**：用户对某一镜的图/视频不满意时，直接在画布该镜头节点上退回，让自主 run 在下一步只重做这一镜、不动其余。
  - 纯 reducer `applyShotRedo`（`src/lib/production/sync.ts`）：命中镜头 → 清 `imageUrl`/`clipUrl`、`status`/`clipStatus` 回 `idle`、`rev` 自增（`rev` 不在 `Shot` 类型上，作为 production/draft JSON 列的宽容扩展字段）。`rev` 自增正是 P6-1 规划器「被本 run 处理过且 rev 又变新 → 重新纳入待办」的显式信号，配合清空产出（`!hasImage`）双保险：run 在跑时下一 tick 就重做该镜。
  - 回写客户端 `requestShotRedo`（`shot-writeback.ts`）：草稿 + production 两处一并退回（与 `recordCanvasShotGeneration` 同构，画布/工坊互斥挂载不互相覆盖）。
  - UI：`SelectedToolbar` 加可选 `onRedo`（镜头节点才有），一枚「↺ 退回让 AI 重做」按钮；`CanvasNode` 在 `data.shotId` 存在时接入 → 本地先回落 idle、`requestShotRedo(getActiveId(), shotId)` 写回（IO 走 lib 客户端，视图不碰 fetch）。

## 说明

per-shot 干预走「清空产出 + rev 自增」双信号，与规划器/引擎既有 rev 语义一致，不新增状态源。端到端「AI 下一 tick 真重做该镜」需在有模型/ComfyUI 的环境实机验证。工坊侧镜头行的退回入口随真实镜头列表（P6-4）一并接入。
