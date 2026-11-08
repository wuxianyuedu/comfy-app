import { describe, expect, it } from "vitest";

import { derivedModeContract } from "~/lib/workshop/model-mode-contract";
import {
  CONTRACT_MODES,
  CUSTOM_INPUT_KINDS,
  addableContractInputs,
  contractModeTree,
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

describe("导航树（父行 = 输出类别、子行 = 模式）", () => {
  it("并集恰好等于全部生成模式，且一个不重（双向比对）", () => {
    const tree = contractModeTree();
    const flat = tree.flatMap((group) => group.modes.map((t) => t.code));
    expect(new Set(flat)).toEqual(new Set(CONTRACT_MODES.map((t) => t.code)));
    expect(flat.length).toBe(CONTRACT_MODES.length);
  });

  it("每个分组都非空（空父行没有意义）", () => {
    for (const group of contractModeTree()) {
      expect(group.modes.length).toBeGreaterThan(0);
      expect(group.modes.every((t) => t.category === group.category)).toBe(true);
    }
  });
});

describe("生效契约（改过的用改过的，未改过的回落内置默认）", () => {
  it("注册表里没有该模式时回落内置默认并标「未改」", () => {
    const { contract, customized } = effectiveModeContract("T2I", []);
    expect(customized).toBe(false);
    expect(contract).toEqual(derivedModeContract("T2I"));
    expect(isModeContractCustomized("T2I", [])).toBe(false);
  });

  it("注册表里有该模式且**内容与默认不同**时用它并标「已改」（模式码大小写不敏感）", () => {
    const custom = {
      mode: "T2I",
      /* SAFETY: 类型断言已复核 */
      inputs: ["prompt" as const],
      /* SAFETY: 类型断言已复核 */
      output: "image" as const,
    };
    const { contract, customized } = effectiveModeContract("t2i", [custom]);
    expect(customized).toBe(true);
    expect(contract).toEqual(custom);
    expect(isModeContractCustomized("T2I", [custom])).toBe(true);
  });

  it("覆盖条目与默认**内容相同**时标「未改」——判据是内容不是「文件里有没有」（ISSUE #3396 反馈 1）", () => {
    // 旧版保存把整份注册表写进覆盖：二十多个与默认一模一样的条目把徽标全部点亮。
    // 现在判的是与本模式成品配置深比较（modeContractSignature）。
    const identical = { ...derivedModeContract("T2I") };
    expect(isModeContractCustomized("T2I", [identical])).toBe(false);
    // required 未固化（undefined）与「固化后的内置默认」是同一件事，也不算改过。
    expect(isModeContractCustomized("T2I", [{ ...identical, required: undefined }])).toBe(false);
    // 生效值回落成品配置本身（两条内容本来就一样，返回哪条都该是默认那份）。
    expect(effectiveModeContract("T2I", [identical]).contract).toEqual(derivedModeContract("T2I"));
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
      /* #942 抽卡纠偏起，种子是内置预制口之一（排在时长之后）。 */
      "seed",
      /* 角色 LoRA 两枚（#2622）：排在种子之后（MODE_CONTRACT_INPUT_TYPES 的顺序）。 */
      "lora-name",
      "lora-strength",
      "reference-image",
      "first-frame",
      "last-frame",
    ]);
    expect(catalog.filter((item) => item.added).map((item) => item.type)).toEqual([
      "prompt",
      "size",
    ]);
  });

  it("参考图只要契约里有任意一张槽就算「已添加」", () => {
    const catalog = contractInputCatalog(["prompt", "reference-image-2"]);
    expect(catalog.find((item) => item.type === "reference-image")?.added).toBe(true);
  });
});

describe("自定义口的简单类型清单", () => {
  it("三种类型各有展示名，看不懂的类型原样回显", () => {
    expect(CUSTOM_INPUT_KINDS.map((item) => item.kind)).toEqual(["text", "image", "number"]);
    expect(customInputKindLabel("number")).toBe("数字");
  });
});
