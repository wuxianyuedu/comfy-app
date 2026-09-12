/* 工作流库画布的对外参数归属派生（纯函数）—— ISSUE #355
 *
 * 库详情要能回答两件事，且都能与编辑器对上：
 *   ① 每个对外参数由哪些端口组成（卡片列）；
 *   ② 宿主卡片里被落到的那一行属于哪个对外参数（行尾徽标）。
 * 这里只测派生规则（与 paramMap 同源、按模式归属）与「端口键 → 参数名」的反查。
 *
 * 另测只读映射连线（卡片圆点 → 宿主行）：`wires` 与 `resolved` / 编辑器同一
 * 份事实源，未连线与显式断开都不给线。
 */

import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import {
  deriveLibraryParamCards,
  resolveTargetName,
} from "./workflow-library-param-cards";

const io: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "positive_prompt",
    label: "提示词",
    type: "STRING",
    defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "width",
    label: "宽度",
    type: "INT",
    defaultValue: 512,
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "height",
    label: "高度",
    type: "INT",
    defaultValue: 512,
  },
};

/* 库内卡片列与编辑器同一份契约条目（按模式），故这里也带上模式。 */
const entries = buildParamEntries(io, undefined, { mode: "T2I" });
const promptEntry = entries.find((entry) => entry.id === "prompt")!;
const sizeEntry = entries.find((entry) => entry.id === "size")!;

describe("deriveLibraryParamCards", () => {
  it("没有作者落点覆盖时，resolved 就是自动判定出来的落点", () => {
    const { entries: derived, resolved } = deriveLibraryParamCards({
      io,
      paramMap: {},
      mode: "T2I",
    });
    /* 契约口径（文生图）：提示词 + 尺寸 —— 与具体工作流无关，「宽度/高度」这类
     * 同一语义的端口不再各占一张卡。 */
    expect(derived.map((entry) => entry.id)).toEqual(["prompt", "size"]);
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
    expect(resolved[sizeEntry.id]).toBe("5::widget::width");
  });

  it("作者改过的落点优先于自动判定", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("作者显式断开的条目不落任何一行，也不会被自动判定复活", () => {
    const { resolved, ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBeNull();
    expect(ownersByPin["9::widget::text"]).toBeUndefined();
  });

  it("别的模式的落点不影响当前模式", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:I2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("没有模式时不承认任何作者落点，但自动判定照常呈现", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: null,
    });
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("ownersByPin 把每个落点行映到对外参数名", () => {
    const { ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: {},
      mode: "T2I",
    });
    expect(ownersByPin["9::widget::text"]).toBe(promptEntry.label);
    expect(ownersByPin["5::widget::width"]).toBe(sizeEntry.label);
    /* 没有对外参数声称的行不标徽标 —— 表里直接没有这个键。 */
    expect(ownersByPin["不存在的端口"]).toBeUndefined();
  });

  it("两个对外参数落到同一行时，徽标只归第一个条目（同一行不重复标）", () => {
    const { ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            /* 尺寸与提示词被作者都落到同一行 —— 只保留先出现的那个。 */
            [sizeEntry.id]: "9::widget::text",
            [promptEntry.id]: "9::widget::text",
          },
        },
      },
      mode: "T2I",
    });
    expect(ownersByPin["9::widget::text"]).toBe(promptEntry.label);
  });

  it("卡片头是契约里的统一参数名，不跟着工作流里的端口名走", () => {
    /* 这是本期口径：对外参数**只跟模式有关**，与具体工作流无关。工作流把提示词
     * 口叫 `positive_prompt` / `value_1` / `text` 都不影响卡片头 ——「提示词」就是
     * 「提示词」。工作流只决定它落到哪一行端口（`ownersByPin` 给出那一行）。 */
    const renamedIO: WorkflowIOMap = {
      ...io,
      "9::widget::text": { ...io["9::widget::text"]!, label: "画面描述" },
    };
    const withRename = deriveLibraryParamCards({
      io: renamedIO,
      paramMap: {},
      mode: "T2I",
    });
    const plain = deriveLibraryParamCards({ io, paramMap: {}, mode: "T2I" });
    expect(plain.entries.map((entry) => entry.label)).toEqual([
      "提示词",
      "尺寸",
    ]);
    expect(withRename.entries.map((entry) => entry.label)).toEqual([
      "提示词",
      "尺寸",
    ]);
    expect(withRename.ownersByPin["9::widget::text"]).toBe("提示词");
  });

  it("畸形 paramMap 不炸（数组 / 非对象 / 缺 source）", () => {
    for (const bad of [{ source: [] }, { source: 1 }, [], null, undefined]) {
      const { resolved } = deriveLibraryParamCards({
        io,
        paramMap: bad as Record<string, unknown>,
        mode: "T2I",
      });
      expect(resolved[promptEntry.id]).toBe("9::widget::text");
    }
  });

  it("每个落点给一条只读连线：卡片圆点 → 宿主行", () => {
    /* 圆点不给线就只是一颗装饰点：读者答不出「提示词这个口连到哪一行」。 */
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {},
      mode: "T2I",
    });
    expect(wires).toEqual(
      expect.arrayContaining([
        {
          entryId: promptEntry.id,
          targetIoKey: "9::widget::text",
          /* 线从**被落到的那颗圆点**出发：handle id = 端口名（库里按端口名找点）。 */
          handleId: "positive_prompt",
          grouped: false,
          manual: false,
        },
        {
          entryId: sizeEntry.id,
          targetIoKey: "5::widget::width",
          handleId: "width",
          grouped: false,
          manual: false,
        },
      ]),
    );
    expect(wires).toHaveLength(2);
  });

  it("作者改过的线标 manual（实线），自动判定的不标（虚线）", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } },
      },
      mode: "T2I",
    });
    expect(wires.find((w) => w.entryId === promptEntry.id)!.manual).toBe(true);
    expect(wires.find((w) => w.entryId === sizeEntry.id)!.manual).toBe(false);
  });

  it("未连接 / 显式断开不留线（圆点悬空本身就在说没连上）", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(wires.some((w) => w.entryId === promptEntry.id)).toBe(false);
  });

  it("别的模式的线不影响当前模式的连线", () => {
    const { wires } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:I2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(wires.some((w) => w.entryId === promptEntry.id)).toBe(true);
  });

  it("没有对外参数时条目为空（视图据此不渲染卡片列）", () => {
    const { entries: derived } = deriveLibraryParamCards({
      io: {},
      paramMap: {},
      mode: "T2I",
    });
    expect(derived).toHaveLength(0);
  });
});

describe("resolveTargetName", () => {
  it("端口键经 io 反查出参数名，不切分键名", () => {
    /* 端口名本身可能含 `::` —— 切分必然取错，只能反查。 */
    const tricky: WorkflowIOMap = {
      "1::widget::a::b": {
        direction: "input",
        kind: "widget",
        nodeId: "1",
        name: "a::b",
        type: "STRING",
        defaultValue: "x",
      },
    };
    expect(resolveTargetName(tricky, "1::widget::a::b")).toBe("a::b");
  });

  it("空落点 / 查不到的端口一律 null", () => {
    expect(resolveTargetName(io, null)).toBeNull();
    expect(resolveTargetName(io, "不存在")).toBeNull();
    expect(resolveTargetName(null, "9::widget::text")).toBeNull();
  });
});
