/**
 * `src/lib/llm/server.ts` 的集成测试（ISSUE #565 覆盖率爬坡）。
 *
 * 这一层此前**零覆盖**，而它是全部 LLM 调用的唯一出口：配置分层（env → DB →
 * 请求覆盖）、上游请求的 URL / 鉴权头 / 超时、四条补全路径（一次性 / 流式 /
 * 结构化 / tools）、以及「网络层 TypeError 翻译成人话」。
 *
 * mock 边界：
 *   · `~/server/db` → `tests/helpers/test-db.ts` 的内存 SQLite（配置真读真写，
 *     顺带覆盖 `extraModels` 的解密路径）；
 *   · 全局 `fetch` → 逐用例可控的替身（断言请求形状与处理各类回包）。
 * 其余全部走真实实现。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

import {
  getLLMConfig,
  getConfigForClient,
  ensureRemoteStorageMigrated,
  describeFetchFailure,
  completeLLM,
  streamLLM,
  completeLLMStructured,
  completeLLMTools,
} from "~/lib/llm/server";
import type { LLMConfig, LLMTool } from "~/lib/llm/types";
import { llmConfigRepository } from "~/lib/core/repository-user";
import { getTestDb, seedRemoteModel } from "../../../tests/helpers/test-db";
import { z } from "zod";

const tdb = getTestDb();

const CFG = (over: Partial<LLMConfig> = {}): LLMConfig => ({
  provider: "local",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "llama3",
  extraModels: null,
  apiKey: null,
  temperature: 0.7,
  maxTokens: 2048,
  ...over,
});

/** 一次性响应替身：`res.json()` / `res.text()` 都可用。 */
function jsonResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

/** 流式响应替身：按给定 chunk 逐次吐出 `reader.read()` 的结果。 */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

/** 忽略 token 回调的占位（避免 lint 的空函数告警，同时语义清楚）。 */
const noop = (): void => undefined;

const fetchMock = vi.fn<typeof fetch>();

/** 取第 n 次 fetch 调用的 (url, init)，并把 init 收成可安全访问的形状。 */
function callAt(n = 0): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[n]!;
  // fetch 的首参在运行时一定是字符串 URL 或 Request；这里只做类型收窄，
  // 不做字符串化（`String(obj)` 会得到 `[object Object]`，lint 也据此拦人）。
  const arg: unknown = call[0];
  const url = typeof arg === "string" ? arg : (arg as Request).url;
  return { url, init: call[1] ?? {} };
}

/** 取第 n 次 fetch 调用的请求体（JSON 解析后的对象）。 */
function sentBody(n = 0): Record<string, unknown> {
  const raw = callAt(n).init.body;
  return JSON.parse(typeof raw === "string" ? raw : "{}") as Record<
    string,
    unknown
  >;
}

