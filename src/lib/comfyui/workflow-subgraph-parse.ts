/**
 * 子图（内层工作流）解析助手。
 *
 * 这些纯函数把 `definitions.subgraphs[uid]` 定义转成子图详情构建器要出的
 * API 图、节点元数据、边界 pin 与注释。全部**不含 IO**
 * （位置覆盖层由调用方传入），因此调用方可以直接把序列化结果缓存起来。
 *
 * 拆包：哨兵边采集、槽位解析与 API 图构建（`buildSubgraphGraph` 及其私有依赖）
 * 体量最大，已挪到 `./workflow-subgraph-parse-graph.ts`；本文件保留边界 pin
 * 解析（`parseSubgraphPins` / `buildBoundaryLinks` / `reportDroppedBoundaryLinks`）
 * 与注释采集（`extractSubgraphAnnotations` / `runtimeInnerId`），并从图模块
 * re-export 前者符号。消费者 import 路径不变（§12.18 复用优先——拆包只挪
 * 文件、不动契约）。
 */
import {
  asRecord,
  SubgraphPinSchema,
  toStringValue,
  type RawNode,
  type RawSubgraphDef,
} from "~/lib/comfyui/raw";
import { logger } from "~/lib/core/logger";
import type { BoundaryLinkInfo } from "./workflow-subgraph-parse-graph";

export {
  boundarySlotsByNode,
  buildSubgraphGraph,
  parseSubgraphLinks,
  parseSubgraphSlots,
} from "./workflow-subgraph-parse-graph";
export type {
  BoundaryLinkInfo,
  SubgraphGraphResult,
  SubgraphLinkEntry,
} from "./workflow-subgraph-parse-graph";

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
