// 历史详情弹窗的派生规则单测：纯函数，无需 render、无需网络。
// 这些规则原先内联在 JSX 的 IIFE 里，改一行没人知道有没有回归。
//
// 本次整理的三条口径都压在这里：**按来源分块**（工坊 / 工作流）、
// **参数名走工作流 IO 的作者标签**、**不再有独立提示词块与生成参数卡**。

import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";

import {
  deriveTaskOrigin,
  deriveWorkflowParams,
  deriveWorkshopParams,
  kvValueText,
  resolveParamLabel,
  taskWorkflowId,
  workflowInputsOf,
} from "./history-detail-derive";
import type { TaskDetail } from "./history-types";

/** 只造测试关心的字段：TaskDetail 很大，其余字段用 unknown 兜。 */
function makeDetail(
  params: unknown,
  extra: Partial<TaskDetail> = {},
): TaskDetail {
  return { id: "t-1", params, images: [], ...extra } as unknown as TaskDetail;
}

/** 造一份带作者标签的 IO 表（键是 ioKey：`<nodeId>::widget::<name>`）。 */
function io(
  ...entries: Array<[nodeId: string, name: string, label?: string]>
): WorkflowIOMap {
  const map: WorkflowIOMap = {};
  for (const [nodeId, name, label] of entries) {
    map[`${nodeId}::widget::${name}`] = {
      direction: "input",
      kind: "widget",
      nodeId,
      name,
      ...(label ? { label } : {}),
    };
  }
  return map;
}

describe("workflowInputsOf", () => {
  it("非数组回落为空数组", () => {
    expect(workflowInputsOf(makeDetail({ workflowInputs: "nope" }))).toEqual(
      [],
    );
    expect(workflowInputsOf(makeDetail(null))).toEqual([]);
  });
});

describe("taskWorkflowId", () => {
  it("取 params.workflow；非字符串 / 空串给 null（据此决定要不要查 IO）", () => {
    expect(taskWorkflowId(makeDetail({ workflow: "wf-1" }))).toBe("wf-1");
    expect(taskWorkflowId(makeDetail({ workflow: "   " }))).toBeNull();
    expect(taskWorkflowId(makeDetail({ workflow: 42 }))).toBeNull();
    expect(taskWorkflowId(makeDetail({}))).toBeNull();
  });
});

describe("deriveTaskOrigin", () => {
  it("工坊发起：顶层带对外值（提示词 / 反向 / 首尾帧 / 帧数）", () => {
    expect(
      deriveTaskOrigin(makeDetail({ workflow: "w", prompt: "少女" })),
    ).toBe("workshop");
    expect(deriveTaskOrigin(makeDetail({ frames: 81 }))).toBe("workshop");
    expect(deriveTaskOrigin(makeDetail({ firstFrame: "a.png" }))).toBe(
      "workshop",
    );
  });

  it("工作流直接发起：只有 workflow + workflowInputs（库内就地运行 / 画布节点）", () => {
    expect(
      deriveTaskOrigin(
        makeDetail({
          workflow: "w",
          workflowInputs: [{ nodeId: "3", name: "text", value: "x" }],
        }),
      ),
    ).toBe("workflow");
    expect(
      deriveTaskOrigin(makeDetail({ workflow: "w", projectId: "p-1" })),
    ).toBe("workflow");
  });

  it("空白值不算「有」（空串 / null 不会把任务误判成工坊）", () => {
    expect(deriveTaskOrigin(makeDetail({ prompt: "", negative: null }))).toBe(
      "workflow",
    );
  });
});

