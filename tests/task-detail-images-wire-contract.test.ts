/**
 * `task.detail` 的 `images` ↔ 客户端镜像的线上契约（台账 E4 的第二格）。
 *
 * 这一格修之前长什么样：`src/lib/media/task-images-client.ts` 用一处
 * `as unknown as RawTaskImage[]` 把服务端返回的图片行**当**成本地那个手写 `type`。
 * 手写 type 在运行时不存在，所以没有任何东西知道「客户端读了哪几列」——
 * 服务端把 `localPath` 改名、或那一份关系装载换列时：tsc 绿、eslint 绿、
 * 那份只 `vi.mock("~/trpc/vanilla")` 返回固定对象的单测也绿，而表现是
 * **相册永远空**（`parseTaskImageRows` 把每一行都判成不合法而丢掉），
 * 与 E4 第一格（`task.list` 的 `videoPath` 恒 `undefined`、下载按钮一次都没出现过）同形。
 *
 * 所以这份用例钉四件事：
 *   ① 镜像声明的每一列，服务端真实发出的行里都在（方向是镜像 → 线上，就是漏掉的那一维）；
 *   ② 反向：线上发的列**不**全在镜像里（镜像是收窄，不是逐字复制 —— 断了这一条，
 *      ①会被一份「把整行列全抄进镜像」的实现无痛满足）；
 *   ③ `fetchTaskImages` 的返回值来自**真 router 经一次 JSON 传输**，而排序是服务端给的
 *      （`isCover desc, sortIndex asc`）—— 客户端不重排，视图的第一张才是封面；
 *   ④ 反向验证：把那一列改名，红的必须是「相册空了 + 契约缺列」这种看得见的结论。
 *
 * mock 边界与第一格逐字同一份：只换传输层（`~/trpc/vanilla`）与 `~/server/db`（内存库）、
 * `~/server/better-auth`（会话）、`~/lib/core/logger`（静音）。router、仓储、关系装载
 * 全走真实实现 —— 契约测试的价值恰恰在「真的把两边接起来跑一次」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";

import {
  fetchTaskImages,
  parseTaskImageRows,
  taskImageRowSchema,
} from "~/lib/media/task-images-client";
import { createCallerFactory } from "~/server/api/trpc";
import { taskRouter } from "~/server/api/routers/task";
import { getTestDb, seedTask, seedUser, type Row } from "./helpers/test-db";
import { makeCtx } from "./helpers/trpc";
import { missingFromWire, throughJsonWire } from "./helpers/wire-contract";

const { detailMock } = vi.hoisted(() => ({
  detailMock: vi.fn<(input: { id: string }) => Promise<unknown>>(async () => ({})),
}));

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: { task: { detail: { query: detailMock } } },
}));
vi.mock("~/server/db", async () => {
  const { dbMockBoundary } = await import("./helpers/wire-mock-boundary");
  return dbMockBoundary();
});
vi.mock("~/server/better-auth", async () => {
  const { sessionMockBoundary } = await import("./helpers/wire-mock-boundary");
  return sessionMockBoundary();
});
vi.mock("~/lib/core/logger", async (importOriginal) => {
  const { loggerMockBoundary } = await import("./helpers/wire-mock-boundary");
  return loggerMockBoundary(await importOriginal<typeof LoggerModule>());
});

const tdb = getTestDb();
const createCaller = createCallerFactory(taskRouter);

const TASK_ID = "task-gallery";
const root = `/api/generated/${TASK_ID}`;

/** 一行产物图：默认非封面、`sortIndex` 由调用点给（服务端按它排）。 */
function image(id: string, localPath: string, over: Partial<Row> = {}): Row {
  return {
    id,
    localPath,
    mediaType: "image",
    seed: null,
    width: 512,
    height: 512,
    isCover: false,
    sortIndex: 0,
    ...over,
  };
}

/** 真 handler 的返回过一次传输再取 `images`（少了这一步测的是进程内传对象）。 */
async function wireImages(id = TASK_ID): Promise<Array<Record<string, unknown>>> {
  const row = await createCaller(makeCtx()).detail({ id });
  return throughJsonWire<{ images: Array<Record<string, unknown>> }>(row).images;
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  /* 三张图，**故意按倒序种**：封面最后种、排序最前 —— 若客户端或服务端有一侧
   * 悄悄重排，下面的顺序断言就会把它照出来。 */
  seedTask(tdb, {
    id: TASK_ID,
    userId: "user-a",
    type: "TXT2IMG",
    status: "SUCCEEDED",
    prompt: "出三张图",
    createdAt: new Date(2000),
    images: [
      image("img-third", `${root}/img_2.png`, { sortIndex: 2, isCover: false }),
      image("img-cover", `${root}/img_0.png`, { isCover: true }),
      image("img-second", `${root}/img_1.png`, { sortIndex: 1 }),
    ],
  });
  /* 客户端的取数接到真 router 上：以下所有 fetchTaskImages 都真的走一遍关系装载。 */
  detailMock.mockImplementation(async ({ id }) => {
    const row = await createCaller(makeCtx()).detail({ id });
    return throughJsonWire(row);
  });
});

