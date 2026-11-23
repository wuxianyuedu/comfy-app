/**
 * `zero-output-reason.ts` — 「零产物」失败的归因（ISSUE #4854）。
 * @module comfyui/zero-output-reason — 零产物收口的可归因失败原因（纯函数）
 *
 * 两阶段工作流（先文本扩展、后图像编辑）里，文本子图耗尽生成预算（thinking
 * 顶满 max_length）后，If/Else 开关会把图像支路**静默短路**：ComfyUI 侧
 * `status=completed`、全程无 execution_error，但 history.outputs 里只剩空文本
 * 预览 —— 收口若只报「无输出内容」，用户既不知道「图像分支根本没跑」，也读不出
 * 下一步该调 max_length / 关 thinking。
 *
 * 这里把收口现场**已有的**三份信号拼成一句可归因的失败原因（不新增探测）：
 *   ① 执行图（history 的 prompt[2]）里的输出类节点（SaveImage / SaveVideo / …）
 *      是否一个都没出现在 history.outputs —— 是即「输出分支未执行」；
 *   ② 任务日志的分节点进度（parseTaskLogProgress）：有节点已跑满（completed ==
 *      total）却仍无输出，把「顶满」的事实点名出来（如 TextGenerateV2 8196/8196）。
 * 纯函数、零 IO；证据不足时如实退回泛化文案（不臆造）。
 */
import { isRecord } from "~/lib/is-record";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { parseTaskLogProgress } from "~/lib/workshop/task-log-progress";

/** 输出类节点判据：ComfyUI 的落盘节点族（SaveImage / SaveVideo / SaveAudio /
 *  SaveAnimatedWEBP / SaveAnimatedPNG …）与视频合成（VHS_VideoCombine）。 */
function isOutputClassType(classType: string): boolean {
  return classType.startsWith("Save") || classType.includes("VideoCombine");
}

/** 执行图条目的类型守卫：节点是对象且 class_type 是字符串（输出类判据在调用处）。 */
function isOutputNodeEntry(entry: [string, unknown]): entry is [string, { class_type: string }] {
  const node = entry[1];
  return (
    isRecord(node) && typeof node.class_type === "string" && isOutputClassType(node.class_type)
  );
}

export type ZeroOutputFacts = {
  /** 本次执行图（prompt[2]：nodeId → { class_type, inputs }）；拿不到时给 null。 */
  executedWorkflow: unknown;
  /** 本任务的执行日志（内存缓冲即可）：解析分节点进度用。 */
  logs: ReadonlyArray<TaskLogEntry>;
  /** ComfyUI history 的 outputs（nodeId → 该节点产物）。 */
  outputs: Record<string, unknown>;
};

/** 已跑满仍无输出的节点最多点名几条 —— 失败原因要可读，不堆全部历史。 */
const MAX_LISTED_STAGES = 3;

export function describeZeroOutputFailure(facts: ZeroOutputFacts): string {
  const parts: Array<string> = [];
  const graph = isRecord(facts.executedWorkflow) ? facts.executedWorkflow : {};
  const executedIds = new Set(Object.keys(facts.outputs));
  const outputNodes = Object.entries(graph)
    .filter(isOutputNodeEntry)
    .map(([id, node]) => ({ id, classType: node.class_type }));
  /* 输出类节点一个都没出现在执行结果里 = 产物分支根本没跑（典型：开关节点把
   * 空臂送往 PreviewAny，图像支路被静默短路）。 */
  if (outputNodes.length > 0 && !outputNodes.some((node) => executedIds.has(node.id))) {
    parts.push(
      `输出节点均未执行（图像分支可能被开关节点短路）：${outputNodes
        .map((node) => `${node.id}（${node.classType}）`)
        .join("、")} 都不在执行结果里`,
    );
  }
  /* 分节点进度里的「跑满仍无输出」：把可观察事实点名（如文本生成顶满
   * max_length），让「调大预算 / 关 thinking / 简化提示词」能直接读出来。 */
  const maxed = parseTaskLogProgress(facts.logs).stages.filter(
    (stage) =>
      stage.status === "done" &&
      stage.total !== undefined &&
      stage.total > 0 &&
      stage.completed === stage.total,
  );
  if (maxed.length > 0) {
    const listed = maxed
      .slice(0, MAX_LISTED_STAGES)
      .map(
        (stage) =>
          `节点 ${stage.nodeId}（${stage.title ?? stage.classType ?? "未知节点"}）进度已跑满 ${stage.completed}/${stage.total}`,
      )
      .join("、");
    parts.push(
      `${listed} —— 生成预算可能被 thinking / 长文本耗尽，检查 max_length、thinking 开关或简化提示词`,
    );
  }
  return parts.length === 0 ? "无输出内容" : `无输出内容：${parts.join("；")}`;
}
