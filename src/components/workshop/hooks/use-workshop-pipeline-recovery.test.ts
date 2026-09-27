// @vitest-environment jsdom
//
// 工坊「失联任务恢复 + 30 分钟安全阀」回归测试。
//
// 草稿把 status=running 与 taskId 一起持久化，但 SSE 观察循环活在内存里：
// 刷新 / 切页签重挂载后镜头会永远停在「生成中」（历史欠缺）。恢复逻辑先查
// task 表真值（fetchTaskSnapshot）再决定「直接回写产物」还是「重订阅 SSE」
// —— SSE 对「订阅前已终态」的任务只回放日志与一条 state 帧（成功终态不带
// 产物、不发 done 帧），无脑重订阅会把已成功的任务判成「连接中断」。
// 本文件逐条钉死恢复的四种分支，以及 generateShot 的超时阀与 unmatched 提示。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { createProject } from "~/lib/project-canvas/canvas-store";
import {
  LOCAL_TASK_TIMEOUT_MS,
  buildLibraryWorkflowInput,
  startLocalGenerate,
  type LibraryWorkflowBuildResult,
} from "~/lib/workshop/generation-client";
import type { Shot } from "~/lib/workshop/types";

vi.mock("~/lib/workshop/character-portrait-client", () => ({
  generateWorkflowPortrait: vi.fn(),
  generateRemotePortrait: vi.fn(),
  importPortraitFile: vi.fn(),
}));

/* 生成链路整体部分 mock：保留真实导出（常量 / 类型），只换掉网络行为。 */
type SettleFn = (r: { ok: boolean; message?: string }) => void;
const watchTaskMock = vi.hoisted(() =>
  vi.fn<(taskId: string, h: { onSettled: SettleFn }) => () => void>(),
);
const fetchTaskSnapshotMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/workshop/generation-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    watchTask: watchTaskMock,
    fetchTaskSnapshot: fetchTaskSnapshotMock,
    startLocalGenerate: vi.fn(),
    buildLibraryWorkflowInput: vi.fn(),
    fetchApiChannels: vi.fn(async () => null),
    fetchWorkshopWorkflows: vi.fn(async () => []),
  };
});

function makeShot(patch: Partial<Shot> = {}): Shot {
  return {
    id: "shot-1",
    index: 1,
    sceneId: "scene-1",
    sceneHeading: "场景1 · 清晨",
    shotType: "medium",
    description: "",
    characterIds: [],
    prompt: "a cat, cinematic",
    negativePrompt: "",
    params: {},
    status: "idle",
    ...patch,
  };
}

/** 预置一份带镜头的本地草稿（模拟「刷新前正在进行」的落盘现场）。 */
function seedDraft(projectId: string, shots: Shot[]) {
  localStorage.setItem(
    `comfyapp.workshop.draft.${projectId}.v1`,
    JSON.stringify({
      v: 1,
      meta: { title: "恢复测试", type: "short_video", tone: "", logline: "" },
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots,
      workflowId: "wf-1",
      videoWorkflowId: "",
    }),
  );
}

/** 一次封装结果的桩（buildLibraryWorkflowInput 的返回形状）。 */
function buildResult(
  patch: Partial<LibraryWorkflowBuildResult> = {},
): LibraryWorkflowBuildResult {
  return {
    input: { workflow: "wf-1", prompt: "a cat" },
    unmatched: [],
    mode: null,
    modes: [],
    usesFirstFrame: false,
    usesLastFrame: false,
    ...patch,
  };
}

