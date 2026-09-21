"use client";
/* 抽出的纯模块级工具函数 —— 原本声明在 WorkflowCanvasEditor.tsx 内部。
 * 没有 JSX，也不用 React hook。 */
import { getCustomNodePackage } from "~/config/custom-nodes";
import { displayValue } from "~/lib/display-value";
import { trimFixed } from "~/lib/number-format";
import { asRecord } from "~/lib/is-record";
import { TITLE_MAX, clampText } from "~/lib/text-clamp";
import { edgeType, portColor, edgeTypeByInputName } from "~/lib/comfyui/types";
import type { Node, Edge } from "@xyflow/react";
import type {
  ComfyGraphNode,
  WorkflowDetail,
  RawOutputMeta,
  WorkflowGroup,
} from "./workflow-types";
/* `rectToAnchor` 已迁到 `~/lib/dom-rect` 的 `rectToAnchorRect`
 * （规范 16 §16.2.4.41：「把活着的 DOMRect 冻成可存对象」只在一处定义）。
 * 本文件不再导出它 —— 迁移时连带检查过：唯一调用方是 `WorkflowStores`。 */

/* 元信息条里的一个小信息芯片。就是个带样式的 span ——
 * 不需要按钮语义（点了没有任何反应）。 */
export const KNOWN_PACKAGE_HEURISTIC: Record<string, string> = {
  SetNode: "efficiency-nodes",
  GetNode: "efficiency-nodes",
};

/** 解析工作流节点所属的包来源标签。
 *
 *  判据顺序（第一个非空的胜出）：
 *    1. `getCustomNodePackage(classType)` —— 由 `refreshCustomNodes()`
 *       从磁盘上的自定义节点清单填充。有值时最准（是确切的目录名）。
 *    2. `KNOWN_PACKAGE_HEURISTIC[classType]` —— 解析器没认出来时的
 *       人工兜底（见上面的表）。
 *    3. `properties.cnr_id` —— ComfyUI 自己盖的「本节点注册于注册表 X」
 *       印章。字面量 `"comfy-core"` 当作内建处理（ComfyUI 用这个字符串
 *       表示 `Extension` / `Preview3D` 这类内置 LiteGraph UUID 类）。
 *    4. `(rgthree)` 后缀捷径 —— `Fast Groups Bypasser (rgthree)`、
 *       `Power Lora Loader (rgthree)` 等无论清单 / cnr_id 状态如何都住在
 *       `rgthree-comfy` 目录下。后缀关键字与已登记包 `MAPPING` 的约定保持一致。
 *
 *  全部落空时返回字面量 `"ComfyUI"` —— `PackageFooter` 把它当作
 *  「内建」的提示，整个标签都不显示。 */
export function resolveNodePackage(
  classType: string,
  properties?: Record<string, unknown>,
): string {
  const fromManifest = getCustomNodePackage(classType);
  if (fromManifest) return fromManifest;
  const fromHeuristic = KNOWN_PACKAGE_HEURISTIC[classType];
  if (fromHeuristic) return fromHeuristic;
  const cnr = properties?.cnr_id;
  if (typeof cnr === "string" && cnr.length > 0 && cnr !== "comfy-core") {
    return cnr;
  }
  if (classType.includes("(rgthree)")) return "rgthree-comfy";
  return "ComfyUI";
}

/** ComfyUI 原生的 `frontend_only` 小胶囊（左下角）。节点的 LiteGraph
 *  `properties.frontend_only === true` 时渲染，表示该节点的活全在浏览器前端
 *  干完、没有后端执行。这是与「包来源」页脚**并列**的另一个 UI 元素 ——
 *  两者可以同时在左下角出现，回答的是两个不同的问题
 *  （「这个节点哪来的」与「它跑在服务端吗」）。样式对齐 ComfyUI 自己的
 *  暗色斜体标签。 */
export function extractNoteTitle(text: string, fallback?: string): string {
  let raw = "";
  if (fallback?.trim()) {
    raw = fallback.trim();
    // 剥掉 ComfyUI 给某些转换流程烤进去的 "Note:" / "Note : " 前缀，
    // 免得渲染出来的标题栏回显成 "Note: Note: X"。
    raw = raw.replace(/^Note\s*[:：]\s*/i, "").trim();
    if (raw) return raw;
  }
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1]!;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return clampText(trimmed, { maxLength: TITLE_MAX });
  }
  return "";
}

/** 纯注释型的节点 class type（没有输入/输出，也没有端口）。 */
export function isNoteType(classType: string): boolean {
  return classType === "Note" || classType === "MarkdownNote";
}

