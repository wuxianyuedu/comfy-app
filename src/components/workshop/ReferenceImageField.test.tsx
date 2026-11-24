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

/* ── 拖拽上传（ISSUE #4975）：参考图口一次可拖入多张，与点选同一条 onAdd 链路 ── */

const imgFile = (name: string) => new File(["图片"], name, { type: "image/png" });

function dropTarget() {
  /* 空态锚子提示，已有图时锚「添加图片」（子提示只在空态渲染）。 */
  const anchor = screen.queryByText("点击或拖拽图片到此处") ?? screen.getByText("添加图片");
  const row = anchor.closest("div");
  if (!row) {
    throw new Error("投放区没渲染出来");
  }
  return row;
}

describe("ReferenceImageField 的拖拽上传（ISSUE #4975）", () => {
  it("空态给出可拖拽的显性标识：虚线投放瓦片 + 「点击或拖拽」提示", () => {
    renderField([]);

    expect(screen.getByText("上传参考图")).toBeTruthy();
    expect(screen.getByText("点击或拖拽图片到此处")).toBeTruthy();
    const tile = screen.getByText("上传参考图").closest("button");
    expect(tile?.className).toContain("border-dashed");
  });

  it("一次拖入多张：整批交 onAdd（multiple 档），高亮复位", () => {
    const { onAdd } = renderField([]);
    const files = [imgFile("a.png"), imgFile("b.png"), imgFile("c.png")];

    fireEvent.drop(dropTarget(), {
      dataTransfer: { files, types: ["Files"] },
    });

    expect(onAdd).toHaveBeenCalledWith(files);
    expect(dropTarget().dataset.active).toBe("false");
  });

  it("拖拽悬停点亮高亮（data-active），离开熄灭", () => {
    renderField([]);
    const row = dropTarget();

    fireEvent.dragEnter(row, { dataTransfer: { types: ["Files"], files: [] } });
    expect(row.dataset.active).toBe("true");

    fireEvent.dragLeave(row, { dataTransfer: { types: ["Files"], files: [] } });
    expect(row.dataset.active).toBe("false");
  });

  it("已有参考图：投放瓦片变为「添加图片」，仍可拖入追加", () => {
    const { onAdd } = renderField();

    expect(screen.getByText("添加图片")).toBeTruthy();
    const file = imgFile("b.png");
    fireEvent.drop(dropTarget(), {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(onAdd).toHaveBeenCalledWith([file]);
  });
});
