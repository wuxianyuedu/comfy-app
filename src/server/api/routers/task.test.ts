import type * as LoggerModule from "~/lib/core/logger";
import type * as FsPromises from "node:fs/promises";
/**
 * task.router 集成测试。mock 边界：~/server/db（内存数据库替身）、~/server/better-auth、~/lib/core/logger（静音，同时给
 * 「失败必须有日志」硬规则留可断言句柄）、fs/promises（替换 `stat`/`rm` —— openFolder 的「目录存在」分支与 delete 的产物清理
 * 都不触真实磁盘，也不许往仓库 public/generated 写删）。repository 与限流中间件均走真实实现。
 */
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { statMock, rmMock } = vi.hoisted(() => ({
  statMock: vi.fn<(path: string) => Promise<unknown>>(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
  rmMock: vi.fn<(path: string, opts?: unknown) => Promise<void>>(() => Promise.resolve(undefined)),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
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
  seedWorkflowTemplate,
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

  it("视频不排在首位时 videoPath 仍指到那个文件（cover / mediaType 都答不了这一列）", async () => {
    /* 执行侧的落盘顺序是先 images 后 videos，而 `isCover` 取第一条 —— 于是一条
     * 视频任务的 `cover` 很可能是一张预览图、`mediaType` 也跟着判成 image。
     * 「这一行有没有可下载的视频」只有握着产出行数组的服务端答得了。 */
    seedTask(tdb, {
      id: "task-video",
      userId: "user-a",
      type: "VIDEO",
      images: [
        COVER("img-1", "/api/generated/task-video/img_0.png"),
        {
          ...COVER("img-2", "/api/generated/task-video/vid_0.mp4", "video"),
          isCover: false,
          sortIndex: 1,
        },
      ],
    });
    seedTask(tdb, {
      id: "task-img",
      userId: "user-a",
      type: "TXT2IMG",
      images: [COVER("img-3", "/api/generated/task-img/1.png")],
    });

    const res = await createCaller(makeCtx()).list({});
    const video = res.tasks.find((t) => t.id === "task-video")!;
    expect(video.cover).toBe("/api/generated/task-video/img_0.png");
    expect(video.mediaType).toBe("image");
    expect(video.videoPath).toBe("/api/generated/task-video/vid_0.mp4");
    /* 没有视频产出行 → null（不是缺键、也不是空串），客户端据此判「没有可下载的」。 */
    expect(res.tasks.find((t) => t.id === "task-img")!.videoPath).toBeNull();
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

  it("分页：hasMore 随页推进、两页不重不漏（#4594）", async () => {
    /* 回归现场：此前 scanOnce 只取 PAGE 行，`rows.length > PAGE` 恒假 ⇒ hasMore 恒 false，
     * 历史列表翻不过第一页；且 relational 分支把 offset 静默丢弃，第二页会重复第一页。
     * 9 条任务、每页 2 条：五页拼起来必须恰好覆盖全部 id（created 全异，排序确定），
     * hasMore 依次 true×4 → false（最后一页靠「多取一行」判完，不靠「行数不足」。 */
    for (let i = 0; i < 9; i += 1) {
      seedTask(tdb, { id: `task-${i}`, userId: "user-a", createdAt: new Date(9000 - i * 1000) });
    }
    const caller = createCaller(makeCtx());
    const seen: Array<string> = [];
    let cursor = 0;
    for (let page = 0; page < 5; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一页的 cursor 来自前一页
      const res = await caller.list({ take: 2, cursor });
      seen.push(...res.tasks.map((t) => t.id));
      const expectedHasMore = page < 4;
      expect(res.hasMore, `page${page + 1}`).toBe(expectedHasMore);
      cursor += res.tasks.length;
    }
    expect(seen).toEqual([
      "task-0",
      "task-1",
      "task-2",
      "task-3",
      "task-4",
      "task-5",
      "task-6",
      "task-7",
      "task-8",
    ]);
    expect(cursor).toBe(9);
  });

  it("media 过滤分页：cursor 是扫描前沿 nextScanCursor，翻页不重不漏（#4741）", async () => {
    /* 缺陷现场：服务端 cursor 是对全量任务的 SQL skip，客户端却按「过滤后
     * 命中数」推进 —— 后续页从已扫过的位置重扫，重复返回已见行（UI 靠 id
     * 去重掩盖，读放大）。服务端显式回传扫描前沿后，按它翻页必须不重不漏。 */
    for (let i = 0; i < 6; i += 1) {
      seedTask(tdb, {
        id: `task-${i}`,
        userId: "user-a",
        type: i % 2 === 0 ? "TXT2IMG" : "T2V",
        createdAt: new Date(9000 - i * 1000),
      });
    }
    const caller = createCaller(makeCtx());
    const seen: Array<string> = [];
    let cursor = 0;
    for (let page = 0; page < 4; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一页的 cursor 来自前一页
      const res = await caller.list({ take: 2, cursor, media: "video" });
      seen.push(...res.tasks.map((t) => t.id));
      cursor = res.nextScanCursor;
      if (!res.hasMore) {
        break;
      }
    }
    /* 3 条视频（task-1/3/5）按新到旧一页不重不漏；前沿推进到表尾 6。 */
    expect(seen).toEqual(["task-1", "task-3", "task-5"]);
    expect(cursor).toBe(6);
  });

  it("Zod 校验：take 越界 / 非法 media → BAD_REQUEST", async () => {
    const caller = createCaller(makeCtx());
    await expect(caller.list({ take: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.list({ take: 201 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.list({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 故意喂不在枚举里的值：zod 闸必须拦下（线上载荷可绕过编译期类型）
        media: "doc" as never,
      }),
    ).rejects.toMatchObject({
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
    /* SAFETY: 类型断言已复核 */
    expect((task.images as Array<Row>).map((i) => i.id)).toEqual(["img-1"]);
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

  it("返回工作流上挂的模型名（modelName，与 list 同口径；ISSUE #4855）", async () => {
    seedWorkflowTemplate(tdb, {
      id: "tpl-1",
      userId: "user-a",
      modelTags: [{ id: "tag-1", userId: "user-a", name: "minimax_h3" }],
    });
    seedTask(tdb, {
      id: "task-m",
      userId: "user-a",
      params: { workflow: "tpl-1" },
    });
    const task = await createCaller(makeCtx()).detail({ id: "task-m" });
    expect(task.modelName).toBe("minimax_h3");
  });

  it("没挂模型标签 / 模板引用缺失时 modelName 如实为 null（前端回落工作流名）", async () => {
    seedTask(tdb, {
      id: "task-n",
      userId: "user-a",
      params: { workflow: "tpl-missing" },
    });
    const task = await createCaller(makeCtx()).detail({ id: "task-n" });
    expect(task.modelName).toBeNull();
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
      createCaller(makeCtx({ user: { id: "user-b", email: "b@test.dev", name: null } })).cancel({
        id: "task-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = tdb.$tables.tasks.find((t) => t.id === "task-1")!;
    expect(row.status).toBe("RUNNING");
  });
});

// ─────────────────────────────── cancelAll (#5064) ───────────────────────────────

describe("task.cancelAll", () => {
  it("只取消当前用户的非终态任务：终态与他人行原样不动，计数如实", async () => {
    seedTask(tdb, { id: "mine-queued", userId: "user-a", status: "QUEUED" });
    seedTask(tdb, { id: "mine-running", userId: "user-a", status: "RUNNING" });
    seedTask(tdb, { id: "mine-done", userId: "user-a", status: "SUCCEEDED" });
    seedTask(tdb, { id: "others-queued", userId: "user-b", status: "QUEUED" });

    const res = await createCaller(makeCtx()).cancelAll();
    expect(res).toEqual({ cancelled: 2, failed: 0, total: 2 });

    const status = (id: string) => tdb.$tables.tasks.find((t) => t.id === id)!.status;
    expect(status("mine-queued")).toBe("CANCELLED");
    expect(status("mine-running")).toBe("CANCELLED");
    expect(status("mine-done")).toBe("SUCCEEDED");
    expect(status("others-queued")).toBe("QUEUED");
  });

  it("重复点幂等：第二轮候选为空，不重复记取消", async () => {
    seedTask(tdb, { id: "t1", userId: "user-a", status: "QUEUED" });
    const caller = createCaller(makeCtx());
    expect((await caller.cancelAll()).cancelled).toBe(1);
    expect(await caller.cancelAll()).toEqual({ cancelled: 0, failed: 0, total: 0 });
  });

  it("空队列返回三个 0，不发任何取消", async () => {
    expect(await createCaller(makeCtx()).cancelAll()).toEqual({
      cancelled: 0,
      failed: 0,
      total: 0,
    });
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
    const snap = vi.spyOn(taskRepository, "findSnapshotById").mockResolvedValue(null);
    await expect(createCaller(makeCtx()).workflow({ id: "task-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
    await expect(createCaller(makeCtx()).openFolder({ id: "task-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("目录不存在 → { opened: false, reason: '该任务尚未生成文件目录' }", async () => {
    seedTask(tdb, { id: "task-1", userId: "user-a", projectId: "proj-1" });
    const res = await createCaller(makeCtx()).openFolder({ id: "task-1" });
    expect(res.opened).toBe(false);
    expect(res.reason).toBe("该任务尚未生成文件目录");
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
    await expect(createCaller(makeCtx()).openFolder({ id: "task-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
    expect(rmMock).toHaveBeenCalledWith(path.resolve(generatedRoot(), "task-1"), {
      recursive: true,
      force: true,
    });
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
    await expect(createCaller(makeCtx()).delete({ id: "task-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      await expect(caller.delete({ id: "task-a" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    await expect(caller.delete({ id: "task-a" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  }, 30_000);
});
