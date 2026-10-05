/* 工坊封装页签「流程测试」的运行编排 —— ISSUE #611
 *
 * 两个页签（画布节点 / 工坊封装）跑的是同一条封装口径的工作流，运行态与日志
 * 因此必须共用**同一份运行登记表**：一边在跑不该让另一边「执行不了」，日志也
 * 只有一扇门。这里断言流程测试确实把自己的运行登记进去（带来源标记）、日志
 * 累积进去、终态写回登记表。网络与 SSE 打桩。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const watchSettle = {
  ok: true as boolean,
  message: undefined as string | undefined,
};

vi.mock("~/lib/workshop/generation-client", () => ({
  buildLibraryWorkflowInput: vi.fn().mockResolvedValue({
    input: { workflow: "wf1" },
    unmatched: [],
    mode: "t2i",
    modes: ["t2i"],
    usesFirstFrame: false,
    usesLastFrame: false,
  }),
  startLocalGenerate: vi.fn().mockResolvedValue("task-test"),
  prepareLocalInputImage: vi.fn().mockResolvedValue("uploaded.png"),
  watchTask: vi.fn(
    (
      _id: string,
      h: {
        onLog?: (e: { t: number; level: string; msg: string }) => void;
        onOutput?: (o: { kind: string; url: string }) => void;
        onSettled: (r: { ok: boolean; message?: string }) => void;
      },
    ) => {
      h.onLog?.({ t: 1, level: "info", msg: "开始执行" });
      h.onOutput?.({ kind: "image", url: "/generated/a.png" });
      h.onSettled({ ok: watchSettle.ok, message: watchSettle.message });
      return () => undefined;
    },
  ),
}));

import {
  clearAllWorkflowRuns,
  getWorkflowRun,
} from "~/lib/workflow/workflow-run-store";
import { useEncapsulationTestRun } from "./use-encapsulation-test-run";

afterEach(() => {
  cleanup();
  clearAllWorkflowRuns();
  vi.clearAllMocks();
  watchSettle.ok = true;
  watchSettle.message = undefined;
});

describe("useEncapsulationTestRun", () => {
  it("流程测试把运行登记进共享登记表（带工坊封装来源）并累积日志", async () => {
    const { result } = renderHook(() =>
      useEncapsulationTestRun({
        workflowId: "wf1",
        workflowName: "文生图",
        mode: "t2i",
      }),
    );
    result.current.run({ prompt: "一只猫" });
    await waitFor(() => expect(result.current.running).toBe(false));
    await waitFor(() =>
      expect(result.current.resultUrl).toBe("/generated/a.png"),
    );
    const meta = getWorkflowRun("task-test");
    expect(meta?.source).toBe("encapsulation-test");
    expect(meta?.status).toBe("done");
    expect(meta?.logs?.[0]?.msg).toBe("开始执行");
  });

  it("失败时写终态原因（日志弹窗与页签横幅同源）", async () => {
    watchSettle.ok = false;
    watchSettle.message = "未找到生成结果";
    const { result } = renderHook(() =>
      useEncapsulationTestRun({
        workflowId: "wf1",
        workflowName: "文生图",
        mode: "t2i",
      }),
    );
    result.current.run({});
    await waitFor(() => expect(result.current.error).toBe("未找到生成结果"));
    const meta = getWorkflowRun("task-test");
    expect(meta?.status).toBe("failed");
    expect(meta?.errorMessage).toBe("未找到生成结果");
  });

  it("同一页签重入被挡住（不会并行起两次流程测试）", async () => {
    const { result } = renderHook(() =>
      useEncapsulationTestRun({
        workflowId: "wf1",
        workflowName: "文生图",
        mode: "t2i",
      }),
    );
    result.current.run({});
    result.current.run({});
    await waitFor(() => expect(result.current.running).toBe(false));
    const { startLocalGenerate } =
      await import("~/lib/workshop/generation-client");
    expect(vi.mocked(startLocalGenerate)).toHaveBeenCalledTimes(1);
  });

  it("本地图片读成 data URL 再交给准备接口，回传可直接落进工作流的文件名", async () => {
    const { result } = renderHook(() =>
      useEncapsulationTestRun({
        workflowId: "wf1",
        workflowName: "图生视频",
        mode: "I2V",
      }),
    );
    const file = new File(["x"], "cat.png", { type: "image/png" });
    await expect(result.current.uploadImage(file)).resolves.toBe(
      "uploaded.png",
    );
    const { prepareLocalInputImage } =
      await import("~/lib/workshop/generation-client");
    expect(vi.mocked(prepareLocalInputImage)).toHaveBeenCalledWith(
      expect.stringContaining("data:"),
    );
  });
});
