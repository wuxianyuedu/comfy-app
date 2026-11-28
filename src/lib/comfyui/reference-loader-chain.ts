// ── 执行期参考图装载链生成（#4376）───────────────────────────────────────
//
// #4355 的 `reference-loader-augment` 给每个张量图片入口补一个**裸 LoadImage**；
// 多参考图工作流还需要两种更复杂的形态，本模块在它**之前**跑一步：
//
//   · **链式**：LoadImage 之后串若干处理节点（如 ResizeImageMaskNode ×2）再落到
//     image_N —— 由「装载预设」描述（`~/lib/workshop/reference-loader-preset`）；
//   · **扇出**：同一张参考图要喂多个端口 —— 计划里每个端点各实例化一条链
//     （LoadImage 只是读文件，多条链读同一个文件即同一张图）。
//
// 装载计划（`ReferenceLoaderPlan`）的键是 `${nodeId}::${入口名}`，值是预设本体
// （提交时随任务行自带；端点对不上已删预设 → 该端点回落裸 LoadImage，行为不
// 劣化）。节点类定义来自执行期现拉的 object_info 目录
// （`reference-loader-catalog.ts`）；目录不可用（ComfyUI 未就绪）→ 整份计划
// 本轮不生效，全部回落裸 LoadImage，由调用方打一行日志。
//
// 串接口径：MASK 目标的首跳取 LoadImage 的 MASK 口、其余取 0 号图像口（链全程
// 携带目标类型）；链内前一级的第一个输出口 → 后一级的第一个连线入口；链尾按
// 目标入口的类型挑出口（MASK 入口挑 MASK 或 MATCHTYPE 出口——MATCHTYPE 跟随
// 链入类型，#4404；没有则整链回落裸增强）。
//
// 纯函数、深拷贝、不碰原图（execPayload 每次执行都从原件起步，天然幂等）。
// 无 React、无 IO（规范 §17.2 第①层），可直接单测。

import { isRecord } from "~/lib/is-record";
import { cloneJsonGraph } from "./clone-json-graph";
import type { ReferenceLoaderPreset } from "~/lib/workshop/reference-loader-preset";
import {
  chainWidgetsValues,
  selectedComboOption,
  type ReferenceChainCatalog,
} from "./reference-loader-catalog";
import type { AugmentedGraph, LoaderOverride } from "./reference-loader-augment";

/** 装载计划：`${nodeId}::${入口名}` → 该端点用的装载预设。 */
export type ReferenceLoaderPlan = Record<string, ReferenceLoaderPreset>;

/** 计划键的唯一定位点（客户端构造与服务端消费共用，别各拼一份字符串）。 */
export function referenceLoaderEndpointKey(nodeId: string, inputName: string): string {
  return `${nodeId}::${inputName}`;
}

/** 目标类型是纯 MASK（链的出口要挑 MASK 槽；其余一律取第一个输出口）。 */
function isMaskType(type: unknown): boolean {
  return typeof type === "string" && type.toUpperCase().includes("MASK");
}

/** 出口能否当 MASK 用：纯 MASK，或 V3 MATCHTYPE（#4404：MATCHTYPE 跟随链入图
 *  类型 —— 装载链给 MASK 目标喂的是 LoadImage 的 MASK 口，链入即 MASK，
 *  出口也就出 MASK；不用再按输出表逐类猜）。 */
