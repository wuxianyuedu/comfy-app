/**
 * train.router 的闸门用例（体检清单 ⑨ 第二刀）。
 *
 * LoRA 训练是**会烧 GPU、会起外部后端**的那一族：`create` 落一行 QUEUED 就把 job id
 * 交给 `enqueueTraining`，`cancel` 会去 DELETE 远端任务。所以这里判的两件事：
 *   · **归属**（`findByIdForUser` 之后才动手，越权与不存在同形且必须是 NOT_FOUND ——
 *     裸 `throw new Error` 会被 tRPC 归成 500，一次正常点击报成故障，客户端也没法分支）；
 *   · **拒绝发生在起任务之前**（数值闸挡下时，`enqueueTraining` 一次都不能被调用 ——
 *     只断状态码等于「已经排进队列了才回 400」）。
 *
 * 另外钉一条容易漂移的：`trainerUrl` 的来源优先级（设置项 > 环境变量）。这个值决定
 * 训练请求打到哪台机器，写反了就是「改了设置没生效」那一类。
 *
 * mock 边界：`~/server/db`（内存库 + 真 Drizzle）、`~/lib/comfyui/trainer`（编排替身，
 * 只记账）、`~/lib/app-settings/app-settings.server`（可控的 settings）、
 * `~/server/better-auth`、`~/lib/core/logger`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { trainer, settings } = vi.hoisted(() => ({
  trainer: {
    enqueueTraining: vi.fn(async () => undefined),
    cancelTraining: vi.fn(async () => undefined),
    isTrainerConfigured: vi.fn(() => true),
  },
  settings: { trainerUrl: "", loginRequired: false },
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
vi.mock("~/lib/comfyui/trainer", () => ({
  enqueueTraining: trainer.enqueueTraining,
  cancelTraining: trainer.cancelTraining,
  isTrainerConfigured: trainer.isTrainerConfigured,
}));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettingsSync: () => settings,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { loraTrainingJobRepository } from "~/lib/core/repository";
import { trainRouter } from "~/server/api/routers/train";
import {
  getTestDb,
  seedUser,
  type Row,
  type TestDb,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(trainRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    (e: { code?: string }) => e?.code ?? "UNKNOWN",
  );
}

/** 种一条训练任务：只关心 userId 与 id，其余吃仓储的默认形状。 */
async function seedJob(userId: string, id: string): Promise<Row> {
  return loraTrainingJobRepository.createQueued({
    userId,
    name: id,
    baseModel: "sd_xl_base.safetensors",
    triggerWord: "sks",
    classWord: null,
    datasetImages: [{ name: "a.png" }],
    resolution: 512,
    steps: 1500,
    batchSize: 4,
    learningRate: 0.0001,
    rankDim: 32,
    networkAlpha: 16,
    optimizer: "AdamW8bit",
    scheduler: "cosine",
    seed: 0,
  });
}

const createInput = (over: Record<string, unknown> = {}) => ({
  name: "我的 LORA",
  baseModel: "sd_xl_base.safetensors",
  triggerWord: "sks",
  datasetImages: [{ name: "a.png", caption: "一张图" }],
  ...over,
});

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  settings.trainerUrl = "";
  settings.loginRequired = false;
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

afterEach(() => {
  delete process.env.LORA_TRAINER_URL;
});

describe("train.list —— 读侧归属与后端地址来源", () => {
  it("只返回自己的任务", async () => {
    await seedJob("user-a", "job-a");
    await seedJob("user-b", "job-b");
    const res = await caller().list();
    expect(res.jobs.map((j) => j.id)).toHaveLength(1);
    expect(res.jobs[0]?.name).toBe("job-a");
    expect(res.backendConfigured).toBe(true);
  });

  it("设置里的 trainerUrl 优先于环境变量（写反了就是「改了设置没生效」）", async () => {
    settings.trainerUrl = "http://127.0.0.1:9999";
    process.env.LORA_TRAINER_URL = "http://127.0.0.1:8888";
    expect((await caller().list()).trainerUrl).toBe("http://127.0.0.1:9999");
  });

  it("设置项为空才回落到环境变量", async () => {
    process.env.LORA_TRAINER_URL = "http://127.0.0.1:8888";
    expect((await caller().list()).trainerUrl).toBe("http://127.0.0.1:8888");
  });

  it("两处都没给 → null（界面据此提示「未配置训练后端」）", async () => {
    expect((await caller().list()).trainerUrl).toBeNull();
  });
});

describe("train.create —— 数值闸挡在起任务之前", () => {
  it("正常创建：落库带会话用户，且排进队列一次", async () => {
    const res = await caller().create(createInput());
    expect(trainer.enqueueTraining).toHaveBeenCalledTimes(1);
    const job = await loraTrainingJobRepository.findByIdForUser(
      "user-a",
      res.jobId,
    );
    expect(job?.userId).toBe("user-a");
  });

  it("steps 超上限 / 下限 → BAD_REQUEST 且一次都没排队列", async () => {
    expect(await codeOf(caller().create(createInput({ steps: 20001 })))).toBe(
      "BAD_REQUEST",
    );
    expect(await codeOf(caller().create(createInput({ steps: 0 })))).toBe(
      "BAD_REQUEST",
    );
    expect(trainer.enqueueTraining).not.toHaveBeenCalled();
  });

  it("resolution 越界（< 256 或 > 2048）→ BAD_REQUEST 且不落库", async () => {
    expect(
      await codeOf(caller().create(createInput({ resolution: 128 }))),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(caller().create(createInput({ resolution: 4096 }))),
    ).toBe("BAD_REQUEST");
    expect(await loraTrainingJobRepository.listByUser("user-a")).toHaveLength(
      0,
    );
    expect(trainer.enqueueTraining).not.toHaveBeenCalled();
  });

  it("空数据集 / 触发词缺失 / 名字超长 → BAD_REQUEST（三项都是必填或限长）", async () => {
    expect(
      await codeOf(caller().create(createInput({ datasetImages: [] }))),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(caller().create(createInput({ triggerWord: "" }))),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(caller().create(createInput({ name: "x".repeat(121) }))),
    ).toBe("BAD_REQUEST");
  });

  it("学习率给 0 被挡（下限是正数）", async () => {
    expect(
      await codeOf(caller().create(createInput({ learningRate: 0 }))),
    ).toBe("BAD_REQUEST");
  });
});

describe("train.detail / cancel —— 归属", () => {
  it("别人的任务 → NOT_FOUND，且不去远端取消", async () => {
    const foreign = await seedJob("user-b", "job-b");
    expect(await codeOf(caller().detail({ id: String(foreign.id) }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(caller().cancel({ id: String(foreign.id) }))).toBe(
      "NOT_FOUND",
    );
    expect(trainer.cancelTraining).not.toHaveBeenCalled();
  });

  it("不存在的 id 与越权同形", async () => {
    const foreign = await seedJob("user-b", "job-b");
    expect(await codeOf(caller().detail({ id: String(foreign.id) }))).toBe(
      await codeOf(caller().detail({ id: "没这一条" })),
    );
  });

  it("自己的任务：详情读得到、取消落到编排层", async () => {
    const mine = await seedJob("user-a", "job-a");
    const res = await caller().detail({ id: String(mine.id) });
    expect(res.job.userId).toBe("user-a");
    await expect(caller().cancel({ id: String(mine.id) })).resolves.toEqual({
      ok: true,
    });
    expect(trainer.cancelTraining).toHaveBeenCalledWith(String(mine.id));
  });
});
