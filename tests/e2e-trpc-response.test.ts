/**
 * `e2e/support/trpc-response.ts` 的解包 + 错误块识别判据（ISSUE #4325）。
 *
 * 错误块形状来自**真实失败响应取证**（2026-11-18 本地起 dev server，发空入参的
 * `project.upsert` mutation，HTTP 200 + 两行 JSONL；原始响应落盘在
 * `.git/evidence/trpc-error-block-4325.jsonl`，gitignored）。这里的夹具保留取证形状
 * （`error.message` / `error.code=-32600` / `data.code=BAD_REQUEST` / `data.path`），
 * 去掉无关的 stack 字段 —— 判据只依赖前四者。
 *
 * 回归点：旧 `trpcCall` 只解成功块，把 `{error:{…}}` 当过程返回值漏到下游断言，
 * #4274 现场红在两条之后的 `project.list`（Received: undefined），真因（入参 zod
 * 校验失败）被吞。现在错误块当场抛带过程名的错，e2e 红在真实失败点上。
 */
import { describe, expect, it } from "vitest";

import { trpcJsonlBody } from "../e2e/support/trpc-stub";
import { unwrapTrpcJsonl } from "../e2e/support/trpc-response";

const PROCEDURE = "project.upsert";

/** 取证响应里的错误块（形状逐字来自真实响应，stack 省略）。 */
const capturedError = {
  message:
    '[\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "projectId"\n    ],\n    "message": "Invalid input: expected string, received undefined"\n  }\n]',
  code: -32_600,
  data: { code: "BAD_REQUEST", httpStatus: 400, path: PROCEDURE },
};

/** 把捕获的未知异常收窄成 Error 并取其 message（不用断言，类型感知门禁要求）。 */
function errorMessage(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  throw new Error(`期望捕获 Error，实际拿到：${String(thrown)}`);
}

/** 按取证响应形状拼一段 JSONL：head + 最后一行 `[0,0,[[slot]]]`。 */
function errorBody(slot: unknown): string {
  const head = JSON.stringify({ json: { 0: [[0], [null, 0, 0]] } });
  const last = JSON.stringify({ json: [0, 0, [[slot]]] });
  return `${head}\n${last}\n`;
}

describe("unwrapTrpcJsonl：错误块识别（ISSUE #4325 取证形状）", () => {
  it("真实取证形状的错误块 ⇒ 抛错，且带过程名、过程名(data.path)、code 与 zod 错误信息", () => {
    const body = errorBody({ error: capturedError });
    let thrown: unknown;
    try {
      unwrapTrpcJsonl(body, PROCEDURE);
    } catch (error) {
      thrown = error;
    }
    const message = errorMessage(thrown);
    // 调用方传的过程名 + 服务端回的过程名 + code + message 都在 —— 读者一眼定位真因。
    expect(message).toContain(PROCEDURE);
    expect(message).toContain("code=BAD_REQUEST");
    expect(message).toContain("Invalid input: expected string, received undefined");
    expect(message).toContain("tRPC 错误块");
  });

  it("错误 message 过长时截断，避免 e2e 失败行被整段 zod 文档淹没", () => {
    const long = { ...capturedError, message: "X".repeat(2000) };
    let thrown: unknown;
    try {
      unwrapTrpcJsonl(errorBody({ error: long }), PROCEDURE);
    } catch (error) {
      thrown = error;
    }
    const message = errorMessage(thrown);
    expect(message.length).toBeLessThan(700);
    expect(message).toContain("X".repeat(400));
  });

  it("业务返回值里恰好有 `error` 字段但不是错误块（code 不是数字）⇒ 正常解包，不误判", () => {
    const business = { error: "none", value: 42 };
    expect(unwrapTrpcJsonl(errorBody(business), PROCEDURE)).toEqual(business);
  });
});

describe("unwrapTrpcJsonl：成功路径与畸形响应", () => {
  it("成功块逐字等价旧逻辑：真桩产出的 JSONL 能解出过程返回值", () => {
    const value = { files: [{ name: "a.log", size: 3 }], total: 1 };
    // 用真桩产出协议（不是手搓 json[2]），保证解包层与 e2e 实际响应同源。
    const body = trpcJsonlBody([value]);
    expect(unwrapTrpcJsonl(body, "logs.list")).toEqual(value);
  });

  it("空响应体 ⇒ 抛清楚错，不静默返回 undefined", () => {
    expect(() => unwrapTrpcJsonl("", PROCEDURE)).toThrow(/空响应体/);
    expect(() => unwrapTrpcJsonl("\n\n", PROCEDURE)).toThrow(/空响应体/);
  });

  it("最后一行不是合法 JSON / 信封形状不对 ⇒ 抛清楚错，不静默 undefined", () => {
    expect(() => unwrapTrpcJsonl("head\nnot-json", PROCEDURE)).toThrow(/不是合法 JSON/);
    // 合法 JSON 但不是 `{json: …}` 信封 —— 旧版在这里静默返回 undefined。
    expect(() => unwrapTrpcJsonl('{"nope":1}', PROCEDURE)).toThrow(/json\[2\]/);
  });
});
