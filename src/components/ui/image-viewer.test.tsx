/**
 * 通用图片查看器的契约：**看全**这件事只允许一处实现。
 *
 * 用例钉的是「用户能拿到什么」而不是内部状态：头部显示原始像素尺寸、三个
 * 缩放入口（按钮 / 滚轮 / 双击）改的是同一个百分比、拖拽平移落到容器的滚动
 * 偏移、关闭只走一个出口；以及失败兜底与键盘可达（缩略图是按钮）。
 *
 * jsdom 不做布局：可视区恒为 0×0（于是「适应窗口」折算不出，倍数退回 100%），
 * 自然尺寸也不会真的读出来 —— 用例自己把 `naturalWidth/Height` 打上去，
 * 这正是真实浏览器里 `onLoad` 那一刻读到的两个数。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageViewer, ViewableImage } from "./image-viewer";

/* 拖拽的写入排到下一帧（`onNextFrame` 合并同一帧内的多个 pointermove）——
 * 用例把它折成同步执行，好断言「这一帧写了什么」。 */
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  /* 有几条用例要给元素塞几何（`getBoundingClientRect` / `clientWidth`）——
   * 那是原型上的 spy，不还原会漏给后面的文件。 */
  vi.restoreAllMocks();
});

const SRC = "https://example.test/result.png";

/** 模拟图片解码完成，并把自然尺寸交给组件。 */
function emitLoad(base: HTMLElement, width: number, height: number) {
  const img = base.querySelector("img");
  expect(img, "画布里应当有一张 img").not.toBeNull();
  Object.defineProperty(img, "naturalWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(img, "naturalHeight", {
    value: height,
    configurable: true,
  });
  fireEvent.load(img!);
}

function renderViewer(onClose: () => void = () => undefined) {
  const view = render(
    <ImageViewer src={SRC} alt="运行结果" onClose={onClose} />,
  );
  return {
    ...view,
    canvas: () => view.getByTestId("image-viewer-canvas") as HTMLDivElement,
    percent: () =>
      view.getByTestId("image-viewer-percent").textContent?.trim() ?? "",
    mode: () => view.getByTestId("image-viewer-mode").textContent?.trim() ?? "",
  };
}

