// Film Studio 编排的**判决面**测试（ISSUE #572：`film/**` 此前 7.5% 覆盖）。
//
// 这个模块 656 行、全是「拉起生成 → 轮询 → 收口 → 合成」的编排，覆盖率长期只有
// 个位数。但其中真正会出错、且出错后**用户只看到一句「失败」**的，是三类判决：
//
//   1. `cancelFilm`：取消时哪些镜头要撤、什么状态该落 —— 少撤一个就是「点了取消，
//      任务还在跑并写进历史」；
//   2. `composeFilm`：没有 ffmpeg / 没有可用镜头时的出口必须落 FAILED 且带可行动
//      文案 —— 否则影片永远停在「合成中」；
//   3. `createFilm`：镜头参数（帧数 / 帧率 / 尺寸）与画幅的折算 —— 写错的表现是
//      「出来的片子和设置不一样」，而没有任何报错。
//
// 编排的 IO 全部经注入点桩掉（仓储 / 任务队列 / LLM / ffmpeg），因此这些判决可以
// 直接断言，不必起真 ComfyUI、不必真的调 ffmpeg。

import { describe, expect, it, vi, beforeEach } from "vitest";

/* ── 仓储与依赖桩 ─────────────────────────────────────────── */
/* 桩一律用 `vi.fn<(…)=>…>()` 显式声明签名：默认的 `vi.fn()` 推断成 `(...args: never[])`，
 * 于是「给 mock 塞入参」「读 mock.calls[0]」两侧都通不过 tsc（零 any 口径下不许断言绕过）。 */
const filmRepo = vi.hoisted(() => ({
  findById: vi.fn<(id: string) => Promise<unknown>>(),
  markComposing: vi.fn(async (_id: string) => undefined),
  markFailed: vi.fn(async (_id: string, _detail?: string) => undefined),
  markCancelled: vi.fn(async (_id: string) => undefined),
  markDone: vi.fn(async (_id: string, _path: string) => undefined),
  updateProgress: vi.fn(async (_id: string, _progress: number) => undefined),
  markGenerating: vi.fn(async (_id: string) => undefined),
  create: vi.fn<(input: { size: string }) => Promise<{ id: string }>>(),
  appendLog: vi.fn(
    async (_id: string, _entry: { level: string; msg: string }) => undefined,
  ),
}));
type ShotRow = { id: string; taskId: string | null };
type CreatedShot = {
  order: number;
  params: Record<string, unknown>;
  prompt: string;
};

const shotRepo = vi.hoisted(() => ({
  createMany: vi.fn<(filmId: string, shots: CreatedShot[]) => Promise<void>>(
    async () => undefined,
  ),
  listByFilm: vi.fn<() => Promise<unknown[]>>(async () => []),
  listActiveWithTask: vi.fn<() => Promise<ShotRow[]>>(async () => []),
  markAllActiveFailed: vi.fn(async (_filmId: string) => undefined),
  markQueued: vi.fn(async (_shotId: string, _taskId: string) => undefined),
  markFailed: vi.fn(async (_shotId: string) => undefined),
  updateFromTask: vi.fn(async (_shotId: string, _patch: unknown) => undefined),
}));
const taskRepo = vi.hoisted(() => ({
  createQueued: vi.fn(async (_input: unknown) => ({ id: "task-1" })),
  findExecutionProgress: vi.fn(async (_taskId: string) => null),
}));
const skillRepo = vi.hoisted(() => ({
  findBySlug: vi.fn(async (_slug: string) => null),
}));

