import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IoEndpointsSection } from "./IoEndpointsSection";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { EnrichedWidget, WorkflowIOEntry } from "../../../workflow-io";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

/** 按源码真实类型构造 wire-only 输入(EnrichedWidget = WorkflowIOEntry & { ioKey; control })。 */
function wireInput(
  over: Partial<EnrichedWidget> & Pick<EnrichedWidget, "ioKey" | "name">,
): EnrichedWidget {
  return {
    direction: "input",
    kind: "param",
    nodeId: "10",
    type: "MODEL",
    control: "link",
    ...over,
  };
}

/** 输出端点只要求 WorkflowIOEntry + ioKey。 */
function output(
  over: Partial<WorkflowIOEntry> & Pick<WorkflowIOEntry, "name"> & { ioKey: string },
): WorkflowIOEntry & { ioKey: string } {
  return {
    direction: "output",
    kind: "output",
    nodeId: "20",
    type: "IMAGE",
    ...over,
  };
}

/** SectionHeader 的 count 圆标文本(分段头内唯一的 font-mono span)。 */
function headerCount(): string {
  const count = screen.getByText("I/O 端点").parentElement?.querySelector("span.font-mono");
  return count?.textContent ?? "";
}

describe("IoEndpointsSection", () => {
  it("空态:仅渲染分段头且 count 为 0,无 chip、无「输出端点」", () => {
    render(<IoEndpointsSection inputs={[]} outputs={[]} showOutputs wireInputs={[]} />);
    expect(screen.getByText("I/O 端点")).toBeInTheDocument();
    expect(headerCount()).toBe("0");
    expect(screen.queryByText("输出端点")).not.toBeInTheDocument();
    /* 没有 pack 渲染任何 chip —— 类型徽标缺席即「无连线输入」。 */
    expect(screen.queryByText("CONDITIONING")).not.toBeInTheDocument();
  });

  it("渲染 wire 输入 chip:label + 原始类型 + 「仅可通过连线输入」悬停提示", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <IoEndpointsSection
          inputs={[
            wireInput({
              ioKey: "10::param::positive",
              name: "positive",
              label: "正向提示",
            }),
          ]}
          outputs={[]}
          showOutputs={false}
          wireInputs={[
            wireInput({
              ioKey: "10::param::positive",
              name: "positive",
              label: "正向提示",
              type: "CONDITIONING",
              nodeTitle: "K采样器",
            }),
          ]}
        />
      </TooltipProvider>,
    );
    expect(headerCount()).toBe("1");
    expect(screen.getByText("正向提示")).toBeInTheDocument();
    expect(screen.getByText("CONDITIONING")).toBeInTheDocument();
    /* 原生 title= 撤干净：连线输入说明走 <Hint>，悬停落在 tooltip 浮层里。 */
    await user.hover(screen.getByText("正向提示"));
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
      "K采样器 · positive · 仅可通过连线输入",
    );
  });

  it("ioLabel 冲突回退:多个 entry 共用同一 label 时改用 name 区分", () => {
    const w1 = wireInput({ ioKey: "a", name: "inputImage", label: "图像" });
    const w2 = wireInput({ ioKey: "b", name: "outputImage", label: "图像" });
    render(
      <IoEndpointsSection
        inputs={[w1, w2]}
        outputs={[]}
        showOutputs={false}
        wireInputs={[w1, w2]}
      />,
    );
    // label 相同 → 都回退为各自的 name,而不是重复显示「图像」
    expect(screen.getByText("inputImage")).toBeInTheDocument();
    expect(screen.getByText("outputImage")).toBeInTheDocument();
    expect(screen.queryByText("图像")).not.toBeInTheDocument();
  });

  it("showOutputs=false 时 outputs 不渲染,且 count 不包含 outputs", () => {
    render(
      <IoEndpointsSection
        inputs={[wireInput({ ioKey: "a", name: "model" })]}
        outputs={[output({ ioKey: "o1", name: "IMAGE_FINAL", label: "最终图像" })]}
        showOutputs={false}
        wireInputs={[wireInput({ ioKey: "a", name: "model" })]}
      />,
    );
    expect(headerCount()).toBe("1");
    expect(screen.queryByText("输出端点")).not.toBeInTheDocument();
    expect(screen.queryByText("最终图像")).not.toBeInTheDocument();
  });

  it("showOutputs=true 时渲染「输出端点」与 output chip(类型经 normalizeTypeChip)", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <IoEndpointsSection
          inputs={[]}
          outputs={[
            output({
              ioKey: "o1",
              name: "IMAGE_FINAL",
              label: "最终图像",
              type: "IMAGE",
            }),
          ]}
          showOutputs
          wireInputs={[]}
        />
      </TooltipProvider>,
    );
    expect(headerCount()).toBe("1");
    expect(screen.getByText("输出端点")).toBeInTheDocument();
    expect(screen.getByText("最终图像")).toBeInTheDocument();
    // IMAGE 在 normalizeTypeChip 的白名单内,原样大写展示
    expect(screen.getByText("IMAGE")).toBeInTheDocument();
    /* nodeTitle 为空时悬浮提示文案为 " · IMAGE_FINAL"；原生 title= 撤干净，
     * 说明走 <Hint>，悬停落在 tooltip 浮层里。 */
    await user.hover(screen.getByText("最终图像"));
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
      "· IMAGE_FINAL",
    );
  });

  it("自定义输出类型原样展示(type 是什么就显示什么)", () => {
    render(
      <IoEndpointsSection
        inputs={[]}
        outputs={[output({ ioKey: "o1", name: "latent_out", type: "LATENT" })]}
        showOutputs
        wireInputs={[]}
      />,
    );
    /* LATENT / IMAGEUPLOAD 这类不在常用白名单里的类型也必须如实打印——
     * 回退成 INT 会让用户看到的类型与工作流定义对不上。 */
    expect(screen.getByText("LATENT")).toBeInTheDocument();
  });

  it("IMAGEUPLOAD 上传位 chip 如实展示 IMAGEUPLOAD", () => {
    render(
      <IoEndpointsSection
        inputs={[]}
        outputs={[]}
        showOutputs={false}
        wireInputs={[
          wireInput({
            ioKey: "23::widget::upload",
            name: "upload",
            label: "选择文件上传",
            type: "IMAGEUPLOAD",
            control: "image",
            kind: "widget",
          }),
        ]}
      />,
    );
    expect(screen.getByText("IMAGEUPLOAD")).toBeInTheDocument();
  });

  it("同时有 wire 输入与 outputs 且 showOutputs 时渲染两者间的分隔线", () => {
    const { container } = render(
      <IoEndpointsSection
        inputs={[wireInput({ ioKey: "a", name: "model" })]}
        outputs={[output({ ioKey: "o1", name: "IMAGE_FINAL" })]}
        showOutputs
        wireInputs={[wireInput({ ioKey: "a", name: "model" })]}
      />,
    );
    expect(headerCount()).toBe("2");
    // 分隔线是 h-px + border-t 的独立元素(「输出端点」行的虚线没有 h-px)
    expect(container.querySelectorAll("div.h-px.border-t")).toHaveLength(1);
    expect(screen.getByText("输出端点")).toBeInTheDocument();
  });
});
