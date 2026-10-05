// 镜头胶片带。核心判据只有一条硬的：**渲染出的帧数必须等于镜头数** ——
// 一条少画了几帧的胶片带比没有更糟（用户会以为镜头就这么些）。
// 其余钉的是「空帧也要说得出自己是第几镜」「失败要看得见」「不虚构选中态」。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ShotFilmStrip, formatShotIndex } from "./ShotFilmStrip";
import { type Shot } from "~/lib/workshop/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    index: 1,
    sceneId: "sc1",
    sceneHeading: "海边·日",
    shotType: "wide",
    description: "海面推到岸边",
    characterIds: [],
    prompt: "p",
    negativePrompt: "",
    params: {},
    status: "idle",
    ...over,
  };
}

describe("formatShotIndex", () => {
  it("镜号补到两位（胶片带是用来扫的，宽度不齐就扫不动）", () => {
    expect(formatShotIndex(1)).toBe("01");
    expect(formatShotIndex(16)).toBe("16");
    expect(formatShotIndex(120)).toBe("120");
  });
});

describe("ShotFilmStrip", () => {
  it("帧数等于镜头数，且每帧都点得动、回调带上那一镜", () => {
    const shots = [
      shot({ index: 1, id: "a" }),
      shot({ index: 2, id: "b" }),
      shot({ index: 3, id: "c" }),
    ];
    const onJump = vi.fn<(shot: Shot) => void>();
    render(<ShotFilmStrip shots={shots} onJump={onJump} />);
    expect(screen.getAllByRole("button", { name: /^跳到镜头/ })).toHaveLength(
      3,
    );
    /* 按可访问名点，不按下标取元素：下标访问在严格模式下是 `T | undefined`，
       而且帧序一旦变了，按下标的用例只会静默点错，不会报「少了一帧」。 */
    fireEvent.click(
      screen.getByRole("button", { name: "跳到镜头 02 · 海边·日 · 待生成" }),
    );
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump.mock.calls[0]?.[0].id).toBe("b");
  });

  it("可访问名同时给出镜号、场景与状态（读屏不必看图也知道是哪一镜）", () => {
    render(
      <ShotFilmStrip
        shots={[
          shot({ index: 5, sceneHeading: "废弃工厂·夜", status: "failed" }),
        ]}
        onJump={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "跳到镜头 05 · 废弃工厂·夜 · 失败",
      }),
    ).toBeTruthy();
  });

  it("还没有成图的帧显示镜号本身，不留一个说不出话的灰块", () => {
    render(<ShotFilmStrip shots={[shot({ index: 7 })]} onJump={vi.fn()} />);
    expect(screen.getByText("07")).toBeTruthy();
  });

  it("有封面的帧渲染封面，并把镜号以角标留在图上", () => {
    const { container } = render(
      <ShotFilmStrip
        shots={[shot({ index: 3, imageUrl: "/api/outputs/x/3.png" })]}
        onJump={vi.fn()}
      />,
    );
    expect(
      container.querySelector('img[src="/api/outputs/x/3.png"]'),
    ).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
  });

  it("标题行给出成图计数；有失败时点名失败数，没有就不提", () => {
    const { rerender } = render(
      <ShotFilmStrip
        shots={[shot({ index: 1, status: "done" }), shot({ index: 2 })]}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByText("1/2 镜成图")).toBeTruthy();
    expect(screen.queryByText(/失败/)).toBeNull();

    rerender(
      <ShotFilmStrip
        shots={[
          shot({ index: 1, status: "done" }),
          shot({ index: 2, status: "failed" }),
        ]}
        onJump={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 镜失败/)).toBeTruthy();
  });

  it("没有「当前镜头」这个概念，就不挂选中态（否则读屏会念出界面里不存在的事实）", () => {
    render(
      <ShotFilmStrip
        shots={[shot({ index: 1, status: "done" }), shot({ index: 2 })]}
        onJump={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    for (const frame of screen.getAllByRole("button", {
      name: /^跳到镜头/,
    })) {
      expect(frame.hasAttribute("aria-selected")).toBe(false);
    }
  });

  it("零镜头时整条不渲染（空带子比没有带子更误导）", () => {
    const { container } = render(<ShotFilmStrip shots={[]} onJump={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
