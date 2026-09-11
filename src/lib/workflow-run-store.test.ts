// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkflowRunLog,
  clearAllWorkflowRuns,
  getWorkflowRun,
  getWorkflowRunStoreSnapshot,
  latestActiveWorkflowRun,
  latestRunForWorkflow,
  listWorkflowRuns,
  failWorkflowRun,
  patchWorkflowRun,
  registerWorkflowRun,
} from "./workflow-run-store";

afterEach(clearAllWorkflowRuns);

describe("workflow-run-store", () => {
  it("登记 / 查询 / 终态 patch", () => {
    registerWorkflowRun({
      taskId: "t1",
      workflowId: "wf1",
      workflowName: "文生图",
      taskType: "t2i",
      startedAt: 1,
      status: "running",
    });
    expect(getWorkflowRun("t1")?.workflowName).toBe("文生图");
    patchWorkflowRun("t1", { status: "done", resultUrl: "/generated/a.png" });
    const meta = getWorkflowRun("t1");
    expect(meta?.status).toBe("done");
    expect(meta?.resultUrl).toBe("/generated/a.png");
  });

  it("appendWorkflowRunLog 累积且 (t,msg) 去重", () => {
    registerWorkflowRun({
      taskId: "t1",
      workflowId: "wf1",
      workflowName: "n",
      taskType: "t",
      startedAt: 1,
    });
    const a = { t: 100, level: "info" as const, msg: "开始执行" };
    const b = { t: 200, level: "progress" as const, msg: "50%" };
    appendWorkflowRunLog("t1", a);
    appendWorkflowRunLog("t1", b);
    // 重复帧（SSE 回放 + 订阅双投递）应被丢弃
    appendWorkflowRunLog("t1", a);
    expect(getWorkflowRun("t1")?.logs).toHaveLength(2);
  });

  it("latestActiveWorkflowRun 优先返回仍在运行的记录", () => {
    registerWorkflowRun({
      taskId: "old",
      workflowId: "wf1",
      workflowName: "old",
      taskType: "t",
      startedAt: 1,
      status: "done",
    });
    registerWorkflowRun({
      taskId: "new",
      workflowId: "wf2",
      workflowName: "new",
      taskType: "t",
      startedAt: 2,
      status: "running",
    });
    expect(latestActiveWorkflowRun()?.taskId).toBe("new");
    patchWorkflowRun("new", { status: "done" });
    // 无运行中的记录时回落到最近一条（重开窗口仍能恢复上次运行视角）
    expect(latestActiveWorkflowRun()?.taskId).toBe("new");
  });

  it("latestRunForWorkflow 只看本工作流", () => {
    registerWorkflowRun({
      taskId: "a",
      workflowId: "wf1",
      workflowName: "a",
      taskType: "t",
      startedAt: 1,
    });
    registerWorkflowRun({
      taskId: "b",
      workflowId: "wf2",
      workflowName: "b",
      taskType: "t",
      startedAt: 2,
    });
    expect(latestRunForWorkflow("wf1")?.taskId).toBe("a");
    expect(latestRunForWorkflow("wf2")?.taskId).toBe("b");
    expect(latestRunForWorkflow("wf3")).toBeNull();
  });

  it("listWorkflowRuns 新→旧排序", () => {
    registerWorkflowRun({
      taskId: "a",
      workflowId: "wf1",
      workflowName: "a",
      taskType: "t",
      startedAt: 1,
    });
    registerWorkflowRun({
      taskId: "b",
      workflowId: "wf2",
      workflowName: "b",
      taskType: "t",
      startedAt: 2,
    });
    expect(listWorkflowRuns().map((r) => r.taskId)).toEqual(["b", "a"]);
  });

  it("快照 version 变化引用更新，否则稳定", () => {
    const s1 = getWorkflowRunStoreSnapshot();
    const s2 = getWorkflowRunStoreSnapshot();
    expect(s1).toBe(s2);
    registerWorkflowRun({
      taskId: "a",
      workflowId: "wf1",
      workflowName: "a",
      taskType: "t",
      startedAt: 1,
    });
    const s3 = getWorkflowRunStoreSnapshot();
    expect(s3).not.toBe(s1);
    expect(s3.activeTaskId).toBe("a");
  });

  it("failWorkflowRun 同时写横幅原因与一条 error 日志行（ISSUE #378）", () => {
    registerWorkflowRun({
      taskId: "t1",
      workflowId: "wf1",
      workflowName: "n",
      taskType: "t",
      startedAt: 1,
    });
    appendWorkflowRunLog("t1", { t: 100, level: "info", msg: "开始执行" });
    expect(appendWorkflowRunLog("t1", { t: 100, level: "info", msg: "开始执行" })).toHaveLength(1);

    failWorkflowRun("t1", "未找到生成结果");

    const meta = getWorkflowRun("t1");
    expect(meta?.status).toBe("failed");
    expect(meta?.errorMessage).toBe("未找到生成结果");
    const logs = meta?.logs ?? [];
    const last = logs[logs.length - 1];
    expect(last?.level).toBe("error");
    expect(last?.msg).toContain("未找到生成结果");
  });

  it("failWorkflowRun 末行已是同因错误时不重复追加", () => {
    registerWorkflowRun({
      taskId: "t1",
      workflowId: "wf1",
      workflowName: "n",
      taskType: "t",
      startedAt: 1,
    });
    appendWorkflowRunLog("t1", { t: 100, level: "error", msg: "✗ 生成失败：未找到生成结果" });
    failWorkflowRun("t1", "未找到生成结果");
    expect(getWorkflowRun("t1")?.logs).toHaveLength(1);
  });

  it("failWorkflowRun 对未登记的 taskId 静默无操作", () => {
    expect(() => failWorkflowRun("missing", "boom")).not.toThrow();
    expect(getWorkflowRun("missing")).toBeNull();
  });

  it("localStorage 写穿：清空后重 hydrate 不再恢复（clear 移除存储）", () => {
    registerWorkflowRun({
      taskId: "a",
      workflowId: "wf1",
      workflowName: "a",
      taskType: "t",
      startedAt: 1,
    });
    expect(window.localStorage.getItem("wflib:runs:v1")).toContain("wf1");
    clearAllWorkflowRuns();
    expect(window.localStorage.getItem("wflib:runs:v1")).toBeNull();
  });
});
