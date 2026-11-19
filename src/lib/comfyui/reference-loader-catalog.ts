// ── 参考图装载链：节点类定义目录（纯模块，无 IO / 无 React）────────────────
//
// 把 ComfyUI `/api/object_info` 的原始载荷规整成「建链与编辑器都够用」的最小形状：
// 每个节点类的连线入口 / 部件入口 / 输出口 / 部件顺序 / 缺省值 / COMBO 候选。
// 两处消费：
//   · 预设编辑器的节点面板（加节点、填控件值）；
//   · 执行期装载链生成（`reference-loader-chain.ts`）—— 按它摆 `inputs` /
//     `outputs` / `widgets_values`，不猜任何类的内部结构。
//
// object_info 的 spec 形状有三代（#4404 起三代都认）：
//   ① 旧数组：`[["a","b"], {…}]` —— 候选在首项；`{type: ["a","b"], …}` 对象版同义。
//   ② V3 对象：`["COMBO", {default, options: ["a","b"]}]` —— 候选挪到 `options` 键。
//   ③ V3 动态类型：`COMFY_DYNAMICCOMBO_V3`（候选 = `options[].key`，每个选项还带
//      自己的子输入集）、`COMFY_MATCHTYPE_V3`（IMAGE/MASK 皆可的连线口）。
// 部件 vs 连线的判据与 comfy-cli 的 UI→API 转换器（`workflow_to_api.py`
// `_is_widget_input`）对齐 —— RAW 链子图最终由它转成 API 提交，三处（编辑器 /
// 建链 / 转换器）判据一致才不会错位。

import { isRecord } from "~/lib/is-record";

/** 一个入口/出口的最小定义。 */
export type ReferenceChainPortDef = {
  /** 动态 COMBO（`COMFY_*COMBO*`）专有：选项清单，键序即选择器候选序。 */
  comboOptions?: Array<ReferenceChainComboOption>;
  name: string;
  type: string;
  /** true = 张量连线口（执行期要连 link）；false = 部件（widget）口。 */
  wire: boolean;
};

/** 动态 COMBO 的一个选项：`key` 是选择器的候选值，`subs` 是选中它才出现的子输入。 */
export type ReferenceChainComboOption = {
  key: string;
  subs: Array<ReferenceChainSubInput>;
};

/** 动态 COMBO 选项下的一个子输入（形状 = 部件口 + 自己的候选与缺省）。 */
export type ReferenceChainSubInput = {
  choices: Array<string>;
  default: unknown;
  /** 子输入名（不含父名；预设 `widgets` 里以「父名.子名」点号全名存值）。 */
  name: string;
  type: string;
  wire: boolean;
};

export type ReferenceChainClassDef = {
  /** 部件的候选值（键 = 部件名；编辑器出下拉用；动态 COMBO 的候选 = 选项 key）。
   *  连线口不在表里。 */
  choices: Record<string, Array<string>>;
  className: string;
  /** 各部件的缺省值（键 = 部件名；优先 object_info 声明的 default，回落首候选）。 */
  defaults: Record<string, unknown>;
  inputs: Array<ReferenceChainPortDef>;
  outputs: Array<ReferenceChainPortDef>;
  /** 部件口的取值顺序（object_info 的 input_order；顶层 widgets 顺序，动态 COMBO
   *  的子输入不在此表 —— 摆值用 `chainWidgetsValues`，它按选中项展开）。 */
  widgetOrder: Array<string>;
};

export type ReferenceChainCatalog = Record<string, ReferenceChainClassDef>;

/** 标量部件类型集合（comfy-cli `_is_widget_input` 的同名单）。 */
const WIDGET_SCALAR_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);

/** 前端 DOM 部件类型集合（comfy-cli `_FRONTEND_DOM_WIDGET_TYPES` 的同名单）。 */
const DOM_WIDGET_TYPES = new Set([
  "LOAD_3D",
  "LOAD_3D_ADVANCED",
  "PREVIEW_3D",
  "AUDIO_UI",
  "IMAGEUPLOAD",
  "AUDIOUPLOAD",
]);

