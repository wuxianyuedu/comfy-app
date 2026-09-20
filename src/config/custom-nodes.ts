/**
 * customNodes.ts —— 读取生成好的自定义节点 manifest，
 * 并以 `NodeTypeConfig` 的形式供给工作流画布。
 *
 * manifest（`src/generated/customNodes.manifest.json`）由只读的 AST 解析器
 * （`scripts/parse_custom_nodes.py`）从 CUSTOM_NODES_PATH 配置的目录里生成。
 * 自定义节点的源码包在运行期**从不**被 import，也**从不**被修改。
 *
 * 注意：我们**刻意不**在构建期 `import` 这份 manifest。
 * Turbopack 会把这个 .json 当成模块，而解析器每次重写它都会打断 HMR
 *（文件被替换后 HMR 再也匹配不上原来的模块模式）。因此改为惰性填充
 * `CUSTOM_NODE_TYPES`：经 `refreshCustomNodes()` 从磁盘上的 manifest 读入
 *（画布挂载时调一次，CustomNodesSettings 每次解析完也调一次）。
 * 原始文件同时经 `/api/custom-nodes/manifest` 直接对外提供。
 */

import { emitAppEvent } from "~/lib/app-events";
import type {
  NodeTypeConfig,
  PortSpec,
  FieldDef,
  FieldType,
} from "~/lib/comfyui/node-config";

/* 把 ComfyUI 的原始分类字符串映射到强调色。对外导出，
 * 好让界面给节点预览卡渲染同一个分类配色，而不必先构建完整的 NodeTypeConfig。 */
