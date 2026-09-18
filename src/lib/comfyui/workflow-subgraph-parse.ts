/**
 * 子图（内层工作流）解析助手。
 *
 * 这些纯函数把 `definitions.subgraphs[uid]` 定义转成子图详情构建器要出的
 * API 图、节点元数据、边界 pin 与注释。全部**不含 IO**
 * （位置覆盖层由调用方传入），因此调用方可以直接把序列化结果缓存起来。
 */
import {
  asRecord,
  pairWidgetValues,
  SubgraphLinkSchema,
  SubgraphPinSchema,
  toStringValue,
  type ApiWorkflowNode,
  type RawNodeInput,
  type RawNode,
  type RawSubgraphDef,
} from "~/lib/comfyui/raw";
import { inferIsMultiline } from "~/lib/comfyui/types";
import { logger } from "~/lib/core/logger";
import {
  type DetailNodeView,
  type RawInputEntry,
  type RawNodeMeta,
  type RawOutputEntry,
} from "~/lib/comfyui/workflow-detail-raw";

/* IMAGE 输入的缩略图预览。与父级路由保持一致：只把 LoadImage 的上游文件名
 * 以合成 `preview` 标记条目的形式挂在 LoadImage 节点**自身**上；
 * **不**把 `imageRef` 传播到下游的 IMAGE 输入（ImageScale / CLIPVisionEncode 等）
 * —— 那里只会显示未缩放 / 未编码的上游图，用户反馈说那样没有意义。
 * LoadImage 没上传图（widgets_values[0] 缺失或为空）时仍会推一条合成条目，
 * the synthetic entry so the body can show a 「需要上传图片」 placeholder. */
const LOAD_IMAGE_NODE_TYPES = new Set([
  "LoadImage",
  "LoadImageMasked",
  "ComfyUI LoadImage",
  "ComfyUI-LoadImage",
  "Load Image",
  "ImageLoader",
  "ComfyUI-ImageLoader",
]);

/** 按节点归拢「被哨兵边实际关联的槽位」——**这是下标口径的唯一权威事实**。
 *
 *  ComfyUI 在不同导出路径上给出的「槽位」下标口径并不一致：有的写它在内层节点
 *  `inputs[]` 里的下标，有的写**控件序号**（把 `model`/`negative` 这类纯连接口排除
 *  在外，`target_slot` 于是会超出 `inputs[]` 的长度）。边界连线的 handle id 必须落在
 *  **真的挂载了 Handle 的那一行**上，否则 React Flow 找不到锚点、整条边被丢弃并打
 *  error#008 —— 用户看到的是「这个暴露口从来没连上」。
 *
 *  所以不猜口径，而是把「ComfyUI 实际关联的那个槽位」记下来交给
 *  `parseSubgraphSlots` 解析：`-10` 哨兵边的目标槽位就是内层消费节点的输入槽，
 *  槽位名与「哪一行真的有边」于是永远同源。 */

export function boundarySlotsByNode(
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>,
): Record<string, number[]> {
  const byNode: Record<string, Set<number>> = {};
  for (const info of Object.values(boundaryLinkInfoById)) {
    (byNode[info.innerNodeId] ??= new Set()).add(info.innerSlot);
  }
  const out: Record<string, number[]> = {};
  for (const [nodeId, slots] of Object.entries(byNode))
    out[nodeId] = [...slots].sort((a, b) => a - b);
  return out;
}

export interface SubgraphLinkEntry {
  src: string;
  slot: number;
  type: string;
  targetId: string;
  targetSlot: number;
}

export interface BoundaryLinkInfo {
  kind: "input" | "output";
  pinId: string;
  /** 内部节点侧：输出边界连线当源、输入边界连线当目标。 */
  innerNodeId: string;
  innerSlot: number;
  innerSlotName?: string;
}

/**
 * 建一张 link-id → {src, slot, type, targetId, targetSlot} 的查找表，
 * 好把原始格式的连线对象还原成 API 格式的 [srcId, srcSlot] 元组，
 * 填进每个目标节点的输入。
 *
 * 注意：较新的 ComfyUI 里 `sub.links` 是**对象数组**，不再是旧版的扁平元组
 * 数组：
 *   { id, origin_id, origin_slot, target_id, target_slot, type }（字段名照旧）
 * origin_id 为 -10 / -20 的是子图用来标记跨边界连线的哨兵「输入/输出」节点；
 * 我们把它们排除在 API 图之外，画布上就显示成一段没有连接的内部端口。
 *
 * 另外把每条带哨兵的连线记进 `boundaryLinkInfoById`，
 * 路由响应便能交给画布一份精确的「边界 pin id ↔ 内部节点 handle」映射。
 * 这一版取代了此前「按内部节点是否消费/产出边界连线，把它标成端点」的做法 ——
 * 后者会在**每个内部节点都恰好在边界上**时出问题（例如一个小的 NOISE 子图，
 * 10 个 RandomNoise 节点各自的 noise_seed 输入与 NOISE 输出都要穿封装节点），
 * 表现为内部节点 id 互相碰撞、中间的卡片整片消失。
 * 干净的做法是把边界 **pin**（definitions.subgraphs[u].inputs / .outputs）
 * 当作一等实体，见下面的 `boundaryPins`。 */
