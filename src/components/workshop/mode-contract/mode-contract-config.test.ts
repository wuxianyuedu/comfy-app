import { describe, expect, it } from "vitest";

import { builtInModeContract } from "~/lib/workshop/model-mode-contract";
import {
  CONTRACT_MODES,
  CUSTOM_INPUT_KINDS,
  addableContractInputs,
  contractInputCatalog,
  contractModeLabel,
  customInputKindLabel,
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
    const custom = {
      mode: "T2I",
      inputs: ["prompt" as const],
      output: "image" as const,
    };
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

describe("全部参数表（「浏览全部参数」那一块）", () => {
  it("列出**全部**预制口（含已用的），并标出哪些已在契约里", () => {
    const catalog = contractInputCatalog(["prompt", "size"]);
    expect(catalog.map((item) => item.type)).toEqual([
      "prompt",
      "negative",
      "size",
      "duration",
      "reference-image",
      "first-frame",
      "last-frame",
    ]);
    expect(
      catalog.filter((item) => item.added).map((item) => item.type),
    ).toEqual(["prompt", "size"]);
  });

  it("参考图只要契约里有任意一张槽就算「已添加」", () => {
    const catalog = contractInputCatalog(["prompt", "reference-image-2"]);
    expect(catalog.find((item) => item.type === "reference-image")?.added).toBe(
      true,
    );
  });
});

describe("自定义口的简单类型清单", () => {
  it("三种类型各有展示名，看不懂的类型原样回显", () => {
    expect(CUSTOM_INPUT_KINDS.map((item) => item.kind)).toEqual([
      "text",
      "image",
      "number",
    ]);
    expect(customInputKindLabel("number")).toBe("数字");
  });
});
