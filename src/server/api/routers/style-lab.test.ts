/**
 * `styleLab` router 的闸门用例。
 *
 * 判据集中在四件事：
 *   · **归属走真 SQL** —— 试验行带 `userId`。别人的 id 与根本不存在的 id 给**同一句**
 *     404（这一屏的 id 是 cuid，不是权限边界，但也没有理由向外区分「有这一行、
 *     只是不归你」和「从来没写过」——那句话对用户是同一句：下一跳该去新建一条）。
 *   · **就绪闸走真数据** —— `create` 会按 workflowId 真查工作流行，再用
 *     `deriveEncapsulationStatus` 判「该模式必备口是否都有落点」；查不到行是
 *     NOT_FOUND、行在但没就绪是 BAD_REQUEST（两个码不同，界面才分得开「选错工作流」
 *     与「工作流没配好」）。这里把那份就绪判据 mock 掉，是为了分别喂两种结论 ——
 *     真造一份「已就绪」的 workflowIO / paramMap 与这一刀的判据无关，那部分另有回归。
 *   · **扇出的四条账** —— 展开多少格就登记多少行；已有 `taskId` 的格子跳过（重跑只补
 *     没跑过的座位）；整批只敲一次节拍（逐格踢只是把派发器敲 N 遍）；超过硬上限整批
 *     拒绝、一行都不落。
 *   · **停止复用执行侧那个取消出口** —— 而不是这里自己把状态写成 CANCELLED。
 *
 * mock 边界：`~/server/db`（内存库 + 真 Drizzle）、`~/server/better-auth`、
 * `~/lib/core/logger`、`~/lib/workshop/workshop-encapsulation-status`（就绪结论的
 * 注入点）、`~/lib/comfyui/executor-continuation`（数 kick 次数）、
 * `~/lib/comfyui/enqueue`（真模块 import 会起 reaper 定时器并连 ComfyUI WS）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { kickMock, cancelMock } = vi.hoisted(() => ({
  /* 两个都必须是**可数**的替身：这两处判据的形式就是「敲了几次 / 取消了哪条」。 */
  kickMock: vi.fn<() => void>(() => undefined),
  cancelMock: vi.fn<(taskId: string) => Promise<void>>(async () => undefined),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/workshop/workshop-encapsulation-status", () => ({
  deriveEncapsulationStatus: vi.fn(() => ({
    entries: [],
    ready: true,
    missingRequired: [],
    missingLabels: [],
    resolvedCount: 0,
  })),
}));
vi.mock("~/lib/comfyui/executor-continuation", () => ({
  kickQueue: kickMock,
  subscribe: vi.fn(),
  getLogs: vi.fn(),
}));
vi.mock("~/lib/comfyui/enqueue", () => ({
  cancelTask: cancelMock,
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
  deriveEncapsulationStatus,
} from "~/lib/workshop/workshop-encapsulation-status";
import { styleLabRouter } from "~/server/api/routers/style-lab";
import { MATRIX_HARD_LIMIT } from "~/lib/style-lab/style-lab-matrix";
import {
  deleteRows,
  getTestDb,
  seedTask,
  seedUser,
  seedWorkflowTemplate,
  updateRow,
  type Row,
  type TestDb,
} from "../../../../tests/helpers/test-db";
import { errorEnvelope, makeCtx, makeUser } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(styleLabRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());
/** 另一个账号：判「归属」时用它发同样的请求。 */
const otherCaller = () =>
  createCaller(makeCtx({ user: makeUser({ id: "user-b", email: "b@t.dev" }) }));

const readyStatus = {
  entries: [],
  ready: true,
  missingRequired: [],
  missingLabels: [],
  resolvedCount: 0,
};
const notReadyStatus = {
  ...readyStatus,
  ready: false,
  missingRequired: ["提示词"],
};

/** 一条有可执行内容的工作流（`hasExecutableWorkflow` 判的就是 rawJson 非空）。 */
const RAW_WF = { nodes: [{ id: "1", type: "KSampler" }] };

const createInput = (over: Record<string, unknown> = {}) => ({
  name: "冷艳 × 赛博",
  workflowId: "wf-1",
  mode: "T2I",
  styles: ["赛博朋克", "暗黑"],
  traits: { temperament: ["清冷孤傲"] },
  params: {},
  ...over,
});

/** 取替身库某一列并收窄成 `string`。
 *
 * `$tables.X` 的行来自 `SELECT *`，列类型是 `unknown`；`updateRow` 的目标 id 与
 * 「取消了哪条任务」的断言都要 `string`。本仓禁非空断言，所以在这里收一次，
 * 并且**不收成 `undefined`**：拿不到就报「用例前置条件不成立」，别让下一步断言
 * 以 `undefined` 悄悄比过去。 */
function column(row: Row | undefined, name: string): string {
  const value = row?.[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`用例前置条件不成立：这一行没有 ${name}`);
  }
  return value;
}

beforeEach(() => {
  tdb.$reset();
  kickMock.mockClear();
  cancelMock.mockClear();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  seedWorkflowTemplate(tdb, {
    id: "wf-1",
    userId: "user-a",
    name: "文生图基础流",
    taskType: "T2I",
    modes: '["T2I"]',
    defaultMode: "T2I",
    rawJson: RAW_WF,
    /* 没连线的工作流：所有对外值都落不到端口（进 unmatched），任务仍照常入队。
     * 扇出的用例判的是「登记了多少格、敲几次节拍」，与落点无关 —— 落点那部分由
     * `workflow-encapsulation` 自己的回归守着。 */
    workflowIO: {},
    paramMap: null,
  });
  vi.mocked(deriveEncapsulationStatus).mockReturnValue(readyStatus);
});

describe("styleLab.list —— 归属与派生计数", () => {
  it("新建前后各数一次，计数由服务端从格子聚合", async () => {
    expect((await caller().list()).items).toEqual([]);
    await caller().create(createInput());
    const res = await caller().list();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      name: "冷艳 × 赛博",
      cellCount: 0,
      doneCount: 0,
    });
    // 视图拿到的 JSON 列已是解好的形状，不需要再 parse。
    expect(res.items[0]?.styles).toEqual(["赛博朋克", "暗黑"]);
    expect(res.items[0]?.traits).toEqual({ temperament: ["清冷孤傲"] });
  });

  it("只列自己名下的试验", async () => {
    await caller().create(createInput({ name: "A 的试验" }));
    // user-b 看不到 user-a 那一行 —— 列表为空而不是「别人的也列出来」。
    expect((await otherCaller().list()).items).toEqual([]);
    expect((await caller().list()).items).toHaveLength(1);
  });

  it("中位耗时没有历史时给 null", async () => {
    expect((await caller().list()).medianSecPerImage).toBeNull();
  });
});