export function parseSubgraphLinks(sub: RawSubgraphDef): {
  linkById: Record<number, SubgraphLinkEntry>;
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>;
} {
  const linkById: Record<number, SubgraphLinkEntry> = {};
  const boundaryLinkInfoById: Record<number, BoundaryLinkInfo> = {};

  for (const lk of Array.isArray(sub.links) ? sub.links : []) {
    const parsed = SubgraphLinkSchema.safeParse(lk);
    if (!parsed.success) continue;
    const rec = parsed.data;
    const id = Number(rec.id);
    if (!Number.isFinite(id)) continue;
    const originId = Number(rec.origin_id);
    const originSlot = Number(rec.origin_slot) || 0;
    const targetId = Number(rec.target_id);
    const targetSlot = Number(rec.target_slot) || 0;
    const type = toStringValue(rec.type ?? "*");
    linkById[id] = {
      src: Number.isFinite(originId) ? String(originId) : "?",
      slot: originSlot,
      type,
      targetId: Number.isFinite(targetId) ? String(targetId) : "?",
      targetSlot,
    };
    /* 只要有一端是哨兵，就把这条连线标进边界跟踪表。 */
    if (originId === -10 && Number.isFinite(targetId)) {
      boundaryLinkInfoById[id] = {
        kind: "input",
        pinId: `__pin_tbd__:${id}`, // resolved below after we walk boundary pins
        innerNodeId: String(targetId),
        innerSlot: targetSlot,
      };
    } else if (targetId === -20 && Number.isFinite(originId)) {
      boundaryLinkInfoById[id] = {
        kind: "output",
        pinId: `__pin_tbd__:${id}`,
        innerNodeId: String(originId),
        innerSlot: originSlot,
      };
    }
  }

  return { linkById, boundaryLinkInfoById };
}

/** 一个输入槽位在「槽位下标」与「raw 数组位置」两套坐标系里的落点。 */
interface InputSlotRef {
  /** 槽位下标 —— `names[slot]` 读到的就是它的槽位名。 */
  slot: number;
  /** 该槽位在原始 `inputs[]` 里的位置。 */
  index: number;
}

/** 把 raw 节点的 `inputs[]` 解析成「槽位下标 → 槽位」。
 *
 *  槽位下标的口径按**节点上有没有被哨兵边关联的槽位**择优，不做全局猜测：
 *  · 有（`boundarySlots`）→ 下标就是 raw 槽位数组的位置。哨兵边记下的关联就是
 *    事实（`target_slot: 2` 指向的正是 `inputs[2]`），而节点自带的 `idx` 在部分
 *    导出路径上给 widget 槽从 0 连续编号、不跳过纯连接槽，照抄会整体错位；
 *  · 没有 → 沿用 `idx`（缺席时按数组顺序），保持既有行为。
 *
 *  判据按节点取，所以同一子图里两种口径可以并存。 */
function resolveInputSlots(
  inputs: readonly RawNodeInput[],
  boundarySlots: readonly number[] | undefined,
): InputSlotRef[] {
  if (!boundarySlots || boundarySlots.length === 0) {
    return inputs
      .map((entry, index) => ({ index, slot: entry?.idx ?? index }))
      .sort((a, b) => a.slot - b.slot);
  }
  /* 哨兵边口径：**整张表按数组位置重建**（槽位下标 = 数组下标）。
   *
   *  不能只留被关联的那几个槽位 —— 槽位表是「下标 → 槽位名」的查表结构，缺项会
   *  让别的下标读到 undefined（边界值走的就是这张表）。整表重建才能保证「哨兵边
   *  指向的下标」与「真实渲染的那一行」对得上。 */
  return inputs.map((_, index) => ({ index, slot: index }));
}

/** 按槽位下标取槽位名（缺槽读成空串 = 「没解析出槽位名」）。 */
function slotNameAt(
  slots: readonly InputSlotRef[],
  inputs: readonly RawNodeInput[],
  index: number,
): string {
  const ref = slots.find((item) => item.slot === index);
  const name = ref ? inputs[ref.index]?.name : undefined;
  return typeof name === "string" ? name : "";
}

/**
 * 预处理：收集每个节点的输入/输出槽位名查找表（位置下标 → 槽位名）。
 * 有了它才能把哨兵连线的 `target_slot` / `origin_slot` 整数翻译成内部节点的
 * 槽位**名字** —— 后者才是 React Flow 边的 targetHandle / sourceHandle。
 * 新的 ComfyUI 会在槽位条目上带 `idx`；旧版没有，回落成数组顺序
 * （idx = 0,1,2,…）。 */
export function parseSubgraphSlots(
  sub: RawSubgraphDef,
  /** 被哨兵边**实际关联**的输入槽位（`boundarySlotsByNode(…)` 的产物）——
   *  ComfyUI 写下的关联是事实，能直接解开「下标口径不一致」的歧义。 */
  boundarySlotsByNodeId?: Record<string, number[]>,
): {
  inputNameByNodeSlot: Record<string, string[]>;
  outputNameByNodeSlot: Record<string, string[]>;
  inputWidgetValueByNodeSlot: Record<string, unknown[]>;
} {
  const inputNameByNodeSlot: Record<string, string[]> = {};
  const outputNameByNodeSlot: Record<string, string[]> = {};
  /** 每个节点的「原始输入/输出下标 → widget 值」查找表
   *  （用于**同时**带边界连线的输入，例如 CLIPTextEncode 的 text）。 */
  const inputWidgetValueByNodeSlot: Record<string, unknown[]> = {};

  const innerNodes: RawNode[] = Array.isArray(sub.nodes) ? sub.nodes : [];
  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const nodeId = String(rn.id);
    if (Array.isArray(rn.inputs)) {
      const rawInputs: RawNodeInput[] = rn.inputs;
      const slots = resolveInputSlots(
        rawInputs,
        boundarySlotsByNodeId?.[nodeId],
      );
      const widgets = Array.isArray(rn.widgets_values) ? rn.widgets_values : [];
      inputNameByNodeSlot[nodeId] = slots.map(({ slot }) =>
        slotNameAt(slots, rawInputs, slot),
      );
      // 按槽位顺序拍一份 widget 值快照，边界那一趟才能顺带给出默认 `value`
      // （封装节点把提示词暴露成输入时，CLIPTextEncode 的 `text` 就在这里）。
      inputWidgetValueByNodeSlot[nodeId] = slots.map(({ slot, index }) => {
        const slotInput = rawInputs[index];
        if (!slotNameAt(slots, rawInputs, slot)) return undefined;
        if (!slotInput?.widget) return undefined;
        return widgets[slot];
      });
    }
    if (Array.isArray(rn.outputs)) {
      const sorted = [...rn.outputs].sort(
        (a, b) => (a?.idx ?? 0) - (b?.idx ?? 0),
      );
      outputNameByNodeSlot[nodeId] = sorted.map((x) =>
        typeof x?.name === "string" ? x.name : "",
      );
    }
  }

  return {
    inputNameByNodeSlot,
    outputNameByNodeSlot,
    inputWidgetValueByNodeSlot,
  };
}

