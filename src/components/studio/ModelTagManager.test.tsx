"use client";

/* 模型标签库弹窗（ISSUE #4102）：按「配置了几个模式」计数（不再显示几个工作流），
 * 每个模式一枚胶囊，悬停显示占用它的工作流名与本地/在线来源。 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModelTagManager } from "./ModelTagManager";
import type { TagItem } from "./hooks/use-model-tags";
import { TooltipProvider } from "~/components/ui/tooltip";

afterEach(cleanup);

const tags: Array<TagItem> = [
  {
    id: "tag-1",
    name: "z-image",
    count: 2,
    modeBindings: [
      { mode: "T2I", workflowName: "image_z_image_int8_t2i", local: true },
      { mode: "I2I", workflowName: "image_z_image_int8_t2i", local: true },
      { mode: "T2V", workflowName: "image_wan_online", local: false },
    ],
  },
  { id: "tag-2", name: "未用标签", count: 0, modeBindings: [] },
];

function renderManager() {
  return render(
    <TooltipProvider delay={0}>
      <ModelTagManager initialTags={tags} onChanged={() => undefined} onClose={() => undefined} />
    </TooltipProvider>,
  );
}

describe("ModelTagManager（标签库按模式计数，ISSUE #4102）", () => {
  it("每个标签显示「N 个模式」与逐模式胶囊；不再显示「N 个工作流」", () => {
    renderManager();
    expect(screen.getByText("3 个模式")).toBeTruthy();
    /* 旧徽标「N 个工作流」不再出现（说明段落里的「工作流」字样不算）。 */
    expect(screen.queryByText(/^\d+ 个工作流$/)).toBeNull();
    /* 模式胶囊用中文标签（T2I → 文生图 …），同一工作流占两个模式就出两枚。 */
    expect(screen.getByText("文生图")).toBeTruthy();
    expect(screen.getByText("图生图")).toBeTruthy();
    expect(screen.getByText("文生视频")).toBeTruthy();
    /* 没有绑定的标签如实显示「未绑定」，不冒充 0 个模式以外的状态。 */
    expect(screen.getByText("未绑定")).toBeTruthy();
  });

  it("悬停模式胶囊：显示占用它的工作流名与本地/在线来源", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.hover(screen.getByText("文生视频"));
    expect(await screen.findByText("「image_wan_online」· 在线工作流")).toBeTruthy();
    await user.hover(screen.getByText("文生图"));
    expect(await screen.findByText("「image_z_image_int8_t2i」· 本地工作流")).toBeTruthy();
  });
});
