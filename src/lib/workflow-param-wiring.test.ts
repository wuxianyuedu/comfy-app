/* 对外参数映射的**编辑动作**（纯函数）—— ISSUE #355
 *
 * 库里也要能改连线（用户：「连线要能编辑，现在编辑不了」）。这里测三件事：
 *   ① 一次连线动作的合法性（有模式 + 落点真实存在）；
 *   ② 落库形状与编辑器逐字一致（`source.mode:<模式> = { <entryId>: ioKey }`）；
 *   ③ 拖线落点的命中解析（与画布闸门同一套判据：只有画得出来的行才落得上）。
 */

import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import { parseParamMapping } from "~/lib/workflow-param-mapping";
import {
  applyWireEdit,
  canApplyWireEdit,
  clearWireEdit,
  hasWireEdit,
  resolveDropTarget,
} from "./workflow-param-wiring";

const io: WorkflowIOMap = {
  "5::widget::aspect_ratio": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "aspect_ratio",
    type: "COMBO",
    defaultValue: "16:9",
  },
  "5::widget::megapixels": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "megapixels",
    type: "FLOAT",
    defaultValue: 1,
  },
};

describe("canApplyWireEdit", () => {
  it("有模式且落点真实存在 → 受理", () => {
    expect(
      canApplyWireEdit(
        {
          entryId: "size-megapixels",
          ioKey: "5::widget::megapixels",
          mode: "T2I",
        },
        io,
      ),
    ).toBe(true);
  });

  it("没有模式 → 拒绝（落点覆盖必须归属一个模式）", () => {
    expect(
      canApplyWireEdit(
        {
          entryId: "size-megapixels",
          ioKey: "5::widget::megapixels",
          mode: null,
        },
        io,
      ),
    ).toBe(false);
  });

  it("落点不在 workflowIO 里 → 拒绝（否则画得出线、运行期落不到值）", () => {
    expect(
      canApplyWireEdit(
        { entryId: "size-megapixels", ioKey: "9::widget::不存在", mode: "T2I" },
        io,
      ),
    ).toBe(false);
  });

  it("显式断开只要有模式就受理（不需要落点存在）", () => {
    expect(
      canApplyWireEdit(
        { entryId: "size-megapixels", ioKey: null, mode: "T2I" },
        io,
      ),
    ).toBe(true);
  });
});

describe("applyWireEdit", () => {
  it("写入形状与编辑器一致：source.mode:<模式> = { <entryId>: ioKey }", () => {
    const next = applyWireEdit(
      {},
      {
        entryId: "size-megapixels",
        ioKey: "5::widget::megapixels",
        mode: "T2I",
      },
    );
    expect(parseParamMapping(next).manualByMode).toEqual({
      T2I: { "size-megapixels": "5::widget::megapixels" },
    });
  });

  it("不同模式互不影响（各写各的那一份）", () => {
    const first = applyWireEdit(
      {},
      { entryId: "size-aspect", ioKey: "5::widget::aspect_ratio", mode: "T2I" },
    );
    const second = applyWireEdit(first, {
      entryId: "size-megapixels",
      ioKey: "5::widget::megapixels",
      mode: "I2I",
    });
    expect(parseParamMapping(second).manualByMode).toEqual({
      T2I: { "size-aspect": "5::widget::aspect_ratio" },
      I2I: { "size-megapixels": "5::widget::megapixels" },
    });
  });

  it("显式断开也落库（null）——不落的话刷新后会被自动判定复活", () => {
    const next = applyWireEdit(
      {},
      { entryId: "prompt", ioKey: null, mode: "T2I" },
    );
    expect(parseParamMapping(next).manualByMode).toEqual({
      T2I: { prompt: null },
    });
  });

  it("paramMap 里其它命名空间原样保留（不改别人写进去的东西）", () => {
    const next = applyWireEdit(
      {
        positiveNode: "9",
        source: { "mode:OTHER": { prompt: "9::widget::text" } },
      },
      {
        entryId: "size-megapixels",
        ioKey: "5::widget::megapixels",
        mode: "T2I",
      },
    );
    expect(next.positiveNode).toBe("9");
    expect(parseParamMapping(next).manualByMode).toEqual({
      OTHER: { prompt: "9::widget::text" },
      T2I: { "size-megapixels": "5::widget::megapixels" },
    });
  });

  it("连续改两次同一口子 → 只留最后一次（改落点不是叠加）", () => {
    const first = applyWireEdit(
      {},
      { entryId: "size-aspect", ioKey: "5::widget::aspect_ratio", mode: "T2I" },
    );
    const second = applyWireEdit(first, {
      entryId: "size-aspect",
      ioKey: "5::widget::megapixels",
      mode: "T2I",
    });
    expect(parseParamMapping(second).manualByMode).toEqual({
      T2I: { "size-aspect": "5::widget::megapixels" },
    });
  });
});

