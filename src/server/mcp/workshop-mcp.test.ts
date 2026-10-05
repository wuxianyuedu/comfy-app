// @vitest-environment node
/**
 * 工坊 MCP 服务端的**第一批执行者**（此前 17 条工具零执行者）。
 *
 * 这扇门是给 AI 客户端用的：它能整幅覆盖草稿的角色卡与分镜并落库。
 * 两个此前没有任何东西挡着的洞，本文件各钉一条：
 *   · **入参形状**：`workshop_set_characters` / `workshop_set_storyboard` 的
 *     `characters` / `shots` 原本是 `z.array(z.any())` 再 `as never` 压进
 *     `Character[]` / `Shot[]`。`styleTags` 给成字符串（模型很常见的写法）会
 *     一路走到 `buildCharacterPrompt` 的 `c.styleTags.join()` 才炸 ——
 *     现在由 `~/lib/workshop/types` 的写侧契约在**边界**上归一并拒收脏形状；
 *   · **谁调了哪个出口**：MCP 层的职责就是「把一次工具调用翻译成一次 orchestrator
 *     调用」，而这条翻译关系此前没有任何执行者 —— 改错参数顺序、漏传 sessionId
 *     都不会有数字动。
 *
 * 走真的 `client.callTool`（内存 transport）而不是直接调 handler：
 * SDK 的 **校验发生在 transport 层**，`_registeredTools[x].handler` 拿到什么就传什么
 * （实测把 `{a: ""}` 直接喂给 handler 会原样进 callback）。只有走客户端才是
 * AI 客户端真实经历的那条路 —— 也才判得到「拒收时 orchestrator 一次都没被调用」。
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** orchestrator 的全部出口换成记账用的桩：本文件判的是**翻译**，不是工坊逻辑
 *  （后者另有 `src/server/workshop/orchestrator.test.ts`）。 */
/** 写侧两个出口把收到的实参留一份，断言直接读它 —— 比去索引 `mock.calls[0][1]`
 * （那条类型上是空元组）更好读，也更接近「服务端到底收到了什么」。 */
const seen = vi.hoisted(() => ({
  characters: [] as unknown[],
  shots: [] as unknown[],
}));

const orchestrator = vi.hoisted(() => ({
  createSession: vi.fn(async () => "sess_1"),
  listSessions: vi.fn(async () => [{ id: "sess_1" }]),
  getSession: vi.fn(async () => ({ id: "sess_1", characters: [], shots: [] })),
  deleteSession: vi.fn(async () => true),
  setMeta: vi.fn(async () => ({ ok: true })),
  setIdea: vi.fn(async () => ({ ok: true })),
  generateScript: vi.fn(async () => "# 剧本"),
  setScript: vi.fn(async () => ({ ok: true })),
  extractCharacters: vi.fn(async () => ({ added: 1, skipped: 0, total: 1 })),
  setCharacters: vi.fn(async (_id: string, list: unknown[]) => {
    seen.characters = list;
    return [{ id: "c1" }];
  }),
  buildStoryboard: vi.fn(async () => ({ shotCount: 1 })),
  setStoryboard: vi.fn(async (_id: string, list: unknown[]) => {
    seen.shots = list;
    return [{ id: "s1" }];
  }),
  generateImage: vi.fn(async () => ({ taskId: "t1" })),
  submitVideo: vi.fn(async () => ({ clipTaskId: "ct1" })),
  pollVideo: vi.fn(async () => ({ status: "done" })),
  composeFinal: vi.fn(async () => ({ filmUrl: "/api/generated/f.mp4" })),
  setComfyWorkflow: vi.fn(async () => ({ ok: true })),
}));

/* 桩必须回一个能 `JSON.stringify` 出字符串的值：`json(undefined)` 会让
 * `text: undefined` 进结果信封，SDK 报的是「Invalid tools/call result」，
 * 那是桩的形状问题而不是被测代码的问题。 */
const saveComfySettings = vi.hoisted(() =>
  vi.fn(async () => ({ saved: true })),
);

vi.mock("~/server/workshop/orchestrator", () => orchestrator);
vi.mock("~/server/workshop/comfyui", () => ({ saveComfySettings }));

const SESSION = { sessionId: "sess_1" };

/**
 * 每条工具的最小可用入参。
 *
 * 这张表**同时是判据的一部分**（见下面「17 条都在表里」那条用例）：
 * 新加工具却不写用例 = 红，这正是这一层此前的状态（17 条零执行者）。
 */
