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
      idea: input.idea ?? "",
      meta: {
        title: input.title ?? "未命名工坊项目",
        type: (input.type ??
          "short_video") as WorkshopSessionState["meta"]["type"],
        tone: input.tone ?? "",
        logline: input.logline ?? "",
        scriptMarkdown: "",
      },
      scenes: [],
      characters: [],
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
    getSession,
    updateState,
    listSessions,
    deleteSession,
  };
});

vi.mock("./llm", () => ({
  getWorkshopLLMConfig: vi.fn(async (): Promise<WorkshopLLMConfig> => ({
    baseUrl: "http://x",
    model: "m",
    apiKey: null,
    temperature: 0.7,
    maxTokens: 100,
  })),
  completeWorkshopLLM: vi.fn(
    async (
      _cfg: WorkshopLLMConfig,
      messages: LLMMessage[],
    ): Promise<string> => {
      const sys = messages[0]?.content ?? "";
      if (sys.includes("编剧")) {
        return "# 场景1 · 咖啡馆\nΔ 小满走进咖啡馆。\nV1 小满：今天天气真好。";
      }
      if (sys.includes("剧本分析师")) {
        return JSON.stringify([
          {
            name: "小满",
            ageGender: "女,20岁",
            appearance: "短发",
            costume: "红裙",
            personality: "活泼",
            styleTags: ["厚涂"],
          },
        ]);
      }
      if (sys.includes("分镜师")) {
        return JSON.stringify([
          {
            sceneHeading: "场景1 · 咖啡馆",
            shotType: "wide",
            description: "全景",
            characterNames: ["小满"],
            dialogue: "",
          },
        ]);
      }
      return "";
    },
  ),
}));

vi.mock("./api-channel", () => ({
  generateImageViaApi: vi.fn(async () => "http://img/1.png"),
  submitVideoViaApi: vi.fn(async () => ({ remoteTaskId: "task123" })),
  pollVideoViaApi: vi.fn(async () => ({
    url: "http://vid/1.mp4",
    pending: false,
  })),
  resolveMediaDataUrl: vi.fn(async (ref: string) => ref),
}));

vi.mock("./comfyui", () => ({
  generateImageViaComfyUI: vi.fn(async () => "file://comfy/1.png"),
  submitVideoViaComfyUI: vi.fn(async () => ({ url: "file://comfy/v.mp4" })),
  saveComfySettings: vi.fn(async (p: unknown) => p),
  resolveComfyBase: vi.fn(async () => "http://127.0.0.1:8188"),
}));

vi.mock("./final-compose", () => ({
  buildCompositionPlan: vi.fn((title: string, shots: Shot[]) => ({
    project: title,
    exportedAt: "",
    totalShots: shots.length,
    totalDurationSec: 0,
    segments: shots.map((s, i) => ({
      order: i + 1,
      shotId: s.id,
      scene: s.sceneHeading,
      shotType: s.shotType,
      prompt: s.prompt,
      imageUrl: s.imageUrl ?? null,
      clipUrl: s.clipUrl ?? null,
      durationSec: 4,
      motion: s.motion ?? "medium",
      transition: s.transition ?? "cut",
      dialogue: s.dialogue ?? "",
    })),
  })),
  writeCompositionPlan: vi.fn(async () => "/data/workshop-compositions/x.json"),
  renderComposition: vi.fn(async () => ({ ok: false, note: "no ffmpeg" })),
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
    expect((sub as { remoteTaskId?: string }).remoteTaskId).toBe("task123");

    const polled = await orchestrator.pollVideo(id, shot.id);
    expect(polled.url).toBe("http://vid/1.mp4");
  });

  it("rebuildCharacterPrompts 重算提示词含角色名", () => {
    const out = orchestrator.rebuildCharacterPrompts([
      {
        id: "c1",
        name: "小满",
        ageGender: "女",
        appearance: "短发",
        costume: "",
        personality: "活泼",
        temperament: "",
        styleTags: [],
        positivePrompt: "",
        negativePrompt: "",
        params: {},
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
      shotId: shot.id,
      channel: "comfyui",
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
      shotId: shot.id,
      channel: "comfyui",
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