beforeEach(() => {
  localStorage.clear();
  watchTaskMock.mockReset();
  fetchTaskSnapshotMock.mockReset();
  global.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ skills: [], models: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useWorkshopPipeline 刷新后失联任务恢复", () => {
  it("任务已成功：产物真值直接回写 imageUrl，不重订阅 SSE", async () => {
    const project = createProject();
    seedDraft(project.id, [makeShot({ status: "running", taskId: "task-ok" })]);
    fetchTaskSnapshotMock.mockResolvedValue({
      status: "SUCCEEDED",
      outputs: [{ url: "/api/generated/task-ok/1.png", kind: "image" }],
    });

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      /* flush 恢复的异步回写 */
    });

    expect(result.current.shots[0]).toMatchObject({
      status: "done",
      imageUrl: "/api/generated/task-ok/1.png",
    });
    /* 成功终态的 SSE 重订阅拿不到产物（done 帧只随 live 流下发），不该走它。 */
    expect(watchTaskMock).not.toHaveBeenCalled();
  });

  it("任务已成功但没有图片产物：按失败收尾并提示（不假装完成）", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ status: "running", taskId: "task-empty" }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue({
      status: "SUCCEEDED",
      outputs: [],
    });

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.shots[0]!.status).toBe("failed");
    expect(result.current.notice).toContain("没有产出文件");
  });

  it("任务已失败 / 已取消：按失败收尾并给出原因", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ status: "running", taskId: "task-bad" }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue({
      status: "FAILED",
      error: "显存不足",
      outputs: [],
    });

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.shots[0]!.status).toBe("failed");
    expect(result.current.notice).toContain("显存不足");
  });

  it("任务查无真值（记录被删 / 查询失败）：如实按失败收尾", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ status: "running", taskId: "task-gone" }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue(null);

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.shots[0]!.status).toBe("failed");
  });

  it("任务仍在跑：重订阅 SSE，落定后回写终态", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ status: "running", taskId: "task-live" }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue({ status: "RUNNING", outputs: [] });
    let settle!: (r: { ok: boolean; message?: string }) => void;
    watchTaskMock.mockImplementation(
      (
        _taskId: string,
        h: { onSettled: (r: { ok: boolean; message?: string }) => void },
      ) => {
        settle = h.onSettled;
        return () => undefined;
      },
    );

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(watchTaskMock).toHaveBeenCalledTimes(1);
    const [calledTaskId, handler] = watchTaskMock.mock.calls[0]!;
    expect(calledTaskId).toBe("task-live");
    expect(typeof handler.onSettled).toBe("function");
    await act(async () => {
      settle({ ok: true });
    });
    expect(result.current.shots[0]!.status).toBe("done");
  });

  it("恢复是异步的：期间用户重新发起（taskId 已换），旧恢复不覆盖新任务的状态", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ status: "running", taskId: "task-old" }),
    ]);
    let resolveSnapshot!: (v: unknown) => void;
    fetchTaskSnapshotMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const { result } = renderHook(() => useWorkshopPipeline());
    /* 用户在恢复查询在途时重新发起了生成：taskId 换成了新的。 */
    act(() => {
      result.current.setShots((prev) =>
        prev.map((item) =>
          item.id === "shot-1" ? { ...item, taskId: "task-new" } : item,
        ),
      );
    });
    /* 然后恢复结果才到达 —— 归属核对（taskId 已换）必须拦下这次回写。 */
    await act(async () => {
      resolveSnapshot({
        status: "SUCCEEDED",
        outputs: [{ url: "/api/generated/old.png", kind: "image" }],
      });
    });

    expect(result.current.shots[0]!.imageUrl).toBeUndefined();
    expect(result.current.shots[0]!.status).toBe("running");
  });

  it("刷新恢复（视频）：片段任务已成功 → clipUrl 真值回写，不重订阅 SSE", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({
        status: "done",
        imageUrl: "/api/generated/shot.png",
        clipStatus: "running",
        clipTaskId: "clip-ok",
      }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue({
      status: "SUCCEEDED",
      outputs: [{ url: "/api/generated/clip-ok/1.mp4", kind: "video" }],
    });

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.shots[0]).toMatchObject({
      clipStatus: "done",
      clipUrl: "/api/generated/clip-ok/1.mp4",
    });
    expect(watchTaskMock).not.toHaveBeenCalled();
  });

  it("刷新恢复（视频）：成功任务的产物里没有视频（只有图）→ 按失败收尾", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ clipStatus: "running", clipTaskId: "clip-noout" }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue({
      status: "SUCCEEDED",
      outputs: [{ url: "/api/generated/x.png", kind: "image" }],
    });

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.shots[0]!.clipStatus).toBe("failed");
    expect(result.current.shots[0]!.clipUrl).toBeUndefined();
    expect(result.current.notice).toContain("没有产出文件");
  });

  it("刷新恢复（视频）：片段任务仍在跑 → 重订阅 SSE，落定回写 clipStatus", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ clipStatus: "running", clipTaskId: "clip-live" }),
    ]);
    fetchTaskSnapshotMock.mockResolvedValue({ status: "RUNNING", outputs: [] });
    watchTaskMock.mockImplementation((_taskId, h) => {
      h.onSettled({ ok: true });
      return () => undefined;
    });

    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(watchTaskMock).toHaveBeenCalledTimes(1);
    expect(watchTaskMock.mock.calls[0]![0]).toBe("clip-live");
    expect(result.current.shots[0]!.clipStatus).toBe("done");
  });

  it("刷新恢复（视频）：恢复期间重新发起片段（clipTaskId 已换），旧恢复不覆盖", async () => {
    const project = createProject();
    seedDraft(project.id, [
      makeShot({ clipStatus: "running", clipTaskId: "clip-old" }),
    ]);
    let resolveSnapshot!: (v: unknown) => void;
    fetchTaskSnapshotMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const { result } = renderHook(() => useWorkshopPipeline());
    act(() => {
      result.current.setShots((prev) =>
        prev.map((item) =>
          item.id === "shot-1" ? { ...item, clipTaskId: "clip-new" } : item,
        ),
      );
    });
    await act(async () => {
      resolveSnapshot({
        status: "SUCCEEDED",
        outputs: [{ url: "/api/generated/old.mp4", kind: "video" }],
      });
    });

    expect(result.current.shots[0]!.clipUrl).toBeUndefined();
    expect(result.current.shots[0]!.clipStatus).toBe("running");
  });
});

