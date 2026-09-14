import { describe, expect, it } from "vitest";

import { ALL_WORKFLOW_TYPES } from "~/lib/workflow-types";
import {
  builtInModeContract,
  contractToStatusEntries,
  isModeContractInputId,
  nextReferenceImageId,
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
