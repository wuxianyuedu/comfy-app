// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WidgetInputRow } from "./WidgetInputRow";
import type { EnrichedWidget } from "../../workflow-io";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/** LoadImage 上传位（ComfyUI 自定义 frontend 类型 IMAGEUPLOAD）。 */
function uploadPin(over: Partial<EnrichedWidget> = {}): EnrichedWidget {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "23",
    name: "upload",
    label: "choose 1st frame to upload",
    type: "IMAGEUPLOAD",
    control: "image",
    ioKey: "23::widget::upload",
    ...over,
  };
}

function renderRow(entry: EnrichedWidget, over: Partial<Parameters<typeof WidgetInputRow>[0]> = {}) {
  const onPickFile = vi.fn();
  const onValueChange = vi.fn();
  render(
    <WidgetInputRow
      entry={entry}
      allPins={[entry]}
      value={undefined}
      compact={false}
      disabled={false}
      uploading={false}
      onValueChange={onValueChange}
      onPickFile={onPickFile}
      {...over}
    />
  );
  return { onPickFile, onValueChange };
}

describe("WidgetInputRow — 图片上传位", () => {
  it("标签打印作者 label,而不是 ComfyUI 的通用 localized_name", () => {
    renderRow(uploadPin());
    expect(screen.getByText("choose 1st frame to upload")).toBeInTheDocument();
    expect(screen.queryByText("选择文件上传")).not.toBeInTheDocument();
  });

  it("渲染上传按钮,点击触发选文件", () => {
    const { onPickFile } = renderRow(uploadPin());
    const button = screen.getByRole("button", { name: /上传 choose 1st frame to upload/ });
    fireEvent.click(button);
    expect(onPickFile).toHaveBeenCalledTimes(1);
  });

  it("已有文件名时展示「已选：<文件名>」", () => {
    renderRow(uploadPin(), { value: "tmp3g2v80p6.png" });
    expect(screen.getByText(/已选：tmp3g2v80p6\.png/)).toBeInTheDocument();
  });

  it("类型徽章如实打印 IMAGEUPLOAD,不回退成别的类型", () => {
    renderRow(uploadPin());
    expect(screen.getByText("IMAGEUPLOAD")).toBeInTheDocument();
  });

  it("缺类型时徽章回退到控件隐含类型(IMAGE)", () => {
    renderRow(uploadPin({ type: undefined }));
    expect(screen.getByText("IMAGE")).toBeInTheDocument();
  });
});

describe("WidgetInputRow — 类型徽章与 pin 声明一致", () => {
  it("声明 STRING 的普通文本行打印 STRING,不再被改写成 INT", () => {
    renderRow(
      uploadPin({
        name: "text",
        label: "正向提示词",
        type: "STRING",
        control: "text",
        ioKey: "10::widget::text",
      })
    );
    expect(screen.getByText("STRING")).toBeInTheDocument();
  });

  it("COMBO 行仍打印 COMBO", () => {
    renderRow(
      uploadPin({
        name: "sampler_name",
        label: "采样器",
        type: "COMBO",
        control: "select",
        options: ["euler", "dpmpp_2m"],
        ioKey: "3::widget::sampler_name",
      })
    );
    expect(screen.getByText("COMBO")).toBeInTheDocument();
  });
});
