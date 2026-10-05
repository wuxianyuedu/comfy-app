/**
 * 「切走再切回来，这次运行还在」的恢复契约。
 *
 * 现场（用户实测）：两个页签各自跑一次生成，切页签回来一边看不到进度、
 * 生成结束后两边都看不到产物。根因是 `ui/tabs` 的 Panel 切换即卸载，而运行
 * 视角只活在组件 `useState` 里 —— 登记表里明明有，就是没人去读。
 *
 * 用例钉的是**三态都要恢复**与**来源不串台**：
 *   · 还在跑 → 先给最后已知进度、再重订阅；
 *   · 已完成 → 直接给产物 + 成功终态；
 *   · 已失败 → 直接给原因；
 *   · 另一个入口（source 不同）的成果不落到这一页。
 *
 * 以及订阅出口 `watchWorkflowRun` 的另一半：进度 / 产物 / 终态**顺便写进登记
 * 表**（否则下一次切页签仍然无从恢复），失败还补一条可筛选的 error 日志行。
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/workshop/generation-client", () => ({
  watchTask: vi.fn(() => () => undefined),
}));

import { watchTask } from "~/lib/workshop/generation-client";
import {
  clearAllWorkflowRuns,
  getWorkflowRun,
  registerWorkflowRun,
} from "~/lib/workflow/workflow-run-store";
import type { WorkflowRunSource } from "~/lib/workflow/workflow-run-store";
import {
  useWorkflowRunResume,
  watchWorkflowRun,
  type WorkflowRunHandlers,
} from "./use-workflow-run-resume";

const WORKFLOW = "wf-1";

function makeHandlers(): WorkflowRunHandlers {
  return {
    onProgress: vi.fn(),
    onLog: vi.fn(),
    onOutput: vi.fn(),
    onSettled: vi.fn(),
  };
}

/** 登记一条运行（用例只关心恢复读到的形状）。 */
function register(over: {
  taskId?: string;
  source?: WorkflowRunSource;
  status?: "running" | "done" | "failed";
  progress?: number;
  resultUrl?: string;
  errorMessage?: string;
}) {
  registerWorkflowRun({
    taskId: over.taskId ?? "t1",
    workflowId: WORKFLOW,
    workflowName: "工作流",
    taskType: "t2i",
    startedAt: 1,
    source: over.source ?? "canvas-node",
    ...(over.status ? { status: over.status } : {}),
    ...(over.progress === undefined ? {} : { progress: over.progress }),
    ...(over.resultUrl ? { resultUrl: over.resultUrl } : {}),
    ...(over.errorMessage ? { errorMessage: over.errorMessage } : {}),
  });
}

beforeEach(() => {
  clearAllWorkflowRuns();
  vi.mocked(watchTask).mockClear();
  vi.mocked(watchTask).mockImplementation(() => () => undefined);
});

afterEach(() => {
  clearAllWorkflowRuns();
});

