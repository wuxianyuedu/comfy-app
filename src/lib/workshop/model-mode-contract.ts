// ── 远端模型「工坊模式适配器」：统一输入类型 + 模式契约（纯函数层）──────
// 工坊对外只说「统一输入」：提示词 / 负向提示词 / 宽高比 / 百万像素 / 倍数 /
// 图片 / 首帧 / 尾帧 / 掩码 / 深度图 / 姿态骨架 / 线稿 / 边缘图 / 种子 —— 模式
// 对应工作流库中定义的模式（T2I / I2I / D2I … T2V / I2V …）。每种远端模型按
// 模式配置一份适配器（统一输入 → 该接口的请求体字段名 + 产物字段路径），工坊
// 发起生成时据此把统一输入翻译成该接口的请求；未配置适配器时回落到
// OpenAI 兼容 images/generations 的默认映射。
//
// 「尺寸」这一类在契约层是一个口（`size`），在适配器层按接口请求体细分：比例
// （aspect-ratio）+ 总像素（megapixels）+ 宽高对齐倍数（multiple）—— 与工坊
// 尺寸选择器的两类表达（「比例 + 分辨率」/「比例 + 百万像素 + 倍数」）对齐，
// 选「分辨率」时由 `lib/size-presets` 换算成后者的三个值再下发。
//
// 输出类型由模式的类别决定（图像 → 图片，视频 → 视频，音频 → 音频）。

import {
  EXPOSED_PARAM_DISPLAY_LABEL,
  exposedCustomKindOf,
  exposedParamDisplayLabel,
  exposedParamsForMode,
  isVideoMode,
  type ExposedCustomKind,
} from "~/lib/workflow/workflow-exposed-params";
import { getWorkflowType } from "~/lib/workflow/workflow-types";

/** 可作为输入的统一类型（供适配器配置选用）。
 *
 *  「尺寸」在契约层是一个口（`size`），到这里按接口请求体细分为三行：
 *  宽高比 / 百万像素 / 倍数 —— 与尺寸选择器的两类表达同一口径。 */
export const WORKSHOP_INPUT_TYPES = [
  { type: "prompt", label: "提示词" },
  { type: "negative", label: "负向提示词" },
  { type: "aspect-ratio", label: "宽高比" },
  { type: "megapixels", label: "百万像素" },
  { type: "multiple", label: "倍数（宽高对齐）" },
  { type: "image", label: "图片" },
  { type: "first-frame", label: "首帧图片" },
  { type: "last-frame", label: "尾帧图片" },
  /** 视频：时长。远端按 field 映射成该接口的字段名（duration / seconds…）。 */
  { type: "duration", label: "时长" },
  { type: "mask", label: "掩码图" },
  { type: "depth", label: "深度图" },
  { type: "pose", label: "姿态骨架图" },
  { type: "lineart", label: "线稿图" },
  { type: "edge", label: "边缘图" },
  { type: "seed", label: "种子" },
] as const;

export type WorkshopInputType = (typeof WORKSHOP_INPUT_TYPES)[number]["type"];

const INPUT_TYPE_SET = new Set<string>(WORKSHOP_INPUT_TYPES.map((t) => t.type));

export function isWorkshopInputType(v: unknown): v is WorkshopInputType {
  return typeof v === "string" && INPUT_TYPE_SET.has(v);
}

export function workshopInputLabel(type: WorkshopInputType): string {
  return WORKSHOP_INPUT_TYPES.find((t) => t.type === type)?.label ?? type;
}

/** 一种远端模式在工坊下的适配器。 */
export interface RemoteModeAdapter {
  /** 工作流库定义的模式码（T2I / I2I / D2I … T2V / I2V …）。 */
  mode: string;
  /** 上游端点路径（拼在条目 baseUrl 后），如 /v1/images/generations。 */
  endpointPath: string;
  /** 统一输入 → 请求体字段名。同一类型只能出现一次。 */
  inputs: Array<{ type: WorkshopInputType; field: string }>;
  /** 产物字段路径（响应 JSON 内，支持 a.b.0.c）；空 = 走通用提取。 */
  outputField: string;
}

