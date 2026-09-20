// @vitest-environment jsdom
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageViewer, ViewableImage } from "./image-viewer";

afterEach(cleanup);

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

  it("按住拖拽直接改容器的滚动偏移（位移与指针反向）", () => {
    const viewer = renderViewer();
    const canvas = viewer.canvas();
    canvas.scrollLeft = 100;
    canvas.scrollTop = 50;

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 190 });
    expect(canvas.scrollLeft).toBe(120);
    expect(canvas.scrollTop).toBe(60);

    /* 松手后再移动不该继续平移。 */
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(canvas.scrollLeft).toBe(120);
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
