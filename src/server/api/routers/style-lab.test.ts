/**
 * `styleLab` router 的闸门用例。
 *
 * 这一屏只「存试验定义」，所以判据集中在四件事：
 *   · **就绪闸走真数据** —— `create` 会按 workflowId 真查工作流行，再用
 *     `deriveEncapsulationStatus` 判「该模式必备口是否都有落点」；查不到行是
 *     NOT_FOUND、行在但没就绪是 BAD_REQUEST（两个码不同，界面才分得开「选错工作流」
 *     与「工作流没配好」）。这里把那份就绪判据 mock 掉，是为了分别喂两种结论 ——
 *     真造一份「已就绪」的 workflowIO/paramMap 与这一刀的判据无关，那部分另有回归。
 *   · **形状闸在落库之前** —— name 空 / workflowId 空是 zod BAD_REQUEST，一次库都不写。
 *   · **列表派生计数** —— cellCount / doneCount 由服务端从格子聚合；本批不落格子，
 *     恒为 0/0，但这一形状必须给出来（视图不再自己数）。
 *   · **软删幂等** —— 删掉后不再出现在 list；对已删的再删给
 *     NOT_FOUND，而不是静默成功。
 *
 * mock 边界：`~/server/db`（内存库 + 真 Drizzle）、`~/server/better-auth`、
 * `~/lib/core/logger`、以及 `deriveEncapsulationStatus`（就绪结论的注入点）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createCallerFactory } from "~/server/api/trpc";
import {
  deriveEncapsulationStatus,
} from "~/lib/workshop/workshop-encapsulation-status";
import { styleLabRouter } from "~/server/api/routers/style-lab";
import {
  getTestDb,
  seedUser,
  seedWorkflowTemplate,
  type TestDb,
} from "../../../../tests/helpers/test-db";
import { makeCtx, errorEnvelope } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(styleLabRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

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

const createInput = (over: Record<string, unknown> = {}) => ({
  name: "冷艳 × 赛博",
  workflowId: "wf-1",
  mode: "T2I",
  styles: ["赛博朋克", "暗黑"],
  traits: { temperament: ["清冷孤傲"] },
  params: {},
  ...over,
});

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedWorkflowTemplate(tdb, {
    id: "wf-1",
    userId: "user-a",
    name: "文生图基础流",
    modes: "[]",
    defaultMode: "T2I",
    workflowIO: {},
    paramMap: null,
  });
  vi.mocked(deriveEncapsulationStatus).mockReturnValue(readyStatus);
});

describe("styleLab.list —— 空表与派生计数", () => {
  it("新建前后各数一次，计数由服务端从格子聚合（本批不落格子，恒 0/0）", async () => {
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

  it("成功创建返回映射后的试验行", async () => {
    const res = await caller().create(createInput());
    expect(res.experiment.name).toBe("冷艳 × 赛博");
    expect(res.experiment.workflowId).toBe("wf-1");
  });
});

describe("styleLab.softDelete —— 软删与不存在同形", () => {
  it("软删后列表不再暴露它，且重复删是 NOT_FOUND 而不是「又成功删一遍」", async () => {
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
});
