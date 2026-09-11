import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  applyParamMapping,
  autoMapEntries,
  buildParamEntries,
  buildSourceOverrides,
  classifyPin,
  clearModeWiring,
  hasManualWiring,
  isDefaultMapping,
  parseParamMapping,
  resolveMapping,
  runtimeNodeId,
  serializeParamMapping,
} from "~/lib/workflow-param-mapping";

/** 造一个 IO 条目：默认都是可编辑 widget 输入。 */
function pin(
  nodeId: string,
  name: string,
  extra: Partial<WorkflowIOMap[string]> = {}
): WorkflowIOMap[string] {
  return {
    direction: "input",
    kind: "widget",
    nodeId,
    name,
    type: "STRING",
    ...extra,
  };
}

describe("classifyPin", () => {
  it("负面优先于正向、首尾帧优先于普通参考图", () => {
    expect(classifyPin(pin("1", "negative_prompt"))).toBe("negative");
    expect(classifyPin(pin("1", "positive_prompt"))).toBe("prompt");
    expect(classifyPin(pin("1", "first_frame", { type: "IMAGE" }))).toBe("first-frame");
    expect(classifyPin(pin("1", "last_frame", { type: "IMAGE" }))).toBe("last-frame");
    expect(classifyPin(pin("1", "ref_image", { type: "IMAGE" }))).toBe("reference-image");
  });

  it("尺寸类先于提示词判定（base_width 这类下划线命名也认）", () => {
    expect(classifyPin(pin("1", "base_width", { type: "INT" }))).toBe("size-width");
    expect(classifyPin(pin("1", "height", { type: "INT" }))).toBe("size-height");
    expect(classifyPin(pin("1", "aspect_ratio"))).toBe("size-aspect");
    expect(classifyPin(pin("1", "prompt_width_of_thing", { type: "INT" }))).toBe("prompt");
  });

  it("连线型端口与输出不算对外参数", () => {
    expect(classifyPin(pin("1", "model", { kind: "param", type: "MODEL" }))).toBe("other");
    expect(
      classifyPin({ direction: "output", kind: "output", nodeId: "1", name: "IMAGE" })
    ).toBe("other");
  });
});

describe("buildParamEntries", () => {
  it("按节点 + 分类归并：同一节点的多个端口 = 一个对外参数", () => {
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::height": pin("5", "height", { type: "INT", defaultValue: 512 }),
      "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
      "9::widget::text": pin("9", "text", { label: "正向提示词" }),
    };
    const entries = buildParamEntries(io);
    const width = entries.find((entry) => entry.id === "5|size-width");
    const height = entries.find((entry) => entry.id === "5|size-height");
    expect(width?.pins.map((item) => item.name)).toEqual(["width"]);
    expect(height?.pins.map((item) => item.name)).toEqual(["height"]);
    expect(entries.find((entry) => entry.id === "5|other")?.pins.map((item) => item.name)).toEqual(["steps"]);
    expect(entries.find((entry) => entry.id === "9|prompt")?.label).toBe("正向提示词");
  });
});

describe("autoMapEntries", () => {
  it("默认连线：命中的分类优先，未命中退回该节点第一个有默认值的标量口", () => {
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "9::widget::text": pin("9", "text", { type: "STRING", defaultValue: "hi" }),
      "9::widget::mystery": pin("9", "mystery", { type: "INT", defaultValue: 7 }),
    };
    const entries = buildParamEntries(io);
    const auto = autoMapEntries(entries, io);
    expect(auto["5|size-width"]).toBe("5::widget::width");
    /* 短文本（<40 字符）不算提示词，与 `mystery` 一起归进同节点的「参数」，
     * 自动映射取该分类里第一个有默认值的标量口。 */
    expect(auto["9|other"]).toBe("9::widget::text");
    expect(auto["9|other"]).toBeDefined();
  });

  it("长默认值的文本口（CLIPTextEncode 的 text）判为提示词", () => {
    const long = "a very long positive prompt describing the scene in detail";
    const io: WorkflowIOMap = { "9::widget::text": pin("9", "text", { defaultValue: long }) };
    const entries = buildParamEntries(io);
    expect(entries[0]?.cls).toBe("prompt");
    expect(autoMapEntries(entries, io)["9|prompt"]).toBe("9::widget::text");
  });

  it("连线型端口不可作为落点", () => {
    const io: WorkflowIOMap = {
      "5::widget::model": pin("5", "model", { kind: "param", type: "MODEL" }),
      "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    };
    const auto = autoMapEntries(buildParamEntries(io), io);
    expect(auto["5|other"]).toBe("5::widget::steps");
  });
});

