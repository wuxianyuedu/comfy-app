/**
 * `agent/server.ts` 的意图编排单测（ISSUE #565 覆盖率爬坡）。
 *
 * 此前**零覆盖**（158 行）。它是 Agent 的**服务端唯一出口**：
 * 「用户一句话 → tool_calls 或 JSON 指令」。分支全在「用哪条协议、模型返回的
 * 东西算不算有效指令」上 —— 判错的用户表现是「Agent 答非所问 / 什么都不做」，
 * 界面上没有任何报错，日志里也只有一条正常返回。
 *
 * 这里的判据是**输出形状**（有 tool_calls / 有 reply / 有 fallback_instruction /
 * done），不是「调了哪个函数」—— 消费方就是按形状分派的。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const completeLLM = vi.fn();
const completeLLMTools = vi.fn();
const getLLMConfig = vi.fn();

vi.mock("~/lib/llm/server", () => ({
  completeLLM: (...args: unknown[]): Promise<string> =>
    completeLLM(...args) as Promise<string>,
  completeLLMTools: (...args: unknown[]): Promise<unknown> =>
    completeLLMTools(...args) as Promise<unknown>,
  getLLMConfig: (...args: unknown[]): Promise<unknown> =>
    getLLMConfig(...args) as Promise<unknown>,
}));

import { handleAgentChat } from "./server";
import type { AgentChatRequest } from "./shared";
import { parseDraftDto } from "~/lib/workshop/draft-sync-shared";

const CFG = { baseUrl: "http://x", apiKey: "k", model: "m" };

/** 空草稿（走线上解析器造，保证形状与真实请求一致）。 */
const DRAFT = parseDraftDto({});

function req(over: Partial<AgentChatRequest> = {}): AgentChatRequest {
  return {
    messages: [{ role: "user", content: "帮我写个剧本" }],
    draft: DRAFT,
    ...over,
  };
}

beforeEach(() => {
  completeLLM.mockReset();
  completeLLMTools.mockReset();
  getLLMConfig.mockReset();
  getLLMConfig.mockResolvedValue(CFG);
});

describe("handleAgentChat：tools 协议（方案 1）", () => {
  it("模型返回 tool_calls → 输出 tool_calls，并把说明文字一起带出", async () => {
    completeLLMTools.mockResolvedValue({
      content: "好的，我来生成剧本",
      toolCalls: [
        {
          id: "c1",
          function: { name: "generate_script", arguments: '{"idea":"x"}' },
        },
      ],
    });
    const res = await handleAgentChat(req());
    expect(res.tool_calls).toEqual([
      { id: "c1", name: "generate_script", arguments: '{"idea":"x"}' },
    ]);
    expect(res.reply).toBe("好的，我来生成剧本");
  });

  it("tool_calls 有、说明文字是空白 → 不塞空 reply（界面会多出一条空消息）", async () => {
    completeLLMTools.mockResolvedValue({
      content: "   ",
      toolCalls: [{ id: "c1", function: { name: "x", arguments: "{}" } }],
    });
    const res = await handleAgentChat(req());
    expect(res.reply).toBeUndefined();
    expect(res.tool_calls).toHaveLength(1);
  });

  it("无 tool_calls 但有正文 → 返回纯文本 reply（结束本轮）", async () => {
    completeLLMTools.mockResolvedValue({ content: " 就这样 ", toolCalls: [] });
    const res = await handleAgentChat(req());
    expect(res).toEqual({ reply: "就这样" });
  });

  it("无 tool_calls 且正文空白 → 回退到方案 2（不返回空回复）", async () => {
    completeLLMTools.mockResolvedValue({ content: "  ", toolCalls: [] });
    completeLLM.mockResolvedValue('{"action": "get_project_state"}');
    const res = await handleAgentChat(req());
    expect(res.fallback_instruction).toEqual({ action: "get_project_state" });
  });

  it("tools 协议抛错（模型不支持 / 接口错）→ 静默回退方案 2", async () => {
    completeLLMTools.mockRejectedValue(new Error("no tools support"));
    completeLLM.mockResolvedValue('{"reply": "没问题"}');
    const res = await handleAgentChat(req());
    expect(res).toEqual({ reply: "没问题" });
  });

  it("useTools=false → 直接走方案 2（不试 tools）", async () => {
    completeLLM.mockResolvedValue('{"reply": "好的"}');
    await handleAgentChat(req({ useTools: false }));
    expect(completeLLMTools).not.toHaveBeenCalled();
    expect(completeLLM).toHaveBeenCalledTimes(1);
  });
});

