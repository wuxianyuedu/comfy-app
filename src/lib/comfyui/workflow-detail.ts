/**
 * 工作流详情 / 子图详情的构建器。
 *
 * 原先散在两条 REST 路由里（GET src/app/api/workflows/[id]/route.ts 与
 * GET src/app/api/workflows/[id]/subgraph/route.ts），现收进共享 lib 函数，
 * 让 tRPC 路由能经 `workflow.detailFull` / `workflow.subgraph` 提供完全相同的
 * 派生形状。
 *
 * 缓存键沿用历史的命名空间（`wf:` / `sg:`），服务端**已有的缓存条目因此仍然有效**。
 *
 * 按格式分的重解析都抽到了同目录的兄弟模块里 ——
 * workflow-detail-combo.ts（COMBO 候选值）、workflow-detail-raw.ts
 * （RAW 的输入/输出/视图解析）、workflow-detail-io.ts（workflowIO 富化）、
 * workflow-subgraph-parse.ts（子图的连线/图/pin 解析）。
 * 本文件只留编排与缓存两层。
 */
import { TRPCError } from "@trpc/server";
import { workflowTemplateRepository } from "~/lib/core/repository";
import {
  asRawWorkflow,
  asRecord,
  extractPositions,
  toStringValue,
  type ApiWorkflowNode,
} from "~/lib/comfyui/raw";
import {
  cacheJson,
  cacheDel,
  cacheDelPrefix,
  cachePeek,
} from "~/lib/server-cache";
import { parseModesJson } from "~/lib/workflow/workflow-types";
import { type IOParamSlot } from "~/lib/workflow/workflow-io-types";
import { createObjectInfoResolvers } from "~/lib/comfyui/workflow-detail-combo";
import { inferIsMultiline } from "~/lib/comfyui/types";
import {
  buildRawInputs,
  buildRawNodeMeta,
  buildNodeTypeMap,
  buildInnerNodeInputs,
  buildRawView,
  type DetailNodeView,
  type RawNodeMeta,
  type RawViewPacket,
} from "~/lib/comfyui/workflow-detail-raw";
import {
  hasExecutableWorkflow,
  hasRawContent,
} from "~/lib/comfyui/execution-shape";
import { buildRawViewGraph } from "~/lib/comfyui/raw-view-graph";
import {
  enrichWorkflowIO,
  type WorkflowIOEntry,
  type WorkflowIORawEntry,
} from "~/lib/comfyui/workflow-detail-io";
import {
  parseSubgraphLinks,
  boundarySlotsByNode,
  reportDroppedBoundaryLinks,
  buildSubgraphGraph,
  parseSubgraphPins,
  buildBoundaryLinks,
  extractSubgraphAnnotations,
  type BoundaryLink,
  type BoundaryPin,
} from "~/lib/comfyui/workflow-subgraph-parse";

/** workflowIO 条目（enrichWorkflowIO 的返回形状 + 方向/种类收窄为判别联合）。
 *  `kind` 是 IO-edit 模式写入的三桶语义标记（param/widget/output），PATCH 原样
 *  落库、GET 原样回显；`direction` 由 `kind` 决定（output → output，其余 →
 *  input），在 JSON 序列化边界处按此判别联合收窄，与客户端
 *  `WorkflowDetail.workflowIO`（components/studio/workflow-types.ts 的
 *  `WorkflowIOParam`）保持 tRPC 推断兼容 —— 非法组合（output+param 等）在类型
 *  层面被排除。`kind` 的开放字符串取值（自定义种类）走 `WorkflowIOEntry` 透传，
 *  不进这条判别联合。 */
export type WorkflowDetailIOEntry = IOParamSlot &
  Omit<WorkflowIOEntry, "direction" | "kind">;

/** ComfyUI group frames 的下发形状（镜像客户端 WorkflowGroup，bypass 恒写入）。 */
export interface WorkflowDetailGroup {
  id: string;
  title: string;
  bounding: [number, number, number, number];
  color: string;
  bypass: boolean;
}

/** Note / MarkdownNote 注记的下发形状（镜像客户端 WorkflowNote）。 */
export interface WorkflowDetailNote {
  id: string;
  title: string;
  text: string;
  pos: [number, number];
  size: [number, number];
  color: string;
}

/** `findByIdForUserSelect` 的行类型（含 detail 转换用到的全部列）。
 *  单独起名是为了让 `buildWorkflowDetailJson` 的参数可读——
 *  它只依赖这份行数据，不依赖调用方的其它上下文。 */
