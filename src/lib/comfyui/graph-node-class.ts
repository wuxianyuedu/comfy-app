/**
 * `graph-node-class.ts` —— 从「真正提交出去的那张图」里认一个节点的 class_type。
 *
 * 为什么要单独有一份（ISSUE #1202）：WS 的 `executing` / `progress` 帧只带**节点 id**，
 * 而「▶ 节点 [3] 采样器（KSampler）」那行日志、以及落进 `task.progressNode` 的
 * `classType` / `label` 两格，都要靠 id → 类名的一张表。这张表只能在提交那一刻的
 * 那份图里找 —— 也就是 `executor-cli.ts` 写进 `s.executedWorkflow` 的那一份，
 * 它是**收拾过之后真正交给 ComfyUI 的图**（画布覆盖已注入、纯 UI 节点已剔除），
 * 所以与 WS 回来的 id 对得上；画布上的原件不行。
 *
 * 那份图有两种形状，取决于提交入口给的是哪一种载荷，两种都得认：
 *  · **API 图**：`{ "3": { class_type: "KSampler", inputs: … } }` —— 键就是节点 id；
 *  · **RAW（UI 格式原件）**：`{ nodes: [ { id: 3, type: "KSampler", … } ], links: … }`
 *    —— comfy-cli 自己做 UI→API 转换并**保留 id**，子图内部节点展开后是 `4:1670`
 *    这种带宿主链的 id。UI 格式里类名字段叫 `type`，不叫 `class_type`。
 *
 * RAW 那一侧的下钻（含子图逐层）不在这里重抄，委托给 `raw-overrides.ts` 的
 * `resolveRawNode` —— 画布覆盖注入走的就是同一条定位逻辑，两处必须给出同一个节点，
 * 否则「面板上改了没生效」与「日志里认不出类名」会长成两个不同的bug。
 *
 * 认不出就返回 `undefined`（调用侧照常出进度，只是不带类名），**绝不猜**。
 *
 * §18.4：本模块零 Node 内建 import、被 `executor-ws.ts` 静态引用，而后者在宿主的
 * 运行时图里（`host-runtime.ts` 注入 `configureExecutorWs`）⇒ 不能加 `server-only`。
 */
import { rawUiNodeType } from "./raw-overrides";

/**
 * @param graph  `executedWorkflow` 里那一份（API 图或 RAW 原件），形状不可信
 * @param nodeId WS 帧里的节点 id（`String(...)` 之后传进来）
 */
export function classTypeForNode(
  graph: unknown,
  nodeId: string,
): string | undefined {
  if (!graph || typeof graph !== "object" || !nodeId) return undefined;

  // API 形状优先：这一支不需要遍历，是 O(1) 的按键取。
  const apiNode = (graph as Record<string, unknown>)[nodeId];
  if (apiNode && typeof apiNode === "object") {
    const classType = (apiNode as Record<string, unknown>).class_type;
    if (typeof classType === "string" && classType) return classType;
  }

  // 落到 RAW 那一支：UI 格式的类名在 `nodes[].type`，子图 id 靠宿主链逐层下钻。
  return rawUiNodeType(graph, nodeId);
}

/**
 * 类名 → 画布/日志用的中文标签。
 *
 * 从 `executor-ws.ts` 挪到这里（ISSUE #1202）：现在 **WS 帧**与 **comfy-cli stdout 的
 * progress 事件**两条路都要给 `progressNode` 填 `label`，两处各留一份七行的表就是
 * §12.12 的孪生对 —— 改一处另一处连编译期都不报错，而它们的差别正好是「画布写的中文、
 * 状态栏写的类名」这种用户能看见的分叉。
 */
export function nodeLabel(classType?: string): string {
  const map: Record<string, string> = {
    CheckpointLoaderSimple: "加载模型",
    CLIPTextEncode: "编码提示词",
    EmptyLatentImage: "初始化潜空间",
    KSampler: "采样去噪",
    VAEDecode: "VAE 解码",
    SaveImage: "保存图像",
    LoraLoader: "加载 LoRA",
  };
  return map[classType ?? ""] ?? classType ?? "未知节点";
}