/* ── 标题栏高度 ──
 *  LiteGraph（以及用它的 ComfyUI）给每个带标题的节点都在**顶部**画一条固定
 *  的 `LiteGraph.NODE_TITLE_HEIGHT = 30` 栏。
 *
 *  约定（口径只此一处）：原始归档里序列化的 `size: [w, h]` 是**主体内容**高度
 *  （30px 的标题栏**不含**在 `size[1]` 里）。因此真正渲染出来的节点外框 =
 *  内容高度 + NODE_TITLE_H = `size[1] + 30`。
 *
 *  具体落点：
 *    • `data.size.h` 存的是原始**主体内容**高度 = `size[1]`（不做减法）。
 *    • React Flow 节点的 `style.height` = `size[1] + NODE_TITLE_H`（含标题栏）。
 *    • 各渲染器的主体用 `minHeight = data.size.h` 作为内容下限；标题栏在它
 *      之上，属于 React Flow 的外框，不属于主体的 flex 容器。
 *  无标题的便签没有独立标题栏，因此其 React Flow 外框 = `size[1]`（不加）。 */
export const NODE_TITLE_H = 30;

/* ---------------------------------------------------------------------------
 *  伪「磨砂玻璃」层 —— **只在兜底时用，当前不渲染**。
 *  它在节点外框内画合成的彩色模糊色块，**一个真实像素都不采样**，
 *  因此 Chromium 那个小元素重复平铺的毛病（低缩放下便签被重复成 4 / 9 / 16 份）
 *  根本不会出现。它出现在两次「真背景模糊」尝试之间；用户后来更喜欢真正的
 *  透视模糊，所以线上走的是 <NodeFrost> —— 内层真实 `backdrop-filter`，
 *  并按 1/缩放 反向缩放，让它在屏幕上的占位永远不会小到触发重复平铺
 *  （见 WorkflowNode）。这里保留一份，是为了万一某个浏览器上真模糊的伪影
 *  再次冒头时能立刻切回来。
 * --------------------------------------------------------------------------- */
export function pseudoFrostPalette(modeColor: string | null) {
  const mode = modeColor ?? "#ec4899";
  return {
    primary: hexToRgba(mode, 0.45), // 模式色的主块
    secondary: hexToRgba(mode, 0.3), // 模式色的网点
    cool: "rgba(110, 145, 215, 0.32)", // 冷蓝「漏光」
    warm: "rgba(255, 255, 255, 0.10)", // 自上方来的光
    shadow: "rgba(0, 0, 0, 0.36)", // 未受光的角落
  };
}

/** 伪磨砂覆盖层。绝对定位渲染在节点内容**之下**（在头部 / 主体下面），
 *  带 `pointer-events: none` 与 `aria-hidden`，
 *  因此它永远不会影响命中测试、选中，也不会污染读屏输出。 */
export function inferOutputTypeAll(classType: string): Record<string, string> {
  // ComfyUI 允许节点自己给输出命名；离线下我们没有这份信息，
  // 因此改用按槽位的名字。CheckpointLoaderSimple 这类就是 MODEL/CLIP/VAE，
  // 与 ComfyUI 的默认显示一致。
  const KNOWN_NAMES: Record<string, string[]> = {
    CheckpointLoaderSimple: ["MODEL", "CLIP", "VAE"],
    CheckpointLoader: ["MODEL", "CLIP", "VAE"],
    UNETLoader: ["MODEL"],
    UNetLoader: ["MODEL"],
    CLIPLoader: ["CLIP"],
    DualCLIPLoader: ["CLIP", "CLIP"],
    VAELoader: ["VAE"],
    ControlNetLoader: ["CONTROL_NET"],
    LoraLoader: ["MODEL", "CLIP"],
    KSampler: ["LATENT"],
    KSamplerAdvanced: ["LATENT"],
    CLIPTextEncode: ["CONDITIONING"],
    CLIPTextEncodeSDXL: ["positive", "negative"],
    VAEDecode: ["IMAGE"],
    VAEEncode: ["LATENT"],
    EmptyLatentImage: ["LATENT"],
    LoadImage: ["IMAGE", "MASK"],
    ImageScale: ["IMAGE"],
    ImageUpscaleWithModel: ["IMAGE"],
    LatentUpscale: ["LATENT"],
    SetLatentNoiseMask: ["LATENT"],
    ControlNetApply: ["CONDITIONING"],
    ConditioningCombine: ["CONDITIONING"],
    ConditioningAverage: ["CONDITIONING"],
    SaveImage: [],
    PreviewImage: [],
    WanVideoSampler: ["LATENT"],
    WanVideoDecode: ["IMAGE"],
    WanVideoImageToVideoEncode: ["LATENT"],
    WanVideoTextEncode: ["CONDITIONING"],
    WanVideoT5TextEncode: ["CONDITIONING"],
    WanVideoModelLoader: ["MODEL", "CLIP", "VAE"],
  };
  const types = KNOWN_NAMES[classType] ?? [];
  const out: Record<string, string> = {};
  for (let i = 0; i < types.length; i++) {
    out[types[i] ?? `out${i + 1}`] = types[i] ?? "UNKNOWN";
  }
  return out;
}