export const CATEGORY_COLORS: Record<string, string> = {
  loaders: "#F59E0B",
  loader: "#F59E0B",
  model: "#F59E0B",
  conditioners: "#8B5CF6",
  conditioner: "#8B5CF6",
  condition: "#8B5CF6",
  samplers: "#06B6D4",
  sampler: "#06B6D4",
  latent: "#10B981",
  image: "#3B82F6",
  images: "#3B82F6",
  video: "#10B981",
  audio: "#A855F7",
  mask: "#64748B",
  custom: "#7C5CFC",
  utils: "#6B7280",
  utility: "#6B7280",
};

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 62%)`;
}

export function colorFor(category: string | undefined): string {
  if (!category) return "#7C5CFC";
  const parts = category.replace(/\/$/, "").split("/");
  for (const p of parts) {
    const c = CATEGORY_COLORS[p.toLowerCase()];
    if (c) return c;
  }
  return hashColor(category);
}

/* 把 manifest 的 PortSpec 转成参数编辑器用的 FieldDef。 */
export function specToField(s: PortSpec): FieldDef {
  return {
    key: s.name,
    label: s.name,
    type: s.widget! ?? "string",
    options: s.options,
    /* 与 String(s.default) 运行时一致（default 来自 manifest JSON，无 symbol），
     * 收窄以满足 no-base-to-string。 */
    placeholder:
      s.default !== undefined && s.default !== null
        ? (s.default as { toString(): string }).toString()
        : undefined,
    group: "参数",
    // 纯连接端口渲染成连线手柄，而不是编辑字段。
    hidden: !s.widget,
  };
}

/* 所有自定义节点类型，按 class_type 作键。**可变** ——
 * `refreshCustomNodes` 会从磁盘上的 manifest 重新填充它，画布因此能实时更新。 */
export const CUSTOM_NODE_TYPES: Record<string, NodeTypeConfig> = {};

/* 每个自定义节点类型的包来源，按 class_type 作键。**可变** ——
 * 每次 `refreshCustomNodes()` 调用都会重新填充。值是从磁盘 manifest 解析出的
 * 包目录名（例如 "DaSiWa-Nodes"、"ComfyMath"）。
 * ComfyNode 用它给每个画布节点渲染 ComfyUI 原生的左下角「包来源」页脚。 */
export const CUSTOM_NODE_PACKAGE: Record<string, string> = {};

interface RawManifest {
  nodes?: Record<string, ManifestNode>;
}

interface ManifestInput {
  name: string;
  type: string;
  widget?: string | null;
  options?: string[] | null;
  /** 控件的默认值（字符串 / 数字 / 布尔 … 原始 JSON 值），对本模块不透明。 */
  default?: unknown;
  required?: boolean;
}

interface ManifestNode {
  classType: string;
  displayName?: string;
  category?: string;
  outputNode?: boolean;
  frontend_only?: boolean;
  function?: string | null;
  description?: string | null;
  inputs?: ManifestInput[];
  outputs?: Array<{ type: string; name: string }>;
  /** 磁盘上的源文件（仅供参考）。 */
  source?: string;
  /** 来源包目录名（例如 "ComfyMath"、"DaSiWa-Nodes"）。
   *  由解析器从包顶层的 __init__ 目录取出，
   *  并单独存进 CUSTOM_NODE_PACKAGE，好让画布左下角页脚不必重新解析 manifest
   *  就能查到它。 */
  package?: string;
}

function buildInto(
  target: Record<string, NodeTypeConfig>,
  manifest: RawManifest,
  packages?: Record<string, string>,
): number {
  let count = 0;
  for (const [ct, n] of Object.entries(manifest.nodes ?? {})) {
    if (!n) continue;
    const inputs: PortSpec[] = (n.inputs ?? []).map((input) => ({
      name: input.name,
      type: input.type,
      widget: (input.widget as FieldType) || undefined,
      options: input.options ?? undefined,
      default: input.default,
      required: !!input.required,
    }));
    const outputs: PortSpec[] = (n.outputs ?? []).map((output) => ({
      name: output.name,
      type: output.type,
      required: true,
    }));
    target[ct] = {
      label: n.displayName ?? ct,
      color: colorFor(n.category),
      icon: "\u{1F4E6}", // 📦 package — signals a custom node package
      category: "custom",
      rawCategory: n.category,
      custom: true,
      // ⚠️ 概念澄清：OUTPUT_NODE（终端节点，后端仍执行）与 properties.frontend_only
      // （纯前端节点，后端不执行）是**两个不同概念**，此处必须分开。
      outputNode: !!n.outputNode,
      frontendOnly: !!n.frontend_only,
      description: n.description ?? undefined,
      width: 240,
      height: 90,
      inputsSpec: inputs,
      outputsSpec: outputs,
      defaultFields: inputs.map(specToField),
    };
    // 记下包来源（例如 "DaSiWa-Nodes"、"ComfyMath"），
    // 好让画布渲染 ComfyUI 原生的左下角页脚。
    // manifest 没给包名时（旧版解析器 / 手工改过的 manifest）
    // 回落到原始分类字符串。
    if (packages && n.package) packages[ct] = n.package;
    count++;
  }
  return count;
}

/* 查某个自定义节点类型的包来源。内置节点、或 manifest 条目里没有
 * `package` 字段的自定义类型，都返回 undefined。
 * ComfyNode 用它渲染左下角页脚；内置节点的页脚则回落到字面量 "ComfyUI"。 */
export function getCustomNodePackage(classType: string): string | undefined {
  return CUSTOM_NODE_PACKAGE[classType];
}

// 注意：这里不做静态预置 —— 见文件头注。`CUSTOM_NODE_TYPES` 由画布挂载时的
// `refreshCustomNodes()` 从 `/api/custom-nodes/manifest` 填充。

export function isCustomNode(classType: string): boolean {
  return classType in CUSTOM_NODE_TYPES;
}

/* `refreshCustomNodes()` 应用完一份新 manifest 后广播的事件名。
 * 渲染「依赖注册表」的视图组件（例如 `WorkflowCanvas` 的添加节点菜单）订阅它，
 * 并抬高自己的版本 state，让 React 重新跑 `getAllNodeTypes()`。
 * 没有它的话，画布只能看到首次加载时挂载的那份 ——
 * 从设置面板解析出来的更新要硬刷新才可见。 */
export const CUSTOM_NODES_UPDATED_EVENT = "custom-nodes:updated";

/* `/api/custom-nodes/manifest.nodes` 里单个节点的原始形状。
 * 自定义节点设置面板直接用它，于是在注册表尚未构建时（例如刚解析完、还没有
 * 任何消费方调用 `refreshCustomNodes`）也能渲染小预览卡。 */
export interface ManifestNodeRaw {
  classType: string;
  displayName?: string;
  category?: string;
  outputNode?: boolean;
  function?: string | null;
  description?: string | null;
  inputs?: Array<{
    name: string;
    type: string;
    widget?: string | null;
    options?: string[] | null;
    /** 控件的默认值（字符串 / 数字 / 布尔 … 原始 JSON 值），对本模块不透明。 */
    default?: unknown;
    required?: boolean;
  }>;
  outputs?: Array<{ type: string; name: string }>;
  source?: string;
  package?: string;
}

/* 直接从磁盘取原始 manifest。manifest 缺失或为空（例如还没解析过）时返回 null。
 * 服务端侧开销很小 —— 首解析之后文件已在缓存里。 */
export async function getCustomNodesManifest(
  base = "",
): Promise<{ nodes: Record<string, ManifestNodeRaw> } | null> {
  try {
    const res = await fetch(`${base}/api/custom-nodes/manifest`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("nodes" in data) ||
      !data.nodes
    ) {
      return null;
    }
    return data as { nodes: Record<string, ManifestNodeRaw> };
  } catch {
    return null;
  }
}

/* 从磁盘上的 manifest（经 /api/custom-nodes/manifest）实时刷新注册表。
 * 返回当前载入的自定义节点类型数。解析完再调是安全的。 */
export async function refreshCustomNodes(base = ""): Promise<number> {
  try {
    const res = await fetch(`${base}/api/custom-nodes/manifest`);
    if (!res.ok) return 0;
    const manifest = (await res.json()) as RawManifest;
    const next: Record<string, NodeTypeConfig> = {};
    const nextPackages: Record<string, string> = {};
    const count = buildInto(next, manifest, nextPackages);
    // 就地替换对外导出的 const map 内容（消费方持有的是同一引用）。
    for (const k of Object.keys(CUSTOM_NODE_TYPES)) delete CUSTOM_NODE_TYPES[k];
    Object.assign(CUSTOM_NODE_TYPES, next);
    // 同步包来源映射，让 ComfyNode 不必重新解析 manifest
    // 就能渲染左下角页脚。
    for (const k of Object.keys(CUSTOM_NODE_PACKAGE))
      delete CUSTOM_NODE_PACKAGE[k];
    Object.assign(CUSTOM_NODE_PACKAGE, nextPackages);
    // 通知活跃视图（画布菜单等）注册表已变更。
    // 为 SSR 做了保护 —— 广播方与订阅方都只在浏览器里跑，
    // 那里才有 `CustomEvent`，监听者也才能渲染。
    if (typeof window !== "undefined") {
      emitAppEvent(CUSTOM_NODES_UPDATED_EVENT, { count });
    }
    return count;
  } catch {
    return 0;
  }
}
