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
  /** 恢复扫描用的按状态查询（5-A）。默认「库里没有未收尾的影片」。 */
  listByStatus: vi.fn<
    (
      _statuses: readonly string[],
    ) => Promise<Array<{ id: string; status: string }>>
  >(async () => []),
}));
type ShotRow = { id: string; taskId: string | null };
type CreatedShot = {
  order: number;
  shotId?: string | null;
  params: Record<string, unknown>;
  prompt: string;
  heading?: string | null;
  negative?: string | null;
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
  /** 监看一轮**只发一次**批量进度查询（`watchLoop` 无条件调它，空数组由仓储侧
   *  早退）；缺这个键的话循环会在这一行 reject，把「收没收到口」演成「静默死掉」。 */
  findExecutionProgressMany: vi.fn<(_ids: string[]) => Promise<unknown[]>>(
    async () => [],
  ),
}));
const skillRepo = vi.hoisted(() => ({
  findBySlug: vi.fn(async (_slug: string) => null),
}));
const prodRepo = vi.hoisted(() => ({
  getForUser: vi.fn<(userId: string, id: string) => Promise<unknown>>(),
  upsertForUser: vi.fn<
    (userId: string, data: Record<string, unknown>) => Promise<unknown>
  >(async () => undefined),
}));

/* 首帧图合成 / 视频任务创建：startFilm 测试要读它们的**入参**断言
 * 「每次自主出图都带一个新的随机 seed」，因此 hoisted 出来命名持有。 */
const createRunTaskMock = vi.hoisted(() =>
  vi.fn<
    (input: {
      userId: string;
      workflowId: string;
      values: { seed?: number } & Record<string, unknown>;
    }) => Promise<{ taskId: string; workflowName: string; taskType: string }>
  >(async () => ({ taskId: "task-1", workflowName: "wf", taskType: "T2V" })),
);
const synthFirstFrameMock = vi.hoisted(() =>
  vi.fn<(opts: { seed?: number } & Record<string, unknown>) => Promise<string>>(
    async () => "firstframe.png",
  ),
);

