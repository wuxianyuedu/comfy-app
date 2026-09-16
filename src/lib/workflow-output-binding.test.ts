/* 对外**输出**参数的落点覆盖（`paramMap.output.mode:<模式>`）—— ISSUE #355
 *
 * 用户口径：「右列的对外输出参数目前是只读（线自动连上、不能拖改）…需要可拖」
 * （例如临时把 `images` 指到别处）。这里钉住读写往返、默认回退与断开语义：
 * 输出的取值行覆盖与输入侧的 `source` **不是同一张表**，两边的读写互不影响。 */

import { describe, expect, it } from "vitest";

import {
  applyOutputBindingEdit,
  canApplyOutputBindingEdit,
  clearOutputBindingEdit,
  defaultOutputSource,
  hasManualOutputBinding,
  isDefaultOutputBinding,
  manualOutputSource,
  resolveOutputSource,
} from "./workflow-output-binding";
import type { WorkflowIOMap } from "./workflow-io-types";

const outputs = [
  { ioKey: "9::output::IMAGE", displayOrder: 0 },
  { ioKey: "9::output::MASK", displayOrder: 1 },
];

const io: WorkflowIOMap = {
  "9::output::IMAGE": {
    direction: "output",
    kind: "output",
    nodeId: "9",
    name: "images",
    type: "IMAGE",
  },
  "9::output::MASK": {
    direction: "output",
    kind: "output",
    nodeId: "9",
    name: "mask",
    type: "MASK",
  },
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    name: "text",
    type: "STRING",
  },
};

describe("默认落点", () => {
  it("取 displayOrder 最靠前的那一个输出行", () => {
    expect(defaultOutputSource(outputs)).toBe("9::output::IMAGE");
    expect(
      defaultOutputSource([
        { ioKey: "b", displayOrder: 2 },
        { ioKey: "a", displayOrder: 1 },
      ]),
    ).toBe("a");
  });

  it("一个输出都没有时为 null（卡片层不渲染）", () => {
    expect(defaultOutputSource([])).toBeNull();
  });

  it("只有排在第一位的那个输出是「默认落点」", () => {
    expect(isDefaultOutputBinding(outputs[0]!, outputs)).toBe(true);
    expect(isDefaultOutputBinding(outputs[1]!, outputs)).toBe(false);
  });
});

describe("读写往返", () => {
  it("写入后读回来是那个落点，且其它命名空间原样保留", () => {
    const next = applyOutputBindingEdit(
      {
        positiveNode: "9",
        source: { "mode:T2I": { prompt: "9::widget::text" } },
      },
      {
        outputIoKey: "9::output::MASK",
        ioKey: "9::output::IMAGE",
        mode: "T2I",
      },
    );
    expect(manualOutputSource(next, "9::output::MASK", "T2I")).toBe(
      "9::output::IMAGE",
    );
    /* 输入侧的 source 表不动 —— 两张表各管各的。 */
    expect(next.source).toEqual({ "mode:T2I": { prompt: "9::widget::text" } });
    expect(next.positiveNode).toBe("9");
  });

  it("断开落库为 null，读回来仍是「显式断开」（不会被默认落点复活）", () => {
    const next = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::IMAGE",
      ioKey: null,
      mode: "T2I",
    });
    expect(manualOutputSource(next, "9::output::IMAGE", "T2I")).toBeNull();
    expect(
      resolveOutputSource(next, outputs[0]!, outputs, "T2I", io),
    ).toBeNull();
  });

  it("没有模式时写入是空操作（覆盖必须归属一个模式）", () => {
    const base = { source: { "mode:T2I": {} } };
    expect(
      applyOutputBindingEdit(base, {
        outputIoKey: "9::output::IMAGE",
        ioKey: "9::output::MASK",
        mode: null,
      }),
    ).toEqual(base);
    /* 没有模式时也读不出任何手工线。 */
    expect(manualOutputSource(base, "9::output::IMAGE", null)).toBeUndefined();
    expect(hasManualOutputBinding(base, null)).toBe(false);
  });

  it("撤销只删这一个口，该模式下别的覆盖原样保留；删空后整条 mode 键消失", () => {
    let next = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::IMAGE",
      ioKey: "9::output::MASK",
      mode: "T2I",
    });
    next = applyOutputBindingEdit(next, {
      outputIoKey: "9::output::MASK",
      ioKey: "9::output::IMAGE",
      mode: "T2I",
    });
    const cleared = clearOutputBindingEdit(next, "9::output::IMAGE", "T2I");
    expect(
      manualOutputSource(cleared, "9::output::IMAGE", "T2I"),
    ).toBeUndefined();
    expect(manualOutputSource(cleared, "9::output::MASK", "T2I")).toBe(
      "9::output::IMAGE",
    );
    const empty = clearOutputBindingEdit(cleared, "9::output::MASK", "T2I");
    /* 整条 mode 表删空后连命名空间一起摘掉：落库形状不留下空壳。 */
    expect(empty.output).toBeUndefined();
  });
});

