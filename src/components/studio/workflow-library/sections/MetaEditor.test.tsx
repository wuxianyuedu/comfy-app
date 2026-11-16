"use client";

/* 模型标签绑定弹窗（ISSUE #4102）：单选语义 + 唯一性冲突就地展示。
 * controller 是纯桩 —— 本组件是视图层（规范 17 §17.2 第③层），写操作全部上抛。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ModelTagPicker } from "./MetaEditor";
import type { MetaEditorController } from "../hooks/use-workflow-library-detail";
import type { ModelTagSummary } from "~/lib/workflow/workflow-list-types";

afterEach(cleanup);

function metaStub(over: Partial<MetaEditorController> = {}): MetaEditorController {
  const tags: Array<ModelTagSummary> = [
    { id: "t1", name: "z-image", count: 1, modeBindings: [] },
    { id: "t2", name: "wan2.2", count: 0, modeBindings: [] },
  ];
  return {
    modes: ["T2I"],
    defaultMode: "T2I",
    modelTags: [],
    allModelTags: tags,
    busy: false,
    patchModes: () => Promise.resolve(),
    patchModelTags: () => Promise.resolve(null),
    patchSeedMode: () => Promise.resolve(),
    patchParamMap: () => Promise.resolve(),
    ...over,
  };
}

function openPicker(meta: MetaEditorController) {
  render(<ModelTagPicker meta={meta} />);
  /* 触发按钮的可见文案 = 当前绑定（空 = 「选择模型」）。 */
  fireEvent.click(screen.getByText("选择模型"));
}

describe("ModelTagPicker（绑定模型标签，ISSUE #4102）", () => {
  it("单选：后点的标签顶替先点的，保存只提交一个", async () => {
    const patchModelTags = vi.fn(() => Promise.resolve(null));
    openPicker(metaStub({ patchModelTags }));
    fireEvent.click(screen.getByText("z-image"));
    fireEvent.click(screen.getByText("wan2.2"));
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => {
      expect(patchModelTags).toHaveBeenCalledTimes(1);
    });
    expect(patchModelTags).toHaveBeenCalledWith(["wan2.2"]);
  });

  it("再点一次已选中的 = 取消绑定，保存提交空数组", async () => {
    const patchModelTags = vi.fn(() => Promise.resolve(null));
    openPicker(metaStub({ patchModelTags }));
    fireEvent.click(screen.getByText("z-image"));
    fireEvent.click(screen.getByText("z-image"));
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => {
      expect(patchModelTags).toHaveBeenCalledTimes(1);
    });
    expect(patchModelTags).toHaveBeenCalledWith([]);
  });

  it("唯一性冲突：失败文案就地展示，弹窗保持打开让用户改选", async () => {
    const conflict =
      "模型标签「z-image」的「文生图」模式已被工作流「image_z_image_int8_t2i」占用 —— 同一模型的同一模式只能由一条工作流绑定";
    const patchModelTags = vi.fn(() => Promise.resolve(conflict));
    openPicker(metaStub({ patchModelTags }));
    fireEvent.click(screen.getByText("z-image"));
    fireEvent.click(screen.getByText("保存"));
    /* 失败文案出现在弹窗里（不是只进全局错误条）。 */
    expect(await screen.findByText(conflict)).toBeTruthy();
    /* 弹窗仍开着（取消按钮还在），用户可以改选别的标签。 */
    expect(screen.getByText("取消")).toBeTruthy();
    expect(patchModelTags).toHaveBeenCalledTimes(1);
  });

  it("保存成功后关闭弹窗", async () => {
    const patchModelTags = vi.fn(() => Promise.resolve(null));
    openPicker(metaStub({ patchModelTags }));
    fireEvent.click(screen.getByText("z-image"));
    fireEvent.click(screen.getByText("保存"));
    await vi.waitFor(() => {
      expect(patchModelTags).toHaveBeenCalledTimes(1);
    });
    /* 成功后弹窗收起：找不到「保存」按钮。 */
    await vi.waitFor(() => {
      expect(screen.queryByText("保存")).toBeNull();
    });
  });
});
