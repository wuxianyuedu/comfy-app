// 侧栏「ComfyUI」页逻辑层单测（ISSUE #1900）。
//
// 这组用例从 `use-settings-page.test.ts` 搬来 —— 那些行为（运行态订阅 / 启动关闭 /
// 打开查看 / 启动日志的会话切换）自 ISSUE #1900 起归这一页，**判据一条没少**：
// 每一条都钉着一个静默失效的形态（界面照常渲染、只是不再刷新 / 不再跟随 /
// 提示词停在旧名字上），断言的是编排行为而不是实现细节。
//
// 与搬迁前的两处口径差异（都是这一页自己的选择，不是放松判据）：
//   · 反馈通道从设置页的整页提示条（`flash`）换成 toast —— 本页是普通视图，
//     动作结果是「这一刻」的事；
//   · 启动动作**不再先保存草稿**（本页没有草稿；配置在设置页保存），
//     所以没有「草稿落库参数」那一组断言。
//
// hook 走真实 tRPC React 客户端（`trpc.setting.*`），由 MSW 转发到可控测试 router。

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { http, HttpResponse } from "msw/http";
import SuperJSON from "superjson";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "../../../../../tests/helpers/renderWithProviders";
import { createTestTRPC, testTrpcEndpoint } from "../../../../../tests/helpers/test-trpc";
import { setupTrpcServer } from "../../../../../tests/helpers/trpc-msw";
import { TRPCProvider, createTrpcClient } from "~/trpc/react";
import { useShellTabs, MAIN_TAB_ID } from "~/lib/shell/shell-tabs-store";
import { resetComfyStateClientForTest } from "~/lib/comfy/comfy-state-client";
import {
  getComfyStateChange,
  noteComfyStateChange,
  resetComfyStateWatchForTest,
} from "~/lib/comfyui/state-watch";

import { useComfyuiControl } from "./use-comfyui-control";

/* 反馈通道：这一页用 toast（设置页那一版用整页提示条）。`useToast` 是
 * `ToastProvider` 的 context hook，而这里 renderHook 只包 tRPC —— 于是把它
 * 换成一对记账函数。断言的是「报了没有、报的哪一句」，与真 toast 的渲染无关
 * （那由 ToastProvider 自己的用例覆盖）。 */
