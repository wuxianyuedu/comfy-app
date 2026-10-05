import { describe, it, expect } from "vitest";
import {
  isVisibleInMode,
  parseWorkflowIOMap,
  resolveEntryDefault,
  resolveEntryRequired,
  resolveEntrySeedMode,
  type WorkflowIOEntry,
} from "./workflow-io-types";

function entry(partial?: Partial<WorkflowIOEntry>): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "seed",
    ...partial,
  };
}

describe("resolveEntryRequired — required 的模式覆盖两级回退", () => {
  it("无 mode 时回退到条目级 required", () => {
    expect(resolveEntryRequired(entry({ required: true }), null)).toBe(true);
    expect(resolveEntryRequired(entry({ required: false }))).toBe(false);
    expect(resolveEntryRequired(entry())).toBeUndefined();
  });

  it("指定 mode 且该模式有 required 覆盖时优先用覆盖值", () => {
    const e = entry({
      required: true,
      modeOverrides: { t2i: { required: false } },
    });
    expect(resolveEntryRequired(e, "t2i")).toBe(false);
  });

  it("指定 mode 但该模式无 required 覆盖时回退条目级", () => {
    const e = entry({
      required: true,
      modeOverrides: { i2i: { visible: false } },
    });
    expect(resolveEntryRequired(e, "i2i")).toBe(true);
  });
});

describe("resolveEntrySeedMode — seedMode 的模式覆盖两级回退", () => {
  it("无 mode 时回退条目级 seedMode", () => {
    expect(resolveEntrySeedMode(entry({ seedMode: "increment" }))).toBe(
      "increment",
    );
    expect(resolveEntrySeedMode(entry())).toBeUndefined();
  });

  it("指定 mode 且该模式有 seedMode 覆盖时优先用覆盖值", () => {
    const e = entry({
      seedMode: "fixed",
      modeOverrides: { t2i: { seedMode: "decrement" } },
    });
    expect(resolveEntrySeedMode(e, "t2i")).toBe("decrement");
  });

  it("指定 mode 但该模式无 seedMode 覆盖时回退条目级", () => {
    const e = entry({
      seedMode: "random",
      modeOverrides: { t2i: { visible: true } },
    });
    expect(resolveEntrySeedMode(e, "t2i")).toBe("random");
  });
});

describe("既有多模式解析保持兼容", () => {
  it("isVisibleInMode 模式覆盖优先，缺省可见", () => {
    const e = entry({ modeOverrides: { t2i: { visible: false } } });
    expect(isVisibleInMode(e, "t2i")).toBe(false);
    expect(isVisibleInMode(e, "i2i")).toBe(true);
    expect(isVisibleInMode(e)).toBe(true);
  });

  it("resolveEntryDefault 模式默认值 > 图内 defaultValue", () => {
    const e = entry({
      defaultValue: 0,
      modeOverrides: { t2i: { defaultValue: 20 } },
    });
    expect(resolveEntryDefault(e, "t2i")).toBe(20);
    /* 没开模式（mode 为空）时不读模式覆盖 —— 模式覆盖只在模式语境里生效。 */
    expect(resolveEntryDefault(e)).toBe(0);
    expect(resolveEntryDefault(entry({ defaultValue: 5 }))).toBe(5);
  });

  it("模式覆盖为 null 不算覆盖（照旧回退图内默认值）", () => {
    /* `null` 表示不出一个「有意义的默认值」：放行只会把 null 下发给 ComfyUI。 */
    const e = entry({
      defaultValue: 7,
      modeOverrides: { t2i: { defaultValue: null } },
    });
    expect(resolveEntryDefault(e, "t2i")).toBe(7);
  });
});

describe("parseWorkflowIOMap —— 列边界上的历史键归一", () => {
  /* 同一个 JSON 列里，`modes` 曾经是模式覆盖层的键名，而工作流级的模式清单也叫
   * `modes`（在另一张表的另一列）。两种读法必须收在这一处，否则下游会各按各的
   * 名字读、改一处永远漏一处 —— 那是 ISSUE #1501 收尾时删掉的第二处回退。 */
  it("历史行把覆盖层存在 `modes` 键下 → 归一到 `modeOverrides`", () => {
    const map = parseWorkflowIOMap({
      "94::widget::aspect_ratio": {
        direction: "input",
        kind: "widget",
        nodeId: "94",
        name: "aspect_ratio",
        modes: { T2I: { defaultValue: "16:9" } },
      },
    });
    expect(map["94::widget::aspect_ratio"]?.modeOverrides).toEqual({
      T2I: { defaultValue: "16:9" },
    });
    /* 旧键不留下：同一个覆盖层以两个名字在本列里往返，读的人分不清哪个是权威。 */
    expect(
      (map["94::widget::aspect_ratio"] as { modes?: unknown }).modes,
    ).toBeUndefined();
  });

  it("新键已在时不被旧键覆盖（只在新键缺失时回退）", () => {
    const map = parseWorkflowIOMap({
      k: {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "n",
        modeOverrides: { T2I: { defaultValue: "new" } },
        modes: { T2I: { defaultValue: "old" } },
      },
    });
    expect(map.k?.modeOverrides).toEqual({ T2I: { defaultValue: "new" } });
  });

  it("两个键都不在 / 形状不符 → 空表（下游按空表处理，不抛）", () => {
    const map = parseWorkflowIOMap({
      k: { direction: "input", kind: "widget", nodeId: "1", name: "n" },
    });
    expect(map.k?.modeOverrides).toBeUndefined();
    expect(parseWorkflowIOMap("not-an-object")).toEqual({});
  });
});