/** 按 ComfyUI 的方式渲染 widget 值：
 *   - 数字 → 两位小数并去掉末尾的 0（如 1.00 → 1）
 *   - 布尔 → ✓ / ✕ 图标
 *   - 长字符串 → 原样返回，截断交给 CSS（完整文本留在 title 上）
 *   - 对象 → "{...}" */
export function renderWidgetValue(value: unknown): string {
  /* 缺值占位符只有一处定义（`~/lib/display-value`）—— 本函数负责的是
   * 「有值时怎么渲染」（布尔成 ✓/✕、小数去尾零…），「没有值时显示什么」
   * 不在这里再写一遍。 */
  if (value === undefined || value === null) return displayValue(null);
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (typeof value === "number") {
    /* 小数保留两位；整数不带小数点；去尾零（1.00 → 1）——
     * 这三件事各有出口（`~/lib/number-format`，规范 16 §16.2.4.54）。
     * 此前这里是 `(Math.round(v * 100) / 100).toFixed(2)` + 手写剥零，
     * 即**两层舍入**（先十进制舍、再二进制舍），在边界值上与直接 `toFixed`
     * 给出不同答案。 */
    if (value >= 10000) return String(value);
    return trimFixed(value, 2) ?? displayValue(null);
  }
  if (typeof value === "string") {
    /* 像 "DaSiWa_Wan22_I2V_14B_SnatchKiss_v1.safetensors" 这样的文件名
     *  有 40+ 字符。这里**不做**硬截断了：截断搬到 CSS（消费方 <span> 上的
     *  `maxWidth: 480px`）。这样节点变宽时能显示完整文件名，
     *  完整文本也仍能从 `title` 拿到 —— 用固定字符数截断时，
     *  无论节点多宽都只会显示 "DaSiWa_Wan22_…"。 */
    return value;
  }
  if (Array.isArray(value)) return "[…]";
  if (typeof value === "object") return "{…}";
  // 剩余只可能是 bigint / symbol / function —— 均带自有 toString，与
  // String(value) 运行时一致（显式收窄以满足 no-base-to-string）。
  return (value as { toString(): string }).toString();
}

/** 「值单元格」的文字颜色：**未连线**取主档、**已连线**取低一档（值来自上游的信号）。
 *  两态取值交给主题 token（`--color-widget-value` / `-dim`）：暗色档是**纯白**，
 *  因为底色是深灰的节点表面（用户口径：「暗色下参数值都读成白的，有连线的那几个比
 *  纯白暗一点」）；浅色档不能照抄白（白底上会消失），所以不是一处写死的颜色。
 *
 *  此前这里按 JS 类型分色（数字琥珀 / 字符串靛蓝 / 布尔绿红），值列比标签列还抢眼；
 *  现在类型信息交给行首的端口圆点与类型徽章，值只有「亮 / 略暗」两档。 */
export function valueCellColor(value: unknown, connected = false): string {
  /* 空值不是「值」，仍单独压弱一档 —— 与有没有连线无关。 */
  if (value === undefined || value === null) return "var(--color-ink-faintest)";
  return connected
    ? "var(--color-widget-value-dim)"
    : "var(--color-widget-value)";
}

/** 与 WorkflowNode 的 widget 值同形，但去掉了所有按 classType / 键名的
 *  清洗 —— 子图没有 `class_type` 可以去问友好名字，而且它的输入本来就按
 *  `name`（与 `localized_name`）挑定了。这里只需按 JS 类型分色；
 *  父卡片上的单元格直接展示 ComfyUI 存下来的原始配对值。 */
export function renderSubgraphWidgetValue(value: unknown): string {
  if (value === undefined || value === null) return displayValue(null);
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (typeof value === "number") {
    /* 与 `renderWidgetValue` 同一档（`~/lib/number-format`）。 */
    if (value >= 10000) return String(value);
    return trimFixed(value, 2) ?? displayValue(null);
  }
  if (typeof value === "string") {
    /* 与 `renderWidgetValue` 同理：**显示层面的截断交给 CSS**（`maxWidth:
     *  480px` + `text-overflow: ellipsis`）。这里**不做**数据截断 ——
     *  按固定字符数截断时，无论用户把节点拉多宽，长文件名都只能内联显示成
     *  "DaSiWa_Wan22_…"，与「值单元格要真的用上可用宽度」的要求相悖。
     *  完整文本仍能从 <span> 的 `title` 属性拿到。 */
    return value;
  }
  if (Array.isArray(value)) return "[…]";
  if (typeof value === "object") return "{…}";
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}