type NormalizedSpec = {
  /** COMBO 候选（原样，未转字符串）：旧形状 = 首项数组；V3 形状 = options 键；
   *  动态 COMBO = options[].key 之外还是整份选项对象，由调用方区分。 */
  candidates: Array<unknown>;
  options: Record<string, unknown>;
  type: string;
};

function normalizeSpec(spec: unknown): NormalizedSpec {
  if (Array.isArray(spec)) {
    const head: unknown = spec[0];
    const tail: unknown = spec[1];
    const options = isRecord(tail) ? tail : {};
    if (Array.isArray(head)) {
      return { options, type: "COMBO", candidates: head };
    }
    /* V3 数组形状：候选挪进 tail 的 options 键（纯候选数组或动态 COMBO 的选项
     * 对象数组 —— 调用方按 type 分流）。 */
    return {
      options,
      type: typeof head === "string" ? head : "UNKNOWN",
      candidates: Array.isArray(options.options) ? options.options : [],
    };
  }
  if (isRecord(spec)) {
    const type = spec.type;
    if (Array.isArray(type)) {
      return { options: spec, type: "COMBO", candidates: type };
    }
    if (typeof type === "string") {
      /* V3 对象形状：候选在 `options` 键（COMBO 的纯候选数组，或动态 COMBO 的
       * 选项对象数组 —— 调用方按 type 分流）。 */
      const declared = spec.options;
      return { options: spec, type, candidates: Array.isArray(declared) ? declared : [] };
    }
    return { options: spec, type: "UNKNOWN", candidates: [] };
  }
  return { options: {}, type: "UNKNOWN", candidates: [] };
}

/** 部件 vs 连线：与 comfy-cli `_is_widget_input` 同判据（见模块头说明）。 */
function isWidgetType(type: string, options: Record<string, unknown>): boolean {
  /* forceInput / defaultInput 显式把部件口降级成纯连线口（值不占 widgets 位）。 */
  if (options.forceInput || options.defaultInput) {
    return false;
  }
  if (typeof options.widgetType === "string" && options.widgetType !== "") {
    return true;
  }
  if (options.socketless) {
    return true;
  }
  if (WIDGET_SCALAR_TYPES.has(type)) {
    return true;
  }
  if (DOM_WIDGET_TYPES.has(type)) {
    return true;
  }
  /* V3 动态 COMBO 族（COMFY_DYNAMICCOMBO_V3 等）：选择器是部件，占一个 widgets 位。 */
  if (type.startsWith("COMFY_") && type.includes("COMBO")) {
    return true;
  }
  return false;
}

function isDynamicComboType(type: string): boolean {
  return type.startsWith("COMFY_") && type.includes("COMBO");
}

/** COMBO 候选 → 字符串数组（非标量候选原样转字符串，不做深筛选）。 */
function candidatesToChoices(candidates: Array<unknown>): Array<string> {
  return candidates.map((choice) => String(choice));
}

/** COMBO 缺省值：优先 object_info 声明的 default（V3 COMBO 都带，如 scale_method
 *  的 "area"；旧形状多不带），声明值不是标量或缺席时回落首候选。 */
function defaultOf(options: Record<string, unknown>, candidates: Array<unknown>): unknown {
  const declared = options.default;
  if (
    typeof declared === "string" ||
    typeof declared === "number" ||
    typeof declared === "boolean"
  ) {
    return declared;
  }
  return candidates.length > 0 ? candidates[0] : null;
}

/** 动态 COMBO 的选项对象 → 结构化选项（子输入递归走同一套归一）。 */
function comboOptionOf(raw: unknown): ReferenceChainComboOption | null {
  if (!isRecord(raw) || typeof raw.key !== "string") {
    return null;
  }
  const subs: Array<ReferenceChainSubInput> = [];
  const input = isRecord(raw.inputs) ? raw.inputs : {};
  const required = isRecord(input.required) ? input.required : {};
  const optional = isRecord(input.optional) ? input.optional : {};
  for (const table of [required, optional]) {
    for (const [name, spec] of Object.entries(table)) {
      const { options, type, candidates } = normalizeSpec(spec);
      const wire = !isWidgetType(type, options);
      if (wire) {
        /* 连线型子输入（如 "match size" 选项的 IMAGE,MASK 参考口）：装载链是线性
         * 串接、接不了它 —— 定义仍要带出去（编辑器提示 + 建链回落判据），只是不
         * 出部件、不占 widgets 位。 */
        subs.push({ name, type, wire, choices: [], default: null });
        continue;
      }
      subs.push({
        name,
        type,
        wire: false,
        choices: candidatesToChoices(candidates),
        default: defaultOf(options, candidates),
      });
    }
  }
  return { key: raw.key, subs };
}