describe("resolveMapping — 作者画的线优先于默认连线状态", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
  };
  const entries = buildParamEntries(io);
  const entryId = entries[0]!.id;

  it("没有作者画的线时用默认连线状态（自动映射）", () => {
    expect(resolveMapping(entries, io, null, "T2I")[entryId]).toBe("5::widget::width");
  });

  it("作者画的线覆盖默认连线状态", () => {
    const mapping = { manualByMode: { T2I: { [entryId]: "5::widget::resolution" } } };
    expect(resolveMapping(entries, io, mapping, "T2I")[entryId]).toBe("5::widget::resolution");
    /* 另一个模式回到默认连线状态 —— 线是按模式分开的。 */
    expect(resolveMapping(entries, io, mapping, "I2I")[entryId]).toBe("5::widget::width");
  });

  it("没有模式时一律用默认连线状态（不存在脱离模式的线）", () => {
    const mapping = { manualByMode: { T2I: { [entryId]: "5::widget::resolution" } } };
    expect(resolveMapping(entries, io, mapping, null)[entryId]).toBe("5::widget::width");
  });

  it("某模式下显式断开 → 该模式「未连线」，其它模式不受影响", () => {
    const mapping = { manualByMode: { I2I: { [entryId]: null } } };
    expect(resolveMapping(entries, io, mapping, "I2I")[entryId]).toBeNull();
    expect(resolveMapping(entries, io, mapping, "T2I")[entryId]).toBe("5::widget::width");
  });

  it("mapping.auto 可以显式带入默认连线状态（避免各层各算一遍）", () => {
    const resolved = resolveMapping(entries, null, { auto: { [entryId]: "5::widget::width" } }, "T2I");
    expect(resolved[entryId]).toBe("5::widget::width");
  });
});

describe("默认连线状态的判定与恢复默认", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
  };
  const entryId = buildParamEntries(io)[0]!.id;

  it("isDefaultMapping：没有该模式的线才是默认", () => {
    const mapping = { manualByMode: { T2I: { [entryId]: "5::widget::width" } } };
    expect(isDefaultMapping(mapping, entryId, "T2I")).toBe(false);
    expect(isDefaultMapping(mapping, entryId, "I2I")).toBe(true);
    /* 没有模式 = 不承认任何线 = 永远是默认。 */
    expect(isDefaultMapping(mapping, entryId, null)).toBe(true);
    expect(isDefaultMapping(null, entryId, "T2I")).toBe(true);
  });

  it("hasManualWiring：按模式统计作者改过的线", () => {
    const mapping = { manualByMode: { T2I: { [entryId]: null } } };
    expect(hasManualWiring(mapping, "T2I")).toBe(true);
    expect(hasManualWiring(mapping, "I2I")).toBe(false);
    expect(hasManualWiring(mapping, null)).toBe(false);
  });

  it("clearModeWiring：整模式清空，其余模式原样保留", () => {
    const mapping = {
      manualByMode: { T2I: { a: "x" }, I2I: { a: "y" } },
      labels: { k: "名字" },
    };
    const cleared = clearModeWiring(mapping, "T2I");
    expect(cleared.manualByMode).toEqual({ I2I: { a: "y" } });
    expect(cleared.labels).toEqual({ k: "名字" });
    /* 不改原对象。 */
    expect(mapping.manualByMode.T2I).toEqual({ a: "x" });
  });
});

describe("parseParamMapping / serializeParamMapping", () => {
  it("往返：只写 source 命名空间，其余键原样保留", () => {
    const mapping = { manualByMode: { I2I: { "5|size-width": "5::widget::resolution" } } };
    const merged = serializeParamMapping(mapping, { positiveNode: "9" });
    expect(merged.positiveNode).toBe("9");
    expect(merged.source).toEqual({
      "mode:I2I": { "5|size-width": "5::widget::resolution" },
    });
    const parsed = parseParamMapping(merged);
    expect(parsed.manualByMode).toEqual({ I2I: { "5|size-width": "5::widget::resolution" } });
    /* 往返之后 resolveMapping 必须仍然认得出来（曾经这里丢了按模式的线）。 */
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
    };
    const entries = buildParamEntries(io);
    expect(resolveMapping(entries, io, parsed, "I2I")["5|size-width"]).toBe(
      "5::widget::resolution"
    );
  });

  it("没有 `mode:` 前缀的键一律丢弃（通用手工线已取消）", () => {
    const parsed = parseParamMapping({
      source: {
        /* 历史形状的通用手工线 —— 没有生效语境，丢弃。 */
        "5|size-width": "5::widget::resolution",
        "5|other": null,
        bad: 123,
        deep: { M1: "ok" },
        "mode:": { any: "x" },
        "mode:T2I": { a: "ok", b: null, c: 5 },
      },
    });
    expect(parsed.manualByMode).toEqual({ T2I: { a: "ok", b: null } });
    expect(parseParamMapping(null).manualByMode).toEqual({});
    expect(parseParamMapping([1, 2]).manualByMode).toEqual({});
    expect(parseParamMapping({ source: [1, 2] }).manualByMode).toEqual({});
  });

  it("某模式显式断开（null）能往返保存", () => {
    const merged = serializeParamMapping(
      { manualByMode: { I2I: { "5|size-width": null } } },
      {}
    );
    expect(parseParamMapping(merged).manualByMode).toEqual({ I2I: { "5|size-width": null } });
  });

  it("空模式表不落库", () => {
    const merged = serializeParamMapping({ manualByMode: { I2I: {} } }, {});
    expect(merged.source).toEqual({});
  });
});