/** 该模式默认的输入清单（适配器新建时预填；field 暂用类型名本身）。 */
export function defaultInputsForMode(mode: string): Array<{
  type: WorkshopInputType;
  field: string;
}> {
  const code = mode.trim().toUpperCase();
  /* 「尺寸」的默认三行：比例 + 百万像素 + 倍数（与契约层的 size 口同一口径）。 */
  const size: Array<{ type: WorkshopInputType; field: string }> = [
    { type: "aspect-ratio", field: "aspect_ratio" },
    { type: "megapixels", field: "megapixels" },
    { type: "multiple", field: "multiple" },
  ];
  /** 视频口：时长（秒）。 */
  const durationRow: { type: WorkshopInputType; field: string } = {
    type: "duration",
    field: "duration",
  };
  const base: Array<{ type: WorkshopInputType; field: string }> = [
    { type: "prompt", field: "prompt" },
  ];
  switch (code) {
    case "T2I":
      return [...base, ...size];
    case "TI2I":
    case "R2I":
      return [...base, { type: "image", field: "image" }, ...size];
    case "I2I":
      return [{ type: "image", field: "image" }, ...base, ...size];
    case "E2I":
      return [...base, { type: "edge", field: "edge_image" }, ...size];
    case "D2I":
      return [...base, { type: "depth", field: "depth_image" }, ...size];
    case "P2I":
      return [...base, { type: "pose", field: "pose_image" }, ...size];
    case "S2I":
      return [...base, { type: "lineart", field: "lineart_image" }, ...size];
    case "M2I":
      return [...base, { type: "mask", field: "mask_image" }, ...size];
    case "INPAINT":
      return [
        ...base,
        { type: "image", field: "image" },
        { type: "mask", field: "mask" },
      ];
    case "OUTPAINT":
      return [...base, { type: "image", field: "image" }, ...size];
    default:
      break;
  }
  if (isVideoMode(code)) {
    if (/^I2V$/.test(code)) {
      return [{ type: "image", field: "image" }, ...base, durationRow];
    }
    if (/^(FLF2V|FMF2V)$/.test(code)) {
      return [
        { type: "first-frame", field: "first_frame" },
        { type: "last-frame", field: "last_frame" },
        ...base,
        durationRow,
      ];
    }
    if (/^TI2V$/.test(code)) {
      return [...base, { type: "image", field: "image" }, durationRow];
    }
    return [...base, ...size, durationRow];
  }
  return base;
}

/** 模式默认的端点路径（按输出类别）。 */
export function defaultEndpointPathForMode(mode: string): string {
  return isVideoMode(mode) ? "/videos/generations" : "/images/generations";
}

/** 模式的产物类别。 */
export function outputKindForMode(mode: string): "image" | "video" | "audio" {
  const def = getWorkflowType(mode);
  if (def?.category === "video") return "video";
  if (def?.category === "audio") return "audio";
  if (isVideoMode(mode)) return "video";
  return "image";
}

/** 归一化适配器数组（丢弃非法项：无模式 / 无字段映射）。 */
export function parseRemoteModeAdapters(raw: unknown): RemoteModeAdapter[] {
  if (!Array.isArray(raw)) return [];
  const out: RemoteModeAdapter[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const mode =
      typeof rec.mode === "string" ? rec.mode.trim().toUpperCase() : "";
    if (!mode || seen.has(mode)) continue;
    const inputs: Array<{ type: WorkshopInputType; field: string }> = [];
    if (Array.isArray(rec.inputs)) {
      for (const row of rec.inputs) {
        if (typeof row !== "object" || row === null) continue;
        const r = row as Record<string, unknown>;
        if (!isWorkshopInputType(r.type)) continue;
        const field = typeof r.field === "string" ? r.field.trim() : "";
        if (!field) continue;
        if (inputs.some((i) => i.type === r.type)) continue;
        inputs.push({ type: r.type, field });
      }
    }
    if (inputs.length === 0) continue;
    seen.add(mode);
    const endpointPath =
      typeof rec.endpointPath === "string" && rec.endpointPath.trim() !== ""
        ? rec.endpointPath.trim()
        : defaultEndpointPathForMode(mode);
    const outputField =
      typeof rec.outputField === "string" ? rec.outputField.trim() : "";
    out.push({
      mode,
      endpointPath,
      inputs,
      outputField,
    });
  }
  return out;
}

