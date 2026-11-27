// 工坊自动保存 vs AI 侧写入的冲突回归（ISSUE #5147）。
//
// 现场：AI 侧（自主 run / MCP 编排）把 6 场景 / 6 角色 / 19 镜写进 production，
// 界面那份是**挂载那一刻**从 localStorage 读进来的旧草稿（这三列全空）。此后界面
// 一编辑就自动保存 —— 此前载荷是整份草稿，于是同一行被整片盖成空，AI 刚写的东西
// 几秒内消失。本文件钉住修复后的三条判据：
//   ① 自动保存只发**用户真改过的字段**（那三列一个字节都不进载荷）；
//   ② 服务端比本机新时，挂载会采纳 AI 写的内容（用户看得见它们）；
//   ③ 用户没编辑时一拍都不发（旧行为是每 600ms 重发整份）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { createProject } from "~/lib/project-canvas/canvas-store";
import { isPlainRecord } from "~/lib/is-record";

vi.mock("~/lib/workshop/character-portrait-client", () => ({
  generateWorkflowPortrait: vi.fn(),
  generateRemotePortrait: vi.fn(),
  importPortraitFile: vi.fn(),
}));

/** AI 侧写完之后的 production 行（6 场景 / 6 角色 / 19 镜的缩小版）。 */
const AI_SCENES = [{ id: "sc1", heading: "场景1", shotCount: 1 }];
const AI_CHARACTERS = [{ id: "ch1", name: "小满" }];
const AI_SHOTS = [{ id: "sh1", index: 0, prompt: "AI 写的镜头" }];

/** 一次 PUT /api/production 的请求体。 */
type PutBody = { baseUpdatedAt?: unknown; production?: unknown; project?: unknown };

/** fetch 的入参 → URL 字符串（`mock.calls` 里是 `unknown[]`，逐层收窄，不断言）。 */
function callUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (input instanceof Request) {
    return input.url;
  }
  return "";
}

function readPutBodies(spy: ReturnType<typeof vi.fn>): Array<PutBody> {
  const out: Array<PutBody> = [];
  for (const call of spy.mock.calls) {
    const [input, init] = call as Array<unknown>;
    if (!callUrl(input).includes("/api/production")) {
      continue;
    }
    if (!isPlainRecord(init) || init.method !== "PUT") {
      continue;
    }
    const raw: unknown = init.body;
    if (typeof raw !== "string") {
      continue;
    }
    const parsed: unknown = JSON.parse(raw);
    if (isPlainRecord(parsed)) {
      out.push(parsed);
    }
  }
  return out;
}

/** 最后一个 PUT 的 `production` 载荷（形状不符时直接抛，报错里带原值）。 */
function lastPutPayload(spy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const puts = readPutBodies(spy);
  expect(puts.length).toBeGreaterThan(0);
  const last = puts.at(-1);
  if (!last || !isPlainRecord(last.production)) {
    throw new TypeError(`最后一个 PUT 载荷形状不符：${JSON.stringify(last)}`);
  }
  return last.production;
}

