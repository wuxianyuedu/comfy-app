import { describe, expect, it } from "vitest";

import type { WorkflowIOEntry } from "./workflow-io-types";
import {
  clearModeOverrides,
  withIOGroupReordered,
  withIOReordered,
  withIOLabel,
  withModeOverride,
} from "./workflow-io-edit";

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

describe("withIOReordered（ISSUE #4073：IO 预览的参数顺序可调）", () => {
  const A = "1::widget::a";
  const B = "2::widget::b";
  const C = "3::widget::c";
  const io = { [A]: entry({ name: "a" }), [B]: entry({ name: "b" }), [C]: entry({ name: "c" }) };

  it("移到目标项之前 / 之后，其余键的原序不变", () => {
    const before = withIOReordered(io, C, A, "before");
    expect(Object.keys(before)).toEqual([C, A, B]);
    const after = withIOReordered(io, A, C, "after");
    expect(Object.keys(after)).toEqual([B, C, A]);
  });

  it("targetKey 为空 = 移到末尾；目标不存在也落到末尾", () => {
    expect(Object.keys(withIOReordered(io, A, null, "before"))).toEqual([B, C, A]);
    expect(Object.keys(withIOReordered(io, A, "missing", "before"))).toEqual([B, C, A]);
  });

  it("fromKey 不在表内 / 与目标相同：原样返回同一引用", () => {
    expect(withIOReordered(io, "missing", B, "before")).toBe(io);
    expect(withIOReordered(io, A, A, "before")).toBe(io);
  });

  /* ISSUE #4073 复审：原实现只改键序、不重编 displayOrder，而展示层
   * `splitWorkflowIO` 按 displayOrder 排序 —— 带旧 order 的条目松手就弹回。
   * 这条用例复现该缺陷：即便键序已改，按 displayOrder 读必须得到新顺序。 */
  it("条目带 displayOrder 时重编该组顺序，展示层按 displayOrder 读到新序", () => {
    const ordered = {
      [A]: entry({ name: "a", displayOrder: 1 }),
      [B]: entry({ name: "b", displayOrder: 2 }),
      [C]: entry({ name: "c", displayOrder: 3 }),
    };
    const next = withIOReordered(ordered, C, A, "before");
    /* 视觉序列 [c, a, b] → displayOrder 依次 1/2/3。 */
    expect(next[C]?.displayOrder).toBe(1);
    expect(next[A]?.displayOrder).toBe(2);
    expect(next[B]?.displayOrder).toBe(3);
    /* 模拟展示层：按 displayOrder 排序后应与视觉序列一致（不再弹回）。 */
    const shown = Object.entries(next)
      .sort((x, y) => (x[1].displayOrder ?? 0) - (y[1].displayOrder ?? 0))
      .map(([key]) => key);
    expect(shown).toEqual([C, A, B]);
  });

  it("只在被移动项所属组内重排：wire / output 组的 displayOrder 不受影响", () => {
    const mixed = {
      [A]: entry({ name: "a", displayOrder: 1 }),
      [B]: entry({ name: "b", displayOrder: 2 }),
      WIRE: entry({ name: "wire", kind: "param", displayOrder: 1 }),
      OUT: entry({ name: "out", direction: "output", displayOrder: 1 }),
    };
    const next = withIOReordered(mixed, B, A, "before");
    expect(next.WIRE?.displayOrder).toBe(1);
    expect(next.OUT?.displayOrder).toBe(1);
    expect(next[B]?.displayOrder).toBe(1);
    expect(next[A]?.displayOrder).toBe(2);
  });

  it("targetKey 落在别的组时，退化为移到本组末尾，不动其它组", () => {
    const mixed = {
      [A]: entry({ name: "a", displayOrder: 1 }),
      [B]: entry({ name: "b", displayOrder: 2 }),
      OUT: entry({ name: "out", direction: "output", displayOrder: 1 }),
    };
    const next = withIOReordered(mixed, A, "OUT", "before");
    expect(Object.keys(next).filter((k) => k !== "OUT")).toEqual([B, A]);
    expect(next[A]?.displayOrder).toBe(2);
    expect(next.OUT).toEqual(mixed.OUT);
  });
});

describe("withIOGroupReordered（ISSUE #4073 复审第 5 条：尺寸 / 视频组合块整体调序）", () => {
  const A = "1::widget::a";
  const W = "2::widget::width";
  const H = "3::widget::height";
  const B = "4::widget::b";
  const io = {
    [A]: entry({ name: "a", displayOrder: 1 }),
    [W]: entry({ name: "width", displayOrder: 2 }),
    [H]: entry({ name: "height", displayOrder: 3 }),
    [B]: entry({ name: "b", displayOrder: 4 }),
  };

  const shownOrder = (next: Record<string, WorkflowIOEntry>) =>
    Object.entries(next)
      .sort((x, y) => (x[1].displayOrder ?? 0) - (y[1].displayOrder ?? 0))
      .map(([key]) => key);

  it("尺寸块作为整体搬到目标之前，块内相对顺序不变、组号连续重编", () => {
    const next = withIOGroupReordered(io, [W, H], A, "before");
    expect(shownOrder(next)).toEqual([W, H, A, B]);
    expect(next[W]?.displayOrder).toBe(1);
    expect(next[H]?.displayOrder).toBe(2);
    expect(next[A]?.displayOrder).toBe(3);
    expect(next[B]?.displayOrder).toBe(4);
  });

  it("搬到目标之后：块不散开，displayOrder 与展示序一致", () => {
    const next = withIOGroupReordered(io, [H, W], B, "after");
    expect(shownOrder(next)).toEqual([A, B, H, W]);
    expect(next[H]?.displayOrder).toBe(3);
    expect(next[W]?.displayOrder).toBe(4);
  });

  it("targetKey 落在被搬块内部 / 传空键 / 跨组键：原样返回同一引用", () => {
    expect(withIOGroupReordered(io, [W, H], H, "before")).toBe(io);
    expect(withIOGroupReordered(io, [], A, "before")).toBe(io);
    const withOtherGroup = { ...io, OUT: entry({ name: "out", direction: "output" }) };
    expect(withIOGroupReordered(withOtherGroup, [W, "OUT"], A, "before")).toBe(withOtherGroup);
  });

  it("不重排其它组：wire / output 的 displayOrder 原样保留", () => {
    const mixed = {
      ...io,
      WIRE: entry({ name: "wire", kind: "param", displayOrder: 1 }),
      OUT: entry({ name: "out", direction: "output", displayOrder: 1 }),
    };
    const next = withIOGroupReordered(mixed, [W, H], A, "before");
    expect(next.WIRE).toEqual(mixed.WIRE);
    expect(next.OUT).toEqual(mixed.OUT);
    expect(shownOrder(next).filter((key) => key !== "WIRE" && key !== "OUT")).toEqual([W, H, A, B]);
  });
});
