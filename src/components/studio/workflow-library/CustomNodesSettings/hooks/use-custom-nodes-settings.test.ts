// @vitest-environment jsdom
// CustomNodesSettings 逻辑层行为测试（ISSUE #318 的「先补护栏」步骤）。
//
// 为什么先补这一层：这个对话框的拆分已经做过一轮（1116 行 → 容器 73 +
// NodesTab 379 + hook 503 + parsing 纯函数），但 **hook 与容器没有任何行为
// 测试**。于是「解析失败要看得见」「打开/关闭要拉数据」「错误不会被下一次
// 成功拉取冲掉」这些规则全靠人读代码，改动容易静默回归。
//
// 本文件只测逻辑层（renderHook），不渲染视图——视图由 SettingsParts.test.tsx
// 与 NodesTab 承担。用例名直接写出「什么行为 → 什么可见结果」。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/config/custom-nodes", () => ({
  refreshCustomNodes: vi.fn().mockResolvedValue(undefined),
  getCustomNodesManifest: vi.fn().mockResolvedValue(null),
}));

import {
  getCustomNodesManifest,
  refreshCustomNodes,
} from "~/config/custom-nodes";
import { useCustomNodesSettings } from "./use-custom-nodes-settings";

const mockedManifest = vi.mocked(getCustomNodesManifest);
const mockedRefresh = vi.mocked(refreshCustomNodes);

/** 造一个 ndjson 响应（设置流 / 解析流共用）。 */
function ndjson(events: unknown[]): Response {
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 一个最小可用的「设置 blob」响应（缓存预热路径）。 */
function settingsBlob(over: Record<string, unknown> = {}) {
  // 注意展开顺序：settings 必须在最后合并，否则 `...over` 会把整个 settings
  // 字段覆盖成调用方传的片段（漏掉 localWorkflowPaths 等必需字段）。
  const { settings, ...rest } = over;
  return jsonResponse({
    summary: null,
    lastReport: null,
    discoveredByParent: {},
    byPath: {},
    ...rest,
    settings: {
      paths: ["D:/comfy/custom_nodes"],
      localWorkflowPaths: [],
      ...(settings as object | undefined),
    },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  mockedManifest.mockReset().mockResolvedValue(null);
  // refreshCustomNodes 的 mock 已由 vi.mock 工厂提供 resolved 实现，
  // 这里只重置调用记录，不再覆盖返回值（避免类型与 mock 工厂不一致）。
  mockedRefresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCustomNodesSettings — 打开/关闭与数据拉取", () => {
  it("默认关闭且不请求：对话框没打开就不该打接口", async () => {
    const { result } = renderHook(() => useCustomNodesSettings());
    expect(result.current.open).toBe(false);
    // 给 effect 的 setTimeout 一轮时间
    await act(async () => await new Promise((r) => setTimeout(r, 5)));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("打开时才拉设置与 manifest（关闭状态零请求）", async () => {
    fetchMock.mockResolvedValue(settingsBlob());
    const { result } = renderHook(() => useCustomNodesSettings());

    act(() => result.current.setOpen(true));

    // 完成信号是「数据落地」而不是 loading：loading 初值就是 false，
    // 用它会立刻通过、根本等不到请求回来（这是一类常见的空断言陷阱）。
    await waitFor(() =>
      expect(result.current.savedPaths).toEqual(["D:/comfy/custom_nodes"]),
    );
    // 首次拉取是 GET（无第二个参数）：读 /api/custom-nodes
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/custom-nodes");
    expect(mockedManifest).toHaveBeenCalled();
  });

  it("拉取完成后展开所有已配置父目录（用户一打开就能看到列表）", async () => {
    fetchMock.mockResolvedValue(
      settingsBlob({ settings: { paths: ["D:/a", "D:/b"] } }),
    );
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));

    await waitFor(() => expect(result.current.savedPaths).toHaveLength(2));
    expect(result.current.expandedParents["D:/a"]).toBe(true);
    expect(result.current.expandedParents["D:/b"]).toBe(true);
  });

  it("用户手动折叠过的父目录在重新拉取后仍保持折叠（不覆盖用户选择）", async () => {
    fetchMock.mockResolvedValue(settingsBlob());
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() => expect(result.current.savedPaths).toHaveLength(1));

    act(() =>
      result.current.setExpandedParents((prev) => ({
        ...prev,
        "D:/comfy/custom_nodes": false,
      })),
    );

    // 再拉一次：折叠状态必须保留
    await act(async () => {
      await result.current.onParseSingle("D:/comfy/custom_nodes/foo");
    });
    expect(result.current.expandedParents["D:/comfy/custom_nodes"]).toBe(false);
  });
});

describe("useCustomNodesSettings — 失败路径必须有可见出口", () => {
  it("服务端返回错误 blob（无 settings）→ saveErr 给出服务端原文", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "ComfyUI 路径未配置" } }, 500),
    );
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));

    await waitFor(() =>
      expect(result.current.saveErr).toContain("ComfyUI 路径未配置"),
    );
    // 错误必须是可读文案，不是 "Cannot read properties of undefined"
    expect(result.current.saveErr).not.toContain("undefined");
  });

  it("服务端返回裸字符串错误 → 同样透出可读原因", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "读取失败" }, 500));
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));

    await waitFor(() => expect(result.current.saveErr).toBeTruthy());
    expect(result.current.saveErr).toMatch(/读取失败|HTTP 500/);
  });

  it("网络层抛异常 → saveErr 兜底而不是静默（用户不会看到空白对话框）", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));

    await waitFor(() => expect(result.current.saveErr).toBeTruthy());
    expect(result.current.saveErr).toContain("读取配置失败");
    expect(result.current.loading).toBe(false);
  });

  it("扫描流里发 error 事件 → saveErr 显示「扫描失败：<原因>」", async () => {
    fetchMock.mockResolvedValue(
      ndjson([
        { type: "discover_start", parents: ["D:/x"] },
        { type: "error", message: "目录不存在" },
      ]),
    );
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));

    await waitFor(() => expect(result.current.saveErr).toBeTruthy());
    expect(result.current.saveErr).toBe("扫描失败：目录不存在");
  });
});