const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn<(title: string, description?: string) => void>(),
  toastErrorMock: vi.fn<(title: string, description?: string) => void>(),
}));
vi.mock("~/components/studio/ToastProvider", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    info: vi.fn(),
    loading: vi.fn(),
    toast: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

/* 桌面壳探测：默认 true（壳内），让「打开查看 → 内嵌页签」那组用例继续走原路径。
 * 浏览器形态用例（新浏览器页签）在 beforeEach 里把它翻成 false。 */
const { isDesktopShellMock } = vi.hoisted(() => {
  const impl: () => boolean = () => true;
  return { isDesktopShellMock: vi.fn(impl) };
});
vi.mock("~/lib/shell/desktop-shell-client", () => ({
  isDesktopShell: isDesktopShellMock,
}));

/* 启动日志「按会话取」的请求记账（来源 + 请求的会话 id）—— 「下拉切过去要
 * 真带上那一次的 id」这条判据靠它。 */
const { sessionLogRequests } = vi.hoisted(() => ({
  sessionLogRequests: /* SAFETY: 类型断言已复核 */ [] as Array<{
    source: string;
    session: string | null;
  }>,
}));
vi.mock("~/lib/log/log-file-client", () => {
  /* fetchLogSessions 复刻真实实现（走全局 fetch，由 MSW 拦截返回会话正文）。
   * 不引用 importOriginal：真实实现只是对端点的一次 fetch，这里等价转发。 */
  const fetchLogSessions = vi.fn(async (source: string, sessionId?: string) => {
    sessionLogRequests.push({ source, session: sessionId ?? null });
    const query = new URLSearchParams({ source });
    if (sessionId) query.set("session", sessionId);
    const res = await fetch(`/api/logs/sessions?${query.toString()}`);
    if (!res.ok) return null;
    return /* SAFETY: 类型断言已复核 */ (await res.json()) as unknown;
  });
  return {
    fetchFileLogSlice: vi.fn(async () => null),
    fetchLogSessions,
    postAppRuntimeLog: vi.fn(async () => undefined),
  };
});

interface Behavior {
  comfyStart?: { ok: boolean; detail: string };
  /** comfyui.status 返回的 base（非空即「运行中」，供「打开查看」使用）。 */
  comfyBase?: string | null;
  /** comfyui.status 返回的**已保存**路径（启动动作实际会用的那一条）。 */
  comfyPath?: string;
  /** comfyEmbeddable 探测结论（决定页签里渲染 iframe 还是可读说明）。 */
  comfyEmbeddable?: { embeddable: boolean; reason: string };
  /** comfyOpen（在浏览器打开）的返回文案；默认成功。 */
  comfyOpen?: { ok: boolean; detail: string };
  comfyInstance?: {
    pathConfigured: boolean;
    instanceType: "desktop" | "portable" | "venv" | null;
    desktopManaged: boolean;
  };
}

let behavior: Behavior = {};
/* comfyStatus 端点的调用次数：「事件到了要立刻重问一次」那条判据靠它数。 */
let comfyStatusCalls = 0;
/* 「运行态变了」那条长轮询通道收到的请求（`?since=…`）：判「有没有订阅」。 */
const stateRequests: string[] = [];
/** 只给用例：这条通道此刻收到的查询串（每次用例前清空）。 */
function comfyStateRequests(): string[] {
  return [...stateRequests];
}
/* 「在浏览器打开」端点的调用计数：单独一个模块级变量，不放进 behavior ——
 * 每个用例都会整体重置 behavior，塞进去就得在每一处重置点重复，容易漏。 */
let comfyOpenCalls = 0;

const t = createTestTRPC();
const mockRouter = t.router({
  setting: t.router({
    comfyStatus: t.procedure.query(async () => {
      comfyStatusCalls += 1;
      return {
        up: behavior.comfyBase != null,
        base: behavior.comfyBase ?? null,
        starting: false,
        /* 库里已保存的路径：启动动作按它拉起，视图把它写在页上（ISSUE #1900
         * 那条「改了路径没保存」的可见解）。 */
        path: behavior.comfyPath ?? "D:\\ComfyUI",
      };
    }),
    /* 安装形态与运行态**分开取**（fs-only，与首屏配置同批）：这里给一份便携版默认。 */
    comfyInstance: t.procedure.query(
      () =>
        behavior.comfyInstance ?? {
          pathConfigured: true,
          instanceType: /* SAFETY: 类型断言已复核 */ "portable" as const,
          desktopManaged: false,
        },
    ),
    comfyEmbeddable: t.procedure.query(
      () =>
        behavior.comfyEmbeddable ?? {
          embeddable: true,
          reason: "ComfyUI 已开启 CORS",
        },
    ),
    comfyStart: t.procedure.mutation(() => behavior.comfyStart ?? { ok: true, detail: "已启动" }),
    comfyStop: t.procedure.mutation(() => ({
      ok: true,
      detail: "已关闭",
    })),
    comfyOpen: t.procedure.mutation(() => {
      comfyOpenCalls += 1;
      return (
        behavior.comfyOpen ?? {
          ok: true,
          detail: "已用系统默认浏览器打开 ComfyUI",
        }
      );
    }),
  }),
});

const server = setupTrpcServer(mockRouter);

function makeWrapper(queryClient?: QueryClient) {
  const qc = queryClient ?? createTestQueryClient();
  const client = createTrpcClient({
    links: [
      httpBatchStreamLink({
        transformer: SuperJSON,
        url: testTrpcEndpoint(),
      }),
    ],
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: qc },
      // eslint-disable-next-line react/no-children-prop -- createElement 的第三参即 children
      createElement(TRPCProvider, {
        trpcClient: client,
        queryClient: qc,
        children,
      }),
    );
  };
}