export interface SubgraphGraphResult {
  graph: Record<string, ApiWorkflowNode>;
  rawInputsById: Record<string, RawInputEntry[]>;
  rawOutputsById: Record<string, RawOutputEntry[]>;
  rawNodeMeta: RawNodeMeta[];
  sizeById: Record<string, [number, number]>;
  nodes: DetailNodeView[];
  inputEndpointNodes: Set<string>;
  outputEndpointNodes: Set<string>;
  boundaryInputByNode: Record<
    string,
    { name: string; type: string; value: unknown }
  >;
  boundaryOutputByNode: Record<string, { name: string; type: string }>;
  connectsToByNode: Record<string, string>;
  connectsFromByNode: Record<string, string>;
  /** 每个节点的槽位名查找表（位置下标 → 槽位名），
   *  交给调用方拼 boundaryLinks。 */
  inputNameByNodeSlot: Record<string, string[]>;
  outputNameByNodeSlot: Record<string, string[]>;
  /** 子图暴露口 → 作者写在**外层 wrapper** 上的业务名（`label`）。
   *
   *  勾选点落在外层封装卡片上时，落库的 `name` 是 wrapper 本层的槽位名；
   *  ComfyUI 在某些路径上把 `properties.proxyWidgets` 隔离掉
   *  （`proxyWidgetErrorQuarantine`），顶层富化于是查不到内部「真实的作者名」，
   *  只剩 ComfyUI 通用翻译（`seed` → `localized: "随机种"`）——作者写的
   *  `Seed` 就丢在这一层（ISSUE #349：切成随机值/固定值后名字退回 `value_1`）。
   *  内层视图的 wrapper 边界记录（`-10` 边的源节点）与本层槽位名一对就能
   *  把作者名捞回来，作为「按 alias 回退取名」的来源下发给顶层富化。
   *
   *  **键是 `节点id::槽位名`，不是裸槽位名**：一个子图里多个同类节点共享
   *  同一个内部槽位名（四个 `PrimitiveInt` 的入参都叫 `value`），只按槽位名
   *  记账会被后写的暴露口覆盖 —— 于是 `Seed` 节点显示成最后一个 `FPS` 的口名
   *  （ISSUE #394）。 */
  proxyAuthorLabels: Record<string, string>;
}

/**
 * 逐个走内部节点，产出 API 风格的图条目与 `nodes` 数组
 * （画布把它当 ComfyGraphNode 的扁平清单消费）。边界端点节点会盖上
 * `is_input_endpoint` / `is_output_endpoint`，客户端据此画出
 * INPUTS / OUTPUTS 的 wfGroup 矩形，不必重走一遍连线表。
 * link table.
 */
