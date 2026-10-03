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

import type {
  NodeTypeConfig,
  PortSpec,
  FieldDef,
  FieldType,
} from "~/lib/comfyui/node-config";
import { errorText } from "~/lib/error-message";
import { emitAppEvent } from "~/lib/app-events";

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

/**
 * 注册表「最近一次灌入」的可查询状态。
 *
 * 为什么要把它做成**可读的状态**而不是一句广播：`emitAppEvent` 明确不排队重放
 * （见 `~/lib/app-events` 的说明），而最早的一次灌入就发生在画布挂载的 effect 里 ——
 * 那一刻订阅还没建立。所以读侧必须「挂载时先读一次表，再订阅变化」，
 * 这一格与画布镜像拒收那处（`~/lib/project-canvas/sync-notice`）是同一个形状。
 *
 * `loaded` 与 `count` 分开是有意的：0 既可能是「解析出 0 个自定义节点」（合法结果），
 * 也可能是「清单还没生成」「没登录」「读盘失败」—— 这两类以前在界面上同形，
 * 而台账 E9 记的「刷新看着没生效」正是被这一格糊住的。
 */
export interface CustomNodesRegistryState {
  /** 每次**成功**灌入 +1：订阅方拿它当「该重渲染了」的凭据。 */
  version: number;
  /** 当前表里的自定义节点类型数。 */
  count: number;
  /** 最近一次刷新是否真的拿到了清单。 */
  loaded: boolean;
  /** `loaded: false` 时给用户看的那句话；`loaded: true` 时为 null。 */
  detail: string | null;
}

let registryState: CustomNodesRegistryState = {
  version: 0,
  count: 0,
  loaded: false,
  detail: null,
};

/** 读当前状态（订阅侧挂载时的第一口，以及任何想知道「灌没灌进来」的地方）。 */
export function getCustomNodesRegistryState(): CustomNodesRegistryState {
  return registryState;
}

/**
 * `useSyncExternalStore` 的快照：取**版本号**这个原始值，不取整个状态对象 ——
 * 取对象的话每次 `Object.is` 都不等，一次广播会变成两轮重渲染。
 * 服务端也是同一个函数：服务器上不灌入，版本恒 0，与水合期的客户端一致。
 *
 * 订阅侧在 `~/components/studio/canvas/use-custom-nodes-registry`（刻意不在本模块：
 * 派发与订阅同一文件 = 自己给自己广播，两端成对的判据会被这种自环糊过去）。
 */
export function getCustomNodesRegistryVersion(): number {
  return registryState.version;
}

/**
 * 记一次灌入结果并按需广播。
 *
 * 只在**结论真的变了**时才广播：自动刷新与手动重解析会反复命中同一档失败
 * （「还没有清单」），不去重就是把同一个提示刷屏（口径同 `sync-notice` 的按原因去重）。
 */
function recordRegistry(next: {
  loaded: boolean;
  count: number;
  detail: string | null;
}): void {
  const unchanged =
    registryState.loaded === next.loaded &&
    registryState.count === next.count &&
    registryState.detail === next.detail;
  if (unchanged) return;
  registryState = {
    version: next.loaded ? registryState.version + 1 : registryState.version,
    count: next.count,
    loaded: next.loaded,
    detail: next.detail,
  };
  emitAppEvent("comfyapp:custom-nodes-updated");
}

/**
 * 一次清单读取的失败相。三相比两相多出来的那一档是这条链的关键：
 * 「还没有清单」是正常冷启动，「未登录」与「取不到」是两种完全不同的修法。
 */
type ManifestFailure =
  | { kind: "not-parsed"; detail: string }
  | { kind: "unauthorized"; detail: string }
  | { kind: "unreachable"; detail: string };