/** 记录所有请求，并按路径给出应答。 */
function stubFetch(productionRow: Record<string, unknown> | null) {
  const spy = vi.fn((input: RequestInfo | URL, init?: { method?: string }) => {
    const url = callUrl(input);
    if (url.includes("/api/production")) {
      if (init?.method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, stale: false, updatedAt: Date.now() }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify(
            productionRow === null
              ? { exists: false }
              : { exists: true, production: productionRow },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.includes("/api/workshop/draft")) {
      return Promise.resolve(
        new Response(JSON.stringify({ drafts: [], exists: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ skills: [], models: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** AI 侧写完的那一行（版本时刻相对 now 偏移）。 */
function aiRow(offsetMs: number): Record<string, unknown> {
  return {
    title: "AI 的项目",
    type: "short_video",
    tone: "悬疑",
    logline: "",
    scriptMarkdown: "# AI 写的剧本",
    scenes: AI_SCENES,
    characters: AI_CHARACTERS,
    shots: AI_SHOTS,
    progress: { stage: "script", rendered: false },
    updatedAt: new Date(Date.now() + offsetMs).toISOString(),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("工坊自动保存不覆盖 AI 侧写入（#5147）", () => {
  it("本机旧草稿为空、服务端已有 AI 内容 → 挂载后用户看得见那三列", async () => {
    createProject("冲突测试");
    stubFetch(aiRow(60_000));

    const { result } = renderHook(() => useWorkshopPipeline());
    /* 等服务端对账把 AI 那一份采纳进来（等的是 hook 的值 ⇒ `expect.poll`）。 */
    await vi.waitFor(() => {
      expect(result.current.characters).toHaveLength(1);
    });
    expect(result.current.scriptMarkdown).toBe("# AI 写的剧本");
    expect(result.current.scenes).toEqual(AI_SCENES);
    expect(result.current.characters).toEqual(AI_CHARACTERS);
    expect(result.current.shots).toEqual(AI_SHOTS);
  });

  it("挂载后用户只改剧本 → PUT 载荷里只有 scriptMarkdown，角色卡 / 场景 / 分镜不出现", async () => {
    createProject("冲突测试");
    const spy = stubFetch(aiRow(-60_000));

    const { result } = renderHook(() => useWorkshopPipeline());
    /* 先等服务端对账落定并采纳（落定前不放行自动保存，见 #4023）。 */
    await vi.waitFor(() => {
      expect(result.current.characters).toHaveLength(1);
    });

    /* 用户改剧本 —— 这是本单的现场：只有剧本是「界面那份有的那一项」。 */
    act(() => {
      result.current.setScriptMarkdown("# 用户改过的剧本");
    });
    /* 等 600ms 防抖那一拍真的发出 PUT（等的是「有没有发出」这个条件）。 */
    await vi.waitFor(() => {
      expect(readPutBodies(spy).length).toBeGreaterThan(0);
    });

    const payload = lastPutPayload(spy);
    expect(payload.scriptMarkdown).toBe("# 用户改过的剧本");
    /* 三列是 AI 写的、用户没碰 —— 缺键 = 不写。整份发就是 #5147 的复现。 */
    expect(Object.hasOwn(payload, "characters")).toBe(false);
    expect(Object.hasOwn(payload, "scenes")).toBe(false);
    expect(Object.hasOwn(payload, "shots")).toBe(false);
  });

  it("用户没做任何编辑 → 一拍自动保存都不发（旧行为是每 600ms 整片重发）", async () => {
    /* 这一格等的是「**一直没发生**的事」——条件轮询表达不了它（它能表达的只有
     * 「发生了」），所以必须走真时间窗（§11.14 ③）。1.2s 是 600ms 防抖的两倍：
     * 窗口内若会发，一定已经发过了。 */
    createProject("冲突测试");
    const spy = stubFetch(null);
    const { result } = renderHook(() => useWorkshopPipeline());
    // sleep-ok: 断言的是「窗口内一次都没发」（= 一直没发生的事），条件轮询表达不了
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(result.current.activeProjectId).not.toBe("");
    expect(readPutBodies(spy)).toHaveLength(0);
  });
});

/* ── 卸载兜底也走窄写入（#5147）──────────────────────────────
 *
 * 卸载不是「把整份状态同步过去」的理由：切页签 / 离开页面时那一次落盘同样
 * 只发用户改过的字段，否则 AI 写的内容会在「离开」这一跳被清掉 —— 那是同一
 * 个缺陷的第二个入口（600ms 防抖来不及跑时，卸载兜底就是唯一的那一次写）。
 */
describe("卸载兜底保存（#5147）", () => {
  it("挂载后只改剧本 → 卸载时的 PUT 仍只有 scriptMarkdown", async () => {
    createProject("卸载兜底");
    const spy = stubFetch(aiRow(-60_000));

    const { result, unmount } = renderHook(() => useWorkshopPipeline());
    await vi.waitFor(() => {
      expect(result.current.characters).toHaveLength(1);
    });

    act(() => {
      result.current.setScriptMarkdown("# 改完就切走");
    });
    /* 立刻卸载（早于 600ms 防抖）：卸载兜底是这一次唯一的落盘机会。 */
    unmount();

    const payload = lastPutPayload(spy);
    expect(payload.scriptMarkdown).toBe("# 改完就切走");
    expect(Object.hasOwn(payload, "characters")).toBe(false);
    expect(Object.hasOwn(payload, "shots")).toBe(false);
    expect(Object.hasOwn(payload, "scenes")).toBe(false);
  });
});
