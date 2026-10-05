/**
 * 「渲染一张可能失败的媒体图」只允许一处实现的契约（ISSUE #672 §16.2.4.21）。
 *
 * 现场：全库 18 个文件的裸 `<img>` 里，**失败这一侧有四种写法** ——
 * `style.display = "none"`（`HomePage`）、`style.visibility = "hidden"`
 * （已删的训练工作室）、自持 `useState(failed)` + 方块（`WorkflowImagePreview`）、
 * 长文案说明（`SettingsPrimitives`）；另外 14 处**压根没有兜底**。
 *
 * 这里钉的是「行为不再取决于从哪个面板渲染」这件事，所以断言都落在
 * **失败之后 DOM 里还剩什么**与**src 换了之后有没有重新给机会**上。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { MediaThumbnail } from "./media-thumbnail";

afterEach(cleanup);

const IMG = "https://example.test/a.png";
const IMG2 = "https://example.test/b.png";

/** 触发底层元素的 error 事件（jsdom 不会真的去加载 URL）。 */
function failFirstMedia(container: HTMLElement) {
  const el = container.querySelector("img, video");
  expect(el).not.toBeNull();
  fireEvent.error(el!);
}

describe("失败兜底收在出口里", () => {
  it("默认渲染 <img>，并自带 lazy / async（调用处不再各写一遍）", () => {
    const { container } = render(<MediaThumbnail src={IMG} alt="x" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
  });

  it("失败后默认换成中性占位，且不是把元素藏起来（格子仍在）", () => {
    const { container } = render(
      <MediaThumbnail src={IMG} alt="x" className="size-10" />,
    );
    failFirstMedia(container);
    /* 破图 / 被藏起来的元素都该消失。 */
    expect(container.querySelector("img")).toBeNull();
    const placeholder = container.querySelector('[role="img"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("图片不可用");
    /* 占位继承调用处的盒子 —— `display:none` / `visibility:hidden` 做不到这点。 */
    expect(placeholder!.className).toContain("size-10");
  });

  it('fallback="none" 时什么都不渲染（列表里宁缺勿错）', () => {
    const { container } = render(<MediaThumbnail src={IMG} fallback="none" />);
    failFirstMedia(container);
    expect(container.innerHTML).toBe("");
  });

  it("fallback 传节点时按调用处的盒子渲染", () => {
    const { container } = render(
      <MediaThumbnail src={IMG} fallback={<span>自定义兜底</span>} />,
    );
    failFirstMedia(container);
    expect(container.textContent).toContain("自定义兜底");
  });

  it("onLoadError 只在失败时回调一次，且带上 src", () => {
    const onLoadError = vi.fn();
    const { container } = render(
      <MediaThumbnail src={IMG} onLoadError={onLoadError} />,
    );
    failFirstMedia(container);
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(onLoadError).toHaveBeenCalledWith(IMG);
  });

  it("src 变化后重新给一次机会（列表复用同一实例不该「换图仍是破图」）", () => {
    const { container, rerender } = render(<MediaThumbnail src={IMG} />);
    failFirstMedia(container);
    expect(container.querySelector("img")).toBeNull();
    rerender(<MediaThumbnail src={IMG2} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(IMG2);
  });

  it("src 为空时不渲染任何东西", () => {
    const { container } = render(<MediaThumbnail src={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("视频与图片走同一个出口", () => {
  it("视频渲染 <video>，失败同样走兜底", () => {
    const { container } = render(<MediaThumbnail src="/a.mp4" />);
    expect(container.querySelector("video")).not.toBeNull();
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('[role="img"]')).not.toBeNull();
  });

  it("video 的播放相关属性都透传", () => {
    const { container } = render(
      <MediaThumbnail src="/a.mp4" autoPlay loop muted={false} />,
    );
    const video = container.querySelector("video")!;
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.hasAttribute("loop")).toBe(true);
    /* 显式 `muted={false}` 不该被默认值盖掉。 */
    expect(video.hasAttribute("muted")).toBe(false);
  });

  it("onLoad 拿到的是底层媒体元素（供读 naturalWidth / 尺寸）", () => {
    const onLoad = vi.fn();
    const { container } = render(<MediaThumbnail src={IMG} onLoad={onLoad} />);
    fireEvent.load(container.querySelector("img")!);
    expect(onLoad).toHaveBeenCalledTimes(1);
    const el = onLoad.mock.calls[0]![0] as unknown as { tagName: string };
    expect(el.tagName).toBe("IMG");
  });

  it("视频的 onLoad 在 loadeddata 时回调（视频没有 load 事件概念）", () => {
    const onLoad = vi.fn();
    const { container } = render(
      <MediaThumbnail src="/a.mp4" onLoad={onLoad} />,
    );
    fireEvent.loadedData(container.querySelector("video")!);
    expect(onLoad).toHaveBeenCalledTimes(1);
    const el = onLoad.mock.calls[0]![0] as unknown as { tagName: string };
    expect(el.tagName).toBe("VIDEO");
  });

  it("额外的 DOM 属性（onClick / title）原样透传到媒体元素", () => {
    const onClick = vi.fn();
    const { container } = render(
      <MediaThumbnail src={IMG} title="封面" onClick={onClick} />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("title")).toBe("封面");
    fireEvent.click(img);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