type WorkflowDetailTemplateRow = NonNullable<
  Awaited<ReturnType<typeof workflowTemplateRepository.findByIdForUserSelect>>
>;

/** 历史的 `GET /api/workflows/:id`（及其子图变体）返回的形状 ——
 *  与客户端 components/studio/wf-types.ts 里的 `WorkflowDetail` 接口对应。
 *  有些字段只出现在子图变体上。
 *  subgraph variant. */
export interface WorkflowDetailFull {
  id: string;
  name: string;
  taskType: string;
  /** 该工作流可运行的全部模式码（从 JSON 字符串列解析）。
   *  子图变体不带这个字段。改名 `availableModes` 以与 `WorkflowIOParam.modeOverrides`
   *  （按模式码的覆盖层）区分 —— 两者同名 `modes` 是历史命名地雷。 */
  availableModes?: string[];
  defaultMode?: string | null;
  graph: Record<string, ApiWorkflowNode>;
  /** 导入时的原始 RAW（UI 格式）JSON。 */
  rawJson?: unknown;
  nodes: DetailNodeView[];
  /** 从 rawJson 重新推导出的 RAW 视图包（nodes / positions / graph）。 */
  rawView?: RawViewPacket | null;
  paramMap: Record<string, string>;
  workflowIO: Record<string, WorkflowDetailIOEntry>;
  positions: Record<string, [number, number]> | null;
  groups: WorkflowDetailGroup[];
  notes: WorkflowDetailNote[];
  rawNodes: RawNodeMeta[];
  format: string;
  hasRaw?: boolean;
  usable?: boolean;
  sourcePath?: string | null;
  sourceChanged?: boolean;
  sourceMissing?: boolean;
  source?: "local" | "online";
  /** 子图变体：顶层工作流的 id。 */
  parentId?: string;
  /** 子图变体：请求的子图 UUID。 */
  subgraphUid?: string;
  /** 子图变体：边界 pin 实体。 */
  boundaryPins?: {
    inputs: BoundaryPin[];
    outputs: BoundaryPin[];
  };
  /** 子图变体：哨兵连线 ↔ pin/槽位 的配对。 */
  boundaryLinks?: BoundaryLink[];
}

/** 把已读出的工作流行转换成下发给客户端的序列化 JSON。
 *
 *  这是 `buildWorkflowDetailFull` 里那段 278 行 `cacheJson` 闭包的正身：闭包体
 *  只被调用一次、又不返回值对象而是一段 JSON 字符串，所以「它做了什么」在调用点
 *  看不出来，缩进还与外层脱节（ISSUE #570 第 4 项）。抽成具名函数后语义与调用点
 *  分开、可单独 profile，`cacheJson` 在那头只做缓存包裹。
 *
 *  `sourcePath` / `sourceChanged` / `sourceMissing` 由调用方（re-import 判定）
 *  算好后传入 —— 本函数只管转换，不碰磁盘。 */