describe("deriveWorkshopParams", () => {
  it("T2I：按契约列出提示词 / 负向提示词 / 尺寸三个口（空值也占位）", () => {
    const detail = makeDetail({
      workflow: "w",
      prompt: "少女",
      workflowInputs: [
        { nodeId: "23", name: "aspect_ratio", value: "3:4" },
        { nodeId: "24", name: "megapixels", value: 1 },
        { nodeId: "25", name: "multiple", value: 64 },
      ],
    });
    const rows = deriveWorkshopParams(detail, "T2I", null, null);
    expect(rows.map((r) => r.id)).toEqual(["prompt", "negative", "size"]);
    expect(rows[0]?.value).toBe("少女");
    expect(rows[1]?.value).toBeUndefined(); // 没给负向 → 仍占位、value undefined
    expect(String(rows[2]?.value)).toContain("3:4"); // 尺寸从 workflowInputs 聚合
  });

  it("负向提示词有值时如实显示", () => {
    const rows = deriveWorkshopParams(
      makeDetail({ prompt: "a", negative: "blurry" }),
      "T2I",
      null,
      null,
    );
    expect(rows.find((r) => r.id === "negative")?.value).toBe("blurry");
  });

  it("用户改过的模式契约优先于内置默认", () => {
    const contracts = [
      { mode: "T2I", inputs: ["prompt", "size"], output: "image" },
    ] as unknown as Parameters<typeof deriveWorkshopParams>[2];
    const rows = deriveWorkshopParams(
      makeDetail({ prompt: "x" }),
      "T2I",
      contracts,
      null,
    );
    expect(rows.map((r) => r.id)).toEqual(["prompt", "size"]);
  });

  it("模式为空时回落内置默认契约（仍列出口，不返回空）", () => {
    const rows = deriveWorkshopParams(
      makeDetail({ workflow: "w" }),
      null,
      null,
      null,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("resolveParamLabel", () => {
  it("按 nodeId::widget::name 精确命中作者标签", () => {
    expect(
      resolveParamLabel(
        { nodeId: "23", name: "aspect_ratio" },
        io(["23", "aspect_ratio", "宽高比"]),
      ),
    ).toBe("宽高比");
  });

  it("节点 id 对不上时按 pin 名找（子图里用的是 host:inner 形态）", () => {
    expect(
      resolveParamLabel(
        { nodeId: "5:23", name: "aspect_ratio" },
        io(["23", "aspect_ratio", "宽高比"]),
      ),
    ).toBe("宽高比");
  });

  it("查不到标签 / 没有 IO 表时如实回落 pin 名（不编）", () => {
    expect(
      resolveParamLabel(
        { nodeId: "23", name: "text" },
        io(["23", "aspect_ratio", "宽高比"]),
      ),
    ).toBe("text");
    expect(resolveParamLabel({ name: "text" }, null)).toBe("text");
    expect(
      resolveParamLabel({ nodeId: "23", name: "text" }, io(["23", "text"])),
    ).toBe("text");
  });
});

describe("deriveWorkflowParams", () => {
  it("展示名走作者标签，pin 名留在 name 里（悬停提示要用）", () => {
    const detail = makeDetail({
      workflowInputs: [
        { nodeId: "23", name: "aspect_ratio", value: "3:4" },
        { nodeId: "7", name: "text", value: "少女" },
      ],
    });
    const { rows } = deriveWorkflowParams(
      detail,
      io(["23", "aspect_ratio", "宽高比"]),
    );
    expect(rows.map((row) => row.label)).toEqual(["宽高比", "text"]);
    expect(rows[0]!.name).toBe("aspect_ratio");
  });

  it("不再过滤 seed / steps 这类键（过滤是为了躲开已删除的生成参数卡）", () => {
    const detail = makeDetail({
      workflowInputs: [
        { nodeId: "3", name: "seed", value: 317185474948100 },
        { nodeId: "4", name: "prefix", value: "a photo of" },
      ],
    });
    expect(
      deriveWorkflowParams(detail, null).rows.map((row) => row.name),
    ).toEqual(["seed", "prefix"]);
  });

  it("顶层条目排除 workflowInputs 本身", () => {
    const detail = makeDetail({ lora: "x.safetensors", workflowInputs: [] });
    expect(deriveWorkflowParams(detail, null).topLevelEntries).toEqual([
      ["lora", "x.safetensors"],
    ]);
  });

  it("无参数时 hasAny 为 false（视图不渲染空参数区块）", () => {
    expect(deriveWorkflowParams(makeDetail({}), null).hasAny).toBe(false);
  });

  it("只有顶层条目也算 hasAny（原始 JSON 折叠要显示得出来）", () => {
    expect(
      deriveWorkflowParams(makeDetail({ runtime: { seed: 1 } }), null).hasAny,
    ).toBe(true);
  });
});

describe("kvValueText", () => {
  it("标量直接字符串化，数组 / 对象走 JSON", () => {
    expect(kvValueText("x")).toBe("x");
    expect(kvValueText(3)).toBe("3");
    expect(kvValueText([1, 2])).toBe("[1,2]");
    expect(kvValueText({ a: 1 })).toBe('{"a":1}');
  });
});