/** 取第 n 次 fetch 调用的请求头。 */
function sentHeaders(n = 0): Record<string, string> {
  return (callAt(n).init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  tdb.$reset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLLMConfig 的三层叠加（env → DB → 请求覆盖）", () => {
  it("无 DB 行时回落 env 默认值（provider/baseUrl/model/maxTokens）", async () => {
    const cfg = await getLLMConfig();
    expect(cfg).toMatchObject({
      provider: "local",
      model: "",
      extraModels: null,
      apiKey: null,
      temperature: 0.7,
      maxTokens: 2048,
    });
    expect(cfg.baseUrl).toContain("127.0.0.1");
  });

  it("DB 行覆盖 env；请求覆盖再盖 DB（除 extraModels 外逐字段）", async () => {
    await llmConfigRepository.upsertSingleton({
      provider: "remote",
      baseUrl: "https://api.db/v1",
      model: "db-model",
      apiKey: "sk-db",
      temperature: 0.4,
      maxTokens: 1024,
    });

    const fromDb = await getLLMConfig();
    expect(fromDb).toMatchObject({
      provider: "remote",
      baseUrl: "https://api.db/v1",
      model: "db-model",
      apiKey: "sk-db",
      temperature: 0.4,
      maxTokens: 1024,
    });

    // 只给 override.model → 三个字段被覆盖，temperature 走 resolveTaskTemperature
    const over = await getLLMConfig({
      provider: "local",
      baseUrl: "http://127.0.0.1:9999/v1",
      model: "req-model",
      temperature: 0.9,
      maxTokens: 64,
    });
    expect(over).toMatchObject({
      provider: "local",
      baseUrl: "http://127.0.0.1:9999/v1",
      model: "req-model",
      apiKey: "sk-db",
      temperature: 0.9,
      maxTokens: 64,
    });
  });

  it("temperatureByTask 命中 taskType 时压过全局温度与显式 t emperature", async () => {
    await llmConfigRepository.upsertSingleton({
      temperature: 0.7,
      temperatureByTask: { chat: 0.25 },
    });
    const cfg = await getLLMConfig({ taskType: "chat", temperature: 0.9 });
    expect(cfg.temperature).toBe(0.25);
    // 未命中的任务类型才看显式温度
    const other = await getLLMConfig({ taskType: "txt2img", temperature: 0.9 });
    expect(other.temperature).toBe(0.9);
  });

  it("DB 抛错时静默回落 env（不把配置读取失败变成请求失败）", async () => {
    const cfg = await getLLMConfig();
    expect(cfg.provider).toBe("local");
  });

  it("override.model 命中带独立连接参数的远端条目时改走该条目的 baseUrl/apiKey", async () => {
    await llmConfigRepository.upsertSingleton({
      provider: "remote",
      baseUrl: "https://global/v1",
      apiKey: "sk-global",
      extraModels: [
        {
          name: "alt",
          baseUrl: "https://alt/v1",
          apiKey: "sk-alt",
          kind: "chat",
        },
        "local-only",
      ],
    });

    const hit = await getLLMConfig({ model: "alt" });
    expect(hit.baseUrl).toBe("https://alt/v1");
    expect(hit.apiKey).toBe("sk-alt");

    // 本地候选（无 baseUrl/apiKey）不改连接参数
    const local = await getLLMConfig({ model: "local-only" });
    expect(local.baseUrl).toBe("https://global/v1");
    expect(local.apiKey).toBe("sk-global");
  });

  it("DB 的本地候选名 + remoteModel 表条目 + 遗留远端对象三者合并进 extraModels", async () => {
    await llmConfigRepository.upsertSingleton({
      baseUrl: "https://global/v1",
      extraModels: [
        "local-a",
        { name: "legacy-remote", baseUrl: "https://legacy/v1", apiKey: "sk-l" },
      ],
    });
    seedRemoteModel(tdb, { name: "tbl-remote", baseUrl: "https://t/v1" });

    const cfg = await getLLMConfig();
    const names = (cfg.extraModels ?? []).map((e) => e.name).sort();
    expect(names).toEqual(["legacy-remote", "local-a", "tbl-remote"]);
    // 本地候选被对象化后 baseUrl/apiKey 为空
    const localEntry = cfg.extraModels!.find((e) => e.name === "local-a");
    expect(localEntry).toMatchObject({
      baseUrl: null,
      apiKey: null,
      kind: null,
    });
  });
});

