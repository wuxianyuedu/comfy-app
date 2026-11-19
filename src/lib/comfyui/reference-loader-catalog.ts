// ── 参考图装载链：节点类定义目录（纯模块，无 IO / 无 React）────────────────
//
// 把 ComfyUI `/api/object_info` 的原始载荷规整成「建链与编辑器都够用」的最小形状：
// 每个节点类的连线入口 / 部件入口 / 输出口 / 部件顺序 / 缺省值。两处消费：
//   · 预设编辑器的节点面板（加节点、填控件值）；
//   · 执行期装载链生成（`reference-loader-chain.ts`）—— 按它摆 `inputs` /
//     `outputs` / `widgets_values`，不猜任何类的内部结构。
//
// object_info 的 spec 形状有两代：`[类型, 选项]` 数组与 `{ type }` 对象；
// COMBO 的候选直接以数组放在首项。这里照 `raw.ts` 的读法归一，不引它的私有件。

import { isRecord } from "~/lib/is-record";

/** 一个入口/出口的最小定义。 */
export type ReferenceChainPortDef = {
  name: string;
  type: string;
  /** true = 张量连线口（执行期要连 link）；false = 部件（widget）口。 */
  wire: boolean;
};

export type ReferenceChainClassDef = {
  /** COMBO 部件的候选值（键 = 部件名；编辑器出下拉用）。 */
  choices: Record<string, Array<string>>;
  className: string;
  /** 各部件的缺省值（键 = 部件名）。 */
  defaults: Record<string, unknown>;
  inputs: Array<ReferenceChainPortDef>;
  outputs: Array<ReferenceChainPortDef>;
  /** 部件口的取值顺序（object_info 的 input_order；widgets_values 按它摆位）。 */
  widgetOrder: Array<string>;
};

export type ReferenceChainCatalog = Record<string, ReferenceChainClassDef>;

/** 张量类型集合：这些类型的入口是连线口，其余（COMBO/STRING/INT/…/IMAGEUPLOAD）
 *  都是部件。载链场景真正会遇到的是 IMAGE / MASK，集合放宽到常见张量族，
 *  免得自定义处理节点的一个 LATENT 入口被误判成部件。 */
const WIRE_TYPES = new Set([
  "IMAGE",
  "MASK",
  "LATENT",
  "CONDITIONING",
  "VAE",
  "MODEL",
  "CLIP",
  "CLIP_VISION",
  "CLIP_VISION_OUTPUT",
  "CONTROL_NET",
  "UPSCALE_MODEL",
  "AUDIO",
  "VIDEO",
  "HOOKS",
]);

function normalizeSpec(spec: unknown): { options: Record<string, unknown>; type: string } {
  if (Array.isArray(spec)) {
    const head: unknown = spec[0];
    const tail: unknown = spec[1];
    const options = isRecord(tail) ? tail : {};
    if (Array.isArray(head)) {
      return { options: { ...options, __candidates: head }, type: "COMBO" };
    }
    return { options, type: typeof head === "string" ? head : "UNKNOWN" };
  }
  if (isRecord(spec)) {
    const type = spec.type;
    if (Array.isArray(type)) {
      return { options: { ...spec, __candidates: type }, type: "COMBO" };
    }
    return { options: spec, type: typeof type === "string" ? type : "UNKNOWN" };
  }
  return { options: {}, type: "UNKNOWN" };
}

function candidatesOf(options: Record<string, unknown>): Array<unknown> {
  const candidates = options.__candidates;
  return Array.isArray(candidates) ? candidates : [];
}

function isWireType(type: string): boolean {
  return WIRE_TYPES.has(type.toUpperCase());
}

/** 把 object_info 载荷规整成目录。载荷不是对象 → null（调用方按「不可用」处理）。 */
export function buildReferenceChainCatalog(objectInfo: unknown): ReferenceChainCatalog | null {
  if (!isRecord(objectInfo)) {
    return null;
  }
  const catalog: ReferenceChainCatalog = {};
  for (const [className, rawDef] of Object.entries(objectInfo)) {
    if (!isRecord(rawDef)) {
      continue;
    }
    const input = isRecord(rawDef.input) ? rawDef.input : {};
    const required = isRecord(input.required) ? input.required : {};
    const optional = isRecord(input.optional) ? input.optional : {};
    const order = isRecord(rawDef.input_order) ? rawDef.input_order : {};
    const orderRequired: unknown[] = Array.isArray(order.required) ? order.required : [];
    const orderOptional: unknown[] = Array.isArray(order.optional) ? order.optional : [];

    const inputs: Array<ReferenceChainPortDef> = [];
    const widgetOrder: Array<string> = [];
    const defaults: Record<string, unknown> = {};
    const choices: Record<string, Array<string>> = {};
    const seen = new Set<string>();
    const collect = (table: Record<string, unknown>, orderList: Array<unknown>) => {
      const names = [
        ...orderList.filter((n): n is string => typeof n === "string" && n in table),
        ...Object.keys(table).filter((n) => !seen.has(n) && !orderList.includes(n)),
      ];
      for (const name of names) {
        if (seen.has(name)) {
          continue;
        }
        seen.add(name);
        const { type, options } = normalizeSpec(table[name]);
        const wire = isWireType(type);
        inputs.push({ name, type, wire });
        if (!wire) {
          widgetOrder.push(name);
          const candidates = candidatesOf(options);
          choices[name] = candidates.map((choice) => String(choice));
          defaults[name] = candidates.length > 0 ? candidates[0] : (options.default ?? null);
        }
      }
    };
    collect(required, orderRequired);
    collect(optional, [...orderRequired, ...orderOptional]);

    const outputTypes: unknown[] = Array.isArray(rawDef.output) ? rawDef.output : [];
    const outputNames: unknown[] = Array.isArray(rawDef.output_name) ? rawDef.output_name : [];
    const outputs: Array<ReferenceChainPortDef> = outputTypes.map((type, index) => {
      const typeName = typeof type === "string" ? type : "UNKNOWN";
      const rawName = outputNames[index];
      const name = typeof rawName === "string" && rawName !== "" ? rawName : typeName;
      return { name, type: typeName, wire: false };
    });

    catalog[className] = { className, inputs, outputs, widgetOrder, defaults, choices };
  }
  return catalog;
}
