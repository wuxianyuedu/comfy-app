// @vitest-environment jsdom
// 状态栏视图的可见行为（ISSUE #324 交付项 2）：断言用户能看到什么，
// 不断言内部 state/hook 调用细节（规范 11.2 行为测试优先）。
// 依赖 useComfyReadiness（controller）与 useFps（FPS 归属），逐个换桩。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { BrowserStatusBar } from "./BrowserStatusBar";
import type { ComfyStatusViewModel } from "./hooks/use-comfy-readiness";
import type * as FpsModule from "./hooks/use-fps";
import { deriveComfyReadiness } from "~/lib/comfy-readiness";

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
vi.mock("./hooks/use-dev-server-liveness", () => ({
  useDevServerLiveness: () => ({ restarting: false, lastRestartAt: null }),
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
    readiness: deriveComfyReadiness(online, true),
    cudaVram: { used: 2 * GIB, total: 8 * GIB, pct: 25 },
    smiVram: null,
    ram: { used: 16 * GIB, total: 32 * GIB, pct: 50 },
    degradedNote: null,
    ...over,
  };
}

function renderBar(vm: ComfyStatusViewModel, fps: number | null = 60) {
  readinessMock.mockReturnValue(vm);
  fpsMock.mockReturnValue(fps);
  return render(<BrowserStatusBar />);
}

describe("BrowserStatusBar 指标显隐与降级", () => {
  it("已就绪且仅有 ComfyUI 口径：显示 CUDA 显存与内存，不渲染 nvidia-smi 空项", () => {
    renderBar(viewModel());

    expect(screen.getByText("显存·ComfyUI")).toBeInTheDocument();
    expect(screen.queryByTitle(/nvidia-smi 物理专用显存/)).toBeNull();
    expect(screen.getByText("内存")).toBeInTheDocument();
    expect(screen.getByLabelText("ComfyUI 已就绪")).toBeInTheDocument();
  });

  it("双口径同时可用：nvidia-smi 与 ComfyUI 两项并列且有可读标签", () => {
    renderBar(
      viewModel({ smiVram: { used: 3 * GIB, total: 12 * GIB, pct: 25 } }),
    );

    expect(screen.getByTitle(/nvidia-smi 物理专用显存/)).toBeInTheDocument();
    expect(screen.getByText("显存")).toBeInTheDocument();
    expect(screen.getByText("显存·ComfyUI")).toBeInTheDocument();
  });

  it("未连接：占用条隐藏但降级提示可见，就绪指示为未连接", () => {
    renderBar(
      viewModel({
        online: false,
        connecting: false,
        readiness: deriveComfyReadiness(false, false),
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
    expect(screen.getByLabelText("ComfyUI 未连接")).toBeInTheDocument();
  });

  it("FPS 归属：状态栏渲染实时帧率（画布内已无 FpsMeter）", () => {
    renderBar(viewModel(), 60);
    expect(screen.getByText("FPS")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByTitle(/全应用实时帧率/)).toBeInTheDocument();
  });
});
