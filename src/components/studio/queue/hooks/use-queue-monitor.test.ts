// @vitest-environment jsdom
// 队列与运行 · 第②层的执行态单测。
//
// 四条真正会坏掉的行为在这里锁住：
//   · **位次方向** —— 服务端一律按 createdAt 倒序回，界面拿到的位次必须是先入先出；
//   · **进度没回报就不给剩余数**（写「估算中」，不给一个看起来像数的东西）；
//   · **取消失败也要刷新** —— 用户可能已在别处把它取消，界面继续显示「排队中」
//     比一次多余的刷新贵得多；
//   · **复制去重投的成败要报出来** —— 复制失败是浏览器权限给的，不报就等于吞掉点击。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ComfyQueueModule from "~/components/studio/hooks/use-comfy-queue";
import { openTaskFolder } from "~/lib/history-detail-actions";
import { cancelTask } from "~/lib/task-cancel-client";

import type { QueueRow } from "../queue-monitor-config";
import { useQueueMonitor } from "./use-queue-monitor";

/** 队列端点的一帧观测。写成函数而不是共享对象：逐个用例要改它的一部分。 */
function queueView(
  over: Partial<ComfyQueueModule.ComfyQueueView> = {},
): ComfyQueueModule.ComfyQueueView {
  return {
    online: true,
    comfy: { running: 1, pending: 0 },
    running: {
      taskId: "run-1",
      workflowName: "正在跑的工作流",
      model: "sd.safetensors",
      startedAt: 0,
      progress: 0,
      nodeType: null,
    },
    queued: 2,
    elapsedMs: 30_000,
    ...over,
  };
}

/** 一行 `task.list` 的返回。类型标出来，别靠推导出 string 再在调用处报错。 */
function queuedRow(id: string, workflowName: string): QueueRow {
  return {
    id,
    type: "IMAGE",
    workflowName,
    status: "QUEUED",
    prompt: `提示词 ${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    cover: null,
    checkpoint: null,
    mediaType: "image",
    projectId: null,
    progress: 0,
    error: null,
  };
}

const refetch = vi.fn();
const toast = { info: vi.fn(), error: vi.fn() };
const copyResult = vi.fn<(text: string) => Promise<boolean>>();
let listTasks: QueueRow[] = [];
let queueResult: ComfyQueueModule.ComfyQueueView = queueView();

vi.mock("~/trpc/react", () => ({
  api: {
    task: {
      list: {
        useQuery: () => ({
          data: { tasks: listTasks },
          isPending: false,
          isError: false,
          refetch,
        }),
      },
    },
  },
}));

/* 只替掉轮询本身：formatElapsed 与剩余时间的算法要用真实现，
 * 否则测的就不是「界面会不会说错数」。 */
vi.mock("~/components/studio/hooks/use-comfy-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyQueueModule>();
  return { ...actual, useComfyQueue: () => queueResult };
});

vi.mock("~/components/studio/ToastProvider", () => ({
  useToast: () => toast,
}));
vi.mock("~/lib/task-cancel-client", () => ({ cancelTask: vi.fn() }));
vi.mock("~/lib/history-detail-actions", () => ({ openTaskFolder: vi.fn() }));
vi.mock("~/components/ui/use-copy-feedback", () => ({
  useCopyResult: () => copyResult,
}));

const mockedCancel = vi.mocked(cancelTask);
const mockedOpen = vi.mocked(openTaskFolder);

beforeEach(() => {
  vi.clearAllMocks();
  /* 服务端回的是 createdAt 倒序：后提交的在前面。 */
  listTasks = [
    queuedRow("late", "后提交的工作流"),
    queuedRow("early", "先提交的工作流"),
  ];
  queueResult = queueView();
});

afterEach(cleanup);

describe("useQueueMonitor", () => {
  it("位次是先入先出：提交最早的那条排第 1", () => {
    const { result } = renderHook(() => useQueueMonitor());
    expect(
      result.current.queued.map((entry) => [entry.row.id, entry.position]),
    ).toEqual([
      ["early", 1],
      ["late", 2],
    ]);
  });

  it("进度还是 0 ⇒ 剩余写「估算中」，不给百分比推算", () => {
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.running?.remainingText).toBe("估算中");
  });

  it("进度回来之后才给剩余时间", () => {
    queueResult = queueView({
      running: {
        taskId: "run-1",
        workflowName: "正在跑的工作流",
        model: "sd.safetensors",
        startedAt: 0,
        progress: 25,
        nodeType: "KSampler",
      },
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.running?.remainingText).toBe("约 01:30");
  });

  it("取消：打到 cancelTask，并刷新列表", async () => {
    mockedCancel.mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.cancel("early", "先提交的工作流");
    });
    expect(mockedCancel).toHaveBeenCalledWith("early");
    expect(refetch).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("取消失败也要刷新，并把失败原因报给用户（不静默回到排队中）", async () => {
    mockedCancel.mockRejectedValue(new Error("后端无响应"));
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.cancel("early", "先提交的工作流");
    });
    expect(refetch).toHaveBeenCalled();
    /* 报的是原因而不是「哪一条」：`runAsyncAction` 里抛出的 message 优先于
     * failureText，后者只在没有原因可报时兜底。用户要靠「哪一条」定位，看的是
     * 这一行仍在队列里、忙标记已复位 —— 不是 toast 文案。 */
    expect(toast.error).toHaveBeenCalledWith("后端无响应");
  });

  it("后端没给原因时，兜底文案里要能看出是哪件事", async () => {
    mockedCancel.mockRejectedValue(new Error(""));
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.cancel("early", "先提交的工作流");
    });
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("先提交的工作流"),
    );
  });

  it("复制去重投：浏览器拒绝访问剪贴板时报错，而不是当成成功", async () => {
    copyResult.mockResolvedValue(false);
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.copyForReprint(queuedRow("late", "后提交的工作流"));
    });
    expect(copyResult).toHaveBeenCalledWith(
      expect.stringContaining("提示词 late"),
    );
    expect(toast.error).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("打开输出目录：把服务端的失败原因原样给用户", async () => {
    mockedOpen.mockResolvedValue({
      opened: false,
      error: "该任务还没有产出文件",
    });
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.openFolder(queuedRow("late", "后提交的工作流"));
    });
    expect(toast.error).toHaveBeenCalledWith("该任务还没有产出文件");
  });

  it("离线：online 为假，两个排队口径照实相加", () => {
    /* 两个口径都要给非零值，否则「相加」这件事根本没被断言到：
     * `queued` 是本应用排队的条数，`comfy.pending` 含用户在 ComfyUI 原生界面排的。 */
    queueResult = queueView({
      online: false,
      comfy: { running: 0, pending: 1 },
      queued: 2,
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.online).toBe(false);
    expect(result.current.waitingCount).toBe(3);
  });
});