describe("useCustomNodesSettings — 解析流程（onParseAll / onParseSingle）", () => {
  it("未找到自定义节点目录时 onParseAll 直接给出可行动提示，不发请求", async () => {
    fetchMock.mockImplementation(async () =>
      settingsBlob({ settings: { paths: [] } }),
    );
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    // 本用例的响应本来就「没有目录」，等不到 savedPaths —— 改为等首次拉取完成
    // （fetch 已被调用 + 后续微任务排空）。
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => await new Promise((r) => setTimeout(r, 10)));

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.onParseAll();
    });

    expect(result.current.saveErr).toContain("设置 → 创作后端");
    // 只有初始拉取的那次，不该再发解析请求
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("解析成功后 parsing 归位、解析日志可见并刷新节点注册表", async () => {
    const report = { ok: true, packages: [] };
    // GET 永远返回「已配置一个目录」的 blob（保证 onParseAll 有 savedPaths 可解析），
    // 并在 lastReport 里带回服务端落库的报告 —— 这是解析完成后 report 的真实来源
    // （解析流的 done 事件也会 setReport，但随后的 reloadFromServer 会以服务端
    // 状态为准，见下条用例）。
    fetchMock.mockImplementation(async (_input, init?: RequestInit) => {
      const isParse = (init?.method ?? "GET").toUpperCase() === "POST";
      if (isParse) {
        return ndjson([
          { type: "log", level: "info", msg: "开始解析…" },
          { type: "log", level: "info", msg: "✔ 解析完成" },
          { type: "done", ok: true, report },
        ]);
      }
      return settingsBlob({ lastReport: report });
    });

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() =>
      expect(result.current.savedPaths.length).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.onParseAll();
      // readNdjson 用 `void onDone(...)` 触发收尾（不阻塞解析循环），
      // 这里给收尾链（refresh + reloadFromServer）一拍时间。
      await new Promise((r) => setTimeout(r, 20));
    });

    // 不留死状态：解析结束必须回 false，否则按钮永远显示「解析中」
    expect(result.current.parsing).toBe(false);
    // 解析流的 log 事件必须落到日志面板（用户看得见进度）
    expect(result.current.logs.map((l) => l.msg)).toEqual(
      expect.arrayContaining(["开始解析…"]),
    );
    // 解析完成后 report 必须有值（视图据此渲染报告卡），不能是 null
    expect(result.current.report).not.toBeNull();
    // 解析成功后必须刷新注册表，否则新导入的节点要硬刷新才出现
    expect(mockedRefresh).toHaveBeenCalled();
  });

  it("解析收尾以服务端状态为准：reloadFromServer 的 lastReport 会覆盖流里的 report", async () => {
    // 这条锁住 readNdjson → onDone → reloadFromServer 的时序契约：
    // 流里的 report 是「过程快照」，服务端落库后的才是权威结果。
    // 改坏这条会让界面显示过期的解析报告。
    const streamReport = { ok: true, packages: [{ from: "stream" }] };
    const serverReport = { ok: true, packages: [{ from: "server" }] };
    fetchMock.mockImplementation(async (_input, init?: RequestInit) =>
      (init?.method ?? "GET").toUpperCase() === "POST"
        ? ndjson([{ type: "done", ok: true, report: streamReport }])
        : settingsBlob({ lastReport: serverReport }),
    );

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() =>
      expect(result.current.savedPaths.length).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.onParseAll();
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(result.current.report).toEqual(serverReport));
  });

  it("解析失败（请求抛错）→ saveErr 有原因，parsing 归位", async () => {
    fetchMock.mockImplementation(async (_i, init) =>
      (init?.method ?? "GET").toUpperCase() === "POST"
        ? Promise.reject(new Error("boom"))
        : settingsBlob(),
    );

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() =>
      expect(result.current.savedPaths.length).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.onParseAll();
    });

    expect(result.current.saveErr).toContain("解析失败");
    expect(result.current.parsing).toBe(false);
  });

  it("单包解析：perPkgParsing 标记该包为进行中，结束后清除", async () => {
    fetchMock.mockImplementation(async (_i, init) =>
      (init?.method ?? "GET").toUpperCase() === "POST"
        ? ndjson([{ type: "done", ok: true, report: { ok: true } }])
        : settingsBlob(),
    );

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() =>
      expect(result.current.savedPaths.length).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.onParseSingle("D:/pkg/a");
    });

    // 结束后必须清掉，否则该包永远显示「解析中」
    expect(result.current.perPkgParsing["D:/pkg/a"]).toBeUndefined();
    // 且不该残留任何其它包的标记
    expect(Object.keys(result.current.perPkgParsing)).toHaveLength(0);
  });

  it("父目录下没有子包时 onParseAllParent 给出提示而不是空转", async () => {
    fetchMock.mockResolvedValue(settingsBlob());
    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() =>
      expect(result.current.savedPaths.length).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.onParseAllParent("D:/empty");
    });

    expect(result.current.saveErr).toContain("没有可解析的子包");
  });

  it("解析流缺 body（服务端未流式返回）→ 明确报错而不是挂住", async () => {
    const noBody = new Response(null, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
    fetchMock.mockImplementation(async (_i, init) =>
      (init?.method ?? "GET").toUpperCase() === "POST"
        ? noBody
        : settingsBlob(),
    );

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() =>
      expect(result.current.savedPaths.length).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.onParseAll();
    });

    expect(result.current.saveErr).toBeTruthy();
    expect(result.current.parsing).toBe(false);
  });
});