export function buildSubgraphGraph(
  sub: RawSubgraphDef,
  linkById: Record<number, SubgraphLinkEntry>,
  /** 被哨兵边实际关联的输入槽位（`boundarySlotsByNode(…)` 的产物）——槽位表
   *  按它解析，边界 handle id 才会落在真的挂载了 Handle 的那一行上。 */
  boundarySlotsByNodeId?: Record<string, number[]>,
): SubgraphGraphResult {
  const innerNodes: RawNode[] = Array.isArray(sub.nodes) ? sub.nodes : [];
  const graph: Record<string, ApiWorkflowNode> = {};
  const rawInputsById: Record<string, RawInputEntry[]> = {};

  const rawOutputsById: Record<string, RawOutputEntry[]> = {};
  /* 每个内部节点的 ComfyUI 精确外框尺寸（[w, h]）—— 透传出去，让内层画布的
   *  节点与导入配置里的尺寸一致。取自原始内部节点 JSON（sub.nodes）：
   *  下面那张合成 `graph` 表只保留 class_type 与 inputs。 */
  const sizeById: Record<string, [number, number]> = {};
  const rawNodeMeta: RawNodeMeta[] = [];
  /* 边界节点 id 收集器 —— 在走节点与连线的同一趟里填好，
   *  客户端便能直接标出「这个节点在子图的输入/输出边界上」，不必重扫连线。
   *  节点的某个输入由哨兵 `-10` 源馈入，它就是 INPUT 端点
   *  （子图暴露的输入 → 内部消费方）；同理，输出指向哨兵 `-20` 目标的是
   *  OUTPUT 端点（内部产出方 → 子图暴露的输出）。
   *
   *  这两个集合为了诊断保留，但客户端**不再依赖它们**。
   *  边界 **pin** 自身（定义在 `sub.inputs` / `sub.outputs`）带自己的 id 与
   *  位置 —— 把它们经新的顶层 `boundaryPins` 字段下发，才是渲染内层画布
   *  IO 栏杆的正确做法。`boundaryInputByNode` / `boundaryOutputByNode`
   *  同样保留，供历史的 `boundary_input` / `boundary_output` 调试字段用，
   *  客户端现在已经忽略它们。 */
  const inputEndpointNodes = new Set<string>();
  const outputEndpointNodes = new Set<string>();
  const boundaryInputByNode: Record<
    string,
    { name: string; type: string; value: unknown }
  > = {};
  const boundaryOutputByNode: Record<string, { name: string; type: string }> =
    {};
  const connectsToByNode: Record<string, string> = {};
  const connectsFromByNode: Record<string, string> = {};

  const { inputNameByNodeSlot, outputNameByNodeSlot } = parseSubgraphSlots(
    sub,
    boundarySlotsByNodeId,
  );

  /* 子图暴露口 → 作者名（见 SubgraphGraphResult.proxyAuthorLabels 的说明）。
   *  wrapper 的暴露口在内层表现为「源为 -10 哨兵的入边」，边本身登记着作者
   *  写在外层卡片的 `label`（`sub.inputs[].label`），源端槽位名就是 wrapper
   *  本层的槽位名（`value_1`）。两者一对，就能在 proxyWidgets 缺失时仍把作者
   *  名（`Seed`）交回上层富化。 */
  const proxyAuthorLabels: Record<string, string> = {};
  for (const pinRaw of Array.isArray(sub.inputs) ? sub.inputs : []) {
    const pin = asRecord(pinRaw);
    if (!pin) continue;
    const authorLabel = typeof pin.label === "string" ? pin.label.trim() : "";
    if (!authorLabel) continue;
    const linkIds = Array.isArray(pin.linkIds)
      ? pin.linkIds
      : Array.isArray(pin.links)
        ? pin.links
        : pin.link === undefined
          ? []
          : [pin.link];
    /* 哨兵边源端是外层 wrapper，`-10` 入边的 target 才是内层消费节点：
     *  作者名只有外层 `pin.label` 一处，槽位名取自那个内层节点的暴露槽位
     *  （wrapper 本层槽位名与它同名）——两者一对，别名之外就有作者名可用。 */
    for (const lid of linkIds) {
      const lk = linkById[Number(lid)];
      /* 只在「源端是外层 wrapper 的哨兵边」上回收作者名。 */
      if (lk?.src !== "-10") continue;
      const slotNames: string[] | undefined = inputNameByNodeSlot[lk.targetId];
      const slotName = slotNames?.[lk.targetSlot];
      if (slotName)
        proxyAuthorLabels[`${lk.targetId}::${slotName}`] = authorLabel;
    }
  }

  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const nodeId = String(rn.id);
    const classType: string = rn.type ?? "?";
    /* 记下原始的 litegraph 外框尺寸，客户端才能按 ComfyUI 的精确尺寸
     *  画出这个节点（见上面 `sizeById` 的声明）。 */
    const rnSize =
      Array.isArray(rn.size) && rn.size.length >= 2 ? rn.size : undefined;
    if (rnSize)
      sizeById[nodeId] = [Number(rnSize[0]) || 0, Number(rnSize[1]) || 0];
    /* 每个输入的元数据。「内部」连线（源自子图内的另一个节点）与
     *  「边界」连线（源自输入哨兵节点 -10，值来自父级封装节点）分开标记。
     *  边界连线仍然记 isConnection（供 UI 打标签），但写 inputMap 时**跳过**，
     *  免得把值绑到一个哨兵源上。 */
    const rawInputs: RawInputEntry[] = [];
    const inputMap: Record<string, unknown> = {};
    if (Array.isArray(rn.inputs)) {
      const rnWidgets = Array.isArray(rn.widgets_values)
        ? rn.widgets_values
        : [];
      /* 哨兵感知的配对：ComfyUI 会在 seed 型 INT widget 之后往
       *  `widgets_values` 里插一个 `control_after_generate` 槽位，
       *  按位置硬对会把后面每个 widget 都错位一格。这里用共享助手
       *  （与 `resolveWidgetOrder` 同口径）做「widget 名 → 值」的映射 ——
       *  内部节点的 widget（KSampler 的 seed/steps/cfg/sampler/scheduler/
       *  denoise、CLIPTextEncode 的提示词等）才会显示真实值，
       *  而不是空白行或错位行。 */
      const wvMap = pairWidgetValues(rn.inputs, rnWidgets);
      for (const inp of rn.inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const isConn = inp.link != null;
        const widgetName =
          inp.widget && typeof inp.widget.name === "string"
            ? inp.widget.name
            : undefined;
        const widgetValue = widgetName ? wvMap[widgetName] : undefined;
        const entry: RawInputEntry = {
          name: inp.name,
          label: typeof inp.label === "string" ? inp.label : undefined,
          localized:
            typeof inp.localized_name === "string"
              ? inp.localized_name
              : undefined,
          type:
            typeof inp.type === "string" ? inp.type : isConn ? "*" : "STRING",
          /* 把边界连线（origin_id = -10/-20）标成 "isBoundary"，
           *  画布便能渲染成「封装节点暴露出来的输入」（它仍是一条连接，
           *  但子图内部没有真实的源节点）。 */
          isConnection: isConn,
          isBoundary: false, // set later if needed
        };
        if (widgetName) entry.widget = { name: widgetName };
        if (widgetValue !== undefined) entry.widgetValue = widgetValue;
        /* 与父级路由保持一致：给助手标出的 STRING 输入盖 `multiline`，
         *  免得很短的提示词输入被降级成单行芯片。
         *
         *
         *  这里是**同步**构建，读不到 object_info 的 `{"multiline": true}`
         *  声明（声明只能异步查）—— 因此只盖「值很长」那条数据判据，
         *  声明由调用方 `buildSubgraphDetail` 在构建之后补盖一次。
         *
         *  另外：不再向下游传播 IMAGE 输入的 `imageRef`，理由与父级路由相同 ——
         *  下游的 IMAGE 消费方只会再显示一遍未缩放 / 未编码的上游图，
         *  有误导性。只有 LoadImage 源节点带预览（在下面推的合成条目上）。 */
        if (
          typeof inp.type === "string" &&
          inp.type === "STRING" &&
          widgetValue !== undefined
        ) {
          if (inferIsMultiline(undefined, widgetValue)) entry.multiline = true;
        }
        rawInputs.push(entry);
        if (isConn) {
          const lk = linkById[Number(inp.link)];
          if (lk && lk.src !== "-10" && lk.src !== "-20") {
            inputMap[inp.name] = [lk.src, lk.slot];
          } else if (lk && (lk.src === "-10" || lk.src === "-20")) {
            /* 边界连线（子图暴露的输入/输出）—— 若该槽位同时声明了 widget，
             *  回落到 widget 值。CLIPTextEncode 的 `text` 就是这种情况：
             *  原始 JSON 里它既是 widget，又有 `link` 指向边界哨兵；
             *  我们要的是 widget 的默认值（真正的提示词文本），
             *  而不是一个连接元组。 */
            const last = rawInputs[rawInputs.length - 1];
            if (last) last.isBoundary = true;
            /* 把这个节点标成 INPUT 端点：源是哨兵 `-10` 意味着值来自父级
             *  封装节点，因此本节点是 INPUTS 侧的边界消费方。
             *  输入上出现输出哨兵 `-20` 在实践中很少，但它既然落进了
             *  「边界连线」分支，就同样归为 "input"。 */
            if (lk.src === "-10") inputEndpointNodes.add(nodeId);
            /* 存下边界端口细节，画布据此渲染一枚紧凑的 wfIoPort 标签。
             *  每个节点只记**第一个**边界输入（绝大多数端点就一个）。 */
            if (lk.src === "-10" && !boundaryInputByNode[nodeId]) {
              boundaryInputByNode[nodeId] = {
                name: inp.name,
                type: typeof inp.type === "string" ? inp.type : "*",
                value: widgetValue,
              };
            }
            if (widgetValue !== undefined) {
              inputMap[inp.name] = widgetValue;
            }
          } else {
            /* 非哨兵的输入连线 —— 把源中间节点 id 记进 `connects_from`
             *  （OUTPUT 端点定位助手要用）。只保留**第一个**非哨兵源，
             *  定位结果才确定。 */
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 需保留 first-truthy 语义（空串也视为未设置）
            if (!connectsFromByNode[nodeId])
              connectsFromByNode[nodeId] = lk?.src ?? "";
          }
        } else if (widgetValue !== undefined) {
          // 把对应的 widget 值折进 inputs[]（API 形态）。
          inputMap[inp.name] = widgetValue;
        }
      }
    }

    /* 作者在 ComfyUI properties 里改过名的节点（`title` 字段）必须留到视图层：
     *  画布标题栏按 `friendlyNodeTitle(classType, title)` 取名，作者名优先于
     *  classType 的静态中文名（ISSUE #394：`PrimitiveInt` + `title: "Seed"`
     *  在子图内部一直显示成 "Primitive Int"）。这里与顶层路
     *  （workflow-detail / workflow-detail-raw）的取值链逐字一致。 */
    const rawTitle = typeof rn.title === "string" ? rn.title.trim() : "";
    graph[nodeId] = {
      class_type: classType,
      inputs: inputMap,
      ...(rawTitle ? { _meta: { title: rawTitle } } : {}),
    };

    /* 每个输出的元数据。 */
    const rawOutputs: RawOutputEntry[] = [];
    if (Array.isArray(rn.outputs)) {
      for (const o of rn.outputs) {
        if (!o || typeof o.name !== "string") continue;
        /* 标记 OUTPUT 端点节点：本输出的任意一条连线指向哨兵 `-20` 目标
         *  （子图暴露的输出）时，本节点就是产出方 —— 它馈入父级封装节点暴露
         *  出去的输出。客户端据此在这簇节点外画一个 OUTPUTS wfGroup。 */
        let isBoundaryOut = false;
        if (Array.isArray(o.links)) {
          for (const lnkId of o.links) {
            const target = linkById[Number(lnkId)]?.targetId;
            if (target === "-20") {
              outputEndpointNodes.add(nodeId);
              isBoundaryOut = true;
              /* 存下边界输出端口，画布据此在**左边缘**渲染一枚紧凑的
               *  wfIoPort 标签。只记第一个指向 -20 的输出。 */
              boundaryOutputByNode[nodeId] ??= {
                name: o.name,
                type: typeof o.type === "string" ? o.type : "*",
              };
              break;
            }
            /* 非哨兵目标 → 把第一个记成 `connects_to`
             *  （INPUT 端点定位助手要用）。 */
            if (
              target &&
              target !== "-10" &&
              target !== "-20" &&
              !connectsToByNode[nodeId]
            ) {
              connectsToByNode[nodeId] = target;
            }
          }
        }
        rawOutputs.push({
          name: o.name,
          localized:
            typeof o.localized_name === "string" ? o.localized_name : undefined,
          type: typeof o.type === "string" ? o.type : "*",
          links: Array.isArray(o.links)
            ? o.links.map((n) => Number(n) || 0)
            : [],
          isBoundary: isBoundaryOut,
        });
      }
    }

    if (rn.type !== "Note" && rn.type !== "MarkdownNote") {
      /* LoadImage 一族：合成一条 `preview: true` 的图像条目，把
       * canvas paints the uploaded thumbnail (or 「需要上传图片」 placeholder
       * （为空时也照样推一条）交给 LoadImage 节点**自身**。
       *  ComfyUI 就在那里显示缩略图，不在下游消费方 ——
       *  我们也不再向下游传播 imageRef：渲染未缩放 / 未编码的反向引用
       *  有误导性。
       *
       * LoadImage 一族**一律**推这条条目，与是否已加载图片无关。
       *  渲染器的 connEntries / widgetEntries 过滤器会检查专属的
       *  `preview: true` 标记，因此这条条目永远不会出现在端口行或
       *  widget 控件清单里 —— 只有 <WorkflowImagePreview> 消费它。 */
      if (LOAD_IMAGE_NODE_TYPES.has(classType)) {
        if (!rawInputs.some((rawInput) => rawInput.preview)) {
          const wv0 = rn.widgets_values?.[0];
          const fname = typeof wv0 === "string" ? wv0.trim() : "";
          rawInputs.push({
            name: "__loadimage_preview__",
            label: "image",
            localized: "图像",
            type: "IMAGE",
            isConnection: false,
            isBoundary: false,
            preview: true,
            ...(fname
              ? {
                  imageRef: {
                    filename: fname,
                    subfolder: "",
                    type: "input" as const,
                  },
                }
              : {}),
          });
        }
      }
      rawInputsById[nodeId] = rawInputs;
      rawOutputsById[nodeId] = rawOutputs;
      rawNodeMeta.push({
        id: nodeId,
        widgets_values: Array.isArray(rn.widgets_values)
          ? rn.widgets_values
          : [],
        outputs: rawOutputs,
        flags:
          typeof rn.flags === "object" && rn.flags !== null ? rn.flags : {},
        mode: typeof rn.mode === "number" ? rn.mode : 0,
      });
    }
  }

  /* 构建 `nodes` 数组（画布把它当 ComfyGraphNode 的扁平清单消费）。
   *  同时给每个节点盖 `is_input_endpoint` / `is_output_endpoint`，
   *  客户端便能在这两簇外面画 INPUTS / OUTPUTS 的 wfGroup 矩形，
   *  不必重走一遍连线表。 */
  const nodes: DetailNodeView[] = Object.entries(graph).map(([nodeId, n]) => {
    // class_type / type 的回落与父级路由一致 —— 新的 ComfyUI 导出把类名放在
    // `class_type`，旧的与 rgthree-comfy 的导出只有 `type`。没有这道回落，
    // 子图封装节点会带着 classType="?" 与 `is_subgraph: false` 回来，
    // 内层画布就会把它们画成完整的 WorkflowNode，而不是紧凑的
    // WorkflowSubgraphNode 芯片。（上面构建 graph 条目时给的是字符串
    // class_type，因此这里一定有值。）
    const classType: string = n.class_type;
    const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
    const isInEp = inputEndpointNodes.has(nodeId);
    const isOutEp = outputEndpointNodes.has(nodeId);
    return {
      id: nodeId,
      class_type: classType,
      title: n._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,
      is_subgraph: isUuidClass,
      raw_inputs: rawInputsById[nodeId] ?? [],
      is_input_endpoint: isInEp,
      is_output_endpoint: isOutEp,
      /* 该内部节点的 ComfyUI 精确外框尺寸（[w, h]）。子图定义没带
       *  逐节点尺寸（少见）时为 undefined。 */
      size: sizeById[nodeId],
      /* 供 wfIoPort 渲染的边界端口细节（v3）。
       *  客户端把 IO 端点节点渲染成内层画布**左侧**（输入）/ **右侧**（输出）
       *  的紧凑纯标签项。没有这些字段，画布就显示不出端口名与默认值
       *  （例如 "noise_seed  41"）。 */
      boundary_input: isInEp ? (boundaryInputByNode[nodeId] ?? null) : null,
      boundary_output: isOutEp ? (boundaryOutputByNode[nodeId] ?? null) : null,
      /* 本端点在内部真正连到的第一个非哨兵中间节点 —— 客户端据此把 wfIoPort
       *  摆在它的目标/源中间节点旁边。纯透传端点（RandomNoise 那种）为
       *  undefined，此时回落到保存的位置。 */
      connects_to: connectsToByNode[nodeId] ?? null,
      connects_from: connectsFromByNode[nodeId] ?? null,
    };
  });

  return {
    graph,
    rawInputsById,
    rawOutputsById,
    rawNodeMeta,
    sizeById,
    nodes,
    inputEndpointNodes,
    outputEndpointNodes,
    boundaryInputByNode,
    boundaryOutputByNode,
    connectsToByNode,
    connectsFromByNode,
    /* 槽位名查找表与边界 IO 在同一趟里算好，拼结果时已经是终值。 */
    inputNameByNodeSlot,
    outputNameByNodeSlot,
    proxyAuthorLabels,
  };
}