describe("styleLab.create —— 就绪闸与形状闸", () => {
  it("工作流不存在 → NOT_FOUND，且不落一行", async () => {
    const env = await errorEnvelope(
      caller().create(createInput({ workflowId: "ghost" })),
    );
    expect(env.code).toBe("NOT_FOUND");
    expect((await caller().list()).items).toEqual([]);
  });

  it("工作流在、但该模式没就绪 → BAD_REQUEST，文案带上缺的口", async () => {
    vi.mocked(deriveEncapsulationStatus).mockReturnValueOnce(notReadyStatus);
    const env = await errorEnvelope(caller().create(createInput()));
    expect(env.code).toBe("BAD_REQUEST");
    expect(env.message).toContain("提示词");
    expect((await caller().list()).items).toEqual([]);
  });

  it("name 为空 → zod BAD_REQUEST，一次就绪校验都不跑", async () => {
    vi.mocked(deriveEncapsulationStatus).mockClear();
    const env = await errorEnvelope(caller().create(createInput({ name: "" })));
    expect(env.code).toBe("BAD_REQUEST");
    expect(deriveEncapsulationStatus).not.toHaveBeenCalled();
  });

  it("成功创建时把归属写进行里（不是靠读路径再补）", async () => {
    const res = await caller().create(createInput());
    expect(res.experiment.name).toBe("冷艳 × 赛博");
    expect(res.experiment.workflowId).toBe("wf-1");
    expect(tdb.$tables.styleExperiments[0]?.userId).toBe("user-a");
  });
});

