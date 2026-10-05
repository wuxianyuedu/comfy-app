// 状态栏视图的可见行为：断言用户能看到什么，不断言内部 state/hook 调用细节
// （规范 11.2 行为测试优先）。依赖 useComfyReadiness（指标）/ useDevServerStatus
// （应用服务那一格）/ useFps（FPS 归属），逐个换桩。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { BrowserStatusBar } from "./BrowserStatusBar";
import type { ComfyStatusViewModel } from "./hooks/use-comfy-readiness";
import type * as FpsModule from "./hooks/use-fps";
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
