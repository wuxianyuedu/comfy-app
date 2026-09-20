import { describe, expect, it } from "vitest";

import { exposedParamDisplayLabel } from "~/lib/workflow/workflow-exposed-params";
import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";
import {
  adapterInputsFromContract,
  builtInModeContract,
  contractToStatusEntries,
  customInputKindOf,
  isCustomContractInputId,
  isModeContractInputId,
  modeContractEntries,
  modeContractInputIdLabel,
  moveContractInput,
  nextCustomInputId,
  nextReferenceImageId,
  modeContractInputLabel,
  parseModeContracts,
  referenceImageSlotIndex,
  WORKSHOP_INPUT_TYPES,
  type ModeContractInputId,
} from "./model-mode-contract";

/** 工作流库里所有「生成类」模式（契约编辑器只对它们开放）。 */
const GENERATIVE_MODES = ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative).map(
  (t) => t.code,
);

describe("模式契约口 id 值域", () => {
  it("内置默认契约的每个口都被 isModeContractInputId 接受", () => {
    // 回归：modeContractsSave 曾按**适配器侧**的 WORKSHOP_INPUT_TYPES 校验契约口，
    // 保存含「尺寸 / 参考图」的契约直接被 zod 打回：
    //   报错原文形如：expected one of "prompt" | "negative" | "aspect-ratio" …
    const seen = new Set<string>();
    for (const mode of GENERATIVE_MODES) {
      for (const id of builtInModeContract(mode).inputs) {
        seen.add(id);
        expect(isModeContractInputId(id), `${mode} 的口 ${id}`).toBe(true);
      }
    }
    expect(seen.has("size")).toBe(true);
    expect(seen.has("reference-image")).toBe(true);
  });

  it("两套 id 互不接受：适配器侧的细分类型不会混进契约", () => {
    const bothSides = [
      "prompt",
      "negative",
      "first-frame",
      "last-frame",
      "duration",
    ];
    for (const t of WORKSHOP_INPUT_TYPES) {
      if (bothSides.includes(t.type)) continue;
      expect(isModeContractInputId(t.type), t.type).toBe(false);
    }
  });

  it("带序号的参考图口合法，可取出序号", () => {
    expect(isModeContractInputId("reference-image-2")).toBe(true);
    expect(referenceImageSlotIndex("reference-image-2")).toBe(2);
    expect(referenceImageSlotIndex("reference-image")).toBe(0);
    expect(isModeContractInputId("")).toBe(false);
  });

  it("参考图不设数量上限：下一个槽依次 reference-image / -2 / -3", () => {
    expect(nextReferenceImageId([])).toBe("reference-image");
    expect(nextReferenceImageId(["prompt", "size"])).toBe("reference-image");
    expect(nextReferenceImageId(["prompt", "reference-image", "size"])).toBe(
      "reference-image-2",
    );
    expect(nextReferenceImageId(["reference-image", "reference-image-2"])).toBe(
      "reference-image-3",
    );
  });

  it("时长口：视频模式内置契约带，生图模式不带", () => {
    expect(isModeContractInputId("duration")).toBe(true);
    expect(builtInModeContract("I2V").inputs).toContain("duration");
    expect(builtInModeContract("T2V").inputs).toContain("duration");
    expect(builtInModeContract("T2I").inputs).not.toContain("duration");
  });

  it("契约往返不丢口（含带序号的参考图）", () => {
    const input = GENERATIVE_MODES.map((m) => builtInModeContract(m));
    const round = parseModeContracts(JSON.parse(JSON.stringify(input)));
    expect(round).toEqual(input);
  });

  it("契约口渲染成工坊控件：第 2 张参考图标成「参考图 2」，仍是图片控件", () => {
    const entries = contractToStatusEntries({
      mode: "I2I",
      inputs: ["prompt", "size", "reference-image", "reference-image-2"],
      output: "image",
    });
    expect(entries.map((e) => e.control)).toEqual([
      "text",
      "size",
      "image",
      "image",
    ]);
    expect(entries[3]?.label).toBe("参考图 2");
  });
});

