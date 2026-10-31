// ── orchestrator 全流程编排单测（mock 掉 DB / LLM / API 通道）──
// 验证「脚本 → 角色 → 分镜 → 生图 → 生视频」五阶段串联逻辑，以及
// 提示词重算纯函数。覆盖规范 §11 要求的纯函数 + 逻辑测试。
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LLMMessage } from "~/lib/llm/types";
import type { WorkshopSessionState } from "./types";
import type { WorkshopLLMConfig } from "./llm";
import type { Character, Shot } from "~/lib/workshop/types";
import type { CreateSessionInput } from "./repository";

const { store } = vi.hoisted(() => ({
  store: new Map<string, WorkshopSessionState>(),
}));

vi.mock("./repository", () => {
  const createSession = vi.fn(async (input: CreateSessionInput = {}) => {
    const id = "sess_" + Math.random().toString(36).slice(2);
    const state: WorkshopSessionState = {
      characters: [],
      idea: input.idea ?? "",
      meta: {
        logline: input.logline ?? "",
        scriptMarkdown: "",
        title: input.title ?? "未命名工坊项目",
        tone: input.tone ?? "",
        type: /* SAFETY: 类型断言已复核 */ (input.type ??
          "short_video") as WorkshopSessionState["meta"]["type"],
      },
      projectId: null,
      scenes: [],
      shots: [],
      stage: "script",
    };
    store.set(id, state);
    return id;
  });
  const getSession = vi.fn(async (id: string) => store.get(id) ?? null);
  const updateState = vi.fn(async (id: string, state: WorkshopSessionState) => {
    store.set(id, state);
  });
  const listSessions = vi.fn(async () => []);
  const deleteSession = vi.fn(async (id: string) => {
    const had = store.has(id);
    store.delete(id);
    return had;
  });
  return {
    createSession,
    deleteSession,
    getSession,
    listSessions,
    updateState,
  };
});

vi.mock("./llm", () => ({
  completeWorkshopLLM: vi.fn(
    async (_cfg: WorkshopLLMConfig, messages: Array<LLMMessage>): Promise<string> => {
      const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
      if (sys.includes("编剧")) {
        return "# 场景1 · 咖啡馆\nΔ 小满走进咖啡馆。\nV1 小满：今天天气真好。";
      }
      if (sys.includes("剧本分析师")) {
        return JSON.stringify([
          {
            ageGender: "女,20岁",
            appearance: "短发",
            costume: "红裙",
            name: "小满",
            personality: "活泼",
            styleTags: ["厚涂"],
          },
        ]);
      }
      if (sys.includes("分镜师")) {
        return JSON.stringify([
          {
            characterNames: ["小满"],
            description: "全景",
            dialogue: "",
            sceneHeading: "场景1 · 咖啡馆",
            shotType: "wide",
          },
        ]);
      }
      return "";
    },
  ),
  getWorkshopLLMConfig: vi.fn(async (): Promise<WorkshopLLMConfig> => ({
    apiKey: null,
    baseUrl: "http://x",
    maxTokens: 100,
    model: "m",
    temperature: 0.7,
  })),
}));

vi.mock("./api-channel", () => ({
  generateImageViaApi: vi.fn(async () => "http://img/1.png"),
  pollVideoViaApi: vi.fn(async () => ({
    pending: false,
    url: "http://vid/1.mp4",
  })),
  resolveMediaDataUrl: vi.fn(async (ref: string) => ref),
  submitVideoViaApi: vi.fn(async () => ({ remoteTaskId: "task123" })),
}));

vi.mock("./comfyui", () => ({
  generateImageViaComfyUI: vi.fn(async () => "file://comfy/1.png"),
  resolveComfyBase: vi.fn(async () => "http://127.0.0.1:8188"),
  saveComfySettings: vi.fn(async (p: unknown) => p),
  submitVideoViaComfyUI: vi.fn(async () => ({ url: "file://comfy/v.mp4" })),
}));

vi.mock("./final-compose", () => ({
  buildCompositionPlan: vi.fn((title: string, shots: Array<Shot>) => ({
    exportedAt: "",
    project: title,
    segments: shots.map((s, i) => ({
      clipUrl: s.clipUrl ?? null,
      dialogue: s.dialogue ?? "",
      durationSec: 4,
      imageUrl: s.imageUrl ?? null,
      motion: s.motion ?? "medium",
      order: i + 1,
      prompt: s.prompt,
      scene: s.sceneHeading,
      shotId: s.id,
      shotType: s.shotType,
      transition: s.transition ?? "cut",
    })),
    totalDurationSec: 0,
    totalShots: shots.length,
  })),
  renderComposition: vi.fn(async () => ({ note: "no ffmpeg", ok: false })),
  writeCompositionPlan: vi.fn(async () => "/data/workshop-compositions/x.json"),
}));