const TOOL_CALLS: Record<string, Record<string, unknown>> = {
  workshop_create_session: { title: "测试片", idea: "一只猫" },
  workshop_list_sessions: {},
  workshop_get_session: SESSION,
  workshop_delete_session: SESSION,
  workshop_set_meta: { ...SESSION, title: "改名" },
  workshop_set_idea: { ...SESSION, idea: "新灵感" },
  workshop_generate_script: SESSION,
  workshop_set_script: { ...SESSION, markdown: "# 剧本" },
  workshop_extract_characters: SESSION,
  workshop_set_characters: {
    ...SESSION,
    characters: [{ id: "c1", name: "阿明", styleTags: "皮克斯" }],
  },
  workshop_build_storyboard: SESSION,
  workshop_set_storyboard: {
    ...SESSION,
    shots: [{ id: "s1", index: 0, description: "猫走进雨里" }],
  },
  workshop_generate_image: { ...SESSION, shotId: "s1" },
  workshop_submit_video: { ...SESSION, shotId: "s1" },
  workshop_poll_video: { ...SESSION, shotId: "s1" },
  workshop_compose_final: SESSION,
  workshop_set_comfy_workflow: { checkpoint: "sd_xl.safetensors" },
};

/** 工具名 → 应当被调到的 orchestrator 出口（`compose_final` 之类一对多的按实现取首跳）。 */
const TOOL_TARGETS: Record<string, string> = {
  workshop_create_session: "createSession",
  workshop_list_sessions: "listSessions",
  workshop_get_session: "getSession",
  workshop_delete_session: "deleteSession",
  workshop_set_meta: "setMeta",
  workshop_set_idea: "setIdea",
  workshop_generate_script: "generateScript",
  workshop_set_script: "setScript",
  workshop_extract_characters: "extractCharacters",
  workshop_set_characters: "setCharacters",
  workshop_build_storyboard: "buildStoryboard",
  workshop_set_storyboard: "setStoryboard",
  workshop_generate_image: "generateImage",
  workshop_submit_video: "submitVideo",
  workshop_poll_video: "pollVideo",
  workshop_compose_final: "composeFinal",
  workshop_set_comfy_workflow: "saveComfySettings",
};

async function connect() {
  const { buildWorkshopMcpServer } = await import("./workshop-mcp");
  const server = buildWorkshopMcpServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "gate-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, server };
}

function resetCalls(): void {
  for (const fn of Object.values({ ...orchestrator, saveComfySettings })) {
    fn.mockClear();
  }
}

/** MCP 的失败是**结果**（isError）而不是抛异常，取回文本便于断言与排错。 */
function textOf(result: unknown): string {
  const content = (
    result as { content?: Array<{ type: string; text?: string }> }
  ).content;
  return (content ?? []).map((part) => part.text ?? "").join("\n");
}