/** 同名部件不重复收集（required/optional 同名时 required 优先）。 */
function collectInputs(
  table: Record<string, unknown>,
  orderList: Array<unknown>,
  seen: Set<string>,
  push: (name: string, spec: unknown) => void,
): void {
  const names: Array<string> = [
    ...orderList.filter((n): n is string => typeof n === "string" && n in table),
    ...Object.keys(table).filter((n) => !seen.has(n) && !orderList.includes(n)),
  ];
  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    push(name, table[name]);
  }
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
    const collectOne = (name: string, spec: unknown): void => {
      const { options, type, candidates } = normalizeSpec(spec);
      const wire = !isWidgetType(type, options);
      if (wire) {
        inputs.push({ name, type, wire });
        return;
      }
      if (isDynamicComboType(type)) {
        const comboOptions = candidates
          .map((option) => comboOptionOf(option))
          .filter((option): option is ReferenceChainComboOption => option !== null);
        const keys = comboOptions.map((option) => option.key);
        inputs.push({ name, type, wire: false, comboOptions });
        widgetOrder.push(name);
        /* 动态 COMBO 的 object_info 不带 default：前端初始取第一项，这里同口径。 */
        choices[name] = keys;
        defaults[name] = keys[0] ?? null;
        return;
      }
      inputs.push({ name, type, wire: false });
      widgetOrder.push(name);
      choices[name] = candidatesToChoices(candidates);
      defaults[name] = defaultOf(options, candidates);
    };
    collectInputs(required, orderRequired, seen, collectOne);
    collectInputs(optional, [...orderRequired, ...orderOptional], seen, collectOne);

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

/** 动态 COMBO 选中项的子输入定义（不是动态 COMBO / 选中值不在选项里 → null）。 */
export function selectedComboOption(
  def: ReferenceChainClassDef,
  name: string,
  value: unknown,
): ReferenceChainComboOption | null {
  const port = def.inputs.find((input) => input.name === name);
  if (!port?.comboOptions) {
    return null;
  }
  const key = typeof value === "string" ? value : undefined;
  if (key === undefined) {
    return null;
  }
  return port.comboOptions.find((option) => option.key === key) ?? null;
}

/** 按执行语义摆一份链节点的 `widgets_values`（comfy-cli UI→API 转换的配对口径，
 *  见 `_schema_widget_pairs`）：连线口不占位；部件口按声明序各占一位；动态 COMBO
 *  占「选择器 + 选中项的部件子输入（各一位）」。子输入的值取预设 `widgets` 里的
 *  点号全名（`父名.子名`），缺的回落子输入缺省。
 *  返回 null = 摆不出合法值（选中项带连线型子输入，装载链接不了）—— 调用方整链
 *  回落裸 LoadImage，不劣化。 */
export function chainWidgetsValues(
  def: ReferenceChainClassDef,
  widgets: Record<string, unknown> | undefined,
): Array<unknown> | null {
  const values: Array<unknown> = [];
  for (const port of def.inputs) {
    if (port.wire) {
      continue;
    }
    if (port.comboOptions) {
      const selector = widgets?.[port.name] ?? def.defaults[port.name] ?? null;
      values.push(selector);
      const option =
        typeof selector === "string"
          ? (port.comboOptions.find((candidate) => candidate.key === selector) ?? null)
          : null;
      if (option === null || option.subs.some((sub) => sub.wire)) {
        return null;
      }
      for (const sub of option.subs) {
        values.push(widgets?.[`${port.name}.${sub.name}`] ?? sub.default ?? null);
      }
      continue;
    }
    values.push(widgets?.[port.name] ?? def.defaults[port.name] ?? null);
  }
  return values;
}
