import { describe, expect, it } from "vitest";

import { builtInModeContract } from "~/lib/workshop/model-mode-contract";
import {
  CONTRACT_MODES,
  addableContractInputs,
  contractModeLabel,
  effectiveModeContract,
  isModeContractCustomized,
} from "./mode-contract-config";

describe("模式契约展示配置", () => {
  it("只开放生成类模式（契约编辑器非生成类模式不出现）", () => {
    expect(CONTRACT_MODES.length).toBeGreaterThan(0);
    expect(CONTRACT_MODES.every((m) => m.isGenerative)).toBe(true);
    expect(CONTRACT_MODES.some((m) => m.code === "T2I")).toBe(true);
  });

  it("模式码大小写都能查到展示名；查不到则回落模式码本身", () => {
    expect(contractModeLabel("t2i")).toBe(contractModeLabel("T2I"));
    expect(contractModeLabel("不存在的模式")).toBe("不存在的模式");
  });
});

describe("生效契约（改过的用改过的，未改过的回落内置默认）", () => {
  it("注册表里没有该模式时回落内置默认并标「未改」", () => {
    const { contract, customized } = effectiveModeContract("T2I", []);
    expect(customized).toBe(false);
    expect(contract).toEqual(builtInModeContract("T2I"));
    expect(isModeContractCustomized("T2I", [])).toBe(false);
  });

  it("注册表里有该模式时用它并标「已改」（模式码大小写不敏感）", () => {
    const custom = { mode: "T2I", inputs: ["prompt" as const], output: "image" as const };
    const { contract, customized } = effectiveModeContract("t2i", [custom]);
    expect(customized).toBe(true);
    expect(contract).toEqual(custom);
    expect(isModeContractCustomized("T2I", [custom])).toBe(true);
  });
});

describe("可追加的固定口清单", () => {
  it("已用过的口不再出现，且参考图不在其中（它不设上限）", () => {
    const addable = addableContractInputs(["prompt", "size"]);
    expect(addable).not.toContain("prompt");
    expect(addable).not.toContain("size");
    expect(addable).not.toContain("reference-image");
    expect(addable).toContain("negative");
  });
});
