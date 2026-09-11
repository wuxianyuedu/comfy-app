/* 工作流库画布的对外参数归属派生（纯函数）—— ISSUE #355
 *
 * 库详情要能回答两件事，且都能与编辑器对上：
 *   ① 每个对外参数由哪些端口组成（卡片列）；
 *   ② 宿主卡片里被落到的那一行属于哪个对外参数（行尾徽标）。
 * 这里只测派生规则（与 paramMap 同源、按模式归属）与「端口键 → 参数名」的反查。
 */

import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import { deriveLibraryParamCards, resolveTargetName } from "./workflow-library-param-cards";

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

const entries = buildParamEntries(io);
const promptEntry = entries.find((entry) => entry.cls === "prompt")!;
const sizeEntry = entries.find((entry) => entry.cls === "size-height")!;

describe("deriveLibraryParamCards", () => {
  it("没有作者落点覆盖时，resolved 就是自动判定出来的落点", () => {
    const { entries: derived, resolved } = deriveLibraryParamCards({
      io,
      paramMap: {},
      mode: "T2I",
    });
    /* 提示词 1 条 + 分辨率节点上的宽度/高度 2 条（同一节点的同分类端口算一条）。 */
    expect(derived).toHaveLength(3);
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("作者改过的落点优先于自动判定", () => {
    const { resolved } = deriveLibraryParamCards({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: "9::widget::text" } } },
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
    const { ownersByPin } = deriveLibraryParamCards({ io, paramMap: {}, mode: "T2I" });
    expect(ownersByPin["9::widget::text"]).toBe(promptEntry.label);
    expect(ownersByPin["5::widget::height"]).toBe(sizeEntry.label);
    /* 没有对外参数声称的行不标徽标 —— 表里直接没有这个键。 */
    expect(ownersByPin["不存在的端口"]).toBeUndefined();
  });

  it("两个对外参数落到同一行时，徽标只归第一个条目（同一行不重复标）", () => {
    const widthEntry = entries.find((entry) => entry.cls === "size-width")!;
    const { ownersByPin } = deriveLibraryParamCards({
      io,
      paramMap: {
        source: {
          "mode:T2I": {
            /* 宽度与提示词被作者都落到同一行 —— 只保留先出现的那个。 */
            [widthEntry.id]: "9::widget::text",
            [promptEntry.id]: "9::widget::text",
          },
        },
      },
      mode: "T2I",
    });
    expect(ownersByPin["9::widget::text"]).toBe(promptEntry.label);
  });

  it("对外参数名用作者改过的那个（作者名随 IO 一起进来）", () => {
    /* 作者改名落在 workflowIO 条目上（IO 编辑里就地改名 → 落库），库内卡片头
     * 显示的就是同一个名字，不会退到分类默认名。 */
    const renamedIO: WorkflowIOMap = {
      ...io,
      "9::widget::text": { ...io["9::widget::text"]!, label: "画面描述" },
    };
    const { ownersByPin } = deriveLibraryParamCards({
      io: renamedIO,
      paramMap: {},
      mode: "T2I",
    });
    expect(ownersByPin["9::widget::text"]).toBe("画面描述");
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
