/**
 * `task.list` 线上契约 ↔ 前端镜像（住 tests/ 因要 import 真实 router，而 `src/lib/**` 不得依赖 `src/server/**`）。坏过的形状：
 * 镜像声明线上从不发的列（交叉类型 `RouterOutputs[...] & { images?: … }` 只**加**列）⇒ 产物路径恒 undefined、`video` 恒 `null`，
 * 表现只是占位图标/下载按钮从不出现而各静态门槛全绿。故钉：① 镜像每列都在真实行里；② `video` 经真 router+JSON 成立；③ 少发一列整行判掉。mock 只换传输层/db/会话/logger。
 */
import type * as LoggerModule from "~/lib/core/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { historyTaskRowSchema } from "~/lib/project-canvas/history-panel-client";
import { createCallerFactory } from "~/server/api/trpc";
import { taskRouter } from "~/server/api/routers/task";
import { missingFromWire, throughJsonWire } from "./helpers/wire-contract";
import { getTestDb, seedTask, seedUser, type Row } from "./helpers/test-db";
import { makeCtx } from "./helpers/trpc";
import {
  fetchVideoTasks,
  parseVideoRows,
  videoTaskRowSchema,
} from "~/lib/media/video-queue-client";

const { queryMock, mutateMock } = vi.hoisted(() => ({
  queryMock: vi.fn<(input: { take?: number }) => Promise<unknown>>(() =>
    Promise.resolve({ tasks: [] }),
  ),
  mutateMock: vi.fn<(input: unknown) => Promise<unknown>>(() =>
    Promise.resolve({
      taskId: "gen-1",
    }),
  ),
}));

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    task: { list: { query: queryMock } },
    generate: { generate: { mutate: mutateMock } },
  },
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

const VIDEO_TASK_ID = "task-video";
const IMAGE_TASK_ID = "task-img";
const VIDEO_PATH = `/api/generated/${VIDEO_TASK_ID}/vid_0.mp4`;
const COVER_PATH = `/api/generated/${VIDEO_TASK_ID}/img_0.png`;

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

/** 走一次 JSON 序列化 —— 浏览器拿到的就是这个（Date 变字符串、undefined 键消失）。
 *  少了这一步，测的是「进程内传对象」，而线上是「传文本」。实现住在
 *  `./helpers/wire-contract`（第二份契约判据动手时抽的，不在调用点重抄）。 */
async function wireRows(
  input: { take?: number } = { take: 200 },
): Promise<Array<Record<string, unknown>>> {
  const rows = await createCaller(makeCtx()).list(input);
  const viaWire = throughJsonWire<{ tasks: Array<Record<string, unknown>> }>(rows);
  return viaWire.tasks;
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  /* 一条视频任务：预览图排在首位（`isCover` 就是它），mp4 排在第二位 ——
   * 这正是执行侧的落盘顺序（先 images 后 videos）。 */
  seedTask(tdb, {
    id: VIDEO_TASK_ID,
    userId: "user-a",
    type: "VIDEO",
    status: "SUCCEEDED",
    prompt: "让镜头慢慢推进",
    workflowName: "t2v-animated",
    createdAt: new Date(2000),
    images: [
      COVER("img-cover", COVER_PATH),
      {
        ...COVER("img-video", VIDEO_PATH, "video"),
        isCover: false,
        sortIndex: 1,
      },
    ],
  });
  seedTask(tdb, {
    id: IMAGE_TASK_ID,
    userId: "user-a",
    type: "TXT2IMG",
    status: "SUCCEEDED",
    prompt: "一张图",
    createdAt: new Date(1000),
    images: [COVER("img-only", `/api/generated/${IMAGE_TASK_ID}/img_0.png`)],
  });
  /* 客户端的取数被接到真 router 上：本模块以下所有 fetch 都真的走一遍投影。 */
  queryMock.mockImplementation(async (input) => ({
    tasks: await wireRows(input),
  }));
});

describe("task.list 的列名 ↔ 两份前端镜像", () => {
  it("镜像声明的每一列线上都在发（镜像比线上多一列就是契约分叉）", async () => {
    const rows = await wireRows();
    expect(rows.length).toBeGreaterThan(0);
    const wireKeys = Object.keys(rows[0]!);
    expect(missingFromWire(videoTaskRowSchema.shape, wireKeys)).toEqual([]);
    expect(missingFromWire(historyTaskRowSchema.shape, wireKeys)).toEqual([]);
  });

  it("反向：线上发的列并不全在镜像里（镜像是收窄，不是逐字复制）", async () => {
    const rows = await wireRows();
    const mirrored = new Set(Object.keys(videoTaskRowSchema.shape));
    const unmirrored = Object.keys(rows[0]!).filter((key) => !mirrored.has(key));
    expect(unmirrored).toContain("cover");
    expect(unmirrored).toContain("mediaType");
  });
});