async function buildWorkflowDetailJson(input: {
  tpl: WorkflowDetailTemplateRow;
  comboOptionsForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<string[] | undefined>;
  comboOptionsForFieldName: (field: string) => Promise<string[] | undefined>;
  /** 某 class 某字段是否声明了 `{"multiline": true}`（object_info 的类型事实）。 */
  multilineForClassField: (
    classType: string | undefined,
    field: string,
  ) => Promise<boolean | undefined>;
  sourcePath: string | null;
  sourceChanged: boolean;
  sourceMissing: boolean;
}): Promise<string> {
  const {
    tpl,
    comboOptionsForClassField,
    comboOptionsForFieldName,
    multilineForClassField,
    sourcePath,
    sourceChanged,
    sourceMissing,
  } = input;
  /* rawJson 收窄为 RawWorkflow 视图（根不是普通对象时为 null，下游均有守卫，
   * 路径与旧 any 代码等价）。 */
  const raw = asRawWorkflow(tpl.rawJson);

  /* 算出**生效**的节点位置。
   *
   * `tpl.positions` 是记录用户手动拖拽结果的 DB 列。
   * `rawJson.nodes[i].pos` 携带导入工作流时 ComfyUI 的原始坐标 (x, y) ——
   * 用户在 ComfyUI 客户端里看到、也期望在这里看到的就是那些位置。
   * 两个来源分层叠加：rawJson 是默认**背景层**（每个节点导入时都有位置），
   * tpl.positions 是**前景覆盖层**（只有用户明确拖过的节点才会出现在里面）。
   * 对象展开的顺序天然完成合并：`{ ...背景, ...前景 }` → 同一个键以前景为准。
   *
   * 为什么必须这样合：
   *   1) 只拖过两三个节点的导入工作流，`tpl.positions` 很稀疏（例如 114 个里
   *      只有 2 个）。直接返回 tpl.positions 的话，画布会把那 2 个渲染在拖动后的
   *      位置、剩下 112 个全堆在 (padX, padY) 默认值上 —— 视觉上就是坏的，
   *      也与 ComfyUI 不一致。从 rawJson 补齐空隙，每个节点才落在 ComfyUI
   *      摆放的位置上。
   *   2) 没有 rawJson（异常数据）→ 背景层是 {} → 前景层胜出 →
   *      客户端回落到 Kahn 自动布局。
   *   3) 不对应任何图节点的陈旧键（例如子图视图用 merge:true PATCH 时漏进来的
   *      `grp:bpin:inputs`）无害：渲染器只按图节点 id 查位置，
   *      未知键会被静默忽略。
   *      ignored. */
  const positionsFromRaw =
    raw && Array.isArray(raw.nodes) ? extractPositions(raw) : {};
  const tplPositions =
    (tpl.positions as Record<string, [number, number]>) ?? {};
  const effectivePositions: Record<string, [number, number]> = {
    ...positionsFromRaw,
    ...tplPositions,
  };
  /* 两个来源都没有内容时，客户端应该对整张图跑 Kahn，
   * 而不是把一个空对象当成「就用这些（一个都没有）位置」。
   * 返回 null，客户端的稀疏守卫才会生效并干净地往下走。 */
  const positions =
    Object.keys(effectivePositions).length > 0 ? effectivePositions : null;

  /* 每个节点的输入元数据 + ComfyUI 的精确外框尺寸
   * （完整语义见 workflow-detail-raw.ts 的 buildRawInputs ——
   * 基础解析、seed 双槽捆绑、proxyWidgets 富化等）。
   * COMBO resolution). */
  const { rawInputsById, sizeById } = await buildRawInputs(
    raw,
    comboOptionsForClassField,
    multilineForClassField,
  );

  /* 稀疏的原始节点元数据 —— 只够画布编辑器渲染 OUTPUT 端口条、
   * 以及喂给子图 UI 节点（它们需要 widget_values 给字段打标签）。
   * 这里**不**下发完整的原始图：保存过的 positions 已经在 detail 上了。 */
  const rawNodeMeta = buildRawNodeMeta(raw);

  /* 派生视图图（保留 subgraph wrapper）就是 `detail.nodes` / `detail.graph`
   * 的来源：`rawJson` 是唯一的存库原件。 */
  const viewGraph = buildRawViewGraph(raw ?? { nodes: [] });
  const nodes: DetailNodeView[] = Object.entries(viewGraph).map(
    ([nodeId, n]) => {
      // ComfyUI 的导出形态不一：新快照用 `class_type`，旧的与部分 rgthree-comfy
      // 导出只有 `type`。回落读 `type`，下面那句「是否为子图封装节点」的判断才能
      // 认出两个字段里任一处的 UUID 类名 —— 少了这道回落，每个节点都会被渲染成
      // 普通的 WorkflowNode，子图封装节点会把 10+ 行 IO **内联摊开**，
      // 而不是被认成 `is_subgraph: true` 去用紧凑的 WorkflowSubgraphNode。
      // （与旧 `n?.class_type || (n?.type as string) || "?"` 逐值等价：
      //  `a || b` ≡ `a ? a : b`，空串同样回退。）
      const classType: string = n.class_type
        ? n.class_type
        : n.type
          ? (n.type as string)
          : "?";
      const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
      /* 子图封装节点（class_type === UUID）的显示名取自
       *  raw.definitions.subgraphs[uid].name。与子图路由的 `sub` 解析器同一套
       *  查找方式（子图的键可能是 UUID，也可能是它内部的 `.id` 字段）。
       *  名字缺失时回落到既有的空字符串哨兵 —— 那是最后的兜底标签，
       *  客户端 friendlyNodeTitle() 随后会渲染成「子工作流」——
       *  也就是最后的兜底标签，与改动前的行为一致。 */
      let resolvedTitle: string | undefined;
      if (isUuidClass && raw?.definitions?.subgraphs) {
        const subs = raw.definitions.subgraphs;
        let def = subs[classType];
        if (!def) {
          const matchKey = Object.keys(subs).find(
            (key) => subs[key]?.id === classType,
          );
          if (matchKey) def = subs[matchKey];
        }
        if (def && typeof def.name === "string" && def.name.trim()) {
          resolvedTitle = def.name.trim();
        }
      }
      return {
        id: nodeId,
        class_type: classType,
        title:
          resolvedTitle ??
          n._meta?.title ??
          (isUuidClass ? "" : classType) ??
          nodeId,
        is_subgraph: isUuidClass,
        raw_inputs: rawInputsById[nodeId] ?? [],
        /* 该节点的 ComfyUI 精确外框尺寸（[w, h]）。rawJson 里没有该节点时为
         *  undefined —— 客户端回落到按内容驱动的 min/max 宽度布局。 */
        size: sizeById[nodeId],
      };
    },
  );

  /* raw 视图专用数据包：与 `detail.nodes` 同源（都从 rawJson 派生），保留
   * subgraph wrapper 整卡，供 RAW 布局与 ComfyUI 自身画布对齐。 */
  const rawView = buildRawView(raw, rawInputsById, sizeById);

  const paramMap = (tpl.paramMap as Record<string, string>) ?? {};
  // 用户挑出来的暴露集合：哪些节点参数 / widget / 输出被暴露成工作流的
  // 对外输入输出。（ioKey 是 `${nodeId}::${kind}::${name}`；
  // 见画布编辑器的 IO 编辑模式。）
  const workflowIORaw = (asRecord(tpl.workflowIO) ?? {}) as Record<
    string,
    WorkflowIORawEntry
  >;

  const nodeTitleById: Record<string, string> = {};
  for (const n of nodes) nodeTitleById[n.id] = n.title ?? n.class_type;

  /* ── workflowIO ENRICHMENT ──
   * 落库的勾选只记录「哪个 pin 被暴露」（`direction` / `kind` / `nodeId` /
   * `name`）。而 `kind` 是**语义**分桶（"param" | "widget" | "output"），
   * **不是** ComfyUI 数据类型 —— 想渲染一个控件（多行框 / 数字 / 开关 /
   * 图片上传）的消费方，光靠它无法判断该渲染什么。
   *
   * 与其让每个客户端各自按 (nodeId, name) 去 join
   * `nodes[].raw_inputs[]` 与 `rawNodes[].outputs[]`，不如在这里 join 一次，
   * 下发一份自描述记录：
   *   type          ComfyUI 数据类型 —— "STRING" | "INT" | "FLOAT" |
   *                 "BOOLEAN" | "IMAGE" | "LATENT" 等（未知时为 "*"）
   *   defaultValue  当前 widget 值（API 图里的字面量），
   *                 动态表单据此预填，而不是显示空白
   *   label         最优显示标签（label > localized > name）
   *   nodeTitle     所属节点的标题，用来区分不同节点上的同名 pin
   *                 （3 个采样器上都有 "seed"）
   *   multiline     ComfyUI 标为「类多行」（提示词级别）的 STRING 输入 →
   *                 渲染成多行文本框而不是单行
   * 消费方：DynamicWorkflowForm（CreatePanel 与画布工作流节点）、
   * 以及画布的自动派生逻辑（第一个输出的 `type` 决定下游节点是图像还是视频）。
   * 实现落在 workflow-detail-io.ts。 */
  const workflowIO = await enrichWorkflowIO({
    workflowIORaw,
    rawInputsById,
    /* 子图内部节点索引：下钻到子工作流里勾选的参数，nodeId 指向内部节点，
     *  顶层 rawInputsById 查不到 —— 没有它类型/显示名都会退化（ISSUE #349）。 */
    innerInputsById: buildInnerNodeInputs(raw),
    rawNodeMeta,
    graph: viewGraph,
    nodeTitleById,
    nodeTypeById: buildNodeTypeMap(raw),
    comboOptionsForClassField,
    comboOptionsForFieldName,
    multilineForClassField,
  });

  /* ── 分组（ComfyUI 的 frame 矩形）──
   * 原始 UI 格式把它们存在 `raw.groups[]` 里，每项大致形如：
   *   { title, bounding: [x, y, w, h], color }（color 是十六进制字符串）
   * 透传出去，编辑器便能渲染出忠实、且**支持嵌套**的背景框
   * （子分组的包围盒落在父分组内部）。 */
  const groups: WorkflowDetailGroup[] = [];
  if (raw && Array.isArray(raw.groups)) {
    raw.groups.forEach((g: unknown, idx: number) => {
      const rec = asRecord(g);
      if (!rec) return;
      const bounds: unknown[] =
        Array.isArray(rec.bounding) && rec.bounding.length >= 4
          ? rec.bounding
          : [0, 0, 0, 0];
      groups.push({
        id: toStringValue(rec.id ?? `g-${idx}`),
        title: typeof rec.title === "string" ? rec.title : "",
        bounding: [
          Number(bounds[0]) || 0,
          Number(bounds[1]) || 0,
          Number(bounds[2]) || 0,
          Number(bounds[3]) || 0,
        ],
        color: typeof rec.color === "string" ? rec.color : "#3b3b3b",
        /* 分组旁路状态。透传出去，rgthree 的 `Fast Groups Bypasser`
         *  运行期 UI 才能反映、并经 PATCH 切换每个匹配分组的
         *  `flags.bypass`。存在 rawJson 里该分组的 `flags` 对象上 ——
         *  与 ComfyUI 自己的前端读的是同一处。 */
        bypass: !!asRecord(rec.flags)?.bypass,
      });
    });
  }

  /* ── 便签（Note / MarkdownNote 注释节点）──
   * 文本在 widgets_values[0]，位置与尺寸在 pos/size。 */
  const notes: WorkflowDetailNote[] = [];
  if (raw && Array.isArray(raw.nodes)) {
    raw.nodes.forEach((n) => {
      if (!n || (n.type !== "Note" && n.type !== "MarkdownNote")) return;
      const pos = Array.isArray(n.pos) && n.pos.length >= 2 ? n.pos : [0, 0];
      const size =
        Array.isArray(n.size) && n.size.length >= 2 ? n.size : [220, 120];
      const wv = Array.isArray(n.widgets_values) ? n.widgets_values[0] : "";
      const text = typeof wv === "string" ? wv : toStringValue(wv ?? "");
      // ComfyUI 的 Note 节点可能带显式的 `title` 字段（较新版本）；
      // 没有就留空，客户端会回落到「从第一行 markdown 标题里提取」。
      const title = typeof n.title === "string" ? n.title : "";
      notes.push({
        id: String(n.id),
        title,
        text,
        pos: [Number(pos[0]) || 0, Number(pos[1]) || 0],
        size: [Number(size[0]) || 220, Number(size[1]) || 120],
        color: typeof n.color === "string" ? n.color : "#3a3a3a",
      });
    });
  }

  /* 执行载荷恒为 RAW 原件 —— comfy-cli 直接吃它（按节点类定义做权威 UI→API
   * 转换），所以可执行性就是「rawJson 列有没有内容」（判据的唯一出处
   * `hasExecutableWorkflow`）。 */
  const detailHasRaw = hasRawContent(raw);
  const detailUsable = hasExecutableWorkflow({ rawJson: tpl.rawJson });
  return JSON.stringify({
    id: tpl.id,
    name: tpl.name,
    taskType: tpl.taskType,
    /** 多模式支持。`availableModes` 是该工作流可运行的全部模式码（在这里解析
     *  JSON 字符串列）；`defaultMode` 是规范默认值（写入时与 `taskType`
     *  保持同步）。 */
    availableModes: parseModesJson(tpl.modes),
    defaultMode: tpl.defaultMode ?? null,
    graph: viewGraph,
    /** 导入时的原始 RAW（UI 格式）JSON —— 透传出去，客户端便能按原生形态
     *  查看 / 重新下载源。 */
    rawJson: raw,
    nodes,
    /** RAW 视图专用节点/位置/图（保留 subgraph wrapper）。
     *  rawView 从 rawJson 派生，RAW 视图据此渲染原始节点（含 wrapper 紫色整卡）。
     *  null 表示该工作流无 rawJson。 */
    rawView,
    paramMap,
    /* 把 enrichWorkflowIO 下发的宽类型条目（direction / kind 各为独立宽联合）
     *  收窄成判别联合：direction 由 kind 决定（output → output，其余 → input），
     *  这样 `WorkflowDetail.workflowIO`（客户端 WorkflowIOParam，同为判别联合）
     *  在 tRPC 推断上严格兼容，非法组合（output+param 等）在类型层面被排除。 */
    workflowIO: Object.fromEntries(
      Object.entries(workflowIO).map(([k, e]) => {
        /* direction 由 kind 决定（output → output，其余 → input），先合成判别联合
         *  的 slot 再展开，确保 WorkflowDetailIOEntry 与客户端 WorkflowIOParam
         *  （同为 IOParamSlot 判别联合）严格兼容。 */
        const slot: IOParamSlot =
          e.kind === "output"
            ? { direction: "output", kind: "output" }
            : { direction: "input", kind: e.kind as "param" | "widget" };
        return [k, { ...e, ...slot } satisfies WorkflowDetailIOEntry];
      }),
    ),
    positions,
    groups,
    notes,
    rawNodes: rawNodeMeta,
    format: "raw",
    hasRaw: detailHasRaw,
    usable: detailUsable,
    sourcePath,
    sourceChanged,
    sourceMissing,
    /** 分类：绑定到磁盘文件时为 "local"，否则 "online"。 */
    source: sourcePath ? "local" : "online",
  });
}