/** 从响应 JSON 里按点路径取产物字段（支持 a.b.0.c）；取不到返回 null。 */
export function readFieldPath(payload: unknown, path: string): unknown {
  if (!path) return null;
  let cur: unknown = payload;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) return null;
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/* ── 模式契约注册表：每种模式的统一输入 / 输出（可配置，工坊全局生效）──
 *
 * 上一版把「某种模式对外暴露什么」写死在代码里（exposedParamsForMode），
 * 用户没有地方调整。现在契约本身成为可配置实体：
 *   · 本地工作流按契约配「落点」（画布节点拖圆点 / 工坊封装视图呈现）——
 *     契约口 id 与落点编辑器同一套（prompt / negative / size / …）；
 *   · 远端模型按契约建适配器（统一输入 → 请求体字段；尺寸口在适配器层
 *     细分为宽高比 + 百万像素两个字段）。
 * 注册表只存**用户改过的模式**；未改过的模式回落内置默认
 * （exposedParamsForMode + outputKindForMode），保证升级零破坏。
 */

/** 模式契约的输入口类型（与画布落点编辑器的契约口同一套 id）。
 *
 *  label 一律取自 `~/lib/workflow-exposed-params` 的 `EXPOSED_PARAM_DISPLAY_LABEL`
 *  —— 契约口清单会在三处露面（本编辑器、工作流库「工坊封装」、工作流库「画布
 *  节点」的卡片列），各写一份字符串必然漂移（ISSUE #596：「尺寸」在一处带括号、
 *  另一处不带，读起来像两个口）。这里的 type 只做「契约 id → 展示名」的取值。 */
export const MODE_CONTRACT_INPUT_TYPES = [
  { type: "prompt", label: EXPOSED_PARAM_DISPLAY_LABEL.prompt },
  { type: "negative", label: EXPOSED_PARAM_DISPLAY_LABEL.negative },
  { type: "size", label: EXPOSED_PARAM_DISPLAY_LABEL.size },
  { type: "duration", label: EXPOSED_PARAM_DISPLAY_LABEL.duration },
  {
    type: "reference-image",
    label: EXPOSED_PARAM_DISPLAY_LABEL["reference-image"],
  },
  { type: "first-frame", label: EXPOSED_PARAM_DISPLAY_LABEL["first-frame"] },
  { type: "last-frame", label: EXPOSED_PARAM_DISPLAY_LABEL["last-frame"] },
] as const;

export type ModeContractInputType =
  (typeof MODE_CONTRACT_INPUT_TYPES)[number]["type"];

const MODE_CONTRACT_INPUT_SET = new Set<string>(
  MODE_CONTRACT_INPUT_TYPES.map((t) => t.type),
);

export function isModeContractInputType(
  v: unknown,
): v is ModeContractInputType {
  return typeof v === "string" && MODE_CONTRACT_INPUT_SET.has(v);
}

export function modeContractInputLabel(type: ModeContractInputType): string {
  return MODE_CONTRACT_INPUT_TYPES.find((t) => t.type === type)?.label ?? type;
}

/* ── 自定义输入口 ──
 *
 * 预制口只有七类，作者想多要一个口（`style` / `seed` / 某个接口特有的开关）就得改
 * 代码 —— 那正是这套注册表要消掉的事。自定义口把「加一个口」变成一次配置：起个名
 *  + 选一个**简单类型**，类型只决定 ① 工坊用什么控件录入；② 它接受哪一族的端口。
 *
 *  口 id 由系统生成、把类型编进去（`custom-<类型>-<序号>`）：类型是**结构信息**，
 *  它必须能被纯函数层（映射 / 封装 / 适配器）从 id 直接读出来 —— 契约口清单一路传
 *  下去时只带 id（见 `buildParamEntries` 的 `contractIds`），靠另一张表才能知道类型
 *  的话，自定义口在落点画布上会静默消失（`exposedClassOf` 认不出来即整口丢弃）。
 *  作者填的名字单独存在 `customInputs[].label` 里（见 `ModeContract.customInputs`）。 */

