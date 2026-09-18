/**
 * 工作流 JSON 格式识别（共享 lib）
 *
 * Drag-drop 或粘贴 JSON 时，需要识别它是哪种格式：
 *   - "api"  ComfyUI 的「导出(API 格式)」格式
 *            形如 { "<id>": { class_type, inputs } }，所有顶层 key 是数字 id。
 *   - "raw"  ComfyUI 的「导出(工作流格式)」/ LiteGraph 格式
 *            形如 { last_node_id, nodes, links, ... }，顶层含 nodes 数组。
 *   - null   两者都不是。
 *
 * 客户端（拖入导入、drag-to-upgrade）和服务端（导入校验、PATCH 升级校验）
 * 都依赖这一份判定逻辑，所以放在 src/lib 而不是 WorkflowLibrary 内部。
 *
 * 同时支持 drag-to-upgrade 流程（PATCH /api/workflows/[id] 用
 * body.upgradeFromApi 接收真实 API JSON，覆盖现有 graph 并打 apiSource="user"）。
 */

/**
 * 检测一个已解析的 JSON 对象是否为 ComfyUI API 格式 / LiteGraph RAW 格式。
 * 返回值："api" / "raw" / null 三选一。
 */
export function detectWorkflowFormat(parsed: unknown): "api" | "raw" | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const obj = parsed as Record<string, unknown>;
  // RAW 特征：LiteGraph 的导出一定带 `nodes` 数组与 `links` 数组
  //（孤立节点的 links 可能为空）。
  if (Array.isArray(obj.nodes)) return "raw";
  // API 特征：每个顶层键都是数字 id，每个值都带 `class_type`。
  // 允许少量非数字的元信息键（extra / output / prompt），避免误判。
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;
  let apiHits = 0;
  for (const k of keys) {
    if (!/^\d+$/.test(k)) continue;

    const value = obj[k];

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { class_type?: unknown }).class_type === "string"
    ) {
      apiHits += 1;
    }
  }

  if (apiHits > 0) return "api";
  return null;
}
