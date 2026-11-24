"use client";

/* 模型标签库弹窗（ISSUE #4102）：按「配置了几个模式」计数（不再显示几个工作流），
 * 每个模式一枚胶囊，悬停显示占用它的工作流名与本地/在线来源。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModelTagManager } from "./ModelTagManager";
import type { TagItem } from "./hooks/use-model-tags";
import { TooltipProvider } from "~/components/ui/tooltip";

/* 改名请求打桩：本文件只判「可见铅笔按钮 → 编辑态 → Enter 提交」的 UI 路径，
 * 请求层由 use-model-tags.test.ts / workflow-model.test.ts 覆盖。 */
const renameTag = vi.fn(() => Promise.resolve(true));
vi.mock("./hooks/use-model-tags", () => ({
  useModelTags: ({ initialTags }: { initialTags: Array<TagItem> }) => ({
    tags: initialTags,
    errors: new Map(),
    renameTag,
    deleteTag: vi.fn(),
    addTag: vi.fn(),
    busy: false,
    draft: "",
    setDraft: vi.fn(),
    pendingDelete: null,
    cancelDeleteTag: vi.fn(),
    confirmDeleteTag: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  renameTag.mockClear();
});

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
    expect(screen.getByText("图像编辑")).toBeTruthy();
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

describe("ModelTagManager — 可见重命名入口（#4986）", () => {
  it("每个标签有可见的重命名按钮（无需悬浮即可发现）", () => {
    renderManager();
    expect(screen.getByRole("button", { name: "重命名 z-image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重命名 未用标签" })).toBeTruthy();
  });

  it("点重命名按钮 → 出现输入框 → 输入新名 Enter → renameTag(old,new)", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole("button", { name: "重命名 z-image" }));
    const input = screen.getByDisplayValue("z-image");
    await user.clear(input);
    await user.type(input, "z-image-turbo{Enter}");
    expect(renameTag).toHaveBeenCalledTimes(1);
    expect(renameTag).toHaveBeenCalledWith("z-image", "z-image-turbo");
  });

  it("编辑态下不再渲染重命名按钮（名称区换成输入框，无从重复进入）", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole("button", { name: "重命名 z-image" }));
    expect(screen.getByDisplayValue("z-image")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重命名 z-image" })).toBeNull();
  });
});
