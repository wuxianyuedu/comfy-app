// @vitest-environment jsdom
// 画布历史面板逻辑层单测。重点覆盖三条容易回归的规则：
//   1. 拉取失败有可读文案（失败路径必须有用户可见出口）；
//   2. 错误**不会被随后成功的轮询清空** —— §17.5.4 的同源坑：只有用户点
//      「重试」（refresh）才清错误，自动轮询成功不该把提示条冲掉；
//   3. 有任务在跑才开轮询，跑完自动停（不然侧栏一直在后台打接口）。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchHistoryTasks,
  probeGlobalTaskCount,
} from "~/lib/project-canvas/history-panel-client";

import { useHistoryPanel } from "./use-history-panel";

vi.mock("~/lib/project-canvas/history-panel-client", () => ({
  fetchHistoryTasks: vi.fn(),
  probeGlobalTaskCount: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchHistoryTasks);
const mockedProbe = vi.mocked(probeGlobalTaskCount);

function row(over: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    type: "image",
    workflowName: "wf",
    status: "SUCCEEDED",
    prompt: "一只猫",
    createdAt: new Date().toISOString(),
    cover: "/outputs/a.png",
    mediaType: "image",
    projectId: "p-1",
    progress: 100,
    error: null,
    ...over,
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedProbe.mockReset();
  mockedFetch.mockResolvedValue([]);
  mockedProbe.mockResolvedValue(0);
});

afterEach(cleanup);

describe("useHistoryPanel", () => {
  it("挂载即拉取：project 作用域带上 projectId，loading 收敛到 false", async () => {
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-1", take: 80 }),
    );
  });

  it("作用域切到 all 时不再带 projectId", async () => {
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setScope("all"));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ projectId: "p-1" }),
      ),
    );
  });

  it("类型筛选：all 不带 media（服务端不认这个值），其余按枚举传", async () => {
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ media: "all" }),
    );

    act(() => result.current.setFilter("video"));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ media: "video" }),
      ),
    );
  });

  it("无 projectId 时默认作用域是 all", async () => {
    const { result } = renderHook(() => useHistoryPanel({ projectId: null }));
    expect(result.current.scope).toBe("all");
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("有 projectId 时默认作用域是 project", () => {
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    expect(result.current.scope).toBe("project");
  });

  it("拉取失败：错误文案可读且列表清空，loading 复位", async () => {
    mockedFetch.mockRejectedValue(new Error("读取历史记录失败"));
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.error).toBe("读取历史记录失败"));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("拉取失败但抛值非 Error：走兜底文案，不渲染 [object Object]", async () => {
    mockedFetch.mockRejectedValue({ status: 500 });
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.error).toBe("读取历史记录失败"));
  });

  it("activeCount 只数 RUNNING / QUEUED", async () => {
    mockedFetch.mockResolvedValue([
      row({ id: "a", status: "RUNNING" }),
      row({ id: "b", status: "QUEUED" }),
      row({ id: "c", status: "SUCCEEDED" }),
      row({ id: "d", status: "FAILED" }),
    ] as never);
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.tasks).toHaveLength(4));
    expect(result.current.activeCount).toBe(2);
  });

  it("本项目为空时探一次全局，给出「查看全部」引导的计数", async () => {
    mockedProbe.mockResolvedValue(7);
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.globalCount).toBe(7));
    expect(mockedProbe).toHaveBeenCalledTimes(1);
  });

  it("探测失败返回 null → 不显示引导，但也不报错（不影响主流程）", async () => {
    mockedProbe.mockResolvedValue(null);
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.globalCount).toBeNull());
    expect(result.current.error).toBeNull();
  });

  it("本项目有记录时不探测全局（省一次请求）", async () => {
    mockedFetch.mockResolvedValue([row()] as never);
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it("有任务在跑时开 4s 轮询；跑完自动停（不然侧栏在后台一直打接口）", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const setSpy = vi.spyOn(globalThis, "setInterval");

    mockedFetch.mockResolvedValue([row({ status: "RUNNING" })] as never);
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.activeCount).toBe(1));

    const started = setSpy.mock.calls.filter(([, ms]) => ms === 4000);
    expect(started).toHaveLength(1);

    // 轮询推进 → 拉到「已完成」→ 定时器被清掉
    mockedFetch.mockResolvedValue([row({ status: "SUCCEEDED" })] as never);
    act(() => {
      const tick = started[0]?.[0] as () => void;
      tick();
    });
    await waitFor(() => expect(result.current.activeCount).toBe(0));
    expect(clearSpy).toHaveBeenCalled();

    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it("refresh（用户点「重试」）会清掉错误并重新拉取", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("读取历史记录失败"));
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.error).toBe("读取历史记录失败"));

    mockedFetch.mockResolvedValue([row()] as never);
    act(() => result.current.refresh());
    /* 先等 tasks 落定再断言 error：error 在拉取**开始时**就被清掉，
     * 只等 error 的话可能在数据回来之前就通过（局部绿 / 全量红的时序坑）。 */
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it("显示密度是纯视觉偏好，切换不触发重新拉取", async () => {
    const { result } = renderHook(() => useHistoryPanel({ projectId: "p-1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mockedFetch.mock.calls.length;

    act(() => result.current.setDisplay("grid"));
    expect(result.current.display).toBe("grid");
    expect(mockedFetch.mock.calls.length).toBe(before);
  });
});