/** 丢弃某个工作流已缓存的详情（顶层 + 它的全部子图视图）。
 *
 *  PATCH 之后必须调用：服务端详情缓存 TTL 30s，不主动清的话客户端就算重新
 *  拉 `detailFull` 也会拿回改动前的富化 IO，界面看起来像「改了没生效」。 */
export function invalidateWorkflowDetailCache(
  userId: string,
  id: string,
): void {
  cacheDel(`wf:${userId}:${id}`);
  cacheDelPrefix(`sg:${userId}:${id}:`);
}

export async function buildWorkflowDetailFull(
  userId: string,
  id: string,
  opts: { bust?: boolean } = {},
): Promise<WorkflowDetailFull> {
  const cacheKey = `wf:${userId}:${id}`;

  /* COMBO 候选值解析器。ComfyUI 的 COMBO widget
   * （unet_name / clip_name / vae_name / ckpt_name 等）在原始 JSON 里
   * **不带**候选清单 —— 唯一权威来源是 /api/object_info。解析器每次请求取一次
   * （fetchObjectInfo 自身缓存 5 分钟，且 ComfyUI 不可达时降级为 null），
   * 把 `classType + 字段名` 解析成候选数组，让项目画布表单与子图封装节点能渲染
   * 真正的 <select>，而不是自由文本输入框。
   * 缺失 / 不可达 → undefined → 优雅回落到普通文本控件。
   * 实现落在 workflow-detail-combo.ts。 */
  const {
    comboOptionsForClassField,
    comboOptionsForFieldName,
    multilineForClassField,
  } = createObjectInfoResolvers();

  /* ?_bust=1 查询参数强制内存 LRU 被
   *  bypassed (deleted + re-built) so the 顶栏 🔄 强制重载按钮 can pull
   *  绕过，强制从 Prisma 现读一份序列化结果。没有它，客户端即使带
   *  cache:"no-store"，仍会从服务端内存里拿到一份已陈旧 60 秒的、预先序列化好的
   *  JSON。这个标记刻意只作为客户端私有 token —— **从不打日志**。 */
  if (opts.bust) {
    cacheDel(cacheKey);
  }

  /* ── 本地文件工作流：检出磁盘变更并自动重新导入 ──
   *  如果这个工作流是从本地文件导入的（设置了 sourcePath），先 stat 一下文件
   *  （很便宜），好在返回陈旧缓存之前把它重新导入。
   *  用户在 ComfyUI 里改完文件、刷新就能看到最新内容，靠的就是这一步 ——
   *  **有没有**点 🔄 强制重载都一样。
   *  `meta` 是轻量查询，免得把（很大的）rawJson 拖两遍；
   *  缓存未命中时下面仍会完整读一次。 */
  let sourceChanged = false;
  let sourceMissing = false;
  let sourcePath: string | null = null;
  const meta = await workflowTemplateRepository.findByIdForUserSelect(
    userId,
    id,
    {
      id: true,
      sourcePath: true,
      sourceMtime: true,
      sourceChecksum: true,
      taskType: true,
    },
  );
  if (meta?.sourcePath) {
    sourcePath = meta.sourcePath;
    const { reimportFromSource } = await import("~/lib/comfyui/importSource");
    const re = await reimportFromSource({
      sourcePath: meta.sourcePath,
      sourceMtime: meta.sourceMtime,
      sourceChecksum: meta.sourceChecksum,
      /* 透传已存在的 taskType 让 reimport 时保留
       * 用户在 UI 里手动设置的值（不再被自动推断覆盖）。 */
      existingTaskType: meta.taskType ?? null,
    });
    if (re.missing) {
      sourceMissing = true;
      cacheDel(cacheKey); // rebuild so the missing flag reaches the client
    } else if (re.update) {
      await workflowTemplateRepository.update(id, {
        rawJson: re.update.rawJson,
        positions: re.update.positions,
        paramMap: re.update.paramMap,
        taskType: re.update.taskType,
        sourceChecksum: re.update.sourceChecksum,
        sourceMtime: re.update.sourceMtime,
      });
      sourceChanged = true;
      cacheDel(cacheKey); // force a fresh re-serialisation below
    }
  }

  /* 热路径：如果预序列化好的 detail 已在缓存里，直接返回 ——
   * 既跳过对（很大的）rawJson 的 Prisma 读取，也省掉每次请求的 JSON.stringify。
   * 反复打开能压到 50ms 以内靠的就是这一步。
   * （缓存在 PATCH / DELETE 时失效；404 从不缓存。） */
  const cached = cachePeek<string>(cacheKey);
  if (cached !== undefined && typeof cached === "string") {
    return JSON.parse(cached) as WorkflowDetailFull;
  }

  const tpl = await workflowTemplateRepository.findByIdForUserSelect(
    userId,
    id,
    {
      id: true,
      name: true,
      taskType: true,
      modes: true,
      defaultMode: true,
      graph: true,
      paramMap: true,
      workflowIO: true,
      rawJson: true,
      positions: true,
    },
  );
  if (!tpl)
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到该工作流" });

  /* 下面的转换是纯的（只依赖 tpl.graph / tpl.rawJson / tpl.positions，
   * 它们在两次写入之间不会变），因此按 user+id 缓存**已序列化**的 JSON 字符串，
   * 反复打开原样返回。
   *
   * TTL 从 60_000ms 收到 30_000ms —— 即使客户端 cache:"no-store" 被绕过，
   * 陈旧度也最多锁在 30 秒。 */
  const detailJson = await cacheJson(cacheKey, 30_000, () =>
    buildWorkflowDetailJson({
      tpl,
      comboOptionsForClassField,
      comboOptionsForFieldName,
      multilineForClassField,
      sourcePath,
      sourceChanged,
      sourceMissing,
    }),
  );

  return JSON.parse(detailJson) as WorkflowDetailFull;
}

