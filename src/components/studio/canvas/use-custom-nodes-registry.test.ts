// @vitest-environment jsdom
/**
 * `useCustomNodesRegistryVersion()` —— 注册表灌入到「画布节点该重算了」的那一跳。
 *
 * 为什么单独测这一格：`FlowNode` 是 `React.memo` 的，父层重渲染穿不进它的记忆化，
 * 而它下面的包名页脚与调试态渲染链读的是 `~/config/custom-nodes` 里**就地替换**的
 * 可变 map。表换了、读它的组件没被告知 —— 「解析完不重进页面就不更新」（台账 E9）
 * 就是这么来的。所以这里判的不是「hook 返回什么」，而是**订阅真的能把 memo 叫醒**。
 *
 * 灌入走真的 `refreshCustomNodes()`（只桩 `fetch`）：这一条同时验事件名、
 * 版本号语义与 `useSyncExternalStore` 的挂载首读，任何一环拼错都会红。
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshCustomNodes } from "~/config/custom-nodes";

import { useCustomNodesRegistryVersion } from "./use-custom-nodes-registry";

/** 每次调用现造一份 Response：正文是一次性的，复用会让第二次 `json()` 抛。 */
function fetchManifest(manifest: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
  );
}

function manifestOf(classTypes: string[]): unknown {
  return {
    nodes: Object.fromEntries(
      classTypes.map((ct) => [ct, { classType: ct, displayName: ct }]),
    ),
  };
}

let renders = 0;
/** 只数这一条事件名上的调用：`useSyncExternalStore` 的订阅与退订必须一一成对，
 *  数量与「节点数 × 渲染次数」相乘就是泄漏。 */
const REGISTRY_EVENT = "comfyapp:custom-nodes-updated";
/* 桩件默认**透传**真实现，所以这里只「数」不「改」—— 改了的订阅不会真的挂上，
 *  后面那些「灌入把 memo 叫醒」的断言就全成了自说自话。 */
const spyOnAdd = () => vi.spyOn(window, "addEventListener");
const spyOnRemove = () => vi.spyOn(window, "removeEventListener");
let addSpy: ReturnType<typeof spyOnAdd>;
let removeSpy: ReturnType<typeof spyOnRemove>;

const countOn = (calls: Array<[string, ...unknown[]]>): number =>
  calls.filter((call) => call[0] === REGISTRY_EVENT).length;
const addCalls = (): number => countOn(addSpy.mock.calls);
const removeCalls = (): number => countOn(removeSpy.mock.calls);

