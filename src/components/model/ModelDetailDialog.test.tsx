// @vitest-environment jsdom
// 模型详情弹窗：字段只列库里真有的那些，且「不知道」与「没有」要分开。
//
// 三件判据：
//   · 目录 = folder + subfolder 的拼接，任一为空不许留孤零零的 `/`；
//   · `isAvailable` 为 undefined（这一列没给）与 false（明确不可用）不是一回事，
//     前者给占位符、后者才说「不可用」；
//   · 不出现「N 次引用 / N 次收藏」—— 本机模型库没有这两列，原型上有，落进来就是假数据。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ModelDetailDialog, modelDisplayPath } from "./ModelDetailDialog";
import type { ModelCardData } from "./ModelCard";

afterEach(cleanup);

function model(over: Partial<ModelCardData> = {}): ModelCardData {
  return {
    id: "m1",
    name: "Realistic Vision",
    type: "CHECKPOINT",
    fileName: "realisticVision_v5.safetensors",
    folder: "checkpoints",
    subfolder: "v5",
    baseModel: "SD 1.5",
    source: "LOCAL",
    isAvailable: true,
    ...over,
  };
}

describe("modelDisplayPath", () => {
  it("folder + subfolder 拼成一条相对目录", () => {
    expect(modelDisplayPath({ folder: "checkpoints", subfolder: "v5" })).toBe(
      "checkpoints/v5",
    );
  });

  it("只有 folder 时不留尾斜杠，只有 subfolder 时不留头斜杠", () => {
    expect(modelDisplayPath({ folder: "loras", subfolder: null })).toBe(
      "loras",
    );
    expect(modelDisplayPath({ folder: null, subfolder: "nested" })).toBe(
      "nested",
    );
  });

  it("两者都空给空串（由调用处决定显示占位符）", () => {
    expect(modelDisplayPath({ folder: null, subfolder: null })).toBe("");
  });
});

describe("ModelDetailDialog", () => {
  it("没选中模型时什么都不渲染", () => {
    const { container } = render(
      <ModelDetailDialog model={null} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("列出真实字段：文件名 / 类型 / 所在目录 / 基座 / 来源 / 状态", () => {
    render(<ModelDetailDialog model={model()} onClose={vi.fn()} />);
    /* 标题是展示名，「文件名」那一行是落盘文件名 —— 两者现在分得开。 */
    expect(screen.getByText("Realistic Vision")).toBeTruthy();
    expect(screen.getByText("realisticVision_v5.safetensors")).toBeTruthy();
    expect(screen.getByText("大模型")).toBeTruthy();
    expect(screen.getByText("checkpoints/v5")).toBeTruthy();
    expect(screen.getByText("SD 1.5")).toBeTruthy();
    expect(screen.getByText("LOCAL")).toBeTruthy();
    expect(screen.getByText("可用")).toBeTruthy();
  });

  it("isAvailable 没给 ≠ 不可用：前者是占位符，后者才写「不可用」", () => {
    const unknown = render(
      <ModelDetailDialog
        model={model({ isAvailable: undefined })}
        onClose={vi.fn()}
      />,
    );
    expect(unknown.queryByText("不可用")).toBeNull();
    unknown.unmount();

    render(
      <ModelDetailDialog
        model={model({ isAvailable: false })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("不可用")).toBeTruthy();
  });

  it("不渲染本机拿不到的数据（引用数 / 收藏数）", () => {
    render(<ModelDetailDialog model={model()} onClose={vi.fn()} />);
    expect(screen.queryByText(/次引用|次收藏|赞/)).toBeNull();
    /* 明确告诉用户这些信息为什么不在，而不是留一片空白让人以为在藏。 */
    expect(screen.getByText(/本地扫描拿不到/)).toBeTruthy();
  });

  it("描述为空时不占一段", () => {
    const withDesc = render(
      <ModelDetailDialog
        model={model({ description: "  风格化写实底模  " })}
        onClose={vi.fn()}
      />,
    );
    expect(withDesc.getByText("风格化写实底模")).toBeTruthy();
    withDesc.unmount();

    const blank = render(
      <ModelDetailDialog
        model={model({ description: "   " })}
        onClose={vi.fn()}
      />,
    );
    expect(blank.queryByText("   ")).toBeNull();
  });
});
