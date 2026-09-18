import { describe, it, expect } from "vitest";
import {
  isVisibleInMode,
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
      modes: { t2i: { required: false } },
    });
    expect(resolveEntryRequired(e, "t2i")).toBe(false);
  });

  it("指定 mode 但该模式无 required 覆盖时回退条目级", () => {
    const e = entry({ required: true, modes: { i2i: { visible: false } } });
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
      modes: { t2i: { seedMode: "decrement" } },
    });
    expect(resolveEntrySeedMode(e, "t2i")).toBe("decrement");
  });

  it("指定 mode 但该模式无 seedMode 覆盖时回退条目级", () => {
    const e = entry({ seedMode: "random", modes: { t2i: { visible: true } } });
    expect(resolveEntrySeedMode(e, "t2i")).toBe("random");
  });
});

describe("既有多模式解析保持兼容", () => {
  it("isVisibleInMode 模式覆盖优先，缺省可见", () => {
    const e = entry({ modes: { t2i: { visible: false } } });
    expect(isVisibleInMode(e, "t2i")).toBe(false);
    expect(isVisibleInMode(e, "i2i")).toBe(true);
    expect(isVisibleInMode(e)).toBe(true);
  });

  it("resolveEntryDefault 模式默认值 > 图内 defaultValue", () => {
    const e = entry({ defaultValue: 0, modes: { t2i: { defaultValue: 20 } } });
    expect(resolveEntryDefault(e, "t2i")).toBe(20);
    /* 没开模式（mode 为空）时不读模式覆盖 —— 模式覆盖只在模式语境里生效。 */
    expect(resolveEntryDefault(e)).toBe(0);
    expect(resolveEntryDefault(entry({ defaultValue: 5 }))).toBe(5);
  });

  it("模式覆盖为 null 不算覆盖（照旧回退图内默认值）", () => {
    /* `null` 表示不出一个「有意义的默认值」：放行只会把 null 下发给 ComfyUI。 */
    const e = entry({
      defaultValue: 7,
      modes: { t2i: { defaultValue: null } },
    });
    expect(resolveEntryDefault(e, "t2i")).toBe(7);
  });
});
