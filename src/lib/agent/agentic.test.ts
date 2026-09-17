/**
 * `agentic.ts` 的多轮引导判决面单测（ISSUE #565 覆盖率爬坡）。
 *
 * 这个模块此前 `src/lib/agent/agentic.ts` **零覆盖**，而它恰恰是「模糊想法 →
 * 结构化生成参数」这条用户路径的**唯一入口**：`chatAgent` 在没有配置 LLM 时
 * 走离线状态机，用户看到的是「它到底有没有在按我说的做」。
 *
 * 钉住的都是异常路径 —— 用户只在出错时看到它们，而出错时的表现是
 * 「问了一句废话 / 方案参数是空的 / 模型答了但界面卡住」，没有任何报错。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatAgent, expandIdea } from "./agentic";

/** 造一个 fetch 返回。 */
function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatAgent：LLM 路径", () => {
  it("ready=true + spec → 返回归一化后的方案（缺字段补默认，非法 kind 归 image）", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: JSON.stringify({
              ready: true,
              reply: "已为你整理好方案。",
              spec: {
                prompt: "一只猫",
                kind: "weird",
                params: { steps: "12" },
              },
            }),
          }),
          { status: 200 },
        ),
    );
    const res = await chatAgent([{ role: "user", content: "画只猫" }]);
    expect(res.ready).toBe(true);
    expect(res.reply).toBe("已为你整理好方案。");
    expect(res.spec?.prompt).toBe("一只猫");
    // 非法 kind 不静默透传，归为 image
    expect(res.spec?.kind).toBe("image");
    // 字符串 steps 不是数字 → 丢弃（宁缺勿错，避免把 "12" 写进参数）
    expect(res.spec?.params?.steps).toBeUndefined();
    expect(res.spec?.params?.size).toBeUndefined();
  });

  it("ready=true 但缺 spec → 不当作完成，返回 reply 且 ready=false", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: JSON.stringify({ ready: true, reply: "好了" }),
          }),
          { status: 200 },
        ),
    );
    const res = await chatAgent([{ role: "user", content: "x" }]);
    expect(res.ready).toBe(false);
    expect(res.reply).toBe("好了");
  });

  it("OpenAI 风格的 choices[0].message.content 也能解析", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"ready": false, "reply": "几秒？"}' } },
            ],
          }),
          { status: 200 },
        ),
    );
    const res = await chatAgent([{ role: "user", content: "视频" }]);
    expect(res.ready).toBe(false);
    expect(res.reply).toBe("几秒？");
  });

  it("没有 JSON 的纯文本回复 → 原样带出，ready=false", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ content: "你说啥？" }), { status: 200 }),
    );
    const res = await chatAgent([{ role: "user", content: "x" }]);
    expect(res).toEqual({ reply: "你说啥？", ready: false });
  });

  it("空回复 → 给可见占位，不返回空串（界面会看起来卡住）", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ content: "" }), { status: 200 }),
    );
    const res = await chatAgent([{ role: "user", content: "x" }]);
    expect(res.reply).toBe("（无回复）");
    expect(res.ready).toBe(false);
  });

  it("非 2xx → 回落到离线状态机（首个问题）", async () => {
    mockFetch(() => new Response("boom", { status: 502 }));
    const res = await chatAgent([]);
    expect(res.ready).toBe(false);
    expect(res.reply).toContain("图片");
  });

  it("fetch 抛错（断网）→ 回落到离线状态机", async () => {
    mockFetch(() => Promise.reject(new Error("network down")));
    const res = await chatAgent([{ role: "user", content: "画只猫" }]);
    expect(res.ready).toBe(false);
    expect(res.reply).toContain("图片");
  });

  it("JSON 畸形（`{` 后无合法 JSON）→ 落到文本分支而不是抛错", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ content: "{这不是 JSON" }), {
          status: 200,
        }),
    );
    await expect(
      chatAgent([{ role: "user", content: "x" }]),
    ).resolves.toBeDefined();
  });
});

describe("chatAgent：离线状态机（未配置 LLM 时的兜底）", () => {
  it("空历史 → 问类型", async () => {
    mockFetch(() => Promise.reject(new Error("no llm")));
    const res = await chatAgent([]);
    expect(res.ready).toBe(false);
    expect(res.reply).toContain("图片");
    expect(res.reply).toContain("视频");
  });

  it("未指明类型 → 再问一次类型（不猜）", async () => {
    mockFetch(() => Promise.reject(new Error("no llm")));
    const res = await chatAgent([{ role: "user", content: "随便画点什么" }]);
    expect(res.ready).toBe(false);
    expect(res.spec).toBeUndefined();
  });

  it("指了类型但信息不足 → 追问风格 / 尺寸，不给方案", async () => {
    mockFetch(() => Promise.reject(new Error("no llm")));
    const res = await chatAgent([{ role: "user", content: "生成一张图片" }]);
    expect(res.ready).toBe(false);
    expect(res.reply).toContain("风格");
  });

  it("视频：第二轮追问的是时长而不是尺寸", async () => {
    mockFetch(() => Promise.reject(new Error("no llm")));
    const res = await chatAgent([{ role: "user", content: "做个视频" }]);
    expect(res.reply).toContain("几秒");
  });

  it("两轮都有类型信息 → 出方案，图片参数与视频参数按 kind 分叉", async () => {
    mockFetch(() => Promise.reject(new Error("no llm")));
    const img = await chatAgent([
      { role: "user", content: "生成一张图片" },
      { role: "assistant", content: "什么风格？" },
      { role: "user", content: "写实风格" },
    ]);
    expect(img.ready).toBe(true);
    expect(img.spec?.kind).toBe("image");
    expect(img.spec?.params?.size).toBe("1024x1024");
    expect(img.spec?.params?.cfg).toBe(7);
    expect(img.spec?.prompt).toContain("写实风格");

    const vid = await chatAgent([
      { role: "user", content: "做个视频" },
      { role: "user", content: "5 秒" },
    ]);
    expect(vid.ready).toBe(true);
    expect(vid.spec?.kind).toBe("video");
    // 视频场景不能拿图片场景的 1k —— 尺寸与 cfg 都按视频折算
    expect(vid.spec?.params?.size).toBe("832x480");
    expect(vid.spec?.params?.cfg).toBe(6);
  });

  it("assistant 消息不参与类型判定（只读 user）", async () => {
    mockFetch(() => Promise.reject(new Error("no llm")));
    const res = await chatAgent([
      { role: "assistant", content: "要视频还是图片？" },
    ]);
    // 没有 user 消息 → 回到首个问题
    expect(res.reply).toContain("图片");
  });
});

describe("expandIdea：单轮展开", () => {
  it("LLM 给了 spec 就用它", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content:
              '{"ready": true, "spec": {"prompt": "海边", "kind": "image"}}',
          }),
          { status: 200 },
        ),
    );
    const spec = await expandIdea("海边");
    expect(spec.prompt).toBe("海边");
  });

  it("没有 spec（模型没整理出来）→ 用离线兜底方案，不返回空提示词", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ content: "再想想" }), { status: 200 }),
    );
    const spec = await expandIdea("  落日  ");
    expect(spec.prompt).toContain("落日");
    expect(spec.prompt.trim()).not.toBe("");
    expect(spec.kind).toBe("image");
  });
});
