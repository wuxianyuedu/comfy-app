// renderProjectFilm 的契约（Phase 5 agent 能力层）：前置校验 + create→start 编排。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { vanillaApi } from "~/trpc/vanilla";
import { renderProjectFilm } from "./render-film-client";

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    film: {
      createFromProject: { mutate: vi.fn() },
      start: { mutate: vi.fn() },
    },
  },
}));

const createMock = vi.mocked(vanillaApi.film.createFromProject.mutate);
const startMock = vi.mocked(vanillaApi.film.start.mutate);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderProjectFilm", () => {
  it("无活跃项目 → 短路，不发请求", async () => {
    const r = await renderProjectFilm({
      projectId: null,
      videoWorkflowId: "wf",
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/没有活跃项目/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("未选视频工作流 → 短路，提示先选工作流", async () => {
    const r = await renderProjectFilm({ projectId: "proj_1" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/视频工作流/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("有镜头 → createFromProject → start，回传成片 id", async () => {
    createMock.mockResolvedValue({ id: "film-9", shots: 3 });
    startMock.mockResolvedValue({ ok: true });
    const r = await renderProjectFilm({
      projectId: "proj_1",
      videoWorkflowId: "wf-video",
      imageWorkflowId: "wf-image",
    });
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("film-9");
    expect(createMock).toHaveBeenCalledWith({
      projectId: "proj_1",
      videoWorkflowId: "wf-video",
      imageWorkflowId: "wf-image",
    });
    expect(startMock).toHaveBeenCalledWith({ id: "film-9" });
  });

  it("未给图类工作流 → 不带 imageWorkflowId 字段", async () => {
    createMock.mockResolvedValue({ id: "film-10", shots: 2 });
    startMock.mockResolvedValue({ ok: true });
    await renderProjectFilm({
      projectId: "proj_1",
      videoWorkflowId: "wf-video",
    });
    expect(createMock).toHaveBeenCalledWith({
      projectId: "proj_1",
      videoWorkflowId: "wf-video",
    });
  });

  it("服务端报错（如无镜头）→ 回传失败 + 原因", async () => {
    createMock.mockRejectedValue(
      new Error("该项目还没有镜头，请先在工坊产出镜头再成片"),
    );
    const r = await renderProjectFilm({
      projectId: "proj_1",
      videoWorkflowId: "wf-video",
    });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/启动成片失败/);
    expect(r.detail).toMatch(/还没有镜头/);
    expect(startMock).not.toHaveBeenCalled();
  });
});
