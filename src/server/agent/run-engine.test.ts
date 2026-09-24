/**
 * run 执行引擎单测（Phase 6 · P6-2）——只测**循环控制**（计划→执行→写回→审批/暂停/完成），
 * 用真实 productionRepository（内存 test-db）+ mock 掉 LLM / 生图 / 出片这些外部能力。
 * 真正的模型/ComfyUI 端到端产出需在有模型与 ComfyUI 的环境另行验证。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeLLM, completeLLMStructured, getLLMConfig } = vi.hoisted(() => ({
  completeLLM: vi.fn(async (_cfg: unknown, _msgs: unknown) => "# 生成的剧本"),
  completeLLMStructured: vi.fn<
    (cfg: unknown, msgs: unknown, schema: unknown) => Promise<unknown[]>
  >(async () => []),
  getLLMConfig: vi.fn(async () => ({})),
}));
vi.mock("~/lib/llm/server", () => ({
  getLLMConfig,
  completeLLM,
  completeLLMStructured,
}));
vi.mock("~/lib/llm/prompts", () => ({
  buildScriptMarkdownMessages: () => [{ role: "user", content: "x" }],
}));
const synthesizeFirstFrame = vi.hoisted(() =>
  vi.fn(async (_opts: unknown) => "/api/generated/shot.png"),
);
vi.mock("~/lib/comfyui/firstframe", () => ({ synthesizeFirstFrame }));
// 引擎经服务端成片编排起片（createFilmFromProject + startFilm），mock 掉避免真跑管线。
vi.mock("~/server/film/orchestrator", () => ({
  createFilmFromProject: vi.fn(async () => ({ id: "film-1", shots: 1 })),
  startFilm: vi.fn(async () => undefined),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));

import { productionRepository } from "~/lib/core/repository-production";
import {
  normalizeProductionRun,
  type ProductionRun,
} from "~/lib/production/run-types";
import { advanceRunLoop } from "~/server/agent/run-engine";
import { getTestDb, seedUser } from "../../../tests/helpers/test-db";

const tdb = getTestDb();
const USER = "user-a";
const PROJ = "proj_run";

/** 建/改生产数据行：内容列 + progress + run 列（run 直接写库，模拟 start 之后的状态）。 */
async function seed(
  content: Partial<{
    scriptMarkdown: string;
    characters: unknown[];
    shots: unknown[];
    rendered: boolean;
  }>,
  run: Partial<ProductionRun>,
) {
  const { rendered, ...rest } = content;
  await productionRepository.upsertForUser(USER, {
    id: PROJ,
    title: "T",
    type: "short_video",
    tone: "",
    logline: "",
    scriptMarkdown: rest.scriptMarkdown ?? "",
    scenes: [],
    characters: rest.characters ?? [],
    shots: rest.shots ?? [],
    progress: { stage: "script", rendered: Boolean(rendered) },
  });
  const row = await productionRepository.getForUser(USER, PROJ);
  const base = normalizeProductionRun(row?.run);
  await productionRepository.updateRun(USER, PROJ, { ...base, ...run });
}

const readRow = () => productionRepository.getForUser(USER, PROJ);

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: USER, email: "a@test.dev" });
});

