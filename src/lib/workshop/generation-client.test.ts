// `prepareShotReferences` 单测：镜头参考图的收集与上传（#4355）。
//
// 流程口径（docs/guides/feature-workshop-flow.md §4）：镜头级多选参考图
// （首张为主图）优先，留空回落出场角色的已选定妆照。helper 的职责边界：
// 只收集、按序上传进 ComfyUI 输入目录换文件名、单张失败不拖垮整批、
// 同一 URL 会话内只上传一次、已是输入目录文件名的直接透传（不二次上传）。
// 这里不 mock 本模块，直接 mock 全局 fetch（prepareLocalInputImage 的传输层），
// 上传解析逻辑保持真实执行。
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiGenerateImage,
  apiPollVideo,
  apiSubmitVideo,
  buildLibraryWorkflowInput,
  fetchWorkshopWorkflows,
  prepareShotReferences,
} from "./generation-client";
import type { Character, Shot } from "./types";
import { isRecord } from "~/lib/is-record";

/* fetchWorkshopWorkflows 的 workflow.list 读数（#4119 回归）：现役形状是
 * { workflows, localPending, localRoots }，历史形状是裸数组。 */
let vanillaListResult: unknown;
/* buildLibraryWorkflowInput 的 workflow.detailFull 读数（ISSUE #4910 用例）：
 * 给最小形状（无 IO / 无 paramMap / 无装载绑定），让封装层走「空图早退」分支，
 * 只验证入参组装本身。 */
let detailFullResult: unknown;
vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    workflow: {
      list: {
        query: () => Promise.resolve(vanillaListResult),
      },
      detailFull: {
        query: () => Promise.resolve(detailFullResult),
      },
    },
  },
}));

function makeCharacter(id: string, portraitUrl?: string): Character {
  return {
    id,
    name: `角色${id}`,
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "a cat",
    negativePrompt: "",
    params: {},
    ...(portraitUrl !== undefined && portraitUrl !== "" ? { portraitUrl } : {}),
  };
}

/** 桩掉 /api/workshop-local/prepare：按请求体里的图 URL 派生文件名
 *  （…/a.png → up-a.png），`failUrls` 里的 URL 一律失败。
 *  文件名与 URL 绑定而不是与调用序绑定，「出场序」的断言才有意义；
 *  各用例用独立 URL 前缀，避免 helper 的会话内缓存跨用例串味。 */
function mockPrepare(prefix: string, failUrls: ReadonlySet<string> = new Set()) {
  const mock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const parsed: unknown = JSON.parse(raw);
    const image = isRecord(parsed) && typeof parsed.image === "string" ? parsed.image : "";
    if (failUrls.has(image)) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "上传失败" }), {
          status: 500,
        }),
      );
    }
    const tail = image.split("/").pop() ?? "x";
    return Promise.resolve(
      new Response(JSON.stringify({ filename: `up-${prefix}-${tail}` }), {
        status: 200,
      }),
    );
  });
  globalThis.fetch = mock;
  return mock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makeShot(referenceImages?: Array<string>, characterIds: Array<string> = []): Shot {
  return {
    id: "s1",
    index: 1,
    sceneId: "scene-1",
    sceneHeading: "",
    shotType: "medium",
    description: "",
    characterIds,
    status: "idle",
    params: {},
    prompt: "",
    negativePrompt: "",
    ...(referenceImages === undefined ? {} : { referenceImages }),
  };
}

