/**
 * model-test-defaults — 测试模型页「本地工作流候选」的**模式默认值**播种
 * （ISSUE #4633）。
 *
 * 需求：本地模型（工作流库候选）在测试页的统一输入默认值，应当是**工作流在
 * 所选模式下自己的默认值**（作者在 IO 面板勾选的端口默认值 + 模式覆盖层），
 * 而不是页面通用的「1:1 / 1k」预设。
 *
 * 数据链：工作流详情（`workflow.detail` → `template.workflowIO` / `paramMap`）→
 * {@link defaultInputValues}（按模式解析每个端口的生效默认值，ioKey 键）→
 * {@link buildEncapsulatedInputs} 的 `resolved`（契约口 id → ioKey 的连线结果）→
 * 折算成测试页的表单值键（prompt / negative / aspect-ratio / megapixels /
 * multiple / resolution / seed / duration）。
 *
 * 纯函数、无 React、无网络；解析不到的一律**不播种**（调用方回落页面通用
 * 默认），不编造默认值。
 */

import { defaultInputValues } from "~/components/studio/workflow-io";
import { buildEncapsulatedInputs } from "~/lib/workshop/workflow-encapsulation";
import { parseWorkflowIOMap, type WorkflowIOMap } from "~/lib/workflow/workflow-io-types";

import type { ModelTestValues } from "./model-test-config";

/** 选项文字里的比例短标签：ComfyUI 的 COMBO 串是「1:1 (Square)」形态，
 *  测试页的比例词表是短标签（「1:1」）—— 取括号前的部分并去空白。 */
function ratioShortLabel(raw: string): string {
  return raw.split(/[（(]/)[0]?.trim() ?? "";
}

export function workflowModeDefaults(input: {
  io: unknown;
  mode: string;
  paramMap: unknown;
}): ModelTestValues {
  const io: WorkflowIOMap = parseWorkflowIOMap(input.io);
  if (Object.keys(io).length === 0) {
    return {};
  }
  /* 每个端口的**模式生效默认值**（模式覆盖层压过图内默认值），ioKey 键。 */
  const defaults = defaultInputValues(io, input.mode);
  /* 契约口 → ioKey 的连线结果（只含作者画了线的口；空 values = 只要连线表）。 */
  const { resolved } = buildEncapsulatedInputs({
    io,
    mode: input.mode,
    paramMap: input.paramMap,
    values: {},
  });

  const out: ModelTestValues = {};
  const seedText = (entryId: string): string => {
    const ioKey = resolved[entryId];
    if (ioKey === undefined || ioKey === null) {
      return "";
    }
    const value = defaults[ioKey];
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
    return "";
  };
  const seedNumber = (entryId: string): number | null => {
    const ioKey = resolved[entryId];
    if (ioKey === undefined || ioKey === null) {
      return null;
    }
    const value = defaults[ioKey];
    return typeof value === "number" ? value : null;
  };

  /* 提示词 / 负向：图内 / 模式覆盖层给了非空默认才播种（工作流不预置提示词
   * 是常态，空串不值得盖掉页面的占位提示）。 */
  const prompt = seedText("prompt");
  if (prompt !== "") {
    out.prompt = prompt;
  }
  const negative = seedText("negative");
  if (negative !== "") {
    out.negative = negative;
  }

  /* 尺寸：按子口各自播种（工作流用哪个形态，默认值就在哪个子口上）。
   * 比例串归一成短标签；宽高形态测试页没有对应词表，不播种（留通用默认）。 */
  const ratio = seedText("size-aspect");
  if (ratio !== "") {
    const short = ratioShortLabel(ratio);
    if (short !== "") {
      out["aspect-ratio"] = short;
    }
  }
  const megapixels = seedNumber("size-megapixels");
  if (megapixels !== null) {
    out.megapixels = String(megapixels);
  }
  const multiple = seedNumber("size-multiple");
  if (multiple !== null) {
    out.multiple = String(multiple);
  }
  const resolution = seedText("size-resolution");
  if (resolution !== "") {
    out.resolution = resolution;
  }
  /* 工作流用「百万像素 + 倍数」表达尺寸（没有分辨率档口）时，把通用预设的
   * 分辨率档清空 —— 否则档位（1k）会盖过工作流的百万像素默认（4MP），
   * 尺寸选择器显示的还是页面预设而不是工作流自己的默认（ISSUE #4633 实测）。 */
  if (
    (out.megapixels !== undefined || out.multiple !== undefined) &&
    out.resolution === undefined
  ) {
    out.resolution = "";
  }

  /* 种子：只播种**确定值**——控件后行为是 random（或未连）时，图内默认本来就
   * 每次都变，播种一个具体数字反而把「随机」钉死成固定值，改变工作流自身的
   * 默认行为。 */
  const seedIoKey = resolved.seed;
  if (seedIoKey !== undefined && seedIoKey !== null) {
    const entry = io[seedIoKey];
    const seedMode = entry?.modeOverrides?.[input.mode]?.seedMode ?? entry?.seedMode;
    if (seedMode !== "random") {
      const seed = seedNumber("seed");
      if (seed !== null) {
        out.seed = String(seed);
      }
    }
  }

  /* 时长（视频）：数字秒照播。 */
  const duration = seedNumber("duration");
  if (duration !== null) {
    out.duration = String(duration);
  }

  return out;
}
