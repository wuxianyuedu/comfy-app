/**
 * `llm` 子域三个**网络客户端**模块的测试（ISSUE #565 覆盖率爬坡）：
 *   · `ollama-client.ts`   —— 探测 / 启动 / 停止 Ollama（浏览器侧）
 *   · `model-catalog-client.ts` —— 模型清单下拉的数据源
 *   · `usage-test-client.ts`    —— 「测试」弹窗的网络侧（含结果归一化）
 *   · `video-task-util.ts`      —— 远端任务的本地落盘（`fs` 真写临时目录）
 *
 * 这四者的共同点是：**失败都不该抛给用户**（下拉少一组、状态行红点、
 * 弹窗里一行提示），所以断言的重点是「降级成了什么」而不是「抛了什么」。
 * mock 边界只有全局 `fetch` 与（落盘用例的）临时目录。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ollamaTagsUrl,
  probeOllama,
  startOllama,
  stopOllama,
} from "~/lib/llm/ollama-client";
import {
  fetchLocalModels,
  fetchRemoteModels,
} from "~/lib/llm/model-catalog-client";
import { testModelUsage, queryUsageTask } from "~/lib/llm/usage-test-client";
import { saveMediaToLocalTemp } from "~/lib/llm/video-task-util";

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

/** 一次性响应替身（`json()` / `text()` 都可用）。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ollama-client", () => {
  it("ollamaTagsUrl 剥掉 OpenAI 兼容的 /v1 后缀（带不带尾斜杠都对）", () => {
    expect(ollamaTagsUrl("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
    expect(ollamaTagsUrl("http://127.0.0.1:11434/v1/")).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
    // 不是 /v1 结尾就原样接上
    expect(ollamaTagsUrl("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
  });

  it("探测成功：返回模型清单（探测带超时信号）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        models: [{ name: "llama3", size: 1, modified_at: "2024-01-01" }],
      }),
    );
    await expect(probeOllama("http://127.0.0.1:11434/v1")).resolves.toEqual({
      up: true,
      models: [{ name: "llama3", size: 1, modified_at: "2024-01-01" }],
    });
    expect(callAt().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("2xx 但 models 缺失 / 不是数组 → 运行中但 0 个模型", async () => {
    for (const body of [{}, { models: "x" }]) {
      fetchMock.mockResolvedValue(jsonResponse(body));
      await expect(probeOllama("http://x/v1")).resolves.toEqual({
        up: true,
        models: [],
      });
    }
  });

  it("2xx 却是非 JSON（端口上跑的是别的服务）→ 按未运行处理，而不是「0 个模型」", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    await expect(probeOllama("http://x/v1")).resolves.toEqual({ up: false });
  });

  it("非 2xx / 网络抛错 / 超时 → 一律「未运行」，绝不抛给用户", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(probeOllama("http://x/v1")).resolves.toEqual({ up: false });

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(probeOllama("http://x/v1")).resolves.toEqual({ up: false });
  });

  it("startOllama 成功静默；失败优先用服务端的 error 详情", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 200));
    await expect(startOllama()).resolves.toBeUndefined();
    expect(callAt().url).toBe("/api/llm/ollama-start");
    expect(callAt().init.method).toBe("POST");

    fetchMock.mockResolvedValue(jsonResponse({ error: "端口被占" }, 500));
    await expect(startOllama()).rejects.toThrow("端口被占");

    // 响应体不是 JSON / 没有 error → 用兜底中文文案
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("x");
      },
    } as unknown as Response);
    await expect(startOllama()).rejects.toThrow(/请确认已安装 Ollama/);
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(startOllama()).rejects.toThrow(/请确认已安装 Ollama/);
  });

  it("stopOllama 失败给可操作文案（提示手动结束进程）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 200));
    await expect(stopOllama()).resolves.toBeUndefined();

    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(stopOllama()).rejects.toThrow(/请手动结束 ollama 进程/);
  });
});

/* ──────────────────────── 模型目录客户端 ──────────────────────── */