/** 自定义口的简单类型（文本 / 图片 / 数字）。 */
export type ModeContractCustomKind = ExposedCustomKind;

/** 一条自定义口的定义：id（含类型与序号）+ 作者填的展示名。 */
export interface ModeContractCustomInput {
  /** 契约口 id（`custom-<类型>-<序号>`；序号在契约内不与其它自定义口重复）。 */
  id: ModeContractInputId;
  /** 展示名（作者填）。空名不留（归一化时丢弃）。 */
  label: string;
  /** 简单类型（恒与 id 里编的类型一致 —— 归一化时以 id 为准）。 */
  kind: ModeContractCustomKind;
}

/** 契约口 id 的完整值域：7 个基础口 +「参考图」第 2 张起带序号
 *  （`reference-image-2`）+ 自定义口（`custom-<类型>-<序号>`）。
 *
 *  与适配器侧的 WorkshopInputType 是**两套 id**，别混用：适配器口按接口请求体
 *  分得更细（契约的「尺寸」在适配器层拆成 aspect-ratio + megapixels + multiple），
 *  契约口是工坊对用户的统一口径（尺寸 / 参考图 / 自定义）。 */
export type ModeContractInputId =
  | ModeContractInputType
  | `reference-image-${number}`
  | `custom-${ModeContractCustomKind}-${number}`;

/** 自定义口 id 的简单类型（非自定义口返回 null）。
 *
 *  转发底层的 `exposedCustomKindOf`：自定义口这个概念在映射 / 封装层就已经存在
 *  （见 `exposedClassOf`），契约层不再自己解析一遍形状。 */
export function customInputKindOf(
  id: string | null | undefined,
): ModeContractCustomKind | null {
  return typeof id === "string" ? exposedCustomKindOf(id) : null;
}

/** 某个 id 是不是自定义口。 */
export function isCustomContractInputId(v: unknown): v is ModeContractInputId {
  return typeof v === "string" && exposedCustomKindOf(v) !== null;
}

export function isModeContractInputId(v: unknown): v is ModeContractInputId {
  if (typeof v !== "string") return false;
  if (isModeContractInputType(v)) return true;
  if (/^reference-image-\d+$/.test(v)) return true;
  return isCustomContractInputId(v);
}

/** 下一个可用的自定义口 id：序号在**整个契约的自定义口空间**里递增（不是每种类型
 *  各排一列）——不同类型的口共用序号，删掉一个口再加不会立刻复用同一个 id，指向
 *  已删口的落点线因此不会「复活成新口」（映射表按 id 存）。 */
export function nextCustomInputId(
  inputs: readonly ModeContractInputId[],
  kind: ModeContractCustomKind,
): ModeContractInputId {
  let max = 0;
  for (const id of inputs) {
    const matched = /^custom-[a-z]+-(\d+)$/.exec(id);
    if (matched) max = Math.max(max, Number(matched[1]));
  }
  return `custom-${kind}-${max + 1}`;
}

/** 移动一个输入口的位置（`delta` = -1 上移 / +1 下移）。
 *
 *  顺序就是工坊对外的参数顺序（数组下标即展示序号），所以调序必须作用在同一份
 *  `inputs` 数组上，而不是在视图层另存一份顺序 —— 两份顺序一定会走散。越界时
 *  返回原数组（调用方据此维持按钮可用性，见视图里的首尾禁用）。 */
