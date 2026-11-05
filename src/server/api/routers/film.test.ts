/**
 * film.router 闸门用例（⑨ 第二刀）：归属看似齐（四个取片口走 `findByIdForUser`），但「查不到」写裸 `Error` ——
 * tRPC 归成 500，越权与不存在不同形（台账 A2/A3/A12），正常业务分支污染错误率与 Sentry；用例按应有契约写。
 * 拒绝必须先于副作用：`start`/`compose`/`cancel` 起任务、烧 ffmpeg、改库，断言编排一次未被调用。mock：db（内存库 + 真 Drizzle，按 userId 过滤）、better-auth、logger、编排记账替身。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orchestrator, composeFilm, ffmpegAvailable } = vi.hoisted(() => ({
  orchestrator: {
    createFilm: vi.fn((_args: Record<string, unknown>) => ({
      id: "film-new",
      shots: [],
    })),
    createFilmFromProject: vi.fn((_args: Record<string, unknown>) => ({
      id: "film-from-proj",
      shots: [],
    })),
    startFilm: vi.fn((_id: string) => undefined),
  },
  composeFilm: vi.fn((_id: string) => undefined),
  ffmpegAvailable: vi.fn(() => true),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/server/film/orchestrator", () => ({
  createFilm: orchestrator.createFilm,
  createFilmFromProject: orchestrator.createFilmFromProject,
  startFilm: orchestrator.startFilm,
}));
vi.mock("~/server/film/compose-film", () => ({
  composeFilm,
  isFFmpegAvailable: ffmpegAvailable,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { FILM_COMPOSE_SIZE } from "~/lib/film/film-size";
import { filmRouter } from "~/server/api/routers/film";
import { filmRepository } from "~/lib/core/repository";
import {
  getTestDb,
  seedFilm,
  seedProject,
  seedUser,
  type TestDb,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(filmRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

/** tRPC 抛出的错误码（裸 Error 会变成 INTERNAL_SERVER_ERROR，正是要照出来的那一档）。 */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- rejection 值是外部抛出的任意值，回调参数按 { code? } 标窄，`?.` 是运行期防线
    (error: { code?: string }) => error?.code ?? "UNKNOWN",
  );
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  seedFilm(tdb, { id: "film-a", userId: "user-a", title: "我的成片" });
  seedFilm(tdb, { id: "film-b", userId: "user-b", title: "别人的成片" });
});

describe("film.list —— 读侧归属", () => {
  it("只返回自己的成片，并带上 ffmpeg 可用性", async () => {
    const res = await caller().list();
    expect(res.films.map((f) => f.id)).toEqual(["film-a"]);
    expect(res.ffmpegAvailable).toBe(true);
  });
});

describe("film.detail —— 别人的 id 与不存在同形", () => {
  it("自己的成片 → 连镜头一起返回", async () => {
    const res = await caller().detail({ id: "film-a" });
    expect(res.film.id).toBe("film-a");
  });

  it("别人的成片 → NOT_FOUND（不是 500，也不透露「这行存在」）", async () => {
    await expect(caller().detail({ id: "film-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("不存在的 id → 与越权同一个码、同一句话", async () => {
    const foreign = await codeOf(caller().detail({ id: "film-b" }));
    const missing = await codeOf(caller().detail({ id: "没有这张片" }));
    expect(foreign).toBe(missing);
  });
});

describe("film.cancel / start / compose —— 拒绝必须发生在副作用之前", () => {
  it("别人的成片：markCancelled 与编排层一次都没被调用", async () => {
    const mark = vi.spyOn(filmRepository, "markCancelled");
    const res = codeOf(caller().cancel({ id: "film-b" }));
    expect(await res).toBe("NOT_FOUND");
    expect(mark).not.toHaveBeenCalled();
    mark.mockRestore();
  });

  it("自己的成片：取消真的落到仓储", async () => {
    const mark = vi.spyOn(filmRepository, "markCancelled").mockResolvedValue(undefined);
    await expect(caller().cancel({ id: "film-a" })).resolves.toEqual({
      ok: true,
    });
    expect(mark).toHaveBeenCalledWith("film-a");
    mark.mockRestore();
  });

  it("别人的成片：不启动编排（不烧 GPU、不改状态）", async () => {
    expect(await codeOf(caller().start({ id: "film-b" }))).toBe("NOT_FOUND");
    expect(orchestrator.startFilm).not.toHaveBeenCalled();
  });

  it("自己的成片：按 id 交给编排层（路由不自己拼参数）", async () => {
    await caller().start({ id: "film-a" });
    expect(orchestrator.startFilm).toHaveBeenCalledWith("film-a");
  });

  it("别人的成片：不合成（ffmpeg 一次都不碰）", async () => {
    expect(await codeOf(caller().compose({ id: "film-b" }))).toBe("NOT_FOUND");
    expect(composeFilm).not.toHaveBeenCalled();
  });

  it("自己的成片：合成编排被调用一次", async () => {
    await caller().compose({ id: "film-a" });
    expect(composeFilm).toHaveBeenCalledTimes(1);
    expect(composeFilm).toHaveBeenCalledWith("film-a");
  });
});

describe("film.create / createFromProject —— 上下文只能来自会话", () => {
  it("建片把会话里的 userId 传给编排层（不能以自己的身份建到别人名下）", async () => {
    await caller().create({
      title: "新片",
      script: "一段剧本",
      type: "short_video",
    });
    expect(orchestrator.createFilm).toHaveBeenCalledTimes(1);
    expect(orchestrator.createFilm.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-a",
      title: "新片",
    });
  });

  it("没给画幅时透传 `FILM_COMPOSE_SIZE` 那份常量，不在路由里硬编码尺寸", async () => {
    await caller().create({ title: "T", script: "S", type: "short_video" });
    expect(orchestrator.createFilm.mock.calls[0]?.[0]?.size).toBe(FILM_COMPOSE_SIZE);
  });

  it("从项目建片同样只传会话用户；项目归属判定在编排层（orchestrator.test.ts 已判）", async () => {
    seedProject(tdb, { id: "proj-a", userId: "user-a", name: "我的画布" });
    await caller().createFromProject({ projectId: "proj-a" });
    expect(orchestrator.createFilmFromProject.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-a",
      projectId: "proj-a",
    });
  });

  it("标题超 200 字 / 空剧本 → BAD_REQUEST（不落到编排层）", async () => {
    expect(
      await codeOf(
        caller().create({
          title: "x".repeat(201),
          script: "S",
          type: "short_video",
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(await codeOf(caller().create({ title: "T", script: "", type: "short_video" }))).toBe(
      "BAD_REQUEST",
    );
    expect(orchestrator.createFilm).not.toHaveBeenCalled();
  });
});