beforeEach(() => {
  renders = 0;
  addSpy = spyOnAdd();
  removeSpy = spyOnRemove();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("挂载首读：错过最早那次广播也要拿到当前结论", () => {
  it("先灌一次再挂载 → 返回值已经是新版本（不是 0）", async () => {
    // 最早的一次灌入发生在画布挂载的 effect 里，那一刻订阅还没建立 ——
    // 「只订阅不读表」的写法在这里就会拿到 0，而且永远说不清是谁的锅。
    fetchManifest(manifestOf(["A.One", "A.Two"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    const { result } = renderHook(() => {
      renders += 1;
      return useCustomNodesRegistryVersion();
    });
    expect(result.current).toBeGreaterThan(0);
  });
});

describe("灌入 → memo 掉的读方被叫醒", () => {
  it("灌入一份新清单 → 版本号 +1，且组件真的重渲染了", async () => {
    fetchManifest(manifestOf(["B.One"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    const { result } = renderHook(() => {
      renders += 1;
      return useCustomNodesRegistryVersion();
    });
    const before = result.current;
    const rendersBefore = renders;

    fetchManifest(manifestOf(["B.One", "B.Two", "B.Three"]));
    await act(async () => {
      await refreshCustomNodes();
    });

    expect(result.current).toBe(before + 1);
    expect(renders).toBeGreaterThan(rendersBefore);
  });

  it("重复灌同一份清单 → 一次渲染都不多花（去重传导到订阅侧）", async () => {
    const manifest = manifestOf(["C.One", "C.Two"]);
    fetchManifest(manifest);
    await act(async () => {
      await refreshCustomNodes();
    });
    const { result } = renderHook(() => {
      renders += 1;
      return useCustomNodesRegistryVersion();
    });
    const settled = renders;

    await act(async () => {
      await refreshCustomNodes();
      await refreshCustomNodes();
    });
    expect(renders).toBe(settled);
    expect(result.current).not.toBe(0);
  });

  /* 画布上同时挂着几十个 memo 节点，每个都调这一句。它们共享同一条事件，
   * 所以一次灌入必须把**每一个**活着的订阅者都叫醒 —— 只叫醒第一个的写法
   * （比如把结论塞进某个单例回调）在现场表现为「滚到的那些节点页脚是旧的」。
   * 判据取「每个订阅者各自看到的最后一版」，不取渲染次数：React 对 store 变化
   * 可能渲染不止一轮，数次数是把实现细节当契约。 */
  it("多个订阅者各自都被叫醒", async () => {
    fetchManifest(manifestOf(["D.One"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    const seenA: number[] = [];
    const seenB: number[] = [];
    const a = renderHook(() => {
      const version = useCustomNodesRegistryVersion();
      seenA.push(version);
      return version;
    });
    const b = renderHook(() => {
      const version = useCustomNodesRegistryVersion();
      seenB.push(version);
      return version;
    });
    expect(addCalls()).toBe(2);
    const version = a.result.current;

    fetchManifest(manifestOf(["D.One", "D.Two"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    expect(seenA[seenA.length - 1]).toBe(version + 1);
    expect(seenB[seenB.length - 1]).toBe(version + 1);
    // 两位读到的**当前值**也一致：快照函数按引用取，不存在「一个看到一个没看到」
    expect(a.result.current).toBe(b.result.current);
    expect(seenA.length).toBeGreaterThan(1);
    expect(seenB.length).toBeGreaterThan(1);
  });
});

describe("失败相不许把画布叫醒", () => {
  it("404（还没解析过）→ 版本号不动、零重渲染", async () => {
    fetchManifest(manifestOf(["E.One"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    const { result } = renderHook(() => {
      renders += 1;
      return useCustomNodesRegistryVersion();
    });
    const settled = renders;
    const version = result.current;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await act(async () => {
      await refreshCustomNodes();
    });
    // 失败档 version 不 +1（`recordRegistry` 只在 loaded 时递增）：
    // 自动刷新反复命中同一档失败时，不该把几百个 memo 节点一次次叫醒。
    expect(result.current).toBe(version);
    expect(renders).toBe(settled);
  });
});

describe("订阅的生命周期", () => {
  it("订阅函数引用稳定：rerender 不会退订再订阅", () => {
    const { rerender } = renderHook(() => useCustomNodesRegistryVersion());
    const afterMount = addCalls();
    rerender();
    rerender();
    expect(addCalls()).toBe(afterMount);
    expect(removeCalls()).toBe(0);
  });

  it("卸载时退订，订阅与退订一一成对（不留泄漏的监听器）", async () => {
    fetchManifest(manifestOf(["F.One"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    const { unmount } = renderHook(() => useCustomNodesRegistryVersion());
    expect(addCalls()).toBe(1);
    unmount();
    expect(removeCalls()).toBe(1);
  });

  it("退订之后再灌入不报错：没有监听器接住就是 no-op", async () => {
    const { unmount } = renderHook(() => useCustomNodesRegistryVersion());
    unmount();
    fetchManifest(manifestOf(["G.One", "G.Two"]));
    await act(async () => {
      await refreshCustomNodes();
    });
    // 抛了 = 退订摘掉的是别的引用（`subscribeRegistry` 每次渲染新建一个函数），
    // 那也是这条 hook 文件头专门写「要稳定引用」的原因。
    expect(removeCalls()).toBe(addCalls());
  });
});