describe("useCustomNodesSettings — 派生数据（parentBlocks / 合计）", () => {
  it("按父目录分组，每组的计数来自各子包的行状态", async () => {
    fetchMock.mockResolvedValue(
      settingsBlob({
        settings: { paths: ["D:/p"] },
        discoveredByParent: {
          "D:/p": [
            {
              path: "D:/p/a",
              name: "a",
              parent: "D:/p",
              exists: true,
              packageFileCount: 1,
              contentHash: "h1",
              status: "ok",
            },
            {
              path: "D:/p/b",
              name: "b",
              parent: "D:/p",
              exists: true,
              packageFileCount: 1,
              contentHash: "h2",
              status: "ok",
            },
          ],
        },
        byPath: {
          "d:/p/a": {
            name: "a",
            path: "D:/p/a",
            status: "ok",
            nodeCount: 3,
            nodeTypes: [],
            errors: [],
            contentHash: "h1",
          },
        },
      }),
    );

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() => expect(result.current.parentBlocks).toHaveLength(1));

    const block = result.current.parentBlocks[0]!;
    expect(block.parent).toBe("D:/p");
    expect(block.total).toBe(2);
    // a 有 saved 且 hash 一致 → loaded；b 没 saved → unimported
    expect(block.cnt.loaded).toBe(1);
    expect(block.cnt.unimported).toBe(1);
  });

  it("合计跨父目录累加 loaded / outdated / unimported", async () => {
    fetchMock.mockResolvedValue(
      settingsBlob({
        settings: { paths: ["D:/p1", "D:/p2"] },
        discoveredByParent: {
          "D:/p1": [
            {
              path: "D:/p1/a",
              name: "a",
              parent: "D:/p1",
              exists: true,
              packageFileCount: 1,
              contentHash: "h",
              status: "ok",
            },
          ],
          "D:/p2": [
            {
              path: "D:/p2/b",
              name: "b",
              parent: "D:/p2",
              exists: true,
              packageFileCount: 1,
              contentHash: "h2",
              status: "ok",
            },
          ],
        },
        byPath: {
          "d:/p1/a": {
            name: "a",
            path: "D:/p1/a",
            status: "ok",
            nodeCount: 1,
            nodeTypes: [],
            errors: [],
            contentHash: "h",
          },
          "d:/p2/b": {
            name: "b",
            path: "D:/p2/b",
            status: "ok",
            nodeCount: 1,
            nodeTypes: [],
            errors: [],
            contentHash: "OLD",
          },
        },
      }),
    );

    const { result } = renderHook(() => useCustomNodesSettings());
    act(() => result.current.setOpen(true));
    await waitFor(() => expect(result.current.parentBlocks.length).toBe(2));

    expect(result.current.totalAcrossParents.total).toBe(2);
    expect(result.current.totalAcrossParents.loaded).toBe(1);
    expect(result.current.totalAcrossParents.outdated).toBe(1);
  });
});
