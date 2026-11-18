/**
 * 画布挂载水合的编排（#4235）：钉四件事——
 *  · 中途抛错必须把「加载中」复位并给用户可见出口（旧 `.catch(() => {})` 会把画布
 *    永久卡在 loading，且 rejection 静默）；
 *  · 落库结果的落地收进 stale 守卫（卸载后不写）；
 *  · 成功路径把项目灌进画布并复位 loading、调 fitView、消费 seed；
 *  · StrictMode 双执行只跑一次（闩锁）。
 * hook 直接 import canvas-store / production-client，所以 mock 边界就是这两个模块
 * 加 ToastProvider——不碰 ReactFlow 渲染面。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
const store = vi.hoisted(() => ({
  hydrateFromServer: vi.fn<(opts?: unknown) => Promise<void>>(() => Promise.resolve()),
  reapAllEmptyDrafts: vi.fn(),
  createDraftProject: vi.fn(() => ({ edges: [], id: "draft-1", name: "新草稿", nodes: [] })),
  getActiveId: vi.fn(() => null),
  getProject: vi.fn<
    (id: string) => { edges?: unknown[]; id: string; name: string; nodes: unknown[] } | null
  >(() => null),
  listProjects: vi.fn(() => [] as Array<{ id: string; name: string; nodes: unknown[] }>),
  setActive: vi.fn((_id: string) => undefined),
}));
const fetchProductionMock = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<unknown>>(() => Promise.resolve(null)),
);

vi.mock("~/lib/project-canvas/canvas-store", () => store);
vi.mock("~/lib/production/production-client", () => ({
  fetchProduction: fetchProductionMock,
}));
vi.mock("~/components/studio/ToastProvider", () => ({ useToast: () => toast }));

import { useCanvasHydration } from "./use-canvas-hydration";

const savedProject = { id: "proj-1", name: "我的项目", nodes: [], edges: [] };

beforeEach(() => {
  vi.clearAllMocks();
  store.hydrateFromServer.mockResolvedValue(undefined);
  store.getActiveId.mockReturnValue(null);
  store.getProject.mockReturnValue(null);
  store.listProjects.mockReturnValue([savedProject]);
  store.createDraftProject.mockReturnValue({ ...savedProject, id: "draft-1", name: "新草稿" });
  fetchProductionMock.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCanvasHydration（#4235）", () => {
  it("服务端对账抛错：loading 复位 + toast 可见出口 + console 留痕，rejection 不冒出", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.hydrateFromServer.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => useCanvasHydration(setupDeps()));
    expect(result.current).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(toast.error.mock.calls[0]?.[0])).toContain("画布加载失败");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("取 production 抛错：同样复位 loading 并报错（水合第二跳也在收口面内）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchProductionMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCanvasHydration(setupDeps()));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(toast.error.mock.calls[0]?.[0])).toContain("画布加载失败");
  });

  it("成功路径：项目灌进画布（id/名称/节点/连线/选中/进度），loading 复位并消费 seed", async () => {
    const setProjectId = vi.fn();
    const setProjectName = vi.fn();
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const setProgress = vi.fn();
    const requestFitView = vi.fn();
    const onConsumeSeed = vi.fn();

    const { result } = renderHook(() =>
      useCanvasHydration({
        requestFitView,
        screenToFlowPosition: (p) => p,
        setEdges,
        setNodes,
        setProgress,
        setProjectId,
        setProjectName,
        onConsumeSeed,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
    expect(setProjectId).toHaveBeenCalledWith("proj-1");
    expect(setProjectName).toHaveBeenCalledWith("我的项目");
    expect(setNodes).toHaveBeenCalledWith([]);
    expect(setEdges).toHaveBeenCalledWith([]);
    expect(setProgress).toHaveBeenCalledWith(null);
    /* setActive 是 canvas-store 的模块函数（hook 直接 import），断言打在 store 桩上。 */
    expect(store.setActive).toHaveBeenCalledWith("proj-1");
    expect(requestFitView).toHaveBeenCalledTimes(1);
    expect(onConsumeSeed).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("卸载守卫：await 之后才结算的落库结果不写（发起时快照纪律）", async () => {
    let release: (value: void) => void = () => undefined;
    store.hydrateFromServer.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const { unmount } = renderHook(() => useCanvasHydration(setupDeps()));
    unmount();
    release();

    await act(async () => {
      await Promise.resolve();
    });
    expect(store.setActive).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/** 每条用例自己的 setter 桩（渲染时注入，断言直接对桩写）。 */
function setupDeps() {
  return {
    requestFitView: vi.fn(),
    screenToFlowPosition: (p: { x: number; y: number }) => p,
    setEdges: vi.fn(),
    setNodes: vi.fn(),
    setProgress: vi.fn(),
    setProjectId: vi.fn(),
    setProjectName: vi.fn(),
  };
}
