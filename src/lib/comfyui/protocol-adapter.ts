// ComfyUI WS 协议适配层（Adapter）
//
// P3 refactor: isolates *protocol differences* between the
// standard ComfyUI WebSocket event stream and non-standard builds (kaytool
// v0.28).  The executor's `handleMessage` no longer hard-codes signal
// detection inline — it asks this adapter to classify each incoming WS
// message, so a new protocol quirk only touches this one file.
//
// Known kaytool v0.28 differences (from production logs):
//   • completion:  standard ComfyUI emits `executing` with `data.node ===
//     null` when the graph finishes; kaytool emits a dedicated
//     `execution_success` message instead (sometimes *multiple* times for
//     one prompt — the executor's `claimSettle` re-entry guard absorbs
//     duplicate deliveries, and history is polled afterwards because the
//     success signal lands *before* outputs are persisted).
//   • error:       standard ComfyUI emits `execution_error` with
//     `data.exception_message` (string); kaytool may emit a structured
//     object there — `friendlyError` peels the real `.message` /
//     `.exception_message`.
//   • executing:   both emit per-node `executing { data: { node } }`
//     events; the adapter exposes the node-started / node-finished
//     distinction so the executor can surface per-node ▶/✔ timeline logs.

/** Minimal structural view of a ComfyUI WS message (raw payload is `any`). */
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

/** Uniform signal categories the executor reacts to. */
export type ComfySignal =
  /** executing / progress — any liveness event that should renew the watchdog. */
  | "activity"
  /** executing with a real node — a node started. */
  | "node-started"
  /** executing with node === null — the previous node finished. */
  | "node-finished"
  /** progress {value,max} — sampling progress tick. */
  | "progress"
  /** task completed (standard `executing:null` or kaytool `execution_success`). */
  | "completion"
  /** task failed (`execution_error`). */
  | "error"
  /** anything else — ignore. */
  | "other";

export class ComfyProtocolAdapter {
  /** executing / progress — renew the per-task watchdog. */
  isActivity(msg: ComfyWsMessage): boolean {
    return msg?.type === "executing" || msg?.type === "progress";
  }

  /** executing with a non-null node — a node started executing. */
  isNodeStarted(msg: ComfyWsMessage): boolean {
    return msg?.type === "executing" && Boolean(msg.data?.node);
  }

  /** executing with node === null — previous node finished. */
  isNodeFinished(msg: ComfyWsMessage): boolean {
    return msg?.type === "executing" && msg.data?.node === null;
  }

  /** progress {value,max} tick. */
  isProgress(msg: ComfyWsMessage): boolean {
    return msg?.type === "progress";
  }

  /** Completion: standard ComfyUI uses `executing` with node===null; the
   *  kaytool build (v0.28) emits `execution_success` instead. */
  isCompletion(msg: ComfyWsMessage): boolean {
    return msg?.type === "execution_success" || this.isNodeFinished(msg);
  }

  /** Error: `execution_error` (exception_message may be a structured
   *  object in kaytool builds — friendlyError handles the peeling). */
  isError(msg: ComfyWsMessage): boolean {
    return msg?.type === "execution_error";
  }

  /** One-stop classification used by the executor's message handler. */
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

/** Singleton instance — the executor imports this and delegates all WS
 *  message protocol decisions to it. */
export const comfyProtocol = new ComfyProtocolAdapter();
