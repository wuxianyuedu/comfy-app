// @vitest-environment jsdom
/* 工坊封装页签「流程测试」表单 —— 输入口 = 该模式的**全部**契约口
 *
 * 这里锁的是一条用户口径（ISSUE #720 后续）：**测试表单直接摆出工坊实际可编辑
 * 的全部参数，不看工作流有没有连线**。此前的实现在视图里按 `targetIoKey` 过滤
 * 且只硬编码提示词 / 负向 / 尺寸三格，于是：
 *   · 负向提示词在上一行写着名字、下面却没有输入框（名字暴露了却填不了）；
 *   · 图生视频这类模式尺寸口没落点，连尺寸都选不了。
 * 表单与上方「工坊对外口一览」现在读的是同一份 `entries`，逐口渲染。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { EncapsulationEntryStatus } from "~/lib/workshop/workshop-encapsulation-status";
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";
import { EncapsulationTestForm } from "./EncapsulationTestForm";

afterEach(cleanup);

/** 契约口（含落点信息；`targetIoKey: null` = 没连到工作流）。 */
function entry(
  over: Partial<EncapsulationEntryStatus> & { id: string },
): EncapsulationEntryStatus {
  return {
    label: over.id,
    control: "text",
    targetIoKey: null,
    required: false,
    ...over,
  };
}

/** 文生图契约口：提示词已落点，负向 / 尺寸都没落点。 */
const T2I_ENTRIES: EncapsulationEntryStatus[] = [
  entry({
    id: "prompt",
    label: "提示词",
    targetIoKey: "76::widget::text",
    required: true,
  }),
  entry({ id: "negative", label: "负向提示词" }),
  entry({ id: "size", label: "尺寸", control: "size" }),
];

/** 图生视频契约口：多出首帧与时长。 */
const I2V_ENTRIES: EncapsulationEntryStatus[] = [
  entry({
    id: "prompt",
    label: "提示词",
    targetIoKey: "76::widget::text",
    required: true,
  }),
  entry({ id: "first-frame", label: "首帧", control: "image" }),
  entry({ id: "size", label: "尺寸", control: "size" }),
  entry({ id: "duration", label: "时长", control: "duration" }),
];

function renderForm(
  entries: EncapsulationEntryStatus[],
  over: Partial<React.ComponentProps<typeof EncapsulationTestForm>> = {},
) {
  const onRun = vi.fn<(values: WorkshopExposedValues) => void>();
  const utils = render(
    <EncapsulationTestForm
      entries={entries}
      scene={over.scene ?? "image"}
      running={false}
      canRun
      onRun={onRun}
      uploadImage={vi.fn().mockResolvedValue("uploaded.png")}
      {...over}
    />,
  );
  return { onRun, ...utils };
}

describe("EncapsulationTestForm", () => {
  it("没落点的口照样渲染输入框（负向提示词不再是「看得见填不了」）", () => {
    renderForm(T2I_ENTRIES);
    const negative = screen.getByPlaceholderText("输入负向提示词");
    expect(negative).toBeTruthy();
    /* 没连到工作流的口给一句说明，但**不禁用**：值仍可填。 */
    expect(screen.getByText("未连到端口，用工作流默认值")).toBeTruthy();
    expect((negative as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("视频模式的尺寸口没落点也渲染尺寸控件（不再连尺寸都选不了）", () => {
    renderForm(I2V_ENTRIES, { scene: "video" });
    expect(screen.getByLabelText("选择生图比例与像素")).toBeTruthy();
  });

  it("图片口（首帧 / 参考图）渲染「选择图片」与当前文件名", () => {
    renderForm(I2V_ENTRIES, { scene: "video" });
    expect(screen.getByRole("button", { name: "选择图片" })).toBeTruthy();
  });

  it("时长口渲染秒数步进器（默认 5 秒）", () => {
    renderForm(I2V_ENTRIES, { scene: "video" });
    expect(screen.getByText("秒")).toBeTruthy();
    expect(screen.getByTitle("增加 1")).toBeTruthy();
  });

  it("提交：没碰过的口（空串）被剪掉，尺寸 / 时长按当前控件值带上", () => {
    const { onRun } = renderForm(I2V_ENTRIES, { scene: "video" });
    fireEvent.click(screen.getByRole("button", { name: "执行流程测试" }));
    const payload = onRun.mock.calls[0]?.[0];
    expect(payload?.prompt).toBe("一只戴宇航员头盔的柴犬，写实风格，高清");
    /* 没填的负向 / 首帧不出现 —— 空串会把图内作者写好的值抹成空。 */
    expect(payload?.negativePrompt).toBeUndefined();
    expect(payload?.firstFrame).toBeUndefined();
    expect(payload?.size).toMatchObject({ ratio: "3:4", clarity: "1k" });
    expect(payload?.duration).toBe(5);
  });

  it("填过的文本口按契约口落进对外值（negative → negativePrompt）", () => {
    const { onRun } = renderForm(T2I_ENTRIES);
    fireEvent.change(screen.getByPlaceholderText("输入负向提示词"), {
      target: { value: "lowres" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行流程测试" }));
    expect(onRun.mock.calls[0]?.[0].negativePrompt).toBe("lowres");
  });

  it("未就绪（canRun=false）时禁用输入与执行按钮，并把原因挂上", () => {
    renderForm(T2I_ENTRIES, {
      canRun: false,
      runDisabledReason: "提示词未落到端口",
    });
    const button = screen.getByRole("button", { name: "执行流程测试" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBe("提示词未落到端口");
    expect(screen.getByPlaceholderText("输入负向提示词")).toBeDisabled();
  });

  it("图片口选完立刻本地预览（上传失败 / ComfyUI 未启动也看得见所选图）", async () => {
    renderForm(I2V_ENTRIES, {
      scene: "video",
      uploadImage: vi.fn(async () => {
        throw new Error("ComfyUI 未启动");
      }),
    });
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], "f.png", {
      type: "image/png",
    });
    fireEvent.change(input!, { target: { files: [file] } });
    const img = await screen.findByRole("img", { name: "首帧" });
    expect(img.getAttribute("src") ?? "").toMatch(/^data:image\/png/);
  });
});
