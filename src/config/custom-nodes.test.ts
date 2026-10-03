// @vitest-environment jsdom
/**
 * 浏览器侧自定义节点注册表的灌入与广播（台账 E9 的那条通道）。
 *
 * 这一层的旧现场是：`if (!res.ok) return 0` 把 404 / 401 / 500 一起吞成一个数字，
 * 而 `0` 又恰好是「解析器一个自定义节点都没找到」的合法结果 —— 于是三种完全不同的
 * 故障在界面上同形，唯一的痕迹是一句没人看的 `console.warn`。用例因此**不按函数
 * 分节，按「哪一档该说话」分节**：每一相各自钉住状态位、日志档位与广播次数。
 *
 * `emitAppEvent` / `subscribeAppEvent` 用**真实现**（不是桩件）：这条文件存在的
 * 一半理由就是证明派发端的事件名与订阅端吃得到 —— 拼错一个字符时桩件永远不会红。
 * 磁盘与网络才桩掉（`fetch` 给的是 Response 三态）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeAppEvent } from "~/lib/app-events";

import {
  CUSTOM_NODE_TYPES,
  getCustomNodesManifest,
  getCustomNodesRegistryState,
  getCustomNodesRegistryVersion,
  getCustomNodePackage,
  isCustomNode,
  refreshCustomNodes,
} from "./custom-nodes";

/** 一份最小可用清单：两个类型，其中一个带包名。 */
const TWO_NODES = {
  nodes: {
    "ComfyMath.Add": {
      classType: "ComfyMath.Add",
      displayName: "加法",
      category: "ComfyMath",
      package: "ComfyMath",
      inputs: [{ name: "a", type: "INT", required: true }],
      outputs: [{ name: "SUM", type: "INT" }],
    },
    "DaSiWa.Foo": {
      classType: "DaSiWa.Foo",
      displayName: "测试节点",
      category: "DaSiWa-Nodes/Sub",
    },
  },
};

/** 灌一份空清单（合法结果：解析器确实没找到任何自定义节点）。 */
const EMPTY_MANIFEST = { nodes: {} };

let errors: ReturnType<typeof spyOnConsoleError>;
let broadcasts: number;
let unsubscribe: (() => void) | null = null;

/** 把 `fetch` 换成一条固定结论：**每次调用现造**一份 Response。
 *
 * 正文是一次性的：把同一个 Response 对象喂给两次 `refreshCustomNodes()`，
 * 第二次的 `res.json()` 会抛「body already consumed」——于是「重复灌同一份清单
 * 不该广播」这条断言实际测到了另一件事（解析失败），还照样红得让人摸不着头脑。
 * 这个坑值得留字：桩件必须按「调用几次」而不是「给几个结论」来写。 */
function fetchReturns(status: number, body?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body === undefined ? "" : JSON.stringify(body), {
          status,
        }),
    ),
  );
}

/** 正文按原文给（用来造「200 但不是合法 JSON」那一档）。 */
function fetchReturnsText(status: number, text: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text, { status })),
  );
}

/** 请求压根没出去（离线 / dev server 刚重启 / 端口被回收）。 */
function fetchRejects(error: Error): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw error;
    }),
  );
}

/** 把 `console.error` 换成一只静默桩件。
 *
 * 类型从这个函数上取（`ReturnType<typeof …>`）：写成 `ReturnType<typeof vi.spyOn>`
 * 会退化成 `any`，于是 `.mock.calls` 那几处断言全在 `any` 上跑 —— 断言照样绿，
 * 但它判的东西没有任何类型兜着。 */
function spyOnConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

beforeEach(() => {
  errors = spyOnConsoleError();
  broadcasts = 0;
  unsubscribe = subscribeAppEvent("comfyapp:custom-nodes-updated", () => {
    broadcasts += 1;
  });
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  vi.unstubAllGlobals();
  errors.mockRestore();
});

