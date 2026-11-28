/* ── 执行期图增强：为「张量型图片入口」自动补 LoadImage（#4355）──
 *
 * 参考图注入的既有模型是「写 widget 值」：作者把参考图槽连到某个 LoadImage 的
 * `image` 部件，执行期把已上传文件名写进那个部件。但多参考图工作流（如
 * MiniMaxH3ImageConditioning 的 `images.image_1..4`）的参考图入口是**没有
 * widget 的张量连线口** —— 值写不进去，用户只能在画布里逐个手工加 LoadImage
 * 节点（每个工作流一遍，正是 #4355 要消掉的特判式劳动）。
 *
 * 本模块在 `applyRawOverrides` / `applyApiOverrides` **之前**跑一步纯图变换：
 * 凡覆盖项的落点是「无 widget 的 IMAGE/MASK 连线入口」且值是文件名，就自动
 * 补一个 LoadImage 节点、把它连到目标入口，并把覆盖项改写到新节点的 `image`
 * 部件上。于是「参考图槽 → 任意图片族端口（含缩放/裁剪等处理节点入口）」
 * 全链路通用，应用侧不认识任何具体工作流。
 *
 * 纯函数、深拷贝、不碰原图（execPayload 每次执行都从原件起步，天然幂等）。
 * 无 React、无 IO（规范 §17.2 第①层），可直接单测。
 */

import { isRecord } from "~/lib/is-record";
import { cloneJsonGraph } from "./clone-json-graph";

/** 覆盖项三元组（与 `RawWorkflowOverride` 的形状一致，这里收窄成最小依赖）。 */
export type LoaderOverride = {
  name: string;
  nodeId: string;
  value?: unknown;
};

export type AugmentedGraph<R> = {
  /** 自动补建的 LoadImage 节点数（0 = 图未变）。 */
  added: number;
  /** 增强后的图（深拷贝；原对象不被修改）。 */
  graph: R;
  /** 增强后的覆盖项：落点改写到新补的 LoadImage 节点上。 */
  overrides: Array<LoaderOverride>;
};

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** 覆盖项的值是不是「可补 LoadImage 的文件名」。 */
function isFilenameValue(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** 目标端口是否是「无 widget 的连线入口」（张量入口）。
 *  RAW UI 格式里，部件入参带 `widget: { name }` 标记；连线入口没有。 */
function isWireInput(input: Record<string, unknown>): boolean {
  return !("widget" in input);
}

/** 目标类型是纯 MASK（LoadImage 的遮罩出口是 1 号槽；其余一律取 0 号图像出口）。 */
function isMaskType(type: unknown): boolean {
  return typeof type === "string" && type.toUpperCase().includes("MASK");
}

/** 下一张 LoadImage 的标题（执行日志/画布里可辨认）。 */
function loaderNodeTitle(slot: number): string {
  return slot > 0 ? `参考图 ${slot + 1}（自动装载）` : "参考图（自动装载）";
}

/** RAW UI 格式的图增强。见模块头说明。 */
export function augmentReferenceImageLoadersRaw(
  rawJson: unknown,
  overrides?: Array<LoaderOverride>,
): AugmentedGraph<unknown> {
  if (!isRecord(rawJson) || !Array.isArray(overrides) || overrides.length === 0) {
    return { graph: rawJson, overrides: overrides ?? [], added: 0 };
  }
  const parsed = cloneJsonGraph(rawJson);
  const root = isRecord(parsed) ? parsed : {};
  /* 节点与连线都持**原数组引用**（增补要写回图里）；遍历时再逐项收窄。 */
  const nodes: Array<unknown> = Array.isArray(root.nodes) ? root.nodes : [];
  const links: Array<unknown> = Array.isArray(root.links) ? root.links : [];
  if (nodes.length === 0) {
    return { graph: root, overrides, added: 0 };
  }

  /* 新节点 / 新连线的 id：取现有最大数字 id + 1（RAW UI 格式的 id 是数字）。 */
  let nextNodeId = 0;
  let nextLinkId = 0;
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const id = Number(node.id);
    if (Number.isInteger(id) && id > nextNodeId) {
      nextNodeId = id;
    }
  }
  for (const link of links) {
    if (Array.isArray(link)) {
      const id = Number(link[0]);
      if (Number.isInteger(id) && id > nextLinkId) {
        nextLinkId = id;
      }
    }
  }
  const nodeById = (id: string): Record<string, unknown> | undefined => {
    const found = nodes.find((node) => isRecord(node) && String(node.id) === id);
    return isRecord(found) ? found : undefined;
  };

  const nextOverrides: Array<LoaderOverride> = [];
  let added = 0;
  /* 同一 (节点, 入口) 只补一个 LoadImage：重复覆盖项取第一份，其余丢弃。 */
  const claimed = new Set<string>();

  for (const ov of overrides) {
    if (
      !ov ||
      typeof ov.nodeId !== "string" ||
      ov.name === undefined ||
      !isFilenameValue(ov.value)
    ) {
      nextOverrides.push(ov);
      continue;
    }
    const target = nodeById(ov.nodeId);
    if (!target) {
      nextOverrides.push(ov);
      continue;
    }
    const inputs = asArray(target.inputs);
    const index = inputs.findIndex((input) => input.name === ov.name);
    const input = index === -1 ? undefined : inputs[index];
    if (
      !input ||
      !isWireInput(input) ||
      /* 子图内部槽位（host:inner 形态等）不在本步量程内：维持原状（与现状一致，
       * 值落不进去时由执行层如实报 unmatched）。 */
      ov.nodeId.includes(":") ||
      claimed.has(`${ov.nodeId}::${ov.name}`)
    ) {
      nextOverrides.push(ov);
      continue;
    }

    nextNodeId += 1;
    nextLinkId += 1;
    const maskTarget = isMaskType(input.type);
    const loader = {
      id: nextNodeId,
      type: "LoadImage",
      pos: [0, 0],
      size: [420, 390],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [
        {
          localized_name: "图像",
          name: "image",
          type: "COMBO",
          widget: { name: "image" },
          link: null,
        },
        {
          localized_name: "选择文件上传",
          name: "upload",
          type: "IMAGEUPLOAD",
          widget: { name: "upload" },
          link: null,
        },
      ],
      outputs: [
        { localized_name: "图像", name: "IMAGE", type: "IMAGE", links: [nextLinkId] },
        { localized_name: "遮罩", name: "MASK", type: "MASK", links: null },
      ],
      properties: { "Node name for S&R": loaderNodeTitle(added) },
      widgets_values: [ov.value, "image"],
    };
    nodes.push(loader);
    /* 连线形状与 ComfyUI 画布序列化一致：[id, 源节点, 源槽, 目标节点, 目标槽, 类型]。 */
    links.push([
      nextLinkId,
      nextNodeId,
      maskTarget ? 1 : 0,
      Number(ov.nodeId),
      index,
      maskTarget ? "MASK" : "IMAGE",
    ]);
    input.link = nextLinkId;
    claimed.add(`${ov.nodeId}::${ov.name}`);
    added += 1;
    nextOverrides.push({ nodeId: String(nextNodeId), name: "image", value: ov.value });
  }

  return { graph: root, overrides: nextOverrides, added };
}

