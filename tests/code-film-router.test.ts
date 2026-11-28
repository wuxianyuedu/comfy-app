/**
 * `codeFilm` router 的执行者测试（E3 挂载即欠执行者）+ wire 入参判据。
 * 三个 procedure 都真调用一次：非法合同走 BAD_REQUEST 且带字段路径，合法合同
 * 经 JSON wire 往返后仍能编译 / 校验 / 预览 —— 防止客户端拼错合同形状到服务端才炸。
 */
import { describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";
import type * as AppRuntimeLogModule from "~/lib/log/app-runtime-log";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/log/app-runtime-log", async (importOriginal) => ({
  ...(await importOriginal<typeof AppRuntimeLogModule>()),
  createAppRuntimeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { codeFilmRouter } from "~/server/api/routers/code-film";
import { errorEnvelope, makeCtx } from "./helpers/trpc";
import { throughJsonWire } from "./helpers/wire-contract";

const caller = createCallerFactory(codeFilmRouter)(makeCtx());

/** 一份最小合法合同（一镜，帧数自洽）。 */
const CONTRACT = {
  meta: { title: "一镜", fps: 24 },
  layout: [{ id: "hero", kind: "character", position: { x: 0, y: 0 } }],
  shots: [
    {
      id: "s1",
      index: 0,
      description: "抬头",
      duration: 2,
      characterIds: ["hero"],
      actionBeats: [{ t: 0, actorId: "hero", action: "抬头" }],
    },
  ],
  timeline: {
    totalFrames: 48,
    shots: [{ shotId: "s1", startFrame: 0, endFrame: 48 }],
  },
  qaRules: { maxShots: 8, maxFrames: 500 },
};

describe("codeFilm router / 执行者", () => {
  it("compile：合法合同经 wire 往返后编译成功并补出默认值", async () => {
    const result = await caller.compile(throughJsonWire(CONTRACT));
    expect(result.contract.renderBackend).toBe("comfy");
    expect(result.contract.shots[0]?.shotType).toBe("medium");
  });

  it("validate：合法合同零问题", async () => {
    const report = await caller.validate(throughJsonWire(CONTRACT));
    expect(report).toEqual({ ok: true, issues: [] });
  });

  it("toShots：给出镜头与运行入参", async () => {
    const result = await caller.toShots({ contract: CONTRACT, fps: 12 });
    expect(result.shots).toHaveLength(1);
    expect(result.runs[0]?.values.frames).toBe(24);
  });

  it("非法合同：compile 抛 BAD_REQUEST 且带字段路径", async () => {
    const bad = { ...CONTRACT, shots: [{ ...CONTRACT.shots[0], shotType: "bad" }] };
    const err = await errorEnvelope(caller.compile(bad));
    expect(err?.code).toBe("BAD_REQUEST");
    expect(err?.message).toContain("shotType");
  });

  it("toShots：QA 不通过的合同被拒绝而非静默产出", async () => {
    const bad = {
      ...CONTRACT,
      shots: [{ ...CONTRACT.shots[0], characterIds: ["ghost"] }],
    };
    const err = await errorEnvelope(caller.toShots({ contract: bad }));
    expect(err?.code).toBe("BAD_REQUEST");
    expect(err?.message).toContain("静态 QA");
  });
});