export interface BoundaryPin {
  id: string;
  name: string;
  type: string;
  /** ComfyUI 的 i18n 标签（简体中文等）。对代理 pin 来说通常就等于
   *  `type` / `name` —— 为完整性保留。 */
  localized?: string;
  /** 作者在节点编辑器里设的业务标签（如 `FRAMES`、`IMAGE_FINAL`、
   *  `MODEL_HIGH_1st`）。渲染时优先用它，内层 IO 栏杆才能与父卡片上的
   *  输出条显示同一个名字。 */
  label?: string;
  pos: [number, number];
  linkIds: number[];
}

/**
 * 解析子图暴露的 IO pin（`sub.inputs` / `sub.outputs`）。
 *
 * 每个 pin 是一等实体：自带 UUID（`id`）、槽位名（`name`）、类型、
 * 可选的人类标签、保存的位置，以及一个或多个 `linkIds`
 * （穿过边界、与内部节点相连的线）。这里另外建一张反向的
 * `pinIdByLinkId`，用来把哨兵连线表解析成 `boundaryLinks`。
 */
export function parseSubgraphPins(sub: RawSubgraphDef): {
  boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] };
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>;
} {
  const boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] } = {
    inputs: [],
    outputs: [],
  };
  const pinIdByLinkId: Record<
    number,
    { pinId: string; kind: "input" | "output" }
  > = {};
  const rawSubInputs: unknown[] = Array.isArray(sub.inputs) ? sub.inputs : [];
  const rawSubOutputs: unknown[] = Array.isArray(sub.outputs)
    ? sub.outputs
    : [];

  const normalizePin = (p: unknown): BoundaryPin | null => {
    const parsed = SubgraphPinSchema.safeParse(p);
    if (!parsed.success) return null;
    const rec = parsed.data;
    const id = rec.id;
    const posRaw: unknown[] = Array.isArray(rec.pos) ? rec.pos : [0, 0];
    const pos: [number, number] = [
      Number(posRaw[0]) || 0,
      Number(posRaw[1]) || 0,
    ];
    const linkIdsRaw: unknown[] = Array.isArray(rec.linkIds)
      ? rec.linkIds
      : rec.link !== undefined
        ? [rec.link]
        : Array.isArray(rec.links)
          ? rec.links
          : [];
    return {
      id,
      name: typeof rec.name === "string" ? rec.name : "",
      type: typeof rec.type === "string" ? rec.type : "*",
      localized:
        typeof rec.localized_name === "string" ? rec.localized_name : undefined,
      label: typeof rec.label === "string" ? rec.label : undefined,
      pos,
      linkIds: linkIdsRaw.map((n) => Number(n) || 0).filter((n) => n > 0),
    };
  };
  for (const p of rawSubInputs) {
    const np = normalizePin(p);
    if (np) {
      boundaryPins.inputs.push(np);
      for (const lid of np.linkIds) {
        pinIdByLinkId[lid] = { pinId: np.id, kind: "input" };
      }
    }
  }
  for (const p of rawSubOutputs) {
    const np = normalizePin(p);
    if (np) {
      boundaryPins.outputs.push(np);
      for (const lid of np.linkIds) {
        pinIdByLinkId[lid] = { pinId: np.id, kind: "output" };
      }
    }
  }

  return { boundaryPins, pinIdByLinkId };
}

