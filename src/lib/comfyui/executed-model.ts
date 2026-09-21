// 从「本次实际提交给 ComfyUI 的图」里认出**主模型**文件名。
//
// 为什么需要它：`/system_stats` 不含模型名，`/queue` 的条目虽然带着 prompt 图，
// 但全仓没有任何代码去解析它 —— 状态栏想问的「现在在跑哪个模型」此前无处可取
// （同一批缺口见 docs/standards/launch-and-build.md 的排障表）。
//
// **两种图形态都要认**，因为执行载荷有两条路：
//   · API 格式（`{ "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name } } }`）
//     —— 走 `execution-graph` 收拾后的图；
//   · UI 格式（`{ nodes: [{ type: "CheckpointLoaderSimple", widgets_values: ["x.safetensors"] }] }`）
//     —— RAW 路径存的就是这个（`executedWorkflow` 的注释写明）。
// 两种的取值口径不同（前者按字段名、后者按下标），所以是两条分支而不是一条正则。
//
// 只认主模型：LoRA / VAE / CLIP 那些对「这次跑了什么」是次要信息，混进同一格
// 只会让状态栏读不下去。
//
// 无 React、无 IO（规范 §17.2 第②层），可直接单测。

/** UI 格式里主模型所在的节点类型 → `widgets_values` 下标。
 *
 *  下标固定是 0：这几个类的**第一个 widget** 就是模型文件名（字段名见
 *  `raw.ts` 的 CKPT_KEYS 清单：`CheckpointLoaderSimple: ["ckpt_name"]`、
 *  `UNETLoader: ["unet_name", "weight_dtype"]`）。 */
const UI_PRIMARY_TYPES: Record<string, number> = {
  CheckpointLoaderSimple: 0,
  UNETLoader: 0,
  CheckpointLoader: 0,
};

/** API 格式里的主模型字段，按优先级排列（**分轮**扫描，见 `primaryModelName`）。 */
const API_PRIMARY_KEYS = ["ckpt_name", "unet_name"];

/** 递归深度上限：图里可能嵌子图，但合法的嵌套不会超过这个层数；设上限是为了
 *  不让坏数据（自引用）把解析拖死。 */
const MAX_DEPTH = 12;

/**
 * 认出主模型文件名；认不出返回 `null`（状态栏那一格就不显示模型）。
 *
 * **分轮**扫描而不是「先序遍历遇到的第一个」：一张图里可能同时有 UNETLoader 与
 * CheckpointLoaderSimple，谁在前取决于作者的节点布局 —— 按优先级逐轮找遍整张图，
 * 模型名才不会随节点顺序变（实测反例：`{a: UNETLoader, b: CheckpointLoaderSimple}`
 * 的先序会先撞上 unet）。
 *
 * @param graph 本次实际提交的图（`executedWorkflow.get(taskId)` 拿到的那个）
 * @returns 形如 `flux1-dev.safetensors`；路径 / 空串一律视为没认出来
 */
export function primaryModelName(graph: unknown): string | null {
  for (const key of API_PRIMARY_KEYS) {
    const found = scan(graph, (record) => apiInput(record, key), 0);
    if (found !== null) return found;
  }
  return scan(graph, uiWidget, 0);
}

/** 深度优先找第一个命中 `pick` 的节点。 */
function scan(
  node: unknown,
  pick: (record: Record<string, unknown>) => string | null,
  depth: number,
): string | null {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object")
    return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = scan(item, pick, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const direct = pick(record);
  if (direct !== null) return direct;
  for (const value of Object.values(record)) {
    const found = scan(value, pick, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** API 格式：`inputs.<key>` 是模型文件名。 */
function apiInput(record: Record<string, unknown>, key: string): string | null {
  const inputs = record.inputs;
  if (inputs === null || typeof inputs !== "object") return null;
  return asFileName((inputs as Record<string, unknown>)[key]);
}

/** UI 格式：节点类型在表里时取 `widgets_values[下标]`。 */
function uiWidget(record: Record<string, unknown>): string | null {
  const type = record.type;
  if (typeof type !== "string" || !(type in UI_PRIMARY_TYPES)) return null;
  const values = record.widgets_values;
  if (!Array.isArray(values)) return null;
  return asFileName(values[UI_PRIMARY_TYPES[type]!]);
}

/** 只收「像个模型文件名」的非空字符串：路径会带目录，展示时反而看不出是哪个模型。 */
function asFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || text.includes("/") || text.includes("\\")) return null;
  return text;
}