describe("task.detail 的 images ↔ 客户端镜像", () => {
  it("镜像声明的每一列线上都在发（少一列就是契约分叉）", async () => {
    const rows = await wireImages();
    expect(rows.length).toBe(3);
    const wireKeys = Object.keys(rows[0]!);
    expect(
      missingFromWire(taskImageRowSchema.shape, wireKeys),
      `线上没发出这些列，而镜像声明了它们：${JSON.stringify(wireKeys)}`,
    ).toEqual([]);
  });

  it("反向：线上发的列并不全在镜像里（镜像是收窄，不是逐字复制）", async () => {
    const rows = await wireImages();
    const mirrored = new Set(Object.keys(taskImageRowSchema.shape));
    const unmirrored = Object.keys(rows[0]!).filter((k) => !mirrored.has(k));
    /* `taskId` / `mediaType` / `sortIndex` 视图一个都不读 —— 断它们**在**线上、
     * 却**不在**镜像里，才能挡住「把整行列抄进镜像」那种把上面那条判据喂绿的写法。 */
    expect(unmirrored).toContain("taskId");
    expect(unmirrored).toContain("mediaType");
    expect(unmirrored).toContain("sortIndex");
  });

  it("经真 handler 与一次传输之后，第一张是封面且顺序由服务端给", async () => {
    const got = await fetchTaskImages(TASK_ID);
    expect(got.map((img) => img.id)).toEqual(["img-cover", "img-second", "img-third"]);
    expect(got[0]).toEqual({
      id: "img-cover",
      localPath: `${root}/img_0.png`,
      isCover: true,
    });
    /* 非封面的两张必须是 false，而不是缺键或 null —— 视图按它选首图。 */
    expect(got.slice(1).every((img) => img.isCover === false)).toBe(true);
  });

  it("列改名这一形必须当场照出来：缺列 + 空相册，两个都是看得见的结论", async () => {
    /* 反向验证：把 `localPath` 换成 `path`（列漂移最常见的形态）。这一份数据上
     * 两半边都要红 —— 只断「空列表」的话，一份「镜像根本不含 localPath」的实现
     * 也能满足它；所以缺列那一半单独判。 */
    const drifted = (await wireImages()).map(({ localPath, ...rest }) => ({
      ...rest,
      path: localPath,
    }));
    expect(missingFromWire(taskImageRowSchema.shape, Object.keys(drifted[0]!))).toEqual([
      "localPath",
    ]);
    expect(parseTaskImageRows(drifted)).toEqual([]);
  });

  it("真实装载给的是关系行而不是任务表的 JSON 列（这一条钉住那份口径的来源）", async () => {
    /* 仓储走的是 `db.query.task.findFirst({ with: { images: … } })`，`task` 表本身
     * 没有 images 列。这一点值得钉：视图侧那句「形状不可信所以整行丢弃」的理由
     * 只在「列可能被改名/少发」这一层成立，而不是「读出来是一段自由格式的 JSON」——
     * 拿后一句当理由，下一个人就会把这里改成整包 `JSON.parse` 并放松窄化。 */
    const rows = await wireImages();
    const task = throughJsonWire<Record<string, unknown>>(
      await createCaller(makeCtx()).detail({ id: TASK_ID }),
    );
    expect(Array.isArray(task.images)).toBe(true);
    /* `taskId` 是关系那一侧才有的列（JSON 列里不会平白多出一个外键）。 */
    expect(rows[0]).toHaveProperty("taskId", TASK_ID);
  });

  it("另一个任务来问：拿到的必须是它自己的那几行（空相册不许串到上一条的图）", async () => {
    seedTask(tdb, {
      id: "task-empty",
      userId: "user-a",
      status: "SUCCEEDED",
      prompt: "还没有产物",
      createdAt: new Date(3000),
    });
    expect(await fetchTaskImages("task-empty")).toEqual([]);
    expect((await wireImages("task-empty")).length).toBe(0);
    /* 上一条没被污染：仍然三张。 */
    expect((await fetchTaskImages(TASK_ID)).map((i) => i.id)).toContain("img-cover");
  });
});