describe("styleLab.detail —— 试验定义 + 座位表", () => {
  it("跑之前没有格子：座位表由扇出现算现落", async () => {
    const { experiment } = await caller().create(createInput());
    const res = await caller().detail({ id: experiment.id });
    expect(res.experiment.id).toBe(experiment.id);
    expect(res.cells).toEqual([]);
  });

  it("跑之后每格带上任务状态与产物图（同一次读里给齐）", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂"], traits: { temperament: ["清冷"] } }),
    );
    await caller().runBatch({ id: experiment.id });
    const res = await caller().detail({ id: experiment.id });
    expect(res.cells).toHaveLength(1);
    const cell = res.cells[0];
    expect(cell).toMatchObject({
      style: "厚涂",
      traitKey: "temperament=清冷",
      isRepresentative: true,
      prompt: "mood: 清冷, 厚涂",
      status: "QUEUED",
      /* 任务刚入队、还没有产物：这一格显示空位，而不是编一个地址出来。 */
      imageUrl: null,
    });
    /* 「已经绑上一条任务」只需判形状：非空字符串（用 `expect.any(String)` 会往
       对象字面量里塞一个 `any`）。 */
    expect(typeof cell?.taskId).toBe("string");
    expect(cell?.taskId).not.toBe("");
  });

  it("别人的试验读不到，且与不存在的 id 同一句 404", async () => {
    const { experiment } = await caller().create(createInput());
    const foreign = await errorEnvelope(
      otherCaller().detail({ id: experiment.id }),
    );
    const ghost = await errorEnvelope(caller().detail({ id: "ghost" }));
    expect(foreign.code).toBe("NOT_FOUND");
    expect(ghost.code).toBe("NOT_FOUND");
    expect(foreign.message).toBe(ghost.message);
  });
});

