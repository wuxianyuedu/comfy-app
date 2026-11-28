/** 编译器行为测试：LLM 产出合同 → 校验 → QA 不通过时带路径重试（有界）。 */
import { describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getConfig: vi.fn(() => Promise.resolve({ model: "test" })),
}));

vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/llm/server", () => ({
  completeLLMStructured: mocks.complete,
  getLLMConfig: mocks.getConfig,
}));

import { isRecord } from "~/lib/is-record";
import { compileContract } from "~/lib/codefilm/contract-compiler.server";

/** 一份最小合法合同原文。 */
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

describe("codefilm / compiler", () => {
  it("首次产出即通过时只调一次 LLM", async () => {
    mocks.complete.mockResolvedValueOnce(VALID);
    const result = await compileContract({ scriptMarkdown: "剧本" });
    expect(result.attempts).toBe(1);
    expect(result.contract.shots).toHaveLength(1);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it("QA 失败后重试并带上错误路径", async () => {
    const bad = {
      ...VALID,
      shots: [{ ...VALID.shots[0]!, characterIds: ["ghost"] }],
    };
    mocks.complete.mockResolvedValueOnce(bad).mockResolvedValueOnce(VALID);
    const result = await compileContract({ scriptMarkdown: "剧本" });
    expect(result.attempts).toBe(2);
    const secondCallArgs: unknown = mocks.complete.mock.calls[1]?.[1];
    const messages: Array<unknown> = Array.isArray(secondCallArgs) ? secondCallArgs : [];
    const userMessage = messages[1];
    expect(
      isRecord(userMessage) && typeof userMessage.content === "string" ? userMessage.content : "",
    ).toContain("characterIds[0]");
  });

  it("三次都失败时有界终止并抛出错误原因", async () => {
    const bad = {
      ...VALID,
      shots: [{ ...VALID.shots[0]!, characterIds: ["ghost"] }],
    };
    mocks.complete.mockResolvedValue(bad);
    const err = await compileContract({ scriptMarkdown: "剧本" }).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(Error);
    expect(isRecord(err) && typeof err.message === "string" ? err.message : "").toContain(
      "3 次尝试",
    );
    expect(mocks.complete).toHaveBeenCalledTimes(3);
  });
});