/**
 * 让 `/api/logs/sessions` 对某个来源回一份会话（其余来源仍走默认空 handler）。
 * 载荷与真实契约同形：会话列表 + 选中会话正文 + 截断 / 尾窗标记。
 */
function mockSessionsFor(
  source: string,
  payload: {
    content: string;
    sessions?: Array<{
      id: string;
      title: string;
      startedAt: number | null;
      scope: "current" | "runs";
      crashed: boolean;
    }>;
    truncated?: boolean;
    windowed?: boolean;
  },
): void {
  const sessions = payload.sessions ?? [
    {
      id: "0",
      title: "11-05 09:36:12 · 本次运行",
      startedAt: null,
      scope: /* SAFETY: 类型断言已复核 */ "current" as const,
      crashed: false,
    },
  ];
  server.use(
    http.get("*/api/logs/sessions", ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("source") !== source) {
        return HttpResponse.json({ error: "unexpected source" }, { status: 400 });
      }
      return HttpResponse.json({
        sessions,
        /* 契约：`sessions` 新→旧，缺省选中第一项（最新那一份）。 */
        selectedId: sessions[0]?.id ?? null,
        content: payload.content,
        truncated: payload.truncated ?? false,
        windowed: payload.windowed ?? false,
        size: payload.content.length,
      });
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  sessionLogRequests.length = 0;
  comfyStatusCalls = 0;
  stateRequests.length = 0;
  /* 客户端那条长轮询链与「已见 seq」都挂在 `globalThis` 上（HMR 单例）：不清
   * 会让上一个用例的订阅与 seq 带进来 —— 表现是这一条用例压根不订阅（链还在），
   * 或第一条变化被当成「见过」而不派发。 */
  resetComfyStateClientForTest();
  resetComfyStateWatchForTest();
  isDesktopShellMock.mockReturnValue(true);
  server.use(
    http.get("*/api/logs/sessions", () =>
      HttpResponse.json({
        sessions: [],
        selectedId: null,
        content: "",
        truncated: false,
        windowed: false,
        size: 0,
      }),
    ),
    /* 「运行态变了」那条长轮询通道：默认永远回 204（没有变化）。不装 handler
     * 的话，只要用例渲染了这一页，客户端那一轮长轮询就会以
     * `onUnhandledFrame: error` 抛 unhandled InternalError。 */
    http.get("*/api/comfy/state", ({ request }) => {
      const since = Number.parseInt(new URL(request.url).searchParams.get("since") ?? "0", 10);
      stateRequests.push(new URL(request.url).search);
      /* 与真实路由同一判决：`since` 比当前纪元旧 → 回那一次变化，否则 204。 */
      const change = getComfyStateChange();
      if (change.last === null || change.seq <= since) {
        return new HttpResponse(null, { status: 204 });
      }
      return HttpResponse.json(change.last);
    }),
  );
});
afterEach(() => {
  cleanup();
  behavior = {};
  comfyOpenCalls = 0;
  comfyStatusCalls = 0;
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  server.resetHandlers();
});

