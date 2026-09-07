// Executor 纯逻辑单测：验证工具解析与基础操作。
import { describe, expect, it } from "vitest";
import { resolveAgentTool } from "./executor";
import type { WorkshopDraftDto } from "@/lib/workshop/draft-sync-shared";

/** 内存 mock handlers（避免动态 import 链与真实 LLM 调用）。 */
function makeMockContext() {
  const state: WorkshopDraftDto = {
    meta: {
      title: "测试项目",
      type: "short_video",
      tone: "",
      logline: "",
    },
    scriptMarkdown: "",
    scenes: [],
    characters: [],
    shots: [],
    checkpoint: "",
  };
  const handlers = {
    getDraft: () => state,
    getMeta: () => state.meta,
    setMeta: (patch: Partial<WorkshopDraftDto["meta"]>) => {
      state.meta = { ...state.meta, ...patch };
    },
    setScriptMarkdown: (markdown: string) => {
      state.scriptMarkdown = markdown;
    },
    getScriptMarkdown: () => state.scriptMarkdown,
    getCharacters: () => state.characters,
    setCharacters: (characters: WorkshopDraftDto["characters"]) => {
      state.characters = characters;
    },
    getShots: () => state.shots,
    setShots: (shots: WorkshopDraftDto["shots"]) => {
      state.shots = shots;
    },
  };
  return { state, handlers };
}

describe("resolveAgentTool — get_project_state", () => {
  it("返回项目状态摘要", async () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool("get_project_state", "{}", handlers);
    expect(tool.toolName).toBe("get_project_state");
    const result = await tool.execute();
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("测试项目");
    expect(result.summary).toContain("剧本待生成");
  });
});

describe("resolveAgentTool — set_project_meta", () => {
  it("更新标题与基调", async () => {
    const { state, handlers } = makeMockContext();
    const tool = resolveAgentTool(
      "set_project_meta",
      JSON.stringify({ title: "新标题", tone: "温馨治愈" }),
      handlers,
    );
    const result = await tool.execute();
    expect(result.ok).toBe(true);
    expect(state.meta.title).toBe("新标题");
    expect(state.meta.tone).toBe("温馨治愈");
  });
});

describe("resolveAgentTool — 前置校验", () => {
  it("extract_characters 在无剧本时返回错误", async () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool("extract_characters", "{}", handlers);
    const result = await tool.execute();
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("剧本");
  });

  it("plan_storyboard 在无剧本时返回错误", async () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool("plan_storyboard", "{}", handlers);
    const result = await tool.execute();
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("剧本");
  });

  it("未知工具返回错误", async () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool("unknown_tool", "{}", handlers);
    const result = await tool.execute();
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("未知");
  });
});
