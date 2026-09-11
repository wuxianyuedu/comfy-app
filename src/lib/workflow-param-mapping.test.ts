import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  applyParamMapping,
  autoMapEntries,
  buildParamEntries,
  buildSourceOverrides,
  classifyPin,
  parseParamMapping,
  resolveMapping,
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

describe("resolveMapping — 手工线优先于自动映射", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
  };

  it("默认（无手工线）用自动映射", () => {
    const entries = buildParamEntries(io);
    const resolved = resolveMapping(entries, io, null);
    expect(resolved[entries[0]!.id]).toBe("5::widget::width");
  });

  it("手工线覆盖自动映射", () => {
    const entries = buildParamEntries(io);
    const resolved = resolveMapping(entries, io, {
      manual: { [entries[0]!.id]: "5::widget::resolution" },
    });
    expect(resolved[entries[0]!.id]).toBe("5::widget::resolution");
  });

  it("按模式的手工线只在该模式下生效", () => {
    const entries = buildParamEntries(io);
    const mapping = { manualByMode: { [entries[0]!.id]: { I2I: "5::widget::resolution" } } };
    expect(resolveMapping(entries, io, mapping, "I2I")[entries[0]!.id]).toBe(
      "5::widget::resolution"
    );
    expect(resolveMapping(entries, io, mapping, "T2I")[entries[0]!.id]).toBe("5::widget::width");
  });

  it("按模式的手工线与通用线可并存，模式线优先", () => {
    const entries = buildParamEntries(io);
    const mapping = {
      manual: { [entries[0]!.id]: "5::widget::width" },
      manualByMode: { [entries[0]!.id]: { I2I: "5::widget::resolution" } },
    };
    expect(resolveMapping(entries, io, mapping, "I2I")[entries[0]!.id]).toBe(
      "5::widget::resolution"
    );
    expect(resolveMapping(entries, io, mapping, "T2I")[entries[0]!.id]).toBe("5::widget::width");
  });

  it("某模式显式断开时该模式回落为「未连线」，其它模式不受影响", () => {
    const entries = buildParamEntries(io);
    const mapping = { manualByMode: { [entries[0]!.id]: { I2I: null } } };
    expect(resolveMapping(entries, io, mapping, "I2I")[entries[0]!.id]).toBeNull();
    expect(resolveMapping(entries, io, mapping, "T2I")[entries[0]!.id]).toBe("5::widget::width");
  });

  it("null 表示作者显式断开这条线", () => {
    const entries = buildParamEntries(io);
    const resolved = resolveMapping(entries, io, { manual: { [entries[0]!.id]: null } });
    expect(resolved[entries[0]!.id]).toBeNull();
  });
});

describe("parseParamMapping / serializeParamMapping", () => {
  it("往返：只写 source 命名空间，其余键原样保留", () => {
    const mapping = {
      manual: { "5|size-width": "5::widget::width" },
      manualByMode: { "5|size-width": { I2I: "5::widget::resolution" } },
    };
    const merged = serializeParamMapping(mapping, { positiveNode: "9" });
    expect(merged.positiveNode).toBe("9");
    /* 通用线与模式线分键存放：同名条目在两个键空间各有一份，互不覆盖。 */
    expect(merged.source).toEqual({
      "5|size-width": "5::widget::width",
      "mode:I2I": { "5|size-width": "5::widget::resolution" },
    });
    const parsed = parseParamMapping(merged);
    expect(parsed.manual).toEqual({ "5|size-width": "5::widget::width" });
    expect(parsed.manualByMode).toEqual({
      "5|size-width": { I2I: "5::widget::resolution" },
    });
    /* 往返之后 resolveMapping 必须仍然认得出来（曾经这里丢了按模式的线）。 */
    const entries = buildParamEntries({
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
    });
    const ioForRoundTrip: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
    };
    expect(resolveMapping(entries, ioForRoundTrip, parsed, "I2I")["5|size-width"]).toBe(
      "5::widget::resolution"
    );
  });

  it("畸形数据一律丢弃", () => {
    const parsed = parseParamMapping({
      source: {
        good: "ok",
        bad: 123,
        nested: null,
        /* 无 `mode:` 前缀的嵌套对象不是模式表 —— 丢弃（曾经被当成模式表读）。 */
        deep: { M1: "ok", M2: 5 },
        "mode:": { any: "x" },
        "mode:T2I": { a: "ok", b: null, c: 5 },
      },
    });
    expect(parsed.manual).toEqual({ good: "ok", nested: null });
    /* 模式表里的 5（数字）不是合法目标，丢弃；null 合法（= 该模式断开）。 */
    expect(parsed.manualByMode).toEqual({ a: { T2I: "ok" }, b: { T2I: null } });
    expect(parseParamMapping(null).manual).toEqual({});
    expect(parseParamMapping([1, 2]).manual).toEqual({});
  });

  it("某模式显式断开（null）能往返保存", () => {
    const merged = serializeParamMapping(
      { manualByMode: { "5|size-width": { I2I: null } } },
      {}
    );
    expect(parseParamMapping(merged).manualByMode).toEqual({ "5|size-width": { I2I: null } });
  });
});

describe("applyParamMapping — 运行期落值", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    "9::widget::text": pin("9", "text", { defaultValue: "built-in" }),
  };

  it("手工连线的对外参数：用户值只落到被连的端口，该节点其余默认值不掺进来", () => {
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: { manual: { "5|size-width": "5::widget::width", "5|other": null } },
      values: { "5|size-width": 1024 },
    });
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1024);
    /* 「5|other」也手工连过（断成 null），故该节点其余端口不再兜底。 */
    expect(inputs.some((item) => item.name === "steps")).toBe(false);
  });

  it("未连线的对外参数：按默认值兜底", () => {
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: null,
      values: {},
    });
    expect(inputs.find((item) => item.name === "text")?.value).toBe("built-in");
    expect(inputs.find((item) => item.name === "steps")?.value).toBe(20);
  });

  it("手工断开（null）的对外参数：用户值被如实记进 unmatched，不凭空落端口", () => {
    const entries = buildParamEntries(io);
    const sizeEntry = entries.find((entry) => entry.id === "5|size-width")!;
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: { manual: { [sizeEntry.id]: null, "5|other": null } },
      values: { "5|size-width": 1024 },
    });
    expect(unmatched).toContain("5|size-width");
    /* 「5|other」也手工断开了，所以不兜底；width 只有对手工线断开的节点才会回落默认值。 */
    expect(inputs.find((item) => item.name === "width")).toBeUndefined();
  });

  it("与旧行为对齐：无人手工连线时，默认值兜底 =「每个暴露 pin 都下发」", () => {
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
