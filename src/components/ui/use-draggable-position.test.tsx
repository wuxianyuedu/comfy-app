// @vitest-environment jsdom
/**
 * 「把一枚悬浮元素拖着摆到任意位置」的判据（`useDraggablePosition`）。
 *
 * 这条能力有三件事必须一起成立，用例逐个钉住：
 *   1. **位置跨会话记得住** —— 每次打开都跳回默认角等于没挪过；
 *   2. **位置会被夹进视口** —— 拖出视野、或窗口缩小后停在视野外的元素，
 *      用户既看不见也拖不回来（没有别的抓手）；
 *   3. **拖动与点击分得开** —— 悬浮元素通常同时是按钮，按下后位移没超阈值
 *      就是点击；超过阈值就是拖动，且**松手不该顺手把面板打开**。
 *
 * 另有一条**回归**专门钉住「元素首轮还没挂上」这条时序（见对应用例的注释）：
 * 真实调用处正好是那个时序，而其余用例默认元素一开始就在 —— 于是第一版那个
 * 「记住的位置被静默丢弃」正是在这条路径上漏出去的。
 *
 * 接线方式与真实调用处**同一条**：`elementCallbackRef` 挂到一个真的
 * `<button ref=…>` 上（不是手动调它 —— 那是渲染期 setState）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  DRAG_EDGE_GAP_PX,
  DRAG_SLOP_PX,
  useDraggablePosition,
  type DraggablePositionController,
} from "./use-draggable-position";

const KEY = "comfyapp:test-fab:v1";
const DEFAULT = { right: 24, bottom: 40 };

beforeEach(() => {
  window.localStorage.clear();
  setViewport(1000, 800);
});

afterEach(cleanup);

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

/**
 * 一个 40×40 的假被测元素：hook 只量它的 `getBoundingClientRect`。
 *
 * 用一张固定尺寸的 stub 而不是真 `<button>`，是因为 jsdom 不做布局、
 * `getBoundingClientRect()` 恒返回 0 尺寸 —— 那样「夹取」这条判据就永远
 * 命中不了边界，等于没测。
 */
function stubRect(this: HTMLElement) {
  return {
    width: 40,
    height: 40,
    top: 0,
    left: 0,
    right: 40,
    bottom: 40,
    x: 0,
    y: 0,
    /* `DOMRect` 要求 `toJSON`，但本 hook 只读尺寸与坐标 —— 给一个返回自身的
     * 实现即可（空实现会被 `no-empty-function` 拦下）。 */
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

/**
 * 被测组件：把 hook 的 controller 交出来，并把回调 ref 挂到真的元素上。
 *
 * `elementShown` 控制元素**什么时候挂上** —— 真实调用处按「量到位置了没有」
 * 决定要不要渲染它，首轮往往是 `false`。
 *
 * controller 通过 `onController` 向上交出（由 `useState` 保持最新一份），
 * 避免「渲染期写 ref」这类会触发 `react-hooks/refs` 的写法。
 */
function Harness({
  onClick,
  elementShown,
  onController,
}: {
  onClick?: () => void;
  elementShown: boolean;
  onController: (c: DraggablePositionController<HTMLButtonElement>) => void;
}) {
  const controller = useDraggablePosition<HTMLButtonElement>({
    storageKey: KEY,
    defaultOffset: DEFAULT,
    onClick,
  });
  onController(controller);
  if (!elementShown) return null;
  return (
    <button
      ref={(el) => {
        /* 让这个按钮的尺寸可预期（jsdom 不做布局，真按钮量出来恒为 0）。 */
        if (el) el.getBoundingClientRect = stubRect;
        controller.elementCallbackRef(el);
      }}
    />
  );
}

/** 渲染被测组件；`controller()` 始终拿到最新一份 controller。 */
function setup(
  options: { onClick?: () => void; elementShown?: boolean } = {},
): {
  controller: () => DraggablePositionController<HTMLButtonElement>;
  attach: (shown: boolean) => void;
} {
  let latest: DraggablePositionController<HTMLButtonElement> | null = null;
  const onController = (c: DraggablePositionController<HTMLButtonElement>) => {
    latest = c;
  };
  const view = render(
    <Harness
      onClick={options.onClick}
      elementShown={options.elementShown ?? true}
      onController={onController}
    />,
  );
  return {
    controller: () => latest!,
    attach: (shown) => {
      view.rerender(
        <Harness
          onClick={options.onClick}
          elementShown={shown}
          onController={onController}
        />,
      );
    },
  };
}

/** 走一整套指针事件：按下 → 若干次移动 → 松手。 */
function drag(
  handleProps: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void },
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  act(() => {
    handleProps.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: from.x,
      clientY: from.y,
    } as unknown as React.PointerEvent<HTMLElement>);
  });
  const steps = 8;
  act(() => {
    for (let i = 1; i <= steps; i++) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: from.x + ((to.x - from.x) * i) / steps,
          clientY: from.y + ((to.y - from.y) * i) / steps,
        }),
      );
    }
  });
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        clientX: to.x,
        clientY: to.y,
      }),
    );
  });
}