describe("hasWireEdit / clearWireEdit", () => {
  it("作者改过（含显式断开）算改过", () => {
    const changed = applyWireEdit(
      {},
      {
        entryId: "size-megapixels",
        ioKey: "5::widget::megapixels",
        mode: "T2I",
      },
    );
    expect(hasWireEdit(changed, "size-megapixels", "T2I")).toBe(true);
    const off = applyWireEdit(
      {},
      { entryId: "size-megapixels", ioKey: null, mode: "T2I" },
    );
    expect(hasWireEdit(off, "size-megapixels", "T2I")).toBe(true);
  });

  it("没有模式时永远不算改过（没有可查的命名空间）", () => {
    expect(hasWireEdit({}, "size-megapixels", null)).toBe(false);
  });

  it("恢复默认把该口的手工线整条清掉，别的口与别的模式保留", () => {
    const base = applyWireEdit(
      applyWireEdit(
        {},
        {
          entryId: "size-megapixels",
          ioKey: "5::widget::megapixels",
          mode: "T2I",
        },
      ),
      { entryId: "prompt", ioKey: null, mode: "T2I" },
    );
    const cleared = clearWireEdit(base, "size-megapixels", "T2I");
    expect(hasWireEdit(cleared, "size-megapixels", "T2I")).toBe(false);
    expect(hasWireEdit(cleared, "prompt", "T2I")).toBe(true);
  });

  it("清掉最后一个口子时该模式的整条覆盖消失（不留空壳）", () => {
    const base = applyWireEdit(
      {},
      {
        entryId: "size-megapixels",
        ioKey: "5::widget::megapixels",
        mode: "T2I",
      },
    );
    const cleared = clearWireEdit(base, "size-megapixels", "T2I");
    expect(parseParamMapping(cleared).manualByMode).toEqual({});
  });
});

describe("resolveDropTarget", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    height,
  });

  it("落在行内 → 命中该行的 ioKey", () => {
    expect(
      resolveDropTarget({ x: 120, y: 40 }, [
        { ioKey: "5::widget::aspect_ratio", rect: rect(100, 30, 240, 30) },
      ]),
    ).toBe("5::widget::aspect_ratio");
  });

  it("落在空白处 → null（调用方据此不改动任何映射，不留悬空线）", () => {
    expect(
      resolveDropTarget({ x: 900, y: 900 }, [
        { ioKey: "5::widget::aspect_ratio", rect: rect(100, 30, 240, 30) },
      ]),
    ).toBeNull();
  });

  it("端点圆点比整行更精确：同时命中时取更小的矩形", () => {
    /* 圆点 12px 落在行（30px 高）之内，两个候选都命中 —— 必须选圆点，
     * 因为圆点才是「这一行出去的那个口」的精确位置。 */
    expect(
      resolveDropTarget({ x: 110, y: 40 }, [
        { ioKey: "5::widget::aspect_ratio", rect: rect(100, 30, 240, 30) },
        { ioKey: "5::widget::megapixels", rect: rect(104, 34, 12, 12) },
      ]),
    ).toBe("5::widget::megapixels");
  });

  it("容差内仍然受理（圆点只有 12px，光标略偏不该判失败）", () => {
    expect(
      resolveDropTarget({ x: 101, y: 41 }, [
        { ioKey: "5::widget::megapixels", rect: rect(104, 34, 12, 12) },
      ]),
    ).toBe("5::widget::megapixels");
  });

  it("整块矩形都没命中（height 0 的占位）→ null", () => {
    expect(
      resolveDropTarget({ x: 500, y: 500 }, [
        { ioKey: "a", rect: rect(0, 0, 0, 0) },
      ]),
    ).toBeNull();
  });
});