describe("prepareShotReferences", () => {
  it("镜头级多选优先：按用户给的顺序上传，定妆照不再参与", async () => {
    const characters = [
      makeCharacter("c1", "/api/generated/t6/p1.png"),
      makeCharacter("c2", "/api/generated/t6/p2.png"),
    ];
    const mock = mockPrepare("t6");

    const { files, failedCount } = await prepareShotReferences(
      makeShot(["/api/generated/t6/x.png", "/api/generated/t6/y.png"], ["c1"]),
      characters,
    );

    expect(files).toEqual(["up-t6-x.png", "up-t6-y.png"]);
    expect(failedCount).toBe(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("留空回落出场角色的已选定妆照（按出场序，不再截两张，#4355）", async () => {
    const characters = [
      makeCharacter("c1", "/api/generated/t7/a.png"),
      makeCharacter("c2", "/api/generated/t7/b.png"),
      makeCharacter("c3", "/api/generated/t7/c.png"),
    ];
    const mock = mockPrepare("t7");

    const { files, failedCount } = await prepareShotReferences(
      makeShot(undefined, ["c3", "c1", "c2"]),
      characters,
    );

    expect(files).toEqual(["up-t7-c.png", "up-t7-a.png", "up-t7-b.png"]);
    expect(failedCount).toBe(0);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("没有可用参考图：空数组且不发任何请求", async () => {
    const mock = mockPrepare("t8");
    const { files, failedCount } = await prepareShotReferences(makeShot(undefined, ["c1"]), [
      makeCharacter("c1"),
      makeCharacter("c2"),
    ]);
    expect(files).toEqual([]);
    expect(failedCount).toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("单张上传失败不拖垮整批：计入 failedCount，其余照常返回", async () => {
    const characters = [makeCharacter("c1", "/api/generated/t9/a.png")];
    mockPrepare("t9", new Set(["/api/generated/t9/a.png"]));

    const { files, failedCount } = await prepareShotReferences(
      makeShot(["/api/generated/t9/a.png", "/api/generated/t9/b.png"]),
      characters,
    );

    expect(files).toEqual(["up-t9-b.png"]);
    expect(failedCount).toBe(1);
  });

  it("已是输入目录文件名的直接透传，不二次上传（镜头卡片存的就是它）", async () => {
    const mock = mockPrepare("t10");

    const { files, failedCount } = await prepareShotReferences(
      makeShot(["workshop-ref-abc.png", "/api/generated/t10/z.png"]),
      [],
    );

    expect(files).toEqual(["workshop-ref-abc.png", "up-t10-z.png"]);
    expect(failedCount).toBe(0);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("会话内缓存：批量生成时同一张图只上传一次", async () => {
    const characters = [makeCharacter("c1", "/api/generated/t11/a.png")];
    const mock = mockPrepare("t11");

    const shot = makeShot(undefined, ["c1"]);
    const first = await prepareShotReferences(shot, characters);
    const second = await prepareShotReferences(shot, characters);

    expect(first.files).toEqual(["up-t11-a.png"]);
    expect(second.files).toEqual(["up-t11-a.png"]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

/* ── relay 请求读数与 seed 透传（ISSUE #3791；seed 是 #3778 的漏发回归）────── */
describe("apiGenerateImage / apiSubmitVideo / apiPollVideo 的 onDebug 与 seed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRelay(payload: unknown, status = 200) {
    const mock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(payload), { status })),
    );
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  function relayBodyOf(mock: ReturnType<typeof stubRelay>): Record<string, unknown> {
    const raw: unknown = mock.mock.calls[0]?.[1]?.body;
    const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : "{}");
    return isRecord(parsed) ? parsed : {};
  }

  it("seed 进请求体（#3778 的漏发回归：路由解析了但客户端从未发送）", async () => {
    const mock = stubRelay({ url: "https://cdn/x.png" });
    const url = await apiGenerateImage({ prompt: "p", seed: 42 });
    expect(url).toBe("https://cdn/x.png");
    expect(relayBodyOf(mock).seed).toBe(42);
  });

  it("视频提交同样透传 seed（ISSUE #3783：客户端组装不得剥掉）", async () => {
    const mock = stubRelay({ remoteTaskId: "t-1" });
    const result = await apiSubmitVideo({ prompt: "p", seed: 42 });
    expect(result.remoteTaskId).toBe("t-1");
    expect(relayBodyOf(mock).seed).toBe(42);
  });

  it("onDebug：成功响应里的 debug 读数逐批上抛", async () => {
    const row = {
      body: { prompt: "p" },
      durationMs: 12,
      endpoint: "https://api.example.com/v1/images/generations",
      excerpt: '{"url":"https://cdn/x.png"}',
      ok: true,
      phase: "image",
      status: 200,
    };
    stubRelay({ url: "https://cdn/x.png", debug: [row] });
    const seen: Array<unknown> = [];
    await apiGenerateImage({ prompt: "p" }, { onDebug: (rows) => seen.push(...rows) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ phase: "image", status: 200 });
  });

  it("onDebug：失败响应（502 带 debug）先上抛读数再抛错", async () => {
    const row = {
      body: { prompt: "p" },
      durationMs: 5,
      endpoint: "https://api.example.com/v1/images/generations",
      excerpt: '{"error":"quota"}',
      ok: false,
      phase: "image",
      status: 402,
    };
    stubRelay({ error: "API 生图失败（402）", debug: [row] }, 502);
    const seen: Array<unknown> = [];
    await expect(
      apiGenerateImage({ prompt: "p" }, { onDebug: (rows) => seen.push(...rows) }),
    ).rejects.toThrow("API 生图失败");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: 402 });
  });

  it("视频提交：onDebug 上抛读数，debug 旗标进请求体", async () => {
    const row = {
      body: { prompt: "p" },
      durationMs: 8,
      endpoint: "https://api.example.com/v1/videos",
      excerpt: '{"taskId":"t-1"}',
      ok: true,
      phase: "video-submit",
      status: 200,
    };
    const mock = stubRelay({ remoteTaskId: "t-1", debug: [row] });
    const seen: Array<unknown> = [];
    await apiSubmitVideo({ prompt: "p" }, { onDebug: (rows) => seen.push(...rows) });
    expect(relayBodyOf(mock).debug).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ phase: "video-submit", status: 200 });
  });

  it("视频轮询：opts.debug=true 时请求带 debug 旗标，读数上抛", async () => {
    const mock = stubRelay({ pending: true });
    const seen: Array<unknown> = [];
    await apiPollVideo("t-1", {
      debug: true,
      mode: "T2V",
      model: "m",
      onDebug: (rows) => seen.push(...rows),
    });
    expect(relayBodyOf(mock).debug).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

/* fetchWorkshopWorkflows：workflow.list 返回形状的解析（#4119 回归）。
 * 现役形状是 { workflows, localPending, localRoots }，历史形状是裸数组 ——
 * 两种都要能取到 workflows 数组，否则工坊「生成资源」与测试模型页的工作流
 * 候选恒为空。 */
describe("fetchWorkshopWorkflows：workflow.list 形状解析（#4119 回归）", () => {
  it("对象形状（现役）：取 workflows 数组并映射出选项", async () => {
    vanillaListResult = {
      workflows: [
        {
          id: "wf-1",
          name: "image_z_image_int8_t2i",
          taskType: "T2I",
          modes: ["T2I"],
          typeCategory: "image",
          modelTags: ["z-image"],
          workflowIO: {},
          paramMap: null,
        },
      ],
      localPending: [],
      localRoots: null,
    };
    const options = await fetchWorkshopWorkflows();
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      id: "wf-1",
      name: "image_z_image_int8_t2i",
      category: "image",
      modes: ["T2I"],
    });
  });

  it("裸数组形状（历史）：照旧可用", async () => {
    vanillaListResult = [
      { id: "wf-2", name: "video_wf", taskType: "T2V", modes: ["T2V"], typeCategory: "video" },
    ];
    const options = await fetchWorkshopWorkflows();
    expect(options).toHaveLength(1);
    expect(options[0]?.category).toBe("video");
  });

  it("既不是数组也没有 workflows 字段：安全回落空清单", async () => {
    vanillaListResult = { localPending: [], localRoots: null };
    expect(await fetchWorkshopWorkflows()).toEqual([]);
  });
});

describe("buildLibraryWorkflowInput 参考图随任务落库（ISSUE #4910）", () => {
  it("参考图清单进 GenerateInput.referenceImages（任务行 referenceImages 列与 params 的来源）", async () => {
    detailFullResult = {
      id: "wf-1",
      name: "minimax_h3",
      taskType: "I2I",
      defaultMode: null,
      availableModes: ["I2I"],
      workflowIO: null,
      paramMap: null,
      imageInputPorts: [],
    };
    const result = await buildLibraryWorkflowInput(
      "wf-1",
      {
        prompt: "Replace the girl in <Picture 1> with the boy in <Picture 2>",
        referenceImages: ["workshop-ref-aaa.png", "workshop-ref-bbb.png"],
      },
      "I2I",
      ["prompt", "reference-image", "reference-image-2"],
    );
    expect(result.input.referenceImages).toEqual(["workshop-ref-aaa.png", "workshop-ref-bbb.png"]);
  });

  it("没给参考图时不带 referenceImages 字段（与「没给就缺省」的入参口径一致）", async () => {
    detailFullResult = {
      id: "wf-1",
      name: "minimax_h3",
      taskType: "I2I",
      defaultMode: null,
      availableModes: ["I2I"],
      workflowIO: null,
      paramMap: null,
      imageInputPorts: [],
    };
    const result = await buildLibraryWorkflowInput("wf-1", { prompt: "x" }, "I2I", ["prompt"]);
    expect("referenceImages" in result.input).toBe(false);
  });
});
