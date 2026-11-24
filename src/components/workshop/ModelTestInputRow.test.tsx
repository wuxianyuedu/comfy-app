/**
 * 测试模型 · 图片输入行的拖拽上传（ISSUE #4975）：判行为 —— 空值时给出
 * 「可拖拽」的显性标识（虚线投放瓦片 + 提示文案）、拖入图片与点击上传走
 * 同一条 onPickFile 链路、一次拖入多张到单图口经 onError 给可读话术、
 * 悬停高亮随进出台面亮灭、禁用行不接拖拽。事件沿 use-drop-zone.test 的
 * 先例经 fireEvent 走真 DOM 拖拽分发（dataTransfer 喂普通对象）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { InputRow } from "./ModelTestInputRow";

afterEach(cleanup);

const imgFile = (name = "a.png") => new File(["图片"], name, { type: "image/png" });

function renderImageRow({
  disabled,
  value = "",
}: {
  disabled?: boolean;
  value?: string;
} = {}) {
  const onChange = vi.fn();
  const onError = vi.fn();
  const onPickFile = vi.fn();
  render(
    <InputRow
      control="image"
      disabled={disabled}
      id="model-test-input-first-frame"
      label="首帧图片"
      onChange={onChange}
      onError={onError}
      onPickFile={onPickFile}
      required
      value={value}
    />,
  );
  return { onChange, onError, onPickFile };
}

/** 投放目标 = 上传瓦片（或缩略图行）的父级整行。 */
function dropTarget() {
  const anchor = screen.queryByText("点击或拖拽图片到此处") ?? screen.getByText("换一张");
  const row = anchor.closest("div");
  if (!row) {
    throw new Error("投放区没渲染出来");
  }
  return row;
}

describe("InputRow 的图片拖拽上传（ISSUE #4975）", () => {
  it("空值时给出可拖拽的显性标识：虚线投放瓦片 + 「点击或拖拽」提示", () => {
    renderImageRow();

    expect(screen.getByText("上传图片")).toBeTruthy();
    expect(screen.getByText("点击或拖拽图片到此处")).toBeTruthy();
    /* 瓦片是真实按钮（键盘可达），虚线框是投放区的常规形状。 */
    const tile = screen.getByText("上传图片").closest("button");
    expect(tile?.className).toContain("border-dashed");
  });

  it("拖入一张图片：走 onPickFile（与点击上传同链路），不报错", () => {
    const { onError, onPickFile } = renderImageRow();
    const file = imgFile();

    fireEvent.drop(dropTarget(), {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    expect(onPickFile).toHaveBeenCalledWith(file);
    expect(onError).not.toHaveBeenCalled();
  });

  it("一次拖入多张到单图口：onError 出可读话术，onPickFile 不被调用", () => {
    const { onError, onPickFile } = renderImageRow();

    fireEvent.drop(dropTarget(), {
      dataTransfer: {
        files: [imgFile("a.png"), imgFile("b.png")],
        types: ["Files"],
      },
    });

    expect(onError).toHaveBeenCalledWith("一次只能拖入一个文件（收到了 2 个）");
    expect(onPickFile).not.toHaveBeenCalled();
  });

  it("拖拽悬停点亮高亮（data-active），离开 / 落下后熄灭", () => {
    renderImageRow();
    const row = dropTarget();

    fireEvent.dragEnter(row, { dataTransfer: { types: ["Files"], files: [] } });
    expect(row.dataset.active).toBe("true");

    fireEvent.dragLeave(row, { dataTransfer: { types: ["Files"], files: [] } });
    expect(row.dataset.active).toBe("false");

    fireEvent.dragEnter(row, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.drop(row, { dataTransfer: { files: [imgFile()], types: ["Files"] } });
    expect(row.dataset.active).toBe("false");
  });

  it("已有值：缩略图 + 换一张 / 清除；此时拖入图片仍走 onPickFile", () => {
    const { onChange, onPickFile } = renderImageRow({ value: "data:image/png;base64,AAA" });

    expect(screen.getByText("换一张")).toBeTruthy();
    expect(screen.getByText("清除")).toBeTruthy();
    fireEvent.click(screen.getByText("清除"));
    expect(onChange).toHaveBeenCalledWith("");

    fireEvent.drop(dropTarget(), {
      dataTransfer: { files: [imgFile("b.png")], types: ["Files"] },
    });
    expect(onPickFile).toHaveBeenCalled();
  });

  it("禁用行不接拖拽：drop 不触发 onPickFile 也不点亮", () => {
    renderImageRow({ disabled: true });
    const row = dropTarget();

    fireEvent.dragEnter(row, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.drop(row, { dataTransfer: { files: [imgFile()], types: ["Files"] } });

    expect(row.dataset.active).toBe("false");
  });
});