describe("useDraggablePosition", () => {
  it("没存过时落在默认偏移上", async () => {
    const { controller } = setup();
    await waitFor(() => expect(controller().offset).toEqual(DEFAULT));
  });

  it("拖动之后位置写进 storage，重新挂载时读得回来", async () => {
    const first = setup();
    await waitFor(() => expect(first.controller().offset).not.toBeNull());
    /* 往左上拖 200/100：右侧更远 → `right` 变大，下侧更远 → `bottom` 变大。 */
    drag(
      first.controller().handleProps,
      { x: 900, y: 700 },
      { x: 700, y: 600 },
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(KEY)).not.toBeNull(),
    );
    const saved = JSON.parse(window.localStorage.getItem(KEY)!) as {
      right: number;
      bottom: number;
    };
    expect(saved.right).toBeGreaterThan(DEFAULT.right);
    expect(saved.bottom).toBeGreaterThan(DEFAULT.bottom);
    cleanup();

    /* 重新挂载 = 用户下次打开应用：落点应与上次一致。 */
    const second = setup();
    await waitFor(() => expect(second.controller().offset).toEqual(saved));
  });

  /* 回归：元素**首轮还没挂上**这条时序 —— 真实调用处正是这样（按「量到位置了
   * 没有」决定要不要渲染图标），而其余用例默认元素一开始就在，走不到这里。
   * 第一版就是在这条路径上把记住的位置**静默丢弃**的（拿到默认值去夹，没重读
   * storage），表现是「拖过之后重开应用，图标又跳回右下角」。 */
  it("元素首轮还没挂上：也要给位置，挂上后位置不跳变", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ right: 500, bottom: 300 }),
    );
    const { controller, attach } = setup({ elementShown: false });

    /* 第一态：元素不在 DOM 里。这里**仍要给出位置** —— 调用处按「有没有偏移」
     * 决定要不要渲染被拖的元素，不给值它永远不渲染、也就永远挂不上（死结）。
     * 此时按零尺寸的占位盒子夹取，读到的已是 storage 里那个值。 */
    await waitFor(() =>
      expect(controller().offset).toEqual({ right: 500, bottom: 300 }),
    );

    /* 第二态：元素挂上 —— 位置**不该跳变**（这一条正是第一版丢掉记住位置时
     * 会红的地方：挂上后它拿默认值去夹，图标倏地跳回右下角）。 */
    act(() => attach(true));
    await waitFor(() =>
      expect(controller().offset).toEqual({ right: 500, bottom: 300 }),
    );
  });

  it("拖出视口时被夹住——元素整体留在视口内", async () => {
    const { controller } = setup();
    await waitFor(() => expect(controller().offset).not.toBeNull());
    /* 往右下角拖出屏幕很远：夹取后仍要留出通行留白。 */
    drag(controller().handleProps, { x: 100, y: 100 }, { x: 5000, y: 5000 });
    await waitFor(() => {
      expect(controller().offset!.right).toBeGreaterThanOrEqual(
        DRAG_EDGE_GAP_PX,
      );
      expect(controller().offset!.bottom).toBeGreaterThanOrEqual(
        DRAG_EDGE_GAP_PX,
      );
    });
    const { right, bottom } = controller().offset!;
    expect(right).toBeLessThanOrEqual(1000 - 40 - DRAG_EDGE_GAP_PX);
    expect(bottom).toBeLessThanOrEqual(800 - 40 - DRAG_EDGE_GAP_PX);
  });

  it("窗口缩小后原先的落点被收紧回视口内", async () => {
    /* 先把元素摆到靠右下的远处（存进 storage），再把窗口缩到很小。 */
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ right: 900, bottom: 700 }),
    );
    const { controller } = setup();
    await waitFor(() => expect(controller().offset).not.toBeNull());
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => {
      const { right, bottom } = controller().offset!;
      expect(right).toBeLessThanOrEqual(1000 - 40 - DRAG_EDGE_GAP_PX);
      expect(bottom).toBeLessThanOrEqual(800 - 40 - DRAG_EDGE_GAP_PX);
    });
  });

  it("位移没超阈值 = 点击（交给 onClick），不写 storage", async () => {
    const onClick = vi.fn();
    const { controller } = setup({ onClick });
    await waitFor(() => expect(controller().offset).not.toBeNull());
    drag(
      controller().handleProps,
      { x: 900, y: 700 },
      { x: 900 + DRAG_SLOP_PX - 1, y: 700 },
    );
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("真的拖过之后**不**触发 onClick（松手不会顺手把面板打开）", async () => {
    const onClick = vi.fn();
    const { controller } = setup({ onClick });
    await waitFor(() => expect(controller().offset).not.toBeNull());
    drag(
      controller().handleProps,
      { x: 900, y: 700 },
      { x: 900 - DRAG_SLOP_PX * 4, y: 700 },
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it("只接主键：右键按下不启动拖动", async () => {
    const { controller } = setup();
    await waitFor(() => expect(controller().offset).not.toBeNull());
    const before = controller().offset;
    act(() => {
      controller().handleProps.onPointerDown({
        button: 2,
        pointerId: 1,
        clientX: 900,
        clientY: 700,
      } as unknown as React.PointerEvent<HTMLElement>);
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 400,
          clientY: 300,
        }),
      );
    });
    expect(controller().offset).toEqual(before);
  });
});
