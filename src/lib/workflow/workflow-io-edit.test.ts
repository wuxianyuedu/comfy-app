import { describe, expect, it } from "vitest";

import type { WorkflowIOEntry } from "./workflow-io-types";
import { clearModeOverrides, withIOLabel, withModeOverride } from "./workflow-io-edit";

function entry(overrides: Partial<WorkflowIOEntry> = {}): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "widget",
    name: "text",
    nodeId: "1",
    ...overrides,
  };
}

const KEY = "1::widget::text";

describe("withModeOverride", () => {
  it("写入当前模式的覆盖项，保留其它模式", () => {
    const io = { [KEY]: entry({ modeOverrides: { t2i: { visible: false } } }) };
    const next = withModeOverride(io, KEY, "i2v", { defaultValue: 42 });
    expect(next[KEY]?.modeOverrides).toEqual({
      t2i: { visible: false },
      i2v: { defaultValue: 42 },
    });
    expect(io[KEY]?.modeOverrides).toEqual({ t2i: { visible: false } });
  });

  it("同一模式的多次写入按字段合并，不互相抹掉", () => {
    const first = withModeOverride({ [KEY]: entry() }, KEY, "i2v", { visible: false });
    const second = withModeOverride(first, KEY, "i2v", { defaultValue: 7 });
    expect(second[KEY]?.modeOverrides?.i2v).toEqual({ visible: false, defaultValue: 7 });
  });

  it("patch=null 删掉该模式覆盖；覆盖层空了把字段摘掉", () => {
    const io = { [KEY]: entry({ modeOverrides: { i2v: { visible: false } } }) };
    const next = withModeOverride(io, KEY, "i2v", null);
    expect(next[KEY]?.modeOverrides).toBeUndefined();
  });

  it("键不存在 / 模式为空 / 删一个不存在的模式：原样返回同一引用", () => {
    const io = { [KEY]: entry() };
    expect(withModeOverride(io, "missing", "i2v", { visible: false })).toBe(io);
    expect(withModeOverride(io, KEY, "", { visible: false })).toBe(io);
    expect(withModeOverride(io, KEY, "i2v", null)).toBe(io);
  });
});

describe("clearModeOverrides", () => {
  it("清掉所有条目在给定模式下的覆盖，其它模式与其它字段不动", () => {
    const io = {
      [KEY]: entry({ modeOverrides: { i2v: { visible: false }, t2i: { required: true } } }),
      "2::widget::seed": entry({
        name: "seed",
        nodeId: "2",
        modeOverrides: { i2v: { defaultValue: 1 } },
      }),
    };
    const next = clearModeOverrides(io, "i2v");
    expect(next[KEY]?.modeOverrides).toEqual({ t2i: { required: true } });
    expect(next["2::widget::seed"]?.modeOverrides).toBeUndefined();
  });

  it("没有任何命中时返回同一引用（调用方可跳过落库）", () => {
    const io = { [KEY]: entry({ modeOverrides: { t2i: { visible: false } } }) };
    expect(clearModeOverrides(io, "i2v")).toBe(io);
  });
});

describe("withIOLabel", () => {
  it("写入作者重命名；空串撤销（显示名回到富化链）", () => {
    const written = withIOLabel({ [KEY]: entry() }, KEY, "  正向提示词  ");
    expect(written[KEY]?.label).toBe("正向提示词");
    expect(withIOLabel(written, KEY, "  ")[KEY]?.label).toBeUndefined();
  });

  it("键不存在 / 值没变：原样返回同一引用", () => {
    const io = { [KEY]: entry({ label: "提示词" }) };
    expect(withIOLabel(io, "missing", "新名")).toBe(io);
    expect(withIOLabel(io, KEY, "提示词")).toBe(io);
  });
});