describe("工坊 MCP 工具面", () => {
  let client: Client;

  beforeAll(async () => {
    ({ client } = await connect());
  });

  it("注册的 17 条工具与测试表逐字一致（新工具不写用例就红）", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(Object.keys(TOOL_CALLS).sort());
    /* 扫描面非空：表被清空时「两边都空」也长得像「都对上了」。 */
    expect(names.length).toBe(17);
  });

  it.for(Object.keys(TOOL_CALLS))("%s 翻译到对应的服务端出口", async (tool) => {
    resetCalls();
    const result = await client.callTool({
      name: tool,
      arguments: TOOL_CALLS[tool],
    });
    /* 判 `isError` 而不是匹配文案：MCP 的失败就标在信封上，读文案会把
     * 「工具报错」与「用例假设错了」混成一团（这条断言把实际文本带进失败信息）。 */
    expect(result.isError, textOf(result)).toBeFalsy();
    const target = TOOL_TARGETS[tool];
    const fn =
      target === "saveComfySettings"
        ? saveComfySettings
        : orchestrator[target as keyof typeof orchestrator];
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("set_characters 在边界上归一并补齐字段：单字符串标签收成数组、提示词由服务端重算", async () => {
    resetCalls();
    await client.callTool({
      name: "workshop_set_characters",
      arguments: TOOL_CALLS.workshop_set_characters,
    });
    expect(orchestrator.setCharacters).toHaveBeenCalledWith("sess_1", [
      expect.objectContaining({
        id: "c1",
        name: "阿明",
        /* 模型写成 "皮克斯" 也得当成一条标签，而不是走到 prompt-builder 才 TypeError */
        styleTags: ["皮克斯"],
        /* 输入里没有的必填文本被补成空串（下游无条件读取它们），
         * 而提示词是空串占位 —— 服务端 `rebuildCharacterPrompts` 会重算，
         * 外部传什么都不信。 */
        ageGender: "",
        params: {},
        positivePrompt: "",
      }),
    ]);
  });

  it("set_storyboard 兜住景别与可选枚举：脏景别落默认档，认不出的可选枚举当没给", async () => {
    resetCalls();
    await client.callTool({
      name: "workshop_set_storyboard",
      arguments: {
        ...SESSION,
        shots: [
          {
            id: "s1",
            index: 0,
            shotType: "特写",
            motion: "hyper",
          },
        ],
      },
    });
    const shots = seen.shots as Array<Record<string, unknown>>;
    expect(shots).toEqual([
      expect.objectContaining({
        id: "s1",
        /* 景别走 `normalizeShotType`：脏值落默认档，而不是原样落库。 */
        shotType: "medium",
        /* 必填枚举严格（在 JSON Schema 里可见，脏值走拒收那一档，见下面一条）；
         * 可选枚举认不出 ⇒ 当没给，而不是把 "hyper" 写进草稿。 */
        status: "idle",
        prompt: "",
      }),
    ]);
    expect(shots[0]).not.toHaveProperty("motion", "hyper");
    expect(orchestrator.setStoryboard).toHaveBeenCalledWith("sess_1", shots);
    /* 判「落库的那一份里没有脏值」而不是判键在不在：transform 把认不出的可选枚举
     * 归成 `undefined`，`JSON.stringify` 会丢掉它 —— 这才是持久化层的真实形状。 */
    expect(JSON.stringify(shots)).not.toContain("hyper");
  });

  it("缺 name 的角色卡被拒收，且**一次都没落到服务端**", async () => {
    resetCalls();
    const result = await client.callTool({
      name: "workshop_set_characters",
      arguments: { ...SESSION, characters: [{ id: "c9" }] },
    });
    expect(orchestrator.setCharacters).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it("shots 给成对象而不是数组同样被拒收（`z.array(z.any())` 时这是能直接落库的形状）", async () => {
    resetCalls();
    const result = await client.callTool({
      name: "workshop_set_storyboard",
      arguments: { ...SESSION, shots: { id: "s1" } },
    });
    expect(orchestrator.setStoryboard).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  /** 必填枚举 = 严格档：与上面「可选枚举当没给」是刻意分开的两种处理，
   *  边界拒收比把 `"nonsense"` 写进草稿再让界面渲染出一个不存在的状态好得多。 */
  it("必填枚举给脏值走边界拒收（status 不是可选字段，不兜默认）", async () => {
    resetCalls();
    const result = await client.callTool({
      name: "workshop_set_storyboard",
      arguments: {
        ...SESSION,
        shots: [{ id: "s1", index: 0, status: "nonsense" }],
      },
    });
    expect(orchestrator.setStoryboard).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it("generate_image 的尺寸两种表达都归一成同一个 SizeSpec，一个都不给时传 undefined", async () => {
    resetCalls();
    await client.callTool({
      name: "workshop_generate_image",
      arguments: { ...SESSION, shotId: "s1", size: "1024x1024" },
    });
    const oldStyle = payloadOf();
    resetCalls();
    await client.callTool({
      name: "workshop_generate_image",
      arguments: { ...SESSION, shotId: "s1", ratio: "1:1", clarity: "1k" },
    });
    const modern = payloadOf();
    /* 判的是「两种表达等价」这条**语义**（老口径 `"1024x1024"` 必须换算成与新口径
     * 同一个 SizeSpec，AI 客户端仍会这么写），而不是去钉某个像素值 ——
     * 把 `{width: 1024}` 写进断言就是照实现抄期望（§11.2.1 第九条）。 */
    expect(oldStyle.size).toBeDefined();
    expect(oldStyle.size).toEqual(modern.size);

    resetCalls();
    await client.callTool({
      name: "workshop_generate_image",
      arguments: { ...SESSION, shotId: "s1" },
    });
    /* 一个都没给 ⇒ 传 undefined，让各通道走自己的默认档（不是传一个猜测的尺寸）。 */
    expect(payloadOf().size).toBeUndefined();
  });

  /** 最近一次 `generateImage` 收到的第二个实参（服务端侧真正看到的载荷）。 */
  function payloadOf(): { size?: unknown } {
    const calls = orchestrator.generateImage.mock.calls;
    return (calls.at(-1) ?? [undefined, {}])[1] as { size?: unknown };
  }

  it("get_session 遇到「库里没有这一行」时给的是可读错误，而不是一个 null 载荷", async () => {
    resetCalls();
    orchestrator.getSession.mockResolvedValueOnce(null as never);
    const result = await client.callTool({
      name: "workshop_get_session",
      arguments: SESSION,
    });
    expect(result.isError).toBe(true);
    /* 错误文案点名 sessionId：MCP 客户端拿着它才知道是哪一个会话没了。 */
    expect(textOf(result)).toContain("sess_1");
  });

  it("写侧工具的入参 schema 里不再出现任意 JSON（z.any 族的形状判据）", async () => {
    const listed = await client.listTools();
    const loose = listed.tools
      .filter((tool) => {
        const shape = JSON.stringify(tool.inputSchema ?? {});
        /* JSON Schema 里 `z.any()` 落成真空 schema（`{}`）或 `additionalProperties`
         * 全放的数组；这两形态都意味着「什么都收」。 */
        return /"items":\s*\{\s*\}/.test(shape);
      })
      .map((tool) => tool.name);
    expect(loose).toEqual([]);
  });
});