/** 带哨兵的线解析成的「边界 pin ↔ 内部节点槽位」配对
 *  （客户端据此从 pin 的 handle 向内部节点对应的输入/输出 handle
 *  画一条 React Flow 边）。 */
export interface BoundaryLink {
  linkId: number;
  kind: "input" | "output";
  pinId: string;
  innerNodeId: string;
  innerSlotName: string;
}

/**
 * 把前面收集的哨兵连线表解析成给客户端用的 `boundaryLinks`。
 * 每条条目把一根穿边界的线映射到它那一端内部节点的槽位名，
 * React Flow 边才能把 targetHandle / sourceHandle 指对。
 */
export function buildBoundaryLinks(
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>,
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>,
  inputNameByNodeSlot: Record<string, string[]>,
  /** 输出侧槽位表 —— 输出边界连线由别处组装，本函数只处理输入侧，保留参数以
   *  与调用方口径一致（不参与计算）。 */
  _outputNameByNodeSlot: Record<string, string[]>,
): BoundaryLink[] {
  const boundaryLinks: BoundaryLink[] = [];
  for (const [linkIdStr, info] of Object.entries(boundaryLinkInfoById)) {
    const linkId = Number(linkIdStr);
    const pinInfo = pinIdByLinkId[linkId];
    /* 暴露口没有登记这条边（或哨兵边没有对应的暴露口）→ 不产出边界连线。
     * 产出也会在客户端落成一条指向不存在 handle 的边（React Flow 丢弃整条边
     * 并打 error#008），不如在这里就不产出。 */
    if (!pinInfo || info.kind !== "input") continue;
    const innerSlotName =
      inputNameByNodeSlot[info.innerNodeId]?.[info.innerSlot] ?? "";
    /* 解析不出槽位名 → 整条边丢掉：handle id 只在这里产出，空槽位名到了画布上
     * 会退化成字面量 `"in"`，而那个 handle 并不存在（error#008 的成因）。
     * 丢掉的那条在下方 `reportDroppedBoundaryLinks` 里点名上报。 */
    if (!innerSlotName) continue;
    boundaryLinks.push({
      linkId,
      kind: info.kind,
      pinId: pinInfo.pinId,
      innerNodeId: info.innerNodeId,
      innerSlotName,
    });
  }
  return boundaryLinks;
}

