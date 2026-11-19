/**
 * 启动耗时时间线面板（#4522）的可见行为：独立弹窗里按**时间线序**铺全量阶段、
 * 行首徽标区分前端 / 后端、进行中的段有标注、图例给两侧小计；无读数给空态
 * 说明而不是空白；面板关闭时不发取数请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LaunchTimingsPanel } from "./LaunchTimingsPanel";

beforeEach(() => {
  /* base-ui 的浮层要用 matchMedia，jsdom 不给（与 `ui/dialog.test.tsx` 同款兜底）。 */
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {
        void 0;
      },
      removeListener() {
        void 0;
      },
      addEventListener() {
        void 0;
      },
      removeEventListener() {
        void 0;
      },
      dispatchEvent() {
        return false;
      },
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* 夹具故意打乱输入顺序（首页编译最先给、预检段在后）：组件必须按 startMs
 * 重排成时间线序，而不是照单全收。 */
const payload = {
  phases: [
    {
      key: "first-page",
      label: "首页编译",
      startMs: 6200,
      endMs: 8900,
      durationMs: 2700,
      percent: 30.3,
    },
    {
      key: "schema-sync",
      label: "后台建表",
      startMs: 700,
      endMs: null,
      durationMs: 800,
      percent: 9,
    },
    {
      key: "env-toolchain",
      label: "环境与工具链",
      startMs: 0,
      endMs: 600,
      durationMs: 600,
      percent: 6.7,
    },
  ],
  totalMs: 8900,
};

function mockTimings(data: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200 }),
  );
}

describe("启动耗时时间线面板（#4522）", () => {
  it("按时间线序铺全量阶段，行首徽标区分前端 / 后端", async () => {
    mockTimings(payload);
    render(<LaunchTimingsPanel onOpenChange={vi.fn()} open />);
    await waitFor(() => {
      expect(screen.getByText("环境与工具链")).toBeInTheDocument();
    });
    /* 时间线序：起点 0ms 的预检段在最前、6.2s 的首页编译在最后——
     * 用行在列表里的先后断言，不按数组原序。 */
    const list = screen.getByRole("list");
    const rows = [...list.querySelectorAll("li")];
    const labels = rows.map((row) => row.textContent ?? "");
    expect(labels[0]).toContain("环境与工具链");
    expect(labels[1]).toContain("后台建表");
    expect(labels[2]).toContain("首页编译");
    /* 侧别：首页编译是前端侧（蓝），其余是后端侧（紫）——行首徽标可判。 */
    const sideOf = (label: string) => {
      const row = rows.find((item) => (item.textContent ?? "").includes(label));
      const badge = row?.querySelector("span");
      return badge?.textContent ?? "";
    };
    expect(sideOf("首页编译")).toBe("前端");
    expect(sideOf("环境与工具链")).toBe("后端");
    expect(sideOf("后台建表")).toBe("后端");
  });

  it("图例给两侧小计与墙钟合计；进行中的段标注「进行中」", async () => {
    mockTimings(payload);
    render(<LaunchTimingsPanel onOpenChange={vi.fn()} open />);
    await waitFor(() => {
      expect(screen.getByText("合计 8.9s")).toBeInTheDocument();
    });
    /* 前端 = 首页编译 2.7s；后端 = 0.6 + 0.8 = 1.4s（并行段分别累计）。 */
    expect(screen.getByText(/前端 2\.7s/)).toBeInTheDocument();
    expect(screen.getByText(/后端 1\.4s/)).toBeInTheDocument();
    expect(screen.getByText(/（进行中）/)).toBeInTheDocument();
  });

  it("每段的甘特条按「起点占合计」定位——并行段不挤在同一格", async () => {
    mockTimings(payload);
    render(<LaunchTimingsPanel onOpenChange={vi.fn()} open />);
    await waitFor(() => {
      expect(screen.getByText("首页编译")).toBeInTheDocument();
    });
    const fillOf = (label: string) => {
      const row = [...screen.getByRole("list").querySelectorAll("li")].find((item) =>
        (item.textContent ?? "").includes(label),
      );
      const fill = row?.children[2]?.firstElementChild;
      /* 类型守卫收窄（lint 判据：不许直接 as 断言更窄类型）。 */
      return fill instanceof HTMLElement ? fill : null;
    };
    const firstPage = fillOf("首页编译");
    const env = fillOf("环境与工具链");
    expect(firstPage?.style.left).toBe("69.66292134831461%");
    expect(env?.style.left).toBe("0%");
    /* 宽 = 时长占合计；微小段仍有最小可见宽度（这里每段都够大，按真实比例）。 */
    expect(firstPage?.style.width).toBe("30.337078651685395%");
    expect(env?.style.width).toBe("6.741573033707865%");
  });

  it("无读数给空态说明，不摆半份坏图", async () => {
    mockTimings({ phases: null, totalMs: null });
    render(<LaunchTimingsPanel onOpenChange={vi.fn()} open />);
    expect(await screen.findByText("暂无启动耗时读数")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("面板关闭时不取数；打开才取", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ phases: null, totalMs: null }), { status: 200 }),
      );
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    const { rerender } = render(<LaunchTimingsPanel onOpenChange={vi.fn()} open={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<LaunchTimingsPanel onOpenChange={vi.fn()} open />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dev/launch-timings", { cache: "no-store" });
    });
  });

  it("点关闭按钮回调 onOpenChange(false)", async () => {
    mockTimings(payload);
    const onOpenChange = vi.fn();
    render(<LaunchTimingsPanel onOpenChange={onOpenChange} open />);
    await waitFor(() => {
      expect(screen.getByText("环境与工具链")).toBeInTheDocument();
    });
    const user = userEvent.setup();
    /* `ui/dialog` 的内置关闭按钮可访问名是 sr-only 的 "Close"（基元自带，不改）。 */
    await user.click(screen.getByRole("button", { name: "Close" }));
    /* base-ui 的 onOpenChange 第二参是事件详情（reason: "close-press"），只判首位。 */
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
