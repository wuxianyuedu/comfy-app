// 队列状态的**类型**（服务端聚合与客户端展示共用）。
//
// 为什么单独一个文件：聚合实现在 `queue-status.server.ts`，它 `import
// "server-only"` —— 客户端若从那里 import 类型，打包器会因为 server-only 直接
// 报错（类型在 TS 里被擦除，但 `import` 语句不会）。类型放这里，两边都干净。

/** 本应用正在跑的那一个任务（单 GPU 串行，最多一个）。 */
export interface ComfyRunningTask {
  taskId: string;
  /** 工作流名（来自 `Task.workflowName`）；查不到时为 null。 */
  workflowName: string | null;
  /** 主模型文件名（从本次实际提交的图里认出来，见 `executed-model.ts`）；认不出为 null。 */
  model: string | null;
  /** 任务开始时刻（epoch 毫秒）—— 前端拿它算「已运行 mm:ss」。
   *  取自 `Task.claimedAt`（领取或首条进度帧定格），旧行退化成提交时刻。 */
  startedAt: number;
  /** 采样步数进度（0~100）。 */
  progress: number;
  /** 当前节点类名（`Task.progressNode` 里的 `classType`）；没有为 null。
   *  comfy-cli 那条进度事件源拿不到 `class_type`，此时就是 null。 */
  nodeType: string | null;
}

export interface ComfyQueueStatus {
  /** ComfyUI 是否可达。不可达时其余字段一律是空值，前端显示「离线」。 */
  online: boolean;
  /** ComfyUI 自己的排队口径 —— **含不是本应用提交的任务**（用户在原生界面排的也在这里）。 */
  comfy: { running: number; pending: number };
  /** 本应用当前在跑的那个。 */
  running: ComfyRunningTask | null;
  /** 本应用排队中（还没轮到）的任务数。 */
  queued: number;
}