/** 上报「想画但画不出来」的边界连线。
 *
 *  `buildBoundaryLinks` 会丢掉解析不出槽位名的哨兵边 —— 丢掉是对的（产出只会
 *  在画布上落一条指向不存在 handle 的边），但**不能悄无声息**：这条边的视觉表现
 *  是「这个暴露口从来没连上」，与「本来就没连」逐字相同，用户/排障者无从区分。
 *
 *  这里按「有哨兵边、却没能产出连线」的差集点名上报，带上足够对号的信息
 *  （暴露口 id、内层节点、槽位下标、该节点解析出的槽位表），一条边只报一次。 */
export function reportDroppedBoundaryLinks(
  sub: RawSubgraphDef,
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>,
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>,
  produced: readonly BoundaryLink[],
): { linkId: number; pinId: string; innerNodeId: string; innerSlot: number }[] {
  const producedIds = new Set(produced.map((link) => link.linkId));
  const dropped: {
    linkId: number;
    pinId: string;
    innerNodeId: string;
    innerSlot: number;
  }[] = [];
  for (const [linkIdStr, info] of Object.entries(boundaryLinkInfoById)) {
    const linkId = Number(linkIdStr);
    if (producedIds.has(linkId)) continue;
    const pinInfo = pinIdByLinkId[linkId];
    /* 没有对应暴露口的哨兵边不是「丢线」——它从来就不该在画布上有一条连线。 */
    if (!pinInfo || info.kind !== "input") continue;
    dropped.push({
      linkId,
      pinId: pinInfo.pinId,
      innerNodeId: info.innerNodeId,
      innerSlot: info.innerSlot,
    });
  }
  if (dropped.length === 0) return dropped;
  const nodeIds = [...new Set(dropped.map((item) => item.innerNodeId))];
  const subgraphName =
    typeof sub.name === "string" && sub.name
      ? sub.name
      : typeof sub.id === "string"
        ? sub.id
        : "?";
  logger.warn(
    `[workflow] 子图 ${subgraphName} ` +
      `有 ${dropped.length} 条边界连线解析不出内层落点，已跳过绘制（不会画成指向不存在 handle 的边）：` +
      ` ${JSON.stringify(dropped)}；涉及节点 ${nodeIds.join(", ")}`,
  );
  return dropped;
}

