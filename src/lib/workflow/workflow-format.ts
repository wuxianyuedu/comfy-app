/**
 * 工作流 JSON 原件识别（共享 lib）
 *
 * 本应用**只接受 ComfyUI 的原始工作流格式**（「导出(工作流格式)」/ LiteGraph，
 * 形如 { last_node_id, nodes, links, ... }）。API 格式（`{ "<id>": { class_type,
 * inputs } }`）不是本应用支持的导入形态 —— RAW 转可执行的 API 图由 comfy-cli
 * 在执行时按节点类定义做权威转换（见 `~/lib/comfyui/execution-shape`）。
 *
 * 客户端（拖入导入）与服务端（导入校验）都依赖这一份判定逻辑，所以放在
 * `src/lib` 而不是 WorkflowLibrary 内部。
 */

/** 已解析的 JSON 是不是一份有内容的 ComfyUI 原始工作流（RAW / LiteGraph）。 */
export function isRawWorkflowJson(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return false;
  const nodes = (parsed as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) && nodes.length > 0;
}