describe("ImageViewer", () => {
  it("src 为 null 时什么都不渲染（调用处用它表达「关着」）", () => {
    const { container } = render(
      <ImageViewer src={null} onClose={() => undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("头部给标题与原始像素尺寸（读自解码后的元素）", () => {
    const viewer = renderViewer();
    expect(viewer.getByText("运行结果")).not.toBeNull();

    emitLoad(viewer.baseElement, 1600, 1200);
    expect(viewer.baseElement.textContent).toContain("1600 × 1200");
  });

  it("放大 / 缩小按钮改的是同一个百分比", () => {
    const viewer = renderViewer();
    expect(viewer.percent()).toBe("100%");

    fireEvent.click(viewer.getByLabelText("放大"));
    expect(viewer.percent()).toBe("125%");
    expect(viewer.mode()).toBe("自定义缩放");

    fireEvent.click(viewer.getByLabelText("缩小"));
    expect(viewer.percent()).toBe("100%");
  });

  it("「原始大小」与「适应窗口」两个档位各自可回到", () => {
    const viewer = renderViewer();
    fireEvent.click(viewer.getByText("原始大小"));
    expect(viewer.mode()).toBe("原始大小");
    expect(viewer.percent()).toBe("100%");

    fireEvent.click(viewer.getByText("适应窗口"));
    expect(viewer.mode()).toBe("适应窗口");
  });

  it("双击画布在适应窗口与原始大小之间切换", () => {
    const viewer = renderViewer();
    fireEvent.doubleClick(viewer.canvas());
    expect(viewer.mode()).toBe("原始大小");
    fireEvent.doubleClick(viewer.canvas());
    expect(viewer.mode()).toBe("适应窗口");
  });

  it("适应窗口按**矩形**算倍数（用 clientWidth 会和滚动条互推、逐帧抖动）", () => {
    /* 模拟「滚动条正占着 15px」：矩形 800×600，而 clientWidth/Height 只有
     * 785×585。按 client 算会得到 737×553；可那个尺寸又恰好让内容溢出 →
     * 滚动条出现 → client 再变小 → 重算更小 → 滚动条消失 → …… 每一帧互推
     * 一次，就是用户看到的「不停抖动、滚动条一来一去」（逐帧重排也让拖拽发卡）。
     * 矩形是**布局尺寸**、不随滚动条出现与否而变，用它算才收敛到稳定解。 */
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 800, 600),
    );
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(785);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(585);

    const viewer = renderViewer();
    emitLoad(viewer.baseElement, 1600, 1200);

    const img = viewer.baseElement.querySelector("img")!;
    /* 可用区 768×568（四周各留 16px）：高度是绑定轴 → 倍数 568/1200 = 0.4733，
     * 1600×1200 落到 757.33×568 → 四舍五入 757×568（用 client 会是 737×553）。 */
    expect(img.style.width).toBe("757px");
    expect(img.style.height).toBe("568px");
  });

  it("滚轮向上放大、向下缩小（缩放前需要已知自然尺寸）", () => {
    const viewer = renderViewer();
    emitLoad(viewer.baseElement, 1600, 1200);

    fireEvent.wheel(viewer.canvas(), { deltaY: -100 });
    expect(viewer.percent()).toBe("125%");
    fireEvent.wheel(viewer.canvas(), { deltaY: 100 });
    expect(viewer.percent()).toBe("100%");
  });

  it("自然尺寸未知时滚轮不拦（让容器自己滚，缩放交给按钮）", () => {
    const viewer = renderViewer();
    fireEvent.wheel(viewer.canvas(), { deltaY: -100 });
    expect(viewer.percent()).toBe("100%");
  });

  it("拖拽期间只平移内容（transform），松手才落到滚动偏移", () => {
    const viewer = renderViewer();
    const canvas = viewer.canvas();
    const inner = viewer.getByTestId("image-viewer-content");
    canvas.scrollLeft = 100;
    canvas.scrollTop = 50;

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 190 });

    /* 拖动中：内容只用 transform 挪位（合成器，不重排），滚动偏移按兵不动。 */
    expect(inner.style.transform).toBe("translate3d(-20px, -10px, 0)");
    expect(canvas.scrollLeft).toBe(100);
    expect(canvas.scrollTop).toBe(50);

    /* 松手：位移一次性落到滚动偏移，transform 撤掉（滚动条与后续滚动随之对齐）。 */
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(canvas.scrollLeft).toBe(120);
    expect(canvas.scrollTop).toBe(60);
    expect(inner.style.transform).toBe("");
  });

  it("松手后再移动不会继续平移", () => {
    const viewer = renderViewer();
    const canvas = viewer.canvas();
    canvas.scrollLeft = 100;

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(canvas.scrollLeft).toBe(100);
  });

  it("同一帧内的多个 pointermove 只写一次，且写的是最后那个位置", () => {
    /* 这一条自己接管 rAF：默认 stub 是「同步执行」，那样看不出「合并」。
     * 帧队列里可能还有别的调用方（React / Dialog 的动画），所以按**增量**
     * 数帧，而不是数总数。 */
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    const viewer = renderViewer();
    const canvas = viewer.canvas();
    const inner = viewer.getByTestId("image-viewer-content");

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    const before = frames.length;
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 190, clientY: 200 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 200 });

    /* 两次移动只排一帧，而且在它落地前什么都不写（少一次布局就少一次重绘）。 */
    expect(frames.length - before).toBe(1);
    expect(inner.style.transform).toBe("");

    frames[frames.length - 1]!(0);
    expect(inner.style.transform).toBe("translate3d(-20px, 0px, 0)");
  });

  it("没有起手的 pointermove / pointerup 什么都不改", () => {
    const viewer = renderViewer();
    const canvas = viewer.canvas();
    const inner = viewer.getByTestId("image-viewer-content");
    canvas.scrollLeft = 33;

    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 9 });
    expect(inner.style.transform).toBe("");
    expect(canvas.scrollLeft).toBe(33);
  });

  it("拖拽中关掉查看器会取消还排着的那一帧", () => {
    vi.stubGlobal("requestAnimationFrame", () => 7);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const viewer = renderViewer();
    fireEvent.pointerDown(viewer.canvas(), {
      button: 0,
      pointerId: 1,
      clientX: 1,
      clientY: 1,
    });
    fireEvent.pointerMove(viewer.canvas(), {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
    });
    viewer.unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("关闭按钮是唯一的显式出口（回调由调用处决定关不关）", () => {
    const onClose = vi.fn();
    const viewer = renderViewer(onClose);
    fireEvent.click(viewer.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("图片加载失败时给兜底文案，不画破图", () => {
    const viewer = renderViewer();
    fireEvent.error(viewer.baseElement.querySelector("img")!);
    expect(viewer.baseElement.textContent).toContain("图片不可用");
  });

  it("label 缺省回退到 alt，再回退到通用文案", () => {
    const altOnly = render(
      <ImageViewer src={SRC} alt="封面" onClose={() => undefined} />,
    );
    expect(altOnly.getByText("封面")).not.toBeNull();

    cleanup();
    const none = render(<ImageViewer src={SRC} onClose={() => undefined} />);
    expect(none.getByText("图片查看")).not.toBeNull();
  });
});

describe("ViewableImage", () => {
  it("默认只渲染缩略图，点一下才出现查看器", () => {
    const view = render(<ViewableImage src={SRC} alt="结果图" />);
    expect(view.baseElement.querySelector("img")).not.toBeNull();
    expect(
      view.baseElement.querySelector('[data-slot="image-viewer"]'),
    ).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "查看大图：结果图" }));
    expect(
      view.baseElement.querySelector('[data-slot="image-viewer"]'),
    ).not.toBeNull();
  });

  it("关闭查看器后缩略图还在（查看器不吞掉触发布局）", () => {
    const view = render(<ViewableImage src={SRC} alt="结果图" />);
    fireEvent.click(view.getByRole("button", { name: "查看大图：结果图" }));
    fireEvent.click(view.getByRole("button", { name: "关闭" }));
    expect(
      view.baseElement.querySelector('[data-slot="image-viewer"]'),
    ).toBeNull();
    expect(view.baseElement.querySelector("img")).not.toBeNull();
  });

  it("alt 作标题；label 优先于 alt", () => {
    const view = render(<ViewableImage src={SRC} alt="缩略图" />);
    fireEvent.click(view.getByRole("button", { name: "查看大图：缩略图" }));
    expect(view.getByText("缩略图")).not.toBeNull();
  });

  it("没有 src 时整块不渲染", () => {
    const view = render(<ViewableImage src={null} alt="x" />);
    expect(view.container.innerHTML).toBe("");
  });
});
