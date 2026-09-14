import { describe, expect, it } from "vitest";

import { ALL_WORKFLOW_TYPES } from "~/lib/workflow-types";
import {
  adapterInputsFromContract,
  builtInModeContract,
  contractToStatusEntries,
  isModeContractInputId,
  nextReferenceImageId,
  modeContractInputLabel,
  parseModeContracts,
  referenceImageSlotIndex,
  WORKSHOP_INPUT_TYPES,
} from "./model-mode-contract";

/** 工作流库里所有「生成类」模式（契约编辑器只对它们开放）。 */
const GENERATIVE_MODES = ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative).map(
  (t) => t.code,
);

describe("模式契约口 id 值域", () => {
  it("内置默认契约的每个口都被 isModeContractInputId 接受", () => {
    // 回归：modeContractsSave 曾按**适配器侧**的 WORKSHOP_INPUT_TYPES 校验契约口，
    // 保存含「尺寸 / 参考图」的契约直接被 zod 打回：
    //   Invalid option: expected one of "prompt"|"negative"|"aspect-ratio"|…
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
    expect(
      nextReferenceImageId(["reference-image", "reference-image-2"]),
    ).toBe("reference-image-3");
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