describe("useComfyuiControl", () => {
  /* ── 运行态变化：事件到了立刻重问一次 ────────────────────────────────
   * 5s 轮询换成「事件驱动为主、低频兜底」之后，**判据就是这条**：服务端一变
   * （启动 / 就绪 / 关闭 / 退出 / 配置写入），设置页必须立刻重问状态，
   * 而不是等下一拍。这条用例把「订阅真的接上了」钉死 —— 只断言「轮询变 30s」
   * 的话，一个把订阅漏接的实现在用例里是全绿的（界面变成要等半分钟）。 */
  it("服务端报了运行态变化 → 立刻重问一次状态（不等兜底轮询）", async () => {
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();
    const before = comfyStatusCalls;

    /* 服务端那侧真报一次变化：handler 把当前快照发给客户端，与真实服务端
     * 同一口径（`?since=` 比当前纪元旧 → 回那一次变化）。 */
    await act(async () => {
      noteComfyStateChange("ready", "ComfyUI 已就绪");
      window.dispatchEvent(new Event("focus"));
    });

    await expect.poll(() => comfyStatusCalls).toBeGreaterThan(before);
  });

  /* 「这一点下去会按哪条路径启动」的事实来源：服务端 `comfyStatus` 里那一格
   * 「库里已保存的路径」必须**投影到 controller**，否则视图写不出来 —— 而视图
   * 写不出来时，「在设置页改了路径没保存、来这边点启动」就没人告诉用户跑的是谁
   * （本页无草稿，这一格是唯一事实出口）。 */
  it("已保存路径投影到 status.path（视图据此写明「会按哪条启动」）", async () => {
    behavior = { comfyBase: "http://127.0.0.1:8188", comfyPath: "E:\\ComfyUI" };
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();
    expect(result.current.status?.path).toBe("E:\\ComfyUI");
  });

  /* 这一页是**独享**状态查询的屏：它一挂载就该订阅（不像设置页那一版要等首屏
   * 两份配置就绪才敢发探测 —— 那时设置页还背着「首屏只需要的 get/configGet 会被
   * 并进同一批请求」的成本）。判据取「挂载之后这条通道真被连上」，它比断言内部
   * 状态更贴近契约：连都没连，事件自然也无从谈起。 */
  it("这一页一挂载就连上运行态通道（不必等别的屏的配置）", async () => {
    renderHook(() => useComfyuiControl(), { wrapper: makeWrapper() });
    await expect.poll(() => comfyStateRequests().length).toBeGreaterThan(0);
  });

  it("ComfyUI 启动：后端返回 detail 直接进提示条", async () => {
    behavior = { comfyStart: { ok: false, detail: "未找到 main.py" } };
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();

    await act(async () => {
      await result.current.startComfy();
    });
    expect(toastErrorMock).toHaveBeenCalledWith("未找到 main.py");
    expect(result.current.starting).toBe(false);
  });

  it("comfyLog.refresh 拉取 comfyui-runtime 的会话日志，未启动时不在跟随态", async () => {
    mockSessionsFor("comfyui-runtime", {
      content: "[spawn] pid=123 cmd=python.exe\n[out] Starting ComfyUI\n",
    });
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();

    await act(async () => {
      await result.current.log.refresh();
    });
    expect(result.current.log.text).toContain("[spawn] pid=123");
    expect(result.current.log.active).toBe(false);
  });

  /* 用户反馈第 2 条：多次启动的日志不能混在一起 —— 下拉切到某一次启动时，
   * 请求要带上那次的会话 id，界面只显示那一次。 */
  it("切换启动会话：按会话 id 重新拉取，并把选中项与截断提示同步到状态", async () => {
    /* 契约：新→旧（第一项是最新那一份）。 */
    const sessions = [
      {
        id: "40",
        title: "11-05 09:36:12 · 本次运行",
        startedAt: null,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
      {
        id: "12",
        title: "11-05 09:30:00 · 本次运行",
        startedAt: null,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
    ];
    server.use(
      http.get("*/api/logs/sessions", ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session");
        return HttpResponse.json({
          sessions,
          selectedId: session ?? "40",
          content: session === "12" ? "第一次启动的输出" : "第二次启动的输出",
          truncated: session === "12",
          windowed: true,
          size: 8192,
        });
      }),
    );
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();
    await expect.poll(() => result.current.log.text).not.toBe("");
    expect(result.current.log.sessions).toHaveLength(2);

    await act(async () => {
      result.current.log.selectSession("12");
    });
    await expect.poll(() => result.current.log.text).toBe("第一次启动的输出");
    expect(result.current.log.sessionId).toBe("12");
    expect(result.current.log.truncated).toBe(true);
    expect(result.current.log.windowed).toBe(true);
    expect(sessionLogRequests).toContainEqual({
      source: "comfyui-runtime",
      session: "12",
    });
  });

  /* 用户反馈：启动后有新日志时要自动切到下拉里的最新一项，而不是停在旧会话。 */
  it("新一轮启动出现（会话列表多出最新一项）时自动切过去，无需手动换下拉", async () => {
    /* 会话列表可变：先只有一次启动，随后模拟新一次启动写入横幅。 */
    let sessions = [
      {
        id: "12",
        title: "11-05 09:30:00 · 本次运行",
        startedAt: 1_000,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
    ];
    server.use(
      http.get("*/api/logs/sessions", ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session");
        /* 契约：新→旧，第一项即最新。 */
        const latestId = sessions[0]!.id;
        const selectedId = sessions.some((s) => s.id === session) ? session : latestId;
        return HttpResponse.json({
          sessions,
          selectedId,
          content: selectedId === "12" ? "第一次启动的输出" : "第二次启动的输出",
          truncated: false,
          windowed: false,
          size: 128,
        });
      }),
    );
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();
    await expect.poll(() => result.current.log.text).toBe("第一次启动的输出");

    /* 新→旧：新一轮启动排在**最上面**（与真实端点同序）。 */
    sessions = [
      {
        id: "40",
        title: "11-05 09:36:12 · 本次运行",
        startedAt: 2_000,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
      {
        id: "12",
        title: "11-05 09:30:00 · 本次运行",
        startedAt: 1_000,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
    ];
    await act(async () => {
      await result.current.log.refresh();
    });
    await expect.poll(() => result.current.log.text).toBe("第二次启动的输出");
    expect(result.current.log.sessionId).toBe("40");
    expect(sessionLogRequests).toContainEqual({
      source: "comfyui-runtime",
      session: "40",
    });
  });

  /* 跨包（ISSUE #1587）：归档份的 id 是 `<包名>/<文件名>`，hook 必须**原样**
   * 回传 —— 它不解析 id（形态判据只在服务端一处），也不该把它当成文件名拼一遍。 */
  it("切到归档包里的份：原样带上 `<包名>/<文件名>` 的 id 重新拉取", async () => {
    const archived = "2026-10-04_140000-bbbbbb/comfyui-runtime-20261004-140000.log";
    const sessions = [
      {
        id: "comfyui-runtime-20261005-093612.log",
        title: "10-05 09:36:12 · 本次运行",
        startedAt: 2_000,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
      {
        id: archived,
        title: "10-04 14:00:00 · 正常退出 · bbbbbb",
        startedAt: 1_000,
        scope: /* SAFETY: 类型断言已复核 */ "runs" as const,
        crashed: false,
      },
    ];
    server.use(
      http.get("*/api/logs/sessions", ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session");
        const selectedId = sessions.some((s) => s.id === session) ? session! : sessions[0]!.id;
        return HttpResponse.json({
          sessions,
          selectedId,
          content: selectedId === archived ? "上一包的内容" : "本次运行的内容",
          truncated: false,
          windowed: false,
          size: 64,
        });
      }),
    );
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.log.text).toBe("本次运行的内容");

    await act(async () => {
      result.current.log.selectSession(archived);
    });
    await expect.poll(() => result.current.log.text).toBe("上一包的内容");
    expect(result.current.log.sessionId).toBe(archived);
    /* id 原样回传（没有被拆成文件名、也没有被拼上路径） */
    expect(sessionLogRequests).toContainEqual({
      source: "comfyui-runtime",
      session: archived,
    });
  });

  it("没有新启动时保持用户选中的旧会话，不因轮询被顶回最新", async () => {
    /* 契约：新→旧（第一项是最新那一份）。 */
    const sessions = [
      {
        id: "40",
        title: "11-05 09:36:12 · 本次运行",
        startedAt: 2_000,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
      {
        id: "12",
        title: "11-05 09:30:00 · 本次运行",
        startedAt: 1_000,
        scope: /* SAFETY: 类型断言已复核 */ "current" as const,
        crashed: false,
      },
    ];
    server.use(
      http.get("*/api/logs/sessions", ({ request }) => {
        const url = new URL(request.url);
        const session = url.searchParams.get("session");
        return HttpResponse.json({
          sessions,
          selectedId: sessions.some((s) => s.id === session) ? session : "40",
          content: session === "12" ? "第一次启动的输出" : "第二次启动的输出",
          truncated: false,
          windowed: false,
          size: 128,
        });
      }),
    );
    const { result } = renderHook(() => useComfyuiControl(), {
      wrapper: makeWrapper(),
    });
    await expect.poll(() => result.current.status).not.toBeNull();
    await act(async () => {
      result.current.log.selectSession("12");
    });
    await expect.poll(() => result.current.log.text).toBe("第一次启动的输出");

    await act(async () => {
      await result.current.log.refresh();
    });
    /* 最新会话的开始时刻没变（没有新启动）→ 不切走 */
    expect(result.current.log.sessionId).toBe("12");
    expect(result.current.log.text).toBe("第一次启动的输出");
  });

  /* ── 「打开查看 ComfyUI」的打开形态（ISSUE #310）───────────────────────
   * 用户明确要求：**只要多页签，不要另开窗口**。所以这里断言的是
   * 「页签里渲染什么」，而不是「去了哪个窗口」——两条用例覆盖可嵌 / 不可嵌，
   * 两者都必须落在同一个页签上，且不可嵌时给出可读的成因。
   */

  describe("打开查看 ComfyUI — 页签形态（ISSUE #310）", () => {
    beforeEach(() => {
      useShellTabs.setState({
        tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
        activeTabId: MAIN_TAB_ID,
      });
    });

    it("可嵌 → 打开 ComfyUI 页签并带上内嵌地址", async () => {
      behavior.comfyBase = "http://127.0.0.1:8188";
      behavior.comfyEmbeddable = { embeddable: true, reason: "已开启 CORS" };
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfy();
      });

      const tab = useShellTabs.getState().tabs.find((t) => t.id === "comfyui");
      expect(tab).toBeDefined();
      expect(tab?.url).toBe("http://127.0.0.1:8188");
      expect(tab?.blockedReason ?? null).toBeNull();
      expect(useShellTabs.getState().activeTabId).toBe("comfyui");
      expect(toastSuccessMock).toHaveBeenCalled();
    });

    it("不可嵌 → 页签照常打开但带上可读说明（不静默空白）", async () => {
      behavior.comfyBase = "http://127.0.0.1:8188";
      behavior.comfyEmbeddable = {
        embeddable: false,
        reason: "ComfyUI 对跨源请求返回 403（未开启 CORS）",
      };
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfy();
      });

      const tab = useShellTabs.getState().tabs.find((t) => t.id === "comfyui");
      expect(tab).toBeDefined();
      // 不塞内嵌地址（那是空白页签的来源），改为带可读说明。
      expect(tab?.url ?? null).toBeNull();
      expect(tab?.blockedReason).toContain("403");
      /* 说明里必须带上地址：只剩一句「看不了」时，用户既无法自查、也无法判断
       * 是外壳拦的还是 ComfyUI 自己拦的（ISSUE #310 第三次回归的现场）。 */
      expect(tab?.blockedUrl).toBe("http://127.0.0.1:8188");
      expect(toastErrorMock).toHaveBeenCalled();
    });

    it("未运行时给可行动的提示且不开页签", async () => {
      behavior.comfyBase = null;
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfy();
      });

      expect(useShellTabs.getState().tabs.find((t) => t.id === "comfyui")).toBeUndefined();
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("先点「启动 ComfyUI」"));
    });
  });

  /* ── 浏览器 / dev 形态：「打开查看」走新浏览器页签，不内嵌 ──────────────
   * 浏览器自带页签栏，应用内不再画假页签栏（见 ShellTabs / shouldUseBrowserTab）。
   * 断言 window.open 被同步调用、且**不**新增应用内 comfyui 页签。 */
  describe("打开查看 ComfyUI — 浏览器形态走新浏览器页签", () => {
    beforeEach(() => {
      isDesktopShellMock.mockReturnValue(false); // 非桌面壳 = 浏览器
      useShellTabs.setState({
        tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
        activeTabId: MAIN_TAB_ID,
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("运行中 → window.open 新浏览器页签，且不开应用内 comfyui 页签", async () => {
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      behavior.comfyBase = "http://127.0.0.1:8188";
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();
      // 等状态查询落定，让缓存 base 就绪（浏览器分支优先用缓存、同步开窗）。
      await expect.poll(() => result.current.status?.base).toBe("http://127.0.0.1:8188");

      await act(async () => {
        await result.current.openComfy();
      });

      expect(openSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:8188",
        "_blank",
        "noopener,noreferrer",
      );
      expect(useShellTabs.getState().tabs.find((t) => t.id === "comfyui")).toBeUndefined();
      expect(toastSuccessMock).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining("新浏览器页签"));
    });

    it("未运行 → 不开新页签，给可行动提示", async () => {
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      behavior.comfyBase = null;
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfy();
      });

      expect(openSpy).not.toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("先点「启动 ComfyUI」"));
    });
  });

  /* ── 「在浏览器打开」＝页签之外的**并列**出口 ────────────────────────
   * #310 定下「点『打开查看』只出页签」；这条出口是用户主动点的另一条路
   * （放大看 / 装插件 / 多屏），所以断言两件事：
   *   ① 它不再自己判内嵌、也不再开或切页签（页签那套行为完全不受影响）；
   *   ② 地址由服务端自己探（comfyOpen），前端 state 里的旧 base 不作数。
   */
  describe("在浏览器打开 ComfyUI — 与页签并列的出口", () => {
    beforeEach(() => {
      useShellTabs.setState({
        tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
        activeTabId: MAIN_TAB_ID,
      });
    });

    it("运行中 → 调用 comfyOpen 并回报成功，不新增也不切换页签", async () => {
      behavior.comfyBase = "http://127.0.0.1:8188";
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfyInBrowser();
      });

      expect(comfyOpenCalls).toBe(1);
      expect(toastSuccessMock).toHaveBeenCalled();
      /* 关键：这条路径不碰页签栏 —— 用户要的是「页签照旧，另给一个浏览器出口」。 */
      expect(useShellTabs.getState().tabs).toHaveLength(1);
      expect(useShellTabs.getState().activeTabId).toBe(MAIN_TAB_ID);
    });

    it("未运行 → 原样回报服务端的可行动提示（err），且不开页签", async () => {
      behavior.comfyBase = null;
      behavior.comfyOpen = {
        ok: false,
        detail: "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看",
      };
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfyInBrowser();
      });

      expect(toastErrorMock).toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("先点「启动 ComfyUI」"));
      expect(useShellTabs.getState().tabs).toHaveLength(1);
    });

    it("打开失败（浏览器命令不可用）→ err 提示，不误报成功", async () => {
      behavior.comfyBase = "http://127.0.0.1:8188";
      behavior.comfyOpen = {
        ok: false,
        detail: "打开系统浏览器失败：spawn cmd.exe ENOENT",
      };
      const { result } = renderHook(() => useComfyuiControl(), {
        wrapper: makeWrapper(),
      });
      await expect.poll(() => result.current.status).not.toBeNull();

      await act(async () => {
        await result.current.openComfyInBrowser();
      });

      expect(toastErrorMock).toHaveBeenCalled();
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("打开系统浏览器失败"));
    });
  });
});
