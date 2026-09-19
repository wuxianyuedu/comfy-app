import { type CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import { type WorkflowIOMap } from "~/components/studio/workflow-io";

/* 项目级产出：从节点数据里收集「本次生成用到的参考图」，
 * 随生成请求一并落库，供元数据抽屉的参考图墙一键还原。 */
export function collectReferenceImages(d: CanvasNodeData): string[] {
  const set = new Set<string>();
  for (const v of [d.inputImage, d.firstFrame, d.lastFrame]) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) set.add(s);
  }
  return [...set];
}

/* 把画布选中的种子「生成后控制」模式（seedModes，按 ioKey 索引）
 * 解析成 control_after_generate 覆盖项，合并进 workflowInputs 一并下发。
 * 只有画布侧能拿到实时 IO 映射（ioKey → nodeId），所以解析必须放在前端；
 * 落到载荷里的位置由执行点的 raw 覆盖注入（`applyRawOverrides`）决定 ——
 * 它把这一个覆盖项写进 `widgets_values[seedSlot+1]`。
 * 前端词表 random → ComfyUI 词表 randomize，其余（fixed/increment/decrement）一致。 */
function toComfySeedMode(mode: string): string {
  return mode === "random" ? "randomize" : mode;
}

export function seedModeOverrides(
  io: WorkflowIOMap | null,
  seedModes: Record<string, string> | undefined,
): { nodeId: string; name: string; value: string }[] {
  if (!io || !seedModes) return [];
  const out: { nodeId: string; name: string; value: string }[] = [];
  for (const [ioKey, mode] of Object.entries(seedModes)) {
    const entry = io[ioKey];
    if (!entry?.nodeId || !mode) continue;
    out.push({
      nodeId: entry.nodeId,
      name: "control_after_generate",
      value: toComfySeedMode(mode),
    });
  }
  return out;
}
