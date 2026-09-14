import { describe, expect, it } from "vitest";
import type { WorkflowIOMap } from "../src/components/studio/shared/workflow-io";
import { deriveEncapsulationStatus } from "../src/lib/workshop/workshop-encapsulation-status";
import { modeContractInputLabel } from "../src/lib/workshop/model-mode-contract";

/** 尺寸口的展示名与模式契约编辑器同一份措辞（单一出处，不做字面重复断言）。 */
const SIZE_LABEL = modeContractInputLabel("size");

/** 典型文生图工作流 IO：提示词 + 负向 + 宽高比/百万像素组合控件 + 内部参数。 */
const IO: WorkflowIOMap = {
  positive_prompt: {
    direction: "input",
    kind: "widget",
    nodeId: "6",
    name: "positive_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "a cat",
  },
  negative_prompt: {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "negative_prompt",
    type: "STRING",
    multiline: true,
    defaultValue: "blurry",
  },
  aspect_ratio: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "aspect_ratio",
    type: "COMBO",
    options: ["16:9", "1:1", "4:3"],
    defaultValue: "16:9",
  },
  megapixels: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "megapixels",
    type: "COMBO",
    options: ["1M", "1.5M"],
    defaultValue: "1M",
  },
  steps: {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "steps",
    type: "INT",
    defaultValue: 28,
  },
};

describe("deriveEncapsulationStatus", () => {
  it("自动判定：提示词口落到端口 → ready，尺寸聚合为宽高比+百万像素控件", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: null,
      mode: "t2i",
    });
    expect(status.ready).toBe(true);
    const prompt = status.entries.find((e) => e.id === "prompt");
    expect(prompt?.targetIoKey).toBe("positive_prompt");
    expect(prompt?.control).toBe("text");
    const size = status.entries.find((e) => e.id === "size");
    expect(size?.label).toBe(SIZE_LABEL);
    expect(size?.control).toBe("size");
    expect(size?.targetIoKey).not.toBeNull();
    // 内部参数（steps）不在契约口里
    expect(status.entries.find((e) => e.id === "steps")).toBeUndefined();
  });

  it("没有提示词口 → 未配置（工坊无法驱动），缺失口显式可见", () => {
    const ioNoPrompt: WorkflowIOMap = {
      steps: IO.steps!,
    };
    const status = deriveEncapsulationStatus({
      io: ioNoPrompt,
      paramMap: null,
      mode: "t2i",
    });
    expect(status.ready).toBe(false);
    expect(status.missingLabels).toContain("提示词");
    expect(status.missingLabels).toContain(SIZE_LABEL);
  });

  it("作者落点覆盖（paramMap.manualByMode）优先于自动判定", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: {
        manualByMode: {
          t2i: { prompt: "negative_prompt" },
        },
      },
      mode: "t2i",
    });
    const prompt = status.entries.find((e) => e.id === "prompt");
    expect(prompt?.targetIoKey).toBe("negative_prompt");
    expect(prompt?.manual).toBe(true);
  });

  it("IO 为空 → 全部口未配置且不 ready", () => {
    const status = deriveEncapsulationStatus({
      io: null,
      paramMap: null,
      mode: "t2i",
    });
    expect(status.ready).toBe(false);
    expect(status.resolvedCount).toBe(0);
  });
});

describe("deriveEncapsulationStatus：契约注册表覆盖", () => {
  it("传入已配置契约时按它显式列口（含内置契约没有的自定义口）", () => {
    const status = deriveEncapsulationStatus({
      io: IO,
      paramMap: null,
      mode: "t2i",
      contractEntries: [
        { id: "prompt", label: "提示词", control: "text" },
        { id: "size", label: SIZE_LABEL, control: "size" },
        { id: "reference-image", label: "参考图 / 输入图", control: "image" },
      ],
    });
    expect(status.entries.map((e) => e.id)).toEqual([
      "prompt",
      "size",
      "reference-image",
    ]);
    // 契约里新增的口（IO 中没有能自动落上的）→ 未配置显式可见
    const ref = status.entries.find((e) => e.id === "reference-image");
    expect(ref?.targetIoKey).toBeNull();
    expect(status.ready).toBe(true);
  });
});