describe("模式契约的「尺寸」口与统一尺寸口径一致", () => {
  it("尺寸口的展示名写明两类表达是「或」的关系（比例 + 分辨率 / (百万像素 + 倍数)）", () => {
    const label = modeContractInputLabel("size");
    expect(label).toContain("分辨率");
    expect(label).toContain("百万像素");
    expect(label).toContain("倍数");
    /* 斜杠标「或」：分辨率与「百万像素 + 倍数」是两类等价写法，任选其一。
     * 此前用「·」并列，看起来像要同时给四样（比例 / 分辨率 / 百万像素 / 倍数）。 */
    expect(label).toContain("分辨率 /");
    expect(label).not.toContain("·");
  });

  it("契约的 size 口在适配器层展开成「比例 + 百万像素 + 倍数」三行", () => {
    /* 用户口径：需要「比例 + 百万像素 + 倍数」的工作流直接收这三个值；
     *  远端接口的请求体字段名由这三行各自映射。 */
    const rows = adapterInputsFromContract({
      mode: "T2I",
      inputs: ["prompt", "size"],
      output: "image",
    });
    expect(rows).toEqual([
      { type: "prompt", field: "prompt" },
      { type: "aspect-ratio", field: "aspect_ratio" },
      { type: "megapixels", field: "megapixels" },
      { type: "multiple", field: "multiple" },
    ]);
  });

  it("multiple 是适配器侧的细分类型，不混进契约口 id 值域", () => {
    expect(WORKSHOP_INPUT_TYPES.map((t) => t.type)).toContain("multiple");
    expect(isModeContractInputId("multiple")).toBe(false);
  });
});

describe("modeContractEntries：两个页签共读的那一份契约口清单", () => {
  it("未改过的模式回落内置默认（按模式：文生图 = 提示词 + 负向 + 尺寸）", () => {
    const entries = modeContractEntries("T2I", []);
    expect(entries.map((e) => e.id)).toEqual(["prompt", "negative", "size"]);
    /* 展示名与契约表同一份（「尺寸」写明工坊控件的两类写法）。 */
    expect(entries.map((e) => e.label)).toEqual([
      exposedParamDisplayLabel("prompt"),
      exposedParamDisplayLabel("negative"),
      exposedParamDisplayLabel("size"),
    ]);
  });

  it("用户改过的模式按注册表列口，但展示名仍取统一那一份", () => {
    const stored = parseModeContracts([
      { mode: "T2I", inputs: ["prompt", "reference-image-2"], output: "image" },
    ]);
    const entries = modeContractEntries("t2i", stored);
    expect(entries.map((e) => e.id)).toEqual(["prompt", "reference-image-2"]);
    expect(entries[1]?.label).toBe(
      exposedParamDisplayLabel("reference-image-2"),
    );
  });

  it("模式大小写不敏感（注册表按大写存）", () => {
    const stored = parseModeContracts([
      { mode: "T2I", inputs: ["prompt"], output: "image" },
    ]);
    expect(modeContractEntries("t2i", stored).map((e) => e.id)).toEqual([
      "prompt",
    ]);
  });
});

describe("自定义口：id 形状与序号", () => {
  it("id 把简单类型编进去：custom-<类型>-<序号>", () => {
    expect(isCustomContractInputId("custom-text-1")).toBe(true);
    expect(isCustomContractInputId("custom-image-2")).toBe(true);
    expect(isCustomContractInputId("custom-number-3")).toBe(true);
    expect(isCustomContractInputId("custom-foo-1")).toBe(false);
    expect(isModeContractInputId("custom-text-1")).toBe(true);
    expect(customInputKindOf("custom-number-7")).toBe("number");
    expect(customInputKindOf("prompt")).toBe(null);
  });

  it("序号在整个自定义口空间里递增（不是每种类型各排一列）", () => {
    expect(nextCustomInputId([], "text")).toBe("custom-text-1");
    const first: ModeContractInputId[] = ["prompt", "custom-text-1"];
    /* 下一个图片口拿 2 —— 与文本口共用序号空间，删掉一个再加不会立刻复用
     *  同一个 id（映射表按 id 存，复用会让旧落点线落到新口上）。 */
    expect(nextCustomInputId(first, "image")).toBe("custom-image-2");
    expect(nextCustomInputId([...first, "custom-image-2"], "text")).toBe(
      "custom-text-3",
    );
  });
});

