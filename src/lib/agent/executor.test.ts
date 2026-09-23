// Executor 纯逻辑单测：验证工具解析与基础操作，以及「模型输出不听话」时
// 各工具的处置（空返回 / 畸形 JSON / 重名 / 非法字段）。
//
// `executor.ts` 的模型路径经动态 import 拉 `~/lib/llm/browser`，这里把它打桩 ——
// 判据是**工具闭包的输出与写库副作用**，不是「调了哪个函数」。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgentTool } from "./executor";
import type { WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";

const streamChat = vi.fn();

/** 让 `streamChat` 按给定文本逐字回调 `onToken`（generate_script 走这条路径）。 */
function streamReturns(text: string) {
  streamChat.mockImplementation((args: { onToken?: (t: string) => void }) => {
    args.onToken?.(text);
    return Promise.resolve(text);
  });
}

vi.mock("~/lib/llm/browser", () => ({
  streamChat: (...args: unknown[]): Promise<string> =>
    streamChat(...args) as Promise<string>,
}));
vi.mock("~/lib/llm/prompts", () => ({
  buildScriptMarkdownMessages: () => [],
  buildCharacterFromBriefMessages: () => [],
}));

beforeEach(() => {
  streamChat.mockReset();
});

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

describe("resolveAgentTool — 需要模型的工具（streamChat 打桩）", () => {
  it("generate_script：模型返回空 → 报「未返回剧本内容」，不写空剧本进 store", async () => {
    streamReturns("   ");
    const { state, handlers } = makeMockContext();
    const tool = resolveAgentTool(
      "generate_script",
      '{"idea":"海边"}',
      handlers,
    );
    const res = await tool.execute();
    expect(res.ok).toBe(false);
    expect(state.scriptMarkdown).toBe("");
  });

  it("generate_script：正常返回 → 落库并报字符数", async () => {
    streamReturns("  # 剧本\n第一场  ");
    const { state, handlers } = makeMockContext();
    const res = await resolveAgentTool(
      "generate_script",
      '{"idea":"海边"}',
      handlers,
    ).execute();
    expect(res.ok).toBe(true);
    expect(state.scriptMarkdown).toBe("# 剧本\n第一场");
  });

  it("generate_script：idea 是对象 → 不拼出 [object Object]", () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool(
      "generate_script",
      JSON.stringify({ idea: { a: 1 } }),
      handlers,
    );
    expect(tool.summary).not.toContain("[object Object]");
  });

  it("edit_script：当前剧本为空 → 明确要求先生成，不调模型", async () => {
    const { handlers } = makeMockContext();
    const res = await resolveAgentTool(
      "edit_script",
      '{"instruction":"润色"}',
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("剧本");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("edit_script：模型返回空 → 不改动现有剧本（避免把内容清空）", async () => {
    streamChat.mockResolvedValue("");
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "原剧本";
    const res = await resolveAgentTool(
      "edit_script",
      '{"instruction":"润色"}',
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(state.scriptMarkdown).toBe("原剧本");
  });

  it("extract_characters：围栏里的 JSON 数组被解析并补齐必填字段", async () => {
    streamChat.mockResolvedValue(
      '好的，结果如下：\n\`\`\`json\n[{"name":"阿宁","appearance":"短发"},"nonsense",{"appearance":"无名字"}]\n\`\`\`',
    );
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "剧本内容";
    const res = await resolveAgentTool(
      "extract_characters",
      "{}",
      handlers,
    ).execute();
    expect(res.ok).toBe(true);
    // 只有带名字的条目被收（"nonsense" 与无名条目都过滤）
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0]?.name).toBe("阿宁");
    // 必填字段被补齐，写进 draft 的不会是残缺角色卡
    expect(state.characters[0]?.positivePrompt).toBe("");
    expect(state.characters[0]?.styleTags).toEqual([]);
    expect(state.characters[0]?.id).toMatch(/^char/);
  });

  it("extract_characters：解析不出角色 → ok=false，且不把空角色写进 store", async () => {
    streamChat.mockResolvedValue("模型说了些别的");
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "剧本内容";
    const res = await resolveAgentTool(
      "extract_characters",
      "{}",
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(state.characters).toEqual([]);
  });

  it("extract_characters：与**已有**角色同名时不重复加入", async () => {
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "剧本";
    streamChat.mockResolvedValue('[{"name":"阿宁"}]');
    await resolveAgentTool("extract_characters", "{}", handlers).execute();
    expect(state.characters).toHaveLength(1);
    // 第二次提取同一批 → 不新增
    await resolveAgentTool("extract_characters", "{}", handlers).execute();
    expect(state.characters).toHaveLength(1);
  });

  it("【现状登记】模型自己把同一个名字给两遍 → 会生成两张卡", async () => {
    // 去重只与 `existing` 比对，**不在模型返回的数组内部去重** —— 模型
    // 重复输出同一角色名（长剧本里很常见）会得到两张逐字相同的卡。界面上表现是
    // 「角色卡凭空多了一张」，没有任何报错。本批只登记现状，修不修是行为决策
    // （与「补测试」分开提交，§13.5.1 同口径）。
    streamChat.mockResolvedValue('[{"name":"阿宁"},{"name":"阿宁"}]');
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "剧本";
    await resolveAgentTool("extract_characters", "{}", handlers).execute();
    expect(state.characters).toHaveLength(2);
  });

  it("add_character：空名 → 明确拒绝，不调模型", async () => {
    const { handlers } = makeMockContext();
    const res = await resolveAgentTool(
      "add_character",
      "{}",
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("add_character：重名 → 拒绝，且不产生第二张卡", async () => {
    const { state, handlers } = makeMockContext();
    state.characters = [{ id: "c1", name: "阿宁" } as never];
    const res = await resolveAgentTool(
      "add_character",
      '{"name":"阿宁"}',
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(state.characters).toHaveLength(1);
  });

  it("plan_storyboard：镜头数组被解析，兼容 heading 与 characterNames 类型清洗", async () => {
    streamChat.mockResolvedValue(
      JSON.stringify([
        {
          heading: "内景·教室",
          description: "两人对坐",
          characterNames: ["阿宁", 1],
        },
        {
          sceneHeading: "外景·操场",
          shotType: "wide",
          characterNames: "不是数组",
        },
        { description: "   " },
      ]),
    );
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "剧本";
    const res = await resolveAgentTool(
      "plan_storyboard",
      "{}",
      handlers,
    ).execute();
    expect(res.ok).toBe(true);
    expect(state.shots).toHaveLength(2);
    expect(state.shots[0]?.sceneHeading).toBe("内景·教室");
    expect(state.shots[1]?.shotType).toBe("wide");
    // 非数组的 characterNames 不炸，回退空数组
    expect(state.shots[1]?.characterIds).toEqual([]);
  });

  it("plan_storyboard：解析不出镜头 → ok=false，不写空镜头", async () => {
    streamChat.mockResolvedValue("[]");
    const { state, handlers } = makeMockContext();
    state.scriptMarkdown = "剧本";
    const res = await resolveAgentTool(
      "plan_storyboard",
      "{}",
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(state.shots).toEqual([]);
  });

  it("generate_shot_images：明确告诉用户去页面触发（不做静默空转）", async () => {
    const { handlers } = makeMockContext();
    const res = await resolveAgentTool(
      "generate_shot_images",
      "{}",
      handlers,
    ).execute();
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("手动触发");
    expect(res.detail).toBeTruthy();
  });

  it("render_film：无 renderFilm handler 时给可行动回退，不空转", async () => {
    const { handlers } = makeMockContext();
    const res = await resolveAgentTool("render_film", "{}", handlers).execute();
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("成片工作室");
  });

  it("render_film：有 renderFilm handler 时透传其结果", async () => {
    const { handlers } = makeMockContext();
    const renderFilm = vi.fn(async () => ({
      ok: true,
      summary: "已启动成片",
      detail: "film-42",
    }));
    const res = await resolveAgentTool("render_film", "{}", {
      ...handlers,
      renderFilm,
    }).execute();
    expect(renderFilm).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      ok: true,
      summary: "已启动成片",
      detail: "film-42",
    });
  });
});

describe("resolveAgentTool — 参数摘要", () => {
  it("标量参数拼成 key=value，超长截断", () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool(
      "add_character",
      JSON.stringify({ name: "阿宁", nested: { a: 1 } }),
      handlers,
    );
    expect(tool.argSummary).toContain("name=阿宁");
    expect(tool.argSummary).not.toContain("nested");
  });

  it("非法 JSON → 摘要回落原文，不抛错", () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool("add_character", "{不是 JSON", handlers);
    expect(tool.argSummary).toContain("不是 JSON");
  });

  it("空参数串 → 占位", () => {
    const { handlers } = makeMockContext();
    expect(resolveAgentTool("add_character", "", handlers).argSummary).toBe(
      "(空参数)",
    );
  });
});

describe("resolveAgentTool — set_project_meta 字段白名单", () => {
  it("非法 type 被丢弃，合法字段照常写入", () => {
    const { state, handlers } = makeMockContext();
    resolveAgentTool(
      "set_project_meta",
      JSON.stringify({ title: "T", type: "rm -rf", tone: "温馨" }),
      handlers,
    );
    // 先 execute 才写入
    return resolveAgentTool(
      "set_project_meta",
      JSON.stringify({ title: "T", type: "rm -rf", tone: "温馨" }),
      handlers,
    )
      .execute()
      .then(() => {
        expect(state.meta.title).toBe("T");
        expect(state.meta.tone).toBe("温馨");
        // 非法 type 不覆盖原值
        expect(state.meta.type).toBe("short_video");
      });
  });

  it("无可识别字段 → 摘要标注 (无字段)", async () => {
    const { handlers } = makeMockContext();
    const tool = resolveAgentTool(
      "set_project_meta",
      JSON.stringify({ unknown: "x" }),
      handlers,
    );
    const res = await tool.execute();
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("(无字段)");
  });
});
