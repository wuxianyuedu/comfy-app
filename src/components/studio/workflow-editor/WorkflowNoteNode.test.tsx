import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { TooltipProvider } from "~/components/ui/tooltip";

import { WorkflowNoteNode } from "./WorkflowEditorNodes";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

describe("WorkflowNoteNode（#4548）", () => {
  it("便签正文滚动条走 custom-scrollbar 档，弱底上看得见", () => {
    /* 便签正文此前落到全局兜底滚动条（thumb = `--color-border`），在便签自己的
     * 浅底上几乎不可见。custom-scrollbar 档的 thumb 取强边框色、hover 再深一档。 */
    const { container } = render(
      <TooltipProvider delay={0}>
        <WorkflowNoteNode data={{ color: "#f2b705", text: "# 标题\n正文", title: "备忘" }} />
      </TooltipProvider>,
    );
    const body = container.querySelector(".wf-markdown");
    expect(body, "便签 markdown 主体应该渲染").not.toBeNull();
    expect(body?.className).toContain("custom-scrollbar");
    expect(body?.className).toContain("overflow-auto");
  });
});
