import type * as LoggerModule from "~/lib/core/logger";
import type * as FsPromises from "node:fs/promises";
/**
 * task.router 集成测试。
 *
 * mock 边界：~/server/db（内存 Prisma 替身）、~/server/better-auth、
 * ~/lib/core/logger（静音，同时给「失败必须有日志」那条硬规则留一个可断言的句柄）、
 * fs/promises（替换 `stat` 与 `rm` —— openFolder 的「目录存在」分支与 delete 的
 * 产物清理都不再触真实磁盘，用例也不许往仓库的 public/generated 里写删）。
 * repository 与限流中间件均走真实实现。
 */
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { statMock, rmMock } = vi.hoisted(() => ({
  statMock: vi.fn<(path: string) => Promise<unknown>>(async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
  rmMock: vi.fn<(path: string, opts?: unknown) => Promise<void>>(
    async () => undefined,
  ),
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
  rm: rmMock,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { taskRouter } from "~/server/api/routers/task";
import { taskRepository } from "~/lib/core/repository";
import { logger } from "~/lib/core/logger";
import { generatedRoot } from "~/lib/media/output-paths";
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
        {
          ...COVER("img-2", "/generated/task-video/2.mp4", "video"),
          isCover: false,
          sortIndex: 1,
        },
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
    await expect(caller.list({ take: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.list({ take: 201 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.list({ media: "doc" as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
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

  it("不存在 / 他人任务 → 同一个 NOT_FOUND（不给探测 id 用）", async () => {
    seedTask(tdb, { id: "task-b", userId: "user-b" });
    const caller = createCaller(makeCtx());
    await expect(caller.detail({ id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.detail({ id: "task-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ──────────────────────────────────── cancel ────────────────────────────────────

describe("task.cancel", () => {
  it("置为 CANCELLED 并写 finishedAt", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", status: "RUNNING" });
    expect(await createCaller(makeCtx()).cancel({ id: "task-1" })).toEqual({
      ok: true,
    });
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
      workflowSnapshot: {
        workflow: { nodes: [] },
        source: "canvas",
        capturedAt: "t0",
      },
    });
    const res = await createCaller(makeCtx()).workflow({ id: "task-1" });
    expect(res).toEqual({
      workflow: { nodes: [] },
      source: "canvas",
      capturedAt: "t0",
    });
  });

  it("两次查询之间那一行没了 → 仍回 NOT_FOUND（防御分支不是死码）", async () => {
    // `workflow` 先按 `findByIdWithImages` 判归属、再按 `findSnapshotById` 取快照。
    // 两查之间被删（并发删除 / 库被换）时，第二条查不到必须走**同一个 404**，
    // 而不是把 undefined 往下传成一次 500。
    seedTask(tdb, { id: "task-1", userId: "user-a" });
    const snap = vi
      .spyOn(taskRepository, "findSnapshotById")
      .mockResolvedValue(null);
    await expect(
      createCaller(makeCtx()).workflow({ id: "task-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    snap.mockRestore();
  });

  it("快照为 null → 全 null；任务不存在 → 抛错", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", workflowSnapshot: null });
    const caller = createCaller(makeCtx());
    expect(await caller.workflow({ id: "task-1" })).toEqual({
      workflow: null,
      source: null,
      capturedAt: null,
    });
    await expect(caller.workflow({ id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("他人任务 → NOT_FOUND（台账 A2：快照里是整份工作流，越权读等于抄走别人的图）", async () => {
    seedTask(tdb, {
      id: "task-b",
      userId: "user-b",
      workflowSnapshot: {
        workflow: { nodes: [{ type: "KSampler" }] },
        source: "canvas",
        capturedAt: "t0",
      },
    });
    const caller = createCaller(
      makeCtx({ user: { id: "user-a", email: "a@test.dev", name: null } }),
    );
    await expect(caller.workflow({ id: "task-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // 不存在的 id 走同一条出口：越权与「查不到」不可区分，不给探测 id 用
    await expect(caller.workflow({ id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─────────────────────────────────── openFolder ───────────────────────────────────

describe("task.openFolder", () => {
  it("projectId 路径穿越 → FORBIDDEN（目录白名单）", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", projectId: "../../evil" });
    await expect(
      createCaller(makeCtx()).openFolder({ id: "task-1" }),
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
      createCaller(makeCtx()).openFolder({ id: "task-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ───────────────────────────────── delete（限流） ─────────────────────────────────

describe("task.delete（rateLimitedProcedure）", () => {
  it("删除自己的任务：产物目录整体删掉、行被移除", async () => {
    seedTask(tdb, {
      id: "task-1",
      userId: "user-a",
      images: [COVER("img-1", "/api/generated/task-1/1.png")],
    });
    expect(await createCaller(makeCtx()).delete({ id: "task-1" })).toEqual({
      ok: true,
    });
    expect(rmMock).toHaveBeenCalledWith(
      path.resolve(generatedRoot(), "task-1"),
      { recursive: true, force: true },
    );
    expect(tdb.$tables.tasks.find((t) => t.id === "task-1")).toBeUndefined();
  });

  it("项目任务的产物目录按 projects/<pid>/<tid> 删（与落盘侧同一布局，台账 A8）", async () => {
    /* 旧写法在这里只拼 `public/generated/<taskId>`，而 executor-finalize 对
     * 项目任务落的是 `projects/<pid>/<tid>` —— 「在画布里删任务」于是永远删不到
     * 目录，磁盘单调增长，且失败被 .catch 吞掉、日志里一个字都没有。 */
    seedTask(tdb, { id: "task-1", userId: "user-a", projectId: "proj-1" });
    await createCaller(makeCtx()).delete({ id: "task-1" });
    expect(rmMock).toHaveBeenCalledWith(
      path.resolve(generatedRoot(), "projects", "proj-1", "task-1"),
      { recursive: true, force: true },
    );
  });

  it("id 形状越界 → 不动磁盘、只删库行，并把原因落日志（台账 A8 的另一半）", async () => {
    /* 落库的 id 正常是服务端 cuid，这里故意 seed 一行穿越形状的 id：
     * 判据不许依赖「上游生成不了坏形状」这一条口头保证 —— `fs.rm(..., recursive)`
     * 拿到根外路径就是整目录级别的破坏。 */
    const evil = path.join("..", "..", "outside");
    seedTask(tdb, { id: evil, userId: "user-a" });
    expect(await createCaller(makeCtx()).delete({ id: evil })).toEqual({
      ok: true,
    });
    expect(rmMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("越界"));
    expect(tdb.$tables.tasks.find((t) => t.id === evil)).toBeUndefined();
  });

  it("磁盘删不掉不阻塞删库，但失败原因必须可见（硬规则 4）", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a" });
    rmMock.mockRejectedValueOnce(new Error("EBUSY: resource busy"));
    expect(await createCaller(makeCtx()).delete({ id: "task-1" })).toEqual({
      ok: true,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("EBUSY"));
    expect(tdb.$tables.tasks.find((t) => t.id === "task-1")).toBeUndefined();
  });

  it("他人任务 → NOT_FOUND", async () => {
    seedTask(tdb, { id: "task-b", userId: "user-b" });
    await expect(
      createCaller(makeCtx()).delete({ id: "task-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(rmMock).not.toHaveBeenCalled();
  });

  // 21 次串行调用叠加 timingMiddleware 的 dev 随机延迟，放宽本用例超时
  it("限流：同用户 10s 窗口内第 21 次调用 → TOO_MANY_REQUESTS", async () => {
    seedTask(tdb, { id: "task-a", userId: "user-a" });
    const caller = createCaller(
      makeCtx({ user: { id: "user-b", email: "b@test.dev", name: null } }),
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
  }, 30_000);
});