vi.mock("~/lib/core/repository", () => ({
  filmRepository: filmRepo,
  filmShotRepository: shotRepo,
  skillRepository: skillRepo,
  taskRepository: taskRepo,
}));
vi.mock("~/lib/core/repository-production", () => ({
  productionRepository: prodRepo,
}));
vi.mock("~/lib/workshop/workflow-run.server", () => ({
  createWorkflowRunTask: createRunTaskMock,
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
  synthesizeFirstFrame: synthFirstFrameMock,
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

/* 首启建表就绪判据：恢复扫描与回收器同一口径（表还没建就整轮跳过）。
 * 默认给「已就绪」，让不关心这条的用例不必各自设。 */
const schemaReadyMock = vi.hoisted(() => vi.fn(() => true));
vi.mock("~/lib/db-schema-ready", () => ({ isSchemaReady: schemaReadyMock }));

/* 诊断通道桩：真 logger 在模块加载期就建 pino 实例并挂 ERROR 镜像（它会往仓库
 * `log/` 写字 —— 规范里明令用例不许那么干）。本文件的判决不需要它的落盘，
 * 只需要「扫描失败时确实 Warn 了一次」可断言。 */
const loggerMock = vi.hoisted(() => ({
  info: vi.fn((_msg: string) => undefined),
  warn: vi.fn((_msg: string) => undefined),
  error: vi.fn((_msg: string) => undefined),
}));
vi.mock("~/lib/core/logger", () => ({ logger: loggerMock }));

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

import {
  cancelFilm,
  createFilm,
  createFilmFromProject,
  resumeStalledFilms,
  startFilm,
} from "./orchestrator";
/* 合成与项目回写已下沉到 compose-film.ts（ISSUE #1257）；断言不变，只是换个入口。 */
import { composeFilm, syncFilmToProject } from "./compose-film";
import { NATIVE_SHOT_VIDEO_SIZE } from "~/lib/film/film-size";

beforeEach(() => {
  vi.clearAllMocks();
  shotRepo.listByFilm.mockResolvedValue([]);
  shotRepo.listActiveWithTask.mockResolvedValue([]);
  llmStructured.mockResolvedValue([]);
  filmRepo.listByStatus.mockResolvedValue([]);
  schemaReadyMock.mockReturnValue(true);
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

describe("startFilm — 自主成片逐镜生成默认带随机种子（走「种子」对外参数）", () => {
  it("首帧图与视频两跳都各带一个有限数字 seed", async () => {
    // status=CANCELLED 只为了让 startFilm 末尾的 `void watchFilm` 立刻早退，
    // 不在测试里跑后台轮询循环（startFilm 本身只挡 GENERATING/COMPOSING）。
    filmRepo.findById.mockResolvedValue({
      id: "f1",
      userId: "u1",
      status: "CANCELLED",
    });
    shotRepo.listByFilm.mockResolvedValue([
      {
        id: "s1",
        order: 0,
        prompt: "海边日落",
        negative: null,
        // 不给现成首帧 → 走「先合成一张图、再喂视频」这条双跳出图路径。
        params: { videoWorkflowId: "wf-v", imageWorkflowId: "wf-i" },
      },
    ]);

    await startFilm("f1");

    // 跳 1：合成首帧图 —— 带一个新随机 seed。
    expect(synthFirstFrameMock).toHaveBeenCalledTimes(1);
    const imgSeed = synthFirstFrameMock.mock.calls[0]![0].seed;
    expect(typeof imgSeed).toBe("number");
    expect(Number.isFinite(imgSeed)).toBe(true);

    // 跳 2：视频工作流 —— values.seed 同样带一个新随机 seed。
    expect(createRunTaskMock).toHaveBeenCalledTimes(1);
    const videoSeed = createRunTaskMock.mock.calls[0]![0].values.seed;
    expect(typeof videoSeed).toBe("number");
    expect(Number.isFinite(videoSeed)).toBe(true);
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

describe("createFilmFromProject — 从统一项目 Shot[] 直接建片（Phase 5）", () => {
  // 只映射用到的字段即可（id / index / prompt / negativePrompt / sceneHeading）。
  const shot = (over: Record<string, unknown>) =>
    ({ sceneHeading: "", negativePrompt: "", ...over }) as never;

  it("逐条映射镜头、按镜号排序，不触发 LLM 分镜，且落 projectId 关联", async () => {
    filmRepo.create.mockResolvedValue({ id: "film-p1" });
    prodRepo.getForUser.mockResolvedValue({
      title: "项目片",
      type: "animation",
      scriptMarkdown: "# 剧本",
      shots: [
        shot({
          id: "shot-2",
          index: 2,
          prompt: "第二镜",
          negativePrompt: "n2",
          sceneHeading: "H2",
        }),
        shot({
          id: "shot-1",
          index: 1,
          prompt: "第一镜",
          negativePrompt: "n1",
          sceneHeading: "H1",
        }),
      ],
    });

    const r = await createFilmFromProject({
      userId: "u1",
      projectId: "proj_1",
      videoWorkflowId: "wf-video",
      imageWorkflowId: "wf-image",
    });

    expect(r).toEqual({ id: "film-p1", shots: 2 });
    // 不再走 LLM 分镜（镜头是工坊定稿）
    expect(llmStructured).not.toHaveBeenCalled();

    // 成片挂上 projectId，标题 / 类型 / 剧本取自项目
    const created = filmRepo.create.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(created.projectId).toBe("proj_1");
    expect(created.title).toBe("项目片");
    expect(created.type).toBe("animation");
    expect(created.script).toBe("# 剧本");

    const [filmId, shots] = shotRepo.createMany.mock.calls[0]!;
    expect(filmId).toBe("film-p1");
    // 按镜号排序后 order 从 0 起，prompt/negative 原样带入
    expect(shots.map((s) => s.order)).toEqual([0, 1]);
    expect(shots[0]!.prompt).toBe("第一镜");
    expect(shots[0]!.negative).toBe("n1");
    expect(shots[1]!.prompt).toBe("第二镜");
    // 逐镜回填来源 shotId（Phase 5 回写逐镜 clip 的锚点）
    expect(shots[0]!.shotId).toBe("shot-1");
    expect(shots[1]!.shotId).toBe("shot-2");
    // 逐镜 params 与自由建片同一口径
    expect(shots[0]!.params).toMatchObject({
      videoWorkflowId: "wf-video",
      imageWorkflowId: "wf-image",
    });
  });

  it("项目无 production 行或无镜头 → 抛错且不落库", async () => {
    prodRepo.getForUser.mockResolvedValue(null);
    await expect(
      createFilmFromProject({ userId: "u1", projectId: "proj_missing" }),
    ).rejects.toThrow(/还没有镜头/);
    expect(filmRepo.create).not.toHaveBeenCalled();
    expect(shotRepo.createMany).not.toHaveBeenCalled();

    prodRepo.getForUser.mockResolvedValue({ shots: [] });
    await expect(
      createFilmFromProject({ userId: "u1", projectId: "proj_empty" }),
    ).rejects.toThrow(/还没有镜头/);
    expect(filmRepo.create).not.toHaveBeenCalled();
  });
});

describe("syncFilmToProject — 成片合成后逐镜 clip + 完成状态回写（Phase 5 §6.3/§7）", () => {
  it("按 shotId 命中镜头写入 clipUrl/clipStatus，并标 rendered；其余字段与未命中镜头原样保留", async () => {
    prodRepo.getForUser.mockResolvedValue({
      id: "proj_1",
      title: "项目片",
      type: "animation",
      tone: "轻快",
      logline: "L",
      scriptMarkdown: "# 剧本",
      scenes: [{ id: "sc1" }],
      characters: [{ id: "c1" }],
      shots: [
        { id: "s1", index: 1, prompt: "p1" },
        { id: "s2", index: 2, prompt: "p2" },
      ],
      progress: { stage: "video", rendered: false },
    });

    await syncFilmToProject("u1", "proj_1", [
      { shotId: "s1", videoPath: "/v/s1.mp4", status: "SUCCEEDED" },
      { shotId: null, videoPath: "/v/orphan.mp4", status: "SUCCEEDED" }, // 自由建片镜头：无来源，跳过
      { shotId: "s2", videoPath: null, status: "FAILED" }, // 无产物，clip 不写
    ]);

    expect(prodRepo.upsertForUser).toHaveBeenCalledTimes(1);
    const [userId, data] = prodRepo.upsertForUser.mock.calls[0]!;
    expect(userId).toBe("u1");
    expect(data.progress).toEqual({ stage: "render", rendered: true });
    // s1 命中且带 videoPath → 写 clipUrl + clipStatus done；prompt 等原字段保留
    expect(data.shots).toEqual([
      {
        id: "s1",
        index: 1,
        prompt: "p1",
        clipUrl: "/v/s1.mp4",
        clipStatus: "done",
      },
      // s2 无 videoPath → 原样，不被 clip 覆盖
      { id: "s2", index: 2, prompt: "p2" },
    ]);
    // 非镜头字段整体回写、不丢失
    expect(data.title).toBe("项目片");
    expect(data.characters).toEqual([{ id: "c1" }]);
  });

  it("脏 progress（缺字段 / 非法 stage）也规范化后再回写", async () => {
    prodRepo.getForUser.mockResolvedValue({
      id: "proj_2",
      title: "T",
      type: "short_video",
      tone: "",
      logline: "",
      scriptMarkdown: "",
      scenes: [],
      characters: [],
      shots: [],
      progress: {},
    });
    await syncFilmToProject("u1", "proj_2", []);
    const [, data] = prodRepo.upsertForUser.mock.calls[0]!;
    expect(data.progress).toEqual({ stage: "render", rendered: true });
    expect(data.shots).toEqual([]);
  });

  it("无 production 行 → 不写（纯文本自由建片不受影响）", async () => {
    prodRepo.getForUser.mockResolvedValue(null);
    await syncFilmToProject("u1", "proj_missing", []);
    expect(prodRepo.upsertForUser).not.toHaveBeenCalled();
  });
});

/* ── 重启后的恢复扫描（P3 §5 ADR 5-A）────────────────────────
 * 这一刀的用户可见形态是「影片停在 GENERATING，转圈转到天荒地老」：监看循环活在
 * 进程里，而热重启 / 桌包重启会把它弄丢，镜头任务却还在库里由执行侧推进。
 * 判的是**扫描的接线与判决**，不是轮询循环本身（那条循环的 IO 在上面的用例里）。 */
describe("resumeStalledFilms — 重启后不再卡 GENERATING", () => {
  /** 把 `listByStatus` 桩成「按传入的状态返回对应行」。扫描是分两次查的
   * （GENERATING 一次、COMPOSING 一次），对参数偷懒会让两个判决互相串味。 */
  function rowsByStatus(rows: Array<{ id: string; status: string }>) {
    filmRepo.listByStatus.mockImplementation(async (statuses) =>
      rows.filter((r) => statuses.includes(r.status)),
    );
  }

  it("还在 GENERATING 的影片被接回监看（零镜头那种当场判掉，并留痕是续跑）", async () => {
    rowsByStatus([{ id: "f-gen", status: "GENERATING" }]);
    filmRepo.findById.mockResolvedValue({ id: "f-gen", status: "GENERATING" });
    shotRepo.listByFilm.mockResolvedValue([]);

    const result = await resumeStalledFilms();
    expect(result).toEqual({ resumed: ["f-gen"], abandoned: [] });

    /* 零镜头 = 「markGenerating 之后、逐镜提交之前」崩的那一格。它只有扫描会捡起来
     * （原先监看只由 startFilm 起，那时 shots 必然非空），所以必须判掉而不是
     * 拿 `0/0` 的 NaN 进度去合成一条空时间线。 */
    await expect
      .poll(() => filmRepo.markFailed, { message: "markFailed 的调用现场" })
      .toHaveBeenCalledWith("f-gen", "没有可继续的镜头");
    const msgs = filmRepo.appendLog.mock.calls.map((c) => c[1]?.msg ?? "");
    expect(msgs.some((m) => m.includes("进程重启后续跑监看"))).toBe(true);
  });

  it("停在 COMPOSING 的影片判 FAILED 并把「重新合成」的出口接回来，且不自个重跑 ffmpeg", async () => {
    rowsByStatus([{ id: "f-comp", status: "COMPOSING" }]);

    const result = await resumeStalledFilms();

    /* `composeFilm` 一见到 COMPOSING 就早退 ⇒ 不判掉的话，这一格连界面上那个
     * 「重新合成」按钮都点不动（它是唯一出口，却被自己的状态挡住）。 */
    expect(result).toEqual({ resumed: [], abandoned: ["f-comp"] });
    expect(filmRepo.markFailed).toHaveBeenCalledWith(
      "f-comp",
      expect.stringContaining("合成中断"),
    );
    expect(filmRepo.appendLog).toHaveBeenCalledWith(
      "f-comp",
      expect.objectContaining({ level: "error" }),
    );
    /* 反向判据：扫描不许在开机时静默重跑合成（markComposing 只由 composeFilm 写）。 */
    expect(filmRepo.markComposing).not.toHaveBeenCalled();
  });

  it("同一部影片至多一条循环：旧循环还在飞时，第二次扫描不再起一条", async () => {
    rowsByStatus([{ id: "f-busy", status: "GENERATING" }]);
    /* 把第一条循环钉在「等数据库」上，模拟热重启后旧模块那条还没走完的情形。 */
    let release: (value: unknown) => void = () => undefined;
    filmRepo.findById.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    expect((await resumeStalledFilms()).resumed).toEqual(["f-busy"]);
    expect((await resumeStalledFilms()).resumed).toEqual([]);

    release({ id: "f-busy", status: "CANCELLED" });
  });

  it("「已终态但没有 taskId」的镜头不算等待，否则影片永不收口", async () => {
    rowsByStatus([{ id: "f-term", status: "GENERATING" }]);
    filmRepo.findById.mockResolvedValue({ id: "f-term", status: "GENERATING" });
    /* 两个镜头都已终态、都没有 taskId：一个是历史行（成功过），一个是「逐镜提交时
     * catch 掉了」的（`markFailed` 不落 taskId）。旧顺序先判 `!shot.taskId`，于是它们
     * 都被数成等待 ⇒ `pending` 永不为 0 ⇒ 既不合成也不判失败，一路轮询到预算耗尽
     * 才落一句「生成超时」（dev 实测：影片停在 progress 50 不动）。
     * 第二次 `listByFilm` 是合成侧的「取可用镜头」，给它空数组 ⇒ `composeFilm` 在建
     * 临时目录**之前**就早退，用例不往仓库 `public/` 里写任何东西。 */
    shotRepo.listByFilm
      .mockResolvedValueOnce([
        {
          id: "s0",
          order: 0,
          status: "SUCCEEDED",
          taskId: null,
          videoPath: "/generated/films/_fixture/clip0.mp4",
          progress: 100,
        },
        {
          id: "s1",
          order: 1,
          status: "FAILED",
          taskId: null,
          videoPath: null,
          progress: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    await resumeStalledFilms();

    await expect
      .poll(() => filmRepo.updateProgress, {
        message: "updateProgress 的调用现场",
      })
      .toHaveBeenCalledWith("f-term", 100);
    /* 钉「循环走到了 `pending === 0` 那一支」：确实去调了合成，而合成给出的第一个
     * 判决就是「没有可用的镜头视频」。 */
    await expect
      .poll(() => filmRepo.markComposing, {
        message: "markComposing 的调用现场",
      })
      .toHaveBeenCalledWith("f-term");
    await expect
      .poll(() => filmRepo.markFailed, { message: "markFailed 的调用现场" })
      .toHaveBeenCalledWith("f-term", "没有可用的镜头视频");
  });

  it("表还没建就整轮不查（与回收器同一口径）", async () => {
    schemaReadyMock.mockReturnValue(false);

    const result = await resumeStalledFilms();

    expect(result).toEqual({ resumed: [], abandoned: [] });
    expect(filmRepo.listByStatus).not.toHaveBeenCalled();
    /* 这条扫描是一次性的（回收器每 30s 还会再来一轮，它不会）：跳过之后就得等
     * 下一次重启才有人接片，所以「为什么没接」必须在日志里读得到。 */
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining("重启恢复扫描跳过"),
    );
  });

  it("扫描自己炸了不许把启动打死，但要 Warn 出来", async () => {
    filmRepo.listByStatus.mockRejectedValue(new Error("no such table"));

    await expect(resumeStalledFilms()).resolves.toEqual({
      resumed: [],
      abandoned: [],
    });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("resumeStalledFilms 失败"),
    );
  });
});