function carriesMask(type: unknown): boolean {
  if (typeof type !== "string") {
    return false;
  }
  const upper = type.toUpperCase();
  return upper.includes("MASK") || upper.includes("MATCHTYPE");
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isFilenameValue(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** 链上节点标题（执行日志 / 画布里可辨认是哪条预设生成的）。 */
function chainNodeTitle(index: number, presetName: string): string {
  const prefix = index > 0 ? `参考图 ${index + 1}` : "参考图";
  return `${prefix}（预设：${presetName}）`;
}

/** 预设能否在本目录下完整实例化：每个中间类都有定义、有连线入口且有输出口。 */
function chainResolvable(preset: ReferenceLoaderPreset, catalog: ReferenceChainCatalog): boolean {
  return preset.steps.every((step) => {
    const def = catalog[step.class];
    return def !== undefined && def.inputs.some((input) => input.wire) && def.outputs.length > 0;
  });
}

/** 计划命中的覆盖项条数（日志与测试读数用）。 */
export function plannedEndpointCount(
  overrides: ReadonlyArray<LoaderOverride> | undefined,
  plan: ReferenceLoaderPlan | undefined,
): number {
  if (overrides === undefined || overrides.length === 0 || !plan) {
    return 0;
  }
  return overrides.filter((ov) => {
    if (!ov || typeof ov.nodeId !== "string" || !isFilenameValue(ov.value)) {
      return false;
    }
    return plan[referenceLoaderEndpointKey(ov.nodeId, ov.name)] !== undefined;
  }).length;
}

/** 覆盖项能否按计划建链：预设在场、目标入口是张量连线口、且出口类型接得上。 */
function chainApplies(args: {
  catalog: ReferenceChainCatalog;
  input: Record<string, unknown> | undefined;
  nodeId: string;
  preset: ReferenceLoaderPreset | undefined;
}): boolean {
  const { catalog, input, nodeId, preset } = args;
  if (!preset || !input || "widget" in input || nodeId.includes(":")) {
    return false;
  }
  if (!chainResolvable(preset, catalog)) {
    return false;
  }
  const maskTarget = isMaskType(input.type);
  if (!maskTarget) {
    return true;
  }
  /* MASK 目标要求链尾真能出 MASK（裸 LoadImage 恒有；链尾是处理节点时看它的
   * 输出表，MATCHTYPE 跟随链入也算）；没有就回落裸增强，别连出一条类型不符的线。 */
  const lastStep = preset.steps.at(-1);
  const lastDef = lastStep === undefined ? undefined : catalog[lastStep.class];
  return (lastDef?.outputs ?? []).some((port) => carriesMask(port.type));
}

/* 建链节点的强类型（RAW UI 格式）。def 目录给出的端口形状在这里落成 ComfyUI
 * 画布序列化形状：连线口只有 link，部件口带 `widget` 标记。 */
type ChainNodeInput = {
  link: unknown;
  localized_name: string;
  name: string;
  type: string;
  widget?: { name: string };
};
type ChainNodeOutput = {
  links: unknown;
  localized_name: string;
  name: string;
  type: string;
};
type ChainNode = {
  flags: Record<string, never>;
  id: number;
  inputs: Array<ChainNodeInput>;
  mode: number;
  order: number;
  outputs: Array<ChainNodeOutput>;
  pos: [number, number];
  properties: Record<string, string>;
  size: [number, number];
  type: string;
  widgets_values: Array<unknown>;
};

/** RAW UI 格式的装载链生成。见模块头说明。 */
export function applyReferenceLoaderChainsRaw(
  rawJson: unknown,
  overrides: Array<LoaderOverride> | undefined,
  plan: ReferenceLoaderPlan | undefined,
  catalog: ReferenceChainCatalog | null,
): AugmentedGraph<unknown> {
  if (
    !isRecord(rawJson) ||
    overrides === undefined ||
    overrides.length === 0 ||
    !plan ||
    Object.keys(plan).length === 0 ||
    catalog === null
  ) {
    return { graph: rawJson, overrides: overrides ?? [], added: 0 };
  }
  const parsed = cloneJsonGraph(rawJson);
  const root = isRecord(parsed) ? parsed : {};
  const nodes: Array<unknown> = Array.isArray(root.nodes) ? root.nodes : [];
  const links: Array<unknown> = Array.isArray(root.links) ? root.links : [];
  if (nodes.length === 0) {
    return { graph: root, overrides, added: 0 };
  }

  /* 新节点 / 新连线的 id：取现有最大数字 id + 1（RAW UI 格式的 id 是数字）。 */
  let nextNodeId = 0;
  let nextLinkId = 0;
  for (const node of nodes) {
    if (isRecord(node)) {
      const id = Number(node.id);
      if (Number.isInteger(id) && id > nextNodeId) {
        nextNodeId = id;
      }
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

  for (const ov of overrides) {
    const preset =
      ov && typeof ov.nodeId === "string" && isFilenameValue(ov.value)
        ? plan[referenceLoaderEndpointKey(ov.nodeId, ov.name)]
        : undefined;
    const target = preset ? nodeById(ov.nodeId) : undefined;
    const inputs = asArray(target?.inputs);
    const inputIndex = inputs.findIndex((input) => input.name === ov.name);
    const input = inputIndex === -1 ? undefined : inputs[inputIndex];
    if (!preset || !input || !chainApplies({ catalog, input, nodeId: ov.nodeId, preset })) {
      nextOverrides.push(ov);
      continue;
    }
    const maskTarget = isMaskType(input.type);

    /* ① 建链节点对象（先不占 id）：装载源 + 预设的各级处理。类定义缺失 /
     *    无连线入口的处理类 → 整体回落裸增强，不留半条链。 */
    const loaderNode: ChainNode = {
      id: 0,
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
        { localized_name: "图像", name: "IMAGE", type: "IMAGE", links: null },
        { localized_name: "遮罩", name: "MASK", type: "MASK", links: null },
      ],
      properties: { "Node name for S&R": chainNodeTitle(added, preset.name) },
      widgets_values: [ov.value, "image"],
    };
    const chain: Array<ChainNode> = [loaderNode];
    let chainOk = true;
    for (const step of preset.steps) {
      const def = catalog[step.class];
      if (def === undefined) {
        chainOk = false;
        break;
      }
      const nodeInputs: Array<ChainNodeInput> = def.inputs.map((port) => ({
        localized_name: port.name,
        name: port.name,
        type: port.type,
        ...(port.wire ? {} : { widget: { name: port.name } }),
        link: null,
      }));
      if (!nodeInputs.some((port) => !("widget" in port))) {
        chainOk = false;
        break;
      }
      /* 控件值按 comfy-cli 转换器的配对口径摆位（连线口不占位、动态 COMBO 展开
       * 选中项子输入）；摆不出合法值（选中项要连线）→ 整链回落裸增强。 */
      const widgetsValues = chainWidgetsValues(def, step.widgets);
      if (widgetsValues === null) {
        chainOk = false;
        break;
      }
      chain.push({
        id: 0,
        type: step.class,
        pos: [0, 0],
        size: [360, 160],
        flags: {},
        order: 0,
        mode: 0,
        inputs: nodeInputs,
        outputs: def.outputs.map((port) => ({
          localized_name: port.name,
          name: port.name,
          type: port.type,
          links: null,
        })),
        properties: { "Node name for S&R": `${preset.name} · ${step.class}` },
        widgets_values: widgetsValues,
      });
    }
    if (!chainOk) {
      nextOverrides.push(ov);
      continue;
    }

    /* ② 占 id 入图。 */
    for (const node of chain) {
      nextNodeId += 1;
      node.id = nextNodeId;
      nodes.push(node);
    }

    /* ③ 串接：前一级第一个输出口 → 后一级第一个连线入口。MASK 目标的首跳取
     *    LoadImage 的 MASK 口（#4404：链全程携带 MASK，MATCHTYPE 处理节点才会
     *    按 MASK 处理并出 MASK；IMAGE 目标维持 0 号图像口）。 */
    for (let i = 1; i < chain.length; i += 1) {
      const prev = chain[i - 1];
      const node = chain[i];
      /* 越界守卫不可达（i 从 1 到 length-1）；防御性收口。 */
      if (prev === undefined || node === undefined) {
        break;
      }
      const wireIndex = node.inputs.findIndex((port) => !("widget" in port));
      const wireInput = wireIndex === -1 ? undefined : node.inputs[wireIndex];
      /* 不可达（建链时已验每个处理类都有连线入口）；防御性收口避免把 undefined
       * 当节点用。 */
      if (wireInput === undefined) {
        break;
      }
      const srcSlot = maskTarget && prev === loaderNode && prev.outputs[1] ? 1 : 0;
      nextLinkId += 1;
      links.push([nextLinkId, prev.id, srcSlot, node.id, wireIndex, wireInput.type]);
      wireInput.link = nextLinkId;
      const prevOutput = prev.outputs[srcSlot];
      if (prevOutput) {
        prevOutput.links = [nextLinkId];
      }
    }

    /* ④ 链尾 → 目标入口（出口槽按目标类型挑；MATCHTYPE 跟随链入也算 MASK 口）。 */
    const last = chain.at(-1);
    if (last === undefined) {
      nextOverrides.push(ov);
      continue;
    }
    const outletSlot = maskTarget ? last.outputs.findIndex((port) => carriesMask(port.type)) : 0;
    if (outletSlot === -1) {
      /* chainApplies 已验链尾有 MASK 口；这一格是防御性收口（目录与建链之间
       * 不会换目录，真到 -1 说明状态被并发改过），回落裸增强不连错线。 */
      nextOverrides.push(ov);
      continue;
    }
    nextLinkId += 1;
    links.push([
      nextLinkId,
      last.id,
      outletSlot,
      Number(ov.nodeId),
      inputIndex,
      maskTarget ? "MASK" : "IMAGE",
    ]);
    input.link = nextLinkId;

    added += 1;
    /* 文件名覆盖项改写到新 LoadImage 的 image 部件（与裸增强同一落点口径）。 */
    nextOverrides.push({ nodeId: String(loaderNode.id), name: "image", value: ov.value });
  }

  return { graph: root, overrides: nextOverrides, added };
}

/** API 格式的装载链生成。语义与 RAW 侧一致，落点形状不同：
 *  API 图的连线是「入参值 = [源节点id, 输出槽]」，新增节点即新增一个键。 */
export function applyReferenceLoaderChainsApi(
  graph: unknown,
  overrides: Array<LoaderOverride> | undefined,
  plan: ReferenceLoaderPlan | undefined,
  catalog: ReferenceChainCatalog | null,
): AugmentedGraph<unknown> {
  if (
    !isRecord(graph) ||
    overrides === undefined ||
    overrides.length === 0 ||
    !plan ||
    Object.keys(plan).length === 0 ||
    catalog === null
  ) {
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

  for (const ov of overrides) {
    const preset =
      ov && typeof ov.nodeId === "string" && isFilenameValue(ov.value)
        ? plan[referenceLoaderEndpointKey(ov.nodeId, ov.name)]
        : undefined;
    if (!preset || !chainResolvable(preset, catalog)) {
      nextOverrides.push(ov);
      continue;
    }
    const targetValue = root[ov.nodeId];
    const target = isRecord(targetValue) ? targetValue : undefined;
    const inputs = isRecord(target?.inputs) ? target.inputs : undefined;
    if (!inputs || !(ov.name in inputs)) {
      nextOverrides.push(ov);
      continue;
    }
    /* API 图没有 widget 标记：连线型入参的当前值是 null（未连）或 [源节点, 槽]；
     * 标量 = 部件值，不走本步。 */
    const current = inputs[ov.name];
    const isWire = current === null || Array.isArray(current);
    if (!isWire) {
      nextOverrides.push(ov);
      continue;
    }

    nextNodeId += 1;
    const loaderId = String(nextNodeId);
    root[loaderId] = {
      class_type: "LoadImage",
      inputs: { image: ov.value, upload: "image" },
      _meta: { title: chainNodeTitle(added, preset.name) },
    };
    /* 与 RAW 侧同一原子性：先按链序把各级节点摆好（含控件值合法性判据），再
     * 一次性入图 —— 中途摆不出合法值（选中项要连线 / 类缺失）时整端点回落，
     * 不留半条链。 */
    const built: Array<{
      classType: string;
      id: string;
      inputs: Record<string, unknown>;
    }> = [];
    let chainBroken = false;
    let cursorId = loaderId;
    for (const step of preset.steps) {
      const def = catalog[step.class];
      if (def === undefined || chainWidgetsValues(def, step.widgets) === null) {
        chainBroken = true;
        break;
      }
      nextNodeId += 1;
      const nodeId = String(nextNodeId);
      const stepInputs: Record<string, unknown> = {};
      let wired = false;
      for (const port of def.inputs) {
        if (port.wire) {
          /* 串接口：第一个连线入口接上一级；其余连线口留空（载链场景的处理节点
           * 只有第一个入口需要接）。 */
          if (wired) {
            stepInputs[port.name] = null;
          } else {
            stepInputs[port.name] = [cursorId, 0];
            wired = true;
          }
          continue;
        }
        stepInputs[port.name] = step.widgets?.[port.name] ?? def.defaults[port.name] ?? null;
        const option = selectedComboOption(def, port.name, stepInputs[port.name]);
        if (!option) {
          continue;
        }
        /* 动态 COMBO：子输入以「父名.子名」点号键随任务提交（后端
         * `finalize_prefix` 的官方线格式）；合法性闸在 chainWidgetsValues，
         * 这里只摆部件子输入。 */
        for (const sub of option.subs) {
          if (sub.wire) {
            continue;
          }
          stepInputs[`${port.name}.${sub.name}`] =
            step.widgets?.[`${port.name}.${sub.name}`] ?? sub.default ?? null;
        }
      }
      built.push({ classType: step.class, id: nodeId, inputs: stepInputs });
      cursorId = nodeId;
    }
    if (chainBroken) {
      nextOverrides.push(ov);
      continue;
    }
    for (const node of built) {
      root[node.id] = {
        class_type: node.classType,
        inputs: node.inputs,
        _meta: { title: `${preset.name} · ${node.classType}` },
      };
    }
    /* API 图的连线值不带类型，出口槽一律取第一个（与裸增强的 API 侧同口径）。 */
    inputs[ov.name] = [cursorId, 0];

    added += 1;
    nextOverrides.push({ nodeId: loaderId, name: "image", value: ov.value });
  }

  return { graph: root, overrides: nextOverrides, added };
}
