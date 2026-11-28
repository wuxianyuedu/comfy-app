/** MCP 侧合同编译器测试：纯 Node 出口下的有界重试与结果字段。 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getConfig: vi.fn(() => Promise.resolve({ model: "test", baseUrl: "http://x", maxTokens: 100 })),
}));

vi.mock("~/server/workshop/llm", () => ({
  completeWorkshopLLM: mocks.complete,
  getWorkshopLLMConfig: mocks.getConfig,
}));

import { mcpCompileContract } from "~/server/codefilm/mcp-compile";

const VALID = {
  meta: { title: "打斗", fps: 24 },
  layout: [{ id: "hero", kind: "character", position: { x: 0, y: 0 } }],
  shots: [
    {
      id: "s1",
      index: 0,
      description: "抬头",
      duration: 1,
      characterIds: ["hero"],
      actionBeats: [{ t: 0, actorId: "hero", action: "抬头" }],
    },
  ],
  timeline: { totalFrames: 24, shots: [{ shotId: "s1", startFrame: 0, endFrame: 24 }] },
};

describe("codefilm / MCP 编译器", () => {
  it("首次成功返回合同", async () => {
    mocks.complete.mockResolvedValueOnce(JSON.stringify(VALID));
    const result = await mcpCompileContract("剧本", { title: "打斗" });
    expect(result.attempts).toBe(1);
    expect(result.contract?.shots).toHaveLength(1);
  });

  it("QA 失败不抛错，返回 issues 与错误说明", async () => {
    const bad = { ...VALID, shots: [{ ...VALID.shots[0]!, characterIds: ["ghost"] }] };
    mocks.complete.mockResolvedValue(JSON.stringify(bad));
    const result = await mcpCompileContract("剧本");
    expect(result.attempts).toBe(3);
    expect(result.contract).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.issues?.length).toBeGreaterThan(0);
  });

  it("LLM 非 JSON 输出走有界重试且返回结果错误", async () => {
    mocks.complete.mockResolvedValue("不是 JSON");
    const result = await mcpCompileContract("剧本");
    expect(result.attempts).toBe(3);
    expect(result.error).toBeTruthy();
  });
});