describe("advanceRunLoop", () => {
  it("非 running（idle/paused/cancelled）→ 立即让位，不做任何动作", async () => {
    await seed({}, { status: "paused" });
    await advanceRunLoop(USER, PROJ);
    expect(completeLLM).not.toHaveBeenCalled();
    expect((await readRow())!.run).toMatchObject({ status: "paused" });
  });

  it("stage 模式：跑完剧本这一步就停下等点头，不越界", async () => {
    await seed({}, { status: "running", approvalMode: "stage" });
    await advanceRunLoop(USER, PROJ);
    expect(completeLLM).toHaveBeenCalledTimes(1);
    const row = await readRow();
    expect(row!.scriptMarkdown).toBe("# 生成的剧本");
    expect(normalizeProductionRun(row!.run)).toMatchObject({
      status: "awaiting_approval",
      awaitingStage: "script",
      stage: "script",
    });
    // 执行日志：这一步追加了一条 generate_script 成功记录（含产出摘要）
    const steps = normalizeProductionRun(row!.run).log;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "generate_script",
      ok: true,
    });
    expect(steps[0]!.detail).toMatch(/^已生成剧本（\d+ 字）$/);
  });

  it("角色步：completeLLMStructured 产出写入 characters 后停在角色阶段等确认", async () => {
    completeLLMStructured.mockResolvedValueOnce([
      { name: "阿宁", appearance: "短发" },
    ]);
    await seed(
      { scriptMarkdown: "# 剧本" },
      { status: "running", approvalMode: "stage" },
    );
    await advanceRunLoop(USER, PROJ);
    const row = await readRow();
    expect((row!.characters as { name: string }[])[0]).toMatchObject({
      name: "阿宁",
    });
    expect(normalizeProductionRun(row!.run).awaitingStage).toBe("character");
  });

  it("分镜步：产出 shots（带 index/rev/prompt），停在分镜阶段", async () => {
    completeLLMStructured.mockResolvedValueOnce([
      { sceneHeading: "海边", description: "日景" },
      { description: "特写" },
    ]);
    await seed(
      { scriptMarkdown: "# 剧本", characters: [{ id: "c1" }] },
      { status: "running", approvalMode: "stage" },
    );
    await advanceRunLoop(USER, PROJ);
    const row = await readRow();
    const shots = row!.shots as {
      index: number;
      prompt: string;
      status: string;
      rev: number;
    }[];
    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({
      index: 0,
      prompt: "日景",
      status: "idle",
      rev: 0,
    });
    expect(normalizeProductionRun(row!.run).awaitingStage).toBe("storyboard");
  });

  it("auto 模式：逐镜生图（synthesizeFirstFrame）→ 记 rev 快照 → 已 rendered 则直达 done，不逐步停", async () => {
    await seed(
      {
        scriptMarkdown: "# 剧本",
        characters: [{ id: "c1" }],
        shots: [{ id: "a", index: 0, prompt: "p", rev: 0 }],
        rendered: true, // 生图后规划器直接判 done（避开出片等待分支）
      },
      { status: "running", approvalMode: "auto", imageWorkflowId: "wf-img" },
    );
    await advanceRunLoop(USER, PROJ);
    const row = await readRow();
    expect(synthesizeFirstFrame).toHaveBeenCalledTimes(1);
    // 自主流水线出图带 randomizeSeed，让「抽卡重生成」同提示词也能换种子出不同图。
    expect(synthesizeFirstFrame).toHaveBeenCalledWith(
      expect.objectContaining({ randomizeSeed: true, workflowId: "wf-img" }),
    );
    const shot = (row!.shots as { imageUrl?: string; status: string }[])[0];
    expect(shot).toMatchObject({
      status: "done",
      imageUrl: "/api/generated/shot.png",
    });
    const run = normalizeProductionRun(row!.run);
    expect(run.processedShotRev).toEqual({ a: 0 });
    expect(run.status).toBe("done");
  });

  it("生图缺 imageWorkflowId → 该步失败落 failed", async () => {
    await seed(
      {
        scriptMarkdown: "# 剧本",
        characters: [{ id: "c1" }],
        shots: [{ id: "a", index: 0, prompt: "p" }],
      },
      { status: "running", approvalMode: "stage" }, // 无 imageWorkflowId
    );
    await advanceRunLoop(USER, PROJ);
    const run = normalizeProductionRun((await readRow())!.run);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/图类工作流/);
  });

  it("剧本模型空返回 → 落 failed，带可行动原因", async () => {
    completeLLM.mockResolvedValueOnce("");
    await seed({}, { status: "running", approvalMode: "stage" });
    await advanceRunLoop(USER, PROJ);
    const run = normalizeProductionRun((await readRow())!.run);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/剧本/);
  });

  it("无生产数据行 → 直接返回，不抛", async () => {
    await expect(advanceRunLoop(USER, "no_such")).resolves.toBeUndefined();
    expect(completeLLM).not.toHaveBeenCalled();
  });
});