describe("视频落点这一列只有服务端答得了", () => {
  it("封面是预览图时，cover / mediaType 都答不出视频在哪，videoPath 答得出", async () => {
    const [videoRow] = await wireRows();
    expect(videoRow?.id).toBe(VIDEO_TASK_ID);
    expect(videoRow?.cover).toBe(COVER_PATH);
    expect(videoRow?.mediaType).toBe("image");
    expect(videoRow?.videoPath).toBe(VIDEO_PATH);
  });

  it("没有视频产出行的任务 → videoPath 为 null（不是缺键、也不是空串）", async () => {
    const rows = await wireRows();
    const imageRow = rows.find((row) => row.id === IMAGE_TASK_ID);
    expect(imageRow).toMatchObject({ videoPath: null });
  });
});

describe("fetchVideoTasks（真 router → 传输 → 客户端）", () => {
  it("视图拿到的 video 就是库里那行 mp4 的地址", async () => {
    const got = await fetchVideoTasks();
    expect(got).toEqual([
      {
        id: VIDEO_TASK_ID,
        status: "SUCCEEDED",
        prompt: "让镜头慢慢推进",
        workflowName: "t2v-animated",
        video: VIDEO_PATH,
        error: null,
      },
    ]);
  });

  it("只列 VIDEO 类任务，图片任务不进这张表", async () => {
    const got = await fetchVideoTasks();
    expect(got.map((task) => task.id)).toEqual([VIDEO_TASK_ID]);
    expect(queryMock).toHaveBeenCalledWith({ take: 200 });
  });

  it("线上少发 videoPath → 整行被判掉，而不是退化成「每个任务都没有视频」", async () => {
    /* 反向验证（§11.2.1「反向验证是判据精确性的证据」）：摘掉判据的一侧，红的必须是「列表空了」这种
     * 看得见的结论。若这里读到的是 `video: null`，契约分叉就又一次静默通过。 */
    const rows = await wireRows();
    const stripped = rows.map((row) => {
      const copy = { ...row };
      delete copy.videoPath;
      return copy;
    });
    expect(parseVideoRows(stripped)).toEqual([]);
  });

  it("行缺合法 id（非法形状）→ 丢弃那一行，而不是把 undefined 硬塞给视图", async () => {
    const rows = await wireRows();
    const videoRow = rows.find((row) => row.id === VIDEO_TASK_ID)!;
    /* 同一条任务再来一份「id 是数字」的：它必须被丢掉，而合法那行照常留下 ——
     * 只断「少了一行」不够，还要断留下的是哪一行（否则丢错人也绿）。 */
    const broken = { ...videoRow, id: 42 };
    expect(parseVideoRows([broken, videoRow])).toEqual([
      {
        id: VIDEO_TASK_ID,
        status: "SUCCEEDED",
        prompt: "让镜头慢慢推进",
        workflowName: "t2v-animated",
        video: VIDEO_PATH,
        error: null,
      },
    ]);
  });

  it("响应不是数组 → 空列表（不抛，视图据此显示空态）", () => {
    expect(parseVideoRows(null)).toEqual([]);
    expect(parseVideoRows({ tasks: [] })).toEqual([]);
  });
});

describe("parseVideoRows 的缺省口径", () => {
  it("prompt / workflowName 缺省补空串、error 缺省补 null（视图可直接 .trim()）", () => {
    const [row] = parseVideoRows([{ id: "t1", type: "VIDEO", status: "QUEUED", videoPath: null }]);
    expect(row).toEqual({
      id: "t1",
      status: "QUEUED",
      prompt: "",
      workflowName: "",
      video: null,
      error: null,
    });
  });
});

/**
 * 「submitGeneration」随「批量提交」页签整格撤掉而退役（ISSUE #2169，2026-10-25 业主拍板）：它是那条从未
 * 成功过的通路的客户端出口（每条草稿缺必填 workflow，#2159 之后在本地就被拒），唯一消费者是 VideoQueueModal
 * 草稿页签，页签撤掉后成零消费导出，一并移除；判据本体（generateInputSchema 必填列）仍在 workflow-generate-input。
 */