describe("useWorkflowRunResume", () => {
  it("没有登记过运行：什么都不回调、也不订阅", () => {
    const handlers = makeHandlers();
    renderHook(() =>
      useWorkflowRunResume({
        workflowId: WORKFLOW,
        source: "canvas-node",
        handlers,
      }),
    );
    expect(handlers.onProgress).not.toHaveBeenCalled();
    expect(handlers.onSettled).not.toHaveBeenCalled();
    expect(watchTask).not.toHaveBeenCalled();
  });

  it("已完成的运行：恢复产物 + 成功终态（此前只认「还在跑」，产物因此丢失）", () => {
    register({ status: "done", resultUrl: "/api/generated/a.png" });
    const handlers = makeHandlers();
    renderHook(() =>
      useWorkflowRunResume({
        workflowId: WORKFLOW,
        source: "canvas-node",
        handlers,
      }),
    );
    expect(handlers.onOutput).toHaveBeenCalledWith("t1", {
      url: "/api/generated/a.png",
      kind: "image",
    });
    expect(handlers.onSettled).toHaveBeenCalledWith("t1", { ok: true });
    /* 已经结束的运行不该再订阅一次。 */
    expect(watchTask).not.toHaveBeenCalled();
  });

  it("已完成但没有产物：只恢复终态，不塞一个空地址", () => {
    register({ status: "done" });
    const handlers = makeHandlers();
    renderHook(() =>
      useWorkflowRunResume({
        workflowId: WORKFLOW,
        source: "canvas-node",
        handlers,
      }),
    );
    expect(handlers.onOutput).not.toHaveBeenCalled();
    expect(handlers.onSettled).toHaveBeenCalledWith("t1", { ok: true });
  });

  it("失败的运行：恢复失败原因", () => {
    register({ status: "failed", errorMessage: "显存不足" });
    const handlers = makeHandlers();
    renderHook(() =>
      useWorkflowRunResume({
        workflowId: WORKFLOW,
        source: "canvas-node",
        handlers,
      }),
    );
    expect(handlers.onSettled).toHaveBeenCalledWith("t1", {
      ok: false,
      message: "显存不足",
    });
  });

  it("还在跑：先把最后已知进度交出去，再重订阅 SSE（历史帧由服务端回放补齐）", () => {
    register({ status: "running", progress: 42 });
    const handlers = makeHandlers();
    renderHook(() =>
      useWorkflowRunResume({
        workflowId: WORKFLOW,
        source: "canvas-node",
        handlers,
      }),
    );
    expect(handlers.onProgress).toHaveBeenCalledWith("t1", 42);
    expect(watchTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(watchTask).mock.calls[0]![0]).toBe("t1");
  });

  it("只看本来源的运行：另一个入口的成果不落到这一页", () => {
    register({
      source: "encapsulation-test",
      status: "done",
      resultUrl: "/a.png",
    });
    const handlers = makeHandlers();
    renderHook(() =>
      useWorkflowRunResume({
        workflowId: WORKFLOW,
        source: "canvas-node",
        handlers,
      }),
    );
    expect(handlers.onSettled).not.toHaveBeenCalled();
    expect(handlers.onOutput).not.toHaveBeenCalled();
  });

  it("恢复出的订阅回调转发给**最新**的 handlers（不被首帧闭包钉死）", () => {
    register({ status: "running", progress: 1 });
    const first = makeHandlers();
    const { rerender } = renderHook(
      ({ handlers }: { handlers: WorkflowRunHandlers }) =>
        useWorkflowRunResume({
          workflowId: WORKFLOW,
          source: "canvas-node",
          handlers,
        }),
      { initialProps: { handlers: first } },
    );
    const second = makeHandlers();
    rerender({ handlers: second });

    const captured = vi.mocked(watchTask).mock.calls[0]![1];
    captured.onProgress?.(77);
    expect(second.onProgress).toHaveBeenCalledWith("t1", 77, undefined);
    expect(first.onProgress).not.toHaveBeenCalledWith("t1", 77, undefined);
  });
});

describe("watchWorkflowRun", () => {
  it("进度 / 产物 / 终态都写进登记表（下一次切页签才有的可恢复）", () => {
    register({ status: "running" });
    watchWorkflowRun("t1", makeHandlers());
    const captured = vi.mocked(watchTask).mock.calls[0]![1];

    captured.onProgress?.(55);
    expect(getWorkflowRun("t1")?.progress).toBe(55);

    captured.onOutput?.({ url: "/api/generated/a.png", kind: "image" });
    expect(getWorkflowRun("t1")?.resultUrl).toBe("/api/generated/a.png");

    captured.onSettled({ ok: true });
    expect(getWorkflowRun("t1")?.status).toBe("done");
  });

  it("视频产物不写进 resultUrl（结果位是「一张图」）", () => {
    register({ status: "running" });
    watchWorkflowRun("t1", makeHandlers());
    const captured = vi.mocked(watchTask).mock.calls[0]![1];
    captured.onOutput?.({ url: "/a.mp4", kind: "video" });
    expect(getWorkflowRun("t1")?.resultUrl).toBeUndefined();
  });

  it("失败走 failWorkflowRun：状态之外还补一条可筛选的 error 日志行", () => {
    register({ status: "running" });
    watchWorkflowRun("t1", makeHandlers());
    const captured = vi.mocked(watchTask).mock.calls[0]![1];
    captured.onSettled({ ok: false, message: "显存不足" });

    const run = getWorkflowRun("t1");
    expect(run?.status).toBe("failed");
    expect(run?.errorMessage).toBe("显存不足");
    expect(
      run?.logs?.some(
        (log) => log.level === "error" && log.msg.includes("显存不足"),
      ),
    ).toBe(true);
  });

  it("日志原样转交（累积与去重仍归调用方 / store）", () => {
    register({ status: "running" });
    const handlers = makeHandlers();
    watchWorkflowRun("t1", handlers);
    const captured = vi.mocked(watchTask).mock.calls[0]![1];
    const entry = { t: 1, level: "info" as const, msg: "开始" };
    captured.onLog?.(entry);
    expect(handlers.onLog).toHaveBeenCalledWith("t1", entry);
  });
});
