// @vitest-environment happy-dom
// ── useImageRedraw 的动作逻辑（依赖全注入，可脱离网络单测）──────
// 验收主轴（FR-QA-09）：放大 = 原图进参考图槽 + parentId 指回原任务；
// 局部重绘 = 原图 + 蒙版两槽；护栏（没选模板 / 重绘没蒙版）给可行动错误不提交。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  useImageRedraw,
  type ImageRedrawController,
  type ImageRedrawDeps,
} from "./use-image-redraw";

function makeDeps(over: Partial<ImageRedrawDeps> = {}): ImageRedrawDeps {
  return {
    listTemplates: vi.fn(async () => [
      { id: "wf-up", name: "放大", taskType: "UPSCALE" },
      { id: "wf-in", name: "重绘", taskType: "INPAINT" },
    ]),
    prepareImage: vi.fn(async (image: string) => `up-${image}`),
    submit: vi.fn(async () => "task-new"),
    report: vi.fn(),
    ...over,
  };
}

/** 渲染一次、每次都读最新 result.current（useCallback 的身份随状态变，别抓旧闭包）。 */
function setup(over?: { deps?: Partial<ImageRedrawDeps> }) {
  const deps = makeDeps(over?.deps);
  const hook = renderHook(() =>
    useImageRedraw(deps, {
      prompt: "原提示词",
      projectId: "proj-1",
      parentId: "task-old",
    }),
  );
  const current = (): ImageRedrawController => hook.result.current;
  return { deps, current };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useImageRedraw", () => {
  it("模板清单拉一次并默认选中第一个", async () => {
    const { deps, current } = setup();
    await act(async () => {
      await current().ensureTemplates();
    });
    expect(deps.listTemplates).toHaveBeenCalledTimes(1);
    expect(current().templates.length).toBe(2);
    expect(current().selectedTemplateId).toBe("wf-up");

    // 二次调用不再拉（面板反复展开不重复请求）。
    await act(async () => {
      await current().ensureTemplates();
    });
    expect(deps.listTemplates).toHaveBeenCalledTimes(1);
  });

  it("放大：原图进参考图槽，parentId / projectId 随载荷，成功带新任务号", async () => {
    const { deps, current } = setup();
    await act(async () => {
      await current().ensureTemplates();
    });
    act(() => {
      current().setPrompt(" 放大提示词 ");
    });
    await act(async () => {
      await current().run("/generated/t/1.png");
    });
    expect(deps.prepareImage).toHaveBeenCalledWith("/generated/t/1.png");
    expect(deps.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: "wf-up",
        prompt: "放大提示词",
        referenceImages: ["up-/generated/t/1.png"],
        projectId: "proj-1",
        parentId: "task-old",
      }),
    );
    expect(current().resultTaskId).toBe("task-new");
    expect(deps.report).toHaveBeenCalledWith("ok", expect.stringContaining("task-new"));
  });

  it("局部重绘：原图 + 蒙版两槽；没画蒙版先拦下（不提交）", async () => {
    const { deps, current } = setup();
    await act(async () => {
      await current().ensureTemplates();
    });
    act(() => {
      current().setMode("inpaint");
    });
    await act(async () => {
      await current().run("/generated/t/1.png");
    });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledWith("err", expect.stringContaining("蒙版"));

    act(() => {
      current().setMask("data:image/png;base64,AAAA");
    });
    await act(async () => {
      await current().run("/generated/t/1.png");
    });
    expect(deps.prepareImage).toHaveBeenCalledWith("data:image/png;base64,AAAA");
    expect(deps.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: ["up-/generated/t/1.png", "up-data:image/png;base64,AAAA"],
      }),
    );
  });

  it("没选模板先拦下；提交失败走失败通道（不冒充成功）", async () => {
    const deps = makeDeps({
      submit: vi.fn(async () => {
        throw new Error("工作流不存在");
      }),
    });
    const { current } = setup({ deps });
    await act(async () => {
      await current().run("/generated/t/1.png");
    });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledWith("err", expect.stringContaining("模板"));

    await act(async () => {
      await current().ensureTemplates();
    });
    await act(async () => {
      await current().run("/generated/t/1.png");
    });
    expect(deps.report).toHaveBeenCalledWith("err", "工作流不存在");
    expect(current().resultTaskId).toBeNull();
  });
});
