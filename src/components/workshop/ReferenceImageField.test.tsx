/**
 * 参考图缩略图可点开查看器（ISSUE #4840）：判接线 —— 缩略图是「查看大图」按钮
 * （`ViewableImage`），点击后 `ImageViewer` 挂载；「移除」按钮仍是兄弟控件、
 * 行为不变；没有参考图时只有上传入口、无查看出口。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ReferenceImageField } from "./ReferenceImageField";

afterEach(cleanup);

const IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function renderField(images: Array<string> = [IMG]) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <ReferenceImageField
      id="ref-image"
      images={images}
      label="参考图"
      onAdd={onAdd}
      onRemove={onRemove}
      required
    />,
  );
  return { onAdd, onRemove };
}

describe("ReferenceImageField 的参考图查看（ISSUE #4840）", () => {
  it("点击参考图缩略图打开图片查看器（放大查看）", () => {
    renderField();
    fireEvent.click(screen.getByRole("button", { name: "查看大图：参考图 1" }));
    expect(document.querySelector('[data-slot="image-viewer"]')).not.toBeNull();
  });

  it("查看器开着时「移除」按钮仍可用（行为不变）", () => {
    const { onRemove } = renderField();
    fireEvent.click(screen.getByRole("button", { name: "查看大图：参考图 1" }));
    expect(screen.getByLabelText("移除第 1 张参考图")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("移除第 1 张参考图"));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("没有参考图时不渲染查看入口，只给上传按钮", () => {
    renderField([]);
    expect(screen.queryByRole("button", { name: /查看大图/ })).toBeNull();
    expect(screen.getByText("上传参考图")).toBeTruthy();
  });
});