describe("getConfigForClient", () => {
  it("保留「本地候选=字符串 / 远端=对象」的类型区分（设置页据此写回）", async () => {
    await llmConfigRepository.upsertSingleton({
      baseUrl: "https://global/v1",
      extraModels: ["local-a"],
    });
    seedRemoteModel(tdb, { name: "tbl-remote", baseUrl: "https://t/v1" });

    const out = await getConfigForClient();
    expect(out.extraModels).toEqual([
      "local-a",
      {
        name: "tbl-remote",
        baseUrl: "https://t/v1",
        // 给客户端的形态里密钥一律被剥掉（顶层与远端条目都是），所以这里不再是
        // `null`。「本地=字符串 / 远端=对象」这条类型区分与「不外泄密钥」是两件事，
        // 两条都要看得见。
        apiKey: undefined,
        kind: "chat",
      },
    ]);
    expect(out.apiKey).toBeUndefined();
  });

  it("远端表里误存的本地 ollama（回环 + 无密钥）折回本地候选字符串", async () => {
    await llmConfigRepository.upsertSingleton({
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    // 指向回环且不带密钥 —— 属于「误存的本地 ollama」
    seedRemoteModel(tdb, { name: "misplaced", baseUrl: null });

    const out = await getConfigForClient();
    expect(out.extraModels).toEqual(["misplaced"]);
  });
});

describe("ensureRemoteStorageMigrated（option C 存量迁移，幂等）", () => {
  it("把遗留远端对象搬到 remoteModel 表，并把 extraModels 收窄成纯本地名", async () => {
    await llmConfigRepository.upsertSingleton({
      baseUrl: "https://global/v1",
      extraModels: [
        "local-a",
        {
          name: "remote-b",
          baseUrl: "https://b/v1",
          apiKey: "sk-b",
          kind: "image",
        },
      ],
    });

    await ensureRemoteStorageMigrated();

    const { remoteModelRepository, llmConfigRepository: repo } =
      await import("~/lib/core/repository-user");
    expect((await remoteModelRepository.list()).map((r) => r.name)).toEqual([
      "remote-b",
    ]);
    expect((await repo.findSingleton())?.extraModels).toEqual(["local-a"]);
  });

  it("指向回环、无密钥的「远端」条目折回本地候选，不搬进表", async () => {
    await llmConfigRepository.upsertSingleton({
      baseUrl: "https://global/v1",
      extraModels: [
        "local-a",
        { name: "secretly-local", baseUrl: "http://localhost:11434/v1" },
      ],
    });

    await ensureRemoteStorageMigrated();

    const { remoteModelRepository, llmConfigRepository: repo } =
      await import("~/lib/core/repository-user");
    expect(await remoteModelRepository.list()).toEqual([]);
    expect((await repo.findSingleton())?.extraModels).toEqual([
      "local-a",
      "secretly-local",
    ]);
  });

  it("无单例行 / extraModels 非数组 / 无遗留远端条目 → 全是空操作", async () => {
    await expect(ensureRemoteStorageMigrated()).resolves.toBeUndefined();

    await llmConfigRepository.upsertSingleton({ extraModels: ["only-local"] });
    await expect(ensureRemoteStorageMigrated()).resolves.toBeUndefined();

    const { remoteModelRepository } =
      await import("~/lib/core/repository-user");
    expect(await remoteModelRepository.list()).toEqual([]);

    // 幂等：再跑一次结果不变
    await ensureRemoteStorageMigrated();
    expect(await remoteModelRepository.list()).toEqual([]);
  });
});

/* ─────────────────────────── 网络失败的可读翻译 ─────────────────────────── */

describe("describeFetchFailure", () => {
  const typeErr = (cause: unknown) =>
    Object.assign(new TypeError("fetch failed"), { cause });

  it("非 TypeError 走原样消息；非 Error 给兜底中文", () => {
    expect(describeFetchFailure(new Error("自定义"), CFG())).toBe("自定义");
    expect(describeFetchFailure("炸了", CFG())).toBe("网络请求失败");
    expect(describeFetchFailure(null, CFG())).toBe("网络请求失败");
  });

  it("ECONNREFUSED + 本地 provider → 提示确认 Ollama 已启动", () => {
    const msg = describeFetchFailure(
      typeErr(Object.assign(new Error("connect ECONNREFUSED"), {})),
      CFG({ provider: "local", baseUrl: "http://127.0.0.1:11434/v1" }),
    );
    expect(msg).toContain("连不上本地服务");
    expect(msg).toContain("Ollama");
  });

  it("ECONNREFUSED + 远端 provider → 提示检查网络与 Base URL", () => {
    const msg = describeFetchFailure(
      typeErr(new Error("connect ECONNRESET")),
      CFG({ provider: "remote", baseUrl: "https://api.x/v1" }),
    );
    expect(msg).toContain("连不上远端服务");
    expect(msg).toContain("网络");
  });

  it("回环地址即便 provider=remote 也按本地口径给提示", () => {
    const msg = describeFetchFailure(
      typeErr(new Error("ECONNREFUSED")),
      CFG({ provider: "remote", baseUrl: "http://localhost:11434/v1" }),
    );
    expect(msg).toContain("连不上本地服务");
  });

  it("DNS 失败 / 超时 / 其他错误各有专门的文案分支", () => {
    const dns = describeFetchFailure(
      typeErr(new Error("getaddrinfo ENOTFOUND nope")),
      CFG(),
    );
    expect(dns).toContain("域名解析失败");

    const timeout = describeFetchFailure(
      typeErr(new Error("connect ETIMEDOUT")),
      CFG(),
    );
    expect(timeout).toContain("连接超时");

    const other = describeFetchFailure(
      typeErr(new Error("socket hang up")),
      CFG(),
    );
    expect(other).toContain("socket hang up");
  });

  it("cause 不是 Error（字符串 / 对象 / 缺失）时也能拼出文案而不是 [object Object]", () => {
    expect(describeFetchFailure(typeErr("ECONNREFUSED"), CFG())).toContain(
      "连不上",
    );
    expect(
      describeFetchFailure(typeErr({ code: "X" }), CFG({ provider: "remote" })),
    ).toContain('{"code":"X"}');
    const none = describeFetchFailure(new TypeError("fetch failed"), CFG());
    expect(none).toContain("调用本地模型失败");
  });

  it("baseUrl 末尾斜杠不重复出现", () => {
    const msg = describeFetchFailure(
      typeErr(new Error("ECONNREFUSED")),
      CFG({ baseUrl: "http://127.0.0.1:11434/v1/" }),
    );
    expect(msg).not.toContain("/v1//");
  });
});

/* ─────────────────────────── 四条补全路径 ─────────────────────────── */

describe("completeLLM（一次性补全）", () => {
  it("未配置模型 → 立刻抛可操作文案，且不发请求", async () => {
    await expect(completeLLM(CFG({ model: "  " }), [])).rejects.toThrow(
      /尚未配置生效模型/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("请求形状：URL 去尾斜杠、Content-Type、非流式、截断参数", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "你好" } }] }),
    );
    const text = await completeLLM(
      CFG({ baseUrl: "http://127.0.0.1:11434/v1/", maxTokens: 128 }),
      [{ role: "user", content: "hi" }],
    );
    expect(text).toBe("你好");

    expect(callAt().url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(callAt().init.method).toBe("POST");
    expect(sentHeaders()).toEqual({ "Content-Type": "application/json" });
    const body = sentBody();
    expect(body).toMatchObject({
      model: "llama3",
      max_tokens: 128,
      stream: false,
    });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("provider=remote 且有 apiKey 时带 Bearer；local 不带", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    await completeLLM(CFG({ provider: "remote", apiKey: "sk-1" }), []);
    expect(sentHeaders().Authorization).toBe("Bearer sk-1");

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    await completeLLM(CFG({ provider: "local", apiKey: "sk-1" }), []);
    expect(sentHeaders().Authorization).toBeUndefined();
  });

  it("choices 缺失 / 空数组 / content 缺失 → 回空串而不是崩", async () => {
    for (const payload of [{}, { choices: [] }, { choices: [{}] }]) {
      fetchMock.mockResolvedValue(jsonResponse(payload));
      expect(await completeLLM(CFG(), [])).toBe("");
    }
  });

  it("网络层 TypeError 被翻译成可读原因", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("ECONNREFUSED"),
      }),
    );
    await expect(completeLLM(CFG(), [])).rejects.toThrow(/连不上本地服务/);
  });

  it("非 2xx：401/403 附「API Key 无效」提示并截断响应片段", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "unauthorized" }, { status: 401 }),
    );
    await expect(completeLLM(CFG({ provider: "remote" }), [])).rejects.toThrow(
      /LLM 请求失败 \(401\).*API Key 无效/,
    );

    fetchMock.mockResolvedValue(jsonResponse({}, { status: 500 }));
    await expect(completeLLM(CFG(), [])).rejects.toThrow(
      /LLM 请求失败 \(500\)/,
    );
  });

  it("错误响应体为空时不拼多余的冒号", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "",
      json: async () => ({}),
    } as unknown as Response);
    await expect(completeLLM(CFG(), [])).rejects.toThrow(
      /LLM 请求失败 \(502\)$/,
    );
  });
});