/** 把原始的 `label` / `localized_name` 修剪成面向用户的键名。
 *  自定义 COMBO widget（KJNodes 之类）会把整份选项清单烤进标签里，形如
 *  `"<键>: 选项1 | 选项2 | 选项3"`，很占地方 —— 这类选项清单要剥掉。
 *
 *  **但** BOOLEAN 开关的描述性标签（rgthree Settings 节点里的
 *  `"Model: True = 🟡 Safetensors | False = 🟣 GGUF"`）是**语义**，
 *  不是可选项清单：它告诉读者开/关分别切到什么，必须原样保留。
 *  （早先的实现在这里把整段剥到只剩 `Model`，读起来像被截断的残缺标签；
 *  现在完整描述会渲染出来，并由 widget 标签 span 上的 CSS 换行。）
 *  「Note: keep this secret」这类带冒号的普通句子同样原样保留。 */
export function sanitizeComboLabel(label: string | undefined | null): string {
  if (!label) return "";
  const colon = label.indexOf(":");
  if (colon <= 0 || colon === label.length - 1) return label.trim();
  const tail = label.slice(colon + 1);
  /* 只有当尾部看起来像**多选项 COMBO 清单**时才剥：尾部还含 `=` 或 `|`，
   * 且**不是** BOOLEAN 描述（`true =` / `false =` 标记）。BOOLEAN 描述要保留，
   * 让完整标签进到布局里 —— 那里的 CSS 会让它换行而不是被裁掉。 */
  const isBooleanDescriptor = /\b(?:true|false)\s*=/i.test(tail);
  if (/[=|]/.test(tail) && !isBooleanDescriptor) {
    return label.slice(0, colon).trim();
  }
  return label.trim();
}

/* ── 分组框节点（ComfyUI 的 group / frame 矩形）──
 * 纯装饰：一个半透明填充、带彩色边框与标题芯片的矩形。它不带端口、
 * 也不拦截指针事件，因此落在真实图节点之后，点击直接穿过去。 */