/** API 格式的图增强。语义与 RAW 侧一致，落点形状不同：
 *  API 图的连线是「入参值 = [源节点id, 输出槽]」，新增节点即新增一个键。 */
export function augmentReferenceImageLoadersApi(
  graph: unknown,
  overrides?: Array<LoaderOverride>,
): AugmentedGraph<unknown> {
  if (!isRecord(graph) || !Array.isArray(overrides) || overrides.length === 0) {
    return { graph, overrides: overrides ?? [], added: 0 };
  }
  const parsed = cloneJsonGraph(graph);
  const root = isRecord(parsed) ? parsed : {};

  let nextNodeId = 0;
  for (const key of Object.keys(root)) {
    const id = Number(key);
    if (Number.isInteger(id) && id > nextNodeId) {
      nextNodeId = id;
    }
  }

  const nextOverrides: Array<LoaderOverride> = [];
  let added = 0;
  const claimed = new Set<string>();

  for (const ov of overrides) {
    if (
      !ov ||
      typeof ov.nodeId !== "string" ||
      ov.name === undefined ||
      !isFilenameValue(ov.value)
    ) {
      nextOverrides.push(ov);
      continue;
    }
    const targetValue = root[ov.nodeId];
    const target = isRecord(targetValue) ? targetValue : undefined;
    const inputsValue = target?.inputs;
    const inputs = isRecord(inputsValue) ? inputsValue : undefined;
    if (!inputs || !(ov.name in inputs)) {
      nextOverrides.push(ov);
      continue;
    }
    /* API 图没有 widget 标记：连线型入参的当前值是 null（未连）或 [源节点, 槽]；
     * 标量 = 部件值，走既有写入路径。 */
    const current = inputs[ov.name];
    const isWire = current === null || Array.isArray(current);
    if (!isWire || ov.nodeId.includes(":") || claimed.has(`${ov.nodeId}::${ov.name}`)) {
      nextOverrides.push(ov);
      continue;
    }

    nextNodeId += 1;
    const newNodeId = String(nextNodeId);
    root[newNodeId] = {
      class_type: "LoadImage",
      inputs: { image: ov.value, upload: "image" },
      _meta: { title: loaderNodeTitle(added) },
    };
    inputs[ov.name] = [newNodeId, 0];
    claimed.add(`${ov.nodeId}::${ov.name}`);
    added += 1;
    nextOverrides.push({ nodeId: newNodeId, name: "image", value: ov.value });
  }

  return { graph: root, overrides: nextOverrides, added };
}
