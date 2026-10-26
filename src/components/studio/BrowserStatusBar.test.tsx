// 状态栏视图的可见行为：断言用户能看到什么，不断言内部 state/hook 调用细节
// （规范 11.2 行为测试优先）。依赖 useComfyReadiness（指标）/ useDevServerStatus
// （应用服务那一格）/ useFps（FPS 归属）/ useSchemaSyncStatus、useComfyQueue
// （两个周期源），逐个换桩。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { BrowserStatusBar } from "./BrowserStatusBar";
import type * as ComfyQueueModule from "./hooks/use-comfy-queue";
import type { ComfyStatusViewModel } from "./hooks/use-comfy-readiness";
import type * as FpsModule from "./hooks/use-fps";
import type * as SchemaSyncModule from "./hooks/use-schema-sync-status";
import type { DevServerStatusViewModel } from "./hooks/use-dev-server-status";

const readinessMock = vi.hoisted(() => vi.fn());
const fpsMock = vi.hoisted(() => vi.fn());

vi.mock("./hooks/use-comfy-readiness", () => ({
  useComfyReadiness: readinessMock,
}));
vi.mock("./hooks/use-fps", async (importOriginal) => {
  const actual = await importOriginal<typeof FpsModule>();
  return { ...actual, useFps: fpsMock };
});
/* 状态栏还挂着两个周期源：schema 同步状态（每挂载一次就 `GET /api/schema`）与
 * 队列快照（订阅即拉起 `GET /api/comfy/queue` 的轮询）。两者各有自己的用例
 * （`use-schema-sync-status.test.ts` / `use-comfy-queue.test.ts`），这里换桩 ——
 * 不换的话每一条用例都会真发两笔请求，在本机撞 `localhost:3000` 的
 * ECONNREFUSED，并在 happy-dom 拆窗时把这些在飞的请求打成一片 AbortError
 * （ISSUE #2458：它们是**别的文件**打印的噪声，这条用例自己一条断言都没红）。 */
vi.mock("./hooks/use-schema-sync-status", async (importOriginal) => {
  const actual = await importOriginal<typeof SchemaSyncModule>();
  return {
    ...actual,
    useSchemaSyncStatus: (): SchemaSyncModule.SchemaSyncStatus => ({
      phase: "ready",
      detail: null,
      canPush: false,
    }),
  };
});
vi.mock("./hooks/use-comfy-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof ComfyQueueModule>();
  return {
    ...actual,
    useComfyQueue: (): ComfyQueueModule.ComfyQueueView => ({
      online: false,
      comfy: { running: 0, pending: 0 },
      running: null,
      queued: 0,
      elapsedMs: null,
    }),
  };
});
// 状态栏需要 LogProvider 上下文；这里只关心指标项，换成透传壳。
vi.mock("./logs/LogProvider", () => ({
  useLogPanel: <T,>(
    selector: (state: {
      isOpen: boolean;
      counts: { error: number };
      toggleOpen: () => void;
    }) => T,
  ) => selector({ isOpen: false, counts: { error: 0 }, toggleOpen: noop }),
}));
// 应用服务那一格的 controller 换成桩：判据本身在 ~/lib/dev-server-status
// 有独立用例，这里只断言「状态栏把状态渲染成用户看得见的文案与色调」。
const devServerMock = vi.hoisted(() => vi.fn());
vi.mock("./hooks/use-dev-server-status", () => ({
  useDevServerStatus: devServerMock,
}));
// 「断开 / 启动」记进消息中心那条接线也换桩：它会真的去打
// `/api/dev/last-exit`，而这份用例关心的是状态栏那一格的渲染（那个 hook 有
// 自己的用例，见 message-center/hooks/use-app-service-message-log.test.ts）。
vi.mock(
  "~/components/message-center/hooks/use-app-service-message-log",
  () => ({
    /* 桩函数带一句说明而不是空函数体（`no-empty-function`）：空桩看不出「这里是
     * 有意不做」，将来若有人忘了换桩，那条静默的网络调用更难查。 */
    useAppServiceMessageLog: () => {
      /* 消息记录不在这份用例的断言面里（它有独立用例） */
    },
  }),
);
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace" }));