/** 把一次非 2xx 的清单响应折成可说的一句话（状态码 → 用户能行动的措辞）。 */
function classifyManifestFailure(status: number): ManifestFailure {
  if (status === 404) {
    return {
      kind: "not-parsed",
      detail: "还没有解析过自定义节点清单（在「自定义节点」设置里点解析）",
    };
  }
  if (status === 401 || status === 403) {
    return { kind: "unauthorized", detail: "未登录或会话已失效" };
  }
  return {
    kind: "unreachable",
    detail: `读取自定义节点清单失败（HTTP ${status}）`,
  };
}

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

/* 注册表刷新**有**通知通道：`comfyapp:custom-nodes-updated`（派发在本模块
 * `recordRegistry`，订阅在 `~/components/studio/canvas/use-custom-nodes-registry`）。
 *
 * 这条曾经是一个「只有派发方的空广播」：当时的订阅方（画布的添加节点菜单）已经不在了，
 * 而 `getAllNodeTypes()` 零消费方 —— 留着一个没人听的事件比留着「视图会自己刷新」的错觉
 * 更糟（台账 E9 记的就是这一格，判据 `tests/app-event-pairing.test.ts` 现在会拦两端不齐的
 * 通道，所以这条与它的订阅侧是同一笔里一起落的）。 */

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
    if (!res.ok) {
      const failure = classifyManifestFailure(res.status);
      /* 只有「取不到」这一档值得写日志：「还没解析过」是首屏的正常态，
       * 打进控制台会把用户的正常一次打开刷成错误流水（硬规则 4 要的是失败有出口，
       * 不是正常态冒充失败）。 */
      if (failure.kind === "unreachable" || failure.kind === "unauthorized") {
        console.error(`[custom-nodes] ${failure.detail}`);
      }
      return null;
    }
    const data: unknown = await res.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("nodes" in data) ||
      !data.nodes
    ) {
      console.error(
        "[custom-nodes] 清单形状不对：响应里没有 nodes 字段（解析器版本与前端不匹配？）",
      );
      return null;
    }
    return data as { nodes: Record<string, ManifestNodeRaw> };
  } catch (e) {
    console.error(
      "[custom-nodes] 读取节点清单失败：",
      errorText(e, "读取自定义节点清单"),
    );
    return null;
  }
}

/* 从磁盘上的 manifest 实时刷新注册表（经 /api/custom-nodes/manifest）。
 * 返回当前载入的自定义节点类型数。解析完再调是安全的。 */
export async function refreshCustomNodes(base = ""): Promise<number> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/custom-nodes/manifest`);
  } catch (e) {
    /* 请求压根没出去（离线 / dev server 刚重启 / 端口被回收）。 */
    const detail = `连不上清单端点（${errorText(e, "读取节点清单")}）`;
    recordRegistry({ loaded: false, count: 0, detail });
    console.error(`[custom-nodes] ${detail}`);
    return 0;
  }
  if (!res.ok) {
    const failure = classifyManifestFailure(res.status);
    recordRegistry({
      loaded: false,
      count: 0,
      detail: failure.detail,
    });
    if (failure.kind !== "not-parsed") {
      /* 「还没有清单」是首屏正常态，不进错误日志；另两档必须留痕，
       * 否则界面只会显示「节点数为 0」而没有任何地方能查到原因。 */
      console.error(`[custom-nodes] 刷新注册表失败：${failure.detail}`);
    }
    return 0;
  }

  try {
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
    /* 表已经换完：把结论记进可读状态并广播一次，让订阅侧（画布的页脚 / 渲染链标注）
     * 在没有整页刷新的情况下重渲染。`count` 为 0 也算灌入成功 —— 那是「解析器
     * 确实一个自定义节点都没找到」，与上面的「没拿到清单」是两件事。 */
    recordRegistry({ loaded: true, count, detail: null });
    return count;
  } catch (e) {
    const detail = `清单解析失败（${errorText(e, "解析节点清单")}）`;
    recordRegistry({ loaded: false, count: 0, detail });
    console.error(`[custom-nodes] ${detail}`);
    return 0;
  }
}