/**
 * 内层的分组框、便签注释与生效位置。
 *
 * 位置：每个节点的 raw.pos 为底，再叠上 `tplPositions` 里用户拖出来的位置
 * （画布编辑器的子图视图拖拽处理器用 merge:true PATCH，
 * 写进的是同一个共享列）。用户拖过的位置优先；子图里不存在的陈旧键忽略；
 * 原始位置**只**给本子图内的节点打底，免得相邻子图的位置漏进来。
 *
 * `hostId` 是拖拽处理器写库时用的宿主链前缀（`runtimeNodeId`，如 `4` 或
 * `4:5`）。共享的 `positions` 列把子图内部节点存在 `host:inner` 键下，
 * 而本视图的节点 id 是**裸的内部 id** —— 只读裸键会静默丢掉用户在子图里
 * 做过的每一次拖动，表现为「重新打开永远回到原始位置」。
 * 这里两种写法都接受（裸键用于历史 / 导入数据）。
 */
export function runtimeInnerId(key: string, hostId: string): string {
  if (!hostId) return "";
  const prefix = `${hostId}:`;
  if (!key.startsWith(prefix)) return "";
  const inner = key.slice(prefix.length);
  /* 只剥本层宿主链：`4:5:1670` 相对 `4` 属于更深一层，不是本视图的键。 */
  return inner && !inner.includes(":") ? inner : "";
}

export function extractSubgraphAnnotations(
  sub: RawSubgraphDef,
  tplPositions: Record<string, [number, number]>,
  hostId = "",
): {
  groups: {
    id: string;
    title: string;
    bounding: [number, number, number, number];
    color: string;
  }[];
  notes: {
    id: string;
    title: string;
    text: string;
    pos: [number, number];
    size: [number, number];
    color: string;
  }[];
  positions: Record<string, [number, number]>;
} {
  /* 内层的分组框。 */
  const groups: {
    id: string;
    title: string;
    bounding: [number, number, number, number];
    color: string;
  }[] = [];
  if (Array.isArray(sub.groups)) {
    sub.groups.forEach((g: unknown, idx: number) => {
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
      });
    });
  }

  /* 内层的便签注释。 */
  const notes: {
    id: string;
    title: string;
    text: string;
    pos: [number, number];
    size: [number, number];
    color: string;
  }[] = [];
  const innerNodes: RawNode[] = Array.isArray(sub.nodes) ? sub.nodes : [];
  for (const n of innerNodes) {
    if (!n || (n.type !== "Note" && n.type !== "MarkdownNote")) continue;
    const pos = Array.isArray(n.pos) && n.pos.length >= 2 ? n.pos : [0, 0];
    const size =
      Array.isArray(n.size) && n.size.length >= 2 ? n.size : [220, 120];
    const wv = Array.isArray(n.widgets_values) ? n.widgets_values[0] : "";
    const text = typeof wv === "string" ? wv : toStringValue(wv ?? "");
    const title = typeof n.title === "string" ? n.title : "";
    notes.push({
      id: String(n.id),
      title,
      text,
      pos: [Number(pos[0]) || 0, Number(pos[1]) || 0],
      size: [Number(size[0]) || 220, Number(size[1]) || 120],
      color: typeof n.color === "string" ? n.color : "#3a3a3a",
    });
  }

  /* 位置：用户拖出来的覆盖值优先于原始坐标。
   *  `host:inner` 与裸内部 id 两种键写法都会读 —— 见上面 `hostId` 的说明。 */
  const innerNodeIdSet = new Set(
    innerNodes.filter((rn) => rn?.id != null).map((rn) => String(rn.id)),
  );
  const draggedByInnerId: Record<string, [number, number]> = {};
  for (const [key, pos] of Object.entries(tplPositions)) {
    if (!Array.isArray(pos) || pos.length < 2) continue;
    const innerId = innerNodeIdSet.has(key) ? key : runtimeInnerId(key, hostId);
    if (!innerId || !innerNodeIdSet.has(innerId)) continue;
    draggedByInnerId[innerId] = [Number(pos[0]) || 0, Number(pos[1]) || 0];
  }
  const positions: Record<string, [number, number]> = {};
  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const id = String(rn.id);
    /* 用 `!== undefined` 而不是真值判断：坐标为 `[0,0]` 的对象仍然为真，
     *  但一旦写成 `[0, 0]` 的裸数组比较、或改成取单值时，0 会被当成「没有
     *  拖拽」，原始坐标又把用户拖到原点的节点盖回去。 */
    const dragged = draggedByInnerId[id];
    if (dragged !== undefined) {
      positions[id] = dragged;
      continue;
    }
    if (Array.isArray(rn.pos) && rn.pos.length >= 2) {
      positions[id] = [Number(rn.pos[0]) || 0, Number(rn.pos[1]) || 0];
    }
  }

  return { groups, notes, positions };
}
