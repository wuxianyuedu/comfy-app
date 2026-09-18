// ComfyUI WS 协议适配层（Adapter）
//
// 本模块把「标准 ComfyUI 的 WebSocket 事件流」与
// 「非标准构建（kaytool v0.28）」之间的**协议差异**隔离在一处。
// 执行器的 `handleMessage` 不再内联硬编码信号判定，
// 而是把每条 WS 消息交给本适配器分类 ——
// 于是新的协议怪癖只会改这一个文件。
//
// 已知的 kaytool v0.28 差异（来自生产日志）：
// • 完成信号：标准 ComfyUI 在图跑完时发 `executing`，且 `data.node === null`；
// kaytool 改发一条专门的 `execution_success` 消息
// （同一个 prompt 有时会发**多次** —— 执行器的 `claimSettle`
// 重入保护会吸收重复投递；成功信号又先于产物落盘，
// 因此之后还要轮询 history）。
// • 错误：标准 ComfyUI 发 `execution_error`，其中
// `data.exception_message` 是字符串；
// kaytool 可能在那里发结构化对象 —— 由 `friendlyError`
// 剥出真正的 message，也就是那个 `.exception_message` 字段。
// • 执行中：两者都发按节点的 `executing { data: { node } }` 事件；
// 本适配器把「节点开始 / 节点结束」区分出来，
// 供执行器打按节点 ▶/✔ 的时间线日志，
// 也就是日志面板里的那一对。

/** ComfyUI WS 消息的最小结构视图（原始载荷是 `any`）。 */
export interface ComfyWsMessage {
  type?: string;
  data?: {
    prompt_id?: unknown;
    node?: unknown;
    value?: unknown;
    max?: unknown;
    exception_message?: unknown;
    [k: string]: unknown;
  };
}

/** 执行器会响应的统一信号类别。 */
export type ComfySignal =
  /** executing / progress —— 任何应重置看门狗的存活事件。 */
  | "activity"
  /** executing 且带真实节点 —— 某节点开始执行。 */
  | "node-started"
  /** executing 且 node 为 null —— 上一个节点跑完了。 */
  | "node-finished"
  /** progress 进度 —— 采样进度跳动。 */
  | "progress"
  /** 任务完成（标准构建的 executing:null 或 kaytool 的 execution_success）。 */
  | "completion"
  /** 任务失败（execution_error）。 */
  | "error"
  /** 其余一律忽略。 */
  | "other";

export class ComfyProtocolAdapter {
  /** executing / progress —— 重置该任务的看门狗。 */
  isActivity(msg: ComfyWsMessage): boolean {
    return msg?.type === "executing" || msg?.type === "progress";
  }

  /** executing 且节点非 null —— 某节点开始执行。 */
  isNodeStarted(msg: ComfyWsMessage): boolean {
    return msg?.type === "executing" && Boolean(msg.data?.node);
  }

  /** executing 且 node 为 null —— 上一个节点跑完。 */
  isNodeFinished(msg: ComfyWsMessage): boolean {
    return msg?.type === "executing" && msg.data?.node === null;
  }

  /** progress 进度跳动。 */
  isProgress(msg: ComfyWsMessage): boolean {
    return msg?.type === "progress";
  }

  /** 完成信号：标准 ComfyUI 用 executing 且 node 为 null；
   *  kaytool 构建（v0.28）改发 execution_success。 */
  isCompletion(msg: ComfyWsMessage): boolean {
    return msg?.type === "execution_success" || this.isNodeFinished(msg);
  }

  /** 错误：execution_error（kaytool 构建里的 exception_message
   *  可能是结构化对象 —— 由 friendlyError 负责剥出内容）。 */
  isError(msg: ComfyWsMessage): boolean {
    return msg?.type === "execution_error";
  }

  /** 执行器消息处理器调用的单点分类入口。 */
  classify(msg: ComfyWsMessage): ComfySignal {
    if (this.isNodeStarted(msg)) return "node-started";
    if (this.isNodeFinished(msg)) return "node-finished";
    if (this.isProgress(msg)) return "progress";
    if (this.isCompletion(msg)) return "completion";
    if (this.isError(msg)) return "error";
    if (this.isActivity(msg)) return "activity";
    return "other";
  }
}

/** 单例：执行器导入它，把所有 WS 消息的协议判定
 *  都委托给它。 */
export const comfyProtocol = new ComfyProtocolAdapter();