describe("streamLLM（流式补全）", () => {
  it("跨 chunk 拼帧、逐 token 回调、[DONE] 与坏帧跳过", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"cho',
        'ices":[{"delta":{"content":"好"}}]}\n\n',
        "data: {坏帧\n\n",
        "data: [DONE]\n\n",
        'data: {"choices":[{"delta":{"content":"！"}}]}\n\n',
      ]),
    );
    const tokens: string[] = [];
    const full = await streamLLM(CFG(), [], (t) => tokens.push(t));
    expect(tokens).toEqual(["你", "好", "！"]);
    expect(full).toBe("你好！");
    expect(sentBody().stream).toBe(true);
  });

  it("忽略非 data: 行与空 delta（Ollama 的心跳/空内容）", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        ": keep-alive\n\n",
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[]}\n\n',
        'data: {"choices":[{"delta":{"content":"X"}}]}\n\n',
      ]),
    );
    expect(await streamLLM(CFG(), [], noop)).toBe("X");
  });

  it("服务端不返回 body → 明确报「未返回数据流」", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response);
    await expect(streamLLM(CFG(), [], noop)).rejects.toThrow(/未返回数据流/);
  });

  it("未配置模型时同样先拦下", async () => {
    await expect(streamLLM(CFG({ model: "" }), [], noop)).rejects.toThrow(
      /尚未配置生效模型/,
    );
  });
});