function noop() {
  /* 测试桩：仅为满足 LogProvider 上下文的最小形状 */
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const GIB = 1024 * 1024 * 1024;

function viewModel(
  over: Partial<ComfyStatusViewModel> = {},
): ComfyStatusViewModel {
  const online = over.online ?? true;
  return {
    stats: null,
    online,
    connecting: false,
    stale: false,
    cudaVram: { used: 2 * GIB, total: 8 * GIB, pct: 25 },
    smiVram: null,
    ram: { used: 16 * GIB, total: 32 * GIB, pct: 50 },
    degradedNote: null,
    ...over,
  };
}

function devServer(
  over: Partial<DevServerStatusViewModel> = {},
): DevServerStatusViewModel {
  return {
    state: "online",
    label: "应用服务运行中",
    title: "应用服务（dev server）在线：页面查询、保存与任务提交都走它",
    lastRestartAt: null,
    exitNotice: null,
    lastExitAt: null,
    /* 状态栏自己不画它，但消息中心「已启动 / 已恢复」那条记录靠它判边沿；
     * 夹具不给真值的话，接线会安静地退化成「永不记录」。 */
    processIsNew: true,
    /* 当前是哪一次启动：消息中心按它把历史消息分成「每一次启动」一组。
     * 夹具不给的话分组退化成「未标记启动」—— 接线看着照跑，只是分不了批。 */
    currentRunId: "a1b2c3",
    /* 停表那一段（这一拍之前没人在探测的毫秒数）。夹具给 0 = 每一拍都在探，
     * 于是恢复那条不会多出一行「没有探测」的标注。 */
    unprobedMs: 0,
    ...over,
  };
}

function renderBar(
  vm: ComfyStatusViewModel,
  fps: number | null = 60,
  server: DevServerStatusViewModel = devServer(),
) {
  readinessMock.mockReturnValue(vm);
  fpsMock.mockReturnValue(fps);
  devServerMock.mockReturnValue(server);
  return render(<BrowserStatusBar />);
}

describe("BrowserStatusBar 指标显隐与降级", () => {
  it("已就绪且仅有 ComfyUI 口径：显示 CUDA 显存与内存，不渲染 nvidia-smi 空项", () => {
    renderBar(viewModel());

    expect(screen.getByText("显存·ComfyUI")).toBeInTheDocument();
    expect(screen.queryByTitle(/nvidia-smi 物理专用显存/)).toBeNull();
    expect(screen.getByText("内存")).toBeInTheDocument();
  });

  it("双口径同时可用：nvidia-smi 与 ComfyUI 两项并列且有可读标签", () => {
    renderBar(
      viewModel({ smiVram: { used: 3 * GIB, total: 12 * GIB, pct: 25 } }),
    );

    expect(screen.getByTitle(/nvidia-smi 物理专用显存/)).toBeInTheDocument();
    expect(screen.getByText("显存")).toBeInTheDocument();
    expect(screen.getByText("显存·ComfyUI")).toBeInTheDocument();
  });

  it("ComfyUI 未运行：占用条隐藏但降级提示可见，且状态栏不再为它单列一格", () => {
    renderBar(
      viewModel({
        online: false,
        connecting: false,
        cudaVram: null,
        smiVram: null,
        ram: null,
        degradedNote: "ComfyUI 未运行，显存/内存暂不可用",
      }),
    );

    expect(screen.queryByText("显存·ComfyUI")).toBeNull();
    expect(screen.queryByText("内存")).toBeNull();
    expect(
      screen.getByText("ComfyUI 未运行，显存/内存暂不可用"),
    ).toBeInTheDocument();
    // 「显存/内存不可用」已经等于「ComfyUI 没启动」，不再重复一格的连接态。
    expect(screen.queryByLabelText(/ComfyUI 未连接/)).toBeNull();
  });

  it("那一格显示的是应用服务状态，而不是 ComfyUI 连接态", () => {
    renderBar(viewModel());

    expect(screen.getByLabelText("应用服务运行中")).toBeInTheDocument();
    expect(screen.queryByText("已就绪")).toBeNull();
  });

  it("应用服务断开：以告警色显示「已断开」，用户能区分于 ComfyUI 离线", () => {
    renderBar(
      viewModel(),
      60,
      devServer({
        state: "offline",
        label: "应用服务已断开",
        title: "应用服务（dev server）当前不可达：页面里的查询与保存都会失败",
      }),
    );

    const cell = screen.getByLabelText("应用服务已断开");
    expect(cell).toBeInTheDocument();
    expect(cell.getAttribute("data-dev-server")).toBe("offline");
  });

  it("应用服务刚重启：显示「已重启」并带出真正重启时刻", () => {
    renderBar(
      viewModel(),
      60,
      devServer({
        state: "online",
        label: "应用服务已重启",
        lastRestartAt: new Date("2026-09-12T08:30:00").getTime(),
      }),
    );

    expect(screen.getByLabelText("应用服务已重启")).toBeInTheDocument();
    expect(screen.getByText(/08:30:00/)).toBeInTheDocument();
  });

  it("断开且原因已知：把原因作为**可见文字**摆出来，而不是只挂在 hover 上（ISSUE #1692）", () => {
    /* 悬停不是可发现的动作：用户盯着「已断开」四个字，唯一想问的就是为什么。
     * 状态栏那一格窄，只放「为什么」这一句，完整三句（为什么 / 这一次的具体
     * 退出事实 / 现在做什么）在 title 里。 */
    renderBar(
      viewModel(),
      60,
      devServer({
        state: "offline",
        label: "应用服务已断开",
        title:
          "本地服务自身退出了。服务被 SIGKILL 结束。看 log/nextjs/ 下最新一份输出。",
        exitNotice: {
          why: "本地服务自身退出了（编译失败 / 端口被占 / pnpm 异常都会这样）",
          detail:
            "服务被 SIGKILL 结束：被强制结束（内存不足被系统结束、或任务管理器结束进程都会这样）",
          action: "看 log/nextjs/ 下最新一份输出；重新启动一次通常即可恢复",
        },
      }),
    );

    // 可见：不只是 title 里有（断开那一格自己也带 title，所以这里锁**文字节点**）。
    const visible = screen.getByText(/本地服务自身退出了/);
    expect(visible).toBeInTheDocument();
    // 完整三句挂在它自己的 title 上（悬停能看全：为什么 / 这一次的具体退出事实 / 做什么）。
    const full = visible.getAttribute("title") ?? "";
    expect(full).toContain("SIGKILL");
    expect(full).toContain("重新启动一次");
  });

  it("没有原因可讲时不占位（不摆一句「原因未知」的噪声）", () => {
    renderBar(
      viewModel(),
      60,
      devServer({
        state: "offline",
        label: "应用服务已断开",
        title: "应用服务不可达：页面里的查询与保存都会失败。",
        exitNotice: null,
      }),
    );
    expect(screen.queryByText(/未知/)).toBeNull();
  });

  it("FPS 归属：状态栏渲染实时帧率（画布内已无 FpsMeter）", () => {
    renderBar(viewModel(), 60);
    expect(screen.getByText("FPS")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByTitle(/全应用实时帧率/)).toBeInTheDocument();
  });
});

describe("BrowserStatusBar 纯图标按钮的可访问名", () => {
  /**
   * 日志面板入口只有图标（外加可选的错误计数徽标），没有可见文字。少了
   * `accessibleName`，它就既没有 `aria-label` 也没有 `title` —— 读屏用户点到的
   * 是一颗匿名按钮，而自动化只能退回去等一个并不存在的 `title`
   * （`locator.click` 没有独立动作超时，会静静等满整条用例的预算）。
   * `ui/hint` 的契约正是「纯图标按钮传 accessibleName，由它把提示文案写成子元素
   * 的 aria-label」，这里钉它真的落到 DOM 上。
   */
  it("日志面板入口的提示文案同时是它的可访问名", () => {
    renderBar(viewModel());

    const trigger = screen.getByRole("button", { name: /^日志面板/ });
    expect(trigger).toBeInTheDocument();
    /* 名字由 aria-label 给（可见文字仍为空）：换成只写 title 就守不住读屏这条路。 */
    expect(trigger.getAttribute("aria-label")).toMatch(/^日志面板/);
  });
});
