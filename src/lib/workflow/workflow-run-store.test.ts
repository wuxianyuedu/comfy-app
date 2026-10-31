// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendWorkflowRunLog,
  clearAllWorkflowRuns,
  getWorkflowRun,
  getWorkflowRunStoreSnapshot,
  latestActiveWorkflowRun,
  latestRunForWorkflow,
  listWorkflowRuns,
  failWorkflowRun,
  flushWorkflowRunPersist,
  patchWorkflowRun,
  registerWorkflowRun,
  runLogSourceLabel,
} from "./workflow-run-store";
import { tailWindow } from "~/lib/page-window";

afterEach(clearAllWorkflowRuns);

describe("workflow-run-store", () => {
  it("登记 / 查询 / 终态 patch", () => {
    registerWorkflowRun({
      startedAt: 1,
      status: "running",
      taskId: "t1",
      taskType: "t2i",
      workflowId: "wf1",
      workflowName: "文生图",
    });
    expect(getWorkflowRun("t1")?.workflowName).toBe("文生图");
    patchWorkflowRun("t1", { resultUrl: "/generated/a.png", status: "done" });
    const meta = getWorkflowRun("t1");
    expect(meta?.status).toBe("done");
    expect(meta?.resultUrl).toBe("/generated/a.png");
  });

  it("appendWorkflowRunLog 累积且 (t,msg) 去重", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    const a = {
      level: /* SAFETY: 类型断言已复核 */ "info" as const,
      msg: "开始执行",
      t: 100,
    };
    const b = {
      level: /* SAFETY: 类型断言已复核 */ "progress" as const,
      msg: "50%",
      t: 200,
    };
    appendWorkflowRunLog("t1", a);
    appendWorkflowRunLog("t1", b);
    // 重复帧（SSE 回放 + 订阅双投递）应被丢弃
    appendWorkflowRunLog("t1", a);
    expect(getWorkflowRun("t1")?.logs).toHaveLength(2);
  });

  it("latestActiveWorkflowRun 优先返回仍在运行的记录", () => {
    registerWorkflowRun({
      startedAt: 1,
      status: "done",
      taskId: "old",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "old",
    });
    registerWorkflowRun({
      startedAt: 2,
      status: "running",
      taskId: "new",
      taskType: "t",
      workflowId: "wf2",
      workflowName: "new",
    });
    expect(latestActiveWorkflowRun()?.taskId).toBe("new");
    patchWorkflowRun("new", { status: "done" });
    // 无运行中的记录时回落到最近一条（重开窗口仍能恢复上次运行视角）
    expect(latestActiveWorkflowRun()?.taskId).toBe("new");
  });

  it("latestRunForWorkflow 只看本工作流", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "a",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "a",
    });
    registerWorkflowRun({
      startedAt: 2,
      taskId: "b",
      taskType: "t",
      workflowId: "wf2",
      workflowName: "b",
    });
    expect(latestRunForWorkflow("wf1")?.taskId).toBe("a");
    expect(latestRunForWorkflow("wf2")?.taskId).toBe("b");
    expect(latestRunForWorkflow("wf3")).toBeNull();
  });

  it("listWorkflowRuns 新→旧排序", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "a",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "a",
    });
    registerWorkflowRun({
      startedAt: 2,
      taskId: "b",
      taskType: "t",
      workflowId: "wf2",
      workflowName: "b",
    });
    expect(listWorkflowRuns().map((r) => r.taskId)).toEqual(["b", "a"]);
  });

  it("快照 version 变化引用更新，否则稳定", () => {
    const s1 = getWorkflowRunStoreSnapshot();
    const s2 = getWorkflowRunStoreSnapshot();
    expect(s1).toBe(s2);
    registerWorkflowRun({
      startedAt: 1,
      taskId: "a",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "a",
    });
    const s3 = getWorkflowRunStoreSnapshot();
    expect(s3).not.toBe(s1);
    expect(s3.activeTaskId).toBe("a");
  });

  it("failWorkflowRun 同时写横幅原因与一条 error 日志行（ISSUE #378）", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    appendWorkflowRunLog("t1", { level: "info", msg: "开始执行", t: 100 });
    expect(appendWorkflowRunLog("t1", { level: "info", msg: "开始执行", t: 100 })).toHaveLength(1);

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
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    appendWorkflowRunLog("t1", {
      level: "error",
      msg: "✗ 生成失败：未找到生成结果",
      t: 100,
    });
    failWorkflowRun("t1", "未找到生成结果");
    expect(getWorkflowRun("t1")?.logs).toHaveLength(1);
  });

  it("failWorkflowRun 对未登记的 taskId 静默无操作", () => {
    expect(() => failWorkflowRun("missing", "boom")).not.toThrow();
    expect(getWorkflowRun("missing")).toBeNull();
  });

  it("运行来源标记与展示名（两个入口共用一个执行视角，ISSUE #611）", () => {
    registerWorkflowRun({
      source: "canvas-node",
      startedAt: 1,
      taskId: "a",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    expect(getWorkflowRun("a")?.source).toBe("canvas-node");
    expect(runLogSourceLabel("canvas-node")).toContain("画布节点");
    expect(runLogSourceLabel("encapsulation-test")).toContain("工坊封装");
    /* 早期落库的记录没有 source —— 一律按画布节点就地运行呈现。 */
    expect(runLogSourceLabel(undefined)).toContain("画布节点");
  });

  it("两个入口的运行时序互不干扰：登记表同时容纳两边的任务（ISSUE #611）", () => {
    /* 「画布节点」与「工坊封装」是同一份封装口径的两次运行，都登记进本表。
     * 一边在跑不该挡住另一边登记 —— 两边各自拿到自己的 taskId 与日志。 */
    registerWorkflowRun({
      source: "canvas-node",
      startedAt: 1,
      status: "running",
      taskId: "canvas",
      taskType: "t2i",
      workflowId: "wf1",
      workflowName: "n",
    });
    registerWorkflowRun({
      source: "encapsulation-test",
      startedAt: 2,
      status: "running",
      taskId: "test",
      taskType: "t2i",
      workflowId: "wf1",
      workflowName: "n",
    });
    appendWorkflowRunLog("canvas", { level: "info", msg: "画布节点", t: 1 });
    appendWorkflowRunLog("test", { level: "info", msg: "流程测试", t: 1 });
    expect(getWorkflowRun("canvas")?.logs).toHaveLength(1);
    expect(getWorkflowRun("test")?.logs).toHaveLength(1);
    expect(getWorkflowRun("canvas")?.logs?.[0]?.msg).toBe("画布节点");
    expect(getWorkflowRun("test")?.logs?.[0]?.msg).toBe("流程测试");
  });

  it("localStorage 写穿：清空后重 hydrate 不再恢复（clear 移除存储）", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "a",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "a",
    });
    /* 落盘是**合并**的（见下一条），断言前先把合并窗口 flush 掉。 */
    flushWorkflowRunPersist();
    expect(window.localStorage.getItem("wflib:runs:v1")).toContain("wf1");
    clearAllWorkflowRuns();
    expect(window.localStorage.getItem("wflib:runs:v1")).toBeNull();
  });

  it("落盘合并：窗口内追加多行只写一次（内存里仍逐行更新）", () => {
    /* 一次运行会一行一行推日志，此前每次 `notify()` 都 `JSON.stringify`
     * 整个登记表 + 同步写 localStorage（实测 4.2ms / 683KB 一次）。
     * 现在合并窗口内的多次变更只落一次盘，而**列表本身立刻更新** ——
     * 后者是 React 渲染依赖的，不能一起被合并掉。 */
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    registerWorkflowRun({
      startedAt: 1,
      status: "running",
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    setItem.mockClear();
    for (let i = 0; i < 20; i += 1) {
      appendWorkflowRunLog("t1", { level: "info", msg: `行 ${i}`, t: i });
    }
    /* 内存里 20 行都在（没有被合并掉）。 */
    expect(getWorkflowRun("t1")?.logs).toHaveLength(20);
    /* 一次都还没落盘 —— 全被合并进同一个窗口。 */
    expect(setItem).not.toHaveBeenCalled();
    flushWorkflowRunPersist();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("wflib:runs:v1")).toContain("行 19");
    setItem.mockRestore();
  });

  it("flush 后窗口内再追加仍会开启新的一轮写", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    flushWorkflowRunPersist();
    setItem.mockClear();
    appendWorkflowRunLog("t1", { level: "info", msg: "a", t: 1 });
    flushWorkflowRunPersist();
    appendWorkflowRunLog("t1", { level: "info", msg: "b", t: 2 });
    flushWorkflowRunPersist();
    expect(setItem).toHaveBeenCalledTimes(2);
    setItem.mockRestore();
  });

  it("clear 撤掉待办的写：不会把刚清掉的登记复活", () => {
    /* 待办的写写的是**清空前**那份全表；不撤掉它，`clearAllWorkflowRuns`
     * 之后那次落地会把删掉的登记重新写回 localStorage。 */
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    clearAllWorkflowRuns();
    /* 清空后把合并窗口走完、再显式 flush —— 两种时机都不该有写落下来。 */
    flushWorkflowRunPersist();
    expect(window.localStorage.getItem("wflib:runs:v1")).toBeNull();
  });

  it("判重只看尾部窗口：最近的重复帧仍被丢弃", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    appendWorkflowRunLog("t1", { level: "info", msg: "开始", t: 1 });
    appendWorkflowRunLog("t1", { level: "info", msg: "开始", t: 1 });
    expect(getWorkflowRun("t1")?.logs).toHaveLength(1);
  });

  it("判重窗口外的旧帧不再比对（O(上限) 收成 O(窗口)）", () => {
    /* 旧的 `logs.some(...)` 扫满整个 300 条窗口 —— 每一行都付一遍。
     * 现在只扫最后 64 条：**这是有意的语义收窄**，重复帧只会紧挨着原帧到达
     *（SSE 回放 + 订阅双投递），一条 64 行之前的旧帧不构成「重复投递」。 */
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    appendWorkflowRunLog("t1", { level: "info", msg: "很久以前", t: 1 });
    for (let i = 0; i < 100; i += 1) {
      appendWorkflowRunLog("t1", { level: "info", msg: `行 ${i}`, t: 100 + i });
    }
    /* 窗口外的同 (t, msg) 帧不再被当成重复（旧写法会丢）。 */
    appendWorkflowRunLog("t1", { level: "info", msg: "很久以前", t: 1 });
    expect(getWorkflowRun("t1")?.logs).toHaveLength(102);
  });

  it("封顶后追加是原地搬移（复用同一数组，不新分配）", () => {
    /* 这条钉的是**写法**而不是结果：上面那条用例断言的是「两种写法等价」，
     * 所以把实现退回 `tailWindow([...logs, entry], …)` 它照样绿 —— 而性能
     * 恰恰就是这次改动的全部目的（封顶后每行省下一份 300 元素的分配）。
     * 判据：窗口填满之后，日志数组的**引用**不再变（增量版原地 `shift`+`push`，
     * 旧版每次都返回新数组）。 */
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    const last = () => {
      const logs = getWorkflowRun("t1")?.logs;
      return logs?.[logs.length - 1];
    };
    for (let i = 0; i < 300; i += 1) {
      appendWorkflowRunLog("t1", { level: "info", msg: `行 ${i}`, t: i });
    }
    expect(getWorkflowRun("t1")?.logs).toHaveLength(300);
    const filled = getWorkflowRun("t1")?.logs;
    appendWorkflowRunLog("t1", { level: "info", msg: "行 300", t: 300 });
    /* 同一数组被复用：引用不变、长度仍是上限、尾部是新行。 */
    expect(getWorkflowRun("t1")?.logs).toBe(filled);
    expect(getWorkflowRun("t1")?.logs).toHaveLength(300);
    expect(last()?.msg).toBe("行 300");
    expect(getWorkflowRun("t1")?.logs?.[0]?.msg).toBe("行 1");
  });

  it("追加路径与「先展开再取尾部窗口」逐字等价（含上限截断）", () => {
    registerWorkflowRun({
      startedAt: 1,
      taskId: "t1",
      taskType: "t",
      workflowId: "wf1",
      workflowName: "n",
    });
    let slow: Array<{ level: "info"; msg: string; t: number }> = [];
    for (let i = 0; i < 400; i += 1) {
      const entry = {
        level: /* SAFETY: 类型断言已复核 */ "info" as const,
        msg: `行 ${i}`,
        t: i,
      };
      slow = tailWindow([...slow, entry], 300);
      appendWorkflowRunLog("t1", entry);
      expect(getWorkflowRun("t1")?.logs).toEqual(slow);
    }
    expect(getWorkflowRun("t1")?.logs).toHaveLength(300);
  });
});