describe("applyParamMapping — 运行期落值", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    "9::widget::text": pin("9", "text", { defaultValue: "built-in" }),
  };

  it("作者画过线的对外参数：用户值只落到被连的端口，该节点其余默认值不掺进来", () => {
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: { manualByMode: { T2I: { "5|size-width": "5::widget::width", "5|other": null } } },
      values: { "5|size-width": 1024 },
      mode: "T2I",
    });
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1024);
    /* 「5|other」也画过线（断成 null），故该节点其余端口不再兜底。 */
    expect(inputs.some((item) => item.name === "steps")).toBe(false);
  });

  it("没有线的对外参数：按默认值兜底", () => {
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({ io, entries, mapping: null, values: {} });
    expect(inputs.find((item) => item.name === "text")?.value).toBe("built-in");
    expect(inputs.find((item) => item.name === "steps")?.value).toBe(20);
  });

  it("显式断开（null）的对外参数：用户值如实录进 unmatched，不凭空落端口", () => {
    const entries = buildParamEntries(io);
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: { manualByMode: { T2I: { "5|size-width": null, "5|other": null } } },
      values: { "5|size-width": 1024 },
      mode: "T2I",
    });
    expect(unmatched).toContain("5|size-width");
    expect(inputs.find((item) => item.name === "width")).toBeUndefined();
  });

  it("另一模式的线不影响本模式（模式线只在该模式生效）", () => {
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: { manualByMode: { I2I: { "5|size-width": null, "5|other": null } } },
      values: { "5|size-width": 1024 },
      mode: "T2I",
    });
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1024);
  });

  it("与旧行为对齐：全默认连线状态下的默认值兜底 =「每个暴露 pin 都下发」", () => {
    const { inputs } = applyParamMapping({
      io,
      entries: buildParamEntries(io),
      mapping: null,
      values: {},
    });
    expect(inputs.map((item) => `${item.nodeId}.${item.name}`).sort()).toEqual([
      "5.steps",
      "5.width",
      "9.text",
    ]);
  });
});

describe("buildSourceOverrides", () => {
  it("产出「对外参数 id → 目标 ioKey」的覆盖表（含 null 断开）", () => {
    const io: WorkflowIOMap = { "5::widget::width": pin("5", "width", { type: "INT" }) };
    const overrides = buildSourceOverrides(buildParamEntries(io), io, null);
    expect(overrides["5|size-width"]).toBe("5::widget::width");
  });
});

describe("runtimeNodeId — 运行期节点 id 还原", () => {
  it("顶层勾选原样下发", () => {
    expect(runtimeNodeId({ nodeId: "24" })).toBe("24");
  });

  it("子图内部勾选用宿主 id 拼成 comfy-cli 展开后的 `host:inner`", () => {
    expect(runtimeNodeId({ nodeId: "1670", hostNodeId: "4" })).toBe("4:1670");
    expect(runtimeNodeId({ nodeId: "1670", hostNodeId: "4:5" })).toBe("4:5:1670");
  });

  it("已经是拼接形式（旧数据）时不重复拼", () => {
    expect(runtimeNodeId({ nodeId: "4:1670", hostNodeId: "4" })).toBe("4:1670");
  });
});

describe("applyParamMapping — 子图内部条目的运行期节点 id", () => {
  const innerIo: WorkflowIOMap = {
    "1670::widget::value": pin("1670", "value", {
      type: "INT",
      defaultValue: 1,
      hostNodeId: "4",
    }),
  };

  it("值下发时带上宿主前缀，运行期才能落到 `4:1670`", () => {
    const entries = buildParamEntries(innerIo);
    const { inputs } = applyParamMapping({
      io: innerIo,
      entries,
      mapping: null,
      values: { "1670|other": 33 },
    });
    expect(inputs).toEqual([{ nodeId: "4:1670", name: "value", value: 33 }]);
  });
});