describe("自定义口：往返与归一化", () => {
  const contract = {
    mode: "T2I",
    inputs: ["prompt", "custom-text-1", "size"] as ModeContractInputId[],
    output: "image" as const,
    customInputs: [
      {
        id: "custom-text-1" as ModeContractInputId,
        label: "水彩风格",
        kind: "text" as const,
      },
    ],
  };

  it("定义与口一起往返（不丢名字 / 不丢类型）", () => {
    const round = parseModeContracts(JSON.parse(JSON.stringify([contract])));
    expect(round).toEqual([contract]);
  });

  it("没有定义的自定义口被丢弃（下游读不出名字与类型）", () => {
    const round = parseModeContracts([
      { mode: "T2I", inputs: ["prompt", "custom-text-9"], output: "image" },
    ]);
    expect(round.map((c) => c.inputs)).toEqual([["prompt"]]);
  });

  it("空名的定义被丢弃，连带它的口", () => {
    const round = parseModeContracts([
      {
        mode: "T2I",
        inputs: ["prompt", "custom-text-1"],
        output: "image",
        customInputs: [{ id: "custom-text-1", label: "  ", kind: "text" }],
      },
    ]);
    expect(round.map((c) => c.inputs)).toEqual([["prompt"]]);
    expect(round[0]?.customInputs).toBeUndefined();
  });

  it("类型以 id 里编的为准（kind 字段被改写成别的也不会走散）", () => {
    const round = parseModeContracts([
      {
        mode: "T2I",
        inputs: ["custom-image-1"],
        output: "image",
        customInputs: [{ id: "custom-image-1", label: "风格图", kind: "text" }],
      },
    ]);
    expect(round[0]?.customInputs?.[0]?.kind).toBe("image");
  });

  it("展示名取作者填的名字；控件形态按类型给", () => {
    const entries = contractToStatusEntries(contract);
    expect(entries.map((e) => e.id)).toEqual([
      "prompt",
      "custom-text-1",
      "size",
    ]);
    expect(entries[1]?.label).toBe("水彩风格");
    expect(entries[1]?.control).toBe("text");
    /* 不传定义时给中性兜底 —— 不落到「提示词」这类张冠李戴的措辞上。 */
    expect(modeContractInputIdLabel("custom-text-1")).toBe("自定义参数");
    expect(
      contractToStatusEntries({
        mode: "T2I",
        inputs: ["custom-image-1", "custom-number-2"],
        output: "image",
        customInputs: [
          { id: "custom-image-1", label: "风格图", kind: "image" },
          { id: "custom-number-2", label: "强度", kind: "number" },
        ],
      }).map((e) => e.control),
    ).toEqual(["image", "number"]);
  });
});

describe("调序：顺序就是工坊对外的参数顺序", () => {
  const inputs: ModeContractInputId[] = ["prompt", "negative", "size"];

  it("上移 / 下移交换相邻两项", () => {
    expect(moveContractInput(inputs, "negative", -1)).toEqual([
      "negative",
      "prompt",
      "size",
    ]);
    expect(moveContractInput(inputs, "negative", 1)).toEqual([
      "prompt",
      "size",
      "negative",
    ]);
  });

  it("越界时原样返回（视图据此把首尾的按钮置灰）", () => {
    expect(moveContractInput(inputs, "prompt", -1)).toEqual(inputs);
    expect(moveContractInput(inputs, "size", 1)).toEqual(inputs);
    expect(moveContractInput(inputs, "custom-text-9", -1)).toEqual(inputs);
  });

  it("不改原数组（不可变更新）", () => {
    const before = [...inputs];
    moveContractInput(inputs, "prompt", 1);
    expect(inputs).toEqual(before);
  });
});
