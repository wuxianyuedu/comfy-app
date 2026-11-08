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
import { fireAndForget } from "~/lib/async-action";
import { isRecord } from "~/lib/is-record";
import {
  fetchProduction,
  pushProduction,
  type ProductionData,
} from "~/lib/production/production-client";
import type { Shot } from "~/lib/workshop/types";
import { recordCanvasShotGeneration, requestShotRedo } from "./shot-writeback";

vi.mock("~/lib/production/production-client", () => ({
  fetchProduction: vi.fn(),
  pushProduction: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("~/lib/workshop/draft-sync-client", () => ({
  pushServerDraft: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("~/lib/async-action", () => ({
  /* 现场真实现（`task.catch(onError)`）+ 记账，两件事一处分清：
     用例要的是「onError 被交给谁、它跑起来会不会抛」，不是「fireAndForget 自己怎么实现的」。 */
  fireAndForget: vi.fn((task: Promise<unknown>, onError: (e: unknown) => void) => {
    void task.catch(onError);
  }),
}));

const fetchProdMock = vi.mocked(fetchProduction);
const pushProdMock = vi.mocked(pushProduction);
const pushDraftMock = vi.mocked(pushServerDraft);
/* 两处 `fireAndForget(…, () => {…})` 的静默回调是「失败路径的唯一出口」，
   把它们抓下来逐条断言：草稿已落本地缓存（用户的那一改没丢），镜像留给下次自动保存。 */
const fireAndForgetMock = vi.mocked(fireAndForget);

/** 按对象读数组第 `index` 项；不是对象即判失败（调用用例对此有前提）。 */
function recordAt(items: Array<unknown>, index: number): Record<string, unknown> {
  const item = items[index];
  if (!isRecord(item)) {
    throw new TypeError(`第 ${index} 项不是对象`);
  }
  return item;
}

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

  it("草稿镜像推送失败 → 静默兜底：本地草稿照样是新的", async () => {
    /* `fireAndForget(pushServerDraft(…), () => {})` 的静默回调 —— 失败路径的唯一出口。
       这里两件事一起判：① 唯一的兜底句真被执行（拒了的 promise 不许没人接）；
       ② 用户那一改没有因为镜像失败而丢（本地缓存才是即时的那一份）。 */
    pushDraftMock.mockRejectedValueOnce(new Error("镜像不可用"));
    seedDraftWithShotA();
    fetchProdMock.mockResolvedValue(null);

    await recordCanvasShotGeneration("proj_1", "a", { status: "done", imageUrl: "/x.png" });

    expect(fireAndForgetMock).toHaveBeenCalledTimes(1);
    expect(pushDraftMock).toHaveBeenCalledTimes(1);
    expect(readWorkshopDraft("proj_1").shots[0]).toMatchObject({
      status: "done",
      imageUrl: "/x.png",
    });
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

describe("requestShotRedo", () => {
  function seedDraftWithDoneShotA() {
    writeWorkshopDraft("proj_1", {
      ...emptyWorkshopDraft(),
      // rev 不在 Shot 类型上，作为未知扩展字段写入（草稿 JSON 列宽容）。
      shots: [
        Object.assign(shotA(), {
          imageUrl: "/x.png",
          clipUrl: "/y.mp4",
          status: "done",
          rev: 0,
        }),
      ],
    });
  }

  it("production 侧读不到（服务不可用 → null）→ 只落草稿，不推 production", async () => {
    /* 静默降级那一支：`fetchProduction` 在不可用 / 无记录时回 null，
       此时草稿已写好、production 镜像留给工坊下次自动保存补推。 */
    seedDraftWithDoneShotA();
    fetchProdMock.mockResolvedValue(null);

    await requestShotRedo("proj_1", "a");

    expect(pushDraftMock).toHaveBeenCalledTimes(1);
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("退回路径的草稿镜像推送失败 → 静默兜底（那条 fireAndForget 的第二处调用点）", async () => {
    pushDraftMock.mockRejectedValueOnce(new Error("镜像不可用"));
    seedDraftWithDoneShotA();
    fetchProdMock.mockResolvedValue(null);

    await requestShotRedo("proj_1", "a");

    expect(fireAndForgetMock).toHaveBeenCalledTimes(1);
    const drafted = recordAt(readWorkshopDraft("proj_1").shots, 0);
    expect(drafted).toMatchObject({ status: "idle", rev: 1 });
  });

  it("production 侧没有该镜头 → 不改写镜像（`patched === prodShots`）", async () => {
    /* 另一支静默出口：production 里根本没有这个镜头 ⇒ 不该凭空塞一条进去
       （那会在别人的画布上多出一张空镜）。 */
    seedDraftWithDoneShotA();
    fetchProdMock.mockResolvedValue({
      title: "T",
      type: "",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [],
      progress: { stage: "render", rendered: false },
    });

    await requestShotRedo("proj_1", "a");

    expect(pushDraftMock).toHaveBeenCalledTimes(1);
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("production 的 shots 不是数组（列被写脏）→ 按空处理，不改写镜像", async () => {
    /* `Array.isArray(prod.shots) ? … : []` 的右半边：服务端 JSON 列没有形状约束
       （route 原样透传），一行坏数据不该让整条退回链路抛错，也不该把别的镜头冲掉。 */
    seedDraftWithDoneShotA();
    const malformed: ProductionData = {
      title: "T",
      type: "",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [],
      progress: { stage: "render", rendered: false },
    };
    fetchProdMock.mockResolvedValue(Object.assign(malformed, { shots: "not-an-array" }));

    await requestShotRedo("proj_1", "a");

    expect(pushDraftMock).toHaveBeenCalledTimes(1);
    expect(pushProdMock).not.toHaveBeenCalled();
  });

  it("空 projectId / 空 shotId → 短路，不发 IO", async () => {
    await requestShotRedo("", "a");
    await requestShotRedo("proj_1", "");
    expect(fetchProdMock).not.toHaveBeenCalled();
    expect(pushDraftMock).not.toHaveBeenCalled();
  });

  it("命中镜头：草稿与 production 都清产出 + 状态 idle + rev 自增", async () => {
    seedDraftWithDoneShotA();
    fetchProdMock.mockResolvedValue({
      title: "T",
      type: "",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [
        {
          id: "a",
          imageUrl: "/x.png",
          clipUrl: "/y.mp4",
          status: "done",
          rev: 0,
        },
      ],
      progress: { stage: "render", rendered: false },
    });

    await requestShotRedo("proj_1", "a");

    const drafted = recordAt(readWorkshopDraft("proj_1").shots, 0);
    expect(drafted).toMatchObject({ status: "idle", rev: 1 });
    expect(drafted.imageUrl).toBeUndefined();
    expect(pushDraftMock).toHaveBeenCalledTimes(1);

    expect(pushProdMock).toHaveBeenCalledTimes(1);
    const [, payload] = pushProdMock.mock.calls[0]!;
    const pushed = recordAt(payload.shots, 0);
    expect(pushed).toMatchObject({
      status: "idle",
      clipStatus: "idle",
      rev: 1,
    });
    expect(pushed.imageUrl).toBeUndefined();
    // 非镜头字段保留
    expect(payload.progress).toEqual({ stage: "render", rendered: false });
  });

  it("两侧都没有该镜头 → 不落任何写", async () => {
    writeWorkshopDraft("proj_1", {
      ...emptyWorkshopDraft(),
      shots: [{ ...shotA(), id: "other" }],
    });
    fetchProdMock.mockResolvedValue({
      title: "T",
      type: "",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [{ id: "other" }],
      progress: { stage: "script", rendered: false },
    });
    await requestShotRedo("proj_1", "a");
    expect(pushDraftMock).not.toHaveBeenCalled();
    expect(pushProdMock).not.toHaveBeenCalled();
  });
});
