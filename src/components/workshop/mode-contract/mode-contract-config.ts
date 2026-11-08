// ── 「模式契约」编辑器的展示配置与派生（规范 17 §17.2 第①层：纯配置）──────
// 契约本身由 `lib/workshop/model-mode-contract` 定义，这里只放**两个入口共用**的
// 展示口径：模式按类别分组、可追加的固定口清单、「该模式当前生效的契约」。
// 独立成模块是因为两处必须说同一套话，各写一份会在改动时静默分叉。

import { upperToken } from "~/lib/upper-token";
import {
  MODE_CONTRACT_INPUT_TYPES,
  configuredModeContracts,
  derivedModeContract,
  modeContractSignature,
  type ModeContract,
  type ModeContractCustomKind,
  type ModeContractInputType,
} from "~/lib/workshop/model-mode-contract";
import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";

/** 可参与契约编辑的模式（生成类；与工坊的驱动口径一致）。 */
export const CONTRACT_MODES = ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative);

/** 模式按输出类别分组 —— 模式清单有二十多个，不分组找不到。 */
export const CONTRACT_MODE_GROUPS: Array<{
  category: "image" | "video" | "audio";
  label: string;
}> = [
  { category: "image", label: "图像" },
  { category: "video", label: "视频" },
  { category: "audio", label: "音频" },
];

/**
 * 导航树的**一棵树**：父行（输出类别）+ 挂在它下面的模式项。模式的顺序与内容一律从 `CONTRACT_MODES` 派生，不在这里重抄（§12.18）；空组顺手丢掉。
 * 每一组**必须非空**、并集恰好等于 `CONTRACT_MODES` —— 由 `mode-contract-config.test.ts` 双向比对守住（漏项是这张表的失效模式：某个模式从导航上静默消失）。
 */
export type ContractModeTreeGroup = {
  category: "image" | "video" | "audio";
  label: string;
  /** 挂在这一组下的模式（顺序即渲染顺序）。 */
  modes: typeof CONTRACT_MODES;
};

/** 导航树（按 `CONTRACT_MODE_GROUPS` 的顺序，跳过空组）。 */
export function contractModeTree(): Array<ContractModeTreeGroup> {
  return CONTRACT_MODE_GROUPS.map((group) => ({
    ...group,
    modes: CONTRACT_MODES.filter((t) => t.category === group.category),
  })).filter((group) => group.modes.length > 0);
}

/** 模式码 → 展示名（工作流类型表里查得到就用它的中文名）。 */
export function contractModeLabel(mode: string): string {
  return ALL_WORKFLOW_TYPES.find((t) => t.code === mode.toUpperCase())?.label ?? mode;
}

/** 成品配置（推导 + 项目默认显式覆盖）按模式码的索引 —— 见
 *  `effectiveModeContract` 的回落分支。 */
const CONFIGURED_BY_MODE: ReadonlyMap<string, ModeContract> = new Map(
  configuredModeContracts().map((contract) => [contract.mode, contract]),
);

/** 某模式当前生效的契约：本机覆盖里有就用它，没有就按成品配置（推导 + 项目默认显式覆盖）。
 *  「改过/没改过」的判据收在这一处（两个入口的徽标、编辑器初值、封装视图都读它）。
 *  `stored` 是**本机覆盖**（`useModeContracts` 的读取结果），不是成品配置。 */
export function effectiveModeContract(
  mode: string,
  stored: ReadonlyArray<ModeContract>,
): { contract: ModeContract; customized: boolean } {
  const code = upperToken(mode);
  const fallback = CONFIGURED_BY_MODE.get(code) ?? derivedModeContract(code);
  const found = stored.find((c) => c.mode === code);
  if (found && modeContractSignature(found) !== modeContractSignature(fallback)) {
    return { contract: found, customized: true };
  }
  /* 「已改」判的是**内容**（与本模式成品配置深比较），不是「覆盖文件里有没有
   * 这一条」（ISSUE #3396 反馈 1 的现场：旧版保存把整份注册表写进覆盖，用户
   * 只改了一个模式、二十多个原样入库，徽标全部点亮）。内容相同的覆盖条目按
   * 没改过处理 —— 生效值回落成品配置本身，两条本来就一模一样。 */
  return { contract: fallback, customized: false };
}

/** 某模式是否已被用户改过（「已改」徽标）。 */
export function isModeContractCustomized(
  mode: string,
  stored: ReadonlyArray<ModeContract>,
): boolean {
  return effectiveModeContract(mode, stored).customized;
}

/** 契约里还没有的固定口（供「＋ 添加口」按钮清单）。
 *
 *  参考图不在其中：它不设数量上限，由 `nextReferenceImageId` 逐个追加序号槽。 */
export function addableContractInputs(inputs: ReadonlyArray<string>): Array<ModeContractInputType> {
  return MODE_CONTRACT_INPUT_TYPES.filter(
    (t) => t.type !== "reference-image" && !inputs.includes(t.type),
  ).map((t) => t.type);
}

/** 自定义口的简单类型清单（作者新增自定义参数时选的那一项）。
 *
 *  「简单类型」的边界：只到「用什么控件录入 / 接哪一族端口」为止 —— 文本、图片、
 *  数字。更细的形状（尺寸的组合控件、时长的秒/帧单位）都带语义，需要配套的换算
 *  规则，不是一次配置能说清的，所以不开放给作者自选。 */
export const CUSTOM_INPUT_KINDS: ReadonlyArray<{
  hint: string;
  kind: ModeContractCustomKind;
  label: string;
}> = [
  { kind: "text", label: "文本", hint: "单行文本，可落到工作流的文本行" },
  { kind: "image", label: "图片", hint: "选本地图片上传，可落到图片行" },
  { kind: "number", label: "数字", hint: "数值输入，可落到数值 / 选项行" },
];

/** 自定义口类型 → 展示名。 */
export function customInputKindLabel(kind: ModeContractCustomKind): string {
  return CUSTOM_INPUT_KINDS.find((item) => item.kind === kind)?.label ?? kind;
}

/** **全部预制口** + 「本契约是否已经用了它」—— 「浏览全部参数」用。
 *
 *  与 `addableContractInputs` 的分工：那个给「＋ 添加」按钮清单（只列还没加的），
 *  这个给一张**完整**的参数表（已加的也在，标出来），否则用户看不到「一共能有
 *  哪些口」——只看得见剩下的那几个，读起来像「这套系统只支持这些参数」。 */
export function contractInputCatalog(
  inputs: ReadonlyArray<string>,
): Array<{ added: boolean; label: string; type: ModeContractInputType }> {
  return MODE_CONTRACT_INPUT_TYPES.map((item) => ({
    type: item.type,
    label: item.label,
    added: inputs.some((id) =>
      item.type === "reference-image" ? id.startsWith("reference-image") : id === item.type,
    ),
  }));
}