vi.mock("~/lib/core/repository", () => ({
  filmRepository: filmRepo,
  filmShotRepository: shotRepo,
  skillRepository: skillRepo,
  taskRepository: taskRepo,
}));
vi.mock("~/lib/workshop/workflow-run.server", () => ({
  createWorkflowRunTask: vi.fn(async () => ({
    taskId: "task-1",
    workflowName: "wf",
    taskType: "T2V",
  })),
}));
const cancelTaskMock = vi.hoisted(() =>
  vi.fn(async (_taskId: string) => undefined),
);
const enqueueMock = vi.hoisted(() => vi.fn((_payload: unknown) => undefined));
vi.mock("~/lib/comfyui/enqueue", () => ({
  enqueue: enqueueMock,
  cancelTask: cancelTaskMock,
}));
vi.mock("~/lib/comfyui/firstframe", () => ({
  synthesizeFirstFrame: vi.fn(async () => "firstframe.png"),
}));
vi.mock("~/lib/workshop/script-parser", () => ({
  parseIdeaToScenes: vi.fn(() => []),
}));
const llmConfig = vi.hoisted(() => vi.fn(async () => ({})));
const llmStructured = vi.hoisted(() =>
  vi.fn<() => Promise<unknown[]>>(async () => []),
);
vi.mock("~/lib/llm/server", () => ({
  getLLMConfig: llmConfig,
  completeLLMStructured: llmStructured,
}));

/* ffmpeg：本模块**真的** spawn 子进程。编排判决不需要真 ffmpeg，因此把
 * `child_process.spawn` 桩成「立刻以 code 0 结束」的空进程。 */
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  spawn: vi.fn(() => ({
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") queueMicrotask(() => cb(0));
    }),
  })),
}));

import { cancelFilm, composeFilm, createFilm } from "./orchestrator";
import { NATIVE_SHOT_VIDEO_SIZE } from "~/lib/film/film-size";

beforeEach(() => {
  vi.clearAllMocks();
  shotRepo.listByFilm.mockResolvedValue([]);
  shotRepo.listActiveWithTask.mockResolvedValue([]);
  llmStructured.mockResolvedValue([]);
});

describe("cancelFilm — 取消要撤到任务层，不能只改界面状态", () => {
  it("影片不存在：什么都不做（幂等）", async () => {
    filmRepo.findById.mockResolvedValue(null);
    await cancelFilm("f-missing");
    expect(shotRepo.markAllActiveFailed).not.toHaveBeenCalled();
    expect(filmRepo.markCancelled).not.toHaveBeenCalled();
  });

  it("有活跃镜头：逐个撤任务 → 全部落失败 → 影片落取消", async () => {
    filmRepo.findById.mockResolvedValue({ id: "f1" });
    shotRepo.listActiveWithTask.mockResolvedValue([
      { id: "s1", taskId: "t1" },
      { id: "s2", taskId: null },
      { id: "s3", taskId: "t3" },
    ]);

    await cancelFilm("f1");

    // 只撤真的带 taskId 的镜头（null 的没有任务可撤）
    expect(cancelTaskMock.mock.calls.map((c) => c[0])).toEqual(["t1", "t3"]);
    expect(shotRepo.markAllActiveFailed).toHaveBeenCalledWith("f1");
    expect(filmRepo.markCancelled).toHaveBeenCalledWith("f1");
    expect(filmRepo.appendLog).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({ level: "warn", msg: "影片已取消" }),
    );
  });

  it("撤某个任务失败不影响其余镜头（取消必须走到收口）", async () => {
    filmRepo.findById.mockResolvedValue({ id: "f1" });
    shotRepo.listActiveWithTask.mockResolvedValue([
      { id: "s1", taskId: "t1" },
      { id: "s2", taskId: "t2" },
    ]);
    cancelTaskMock.mockRejectedValueOnce(new Error("boom"));

    await cancelFilm("f1");

    expect(cancelTaskMock).toHaveBeenCalledTimes(2);
    expect(filmRepo.markCancelled).toHaveBeenCalledWith("f1");
  });
});

describe("composeFilm — 合成前置条件不满足时必须落 FAILED 且文案可行动", () => {
  it("影片不存在 / 已在合成或已完成：直接返回，不重复合成", async () => {
    filmRepo.findById.mockResolvedValue(null);
    await composeFilm("f-missing");
    expect(filmRepo.markComposing).not.toHaveBeenCalled();

    filmRepo.findById.mockResolvedValue({ id: "f1", status: "DONE" });
    await composeFilm("f1");
    expect(filmRepo.markComposing).not.toHaveBeenCalled();
  });

  it("没有可用镜头：落 FAILED，且不去调 ffmpeg", async () => {
    filmRepo.findById.mockResolvedValue({
      id: "f1",
      status: "GENERATING",
      size: JSON.stringify({ ratio: "16:9 横屏", clarity: "1k", multiple: 64 }),
      fps: 16,
      framesPerShot: 49,
      subtitleOn: false,
      bgmName: null,
    });
    shotRepo.listByFilm.mockResolvedValue([]);

    await composeFilm("f1");

    expect(filmRepo.markFailed).toHaveBeenCalledWith(
      "f1",
      "没有可用的镜头视频",
    );
  });
});