describe("model-catalog-client", () => {
  it("成功：只保留非空字符串模型名", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        models: ["a", "", "   ", 1, null, "b"],
        detail: "共 2 个",
      }),
    );
    await expect(fetchLocalModels()).resolves.toEqual({
      ok: true,
      models: ["a", "b"],
      detail: "共 2 个",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/llm/models?provider=local");
  });

  it("远端探测带 model 参数（工坊按所选条目解析独立连接参数）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, models: [] }));
    await fetchRemoteModels("远端 甲/1");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/api/llm/models?provider=remote&model=${encodeURIComponent("远端 甲/1")}`,
    );
    // 空 model 不带该参数
    await fetchRemoteModels();
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/llm/models?provider=remote");
  });

  it("ok 不是 true、models 不是数组 → 降级为空清单 + HTTP 文案", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: "yes", models: "x" }, 500));
    await expect(fetchLocalModels()).resolves.toEqual({
      ok: false,
      models: [],
      detail: "请求失败 (500)",
    });
  });

  it("响应体不是 JSON → 仍给 HTTP 文案（页面不该因探测而报错）", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("html");
      },
    } as unknown as Response);
    await expect(fetchLocalModels()).resolves.toEqual({
      ok: false,
      models: [],
      detail: "请求失败 (502)",
    });
  });

  it("网络抛错 → ok:false + 原始错误消息", async () => {
    fetchMock.mockRejectedValue(new Error("The operation was aborted"));
    await expect(fetchLocalModels()).resolves.toEqual({
      ok: false,
      models: [],
      detail: "The operation was aborted",
    });
  });

  it("抛出非 Error 时给中文兜底文案", async () => {
    fetchMock.mockRejectedValue("boom");
    await expect(fetchLocalModels()).resolves.toEqual({
      ok: false,
      models: [],
      detail: "网络请求失败",
    });
  });
});

/* ──────────────────────── 用量测试客户端 ──────────────────────── */

describe("usage-test-client", () => {
  const INPUT = {
    kind: "chat" as const,
    name: "entry",
    baseUrl: "https://x/v1",
    path: "/chat/completions",
    prompt: "hi",
  };

  it("成功结果逐字段归一化（chat/image/video 三态字段都在）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        detail: "用了 1.2s",
        chatText: "你好",
        imageUrl: "https://i/1.png",
        videoUrl: "https://v/1.mp4",
        taskId: "t1",
        pending: true,
        elapsedMs: 1234,
        savedPath: "/tmp/x",
      }),
    );
    await expect(testModelUsage(INPUT)).resolves.toEqual({
      ok: true,
      detail: "用了 1.2s",
      chatText: "你好",
      imageUrl: "https://i/1.png",
      videoUrl: "https://v/1.mp4",
      taskId: "t1",
      pending: true,
      elapsedMs: 1234,
      savedPath: "/tmp/x",
    });

    expect(callAt().url).toBe("/api/llm/test-usage");
    expect(callAt().init.method).toBe("POST");
    expect(sentHeaders()["Content-Type"]).toBe("application/json");
    expect(sentBody()).toEqual(INPUT);
  });

  it("字段类型不对一律丢弃（不把 number 当字符串透传给界面）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: "true",
        detail: 42,
        chatText: null,
        elapsedMs: "1234",
        pending: 1,
      }),
    );
    await expect(testModelUsage(INPUT)).resolves.toEqual({
      ok: false,
      detail: "请求失败 (200)",
      chatText: undefined,
      imageUrl: undefined,
      videoUrl: undefined,
      taskId: undefined,
      pending: false,
      elapsedMs: undefined,
      savedPath: undefined,
    });
  });

  it("响应体不可解析 → 落到「请求失败 (status)」而不是抛错", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("html");
      },
    } as unknown as Response);
    await expect(testModelUsage(INPUT)).resolves.toMatchObject({
      ok: false,
      detail: "请求失败 (500)",
    });
  });

  it("queryUsageTask 打的是查询端点，且只带查询入参（不含 prompt —— 不重复提交）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, detail: "还在跑" }));
    const out = await queryUsageTask({
      name: "entry",
      baseUrl: "https://x/v1",
      path: "/videos",
      taskId: "t1",
    });
    expect(out).toMatchObject({ ok: true, detail: "还在跑" });

    expect(callAt().url).toBe("/api/llm/test-usage/query");
    const body = sentBody();
    expect(body).toEqual({
      name: "entry",
      baseUrl: "https://x/v1",
      path: "/videos",
      taskId: "t1",
    });
    expect(body).not.toHaveProperty("prompt");
  });
});

/* ──────────────────────── video-task-util 落盘 ──────────────────────── */

describe("saveMediaToLocalTemp（本地落盘，失败一律静默）", () => {
  const tmpRoot = path.join(
    os.tmpdir(),
    `comfy-usage-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("远端 URL：下载并落到 temp/usage-test/<模型名>/，扩展名随 URL", async () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    try {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("binary").buffer,
      } as unknown as Response);

      const dest = await saveMediaToLocalTemp(
        "image",
        "my model/x",
        "https://i/a.png",
      );
      expect(dest).not.toBeNull();
      expect(dest!.startsWith(path.join(tmpRoot, "temp", "usage-test"))).toBe(
        true,
      );
      // 模型名里的分隔符被剥掉，不产生路径穿越
      expect(dest).toContain(path.join("usage-test", "x"));
      expect(dest!.endsWith(".png")).toBe(true);
      expect((await fs.readFile(dest!, "utf-8")).length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("data URL：直接按 base64 解码写盘（不经过网络）", async () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    try {
      const b64 = Buffer.from("hello").toString("base64");
      const dest = await saveMediaToLocalTemp(
        "image",
        "m",
        `data:image/jpeg;base64,${b64}`,
      );
      expect(dest!.endsWith(".jpg")).toBe(true);
      expect(await fs.readFile(dest!, "utf-8")).toBe("hello");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("HTTP 失败 / 空文件 / 网络抛错 → 返回 null 而不是抛错（落盘只是增强）", async () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    try {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);
      await expect(
        saveMediaToLocalTemp("video", "m", "https://v/x.mp4"),
      ).resolves.toBeNull();

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);
      await expect(
        saveMediaToLocalTemp("video", "m", "https://v/x.mp4"),
      ).resolves.toBeNull();

      fetchMock.mockRejectedValue(new Error("ECONNRESET"));
      await expect(
        saveMediaToLocalTemp("video", "m", "https://v/x.mp4"),
      ).resolves.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("模型名为空 / 全是被清洗掉的字符 → 落到 unnamed 目录而不是 temp 根", async () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    try {
      const b64 = Buffer.from("x").toString("base64");
      const dest = await saveMediaToLocalTemp(
        "image",
        "   ",
        `data:image/png;base64,${b64}`,
      );
      expect(dest).toContain(path.join("usage-test", "unnamed"));
    } finally {
      spy.mockRestore();
    }
  });

  it("data URL 缺逗号时分隔符兜底（不把整个串当 base64 解）", async () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    try {
      const dest = await saveMediaToLocalTemp(
        "image",
        "m",
        "data:image/png;base64",
      );
      expect(dest).not.toBeNull();
      expect((await fs.readFile(dest!)).length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
