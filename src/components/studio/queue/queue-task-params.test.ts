// queueTaskParamRows 的纯派生单测（第①层：node 环境直接断言，规范 17 §17.1）。
// 锁的是「展开一条任务时，参数表给用户看什么」：身份三行、workflowInputs 展开、
// 内部键剔除、空值不摆、长值截断。
import { describe, expect, it } from "vitest";

import { queueTaskParamRows, type QueueTaskParamsSource } from "./queue-task-params";

function source(over: Partial<QueueTaskParamsSource> = {}): QueueTaskParamsSource {
  return {
    modelName: null,
    params: {},
    prompt: null,
    workflowName: null,
    ...over,
  };
}

describe("queueTaskParamRows", () => {
  it("身份三行：提示词 / 模型 / 工作流", () => {
    const rows = queueTaskParamRows(
      source({
        modelName: "MiniMax H3",
        params: {},
        prompt: "未来感电动跑车",
        workflowName: "E2E 工作流",
      }),
    );
    expect(rows).toEqual([
      { label: "提示词", value: "未来感电动跑车" },
      { label: "模型", value: "MiniMax H3" },
      { label: "工作流", value: "E2E 工作流" },
    ]);
  });

  it("模型名缺失时回落 params.checkpoint（画布等入口只留检查点）", () => {
    const rows = queueTaskParamRows(
      source({ params: { checkpoint: "sd_xl_base_1.0" }, prompt: "p" }),
    );
    expect(rows.find((row) => row.label === "模型")?.value).toBe("sd_xl_base_1.0");
  });

  it("workflowInputs 逐条展开成行，认得的键给中文名", () => {
    const rows = queueTaskParamRows(
      source({
        params: {
          workflowInputs: [
            { name: "seed", value: 731_030_653_625_918 },
            { name: "width", value: 1024 },
            { name: "custom_node_key", value: "abc" },
          ],
        },
      }),
    );
    expect(rows).toContainEqual({ label: "种子", value: "731030653625918" });
    expect(rows).toContainEqual({ label: "width", value: "1024" });
    expect(rows).toContainEqual({ label: "custom_node_key", value: "abc" });
  });

  it("同名只留首行：workflowInputs 里的 prompt 不与身份行重复", () => {
    const rows = queueTaskParamRows(
      source({
        params: { workflowInputs: [{ name: "prompt", value: "未来感电动跑车" }] },
        prompt: "未来感电动跑车",
      }),
    );
    expect(rows.filter((row) => row.label === "提示词")).toHaveLength(1);
  });

  it("内部键不进参数表：归属 / 落点配置 / 调试面", () => {
    const rows = queueTaskParamRows(
      source({
        params: {
          paramMap: { "mode:T2I": {} },
          outputNodeIds: ["9"],
          parentId: "task-1",
          projectId: "proj-1",
          referenceLoaderPlan: { "1::image": {} },
          shotId: "shot-1",
          workflow: "tpl-1",
        },
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("空值不摆：空串 / 空数组 / null 不假装有内容", () => {
    const rows = queueTaskParamRows(
      source({ params: { negative: "   ", referenceImages: [], seed: null } }),
    );
    expect(rows).toHaveLength(0);
  });

  it("数组收成顿号连接的文本，对象走 JSON，超长值原样保留不截断（#5074）", () => {
    const rows = queueTaskParamRows(
      source({
        params: {
          long: "长".repeat(500),
          refs: ["a.png", "b.png"],
          nested: { keep: true },
        },
      }),
    );
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("refs")).toBe("a.png、b.png");
    expect(byLabel.get("nested")).toBe('{"keep":true}');
    const long = byLabel.get("long") ?? "";
    expect(long).toBe("长".repeat(500));
  });
});
