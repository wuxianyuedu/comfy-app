// @vitest-environment jsdom
// 画布镜头生成态回写客户端的契约（Phase 3c-2b）。
// 两处落点各自验证：共享工坊草稿（localStorage + workshopDraft 表镜像）与
// production 表镜像（读-改-写、保留 progress）。网络用 mock，草稿走真存储层。
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyWorkshopDraft,
  readWorkshopDraft,
  writeWorkshopDraft,
} from "~/lib/workshop/draft-store";
import { pushServerDraft } from "~/lib/workshop/draft-sync-client";
import {
  fetchProduction,
  pushProduction,
} from "~/lib/production/production-client";
import type { Shot } from "~/lib/workshop/types";
import { recordCanvasShotGeneration } from "./shot-writeback";

vi.mock("~/lib/production/production-client", () => ({
  fetchProduction: vi.fn(),
  pushProduction: vi.fn(async () => undefined),
}));
vi.mock("~/lib/workshop/draft-sync-client", () => ({
  pushServerDraft: vi.fn(async () => undefined),
}));

const fetchProdMock = vi.mocked(fetchProduction);
const pushProdMock = vi.mocked(pushProduction);
const pushDraftMock = vi.mocked(pushServerDraft);

function shotA(over: Partial<Shot> = {}): Shot {
  return {
    id: "a",
    index: 1,
    sceneId: "s1",
    sceneHeading: "",
    shotType: "medium",
    description: "",
    characterIds: [],
    prompt: "p",
    negativePrompt: "n",
    params: {},
    status: "idle",
    ...over,
  };
}

function seedDraftWithShotA() {
  writeWorkshopDraft("proj_1", { ...emptyWorkshopDraft(), shots: [shotA()] });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("recordCanvasShotGeneration", () => {
  it("空 projectId / 空 shotId → 直接返回，不发任何 IO", async () => {
    await recordCanvasShotGeneration("", "a", { status: "done" });
    await recordCanvasShotGeneration("proj_1", "", { status: "done" });
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(pushDraftMock).not.toHaveBeenCalled();
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("草稿命中镜头 → 写草稿 + 推 workshopDraft 镜像", async () => {
    seedDraftWithShotA();
    fetchProdMock.mockResolvedValue(null);
    await recordCanvasShotGeneration("proj_1", "a", {
      status: "done",
      taskId: "t9",
      imageUrl: "/x.png",
    });
    const back = readWorkshopDraft("proj_1");
    expect(back.shots[0]).toMatchObject({
      id: "a",
      status: "done",
      taskId: "t9",
      imageUrl: "/x.png",
    });
    expect(pushDraftMock).toHaveBeenCalledTimes(1);
    // production 镜像无该行 → 不推
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("production 命中镜头 → 读改写并保留 progress", async () => {
    fetchProdMock.mockResolvedValue({
      title: "T",
      type: "drama",
      tone: "轻",
      logline: "L",
      scriptMarkdown: "#",
      scenes: [],
      characters: [],
      shots: [shotA()],
      progress: { stage: "shots", rendered: false },
    });
    await recordCanvasShotGeneration("proj_1", "a", {
      status: "done",
      imageUrl: "/y.png",
    });
    expect(pushProdMock).toHaveBeenCalledTimes(1);
    const [projectId, payload] = pushProdMock.mock.calls[0]!;
    expect(projectId).toBe("proj_1");
    expect(payload.progress).toEqual({ stage: "shots", rendered: false });
    expect(payload.shots).toEqual([
      expect.objectContaining({ id: "a", status: "done", imageUrl: "/y.png" }),
    ]);
  });

  it("两侧都没有该镜头 → 不落任何写", async () => {
    fetchProdMock.mockResolvedValue({
      title: "T",
      type: "",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [shotA({ id: "other" })],
      progress: { stage: "script", rendered: false },
    });
    await recordCanvasShotGeneration("proj_1", "a", { status: "done" });
    expect(pushDraftMock).not.toHaveBeenCalled();
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("拉取 production 抛错 → 静默降级，草稿仍已更新", async () => {
    seedDraftWithShotA();
    fetchProdMock.mockRejectedValue(new Error("network down"));
    await expect(
      recordCanvasShotGeneration("proj_1", "a", {
        status: "done",
        imageUrl: "/z.png",
      }),
    ).resolves.toBeUndefined();
    expect(readWorkshopDraft("proj_1").shots[0]).toMatchObject({
      status: "done",
      imageUrl: "/z.png",
    });
    expect(pushProdMock).not.toHaveBeenCalled();
  });
});