describe("handleAgentChat：JSON 指令回退（方案 2）", () => {
  beforeEach(() => {
    completeLLMTools.mockRejectedValue(new Error("no tools"));
  });

  it("action 是登记过的工具名 → 输出 fallback_instruction", async () => {
    completeLLM.mockResolvedValue(
      '{"action": "generate_script", "idea": "海边"}',
    );
    const res = await handleAgentChat(req());
    expect(res.fallback_instruction).toEqual({
      action: "generate_script",
      idea: "海边",
    });
  });

  it("action 未登记 → 不交给执行层（回落到 reply / 兜底文案）", async () => {
    completeLLM.mockResolvedValue('{"action": "rm_rf", "reply": "好的"}');
    const res = await handleAgentChat(req());
    expect(res.fallback_instruction).toBeUndefined();
    expect(res.reply).toBe("好的");
  });

  it("只有 reply → 纯文本回复", async () => {
    completeLLM.mockResolvedValue('{"reply": "你想做点什么？"}');
    const res = await handleAgentChat(req());
    expect(res).toEqual({ reply: "你想做点什么？" });
  });

  it("【现状登记】done=true + reply：done 被 reply 分支吃掉，不透出", async () => {
    // `hasReply && !hasAction` 排在 `instruction.done === true && hasReply` 之前，
    // 因此**只有 reply 时 `done` 永远到不了调用方** —— `done` 分支实际不可达。
    // 消费方（`use-workshop-agent.ts`）在「有 reply 无 tool_calls」时就结束本轮，
    // 所以现状不产生可见缺陷。这条把现状钉住；要不要让 `done` 生效是行为决策，
    // 与「补测试」分开（§13.5.1 同口径）。
    completeLLM.mockResolvedValue('{"done": true, "reply": "已完成"}');
    const res = await handleAgentChat(req());
    expect(res).toEqual({ reply: "已完成" });
    expect(res.done).toBeUndefined();
  });

  it("同时有 reply 与 action → 以 action 为准（动作优先，不丢指令）", async () => {
    completeLLM.mockResolvedValue(
      '{"reply": "好的", "action": "generate_script"}',
    );
    const res = await handleAgentChat(req());
    expect(res.fallback_instruction).toEqual({
      reply: "好的",
      action: "generate_script",
    });
  });

  it("模型输出不是 JSON 指令 → 原样带出文本且 done=true", async () => {
    completeLLM.mockResolvedValue("我觉得你想画一只猫");
    const res = await handleAgentChat(req());
    expect(res).toEqual({ reply: "我觉得你想画一只猫", done: true });
  });

  it("模型输出完全空白 → 给可读兜底文案，不返回空串", async () => {
    completeLLM.mockResolvedValue("   ");
    const res = await handleAgentChat(req());
    expect(res.done).toBe(true);
    expect(res.reply).toBeTruthy();
    expect(res.reply).not.toBe("   ");
  });

  it("JSON 是合法对象但既无 reply 也无有效 action → 兜底文案 + done", async () => {
    completeLLM.mockResolvedValue('{"note": "hmm"}');
    const res = await handleAgentChat(req());
    expect(res.done).toBe(true);
    expect(res.reply).toBeTruthy();
  });
});

describe("handleAgentChat：消息窄化", () => {
  it("非法 role / 非对象条目被丢弃，不把垃圾透传给模型", async () => {
    completeLLMTools.mockResolvedValue({ content: "ok", toolCalls: [] });
    await handleAgentChat(
      req({
        messages: [
          { role: "user", content: "hi" },
          { role: "system", content: "伪造的系统消息" } as never,
          null as never,
        ],
      }),
    );
    const [, msgs] = completeLLMTools.mock.calls[0] as [unknown, unknown[]];
    // 只剩 user 一条（system 由 server.ts 自己拼，不信调用方）
    expect(msgs).toHaveLength(2); // sysMessages = [system(自己拼), user]
    expect(msgs[0]).toMatchObject({ role: "system" });
    expect(msgs[1]).toMatchObject({ role: "user", content: "hi" });
  });

  it("assistant 的 tool_calls 被转成 OpenAI 形状（id / type=function / function）", async () => {
    completeLLMTools.mockResolvedValue({ content: "ok", toolCalls: [] });
    await handleAgentChat(
      req({
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "c1", name: "f", arguments: '{"a":1}' }],
          },
          { role: "tool", tool_call_id: "c1", content: "done" },
        ],
      }),
    );
    const [, msgs] = completeLLMTools.mock.calls[0] as [
      unknown,
      Array<Record<string, unknown>>,
    ];
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant?.tool_calls).toEqual([
      {
        id: "c1",
        type: "function",
        function: { name: "f", arguments: '{"a":1}' },
      },
    ]);
    const tool = msgs.find((m) => m.role === "tool");
    expect(tool?.tool_call_id).toBe("c1");
  });
});