describe("createFilm — 镜头参数与画幅的折算口径", () => {
  it("镜头 params 带工作流库 id 与尺寸表达（不再折算成 WxH 像素串）", async () => {
    filmRepo.create.mockResolvedValue({ id: "f-new" });
    llmStructured.mockResolvedValue([
      { heading: "场景1", action: "海边", dialogue: "", shotCount: 2 },
    ]);

    const r = await createFilm({
      userId: "u1",
      title: "测试片",
      script: "一个关于月球的故事",
      framesPerShot: 33,
      fps: 12,
      videoWorkflowId: "wf-video",
      imageWorkflowId: "wf-image",
    });

    expect(r.id).toBe("f-new");
    expect(r.shots).toBe(2);

    const [filmId, shots] = shotRepo.createMany.mock.calls[0]!;
    expect(filmId).toBe("f-new");
    expect(shots).toHaveLength(2);
    // 镜头侧：帧数 / 帧率 / 工作流库 id 写进 params，size 是尺寸表达
    for (const shot of shots) {
      expect(shot.params.frames).toBe(33);
      expect(shot.params.fps).toBe(12);
      expect(shot.params.videoWorkflowId).toBe("wf-video");
      expect(shot.params.imageWorkflowId).toBe("wf-image");
      expect(shot.params.size).toMatchObject({ ratio: "16:9 横屏" });
    }
    // 镜头顺序连续（order 从 0 起，收口时按它排序/上报进度）
    expect(shots.map((s) => s.order)).toEqual([0, 1]);
    // 影片侧存的是尺寸表达（JSON 文本），不是像素串
    const created = filmRepo.create.mock.calls[0]![0];
    expect(JSON.parse(created.size)).toHaveProperty("clarity");
  });

  it("LLM 不可用时回退到工坊分镜解析（离线也要能建片）", async () => {
    filmRepo.create.mockResolvedValue({ id: "f-offline" });
    llmStructured.mockRejectedValue(new Error("no llm"));
    const { parseIdeaToScenes } = await import("~/lib/workshop/script-parser");
    vi.mocked(parseIdeaToScenes).mockReturnValue([
      { heading: "离线场景", action: "动作", dialogue: "台词", shotCount: 1 },
    ] as unknown as ReturnType<typeof parseIdeaToScenes>);

    const r = await createFilm({ userId: "u1", title: "离线", script: "剧本" });

    expect(r.shots).toBe(1);
    const [, shots] = shotRepo.createMany.mock.calls[0]!;
    // 回退路径把台词并入画面描述（分镜解析只给 action / dialogue 两段）
    expect(shots[0]!.prompt).toContain("台词");
  });

  it("镜头尺寸沿用成片画幅的尺寸表达（不再折算 WxH / 视频场景表）", async () => {
    filmRepo.create.mockResolvedValue({ id: "f-size" });
    llmStructured.mockResolvedValue([
      { heading: "场景", action: "动作", dialogue: "", shotCount: 1 },
    ]);

    await createFilm({ userId: "u1", title: "画幅", script: "剧本" });

    const [, shots] = shotRepo.createMany.mock.calls[0]!;
    const size = shots[0]!.params.size;
    // 成片画幅默认的视频场景 16:9 1k，原样存尺寸表达 —— 像素由工作流派生
    expect(size).toMatchObject({ ratio: "16:9 横屏", clarity: "1k" });
    // 兜底常量是尺寸表达（镜头没带尺寸时用）
    expect(NATIVE_SHOT_VIDEO_SIZE).toMatchObject({ ratio: "16:9 横屏" });
  });
});
