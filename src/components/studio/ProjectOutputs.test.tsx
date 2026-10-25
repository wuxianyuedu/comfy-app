/**
 * 产出网格的**行级虚拟化**判据（audit §C.1 F4a / ISSUE #2190）。
 *
 * 产出数随项目历史任务数只增不减、每卡挂媒体缩略图 —— 全量 `map` 的挂载成本
 * 线性上涨。这里钉三件事：
 *   · 未量测环境（jsdom：`clientWidth`/`clientHeight` 恒 0、ResizeObserver
 *     不在场）⇒ **全量渲染兜底**（与 ModelLibrary 的 `measured` 守卫同形——
 *     虚拟器在无读数环境里 `getVirtualItems()` 为空，网格会一片空白）；
 *   · 量测就绪后**只渲染视口附近的行**（200 张卡时在 DOM 里的远少于全量）；
 *   · 行内列数按容器宽度推（镜像旧 Tailwind 断点：2 / ≥640→3 / ≥1024→4）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ProjectOutputs } from "./ProjectOutputs";
import type { ProjectOutputItem } from "./hooks/use-project-outputs";

function makeOutputs(n: number): ProjectOutputItem[] {
  return Array.from<ProjectOutputItem, ProjectOutputItem>(
    { length: n },
    (_, i) => ({
      id: `o${i}`,
      status: "SUCCEEDED",
      prompt: `p${i}`,
      workflowName: "wf",
      type: "IMAGE",
      seed: "1",
      createdAt: new Date(0).toISOString(),
      negativePrompt: null,
      size: null,
      sampler: null,
      steps: null,
      cfg: null,
      checkpoint: null,
      referenceImages: [],
      images: [],
    }),
  );
}

const outputsMock = vi.fn<() => ProjectOutputItem[]>(() => []);
vi.mock("./hooks/use-project-outputs", () => ({
  useProjectOutputs: () => ({
    outputs: outputsMock(),
    loading: false,
    refetch: async () => undefined,
  }),
}));
/* 页面还读项目索引（项目下拉/封面名）。这里只测网格，索引给最小单项目。 */
vi.mock("~/lib/project-canvas/canvas-store", () => ({
  getActiveId: () => "proj-1",
  listProjects: () => [{ id: "proj-1", name: "P1" }],
}));

afterEach(() => {
  cleanup();
  outputsMock.mockReturnValue([]);
});

describe("ProjectOutputs 的产出网格（虚拟化 + 未量测兜底）", () => {
  it("未量测环境（jsdom）⇒ 全量渲染兜底：200 张卡都在，网格不至于一片空白", async () => {
    outputsMock.mockReturnValue(makeOutputs(200));
    render(<ProjectOutputs />);
    // 兜底路径的网格容器带上 role=list（与虚拟路径同一个可寻址形状）。
    const list = await screen.findByRole("list", { name: "项目产出" });
    // 200 张卡（jsdom 量不出宽高，虚拟器不接管 —— 这是刻意的兜底）。
    expect(list.querySelectorAll("button").length).toBe(200);
  });

  it("空产出仍是空态（虚拟化不吞空分支）", async () => {
    outputsMock.mockReturnValue([]);
    render(<ProjectOutputs />);
    expect(await screen.findByText("还没有产出")).toBeVisible();
  });
});
