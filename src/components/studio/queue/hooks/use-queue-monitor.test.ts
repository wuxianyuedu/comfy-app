// 队列与运行第②层执行态单测：锁真正会坏的行为 —— 位次方向（服务端 createdAt 倒序，界面须先入先出）；
// 进度为 0 不给剩余数（写「估算中」）；取消失败也要刷新；复制去重投的成败要报出来；
// 离线的待执行数不报 0（/api/comfy/queue 读不到时库行是唯一口径，页头 0 配排队列表自相矛盾）。
import type * as TanStackQuery from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ComfyQueueModule from "~/components/studio/hooks/use-comfy-queue";
import { revealTaskFolder } from "~/lib/history-detail-actions";
import { cancelAllTasks, cancelTask } from "~/lib/task-cancel-client";

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
      progressValue: 553,
      progressMax: 8196,
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
    modelName: null,
    status: "QUEUED",
    prompt: `提示词 ${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    cover: null,
    checkpoint: null,
    videoPath: null,
    mediaType: "image",
    projectId: null,
    progress: 0,
    error: null,
  };
}

const refetch = vi.fn();
const toast = { info: vi.fn(), error: vi.fn() };
const copyResult = vi.fn<(text: string) => Promise<boolean>>();
let listTasks: Array<QueueRow> = [];
let queueResult: ComfyQueueModule.ComfyQueueView = queueView();

/* 新集成下 hub 交出的是「options 工厂」，本文件的题目是位次/耗时/剩余时间这些
 * 算法，不是 TanStack —— 所以 `useTRPC` 只给一个能对上 queryKey 的工厂，
 * 数据态由下面替掉的 `useQuery` 直接给。 */
vi.mock("~/trpc/react", () => ({
  useTRPC: () => ({
    task: {
      list: { queryOptions: () => ({ queryKey: ["task", "list"] }) },
      /* 展开看参数（#5019）会挂 detail 查询：这里给一个能对上 queryKey 的
       * 工厂即可，数据态由上面替掉的 useQuery 统一给。 */
      detail: { queryOptions: () => ({ queryKey: ["task", "detail"] }) },
    },
    /* 生图暂停（ISSUE #5055）：同样只给能对上 queryKey / mutationKey 的工厂，
     * 数据态由替掉的 useQuery / useMutation 统一给。 */
    generationControl: {
      pauseState: { queryOptions: () => ({ queryKey: ["generationControl", "pauseState"] }) },
      setPaused: { mutationOptions: () => ({ mutationKey: ["generationControl", "setPaused"] }) },
    },
  }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TanStackQuery>();
  return {
    ...actual,
    useQuery: () => ({
      data: { tasks: listTasks },
      isPending: false,
      isError: false,
      refetch,
    }),
    /* 暂停切换的 mutation 不在本文件题目里（读写逻辑由路由 / 仓储用例覆盖）：
     * 给一个惰性桩，让挂载期不要求 QueryClient 上下文。 */
    useMutation: () => ({ mutateAsync: vi.fn(() => Promise.resolve(undefined)), isPending: false }),
  };
});

/* 只替掉轮询本身：formatElapsed 与剩余时间的算法要用真实现，
 * 否则测的就不是「界面会不会说错数」。 */
vi.mock("~/components/studio/hooks/use-comfy-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyQueueModule>();
  return { ...actual, useComfyQueue: () => queueResult };
});

vi.mock("~/components/studio/ToastProvider", () => ({
  useToast: () => toast,
}));
vi.mock("~/lib/task-cancel-client", () => ({ cancelTask: vi.fn(), cancelAllTasks: vi.fn() }));
vi.mock("~/lib/history-detail-actions", () => ({ revealTaskFolder: vi.fn() }));
vi.mock("~/components/ui/use-copy-feedback", () => ({
  useCopyResult: () => copyResult,
}));

const mockedCancel = vi.mocked(cancelTask);
const mockedCancelAll = vi.mocked(cancelAllTasks);
const mockedReveal = vi.mocked(revealTaskFolder);

beforeEach(() => {
  vi.clearAllMocks();
  /* 服务端回的是 createdAt 倒序：后提交的在前面。 */
  listTasks = [queuedRow("late", "后提交的工作流"), queuedRow("early", "先提交的工作流")];
  queueResult = queueView();
});

afterEach(cleanup);

describe("useQueueMonitor", () => {
  it("位次是先入先出：提交最早的那条排第 1", () => {
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.queued.map((entry) => [entry.row.id, entry.position])).toEqual([
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
        progressValue: 2049,
        progressMax: 8196,
      },
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.running?.remainingText).toBe("约 01:30");
  });

  it("跑动卡带步数与平均速度（progressNode 的 value/max + 已耗时）", () => {
    queueResult = queueView({
      elapsedMs: 42_000,
      running: {
        taskId: "run-1",
        workflowName: "正在跑的工作流",
        model: "sd.safetensors",
        startedAt: 0,
        progress: 7,
        nodeType: "KSampler",
        progressValue: 553,
        progressMax: 8196,
      },
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.running?.stepsText).toBe("553/8196");
    expect(result.current.running?.rateText).toBe("13.17 it/s");
  });

  it("步数帧没带（comfy-cli 事件源）时写「—」，不编数", () => {
    queueResult = queueView({
      running: {
        taskId: "run-1",
        workflowName: "正在跑的工作流",
        model: "sd.safetensors",
        startedAt: 0,
        progress: 7,
        nodeType: null,
        progressValue: null,
        progressMax: null,
      },
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.running?.stepsText).toBe("—");
    expect(result.current.running?.rateText).toBe("—");
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
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("先提交的工作流"));
  });

  it("取消全部：确认后打到一个出口、关弹窗、刷新，并如实报出取消条数", async () => {
    mockedCancelAll.mockResolvedValue({ cancelled: 5, failed: 0, total: 5 });
    const { result } = renderHook(() => useQueueMonitor());
    act(() => {
      result.current.requestCancelAll();
    });
    expect(result.current.cancelAllOpen).toBe(true);

    await act(async () => {
      await result.current.confirmCancelAll();
    });
    expect(mockedCancelAll).toHaveBeenCalledTimes(1);
    expect(mockedCancel).not.toHaveBeenCalled();
    expect(result.current.cancelAllOpen).toBe(false);
    expect(refetch).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("已取消 5 条任务");
  });

  it("取消全部部分失败：条数照实报出来，不把没取消掉的藏起来", async () => {
    mockedCancelAll.mockResolvedValue({ cancelled: 3, failed: 2, total: 5 });
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.confirmCancelAll();
    });
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("3 条，2 条未能取消"));
  });

  it("取消全部失败也刷新并把原因给用户", async () => {
    mockedCancelAll.mockRejectedValue(new Error("后端无响应"));
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.confirmCancelAll();
    });
    expect(refetch).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("后端无响应");
  });

  it("复制去重投：浏览器拒绝访问剪贴板时报错，而不是当成成功", async () => {
    copyResult.mockResolvedValue(false);
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.copyForReprint(queuedRow("late", "后提交的工作流"));
    });
    expect(copyResult).toHaveBeenCalledWith(expect.stringContaining("提示词 late"));
    expect(toast.error).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("打开输出目录：把服务端的失败原因原样给用户", async () => {
    mockedReveal.mockResolvedValue({
      ok: false,
      detail: "该任务还没有产出文件",
    });
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.openFolder(queuedRow("late", "后提交的工作流"));
    });
    expect(toast.error).toHaveBeenCalledWith("该任务还没有产出文件");
  });

  /* 这一条是「点了报成功、资源管理器没动」的回归判据：此前用例只锁了失败路径，
   * 成功路径把 `comfyappUrl` 丢掉也没人发现 —— 报的是一句与事实无关的成功。 */
  it("打开输出目录：成功时报的是服务端探出来的定位结论", async () => {
    mockedReveal.mockResolvedValue({
      ok: true,
      detail: String.raw`已在文件管理器里定位：F:\gen\task-late`,
    });
    const { result } = renderHook(() => useQueueMonitor());
    await act(async () => {
      await result.current.openFolder(queuedRow("late", "后提交的工作流"));
    });
    expect(mockedReveal).toHaveBeenCalledWith("late");
    expect(toast.info).toHaveBeenCalledWith(String.raw`已在文件管理器里定位：F:\gen\task-late`);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("在线：waitingCount 是两个排队口径照实相加", () => {
    /* 两个口径都要给非零值，否则「相加」这件事根本没被断言到：
     * `queued` 是本应用排队的条数，`comfy.pending` 含用户在 ComfyUI 原生界面排的。 */
    queueResult = queueView({
      online: true,
      comfy: { running: 0, pending: 1 },
      queued: 2,
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.online).toBe(true);
    expect(result.current.waitingCount).toBe(3);
  });

  it("离线：waitingCount 退回库里的行数，不报 0（与下方列表自相矛盾比少算更糟）", () => {
    /* `/api/comfy/queue` 读不到时它的两个计数恒为 0；此时页头若显示「待执行 0」，
     * 而列表里明明排着两条，就是同一屏自相矛盾。库里的 RUNNING + QUEUED 行
     * 是离线时唯一可信的口径。 */
    listTasks = [
      queuedRow("late", "后提交的工作流"),
      queuedRow("early", "先提交的工作流"),
      { ...queuedRow("run-1", "在跑的工作流"), status: "RUNNING" },
    ];
    queueResult = queueView({
      online: false,
      comfy: { running: 0, pending: 0 },
      queued: 0,
      running: null,
    });
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.waitingCount).toBe(3);
    /* 离线兜底卡要的数据：库里的 RUNNING 行原样上抛。 */
    expect(result.current.runningRows.map((r) => r.id)).toEqual(["run-1"]);
    expect(result.current.running).toBeNull();
  });

  it("openLog / closeLog：目标行是快照，closeLog 清空", () => {
    const { result } = renderHook(() => useQueueMonitor());
    expect(result.current.logRow).toBeNull();
    const target = {
      id: "t-1",
      workflowName: "某工作流",
      status: "RUNNING",
      error: null,
    };
    act(() => {
      result.current.openLog(target);
    });
    expect(result.current.logRow).toEqual(target);
    act(() => {
      result.current.closeLog();
    });
    expect(result.current.logRow).toBeNull();
  });
});
