// @vitest-environment jsdom
// 回归护栏：LoadImage 的「选择文件上传」槽（ComfyUI frontend 类型 IMAGEUPLOAD）
// 必须在工作流表单里渲染成上传控件，标签用作者写的 label，类型徽章如实打印。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DynamicWorkflowForm } from "./index";
import type { WorkflowIOMap } from "../workflow-io";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/** 复刻 ISSUE #311 里 LoadImage 节点被勾成对外参数的形状。 */
const LOAD_IMAGE_IO: WorkflowIOMap = {
  "23::widget::image": {
    direction: "input",
    kind: "widget",
    nodeId: "23",
    name: "image",
    label: "First Frame Image",
    type: "COMBO",
    options: ["tmp3g2v80p6.png"],
    defaultValue: "tmp3g2v80p6.png",
  },
  "23::widget::upload": {
    direction: "input",
    kind: "widget",
    nodeId: "23",
    name: "upload",
    label: "choose 1st frame to upload",
    type: "IMAGEUPLOAD",
    defaultValue: "",
  },
  "23::output::IMAGE": {
    direction: "output",
    kind: "output",
    nodeId: "23",
    name: "IMAGE",
    type: "IMAGE",
  },
};

/** 表单本体不发请求：这里只验证纯展示层（上传位由 controller 的 pickFile 触达）。 */
function renderForm(values: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(
    <DynamicWorkflowForm
      io={LOAD_IMAGE_IO}
      values={values}
      onChange={onChange}
      showOutputs
    />,
  );
  return { onChange };
}

describe("DynamicWorkflowForm — 图片上传位（ISSUE #311）", () => {
  it("上传槽渲染成上传按钮（不再是只能敲文件名的文本框）", () => {
    renderForm();
    const button = screen.getByRole("button", {
      name: /上传 choose 1st frame to upload/,
    });
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");
  });

  it("标签优先打印作者 label，而不是 ComfyUI 的 localized_name", () => {
    renderForm();
    expect(screen.getByText("choose 1st frame to upload")).toBeInTheDocument();
    expect(screen.getByText("First Frame Image")).toBeInTheDocument();
  });

  it("类型徽章如实打印 IMAGEUPLOAD", () => {
    renderForm();
    expect(screen.getByText("IMAGEUPLOAD")).toBeInTheDocument();
  });

  it("上传成功后回填的文件名会展示出来", () => {
    renderForm({ "23::widget::upload": "uploaded-frame.png" });
    expect(screen.getByText(/已选：uploaded-frame\.png/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /上传 choose 1st frame to upload/ }),
    ).not.toBeInTheDocument();
  });

  it("上传按钮可点击（未禁用时）", () => {
    renderForm();
    const button = screen.getByRole("button", {
      name: /上传 choose 1st frame to upload/,
    });
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});
