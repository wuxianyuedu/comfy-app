// @vitest-environment jsdom
// 首页「本机算力」卡的可见行为（规范 11.2：断言用户看得见什么，不断言内部 hook 细节）。
//
// 这张卡的价值不在「再画一遍百分比」，而在**把三种「看不见数」分开说**：
//   ① 后端没跑 → 未运行的那句降级说明；
//   ② 连着但首帧还没读到 → 「读取中」，不许报未运行；
//   ③ 迟滞容忍期 → 显示的是上一次数据，得让用户知道数在变旧。
// 用例逐个钉住，外加「缺读数的档一根条都不画」和「标签取自共享描述符（不是卡片自己再抄
// 一遍字面量）」。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  RESOURCE_METRICS,
  STALE_RESOURCE_NOTE,
  WAIT_FIRST_SAMPLE_NOTE,
} from "./comfy-resource-metrics";
import { LocalComputeCard } from "./LocalComputeCard";
import type { ComfyStatusViewModel } from "./hooks/use-comfy-readiness";

const readinessMock = vi.hoisted(() => vi.fn());

vi.mock("./hooks/use-comfy-readiness", () => ({
  useComfyReadiness: readinessMock,
}));

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
    stats: {
      online,
      gpuName: "NVIDIA GeForce RTX 4090",
      vramUsed: 2 * GIB,
      vramFree: 22 * GIB,
      vramTotal: 24 * GIB,
      ramUsed: 16 * GIB,
      ramTotal: 32 * GIB,
    },
    online,
    connecting: false,
    stale: false,
    cudaVram: { used: 2 * GIB, total: 24 * GIB, pct: 8 },
    smiVram: { used: 6 * GIB, total: 24 * GIB, pct: 25 },
    ram: { used: 16 * GIB, total: 32 * GIB, pct: 50 },
    degradedNote: null,
    ...over,
  };
}

describe("LocalComputeCard 有读数时", () => {
  it("三档各画一根条，百分比与共享描述符的次序一致", () => {
    readinessMock.mockReturnValue(viewModel());
    render(<LocalComputeCard />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((b) => b.getAttribute("aria-valuenow"))).toEqual([
      "25",
      "8",
      "50",
    ]);
    /* 卡里的标签文案必须就是共享那一份（两处消费点不许各抄一遍字面量）。 */
    for (const metric of RESOURCE_METRICS) {
      expect(screen.getByText(metric.label)).toBeTruthy();
    }
  });

  it("已用/总量按字节口径显示在标签里，可访问名也带上百分比", () => {
    readinessMock.mockReturnValue(viewModel());
    render(<LocalComputeCard />);
    const [smi] = screen.getAllByRole("progressbar");
    expect(smi?.getAttribute("aria-label")).toBe("显存 25%");
    expect(smi?.textContent).toContain("显存");
    /* 单位以 `~/lib/format-bytes` 为准（十进制 GB）—— 卡片不另造一套单位口径。 */
    expect(smi?.textContent).toContain("6.0 GB/24.0 GB");
  });

  it("设备名渲染出来", () => {
    readinessMock.mockReturnValue(viewModel());
    render(<LocalComputeCard />);
    expect(screen.getByText("NVIDIA GeForce RTX 4090")).toBeTruthy();
  });

  it("在线档：徽标写「在线」", () => {
    readinessMock.mockReturnValue(viewModel());
    render(<LocalComputeCard />);
    expect(screen.getByText("在线")).toBeTruthy();
    expect(screen.queryByText("离线")).toBeNull();
  });

  it("给不出设备名时不占一行（不渲染 undefined 之类的假占位）", () => {
    readinessMock.mockReturnValue(
      viewModel({
        stats: {
          online: true,
          vramUsed: 2 * GIB,
          vramFree: 22 * GIB,
          vramTotal: 24 * GIB,
          ramUsed: 16 * GIB,
          ramTotal: 32 * GIB,
        },
      }),
    );
    const { container } = render(<LocalComputeCard />);
    expect(container.textContent).not.toContain("undefined");
    expect(screen.queryByText("null")).toBeNull();
  });
});

describe("LocalComputeCard 读不到数时", () => {
  it("后端未运行：画 0% 是谎，改为整档隐藏并显示降级说明", () => {
    readinessMock.mockReturnValue(
      viewModel({
        online: false,
        stats: null,
        cudaVram: null,
        smiVram: null,
        ram: null,
        degradedNote: "ComfyUI 未运行，显存/内存暂不可用",
      }),
    );
    render(<LocalComputeCard />);
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    expect(screen.getByText("ComfyUI 未运行，显存/内存暂不可用")).toBeTruthy();
    expect(screen.getByText("离线")).toBeTruthy();
    expect(screen.queryByText(STALE_RESOURCE_NOTE)).toBeNull();
  });

  it("连着但首帧未到：说「读取中」，不说「未运行」", () => {
    readinessMock.mockReturnValue(
      viewModel({ connecting: true, cudaVram: null, smiVram: null, ram: null }),
    );
    render(<LocalComputeCard />);
    expect(screen.getByText(WAIT_FIRST_SAMPLE_NOTE)).toBeTruthy();
    expect(screen.queryByText(/未运行/)).toBeNull();
  });

  it("迟滞容忍期：保留上一次的条，并把「显示的是上一次数据」说出来", () => {
    readinessMock.mockReturnValue(viewModel({ stale: true }));
    render(<LocalComputeCard />);
    expect(screen.getByText(STALE_RESOURCE_NOTE)).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(3);
  });

  it("只有内存一档读得到时，就只画那一档", () => {
    readinessMock.mockReturnValue(viewModel({ cudaVram: null, smiVram: null }));
    render(<LocalComputeCard />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    expect(bars[0]?.getAttribute("aria-valuenow")).toBe("50");
  });
});

describe("LocalComputeCard 的出口", () => {
  it("「去设置」指向 /settings（后端配置在那一页）", () => {
    readinessMock.mockReturnValue(viewModel());
    render(<LocalComputeCard />);
    const link = screen.getByRole("link", { name: "去设置" });
    expect(link.getAttribute("href")).toBe("/settings");
  });
});