describe("styleLab.runBatch —— 矩阵扇出", () => {
  /** 一枚枚座位都落库、并各自绑一条 QUEUED 任务。 */
  it("展开几格就登记几格，逐格绑一条 QUEUED 任务", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂", "水彩"], traits: { temperament: ["清冷"] } }),
    );
    const res = await caller().runBatch({ id: experiment.id });
    expect(res).toMatchObject({ planned: 2, enqueued: 2, skipped: 0 });

    const cells = tdb.$tables.styleExperimentCells;
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.style)).toEqual(["厚涂", "水彩"]);
    /* 每个风格的第一枚是浏览代表位（墙上一行一枚）。`$tables` 给回的是库里存的
       形态（boolean 列是 integer 0/1，测试替身不转布尔），所以这里归一下再比。 */
    expect(cells.map((c) => Boolean(c.isRepresentative))).toEqual([
      true,
      true,
    ]);

    const tasks = tdb.$tables.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === "QUEUED")).toBe(true);
    expect(tasks.every((t) => t.userId === "user-a")).toBe(true);
    /* 每格绑一条不同的任务，且提示词是那一格自己的那一句。 */
    expect(new Set(cells.map((c) => c.taskId)).size).toBe(2);
    for (const cell of cells) {
      const task = tasks.find((t) => t.id === cell.taskId);
      expect(task?.prompt).toBe(cell.prompt);
      expect(task?.workflowName).toBe("文生图基础流");
    }
  });

  it("整批只敲一次节拍", async () => {
    const { experiment } = await caller().create(
      createInput({
        styles: ["厚涂", "水彩", "油画"],
        traits: { temperament: ["清冷", "温柔"] },
      }),
    );
    await caller().runBatch({ id: experiment.id });
    expect(tdb.$tables.styleExperimentCells).toHaveLength(6);
    expect(kickMock).toHaveBeenCalledTimes(1);
  });

  it("重跑只补没跑过的座位：已有 taskId 的格子跳过且不新建任务", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂"], traits: { temperament: ["清冷"] } }),
    );
    const first = await caller().runBatch({ id: experiment.id });
    expect(first).toMatchObject({ enqueued: 1, skipped: 0 });

    const again = await caller().runBatch({ id: experiment.id });
    expect(again).toMatchObject({ enqueued: 0, skipped: 1 });
    expect(tdb.$tables.tasks).toHaveLength(1);
    expect(tdb.$tables.styleExperimentCells).toHaveLength(1);
  });

  it("扩了选择再跑：新座位入队，老座位不动（补齐而不是重跑）", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂"], traits: { temperament: ["清冷"] } }),
    );
    await caller().runBatch({ id: experiment.id });
    /* 把库里的试验行改宽（走界面是「新建一条」，这里要判的是扇出这一侧的行为）。
       `$tables` 的每个键都是重新查库的 getter，改它的副本不落库 —— 这里发真的 UPDATE。 */
    updateRow(tdb, "styleExperiment", experiment.id, {
      styles: ["厚涂", "水彩"],
    });

    const res = await caller().runBatch({ id: experiment.id });
    expect(res).toMatchObject({ planned: 2, enqueued: 1, skipped: 1 });
    expect(tdb.$tables.styleExperimentCells).toHaveLength(2);
    expect(tdb.$tables.tasks).toHaveLength(2);
  });

  it("什么都没选（整批提示词都是空串）：在任何写入之前拒绝，不落一行格子", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: [], traits: {} }),
    );
    const env = await errorEnvelope(caller().runBatch({ id: experiment.id }));
    expect(env.code).toBe("BAD_REQUEST");
    expect(env.message).toContain("拼不出任何提示词");
    expect(tdb.$tables.styleExperimentCells).toEqual([]);
    expect(tdb.$tables.tasks).toEqual([]);
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("工作流没有可执行内容：格子留在「未跑」，库里不留注定失败的排队行，一次节拍也不敲", async () => {
    /* 这一条钉的是那道闸的位置。闸写在 `createQueued` 之后时，抛错那一行已经是
       库里的 QUEUED 任务 —— 单卡串行（`MAX_CONCURRENCY = 1`）意味着它会跑到用户
       别的任务前面，然后必然失败。 */
    seedWorkflowTemplate(tdb, {
      id: "wf-empty",
      userId: "user-a",
      name: "空原件",
      taskType: "T2I",
      defaultMode: "T2I",
      rawJson: null,
      workflowIO: {},
      paramMap: null,
    });
    const { experiment } = await caller().create(
      createInput({
        workflowId: "wf-empty",
        styles: ["厚涂"],
        traits: { temperament: ["清冷"] },
      }),
    );
    const env = await errorEnvelope(caller().runBatch({ id: experiment.id }));
    expect(env.code).toBe("INTERNAL_SERVER_ERROR");
    expect(tdb.$tables.tasks).toEqual([]);
    expect(tdb.$tables.styleExperimentCells).toHaveLength(1);
    expect(tdb.$tables.styleExperimentCells[0]?.taskId).toBeNull();
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("超过硬上限：整批拒绝，一行格子都不登记", async () => {
    const { experiment } = await caller().create(
      createInput({
        styles: Array.from({ length: MATRIX_HARD_LIMIT + 1 }, (_, i) => `风格${String(i)}`),
        traits: {},
      }),
    );
    const env = await errorEnvelope(caller().runBatch({ id: experiment.id }));
    expect(env.code).toBe("BAD_REQUEST");
    expect(env.message).toContain(String(MATRIX_HARD_LIMIT));
    expect(tdb.$tables.styleExperimentCells).toEqual([]);
    expect(tdb.$tables.tasks).toEqual([]);
  });

  it("没连线的口如实上报 unmatched（这批共用 seed 这件事并没有真的生效）", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂"], traits: { temperament: ["清冷"] }, params: { seed: 1000 } }),
    );
    const res = await caller().runBatch({ id: experiment.id });
    /* `workflowIO: {}` + `paramMap: null` ⇒ 提示词与种子都没有落点。两格各报一次，
       去重后是同一份清单（界面把这句原样上屏，见 describeUnmatchedInputs）。 */
    expect(res.unmatched).toEqual(["prompt", "seed"]);
    expect(res.baseSeed).toBe(1000);
  });

  it("别人的试验不能被扇出", async () => {
    const { experiment } = await caller().create(createInput());
    const env = await errorEnvelope(
      otherCaller().runBatch({ id: experiment.id }),
    );
    expect(env.code).toBe("NOT_FOUND");
    expect(tdb.$tables.styleExperimentCells).toEqual([]);
  });

  it("工作流被删掉之后跑批 → NOT_FOUND，且不登记格子", async () => {
    const { experiment } = await caller().create(createInput());
    deleteRows(tdb, "workflowTemplate", "wf-1");
    vi.mocked(deriveEncapsulationStatus).mockClear();
    const env = await errorEnvelope(caller().runBatch({ id: experiment.id }));
    expect(env.code).toBe("NOT_FOUND");
    expect(tdb.$tables.styleExperimentCells).toEqual([]);
  });
});

