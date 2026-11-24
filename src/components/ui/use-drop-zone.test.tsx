/* useDropZone 的行为单测（#4827 抽成共享件时的基线，规范 11.2 行为测试优先）：
 *  只认带 Files 的拖动（文本拖动不点亮）、enter/leave 计数抵消子元素冒泡、
 *  多文件 / 空投递的话术走 onError、单文件交 onFile 且高亮复位。
 *  事件经 fireEvent 走真 DOM 拖拽分发（dataTransfer 喂普通对象，沿
 *  WorkflowImportPanel.test 的先例）；`.test.tsx` ⇒ DOM 档由配置路由给出。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useDropZone, type DropZoneOptions } from "./use-drop-zone";

afterEach(cleanup);

/** 投放区骨架：active 态落在 `data-active` 上供断言；内层 span 用来制造子元素进出。 */
function Harness({
  onError,
  onFile,
  options,
}: {
  onError: (m: string) => void;
  onFile: (f: File) => void | Promise<void>;
  options?: DropZoneOptions;
}) {
  const dz = useDropZone(onFile, onError, options);
  return (
    <div
      data-active={dz.active ? "1" : "0"}
      onDragEnter={dz.onDragEnter}
      onDragLeave={dz.onDragLeave}
      onDragOver={dz.onDragOver}
      onDrop={dz.onDrop}
    >
      <span>inner</span>
    </div>
  );
}

function renderZone(options?: DropZoneOptions) {
  const onFile = vi.fn();
  const onError = vi.fn();
  render(<Harness onError={onError} onFile={onFile} options={options} />);
  const zone = screen.getByText("inner").parentElement;
  if (!zone) {
    throw new Error("投放区没渲染出来");
  }
  return { zone, onFile, onError };
}

const mdFile = (name = "a.md") => new File(["剧本正文"], name, { type: "text/markdown" });

describe("useDropZone（#4827）", () => {
  it("只认带 Files 的拖动：文本拖动不点亮高亮", () => {
    const { zone } = renderZone();

    fireEvent.dragEnter(zone, { dataTransfer: { types: ["text/plain"], files: [] } });

    expect(zone.dataset.active).toBe("0");
  });

  it("Files 拖入点亮；子元素进出计数抵消，全部离开才熄灭", () => {
    const { zone } = renderZone();

    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"], files: [] } });
    expect(zone.dataset.active).toBe("1");

    /* 光标掠过子元素：enter(子) + leave(子) 一对配对，高亮不闪（计数 2 → 1）。 */
    const inner = screen.getByText("inner");
    fireEvent.dragEnter(inner, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.dragLeave(inner, { dataTransfer: { types: ["Files"], files: [] } });
    expect(zone.dataset.active).toBe("1");

    fireEvent.dragLeave(zone, { dataTransfer: { types: ["Files"], files: [] } });
    expect(zone.dataset.active).toBe("0");
  });

  it("drop 多文件：onError 出可读话术，onFile 不被调用", () => {
    const { zone, onFile, onError } = renderZone();

    fireEvent.drop(zone, {
      dataTransfer: { files: [mdFile("a.md"), mdFile("b.md")], types: ["Files"] },
    });

    expect(onError).toHaveBeenCalledWith("一次只能拖入一个文件（收到了 2 个）");
    expect(onFile).not.toHaveBeenCalled();
  });

  it("drop 单文件：交 onFile，高亮复位", () => {
    const { zone, onFile, onError } = renderZone();
    const file = mdFile();

    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } });

    expect(onFile).toHaveBeenCalledWith(file);
    expect(onError).not.toHaveBeenCalled();
    expect(zone.dataset.active).toBe("0");
  });

  it("drop 空投递：不交 onFile 也不报错", () => {
    const { zone, onFile, onError } = renderZone();

    fireEvent.drop(zone, { dataTransfer: { files: [], types: ["Files"] } });

    expect(onFile).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  /* ── multiple 档（#4975：参考图多选一次拖入多张）── */
  it("multiple：一次拖入多张整批交 onFiles，不走 onError", () => {
    const onFiles = vi.fn();
    const { zone, onFile, onError } = renderZone({ multiple: true, onFiles });
    const files = [mdFile("a.png"), mdFile("b.png"), mdFile("c.png")];

    fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } });

    expect(onFiles).toHaveBeenCalledWith(files);
    expect(onFile).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(zone.dataset.active).toBe("0");
  });

  it("multiple：拖入一张也走 onFiles（整批语义一致）", () => {
    const onFiles = vi.fn();
    const { zone, onError } = renderZone({ multiple: true, onFiles });
    const file = mdFile("a.png");

    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } });

    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("multiple 没给 onFiles：退回逐个交 onFile", () => {
    const { zone, onFile, onError } = renderZone({ multiple: true });
    const files = [mdFile("a.png"), mdFile("b.png")];

    fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } });

    expect(onFile).toHaveBeenCalledTimes(2);
    expect(onFile).toHaveBeenNthCalledWith(1, files[0]);
    expect(onFile).toHaveBeenNthCalledWith(2, files[1]);
    expect(onError).not.toHaveBeenCalled();
  });
});