export function colorToRgba(hex: string, alpha: number): string {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** 把 #rgb / #rrggbb 颜色解析成 rgba() 字符串；输入畸形时回落到中性石板色。 */
export function hexToRgba(hex: string, alpha: number): string {
  let hexValue = (hex || "").trim();
  if (hexValue.startsWith("#")) hexValue = hexValue.slice(1);
  if (hexValue.length === 3)
    hexValue = hexValue
      .split("")
      .map((char) => char + char)
      .join("");
  if (hexValue.length < 6) return `rgba(120,120,135,${alpha})`;
  const red = parseInt(hexValue.slice(0, 2), 16);
  const green = parseInt(hexValue.slice(2, 4), 16);
  const blue = parseInt(hexValue.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** 把十六进制颜色按 `amt`（0..1）向白色混合 —— 让深色分组在暗色画布上
 *  也能给出可读的标题芯片。 */
export function lightenHex(hex: string, amt: number): string {
  let hexValue = (hex || "").trim();
  if (hexValue.startsWith("#")) hexValue = hexValue.slice(1);
  if (hexValue.length === 3)
    hexValue = hexValue
      .split("")
      .map((char) => char + char)
      .join("");
  if (hexValue.length < 6) return hex;
  let red = parseInt(hexValue.slice(0, 2), 16);
  let green = parseInt(hexValue.slice(2, 4), 16);
  let blue = parseInt(hexValue.slice(4, 6), 16);
  red = Math.round(red + (255 - red) * amt);
  green = Math.round(green + (255 - green) * amt);
  blue = Math.round(blue + (255 - blue) * amt);
  return `rgb(${red},${green},${blue})`;
}

/** 把 #rgb / #rrggbb 解析成 [r,g,b]；输入畸形时回落到中性石板色。 */
export function parseHex(hex: string): [number, number, number] {
  let hexValue = (hex || "").trim();
  if (hexValue.startsWith("#")) hexValue = hexValue.slice(1);
  if (hexValue.length === 3)
    hexValue = hexValue
      .split("")
      .map((char) => char + char)
      .join("");
  if (hexValue.length < 6 || /[^0-9a-fA-F]/.test(hexValue))
    return [120, 120, 135];
  return [
    parseInt(hexValue.slice(0, 2), 16),
    parseInt(hexValue.slice(2, 4), 16),
    parseInt(hexValue.slice(4, 6), 16),
  ];
}

/** 把十六进制 `a`（**底色**，例如节点画布色的主体）按系数 `t ∈ [0,1]`
 *  向十六进制 `b`（**着色**，例如节点的角色色）混合，
 *  返回不透明的 `rgb(r,g,b)`。约定：
 *
 *    t=0  →  纯 `a`（底色，不着色）
 *    t=1  →  纯 `b`（完全被着色替换）
 *    0<t<1 → 「半透明着色叠在底色上」的不透明等价形式
 *            （即 CSS 里 `rgba(着色, t)` 叠在底色上的效果，
 *            预烘焙成一个实心 `rgb()`）。
 *
 *  调用一律写成 `mixHex(底色, 着色, t)` —— 方向与「把 X% 的着色混进底色」
 *  一致。行为等价于 CSS 的 `color-mix(in srgb, 底色 X%, 着色 Y%)`，
 *  其中 Y/(X+Y) ≡ t。 */
export function mixHex(colorA: string, colorB: string, ratio: number): string {
  const pa = parseHex(colorA);
  const pb = parseHex(colorB);
  const red = Math.round(pa[0] + (pb[0] - pa[0]) * ratio);
  const green = Math.round(pa[1] + (pb[1] - pa[1]) * ratio);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * ratio);
  return `rgb(${red},${green},${bl})`;
}

/* 从 ComfyUI 图构建 ReactFlow 的边：每个形如 [nodeId, outputIndex] 的输入值，
 * 都变成一条从该节点指向消费方的边。
 *  - `targetHandle` 用输入字段名，ReactFlow 才能把线吸附到对应的 Handle id
 *    （每个连接行都会渲染一个）。
 *  - `sourceHandle` 用 "out:<输出名>"，线才会落到节点底部按输出渲染的 Handle 上。
 *  - 描边颜色取自线上流动的数据类型 —— MODEL→紫、CLIP→黄、LATENT→紫罗兰等 ——
 *    让画布读起来像一张忠实的 ComfyUI 图。 */

/* 最长路径（Kahn）拓扑布局。为**每一个**真实图节点都算出位置 ——
 * 不做截断，而 `buildWorkflowPreview` 为了卡片预览会截到 14 个。
 * 两条路径都用它：自动布局兜底（原件里没有保存位置），
 * 以及新的「API 布局」视图模式（不管导入的 rawJson 布局如何，
 * 强制按执行图拓扑排布）。 */
export function computeKahnLayout(
  realNodes: ComfyGraphNode[],
  graph: Record<string, unknown>,
  colW: number,
  rowH: number,
  padX: number,
  padY: number,
): Record<string, { x: number; y: number }> {
  const level: Record<string, number> = {};
  const incoming: Record<string, Set<string>> = {};
  const outAdj: Record<string, Set<string>> = {};
  for (const node of realNodes) {
    incoming[node.id] = new Set();
    outAdj[node.id] = new Set();
  }
  for (const [id, raw] of Object.entries(graph)) {
    const inputs = asRecord(asRecord(raw)?.inputs);
    if (!inputs) continue;
    for (const value of Object.values(inputs)) {
      if (
        Array.isArray(value) &&
        value.length >= 1 &&
        typeof value[0] === "string" &&
        outAdj[value[0]] &&
        incoming[id]
      ) {
        incoming[id].add(value[0]);
        outAdj[value[0]]!.add(id);
      }
    }
  }
  const remaining = new Map(
    Object.entries(incoming).map(([key, links]) => [key, links.size]),
  );
  const queue: string[] = [];
  for (const [id, deg] of remaining) {
    if (deg === 0) {
      level[id] = 0;
      queue.push(id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const nxt of outAdj[id]!) {
      level[nxt] = Math.max(level[nxt] ?? 0, (level[id] ?? 0) + 1);
      remaining.set(nxt, (remaining.get(nxt) ?? 0) - 1);
      if ((remaining.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  for (const node of realNodes) if (!(node.id in level)) level[node.id] = 0;

  const byLevel: Record<number, string[]> = {};
  for (const node of realNodes) {
    const lv = level[node.id] ?? 0;
    (byLevel[lv] ||= []).push(node.id);
  }
  for (const arr of Object.values(byLevel)) arr.sort();

  const pos: Record<string, { x: number; y: number }> = {};
  for (const node of realNodes) {
    const lv = level[node.id] ?? 0;
    const arr = byLevel[lv] ?? [];
    const row = arr.indexOf(node.id);
    pos[node.id] = { x: padX + lv * colW, y: padY + row * rowH };
  }
  return pos;
}

export function buildEdges(
  detail: WorkflowDetail | null,
  _nodes: Node[],
  outSlotNameById?: Record<string, string[]>,
): Edge[] {
  if (!detail) return [];
  // 只有真实的图节点才带边；分组框 / 便签永远不会。
  const known = new Set(detail.nodes.map((node) => node.id));
  const nodesById: Record<string, ComfyGraphNode> = {};
  for (const node of detail.nodes) nodesById[node.id] = node;

  /* 每个节点的原始 outputs[] —— 当某个 class 不在静态 `inferOutputTypeAll`
   * 表里时，Flow 节点回落的也是这里。存成 map，让下面的逐边查找保持 O(1)。 */
  const rawOutById = new Map<string, RawOutputMeta[]>();
  for (const rawNode of detail.rawNodes ?? []) {
    if (!rawNode?.id) continue;
    rawOutById.set(
      rawNode.id,
      Array.isArray(rawNode.outputs) ? rawNode.outputs : [],
    );
  }

  const edges: Edge[] = [];
  let i = 0;
  for (const [nodeId, raw] of Object.entries(detail.graph ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const inputs = asRecord(raw.inputs);
    if (!inputs) continue;
    for (const [inputName, value] of Object.entries(inputs)) {
      if (
        !Array.isArray(value) ||
        value.length < 1 ||
        typeof value[0] !== "string"
      )
        continue;
      const srcId = value[0];
      if (!known.has(srcId) || !known.has(nodeId)) continue;
      const srcSlot = Number(value[1] ?? 0);
      const srcClass = nodesById[srcId]?.class_type;
      const type =
        edgeType(srcClass, srcSlot) !== "UNKNOWN"
          ? edgeType(srcClass, srcSlot)
          : edgeTypeByInputName(inputName);
      const stroke = portColor(type);
      // 知道输出名时把线钉到精确的输出 handle 上；否则回落到每个节点都挂的
      // 通用隐藏 "out" handle。
      const slotNames = outSlotNameById?.[srcId];
      const staticNames = Object.keys(inferOutputTypeAll(srcClass ?? ""));
      const rawOuts = rawOutById.get(srcId) ?? [];
      /* 只有当源节点真的会渲染输出端口（静态表 或 raw outputs 命中）时，
       * 才能把边 pin 到 "out:<name>"。自定义节点两者皆空时画布一个输出
       * 端口都不渲染，`inferSourceOutNames` 从下游输入键反推出的名字
       * （如 width / height）在画布上并不存在，写进 sourceHandle 会让
       * React Flow 找不到 handle 而丢弃整条边并打 error#008 警告。
       * 这类边回落到每个节点都挂的通用 "out" handle。 */
      let outName: string | null = null;
      if (staticNames.length > 0 || rawOuts.length > 0) {
        if (slotNames && srcSlot < slotNames.length)
          outName = slotNames[srcSlot]!;
        else if (srcSlot < staticNames.length) outName = staticNames[srcSlot]!;
        else if (srcSlot < rawOuts.length)
          outName = rawOuts[srcSlot]!.name ?? null;
      }
      edges.push({
        id: `e-${srcId}-${nodeId}-${inputName}-${i++}`,
        source: srcId,
        target: nodeId,
        sourceHandle: outName ? `out:${outName}` : "out",
        targetHandle: inputName,
        animated: false,
        style: {
          /* 对齐 WorkflowEdge 那套「锐利 + 辉光」参数（strokeWidth 2.5、
           *  opacity 1），这样即使某些边落到 React Flow 的默认渲染器上，
           *  看起来仍与 `wf` 类型的边一样扎实。早先的 2/0.9 是针对
           *  旧的、没有辉光的细线 WorkflowEdge 调的。 */
          stroke,
          strokeWidth: 2.5,
          opacity: 1,
        },
      });
    }
  }

  /* 边界 pin 的接线：**方向很关键** —— React Flow 只在 source handle 为
   * `type="source"` 且 target handle 为 `type="target"` 时才渲染边。
   * 我们的 pin 节点暴露的是：
   *   - 输入 pin：左侧 handle `id="in"`，type="source"
   *   - 输出 pin：右侧 handle `id="out"`，type="target"
   * 因此 "input" 型边界连线从 pin 流向内部（外部输入喂进封装节点），
   * "output" 型边界连线从内部流向 pin（封装节点把内部结果暴露出去）。
   * 早先这两者的方向是反的、handle id 也指错，结果一条边都渲染不出来。 */
  if (detail.boundaryLinks) {
    const bp = detail.boundaryPins;
    const lookupPin = (pinId: string): { type: string } | null => {
      if (!bp) return null;
      return (
        bp.inputs.find((item) => item.id === pinId) ??
        bp.outputs.find((item) => item.id === pinId) ??
        null
      );
    };
    for (const bl of detail.boundaryLinks) {
      const pinNodeId = `bpin:${bl.pinId}`;
      const stroke = portColor(lookupPin(bl.pinId)?.type ?? "*");
      if (bl.kind === "input") {
        /* pin（外部输入）→ 内部节点对应的输入槽。 */
        edges.push({
          id: `e-bb-${bl.linkId}-in`,
          source: pinNodeId,
          sourceHandle: "in",
          target: bl.innerNodeId,
          targetHandle: bl.innerSlotName || "in",
          animated: false,
          style: { stroke, strokeWidth: 2, opacity: 0.9 },
        });
      } else {
        /* 内部节点对应的输出 handle → 输出 pin。 */
        edges.push({
          id: `e-bb-${bl.linkId}-out`,
          source: bl.innerNodeId,
          sourceHandle: bl.innerSlotName ? `out:${bl.innerSlotName}` : "out",
          target: pinNodeId,
          targetHandle: "out",
          animated: false,
          style: { stroke, strokeWidth: 2, opacity: 0.9 },
        });
      }
    }
  }

  return edges;
}

/* 把节点的输入映射解析成「每条连线对应的源信息」。对每个值为
 * `[srcId, slot]` 的输入，从传入的 `nodesById` 里查出源节点的标题与
 * class_type —— 渲染器据此在该行旁边显示「← <标题> #id」，
 * 并按数据类型选边的颜色。不是连线的输入直接跳过。 */
export function buildInputSources(
  inputs: Record<string, unknown> | undefined,
  nodesById: Record<string, ComfyGraphNode>,
): Record<
  string,
  { id: string; title: string; slot: number; classType?: string }
> {
  const out: Record<
    string,
    { id: string; title: string; slot: number; classType?: string }
  > = {};
  if (!inputs) return out;
  for (const [key, value] of Object.entries(inputs)) {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      typeof value[0] !== "string"
    )
      continue;
    const src = nodesById[value[0]];
    out[key] = {
      id: value[0],
      title: src?.title ?? `#${value[0]}`,
      slot: Number(value[1] ?? 0),
      classType: src?.class_type,
    };
  }
  return out;
}

/* 扫一遍工作流图，为每个源节点算出「至少有一条下游边」的输出**名字**集合。
 * WorkflowNode 与 WorkflowSubgraphNode 都靠它决定每行输出要不要渲染 source
 * Handle ——「没有线就没有圆点」。输出名的解析方式与
 * buildWfNode / buildSubgraphNode 的输出清单一致，
 * 这样 `connectedOutputs.has(name)` 才对得上行键。
 * 可选的 `outSlotNameById` 由 `inferSourceOutNames` 产出，
 * 针对那些输出**既不在**静态表里、**也不在**原始 JSON 里的节点。 */
export function buildConnectedOutputs(
  detail: WorkflowDetail,
  nodesById: Record<string, ComfyGraphNode>,
  rawMetaById: Record<
    string,
    {
      widgets_values: unknown[];
      outputs: RawOutputMeta[];
      flags?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    }
  >,
  outSlotNameById?: Record<string, string[]>,
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const raw of Object.values(detail.graph ?? {})) {
    const inp = asRecord(asRecord(raw)?.inputs) ?? {};
    for (const value of Object.values(inp)) {
      if (
        !Array.isArray(value) ||
        value.length < 1 ||
        typeof value[0] !== "string"
      )
        continue;
      const srcId = value[0];
      const slot = Number(value[1] ?? 0);
      const node = nodesById[srcId];
      if (!node) continue;
      const slotNames = outSlotNameById?.[srcId];
      const staticOuts = Object.keys(inferOutputTypeAll(node.class_type));
      const rawOuts = rawMetaById[srcId]?.outputs ?? [];
      let name: string | null = null;
      if (slotNames && slot < slotNames.length) {
        name = slotNames[slot] ?? null;
      } else if (slot < staticOuts.length) {
        name = staticOuts[slot]!;
      } else if (slot < rawOuts.length) {
        name = rawOuts[slot]!.name;
      }
      if (!name) continue;
      map[srcId] ??= new Set();
      map[srcId].add(name);
    }
  }
  return map;
}

/* 为每个源节点推导「挂在它 source Handle 上的按槽位输出名」，
 * 哪怕该节点既不在静态 `inferOutputTypeAll` 表里、原始 JSON 里也没有
 * `outputs[]`。逐节点的取值链：
 *   1. 静态 `inferOutputTypeAll` 表（KSampler → LATENT 等）。
 *   2. 导入 JSON 里的原始 `outputs[]` 数组。
 *   3. 下游节点的输入键，剥掉 ComfyUI 的「同名字段」后缀（`_N`）——
 *      输入 `width_1` 取出 `width`。对 ResolutionSelector 这类导出的工作流
 *      完全不携带 outputs 的全自定义节点，这是唯一能把名字捞回来的路子。
 *   4. 以上都没产出名字时，兜底用通用的 `out<N>`。 */
export function inferSourceOutNames(
  detail: WorkflowDetail,
  nodesById: Record<string, ComfyGraphNode>,
  rawMetaById: Record<
    string,
    {
      widgets_values: unknown[];
      outputs: RawOutputMeta[];
      flags?: Record<string, unknown>;
    }
  >,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [nodeId, node] of Object.entries(nodesById)) {
    const staticNames = Object.keys(inferOutputTypeAll(node.class_type));
    if (staticNames.length > 0) {
      out[nodeId] = staticNames;
      continue;
    }
    const rawNames = (rawMetaById[nodeId]?.outputs ?? []).map(
      (output) => output.name,
    );
    if (rawNames.length > 0) {
      out[nodeId] = rawNames;
      continue;
    }

    // 静态 + raw 都没有，从消费者（下游节点）的输入键反推
    const bySlot: Record<number, string[]> = {};
    for (const consumerRaw of Object.values(detail.graph ?? {})) {
      const inp = asRecord(asRecord(consumerRaw)?.inputs) ?? {};
      for (const [inputKey, value] of Object.entries(inp)) {
        if (
          !Array.isArray(value) ||
          value.length < 1 ||
          typeof value[0] !== "string"
        )
          continue;
        if (value[0] !== nodeId) continue;
        const slot = Number(value[1] ?? 0);
        const stripped = inputKey.replace(/_\d+$/g, "");
        bySlot[slot] ??= [];
        if (!bySlot[slot].includes(stripped)) bySlot[slot].push(stripped);
      }
    }
    const slotCount = Math.max(1, ...Object.keys(bySlot).map(Number), 0);
    const slotNames: string[] = [];
    for (let i = 0; i <= slotCount; i++) {
      const candidates = bySlot[i] ?? [];
      slotNames.push(candidates[0] ?? `out${i + 1}`);
    }
    if (slotNames.length > 0) out[nodeId] = slotNames;
  }
  return out;
}

/* 按包围盒包含关系算出每个分组的嵌套深度。分组深度 = 有多少个其它分组
 * 直接或间接地包含它 —— 子框据此画在父框**之上**，嵌套分组才读得对。 */
export function computeGroupDepths(
  groups: WorkflowGroup[],
): Record<string, number> {
  if (groups.length === 0) return {};
  const inside = (inner: WorkflowGroup, outer: WorkflowGroup) => {
    const [ix, iy, iw, ih] = inner.bounding;
    const [ox, oy, ow, oh] = outer.bounding;
    const tolerance = 2;
    const same = ix === ox && iy === oy && iw === ow && ih === oh;
    return (
      !same &&
      ox - tolerance <= ix &&
      oy - tolerance <= iy &&
      ox + ow + tolerance >= ix + iw &&
      oy + oh + tolerance >= iy + ih
    );
  };
  const findParent = (group: WorkflowGroup): WorkflowGroup | null => {
    let best: WorkflowGroup | null = null;
    let bestArea = Infinity;
    for (const candidate of groups) {
      if (candidate.id === group.id) continue;
      if (inside(group, candidate)) {
        const area = candidate.bounding[2] * candidate.bounding[3];
        if (area < bestArea) {
          bestArea = area;
          best = candidate;
        }
      }
    }
    return best;
  };
  const depth: Record<string, number> = {};
  for (const group of groups) {
    let depthCount = 0;
    let parent = findParent(group);
    const visited = new Set<string>([group.id]);
    // 防御：两个几乎重合的框（在容差内）会互相把对方认成父级、形成环，
    // 展开子图时能把主线程挂死。这里直接退出（深度封顶 64 层）。
    while (parent && !visited.has(parent.id) && depthCount < 64) {
      visited.add(parent.id);
      depthCount++;
      parent = findParent(parent);
    }
    depth[group.id] = depthCount;
  }
  return depth;
}

/* ── 内层编辑器（必须位于 ReactFlowProvider 内部）── */
