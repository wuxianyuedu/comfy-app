/* 工作流库画布的派生规则（纯函数）—— ISSUE #355
 *
 * 库内画布与编辑器吃同一份映射模型：条目聚类 / 自动映射 / 按模式解析。这里锁住
 * 「模式线优先于默认线」「没有模式时不承认任何作者线」与参数节点/连线的组装。 */

import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import {
  buildLibraryParamEdges,
  deriveLibraryCanvas,
  resolveManualEntryIds,
} from "./workflow-library-canvas-config";

const io: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "positive_prompt",
    type: "STRING",
    defaultValue: "a very long positive prompt used by the workflow author",
  },
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "width",
    type: "INT",
    defaultValue: 512,
  },
};

const entries = buildParamEntries(io);
const promptEntry = entries.find((e) => e.cls === "prompt")!;

describe("deriveLibraryCanvas", () => {
  it("没有作者线时，resolved 就是自动探测出来的默认线", () => {
    const { entries: es, resolved } = deriveLibraryCanvas({ io, paramMap: {}, mode: "T2I" });
    expect(es).toHaveLength(2);
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("模式线优先于默认线", () => {
    const { resolved } = deriveLibraryCanvas({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    /* 作者显式断开 → null（不画线），不会被自动映射复活。 */
    expect(resolved[promptEntry.id]).toBeNull();
  });

  it("别的模式的线不影响当前模式", () => {
    const { resolved } = deriveLibraryCanvas({
      io,
      paramMap: { source: { "mode:I2I": { [promptEntry.id]: null } } },
      mode: "T2I",
    });
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });

  it("没有模式时不承认任何作者线", () => {
    const { resolved } = deriveLibraryCanvas({
      io,
      paramMap: { source: { "mode:T2I": { [promptEntry.id]: null } } },
      mode: null,
    });
    expect(resolved[promptEntry.id]).toBe("9::widget::text");
  });
});

describe("resolveManualEntryIds", () => {
  it("只取当前模式下的条目 id", () => {
    const ids = resolveManualEntryIds(
      { source: { "mode:T2I": { a: "x", b: null }, "mode:I2I": { c: "y" } } },
      "T2I"
    );
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("没有模式 / 畸形数据一律空集", () => {
    expect(resolveManualEntryIds({ source: { "mode:T2I": { a: "x" } } }, null).size).toBe(0);
    expect(resolveManualEntryIds({ source: [] }, "T2I").size).toBe(0);
    expect(resolveManualEntryIds(null, "T2I").size).toBe(0);
  });
});

describe("buildLibraryParamEdges", () => {
  it("连线只画有目标的条目，且库内只读（不可选/不可删）", () => {
    const { resolved } = deriveLibraryCanvas({ io, paramMap: {}, mode: "T2I" });
    const edges = buildLibraryParamEdges({ entries, resolved, isManual: () => false });
    expect(edges.length).toBe(2);
    for (const edge of edges) {
      expect(edge.selectable).toBe(false);
      expect(edge.deletable).toBe(false);
    }
  });

  it("目标为 null 的条目不画线", () => {
    const edges = buildLibraryParamEdges({
      entries,
      resolved: { [promptEntry.id]: null },
      isManual: () => false,
    });
    expect(edges.find((e) => e.id.includes(promptEntry.id))).toBeUndefined();
  });
});