describe("styleLab.stopBatch —— 取消复用执行侧那个出口", () => {
  it("逐格取消进行中的任务，终态的不碰", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂", "水彩"], traits: { temperament: ["清冷"] } }),
    );
    await caller().runBatch({ id: experiment.id });
    /* 第二格已经收口成 SUCCEEDED：取消它没有意义，也不该把产物账一起改掉。
       （`$tables` 是重新查库的 getter，改副本不落库 —— 这里发真的 UPDATE。） */
    const cells = tdb.$tables.styleExperimentCells;
    updateRow(tdb, "task", column(cells[1], "taskId"), {
      status: "SUCCEEDED",
    });

    const res = await caller().stopBatch({ id: experiment.id });
    expect(res).toMatchObject({ cancelled: 1, alreadyDone: 1 });
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith(column(cells[0], "taskId"));
  });

  it("从没跑过的试验：取消 0 条而不是报错", async () => {
    const { experiment } = await caller().create(createInput());
    const res = await caller().stopBatch({ id: experiment.id });
    expect(res).toMatchObject({ cancelled: 0, alreadyDone: 0 });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("别人的试验不能被停", async () => {
    const { experiment } = await caller().create(createInput());
    const env = await errorEnvelope(
      otherCaller().stopBatch({ id: experiment.id }),
    );
    expect(env.code).toBe("NOT_FOUND");
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("格子引用的任务不属于自己时不取消（与 task.cancel 那次越权修复同一口径）", async () => {
    const { experiment } = await caller().create(
      createInput({ styles: ["厚涂"], traits: { temperament: ["清冷"] } }),
    );
    await caller().runBatch({ id: experiment.id });
    /* 造一条挂在 user-b 名下的进行中任务，并把这一格指到它上头：归属复核必须落在
       取消之前，否则这一屏就成了「借别人的试验取消别人的任务」的入口。 */
    const foreign = seedTask(tdb, { userId: "user-b", status: "RUNNING" });
    const ownCell = tdb.$tables.styleExperimentCells.find(
      (c) => c.experimentId === experiment.id,
    );
    updateRow(tdb, "styleExperimentCell", column(ownCell, "id"), {
      taskId: column(foreign, "id"),
    });

    const res = await caller().stopBatch({ id: experiment.id });
    expect(res).toMatchObject({ cancelled: 0 });
    expect(cancelMock).not.toHaveBeenCalled();
  });
});

describe("styleLab.softDelete —— 软删与不存在同形", () => {
  it("软删后列表不再暴露它，且重复删是 NOT_FOUND 而不是「又成功删了一遍」", async () => {
    const { experiment } = await caller().create(createInput());

    expect((await caller().softDelete({ id: experiment.id })).ok).toBe(true);
    expect((await caller().list()).items).toEqual([]);

    // 幂等：再删一次是 NOT_FOUND，而不是「又成功删了一遍」。
    expect(
      (await errorEnvelope(caller().softDelete({ id: experiment.id }))).code,
    ).toBe("NOT_FOUND");
  });

  it("删一个不存在的 id → NOT_FOUND", async () => {
    expect(
      (await errorEnvelope(caller().softDelete({ id: "ghost" }))).code,
    ).toBe("NOT_FOUND");
  });

  it("别人的 id 删不动", async () => {
    const { experiment } = await caller().create(createInput());
    expect(
      (await errorEnvelope(otherCaller().softDelete({ id: experiment.id })))
        .code,
    ).toBe("NOT_FOUND");
    // 创建人那侧还在。
    expect((await caller().list()).items).toHaveLength(1);
  });
});