export function moveContractInput(
  inputs: readonly ModeContractInputId[],
  id: ModeContractInputId,
  delta: number,
): ModeContractInputId[] {
  const from = inputs.indexOf(id);
  if (from < 0) return [...inputs];
  const to = from + delta;
  if (to < 0 || to >= inputs.length) return [...inputs];
  const next = [...inputs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** 带序号的参考图口的序号（`reference-image-2` → 2；非带序号口返回 0）。 */
export function referenceImageSlotIndex(id: string): number {
  const m = /^reference-image-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** 任意契约口 id 的展示名（带序号的参考图口显示为「参考图 2」，其余同基础口）。
 *
 *  转发 `exposedParamDisplayLabel`：契约口清单的措辞只有那一份（ISSUE #596），
 *  本模块不再自己拼字符串。**自定义口例外**：它的名字只有契约知道（作者起的），
 *  所以调用方要把该契约的自定义口定义一起传进来 —— 不传时退回一条中性兜底名，
 *  不会显示成「提示词」这类张冠李戴的措辞。 */
export function modeContractInputIdLabel(
  id: ModeContractInputId,
  customInputs?: readonly ModeContractCustomInput[],
): string {
  const custom = customInputs?.find((item) => item.id === id);
  return custom ? custom.label : exposedParamDisplayLabel(id);
}

/* 下一个可追加的参考图口 id —— 参考图不设数量上限，每次追加下一个序号槽
 *（`reference-image` 之后是 `reference-image-2`、`-3`，依次递增）。 */
export function nextReferenceImageId(
  inputs: readonly ModeContractInputId[],
): ModeContractInputId {
  let max = 0;
  for (const id of inputs) {
    const slot = id === "reference-image" ? 1 : referenceImageSlotIndex(id);
    if (slot > max) max = slot;
  }
  return max === 0 ? "reference-image" : `reference-image-${max + 1}`;
}

export type ModeContractOutput = "image" | "video" | "audio";

/** 一个契约口在**这一模式下**是否必备。
 *
 *  必备 = 工坊/运行环节少不得它：缺了它这条工作流在工坊里驱动不起来（也是
 *  「这条流能不能跑」的判据 —— 与工作流的可执行性是两个问题，别混）。
 *
 *  **为什么做成配置而不是写死**：以前判据是代码里一句「id === "prompt"」，
 *  于是「负向提示词要不要必备」「时长对视频是不是必备」这类问题的答案只能靠改
 *  代码。用户口径是「哪个是必备的应该能配」（ISSUE #632）—— 现在它随契约走，
 *  在「模式契约」编辑器里按模式勾选。
 *
 *  没勾任何口 = 这条模式没有必备口（工坊不因缺某个口而判它不可用）。 */
export type ModeContractRequired = ModeContractInputId[];

/** 一种模式的统一输入 / 输出契约（工坊对外口径）。 */
export interface ModeContract {
  /** 工作流库定义的模式码（T2I / I2I / D2I … T2V / I2V …）。 */
  mode: string;
  /** 统一输入口（有序；取值为 ModeContractInputId）。 */
  inputs: ModeContractInputId[];
  /** 统一输出类别。 */
  output: ModeContractOutput;
  /** 必备口（有序子集；缺省 = 内置默认，见 `requiredInputsFor`）。
   *
   *  用 `undefined` 而不是空数组表达「没配过」：内置默认（提示词）与「用户
   *  主动清空了必备口」是两个不同的状态，用空数组一锅端会让「我明明取消勾选了」
   *  与「我还没配过」读起来一样。 */
  required?: ModeContractRequired;
  /** 自定义口的定义（id → 作者填的展示名 + 简单类型）。
   *
   *  `inputs` 里的自定义口必须在其中有定义：没有定义的口下游读不出名字与类型
   *  （归一化时直接丢弃那个口，见 `parseModeContracts`）。 */
  customInputs?: ModeContractCustomInput[];
}

/** 内置的必备口判定（未在注册表里配过时用它）。
 *
 *  提示词是所有生成模式的必备口：工坊的每条链路都是「一段提示词 → 一次生成」，
 *  没有承载提示词的端口，这条工作流在工坊里根本驱动不起来。其余口不预设必备
 *  —— 它们是可选的补充（负向 / 首尾帧 / 参考图 / 尺寸由工作流默认值兜底）。 */
export function builtInRequiredInputs(
  inputs: readonly ModeContractInputId[],
): ModeContractRequired {
  return inputs.filter((id) => id === "prompt");
}

/** 某契约生效的必备口：配过用配过的，没配过用内置默认。
 *
 *  入参收 `string[]`（不是 `ModeContractInputId[]`）：调用方拿到的口子清单常常
 *  来自展示派生（`ContractEntryDisplay[]` 的 `id: string`），为了一次判空去反向
 *  断言类型没有意义 —— 非契约 id 本来就落不进必备判据（会被 `inputs` 过滤掉）。 */
export function requiredInputsFor(contract: {
  inputs: readonly string[];
  required?: readonly string[];
}): ModeContractRequired {
  const source =
    contract.required ??
    builtInRequiredInputs(
      contract.inputs.filter((id): id is ModeContractInputId =>
        isModeContractInputId(id),
      ),
    );
  /* 必备口必须是本契约里存在的口：契约里删掉某口之后，残留的 required 条目会
   *  让「缺了必备口」永远为真（页面提示一个已经不存在的口缺落点）。 */
  return source.filter(
    (id): id is ModeContractInputId =>
      isModeContractInputId(id) && contract.inputs.includes(id),
  );
}

/** 内置默认契约（未在注册表里改过的模式用它）。 */
export function builtInModeContract(mode: string): ModeContract {
  const inputs = exposedParamsForMode(mode).map(
    (d) => d.id as ModeContractInputId,
  );
  return {
    mode: mode.trim().toUpperCase(),
    inputs,
    output: outputKindForMode(mode),
    required: builtInRequiredInputs(inputs),
  };
}

/** 校验并归一化一份注册表（去重、剔非法口、模式大写）。
 *
 *  口的合法性用 isModeContractInputId —— 与 modeContractsSave 的入参校验同源。
 *  历史教训：这里用 isModeContractInputType（基础 6 口）时，内置默认契约里带序号的
 *  参考图口会被**静默丢掉**，用户存完再读回来就少一口。 */
export function parseModeContracts(raw: unknown): ModeContract[] {
  if (!Array.isArray(raw)) return [];
  const out: ModeContract[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const mode =
      typeof rec.mode === "string" ? rec.mode.trim().toUpperCase() : "";
    if (!mode || seen.has(mode)) continue;
    /* 自定义口定义先解析：`inputs` 里的自定义口要靠它才能留下 —— 没有定义的口
     *  下游读不出名字与类型，列出来只会是一张无名卡片。 */
    const customInputs = parseCustomInputs(rec.customInputs);
    const rawInputs = Array.isArray(rec.inputs) ? rec.inputs : [];
    const inputs = rawInputs.filter(
      (i): i is ModeContractInputId =>
        isModeContractInputId(i) &&
        (customInputKindOf(i) === null ||
          customInputs.some((def) => def.id === i)),
    );
    if (inputs.length === 0) continue;
    /* 必备口：只收契约里真的存在的口（`required` 缺失 = 没配过 → 存 undefined，
     *  由 `requiredInputsFor` 回落内置默认）。 */
    const required = Array.isArray(rec.required)
      ? rec.required.filter(
          (i): i is ModeContractInputId =>
            isModeContractInputId(i) && inputs.includes(i),
        )
      : undefined;
    const rawOutput = typeof rec.output === "string" ? rec.output : "";
    const output: ModeContractOutput =
      rawOutput === "video" || rawOutput === "audio"
        ? rawOutput
        : outputKindForMode(mode);
    /* 只留本契约真的用到的自定义口定义：`inputs` 里已删掉的口，定义跟着消失
     *  （否则注册表会随每次「加一个又删一个」永久膨胀）。 */
    const usedCustomInputs = customInputs.filter((def) =>
      inputs.includes(def.id),
    );
    seen.add(mode);
    out.push({
      mode,
      inputs,
      output,
      ...(required !== undefined ? { required } : {}),
      ...(usedCustomInputs.length > 0
        ? { customInputs: usedCustomInputs }
        : {}),
    });
  }
  return out;
}

/** 解析一份契约里的自定义口定义（非法项丢弃）。
 *
 *  类型以 **id 里编的那个**为准：`kind` 字段只是落库后便于人读的冗余，被篡改时
 *  不能让它与 id 走散 —— 走散就等于控件形态与端口族各认一个类型。 */
function parseCustomInputs(raw: unknown): ModeContractCustomInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ModeContractCustomInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    const kind = customInputKindOf(id);
    if (!kind || !label || !isCustomContractInputId(id)) continue;
    if (out.some((def) => def.id === id)) continue;
    out.push({ id, label, kind });
  }
  return out;
}

/** 契约口清单的**统一形状** —— 工坊封装页与工作流库「画布节点」卡片列都读它。
 *
 *  两份视图看的必须是同一张清单：一份按内置契约（按模式）、一份按用户改过的
 *  模式契约注册表。若各读各的，同一页面上两个页签会列出不同的口（ISSUE #596
 *  的「对外参数显示不一致」就是这么来的）。 */
export interface ContractEntryDisplay {
  id: string;
  label: string;
  control: "text" | "size" | "image" | "duration" | "number";
}

/** 契约口 id → 工坊控件形态（尺寸是组合控件、时长是秒数选择、其余按图示）。
 *
 *  自定义口按它自己的简单类型给控件：文本 / 图片 / 数字 —— 类型是作者选的，
 *  不从 id 之外的任何地方推。 */
function contractControlFor(
  id: string,
  customInputs?: readonly ModeContractCustomInput[],
): ContractEntryDisplay["control"] {
  const custom = customInputs?.find((item) => item.id === id);
  if (custom) return custom.kind;
  if (id === "size") return "size";
  if (id === "duration") return "duration";
  if (id === "prompt" || id === "negative") return "text";
  return "image";
}

/** **某一模式生效的契约口清单**：用户改过的模式用注册表里的口径，未改过的
 *  回落内置默认。仓库里凡是「按模式列对外口」的地方都该经它取，别自己
 *  调 `exposedParamsForMode` / 自己解析 `storedContracts`。 */
export function modeContractEntries(
  mode: string | null | undefined,
  storedContracts?: readonly ModeContract[] | null,
): ContractEntryDisplay[] {
  const code = (mode ?? "").toUpperCase();
  const stored = storedContracts?.find((c) => c.mode === code);
  if (stored) return contractToStatusEntries(stored);
  return exposedParamsForMode(mode).map((def) => ({
    id: def.id,
    label: def.label,
    control: contractControlFor(def.id),
  }));
}

/** 契约 → 封装状态派生用的口子清单（id / 展示名 / 工坊控件形态）。
 *
 *  自定义口的展示名与类型只此一处可取（契约里存着），所以这里必须把
 *  `contract.customInputs` 一起带上 —— 不带的话下游只会拿到一条中性兜底名，
 *  作者起的名字在画布 / 封装页签上全都看不见。 */
export function contractToStatusEntries(
  contract: ModeContract,
): ContractEntryDisplay[] {
  const customInputs = contract.customInputs;
  return contract.inputs.map((type) => ({
    id: type,
    // 带序号的参考图口展示为「参考图 2」（与 exposedParamsForMode 的命名一致）
    label: modeContractInputIdLabel(type, customInputs),
    control: contractControlFor(type, customInputs),
  }));
}

/** 契约 → 远端适配器的默认输入映射（size 拆成宽高比 + 百万像素 + 倍数三行）。
 *
 *  第 2 张起的参考图口（reference-image-2…）没有约定的默认请求体字段名，这里不猜：
 *  不生成默认行，留给用户在适配器页自行加一行并把字段名填成该接口实际用的名字。
 *  **自定义口同理**：名字是作者起的，谁也猜不出该接口管它叫什么 —— 这里跳过，
 *  本地工作流侧照常可用（落点由作者连线声明）。 */
export function adapterInputsFromContract(
  contract: ModeContract,
): Array<{ type: WorkshopInputType; field: string }> {
  const out: Array<{ type: WorkshopInputType; field: string }> = [];
  for (const id of contract.inputs) {
    switch (id) {
      case "prompt":
        out.push({ type: "prompt", field: "prompt" });
        break;
      case "negative":
        out.push({ type: "negative", field: "negative_prompt" });
        break;
      case "size":
        out.push(
          { type: "aspect-ratio", field: "aspect_ratio" },
          { type: "megapixels", field: "megapixels" },
          { type: "multiple", field: "multiple" },
        );
        break;
      case "reference-image":
        out.push({ type: "image", field: "image" });
        break;
      case "first-frame":
        out.push({ type: "first-frame", field: "first_frame" });
        break;
      case "last-frame":
        out.push({ type: "last-frame", field: "last_frame" });
        break;
      case "duration":
        out.push({ type: "duration", field: "duration" });
        break;
    }
  }
  return out;
}
