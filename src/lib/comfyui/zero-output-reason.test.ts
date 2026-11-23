// describeZeroOutputFailure 的回归测试（ISSUE #4854）：
// 两阶段工作流的文本子图耗尽 max_length 后图像分支被开关节点静默短路，
// 收口失败原因要能归因到「输出分支未执行 + 哪个节点顶满了预算」，
// 而不是一句泛化的「无输出内容」。纯函数：证据不足时如实退回泛化文案。
import { describe, expect, it } from "vitest";

import { describeZeroOutputFailure } from "./zero-output-reason";

/** 测试用的最小日志行形状（与 TaskLogEntry 的必要字段同形）。 */
type TestLogEntry = {
  level: "info";
  msg: string;
  t: number;
};

/** 造一条 comfy-cli 原始事件日志行（与执行期写进任务日志的形状一致）。 */
function cliEvent(event: Record<string, unknown>): TestLogEntry {
  return { t: 1, level: "info", msg: `[comfy-cli 原始] ${JSON.stringify(event)}` };
}

/** #4854 现场：两阶段 minimax 工作流的执行图（节选）。 */
const MINIMAX_GRAPH = {
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "image_minimax_h3_image_edit" } },
  "34": { class_type: "TextGenerateV2", inputs: { max_length: 8196, thinking: true } },
  "38": { class_type: "KSampler", inputs: { steps: 6 } },
  "37": { class_type: "PreviewAny", inputs: {} },
};

describe("describeZeroOutputFailure（ISSUE #4854）", () => {
  it("复现现场：输出节点均未执行 + 文本节点顶满 max_length，归因点名两者", () => {
    const reason = describeZeroOutputFailure({
      outputs: { "37": { text: [""] } },
      executedWorkflow: MINIMAX_GRAPH,
      logs: [
        cliEvent({
          type: "executing",
          node: "34",
          title: "Generate Text",
          class_type: "TextGenerateV2",
        }),
        cliEvent({ type: "progress", node: "34", completed: 8196, total: 8196 }),
        cliEvent({ type: "executed", node: "34" }),
      ],
    });
    expect(reason).toContain("输出节点均未执行");
    expect(reason).toContain("9（SaveImage）");
    expect(reason).toContain("节点 34");
    expect(reason).toContain("8196/8196");
    expect(reason).toContain("max_length");
  });

  it("项目子图形态（host:inner 节点 id）同样点名", () => {
    const reason = describeZeroOutputFailure({
      outputs: {},
      executedWorkflow: {
        "70:9": { class_type: "SaveImage" },
        "70:34": { class_type: "TextGenerateV2" },
      },
      logs: [
        cliEvent({
          type: "executing",
          node: "70:34",
          title: "Generate Text",
          class_type: "TextGenerateV2",
        }),
        cliEvent({ type: "progress", node: "70:34", completed: 4096, total: 4096 }),
        cliEvent({ type: "executed", node: "70:34" }),
      ],
    });
    expect(reason).toContain("70:9（SaveImage）");
    expect(reason).toContain("节点 70:34");
    expect(reason).toContain("4096/4096");
  });

  it("证据不足（无图 / 无进度日志）时如实退回泛化文案，不臆造", () => {
    expect(describeZeroOutputFailure({ outputs: {}, executedWorkflow: null, logs: [] })).toBe(
      "无输出内容",
    );
    expect(
      describeZeroOutputFailure({
        outputs: { "9": {} },
        executedWorkflow: MINIMAX_GRAPH,
        logs: [],
      }),
    ).toBe("无输出内容");
  });

  it("输出节点已在执行结果里（只是输出结构认不出）→ 不冤枉成「分支未执行」", () => {
    const reason = describeZeroOutputFailure({
      outputs: { "9": { images: [] } },
      executedWorkflow: MINIMAX_GRAPH,
      logs: [],
    });
    expect(reason).not.toContain("输出节点均未执行");
    expect(reason).toBe("无输出内容");
  });

  it("跑满节点超过 3 条时只点名前 3 条（失败原因保持可读）", () => {
    const graph: Record<string, { class_type: string }> = { "9": { class_type: "SaveImage" } };
    const logs: Array<TestLogEntry> = [];
    for (const id of ["1", "2", "3", "4", "5"]) {
      graph[id] = { class_type: "TextGenerateV2" };
      logs.push(cliEvent({ type: "executing", node: id, class_type: "TextGenerateV2" }));
      logs.push(cliEvent({ type: "progress", node: id, completed: 100, total: 100 }));
      logs.push(cliEvent({ type: "executed", node: id }));
    }
    const reason = describeZeroOutputFailure({ outputs: {}, executedWorkflow: graph, logs });
    expect(reason).toContain("节点 1");
    expect(reason).toContain("节点 3");
    expect(reason).not.toContain("节点 4");
    expect(reason).not.toContain("节点 5");
  });
});
