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
import { fetchProduction, pushProduction } from "~/lib/production/production-client";
import type { Shot } from "~/lib/workshop/types";
import { recordCanvasShotGeneration, requestShotRedo } from "./shot-writeback";

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
    characterIds: [],
    description: "",
    id: "a",
    index: 1,
    negativePrompt: "n",
    params: {},
    prompt: "p",
    sceneHeading: "",
    sceneId: "s1",
    shotType: "medium",
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
      imageUrl: "/x.png",
      status: "done",
      taskId: "t9",
    });
    const back = readWorkshopDraft("proj_1");
    expect(back.shots[0]).toMatchObject({
      id: "a",
      imageUrl: "/x.png",
      status: "done",
      taskId: "t9",
    });
    expect(pushDraftMock).toHaveBeenCalledTimes(1);
    // production 镜像无该行 → 不推
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("production 命中镜头 → 读改写并保留 progress", async () => {
    fetchProdMock.mockResolvedValue({
      characters: [],
      logline: "L",
      progress: { rendered: false, stage: "shots" },
      scenes: [],
      scriptMarkdown: "#",
      shots: [shotA()],
      title: "T",
      tone: "轻",
      type: "drama",
    });
    await recordCanvasShotGeneration("proj_1", "a", {
      imageUrl: "/y.png",
      status: "done",
    });
    expect(pushProdMock).toHaveBeenCalledTimes(1);
    const [projectId, payload] = pushProdMock.mock.calls[0]!;
    expect(projectId).toBe("proj_1");
    expect(payload.progress).toEqual({ rendered: false, stage: "shots" });
    expect(payload.shots).toEqual([
      expect.objectContaining({ id: "a", imageUrl: "/y.png", status: "done" }),
    ]);
  });

  it("两侧都没有该镜头 → 不落任何写", async () => {
    fetchProdMock.mockResolvedValue({
      characters: [],
      logline: "",
      progress: { rendered: false, stage: "script" },
      scenes: [],
      scriptMarkdown: "",
      shots: [shotA({ id: "other" })],
      title: "T",
      tone: "",
      type: "",
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
        imageUrl: "/z.png",
        status: "done",
      }),
    ).resolves.toBeUndefined();
    expect(readWorkshopDraft("proj_1").shots[0]).toMatchObject({
      imageUrl: "/z.png",
      status: "done",
    });
    expect(pushProdMock).not.toHaveBeenCalled();
  });
});

describe("requestShotRedo", () => {
  function seedDraftWithDoneShotA() {
    writeWorkshopDraft("proj_1", {
      ...emptyWorkshopDraft(),
      // rev 不在 Shot 类型上，作为未知扩展字段写入（草稿 JSON 列宽容）。
      shots: [
        /* SAFETY: 类型断言已复核 */ {
          ...shotA(),
          clipUrl: "/y.mp4",
          imageUrl: "/x.png",
          rev: 0,
          status: "done",
        } as never,
      ],
    });
  }

  it("空 projectId / 空 shotId → 短路，不发 IO", async () => {
    await requestShotRedo("", "a");
    await requestShotRedo("proj_1", "");
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(pushDraftMock).not.toHaveBeenCalled();
  });

  it("命中镜头：草稿与 production 都清产出 + 状态 idle + rev 自增", async () => {
    seedDraftWithDoneShotA();
    fetchProdMock.mockResolvedValue({
      characters: [],
      logline: "",
      progress: { rendered: false, stage: "render" },
      scenes: [],
      scriptMarkdown: "",
      shots: [
        {
          clipUrl: "/y.mp4",
          id: "a",
          imageUrl: "/x.png",
          rev: 0,
          status: "done",
        },
      ],
      title: "T",
      tone: "",
      type: "",
    });

    await requestShotRedo("proj_1", "a");

    const drafted = /* SAFETY: 类型断言已复核 */ readWorkshopDraft("proj_1")
      .shots[0] as unknown as Record<string, unknown>;
    expect(drafted).toMatchObject({ rev: 1, status: "idle" });
    expect(drafted.imageUrl).toBeUndefined();
    expect(pushDraftMock).toHaveBeenCalledTimes(1);

    expect(pushProdMock).toHaveBeenCalledTimes(1);
    const [, payload] = pushProdMock.mock.calls[0]!;
    const pushed = /* SAFETY: 类型断言已复核 */ (
      payload.shots as Array<Record<string, unknown>>
    )[0]!;
    expect(pushed).toMatchObject({
      clipStatus: "idle",
      rev: 1,
      status: "idle",
    });
    expect(pushed.imageUrl).toBeUndefined();
    // 非镜头字段保留
    expect(payload.progress).toEqual({ rendered: false, stage: "render" });
  });

  it("两侧都没有该镜头 → 不落任何写", async () => {
    writeWorkshopDraft("proj_1", {
      ...emptyWorkshopDraft(),
      shots: [{ ...shotA(), id: "other" }],
    });
    fetchProdMock.mockResolvedValue({
      characters: [],
      logline: "",
      progress: { rendered: false, stage: "script" },
      scenes: [],
      scriptMarkdown: "",
      shots: [{ id: "other" }],
      title: "T",
      tone: "",
      type: "",
    });
    await requestShotRedo("proj_1", "a");
    expect(pushDraftMock).not.toHaveBeenCalled();
    expect(pushProdMock).not.toHaveBeenCalled();
  });
});