import * as orchestrator from "./orchestrator";

describe("workshop orchestrator 全流程", () => {
  beforeEach(() => store.clear());

  it("脚本 → 角色 → 分镜 → 生图 → 生视频 串联", async () => {
    const id = await orchestrator.createSession({ idea: "一个女孩在咖啡馆" });
    await orchestrator.setIdea(id, "一个女孩在咖啡馆");

    const script = await orchestrator.generateScript(id);
    expect(script.script).toContain("场景");
    expect(script.sceneCount).toBeGreaterThan(0);

    const chars = await orchestrator.extractCharacters(id);
    expect(chars.total).toBeGreaterThan(0);
    expect(chars.characters[0]?.positivePrompt.length ?? 0).toBeGreaterThan(0);

    const board = await orchestrator.buildStoryboard(id);
    expect(board.shotCount).toBeGreaterThan(0);
    const shot: Shot = board.shots[0]!;
    expect(shot.prompt.length).toBeGreaterThan(0);
    expect(shot.sceneId).toBeTruthy();

    const img = await orchestrator.generateImage(id, { shotId: shot.id });
    expect(img.url).toBe("http://img/1.png");

    const after = await orchestrator.getSession(id);
    expect(after?.shots[0]?.imageUrl).toBe("http://img/1.png");

    const sub = await orchestrator.submitVideo(id, { shotId: shot.id });
    expect(/* SAFETY: 类型断言已复核 */ (sub as { remoteTaskId?: string }).remoteTaskId).toBe(
      "task123",
    );

    const polled = await orchestrator.pollVideo(id, shot.id);
    expect(polled.url).toBe("http://vid/1.mp4");
  });

  it("rebuildCharacterPrompts 重算提示词含角色名", () => {
    const out = orchestrator.rebuildCharacterPrompts([
      {
        ageGender: "女",
        appearance: "短发",
        costume: "",
        id: "c1",
        name: "小满",
        negativePrompt: "",
        params: {},
        personality: "活泼",
        positivePrompt: "",
        styleTags: [],
        temperament: "",
      } satisfies Character,
    ]);
    expect(out[0]?.positivePrompt).toContain("活泼");
    expect(out[0]?.negativePrompt.length ?? 0).toBeGreaterThan(0);
  });

  it("generateImage comfyui 通道写入 imageUrl", async () => {
    const id = await orchestrator.createSession({ idea: "x" });
    await orchestrator.setIdea(id, "x");
    await orchestrator.generateScript(id);
    await orchestrator.extractCharacters(id);
    const board = await orchestrator.buildStoryboard(id);
    const shot = board.shots[0]!;
    const r = await orchestrator.generateImage(id, {
      channel: "comfyui",
      shotId: shot.id,
    });
    expect(r.url).toBe("file://comfy/1.png");
    const after = await orchestrator.getSession(id);
    expect(after?.shots[0]?.imageUrl).toBe("file://comfy/1.png");
  });

  it("submitVideo comfyui 通道写入 clipUrl", async () => {
    const id = await orchestrator.createSession({ idea: "x" });
    await orchestrator.setIdea(id, "x");
    await orchestrator.generateScript(id);
    await orchestrator.extractCharacters(id);
    const board = await orchestrator.buildStoryboard(id);
    const shot = board.shots[0]!;
    await orchestrator.generateImage(id, { shotId: shot.id }); // api 通道填 imageUrl
    const r = await orchestrator.submitVideo(id, {
      channel: "comfyui",
      shotId: shot.id,
      useFirstFrame: true,
    });
    expect(r.url).toBe("file://comfy/v.mp4");
    const after = await orchestrator.getSession(id);
    expect(after?.shots[0]?.clipUrl).toBe("file://comfy/v.mp4");
  });

  it("composeFinal 产出合成清单路径", async () => {
    const id = await orchestrator.createSession({ idea: "x" });
    await orchestrator.setIdea(id, "x");
    await orchestrator.generateScript(id);
    await orchestrator.extractCharacters(id);
    await orchestrator.buildStoryboard(id);
    const r = await orchestrator.composeFinal(id, { render: true });
    expect(r.planPath).toBe("/data/workshop-compositions/x.json");
    expect(r.renderNote).toBe("no ffmpeg");
  });
});
