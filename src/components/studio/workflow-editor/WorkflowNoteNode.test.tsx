import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { TooltipProvider } from "~/components/ui/tooltip";

import { WorkflowNoteNode } from "./WorkflowEditorNodes";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

function renderNote() {
  return render(
    <TooltipProvider delay={0}>
      <WorkflowNoteNode data={{ color: "#f2b705", text: "# 标题\n正文", title: "备忘" }} />
    </TooltipProvider>,
  );
}

describe("WorkflowNoteNode（#4548）", () => {
  it("便签正文滚动条走 custom-scrollbar 档，弱底上看得见", () => {
    /* 便签正文此前落到全局兜底滚动条（thumb = `--color-border`），在便签自己的
     * 浅底上几乎不可见。custom-scrollbar 档的 thumb 取强边框色、hover 再深一档。 */
    const { container } = renderNote();
    const body = container.querySelector(".wf-markdown");
    expect(body, "便签 markdown 主体应该渲染").not.toBeNull();
    expect(body?.className).toContain("custom-scrollbar");
    expect(body?.className).toContain("overflow-auto");
  });
});

describe("WorkflowNoteNode 长文本滚轮（#4859）", () => {
  /** 把正文伪造成「可滚 / 不可滚」：滚轮拦截的判据是
   *  `scrollHeight > clientHeight`（真实布局读数在单测里不可靠，直接钉这两个值）。 */
  function stageScrollability(body: HTMLDivElement, scrollable: boolean) {
    Object.defineProperty(body, "scrollHeight", {
      value: scrollable ? 500 : 200,
      configurable: true,
    });
    Object.defineProperty(body, "clientHeight", { value: 200, configurable: true });
  }

  function dispatchWheel(body: HTMLDivElement): Array<string> {
    /* 在便签外框（正文的父级，画布面板的更内层）监听冒泡：
     *  拦截生效 = 冒泡到不了这里（画布的缩放监听同样收不到）。 */
    const bubbled: Array<string> = [];
    const parent = body.parentElement;
    if (parent === null) {
      throw new Error("便签正文没有父级");
    }
    const spy = (event: Event) => {
      bubbled.push(event.type);
    };
    parent.addEventListener("wheel", spy);
    body.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }));
    parent.removeEventListener("wheel", spy);
    return bubbled;
  }

  it("正文超长（可滚）：滚轮归正文，冒泡被拦 —— 画布缩放不抢滚动", () => {
    const { container } = renderNote();
    const body = container.querySelector(".wf-markdown");
    if (!(body instanceof HTMLDivElement)) {
      throw new Error("便签 markdown 主体应该渲染");
    }
    stageScrollability(body, true);

    expect(dispatchWheel(body)).toEqual([]);
  });

  it("正文没溢出：滚轮放行给画布缩放（不拦冒泡）", () => {
    const { container } = renderNote();
    const body = container.querySelector(".wf-markdown");
    if (!(body instanceof HTMLDivElement)) {
      throw new Error("便签 markdown 主体应该渲染");
    }
    stageScrollability(body, false);

    expect(dispatchWheel(body)).toEqual(["wheel"]);
  });
});