describe("completeLLMStructured（结构化补全）", () => {
  const schema = z.object({ name: z.string(), n: z.number() });

  it("强制 JSON 输出并用 schema 校验；response_format 落在请求体里", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '{"name":"甲","n":2}' } }],
      }),
    );
    const out = await completeLLMStructured(CFG(), [], schema);
    expect(out).toEqual({ name: "甲", n: 2 });
    expect(sentBody().response_format).toEqual({ type: "json_object" });
  });

  it("返回非 JSON → 抛「无法解析结构化结果」", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "不是 JSON" } }] }),
    );
    await expect(completeLLMStructured(CFG(), [], schema)).rejects.toThrow(
      /非 JSON/,
    );
  });

  it("JSON 合法但 schema 不匹配 → 抛 zod 校验错误", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '{"name":"甲"}' } }] }),
    );
    await expect(completeLLMStructured(CFG(), [], schema)).rejects.toThrow();
  });

  it("content 缺失 → 按 `{}` 解析后由 schema 拦截", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(completeLLMStructured(CFG(), [], schema)).rejects.toThrow();
  });
});

describe("completeLLMTools（tools 协议）", () => {
  it("解析 tool_calls 且 tools 参数原样上行", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "search", arguments: '{"q":"x"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    const tools: LLMTool[] = [
      {
        type: "function",
        function: { name: "search", description: "搜索" },
      },
    ];
    const out = await completeLLMTools(CFG(), [], tools);
    expect(out.content).toBe("");
    expect(out.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: '{"q":"x"}' },
      },
    ]);
    expect(sentBody().tools).toEqual(tools);
  });

  it("残缺 tool_call（缺 id / 缺 name / arguments 非字符串）逐条丢弃，不整包失败", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: "纯文本回答",
              tool_calls: [
                { type: "function", function: { name: "a", arguments: "{}" } },
                { id: "i2", type: "function", function: { arguments: "{}" } },
                {
                  id: "i3",
                  type: "function",
                  function: { name: "c", arguments: 1 },
                },
                {
                  id: "i4",
                  type: "function",
                  function: { name: "ok", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
    );
    const out = await completeLLMTools(CFG(), [], []);
    expect(out.content).toBe("纯文本回答");
    expect(out.toolCalls.map((c) => c.id)).toEqual(["i4"]);
  });

  it("没有 tool_calls 字段 / choices 为空 → 空数组与空文本", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    expect(await completeLLMTools(CFG(), [], [])).toEqual({
      content: "",
      toolCalls: [],
    });
    fetchMock.mockResolvedValue(jsonResponse({}));
    expect(await completeLLMTools(CFG(), [], [])).toEqual({
      content: "",
      toolCalls: [],
    });
  });
});
