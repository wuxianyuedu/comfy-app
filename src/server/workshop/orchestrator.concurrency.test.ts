// ── orchestrator 有序性 / 并发回归（ISSUE #3891 #3895 #3902 #3908）──
// 与 orchestrator.test.ts 的差别：这里的 repository mock 按**快照**读写
// （structuredClone），忠实模拟「每次读库拿到独立副本、写库整包落盘」的
// 真实语义 —— 只有这样「load → 外部调用 → updateState」的旧快照覆盖才
// 会在测试里显形；再配会话锁（sessionMutationMutex）验证修复后的串行化。
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LLMMessage } from "~/lib/llm/types";
import type { WorkshopSessionState } from "./types";
import type { WorkshopLLMConfig } from "./llm";
import { advancePipelineStage, isProjectType } from "~/lib/workshop/types";
import { asRecord } from "~/lib/is-record";
import type { CreateSessionInput } from "./repository";

const { store, calls, delays, flags, imgUrls } = vi.hoisted(() => ({
  store: new Map<string, WorkshopSessionState>(),
  calls: { createSession: 0, submitVideo: 0 },
  delays: { read: 4, write: 4, create: 0 },
  flags: { failNextCreate: false },
  imgUrls: [] as Array<string>,
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

vi.mock("./repository", () => {
  const makeState = (input: CreateSessionInput = {}): WorkshopSessionState => ({
    idea: input.idea ?? "",
    meta: {
      title: input.title ?? "未命名工坊项目",
      type: isProjectType(input.type) ? input.type : "short_video",
      tone: input.tone ?? "",
      logline: input.logline ?? "",
      scriptMarkdown: "",
    },
    scenes: [],
    characters: [],
    shots: [],
    stage: "script",
    projectId: null,
  });
  return {
    createSession: vi.fn((input: CreateSessionInput = {}) => {
      calls.createSession += 1;
      if (flags.failNextCreate) {
        flags.failNextCreate = false;
        return Promise.reject(new Error("建库失败（注入）"));
      }
      return sleep(delays.create).then(() => {
        const id = `sess_${calls.createSession}_${Math.random().toString(36).slice(2)}`;
        store.set(id, makeState(input));
        return id;
      });
    }),
    getSession: vi.fn((id: string) =>
      sleep(delays.read).then(() => {
        const row = store.get(id);
        return row ? structuredClone(row) : null;
      }),
    ),
    updateState: vi.fn((id: string, state: WorkshopSessionState) =>
      sleep(delays.write).then(() => {
        store.set(id, structuredClone(state));
      }),
    ),
    listSessions: vi.fn(() => []),
    deleteSession: vi.fn((id: string) => {
      const had = store.has(id);
      store.delete(id);
      return Promise.resolve(had);
    }),
  };
});

vi.mock("./llm", () => ({
  getWorkshopLLMConfig: vi.fn((): Promise<WorkshopLLMConfig> =>
    Promise.resolve({
      baseUrl: "http://x",
      model: "m",
      apiKey: null,
      temperature: 0.7,
      maxTokens: 100,
    }),
  ),
  completeWorkshopLLM: vi.fn(
    (_cfg: WorkshopLLMConfig, messages: Array<LLMMessage>): Promise<string> => {
      const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
      if (sys.includes("编剧")) {
        return Promise.resolve("# 场景1 · 咖啡馆\nΔ 小满走进咖啡馆。\nV1 小满：今天天气真好。");
      }
      if (sys.includes("剧本分析师")) {
        return Promise.resolve(
          JSON.stringify([
            {
              name: "小满",
              ageGender: "女,20岁",
              appearance: "短发",
              costume: "红裙",
              personality: "活泼",
              styleTags: ["厚涂"],
            },
          ]),
        );
      }
      if (sys.includes("分镜师")) {
        return Promise.resolve(
          JSON.stringify([
            {
              sceneHeading: "场景1 · 咖啡馆",
              shotType: "wide",
              description: "全景",
              characterNames: ["小满"],
              dialogue: "",
            },
            {
              sceneHeading: "场景1 · 咖啡馆",
              shotType: "close",
              description: "特写",
              characterNames: ["小满"],
              dialogue: "今天天气真好。",
            },
          ]),
        );
      }
      return Promise.resolve("");
    },
  ),
}));

vi.mock("./api-channel", () => ({
  generateImageViaApi: vi.fn(() =>
    sleep(6).then(() => imgUrls.shift() ?? "http://img/default.png"),
  ),
  submitVideoViaApi: vi.fn(() => {
    calls.submitVideo += 1;
    return sleep(6).then(() => ({ remoteTaskId: `task${calls.submitVideo}` }));
  }),
  pollVideoViaApi: vi.fn(() => Promise.resolve({ url: "http://vid/1.mp4", pending: false })),
  resolveMediaDataUrl: vi.fn((ref: string) => ref),
}));

vi.mock("./comfyui", () => ({
  generateImageViaComfyUI: vi.fn(() => Promise.resolve("file://comfy/1.png")),
  submitVideoViaComfyUI: vi.fn(() => Promise.resolve({ url: "file://comfy/v.mp4" })),
  saveComfySettings: vi.fn((p: unknown) => p),
  resolveComfyBase: vi.fn(() => "http://127.0.0.1:8188"),
}));

vi.mock("./final-compose", () => ({
  buildCompositionPlan: vi.fn((title: string, shots: Array<{ id: string }>) => ({
    project: title,
    exportedAt: "",
    totalShots: shots.length,
    totalDurationSec: 0,
    segments: [],
  })),
  writeCompositionPlan: vi.fn(() => Promise.resolve("/data/workshop-compositions/x.json")),
  renderComposition: vi.fn(() => Promise.resolve({ ok: false, note: "no ffmpeg" })),
}));

import * as orchestrator from "./orchestrator";

/** 走完整管线到一个「有分镜」的会话（镜头数来自分镜师 mock 的两条）。 */
async function setupSessionWithShots(idea: string): Promise<string> {
  const id = await orchestrator.createSession({ idea });
  await orchestrator.setIdea(id, idea);
  await orchestrator.generateScript(id);
  await orchestrator.extractCharacters(id);
  await orchestrator.buildStoryboard(id);
  return id;
}

describe("workshop orchestrator 有序性 / 并发回归", () => {
  beforeEach(() => {
    store.clear();
    calls.createSession = 0;
    calls.submitVideo = 0;
    delays.read = 4;
    delays.write = 4;
    delays.create = 0;
    flags.failNextCreate = false;
    imgUrls.length = 0;
  });

  it("#3891 并发给两个镜头生图：会话锁串行化后两份产物都在（后写者不再抹掉先写者）", async () => {
    const id = await setupSessionWithShots("race-two-shots");
    const state = store.get(id);
    expect(state?.shots.length).toBe(2);
    const shotA = state!.shots[0]!.id;
    const shotB = state!.shots[1]!.id;
    imgUrls.push("http://img/a.png", "http://img/b.png");

    const [ra, rb] = await Promise.all([
      orchestrator.generateImage(id, { shotId: shotA }),
      orchestrator.generateImage(id, { shotId: shotB }),
    ]);
    expect(ra.url).toBe("http://img/a.png");
    expect(rb.url).toBe("http://img/b.png");

    const after = store.get(id)!;
    expect(after.shots.find((s) => s.id === shotA)?.imageUrl).toBe("http://img/a.png");
    expect(after.shots.find((s) => s.id === shotB)?.imageUrl).toBe("http://img/b.png");
  });

  it("#3895 并发同参 submitVideo：幂等闸在会话锁内重读，外部计费提交只发生一次", async () => {
    const id = await setupSessionWithShots("race-submit-video");
    const shotId = store.get(id)!.shots[0]!.id;

    const [first, second] = await Promise.all([
      orchestrator.submitVideo(id, { shotId }),
      orchestrator.submitVideo(id, { shotId }),
    ]);

    expect(calls.submitVideo).toBe(1);
    expect(asRecord(first)?.remoteTaskId).toBe("task1");
    expect(asRecord(second)?.skipped).toBe(true);
    expect(asRecord(second)?.url).toBe("task:task1");
  });

  it("#3902 stage 只进不退：final_edit 之后补调 setScript 不把游标拉回去", async () => {
    const id = await setupSessionWithShots("stage-monotonic");
    expect(store.get(id)?.stage).toBe("storyboard");

    await orchestrator.setScript(id, "# 场景1 · 新剧本\nΔ 重写。");
    expect(store.get(id)?.stage).toBe("storyboard");

    await orchestrator.composeFinal(id, {});
    expect(store.get(id)?.stage).toBe("final_edit");

    await orchestrator.setScript(id, "# 场景1 · 再重写\nΔ 再来。");
    expect(store.get(id)?.stage).toBe("final_edit");
  });

  it("advancePipelineStage：取更靠后的那一格", () => {
    expect(advancePipelineStage("script", "storyboard")).toBe("storyboard");
    expect(advancePipelineStage("final_edit", "script")).toBe("final_edit");
    expect(advancePipelineStage("character", "character")).toBe("character");
  });

  it("#3908 并发同参 createSession：先占位后创建，只建一套三件套", async () => {
    delays.create = 15;
    const [a, b] = await Promise.all([
      orchestrator.createSession({ idea: "dup-concurrent" }),
      orchestrator.createSession({ idea: "dup-concurrent" }),
    ]);
    expect(a).toBe(b);
    expect(calls.createSession).toBe(1);
    expect(store.size).toBe(1);
  });

  it("#3908 创建失败撤掉占位：TTL 窗口内的下一次调用重新创建", async () => {
    flags.failNextCreate = true;
    await expect(orchestrator.createSession({ idea: "fail-then-ok" })).rejects.toThrow("建库失败");
    const id = await orchestrator.createSession({ idea: "fail-then-ok" });
    expect(store.has(id)).toBe(true);
    expect(calls.createSession).toBe(2);
  });

  it("#3852 顺序重试仍走去重：命中返回同一会话；会话已消失则重建", async () => {
    const first = await orchestrator.createSession({ idea: "seq-dedup" });
    const again = await orchestrator.createSession({ idea: "seq-dedup" });
    expect(again).toBe(first);
    expect(calls.createSession).toBe(1);

    await orchestrator.deleteSession(first);
    const rebuilt = await orchestrator.createSession({ idea: "seq-dedup" });
    expect(rebuilt).not.toBe(first);
    expect(calls.createSession).toBe(2);
  });
});
