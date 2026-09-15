import type * as LoggerModule from "~/lib/core/logger";
import type * as FsPromises from "fs/promises";
/**
 * task.router 集成测试。
 *
 * mock 边界：~/server/db（内存 Prisma 替身）、~/server/better-auth、
 * ~/lib/core/logger（静音）、fs/promises（仅替换 stat——openFolder 的
 * 「目录存在」分支不再触真实磁盘；unlink/rm 保持真实实现，路径不存在时
 * 被 .catch 吞掉，无副作用）。repository 与限流中间件均走真实实现。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { statMock } = vi.hoisted(() => ({
  statMock: vi.fn<(path: string) => Promise<unknown>>(async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  stat: statMock,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { taskRouter } from "~/server/api/routers/task";
import {
  getTestDb,
  seedUser,
  seedTask,
  type Row,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(taskRouter);
const tdb = getTestDb();

const COVER = (id: string, localPath: string, mediaType = "image"): Row => ({
  id,
  localPath,
  mediaType,
  seed: "42",
  width: 512,
  height: 512,
  isCover: true,
  sortIndex: 0,
});

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

// ───────────────────────────────────── list ─────────────────────────────────────

describe("task.list", () => {
  it("空库返回空列表", async () => {
    const res = await createCaller(makeCtx()).list({});
    expect(res.tasks).toEqual([]);
  });

  it("返回封面/进度/checkpoint 投影，mediaType 按封面与 taskType 推断，createdAt 倒序", async () => {
    seedTask(tdb, {
      id: "task-img",
      userId: "user-a",
      type: "TXT2IMG",
      status: "COMPLETED",
      params: { checkpoint: "sdxl.safetensors", seed: 42 },
      images: [COVER("img-1", "/generated/task-img/1.png")],
      progress: 1,
      createdAt: new Date(2000),
    });
    seedTask(tdb, {
      id: "task-video",
      userId: "user-a",
      type: "T2V",
      status: "RUNNING",
      images: [
        { ...COVER("img-2", "/generated/task-video/2.mp4", "video"), isCover: false, sortIndex: 1 },
      ],
      error: null,
      createdAt: new Date(1000),
    });

    const res = await createCaller(makeCtx()).list({});
    expect(res.tasks.map((t) => t.id)).toEqual(["task-img", "task-video"]);
    const img = res.tasks[0]!;
    expect(img.cover).toBe("/generated/task-img/1.png");
    expect(img.checkpoint).toBe("sdxl.safetensors");
    expect(img.mediaType).toBe("image");
    expect(img.progress).toBe(1);
    expect(img.error).toBeNull();
    expect(res.tasks[1]!.mediaType).toBe("video"); // taskType "T2V" → /2V$/ 兜底
  });

  it("media 过滤只保留对应类型", async () => {
    seedTask(tdb, { id: "task-img", userId: "user-a", type: "TXT2IMG" });
    seedTask(tdb, { id: "task-video", userId: "user-a", type: "T2V" });
    const res = await createCaller(makeCtx()).list({ media: "video" });
    expect(res.tasks.map((t) => t.id)).toEqual(["task-video"]);
  });

  it("status 过滤（逗号分隔 → 大写化 in 查询）", async () => {
    seedTask(tdb, { id: "task-done", userId: "user-a", status: "COMPLETED" });
    seedTask(tdb, { id: "task-run", userId: "user-a", status: "RUNNING" });
    const res = await createCaller(makeCtx()).list({ status: "completed" });
    expect(res.tasks.map((t) => t.id)).toEqual(["task-done"]);
  });

  it("projectId 过滤", async () => {
    seedTask(tdb, { id: "task-in", userId: "user-a", projectId: "proj-1" });
    seedTask(tdb, { id: "task-out", userId: "user-a", projectId: "proj-2" });
    const res = await createCaller(makeCtx()).list({ projectId: "proj-1" });
    expect(res.tasks.map((t) => t.id)).toEqual(["task-in"]);
  });

  it("Zod 校验：take 越界 / 非法 media → BAD_REQUEST", async () => {
    const caller = createCaller(makeCtx());
    await expect(caller.list({ take: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.list({ take: 201 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.list({ media: "doc" as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ──────────────────────────────────── detail ────────────────────────────────────

describe("task.detail", () => {
  it("返回自己的任务（含全部产出图）", async () => {
    seedTask(tdb, {
      id: "task-1",
      userId: "user-a",
      images: [COVER("img-1", "/generated/task-1/1.png")],
    });
    const task = await createCaller(makeCtx()).detail({ id: "task-1" });
    expect(task.id).toBe("task-1");
    expect((task.images as Row[]).map((i) => i.id)).toEqual(["img-1"]);
  });

  it("不存在 / 他人任务 → 抛 'Task not found'", async () => {
    seedTask(tdb, { id: "task-b", userId: "user-b" });
    const caller = createCaller(makeCtx());
    await expect(caller.detail({ id: "nope" })).rejects.toThrow("Task not found");
    await expect(caller.detail({ id: "task-b" })).rejects.toThrow("Task not found");
  });
});

// ──────────────────────────────────── cancel ────────────────────────────────────

describe("task.cancel", () => {
  it("置为 CANCELLED 并写 finishedAt", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", status: "RUNNING" });
    expect(await createCaller(makeCtx()).cancel({ id: "task-1" })).toEqual({ ok: true });
    const row = tdb.$tables.tasks.find((t) => t.id === "task-1")!;
    expect(row.status).toBe("CANCELLED");
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  it("越权:非归属者取消他人任务抛 NOT_FOUND 且任务不受影响", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", status: "RUNNING" });
    await expect(
      createCaller(
        makeCtx({ user: { id: "user-b", email: "b@test.dev", name: null } }),
      ).cancel({ id: "task-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = tdb.$tables.tasks.find((t) => t.id === "task-1")!;
    expect(row.status).toBe("RUNNING");
  });
});

// ─────────────────────────────── workflow snapshot ───────────────────────────────

describe("task.workflow", () => {
  it("返回快照字段", async () => {
    seedTask(tdb, {
      id: "task-1",
      userId: "user-a",
      workflowSnapshot: { workflow: { nodes: [] }, source: "canvas", capturedAt: "t0" },
    });
    const res = await createCaller(makeCtx()).workflow({ id: "task-1" });
    expect(res).toEqual({
      workflow: { nodes: [] },
      source: "canvas",
      capturedAt: "t0",
    });
  });

  it("快照为 null → 全 null；任务不存在 → 抛错", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", workflowSnapshot: null });
    const caller = createCaller(makeCtx());
    expect(await caller.workflow({ id: "task-1" })).toEqual({
      workflow: null,
      source: null,
      capturedAt: null,
    });
    await expect(caller.workflow({ id: "nope" })).rejects.toThrow("Task not found");
  });
});

// ─────────────────────────────────── openFolder ───────────────────────────────────

describe("task.openFolder", () => {
  it("projectId 路径穿越 → FORBIDDEN（目录白名单）", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", projectId: "../../evil" });
    await expect(
      createCaller(makeCtx()).openFolder({ id: "task-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("目录不存在 → { opened: false, error: 'directory missing' }", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", projectId: "proj-1" });
    const res = await createCaller(makeCtx()).openFolder({ id: "task-1" });
    expect(res.opened).toBe(false);
    expect(res.error).toBe("directory missing");
    expect(res.absolutePath).toContain("projects");
  });

  it("目录存在（stat mock）→ { opened: true, comfyappUrl }", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", projectId: "proj-1" });
    statMock.mockResolvedValueOnce({ isDirectory: () => true });
    const res = await createCaller(makeCtx()).openFolder({ id: "task-1" });
    expect(res.opened).toBe(true);
    expect(res.comfyappUrl).toMatch(/^comfyapp:\/\/open\?path=/);
  });

  it("他人任务 → NOT_FOUND", async () => {
    seedTask(tdb, { id: "task-b", userId: "user-b" });
    await expect(
      createCaller(makeCtx()).openFolder({ id: "task-b" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ───────────────────────────────── delete（限流） ─────────────────────────────────

describe("task.delete（rateLimitedProcedure）", () => {
  it("删除自己的任务：连产物清理一起触发，行被移除", async () => {
    seedTask(tdb, {
      id: "task-1",
      userId: "user-a",
      images: [COVER("img-1", "/nonexistent/task-1/1.png")],
    });
    expect(await createCaller(makeCtx()).delete({ id: "task-1" })).toEqual({ ok: true });
    expect(tdb.$tables.tasks.find((t) => t.id === "task-1")).toBeUndefined();
  });

  it("他人任务 → NOT_FOUND", async () => {
    seedTask(tdb, { id: "task-b", userId: "user-b" });
    await expect(
      createCaller(makeCtx()).delete({ id: "task-b" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 21 次串行调用叠加 timingMiddleware 的 dev 随机延迟，放宽本用例超时
  it(
    "限流：同用户 10s 窗口内第 21 次调用 → TOO_MANY_REQUESTS",
    async () => {
      seedTask(tdb, { id: "task-a", userId: "user-a" });
      const caller = createCaller(
        makeCtx({ user: { id: "user-b", email: "b@test.dev", name: null } })
      );
      // 前 20 次：命中 NOT_FOUND 分支（同时消耗限流配额）
      for (let i = 0; i < 20; i++) {
        await expect(caller.delete({ id: "task-a" })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      }
      await expect(caller.delete({ id: "task-a" })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    },
    30_000
  );
});