describe("useWorkshopPipeline generateShot 的可靠性出口", () => {
  it("unmatched 口在发起前上提示条（不静默丢输入）", async () => {
    const project = createProject();
    seedDraft(project.id, [makeShot({ status: "idle" })]);
    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    vi.mocked(buildLibraryWorkflowInput).mockResolvedValue(
      buildResult({ unmatched: ["seed"] }),
    );
    vi.mocked(startLocalGenerate).mockResolvedValue("task-1");
    watchTaskMock.mockImplementation(
      (
        _taskId: string,
        h: { onSettled: (r: { ok: boolean; message?: string }) => void },
      ) => {
        h.onSettled({ ok: true });
        return () => undefined;
      },
    );

    await act(async () => {
      await result.current.generateShot(result.current.shots[0]!);
    });

    expect(result.current.notice).toContain("种子");
    expect(result.current.shots[0]!.status).toBe("done");
  });

  it("SSE 30 分钟无响应：按失败收尾并退订（批量循环永不卡死在沉默的流上）", async () => {
    const project = createProject();
    seedDraft(project.id, [makeShot({ status: "idle" })]);
    const { result } = renderHook(() => useWorkshopPipeline());
    await act(async () => {
      await Promise.resolve();
    });

    vi.mocked(buildLibraryWorkflowInput).mockResolvedValue(buildResult());
    vi.mocked(startLocalGenerate).mockResolvedValue("task-hang");
    const closeSpy = vi.fn();
    watchTaskMock.mockImplementation(() => closeSpy);

    /* 安全阀的定时器在 generateShot 内部创建：先开假时钟再发起。 */
    vi.useFakeTimers();
    await act(async () => {
      const pending = result.current.generateShot(result.current.shots[0]!);
      await vi.advanceTimersByTimeAsync(LOCAL_TASK_TIMEOUT_MS + 1_000);
      await pending;
    });
    vi.useRealTimers();

    expect(closeSpy).toHaveBeenCalled();
    expect(result.current.shots[0]!.status).toBe("failed");
    expect(result.current.notice).toContain("超时");
  });
});