export async function buildSubgraphDetail(
  userId: string,
  id: string,
  uid: string,
  /** 宿主链前缀（`4` / `4:5`）。拖拽落库时子图内部节点用的是 `宿主:内部`
   *  拼接键，读回时必须按同一个口径还原，否则子图里拖过的位置在下次打开
   *  时全部退回原始坐标。 */
  hostId = "",
): Promise<WorkflowDetailFull> {
  const cacheKey = `sg:${userId}:${id}:${uid}:${hostId}`;

  /* 热路径：原样返回预序列化的子图详情，跳过 Prisma 读取与转换。
   * （下面 400 / 404 那两种情况从不缓存。） */
  const cached = cachePeek<string>(cacheKey);
  if (cached !== undefined && typeof cached === "string") {
    return JSON.parse(cached) as WorkflowDetailFull;
  }

  const tpl = await workflowTemplateRepository.findByIdForUserSelect(
    userId,
    id,
    {
      id: true,
      name: true,
      taskType: true,
      graph: true,
      rawJson: true,
      positions: true,
      paramMap: true,
    },
  );
  if (!tpl)
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到该工作流" });

  const raw = asRawWorkflow(tpl.rawJson);
  if (!raw?.definitions?.subgraphs) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "该工作流没有内嵌子工作流",
    });
  }

  // 子图定义的键可能是 UUID，也可能是数字 id；
  // ComfyUI 对较新的工作流用 UUID 作键。
  const subgraphs = raw.definitions.subgraphs;
  let sub = subgraphs[uid];
  if (!sub) {
    // 退回按 .id 字段匹配
    const matchUid = Object.keys(subgraphs).find(
      (key) => subgraphs[key]?.id === uid,
    );
    if (matchUid) sub = subgraphs[matchUid];
  }
  if (!sub) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `未找到子工作流 ${uid.slice(0, 8)}`,
    });
  }

  /* 子图转换只依赖 tpl.rawJson（两次写入之间不变），因此按 user+id+uid 缓存
   * 已序列化的 JSON 字符串。TTL 比顶层 detail 长 —— 子图变得比整份工作流
   * less often. */
  /* 本路由只用到 object_info 解析器的「声明型多行」查询（子图内部节点的
   *  STRING 是否 `{"multiline": true}`）；COMBO 候选仍由顶层详情路由负责。 */
  const { multilineForClassField } = createObjectInfoResolvers();

  const detailJson = await cacheJson(cacheKey, 120_000, async () => {
    /* 哨兵连线索引 + 内部节点图转换 + 边界栏杆，全都在
     * workflow-subgraph-parse.ts 里（见那个模块的文档）。 */
    const { linkById, boundaryLinkInfoById } = parseSubgraphLinks(sub);
    /* 边界槽位下标要先于槽位表算出来：ComfyUI 的 \`target_slot\` 与节点自带
     *  \`idx\` 在某些导出路径上口径不同，只有哨兵边记下的关联是权威事实
     *  （见 \`parseSubgraphSlots\`）。 */
    const sg = buildSubgraphGraph(
      sub,
      linkById,
      boundarySlotsByNode(boundaryLinkInfoById),
    );
    /* 子图内部 STRING 输入的多行判定：`buildSubgraphGraph` 是同步的，读不到
     *  object_info 的声明 —— 就地补盖一次。判据仍只有 `inferIsMultiline`
     *  一处（「值很长」那条它已经盖过），不补的话短提示词的内部节点会退化成
     *  单行输入。 */
    for (const [nodeId, entries] of Object.entries(sg.rawInputsById)) {
      const classType = sg.graph[nodeId]?.class_type;
      for (const entry of entries) {
        if (entry.type !== "STRING" || entry.multiline) continue;
        if (
          inferIsMultiline(
            await multilineForClassField(classType, entry.name),
            entry.widgetValue,
          )
        ) {
          entry.multiline = true;
        }
      }
    }
    /* 子图暴露口的作者名（proxyWidgets 被隔离时长名字的来源），随节点下发给
     *  客户端「就地派生富化」用 —— 顶层富化在这里也在场，直接按
     *  `节点id::widget::槽位名` 预先打进内层节点的 raw_inputs（见下）。
     *  查表键必须带节点 id：内部槽位名在同一子图里会重名（四个 `PrimitiveInt`
     *  的入参都叫 `value`），只按槽位名查会把最后一个暴露口的作者名安到所有
     *  同名字段上（ISSUE #394：`Seed` 节点显示成 `FPS`）。 */
    for (const n of sg.nodes) {
      for (const inp of n.raw_inputs ?? []) {
        const authorLabel = sg.proxyAuthorLabels[`${n.id}::${inp.name}`];
        if (!authorLabel) continue;
        /* 只对「本层槽位名与作者名不同」的暴露口打标；`field` 用槽位名本身，
         *  让富化按本层名字回查得中（顶层 `innerInputsById` 的键就是槽位名）。 */
        if (inp.name === authorLabel) continue;
        inp.label = authorLabel;
        inp.proxyField ??= { nodeId: "", field: inp.name, label: authorLabel };
      }
    }
    const { boundaryPins, pinIdByLinkId } = parseSubgraphPins(sub);
    const boundaryLinks = buildBoundaryLinks(
      boundaryLinkInfoById,
      pinIdByLinkId,
      sg.inputNameByNodeSlot,
      sg.outputNameByNodeSlot,
    );
    /* 被丢掉的边界连线必须留下可诊断的痕迹：否则「这条线没画出来」在界面上
     *  只是一个安静的空白，排障时既不知道是哪条边、也无从判断是数据问题还是
     *  渲染问题（规范 10 §10.3.1：降级不得静默）。 */
    reportDroppedBoundaryLinks(
      sub,
      boundaryLinkInfoById,
      pinIdByLinkId,
      boundaryLinks,
    );
    const ann = extractSubgraphAnnotations(
      sub,
      (tpl.positions as Record<string, [number, number]>) ?? {},
      hostId,
    );

    return JSON.stringify({
      id: `${tpl.id}#subgraph:${uid}`,
      name: typeof sub.name === "string" && sub.name ? sub.name : "子工作流",
      taskType: tpl.taskType,
      graph: sg.graph,
      nodes: sg.nodes,
      paramMap: tpl.paramMap ?? {},
      positions: ann.positions,
      groups: ann.groups,
      notes: ann.notes,
      rawNodes: sg.rawNodeMeta,
      format: "raw-subgraph",
      /* 带上父工作流 id 与子图 uid，客户端想重新拉取时，
       *  面包屑才对得上。 */
      parentId: tpl.id,
      subgraphUid: uid,
      /* 边界栏杆数据 —— 客户端把每个 pin 渲染成一个独立的 wfIoPort 节点
       *  （纯标签），在左 / 右两列排得干干净净；并用 `boundaryLinks` 从 pin 的
       *  handle 向内部节点对应的输入/输出 handle 生成 React Flow 边。
       *  权威结构见 `sub.inputs` / `sub.outputs`：每个 pin 自带 UUID（`id`）、
       *  `name`、`type`、`label`、`pos`（保存的 [x, y]）与 `linkIds`
       *  （进出内部节点的穿边界线）。
       *  nodes). */
      boundaryPins,
      boundaryLinks,
    });
  });

  return JSON.parse(detailJson) as WorkflowDetailFull;
}