describe("灌入成功：表 + 状态 + 广播三件一起对齐", () => {
  it("200 + 两个类型 → 返回 2、表被填、loaded:true、广播恰好一次", async () => {
    fetchReturns(200, TWO_NODES);
    const before = getCustomNodesRegistryVersion();
    await expect(refreshCustomNodes()).resolves.toBe(2);

    expect(Object.keys(CUSTOM_NODE_TYPES)).toEqual([
      "ComfyMath.Add",
      "DaSiWa.Foo",
    ]);
    expect(isCustomNode("ComfyMath.Add")).toBe(true);
    expect(getCustomNodesRegistryState()).toMatchObject({
      loaded: true,
      count: 2,
      detail: null,
    });
    expect(getCustomNodesRegistryVersion()).toBe(before + 1);
    expect(broadcasts).toBe(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it("包来源同步进 CUSTOM_NODE_PACKAGE：manifest 没给包名的类型查不到包", async () => {
    fetchReturns(200, TWO_NODES);
    await refreshCustomNodes();
    expect(getCustomNodePackage("ComfyMath.Add")).toBe("ComfyMath");
    // `DaSiWa.Foo` 的 manifest 条目没有 `package`，页脚查不到包名就是查不到 ——
    // 拿原始分类字符串冒充包名会让页脚显示 `DaSiWa-Nodes/Sub` 这种解析器的中间形。
    expect(getCustomNodePackage("DaSiWa.Foo")).toBeUndefined();
  });

  it("第二次灌入换了内容 → 表整体替换、不留上一次的残项", async () => {
    fetchReturns(200, TWO_NODES);
    await refreshCustomNodes();
    fetchReturns(200, { nodes: { "Only.One": { classType: "Only.One" } } });
    await refreshCustomNodes();
    expect(Object.keys(CUSTOM_NODE_TYPES)).toEqual(["Only.One"]);
    expect(getCustomNodePackage("ComfyMath.Add")).toBeUndefined();
    expect(getCustomNodesRegistryState().count).toBe(1);
  });

  /* 结论没变就不广播：自动刷新与手动重解析会反复命中同一份清单，
   * 不去重就是把 memo 掉的画节点一次次叫醒（口径同 `sync-notice` 的按原因去重）。 */
  it("重复灌同一份清单 → 第二次不广播、版本号不动", async () => {
    fetchReturns(200, TWO_NODES);
    await refreshCustomNodes();
    expect(broadcasts).toBe(1);
    const version = getCustomNodesRegistryVersion();
    await refreshCustomNodes();
    expect(broadcasts).toBe(1);
    expect(getCustomNodesRegistryVersion()).toBe(version);
  });

  /* 这一格是台账 E9 记的那处同形：0 有两个来源，界面上必须是两种话。 */
  it("200 但 nodes 为空 → loaded:true、count:0，与「没拿到清单」不同相", async () => {
    fetchReturns(200, EMPTY_MANIFEST);
    await expect(refreshCustomNodes()).resolves.toBe(0);
    const state = getCustomNodesRegistryState();
    expect(state.loaded).toBe(true);
    expect(state.count).toBe(0);
    expect(state.detail).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("失败三相：哪一档该说话", () => {
  it("404（还没解析过）→ loaded:false、版本不动，且**不打**错误日志", async () => {
    fetchReturns(404);
    const version = getCustomNodesRegistryVersion();
    await expect(refreshCustomNodes()).resolves.toBe(0);
    const state = getCustomNodesRegistryState();
    expect(state.loaded).toBe(false);
    expect(state.detail).toContain("解析");
    expect(getCustomNodesRegistryVersion()).toBe(version);
    // 首屏的正常态打进控制台会把用户的一次打开刷成错误流水（硬规则 4 要的是
    // 失败有出口，不是正常态冒充失败）
    expect(errors).not.toHaveBeenCalled();
  });

  it("401 / 403（未登录）→ 必须留痕：这一档用户能自己修", async () => {
    for (const status of [401, 403]) {
      fetchReturns(status);
      await refreshCustomNodes();
      expect(getCustomNodesRegistryState().detail).toContain("未登录");
    }
    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors.mock.calls.join("\n")).toContain("未登录");
  });

  it("别的状态码 → 说的是「取不到」而不是编一个原因", async () => {
    fetchReturns(500);
    await refreshCustomNodes();
    expect(getCustomNodesRegistryState().detail).toContain("HTTP 500");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("请求压根没出去（离线 / dev server 刚重启）→  detail 带连不上", async () => {
    fetchRejects(
      new Error("connect ECONNREFUSED 127.0.0.1:3100 (mock: 请求没出去)"),
    );
    await expect(refreshCustomNodes()).resolves.toBe(0);
    expect(getCustomNodesRegistryState().detail).toContain("连不上");
    expect(errors).toHaveBeenCalledTimes(1);
    /* 日志里是 `errorText()` 折出来的中文（「连接被拒绝或中断，应用服务可能尚未就绪」），
     * 不是裸 errno —— 这一档的话要说给用户，不是要说给排障的人。钉住它是为了
     * 挡掉日后「把 e.message 原样打出来更省事」的改法：那会让控制台出现
     * `connect ECONNREFUSED 127.0.0.1:3100` 这种用户读不懂、又指不出该做什么的行。 */
    const logged = errors.mock.calls.join("\n");
    expect(logged).toContain("连不上");
    expect(logged).not.toContain("ECONNREFUSED");
  });

  it("200 但正文不是合法 JSON → 「解析失败」这一档，不许冒充「空清单」", async () => {
    fetchReturnsText(200, "{不是 JSON");
    await expect(refreshCustomNodes()).resolves.toBe(0);
    const state = getCustomNodesRegistryState();
    expect(state.loaded).toBe(false);
    expect(state.detail).toContain("解析失败");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("连续命中同一档失败 → 只广播第一次（失败也要去重）", async () => {
    fetchReturns(404);
    await refreshCustomNodes();
    const afterFirst = broadcasts;
    await refreshCustomNodes();
    await refreshCustomNodes();
    expect(broadcasts).toBe(afterFirst);
    expect(errors).not.toHaveBeenCalled();
  });

  it("从失败翻回成功 → 版本号 +1 并广播（订阅侧要重算表）", async () => {
    fetchReturns(404);
    await refreshCustomNodes();
    const version = getCustomNodesRegistryVersion();
    const seen = broadcasts;
    fetchReturns(200, TWO_NODES);
    await refreshCustomNodes();
    expect(getCustomNodesRegistryVersion()).toBe(version + 1);
    expect(broadcasts).toBe(seen + 1);
  });
});

describe("清单里的形状边角（灌入侧的三条回落）", () => {
  /* 这三条不是补数字：注册表吃的是一份**外部生成的** JSON，解析器版本一不同
   * 就会交出缺字段的条目。`null` 那格尤其要紧 —— 整条节点是 null 时 `Object.entries`
   * 照样给出它，不跳就是后面 `n.displayName` 一句 TypeError、整次灌入失败。 */
  it("分类色命中 / 整条为 null 跳过 / 没有端口的节点 / 带控件的端口", async () => {
    fetchReturns(200, {
      nodes: {
        "P.Load": { classType: "P.Load", category: "loaders" },
        "P.Broken": null,
        "P.NoPorts": { classType: "P.NoPorts" },
        "P.Widget": {
          classType: "P.Widget",
          displayName: "控件节点",
          inputs: [
            {
              name: "mode",
              type: "COMBO",
              widget: "COMBO",
              options: ["a", "b"],
              default: "a",
            },
            { name: "steps", type: "INT" },
          ],
          outputs: [{ name: "OUT", type: "IMAGE" }],
        },
      },
    });
    const count = await refreshCustomNodes();
    expect(count).toBe(3);
    expect(Object.keys(CUSTOM_NODE_TYPES)).toEqual([
      "P.Load",
      "P.NoPorts",
      "P.Widget",
    ]);
    // 分类命中色表；displayName 缺席时按 classType 显示
    expect(CUSTOM_NODE_TYPES["P.Load"]?.color).toBe("#F59E0B");
    expect(CUSTOM_NODE_TYPES["P.Load"]?.label).toBe("P.Load");
    expect(CUSTOM_NODE_TYPES["P.NoPorts"]?.inputsSpec).toEqual([]);
    expect(CUSTOM_NODE_TYPES["P.Widget"]?.label).toBe("控件节点");
    const fields = CUSTOM_NODE_TYPES["P.Widget"]?.defaultFields ?? [];
    // 有 default 才写 placeholder：`String(undefined)` 会变成「undefined」这几个字
    expect(fields[0]?.placeholder).toBe("a");
    expect(fields[1]?.placeholder).toBeUndefined();
  });

  it("清单里一个 nodes 字段都没有（只有 packages）→ 灌入成功但 0 个类型", async () => {
    /* 这是 `buildInto(manifest.nodes ?? {})` 那一档：解析器换了顶层形状时，
     * 注册表会「成功灌入 0 个」。它和上面的空 nodes 同相（都是 loaded:true），
     * 与「没拿到清单」不同相 —— 钉住它是为了挡住日后把它改成 throw。 */
    fetchReturns(200, { packages: { ComfyMath: {} } });
    await expect(refreshCustomNodes()).resolves.toBe(0);
    expect(getCustomNodesRegistryState()).toMatchObject({
      loaded: true,
      count: 0,
    });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("预览卡那一路（getCustomNodesManifest）", () => {
  it("200 + nodes → 原样给出，供注册表未构建时渲染", async () => {
    fetchReturns(200, TWO_NODES);
    const manifest = await getCustomNodesManifest();
    expect(manifest?.nodes["ComfyMath.Add"]?.displayName).toBe("加法");
    expect(errors).not.toHaveBeenCalled();
  });

  it("404 → null 且不打日志（与刷新侧同一口径）", async () => {
    fetchReturns(404);
    await expect(getCustomNodesManifest()).resolves.toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it("500 → null 且留痕", async () => {
    fetchReturns(500);
    await expect(getCustomNodesManifest()).resolves.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("200 但没有 nodes 字段 → null，并说明是形状问题不是网络问题", async () => {
    // 解析器版本与前端不匹配时就是这个形状：响应 200、字段缺。
    // 让它冒充「空清单」会把「升级解析器」这件该做的事说成「没装自定义节点」。
    fetchReturns(200, { packages: {} });
    await expect(getCustomNodesManifest()).resolves.toBeNull();
    expect(errors.mock.calls.join("\n")).toContain("nodes");
  });

  it("nodes 是 null 也算形状不对，不当成「解析出 0 个」", async () => {
    fetchReturns(200, { nodes: null });
    await expect(getCustomNodesManifest()).resolves.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("请求没出去 → null + 留痕", async () => {
    fetchRejects(new TypeError("Failed to fetch (mock)"));
    await expect(getCustomNodesManifest()).resolves.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe("地址与载荷形状", () => {
  it("两条出口都打同一个地址 /api/custom-nodes/manifest", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        seen.push(String(input));
        return new Response(JSON.stringify(EMPTY_MANIFEST), { status: 200 });
      }),
    );
    await refreshCustomNodes();
    await getCustomNodesManifest();
    expect(seen).toEqual([
      "/api/custom-nodes/manifest",
      "/api/custom-nodes/manifest",
    ]);
  });

  it("传了 base 就拼在地址前（非同源部署时仍是一条链）", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        seen.push(String(input));
        return new Response(JSON.stringify(EMPTY_MANIFEST), { status: 200 });
      }),
    );
    await refreshCustomNodes("http://127.0.0.1:3100");
    expect(seen[0]).toBe("http://127.0.0.1:3100/api/custom-nodes/manifest");
  });

  /* 这条测的是「事件名有没有拼错」：派发端在 `recordRegistry`，订阅端在这儿。
   * 名字对不上时两边各自都「工作正常」，而画布的页脚永远不会重渲染 ——
   * 静态那一半由 `tests/app-event-pairing.test.ts` 判，这一条判的是真跑得通。 */
  it("广播走的是 comfyapp:custom-nodes-updated 这个名字", async () => {
    const names: string[] = [];
    const listener = (event: Event) => names.push(event.type);
    window.addEventListener("comfyapp:custom-nodes-updated", listener);
    fetchReturns(200, TWO_NODES);
    await refreshCustomNodes();
    window.removeEventListener("comfyapp:custom-nodes-updated", listener);
    expect(names).toEqual(["comfyapp:custom-nodes-updated"]);
  });
});