describe("落点解析", () => {
  it("没连过 → 默认落点（排在最前的输出行）", () => {
    expect(resolveOutputSource(null, outputs[0]!, outputs, "T2I", io)).toBe(
      "9::output::IMAGE",
    );
    /* 排在后面的输出没连过就是「悬空」—— 不给它硬凑一个来源。 */
    expect(
      resolveOutputSource(null, outputs[1]!, outputs, "T2I", io),
    ).toBeNull();
  });

  it("连到别的输出行 → 就是那一行", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::MASK",
      ioKey: "9::output::IMAGE",
      mode: "T2I",
    });
    expect(resolveOutputSource(paramMap, outputs[1]!, outputs, "T2I", io)).toBe(
      "9::output::IMAGE",
    );
  });

  it("落点已不存在（工作流改版）→ 悬空，不静默退回默认", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::MASK",
      ioKey: "9::output::GONE",
      mode: "T2I",
    });
    expect(
      resolveOutputSource(paramMap, outputs[1]!, outputs, "T2I", io),
    ).toBeNull();
  });

  it("别的模式的覆盖不影响当前模式", () => {
    const paramMap = applyOutputBindingEdit(null, {
      outputIoKey: "9::output::MASK",
      ioKey: "9::output::IMAGE",
      mode: "T2V",
    });
    expect(
      resolveOutputSource(paramMap, outputs[1]!, outputs, "T2I", io),
    ).toBeNull();
    expect(resolveOutputSource(paramMap, outputs[1]!, outputs, "T2V", io)).toBe(
      "9::output::IMAGE",
    );
  });

  it("畸形 paramMap（数组 / 数字 / 脏值）一律按「没连过」处理", () => {
    expect(manualOutputSource([], "9::output::IMAGE", "T2I")).toBeUndefined();
    expect(
      manualOutputSource({ output: 42 }, "9::output::IMAGE", "T2I"),
    ).toBeUndefined();
    expect(
      manualOutputSource(
        { output: { "mode:T2I": { "9::output::IMAGE": 7 } } },
        "9::output::IMAGE",
        "T2I",
      ),
    ).toBeUndefined();
  });
});

describe("可落库判定", () => {
  it("必须是真实存在的输出行；输入行 / 不存在的键一律拒绝", () => {
    expect(
      canApplyOutputBindingEdit({ ioKey: "9::output::IMAGE", mode: "T2I" }, io),
    ).toBe(true);
    expect(
      canApplyOutputBindingEdit({ ioKey: "9::widget::text", mode: "T2I" }, io),
    ).toBe(false);
    expect(
      canApplyOutputBindingEdit({ ioKey: "9::output::GONE", mode: "T2I" }, io),
    ).toBe(false);
  });

  it("断开只需要有模式", () => {
    expect(canApplyOutputBindingEdit({ ioKey: null, mode: "T2I" }, io)).toBe(
      true,
    );
    expect(canApplyOutputBindingEdit({ ioKey: null, mode: null }, io)).toBe(
      false,
    );
  });
});
