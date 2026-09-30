/**
 * `src/lib/core/repository*.ts` 的集成测试（ISSUE #565 覆盖率爬坡）。
 *
 * 为什么不是单测：这一层此前**零覆盖**，而它被 30+ 个 router / route / 执行链
 * 依赖 —— 它的正确性完全由「SQL 怎么写」决定（`count(列)` vs `count(*)`、
 * `onConflictDoUpdate` 的 target、`and()` 里 `undefined` 的短路、JSON 列的
 * 加解密顺序）。这些都不是靠 mock 断言调用次数能测到的。
 *
 * 因此走 `tests/helpers/test-db.ts` 的**内存 SQLite + 真 Drizzle**：
 * 用真 SQL 跑真表结构，mock 边界只有 `~/server/db`（把 db 换成内存实例）与
 * `~/server/better-auth`（仓储不鉴权，但 barrel 会连带加载）。
 *
 * 「写进去的密钥必须是密文」这类断言**故意读 `$tables` 的原始行**：断言解密后
 * 的返回值只能证明「读没问题」，证明不了「落盘不是明文」。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
import { DrizzleRepository } from "~/lib/core/repository-base";
/** `NotFoundError` 从**定义处**导入而不是 `repository-base`：基类只是 import 它
 *  （没有 re-export），`TaskWithCover` 也只经 `repository-task` 可用 —— 见本文件
 *  末尾「零消费导出」那一组断言。 */
import { NotFoundError } from "~/lib/core/errors";
import { projectRepository } from "~/lib/core/repository-project";
import { taskRepository } from "~/lib/core/repository-task";
import { workflowTemplateRepository } from "~/lib/core/repository-workflow-template";
import { workflowModelTagRepository } from "~/lib/core/repository-model-tag";
import {
  modelRepository,
  userModelConfigRepository,
} from "~/lib/core/repository-model";
import { filmRepository, filmShotRepository } from "~/lib/core/repository-film";
import { skillRepository } from "~/lib/core/repository-skill";
import { loraTrainingJobRepository } from "~/lib/core/repository-lora";
import {
  userRepository,
  llmConfigRepository,
  remoteModelRepository,
  parseAdaptersJson,
} from "~/lib/core/repository-user";
import { decryptLlmKey } from "~/lib/llm/secrets";
import { postRepository } from "~/lib/core/repository-post";
import {
  getTestDb,
  seedUser,
  seedRemoteModel,
  seedWorkflowTemplate,
} from "../../../tests/helpers/test-db";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
});

/* ────────────────────────── DrizzleRepository 基类 ────────────────────────── */

describe("DrizzleRepository 基类", () => {
  it("CRUD 四件套走真实 SQL：缺记录返回 null、更新不存在抛 NotFoundError", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    // 用 Project 作被测实体（有 id 主键、无 JSON 列的干扰）
    await projectRepository.upsertForUser("u1", {
      id: "p1",
      name: "首版",
      nodes: "[]",
      edges: "[]",
    });

    expect((await projectRepository.findById("p1"))?.name).toBe("首版");
    expect(await projectRepository.findById("nope")).toBeNull();
    expect((await projectRepository.findAll()).map((r) => r.id)).toEqual([
      "p1",
    ]);

    const updated = await projectRepository.update("p1", { name: "改名" });
    expect(updated.name).toBe("改名");

    await expect(
      projectRepository.update("nope", { name: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await projectRepository.delete("p1");
    expect(await projectRepository.findById("p1")).toBeNull();
    // delete 幂等：不存在的 id 静默忽略，不抛错
    await expect(projectRepository.delete("p1")).resolves.toBeUndefined();
  });

  it("显式传入的 id 列优先于 table.id（基类不假定两者同名）", async () => {
    // 基类的两个分支必须都被走到：`idColumn` 显式给出时走它，缺省才回落
    // `table.id`。用 Project 表 + 明确的主键列构造一个独立实例 —— 表对象与
    // 列对象来自同一张表，但契约是「传入哪列就按哪列定位」。
    const { project } = await import("~/server/db/schema");
    const repo = new DrizzleRepository<{ id: string; name: string }>(
      project,
      project.id,
    );
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await projectRepository.upsertForUser("u1", {
      id: "p-explicit",
      name: "显式主键列",
      nodes: "[]",
      edges: "[]",
    });

    expect((await repo.findById("p-explicit"))?.name).toBe("显式主键列");
    // update 走的是同一条 `this.id` 取值路径：命中则更新、未命中抛 NotFoundError
    expect((await repo.update("p-explicit", { name: "改名" })).name).toBe(
      "改名",
    );
    await expect(repo.update("nope", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("未显式传 id 列时从表定义里取 `id`（基类默认分支）", async () => {
    const repo = new DrizzleRepository<{ id: string; name: string }>(
      (await import("~/server/db/schema")).workflowModelTag,
    );
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await workflowModelTagRepository.upsertByName("u1", "动漫");
    expect(await repo.findAll()).toHaveLength(1);
  });
});

/* ────────────────────────────── Project ────────────────────────────── */

describe("ProjectRepository", () => {
  it("upsertForUser：不存在则插入、存在则整份覆盖并按 updatedAt 倒序", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await projectRepository.upsertForUser("u1", {
      id: "p1",
      name: "老项目",
      nodes: JSON.stringify([{ id: "n1" }]),
      edges: "[]",
    });
    await projectRepository.upsertForUser("u1", {
      id: "p2",
      name: "新项目",
    });

    // nodes / edges 缺省写的是**字符串** "[]"（仓储层不做 JSON 解析，
    // 读到什么类型由调用方 `parseGraphOrDefaults` 决定）—— 这里钉住原始类型，
    // 免得后来者以为它已经是数组。
    const created = await projectRepository.findById("p2");
    expect(created?.nodes).toBe("[]");
    expect(created?.edges).toBe("[]");

    const overwritten = await projectRepository.upsertForUser("u1", {
      id: "p1",
      name: "改名了",
      nodes: JSON.stringify([{ id: "n2" }]),
    });
    expect(overwritten.name).toBe("改名了");
    expect(overwritten.nodes).toBe(JSON.stringify([{ id: "n2" }]));

    const list = await projectRepository.listByUser("u1");
    expect(list.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
  });

  it("deleteForUser 只删自己的项目：别人的 id 命中 0 行", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    await projectRepository.upsertForUser("u1", { id: "p1", name: "甲" });

    await projectRepository.deleteForUser("u2", "p1");
    expect(await projectRepository.findById("p1")).not.toBeNull();
    await projectRepository.deleteForUser("u1", "p1");
    expect(await projectRepository.findById("p1")).toBeNull();
  });
});

/* ─────────────────────────────── Skill ─────────────────────────────── */

describe("SkillRepository", () => {
  const SEED = {
    name: "电影感",
    slug: "cinematic",
    description: "宽银幕",
    icon: "🎬",
    category: "style",
    promptTemplate: "{prompt}, cinematic",
    tags: ["film"],
    sortOrder: 1,
  };

  it("ensureBuiltIns 幂等：第二次调用不再重复插入", async () => {
    await skillRepository.ensureBuiltIns([SEED]);
    await skillRepository.ensureBuiltIns([{ ...SEED, slug: "other" }]);
    expect(await skillRepository.findAll()).toHaveLength(1);
    expect((await skillRepository.findBySlug("cinematic"))?.isBuiltIn).toBe(
      true,
    );
    expect(await skillRepository.findBySlug("missing")).toBeNull();
  });

  it("list 的三种筛选：默认排除停用、category=all 不筛、q 命中名字/描述/标签", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await skillRepository.ensureBuiltIns([SEED]);
    const mine = await skillRepository.createUserSkill({
      name: "我的风格",
      slug: "mine",
      description: "自定义",
      icon: "✨",
      category: "custom",
      promptTemplate: "x",
      sortOrder: 9,
      tags: ["我的"],
    });
    await skillRepository.update(mine.id, { isActive: false });

    expect((await skillRepository.list({})).map((s) => s.slug)).toEqual([
      "cinematic",
    ]);
    // category:"all" **只**跳过 category 过滤 —— isActive 过滤仍在，
    // 所以停用的那条依然不出现（要看得传 includeInactive）
    expect(
      (await skillRepository.list({ category: "all" })).map((row) => row.slug),
    ).toEqual(["cinematic"]);
    expect(
      await skillRepository.list({ category: "all", includeInactive: true }),
    ).toHaveLength(2);
    expect(
      (await skillRepository.list({ category: "style" })).map((s) => s.slug),
    ).toEqual(["cinematic"]);
    // q 命中 tags 列（JSON 字符串里搜子串）
    expect(
      (await skillRepository.list({ q: "film" })).map((s) => s.slug),
    ).toEqual(["cinematic"]);
    // 停用的那条默认不可见，但 includeInactive 可见
    expect(
      await skillRepository.list({ q: "自定义", includeInactive: true }),
    ).toHaveLength(1);
  });

  it("groupByActiveCategory 只统计启用项，count 是数字不是 BigInt", async () => {
    await skillRepository.ensureBuiltIns([SEED]);
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const s = await skillRepository.createUserSkill({
      name: "b",
      slug: "b",
      description: "d",
      icon: "✨",
      category: "style",
      promptTemplate: "x",
      sortOrder: 2,
      tags: [],
    });
    await skillRepository.update(s.id, { isActive: false });

    expect(await skillRepository.groupByActiveCategory()).toEqual([
      { category: "style", count: 1 },
    ]);
  });
});

/* ──────────────────────────── WorkflowModelTag ──────────────────────────── */

describe("WorkflowModelTagRepository", () => {
  it("upsertByName 幂等：同名复用既有行，不新增", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const first = await workflowModelTagRepository.upsertByName("u1", "SDXL");
    const second = await workflowModelTagRepository.upsertByName("u1", "SDXL");
    expect(second.id).toBe(first.id);
    expect(await workflowModelTagRepository.findAll()).toHaveLength(1);
  });

  it("listByUser 的 count 用的是 count(列)：未绑定标签显示 0 而不是 1", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await workflowModelTagRepository.upsertByName("u1", "空标签");
    const bound = await workflowModelTagRepository.upsertByName("u1", "已绑定");
    // 只给**已存在**的标签挂一个模板（seedWorkflowTemplate 的 modelTags 会自己
    // 再建同名标签行，撞 userId+name 唯一约束，所以这里走 setModelTags）
    seedWorkflowTemplate(tdb, { id: "wt1", userId: "u1" });
    await workflowTemplateRepository.setModelTags("wt1", [bound.id]);

    const rows = await workflowModelTagRepository.listByUser("u1");
    expect(rows.map(({ name, count }) => ({ name, count }))).toEqual([
      { name: "已绑定", count: 1 },
      { name: "空标签", count: 0 },
    ]);
    expect(rows.every((r) => typeof r.id === "string" && r.id !== "")).toBe(
      true,
    );
  });

  it("upsertByNames 批量补齐缺失标签并按输入顺序返回 id；重复名收敛为同一个", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const first = await workflowModelTagRepository.upsertByNames("u1", [
      "风景",
      "赛博",
      "风景",
    ]);
    expect(first).toHaveLength(3);
    expect(first[0]).toBe(first[2]);

    const again = await workflowModelTagRepository.upsertByNames("u1", [
      "风景",
      "新建",
    ]);
    expect(again[0]).toBe(first[0]);
    expect(again[1]).not.toBe(first[0]);
    expect(await workflowModelTagRepository.listByUser("u1")).toHaveLength(3);
  });

  it("rename 与 deleteById；listIdsByNames 空数组短路且不误命中他人标签", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    const a = await workflowModelTagRepository.upsertByName("u1", "甲");
    await workflowModelTagRepository.upsertByName("u2", "甲");

    expect(await workflowModelTagRepository.listIdsByNames("u1", [])).toEqual(
      [],
    );
    expect(
      await workflowModelTagRepository.listIdsByNames("u1", ["甲"]),
    ).toEqual([{ id: a.id }]);
    expect(
      await workflowModelTagRepository.findByUserAndName("u1", "乙"),
    ).toBeNull();

    const renamed = await workflowModelTagRepository.rename(a.id, "乙");
    expect(renamed).toMatchObject({ name: "乙", count: 0 });

    await workflowModelTagRepository.deleteById(a.id);
    expect(await workflowModelTagRepository.findById(a.id)).toBeNull();
  });

  it("getTemplateTagRows 空数组短路；templateHasTagIdsWhere 能组合进模板查询", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const tag = await workflowModelTagRepository.upsertByName("u1", "动漫");
    const wt = seedWorkflowTemplate(tdb, { id: "wt1", userId: "u1" });
    await workflowTemplateRepository.setModelTags("wt1", [tag.id]);

    expect(await workflowModelTagRepository.getTemplateTagRows([])).toEqual([]);
    expect(
      await workflowModelTagRepository.getTemplateTagRows([wt.id as string]),
    ).toEqual([{ templateId: "wt1", name: "动漫" }]);

    const hit = await workflowTemplateRepository.listForUser("u1", {
      where: workflowModelTagRepository.templateHasTagIdsWhere([tag.id]),
    });
    expect(hit.map((t) => t.id)).toEqual(["wt1"]);
    const miss = await workflowTemplateRepository.listForUser("u1", {
      where: workflowModelTagRepository.templateHasTagIdsWhere(["nope"]),
    });
    expect(miss).toEqual([]);
  });

  it("listForUser 只取列表页要用的列：大字段 positions 不下发", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedWorkflowTemplate(tdb, {
      id: "wt-pos",
      userId: "u1",
      positions: { "1": [10, 20] },
    });

    const rows = await workflowTemplateRepository.listForUser("u1");
    expect(rows).toHaveLength(1);
    const row: Record<string, unknown> = { ...rows[0]! };
    /* 判据是「列投影真的生效」而不是「值恰好为空」：`select()` 会把 positions
     * 取出来，投影不会 —— 两种写法下 `row.positions` 都为 `undefined`，所以这里断
     * 的是**键不在行对象上**（`"positions" in row`）。真正要拦的回归是有人把
     * `LIST_ROW_COLUMNS` 换回 `select()`，那样这个键会重新出现。 */
    expect("positions" in row).toBe(false);
    // 列表页真正要用的列一个都不能少（少一列 = 列表静默缺字段）。
    expect(row.id).toBe("wt-pos");
    expect(typeof row.taskType).toBe("string");
    expect(row.rawJson).toEqual({ nodes: [{ id: "1", type: "KSampler" }] });
  });
});

/* ────────────────────────────── WorkflowTemplate ────────────────────────────── */

describe("WorkflowTemplateRepository", () => {
  it("createImported 落库字段可读回；setModelTags 整份覆盖关联", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const created = await workflowTemplateRepository.createImported({
      userId: "u1",
      name: "工作流 A",
      taskType: "I2V",
      paramMap: { seed: "1" },
      rawJson: { raw: true },
      positions: { p: 1 },
      sourcePath: "/tmp/a.json",
      sourceChecksum: "abc",
      sourceMtime: 123,
      modes: ["flf2v", "i2v"],
      defaultMode: "i2v",
    });
    expect(created).toMatchObject({
      name: "工作流 A",
      taskType: "I2V",
      // modes 是 text(JSON) 列：仓储写入时 JSON.stringify，读回是**字符串**
      modes: '["flf2v","i2v"]',
      defaultMode: "i2v",
      sourceMtime: 123,
      sourceChecksum: "abc",
    });
    expect(created.rawJson).toEqual({ raw: true });

    const tagA = await workflowModelTagRepository.upsertByName("u1", "A");
    const tagB = await workflowModelTagRepository.upsertByName("u1", "B");
    await workflowTemplateRepository.setModelTags(created.id, [
      tagA.id,
      tagB.id,
    ]);
    expect(
      await workflowModelTagRepository.getTemplateTagRows([created.id]),
    ).toHaveLength(2);
    // 再设一次 → 旧关联被清掉（不是追加）
    await workflowTemplateRepository.setModelTags(created.id, [tagB.id]);
    expect(
      await workflowModelTagRepository.getTemplateTagRows([created.id]),
    ).toEqual([{ templateId: created.id, name: "B" }]);
    // 空数组 = 解绑全部
    await workflowTemplateRepository.setModelTags(created.id, []);
    expect(
      await workflowModelTagRepository.getTemplateTagRows([created.id]),
    ).toEqual([]);
  });

  it("findByIdForUser 隔离他人数据；relinkSourcePath 只改路径两列", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    const wt = seedWorkflowTemplate(tdb, {
      id: "wt1",
      userId: "u1",
      name: "甲的工作流",
      rawJson: { keep: true },
    });

    expect(
      await workflowTemplateRepository.findByIdForUser("u2", "wt1"),
    ).toBeNull();
    expect(
      (await workflowTemplateRepository.findByIdForUserSelect("u1", "wt1"))
        ?.name,
    ).toBe("甲的工作流");
    expect(
      (await workflowTemplateRepository.findByIdForUser("u1", "wt1"))?.id,
    ).toBe("wt1");

    await workflowTemplateRepository.relinkSourcePath("wt1", {
      sourcePath: "/tmp/new.json",
      sourceMtime: 999,
    });
    const after = await workflowTemplateRepository.findById("wt1");
    expect(after).toMatchObject({
      sourcePath: "/tmp/new.json",
      sourceMtime: 999,
      // 不带 _select 的 full row 读法仍保留 rawJson 列
      name: "甲的工作流",
    });

    expect(await workflowTemplateRepository.listByUser("u2")).toEqual([]);
    expect(
      (await workflowTemplateRepository.listByUser("u1")).map((t) => t.id),
    ).toEqual([wt.id as string]);
  });
});

/* ──────────────────────────── Model / UserModelConfig ──────────────────────────── */

describe("ModelRepository", () => {
  it("upsertScanned 按 (fileName,folder) 冲突更新；disableAllLocal 只动 LOCAL", async () => {
    await modelRepository.upsertScanned({
      fileName: "a.safetensors",
      folder: "checkpoints",
      name: "A v1",
      type: "CHECKPOINT",
      baseModel: "SDXL",
    });
    await modelRepository.upsertScanned({
      fileName: "a.safetensors",
      folder: "checkpoints",
      name: "A v2",
      type: "CHECKPOINT",
      baseModel: "SDXL",
    });
    const rows = await modelRepository.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("A v2");

    await modelRepository.disableAllLocal();
    expect(await modelRepository.findAll()).toHaveLength(1);
    expect((await modelRepository.findAll())[0]!.isAvailable).toBe(false);
  });

  it("upsertScannedMany 批量写入，冲突时按 (fileName,folder) 更新", async () => {
    await modelRepository.upsertScannedMany([
      {
        fileName: "a.safetensors",
        folder: "checkpoints",
        name: "A v1",
        type: "CHECKPOINT",
        baseModel: "SDXL",
      },
      {
        fileName: "b.safetensors",
        folder: "checkpoints",
        name: "B v1",
        type: "CHECKPOINT",
        baseModel: "SDXL",
      },
    ]);
    expect(await modelRepository.findAll()).toHaveLength(2);

    await modelRepository.upsertScannedMany([
      {
        fileName: "a.safetensors",
        folder: "checkpoints",
        name: "A v2",
        type: "CHECKPOINT",
        baseModel: "Flux",
      },
    ]);
    const rows = await modelRepository.findAll();
    expect(rows).toHaveLength(2);
    const updated = rows.find((row) => row.fileName === "a.safetensors");
    expect(updated?.name).toBe("A v2");
    expect(updated?.baseModel).toBe("Flux");
    expect(updated?.isAvailable).toBe(true);
  });

  it("upsertScannedMany 跨分片不丢行（超过单条 INSERT 的行数上限）", async () => {
    const inputs = Array.from({ length: 401 }, (_, index) => ({
      fileName: `m${index}.safetensors`,
      folder: "checkpoints",
      name: `M${index}`,
      type: "CHECKPOINT",
      baseModel: "SDXL",
    }));
    await modelRepository.upsertScannedMany(inputs);
    expect(await modelRepository.findAll()).toHaveLength(401);
  });

  it("list 只出可用项，支持 type 与 q（like）筛选、上限 300", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await modelRepository.upsertScanned({
      fileName: "a.safetensors",
      folder: "checkpoints",
      name: "DreamShaper",
      type: "CHECKPOINT",
      baseModel: "SDXL",
    });
    await modelRepository.upsertScanned({
      fileName: "b.safetensors",
      folder: "loras",
      name: "AnimeLine",
      type: "LORA",
      baseModel: "SDXL",
    });
    await modelRepository.setAvailabilityByFolder("loras", false);

    expect((await modelRepository.list()).map((m) => m.name)).toEqual([
      "DreamShaper",
    ]);
    expect(await modelRepository.list({ type: "LORA" })).toEqual([]);
    expect(
      (await modelRepository.list({ q: "dream" })).map((m) => m.name),
    ).toEqual(["DreamShaper"]);
  });

  it("listAvailableFileNamesByFolders 空数组短路、去重且排序", async () => {
    for (const [fileName, folder] of [
      ["b.safetensors", "checkpoints"],
      ["a.safetensors", "checkpoints"],
    ] as const) {
      await modelRepository.upsertScanned({
        fileName,
        folder,
        name: fileName,
        type: "CHECKPOINT",
        baseModel: "SDXL",
      });
    }
    expect(await modelRepository.listAvailableFileNamesByFolders([])).toEqual(
      [],
    );
    expect(
      await modelRepository.listAvailableFileNamesByFolders(["checkpoints"]),
    ).toEqual(["a.safetensors", "b.safetensors"]);
    expect(
      await modelRepository.listAvailableFileNamesByFolders(["missing"]),
    ).toEqual([]);
  });

  it("countsByFolder 按文件夹计数；registerLora 写入 loras 且可重复", async () => {
    await modelRepository.upsertScanned({
      fileName: "a.safetensors",
      folder: "checkpoints",
      name: "A",
      type: "CHECKPOINT",
      baseModel: "SDXL",
    });
    await modelRepository.registerLora({
      fileName: "my.safetensors",
      name: "我的 LoRA",
      baseModel: "SDXL",
      triggerWord: "mystyle",
    });

    expect(await modelRepository.countsByFolder()).toEqual({
      checkpoints: 1,
      loras: 1,
    });
    const lora = (await modelRepository.findAll()).find(
      (m) => m.type === "LORA",
    );
    expect(lora).toMatchObject({
      folder: "loras",
      category: "USER",
      isAvailable: true,
    });
    expect(lora?.description).toContain("mystyle");

    // 同名同目录重复注册 → UPDATE 而不是插入第二行
    await modelRepository.registerLora({
      fileName: "my.safetensors",
      name: "我的 LoRA v2",
      baseModel: "SDXL",
      triggerWord: "mystyle",
    });
    expect(await modelRepository.findAll()).toHaveLength(2);
  });

  it("UserModelConfigRepository：addOrEnable / patchForUser 幂等，deleteForUser 只动本人", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });

    const c = await userModelConfigRepository.addOrEnable(
      "u1",
      "loras",
      "LoRA",
    );
    expect(c).toMatchObject({ enabled: true, isCustom: true });
    await userModelConfigRepository.addOrEnable("u1", "loras", "LoRA 改名");
    expect(await userModelConfigRepository.listByUser("u1")).toHaveLength(1);

    // patchForUser 对不存在的行是「先插后冲突更新」
    const patched = await userModelConfigRepository.patchForUser(
      "u1",
      "checkpoints",
      { enabled: false, label: "CKPT" },
    );
    expect(patched).toMatchObject({ enabled: false, label: "CKPT" });

    expect(await userModelConfigRepository.listEnabledFolders()).toEqual([
      "loras",
    ]);

    await userModelConfigRepository.deleteForUser("u2", "loras");
    expect(await userModelConfigRepository.listByUser("u1")).toHaveLength(2);
    await userModelConfigRepository.deleteForUser("u1", "loras");
    expect(
      (await userModelConfigRepository.listByUser("u1")).map((r) => r.folder),
    ).toEqual(["checkpoints"]);
  });
});

/* ─────────────────────────────── Task ─────────────────────────────── */

describe("TaskRepository", () => {
  const queued = {
    userId: "u1",
    type: "TXT2IMG",
    prompt: "一只猫",
    params: { steps: 20 },
    workflowName: "wf-a",
  };

  beforeEach(() => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
  });

  it("createQueued 落 QUEUED 且可带 projectId / snapshot；listByUser 支持分页与状态过滤", async () => {
    const t1 = await taskRepository.createQueued({
      ...queued,
      projectId: "p1",
      shotId: "s7",
      workflowSnapshot: { nodes: [] },
      referenceImages: ["a.png"],
    });
    expect(t1).toMatchObject({
      status: "QUEUED",
      projectId: "p1",
      shotId: "s7",
    });
    // 归属列要真落盘、真读得回来（内存 SQLite 真库，不是 mock 的调用断言）
    expect((await taskRepository.findById(t1.id))?.shotId).toBe("s7");
    expect(t1.workflowSnapshot).toEqual({ nodes: [] });

    const t2 = await taskRepository.createQueued(queued);
    await taskRepository.finalizeFailure(t2.id, "炸了");

    expect(await taskRepository.listByUser("u1")).toHaveLength(2);
    expect(await taskRepository.listByUser("u1", { take: 1 })).toHaveLength(1);
    // skip 单独给（不带 take）：SQLite 的 OFFSET 必须跟 LIMIT，
    // 此前这里会生成 `limit -1 offset ?` 并抛 `near "offset": syntax error`
    expect(await taskRepository.listByUser("u1", { skip: 1 })).toHaveLength(1);
    expect(
      (await taskRepository.listByUser("u1", { statusList: ["FAILED"] })).map(
        (r) => r.id,
      ),
    ).toEqual([t2.id]);
    expect(
      await taskRepository.listByUser("u1", { projectId: "p1" }),
    ).toHaveLength(1);
    // 只出自己的
    expect(await taskRepository.listByUser("u2")).toEqual([]);
    // 不传归属的旧形状调用点落 NULL（不能污染成空串，否则「无归属」与「归属为空」
    // 在库里同形）——放在用例末尾：它新增一行，会改变上面的条数断言。
    expect((await taskRepository.createQueued(queued)).shotId).toBeNull();
  });

  it("listByUser includeImages 走关系装载：封面优先、sortIndex 升序", async () => {
    const t = await taskRepository.createQueued(queued);
    await taskRepository.createImages(t.id, [
      {
        localPath: "b.png",
        sortIndex: 1,
        isCover: false,
        mediaType: "image",
        seed: null,
      },
      {
        localPath: "cover.png",
        sortIndex: 5,
        isCover: true,
        mediaType: "image",
        seed: "7",
      },
      {
        localPath: "a.png",
        sortIndex: 0,
        isCover: false,
        mediaType: "image",
        seed: null,
      },
    ]);

    const [row] = await taskRepository.listByUser("u1", {
      includeImages: true,
    });
    expect(row!.images.map((i) => i.localPath)).toEqual([
      "cover.png",
      "a.png",
      "b.png",
    ]);
    // includeImages 也支持 take / skip（relational query API 那条分支，
    // 与上面普通 select 分支是**两套** LIMIT/OFFSET 生成逻辑，得各测一遍）
    expect(
      await taskRepository.listByUser("u1", {
        includeImages: true,
        take: 1,
        skip: 0,
      }),
    ).toHaveLength(1);
    expect(
      await taskRepository.listByUser("u1", { includeImages: true, skip: 1 }),
    ).toHaveLength(0);
  });

  it("findByIdForUser 隔离他人；updateStatusForUser 对他人任务抛 NotFoundError", async () => {
    const t = await taskRepository.createQueued(queued);
    expect(await taskRepository.findByIdForUser("u1", t.id)).not.toBeNull();
    expect(await taskRepository.findByIdForUser("u2", t.id)).toBeNull();

    const updated = await taskRepository.updateStatusForUser(
      "u1",
      t.id,
      "RUNNING",
      {
        progress: 10,
      },
    );
    expect(updated).toMatchObject({ status: "RUNNING", progress: 10 });
    await expect(
      taskRepository.updateStatusForUser("u2", t.id, "CANCELLED"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("findByIdWithImages / findByProjectIdWithImages 装载子表", async () => {
    const t = await taskRepository.createQueued({ ...queued, projectId: "p1" });
    await taskRepository.createImages(t.id, [
      {
        localPath: "x.png",
        sortIndex: 0,
        isCover: true,
        mediaType: "image",
        seed: null,
      },
    ]);

    const withImages = await taskRepository.findByIdWithImages(t.id);
    expect(withImages?.images).toHaveLength(1);
    // 记录**现状**：`db.query.findFirst` 未命中时返回 `undefined`，所以这里
    // 是 undefined 而不是 null（`findById` 那条路才返回 null）。调用方全部用
    // `!x` / `x?.` 兜底，行为安全；类型签名上写的是联合类型，这里钉住当前值，
    // 免得后来者按类型以为能 `=== null` 判空。
    expect(await taskRepository.findByIdWithImages("nope")).toBeUndefined();

    const byProject = await taskRepository.findByProjectIdWithImages("p1");
    expect(byProject.map((r) => r.id)).toEqual([t.id]);
    expect(byProject[0]!.images[0]!.localPath).toBe("x.png");
  });

  it("各投影查询：状态 / 快照 / 执行元信息 / 进度 / promptId", async () => {
    const t = await taskRepository.createQueued({
      ...queued,
      projectId: "p1",
      workflowSnapshot: { nodes: [1] },
      referenceImages: ["r.png"],
    });
    await taskRepository.markRunning(t.id, "pid-1");
    await taskRepository.updateProgress(t.id, 42);

    expect(await taskRepository.findStatusById(t.id)).toEqual({
      status: "RUNNING",
    });
    expect(await taskRepository.findStatusById("nope")).toBeNull();
    expect(await taskRepository.findSnapshotById(t.id)).toEqual({
      workflowSnapshot: { nodes: [1] },
      projectId: "p1",
    });
    expect(await taskRepository.findStatusAndPromptById(t.id)).toEqual({
      status: "RUNNING",
      promptId: "pid-1",
    });

    const meta = await taskRepository.findExecutionMeta(t.id);
    expect(meta).toMatchObject({
      projectId: "p1",
      prompt: "一只猫",
      workflowName: "wf-a",
      referenceImages: ["r.png"],
    });
    expect(meta?.createdAt).toBeInstanceOf(Date);

    expect(await taskRepository.findExecutionProgress(t.id)).toEqual({
      status: "RUNNING",
      progress: 42,
      resultImages: null,
      error: null,
    });
    expect(await taskRepository.findExecutionMeta("nope")).toBeNull();
  });

  it("终态写入：success / failure / cancel / reaper 各自的字段集合", async () => {
    const ok = await taskRepository.createQueued(queued);
    await taskRepository.finalizeSuccess(ok.id, {
      resultImages: ["1.png"],
      params: { steps: 30 },
      workflowSnapshot: { nodes: [2] },
    });
    const okRow = await taskRepository.findById(ok.id);
    expect(okRow).toMatchObject({ status: "SUCCEEDED", progress: 100 });
    expect(okRow?.resultImages).toEqual(["1.png"]);
    expect(okRow?.finishedAt).toBeInstanceOf(Date);

    // workflowSnapshot 未传时不覆盖（对象展开的条件分支）
    const ok2 = await taskRepository.createQueued(queued);
    await taskRepository.finalizeSuccess(ok2.id, {
      resultImages: [],
      params: {},
    });
    expect(
      (await taskRepository.findById(ok2.id))?.workflowSnapshot,
    ).toBeNull();

    const bad = await taskRepository.createQueued(queued);
    await taskRepository.finalizeFailure(bad.id, "上游 500", [{ node: 1 }]);
    const badRow = await taskRepository.findById(bad.id);
    expect(badRow).toMatchObject({ status: "FAILED", error: "上游 500" });
    expect(badRow?.validationErrors).toBe(JSON.stringify([{ node: 1 }]));

    // validationErrors 空数组 → 落 null（不是 "[]"）
    const bad2 = await taskRepository.createQueued(queued);
    await taskRepository.finalizeFailure(bad2.id, "x", []);
    expect(
      (await taskRepository.findById(bad2.id))?.validationErrors,
    ).toBeNull();

    const c = await taskRepository.createQueued(queued);
    await taskRepository.cancel(c.id);
    expect((await taskRepository.findById(c.id))?.status).toBe("CANCELLED");

    const r = await taskRepository.createQueued(queued);
    await taskRepository.finalizeFromReaper(r.id, "FAILED", "进程没了");
    expect(await taskRepository.findById(r.id)).toMatchObject({
      status: "FAILED",
      error: "进程没了",
    });
  });

  it("replaceLogs 写日志列；listStaleUnownedQueued / listStaleRunning 的判决条件", async () => {
    const t = await taskRepository.createQueued(queued);
    await taskRepository.replaceLogs(t.id, [{ msg: "1" }]);
    expect((await taskRepository.findById(t.id))?.logs).toEqual([{ msg: "1" }]);
    // 写不存在的行被 .catch 吞掉，不抛错
    await expect(
      taskRepository.replaceLogs("nope", []),
    ).resolves.toBeUndefined();

    const cutoff = new Date(Date.now() + 60_000);
    /* 本刀改掉的判据：cutoff 放到未来也只该捞出「没有任何宿主片会领」的行。
     *  `createQueued` 不写 claimedBy ⇒ NULL 归 inline 片，那是一条健康的等待态行，
     *  不再被扫成死信（ISSUE #1204；正面命中形状在 impl 的契约测里）。 */
    const staleQueued = await taskRepository.listStaleUnownedQueued(cutoff, 10);
    expect(staleQueued).toEqual([]);

    // 有 promptId 的排队任务不算「从未开工」；RUNNING + 有 promptId 才算 stale running
    await taskRepository.markRunning(t.id, "pid-1");
    expect(await taskRepository.listStaleUnownedQueued(cutoff, 10)).toEqual([]);
    expect(
      (await taskRepository.listStaleRunning(cutoff, 10)).map((r) => r.id),
    ).toEqual([t.id]);

    // cutoff 在过去 / take 限制
    expect(await taskRepository.listStaleRunning(new Date(0), 10)).toEqual([]);
    expect(await taskRepository.listStaleRunning(cutoff, 10)).toHaveLength(1);
  });
});

/* ─────────────────────────────── Film ─────────────────────────────── */

describe("FilmRepository / FilmShotRepository", () => {
  const CREATE = {
    userId: "u1",
    title: "短片甲",
    script: "第一幕",
    type: "short_video",
    size: '{"w":1280,"h":720}',
    fps: 16,
    framesPerShot: 49,
    subtitleOn: true,
  };

  beforeEach(() => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
  });

  it("create 落 PARSING；listByUser 带镜头数并按时间倒序、隔离他人", async () => {
    const f1 = await filmRepository.create(CREATE);
    const f2 = await filmRepository.create({ ...CREATE, title: "短片乙" });
    await filmShotRepository.createMany(f2.id, [
      { order: 0, prompt: "镜头 1", params: {} },
      { order: 1, prompt: "镜头 2", params: {} },
    ]);

    const list = await filmRepository.listByUser("u1");
    expect(list.map((r) => r.title).sort()).toEqual(["短片乙", "短片甲"]);
    expect(list.find((r) => r.title === "短片乙")!.shotCount).toBe(2);
    expect(list.find((r) => r.title === "短片甲")!.shotCount).toBe(0);
    expect(await filmRepository.listByUser("u2")).toEqual([]);
    expect(f1.status).toBe("PARSING");
    expect(f1.subtitleOn).toBe(true);
  });

  it("findByIdForUser 的 includeShots 走关系装载并按 order 升序", async () => {
    const f = await filmRepository.create(CREATE);
    await filmShotRepository.createMany(f.id, [
      { order: 2, prompt: "三", heading: "C", negative: "x", params: { a: 1 } },
      { order: 0, prompt: "一", params: {} },
    ]);

    expect(await filmRepository.findByIdForUser("u2", f.id)).toBeNull();
    const plain = await filmRepository.findByIdForUser("u1", f.id);
    expect(plain).not.toBeNull();
    expect((plain as Record<string, unknown>).shots).toBeUndefined();

    const withShots = await filmRepository.findByIdForUser("u1", f.id, {
      includeShots: true,
    });
    expect(
      (withShots as unknown as { shots: Array<{ order: number }> }).shots.map(
        (s) => s.order,
      ),
    ).toEqual([0, 2]);
    expect(
      await filmRepository.findByIdForUser("u1", "nope", {
        includeShots: true,
      }),
    ).toBeNull();
  });

  it("状态机写入：generating / progress / composing / done / failed / cancelled / 日志追加", async () => {
    const f = await filmRepository.create(CREATE);

    await filmRepository.appendLog(f.id, { t: 1, level: "info", msg: "开始" });
    await filmRepository.appendLog(f.id, {
      t: 2,
      level: "progress",
      msg: "50%",
    });
    expect((await filmRepository.findById(f.id))?.logs).toEqual([
      { t: 1, level: "info", msg: "开始" },
      { t: 2, level: "progress", msg: "50%" },
    ]);

    await filmRepository.markGenerating(f.id);
    expect(await filmRepository.findById(f.id)).toMatchObject({
      status: "GENERATING",
      progress: 0,
    });
    await filmRepository.updateProgress(f.id, 55);
    expect((await filmRepository.findById(f.id))?.progress).toBe(55);
    await filmRepository.markComposing(f.id);
    expect(await filmRepository.findById(f.id)).toMatchObject({
      status: "COMPOSING",
      progress: 90,
    });
    await filmRepository.markDone(f.id, "/tmp/final.mp4");
    expect(await filmRepository.findById(f.id)).toMatchObject({
      status: "DONE",
      progress: 100,
      finalVideo: "/tmp/final.mp4",
    });
    await filmRepository.markFailed(f.id, "合片失败");
    expect(await filmRepository.findById(f.id)).toMatchObject({
      status: "FAILED",
      error: "合片失败",
    });
    await filmRepository.markCancelled(f.id);
    expect(await filmRepository.findById(f.id)).toMatchObject({
      status: "CANCELLED",
      error: "已取消",
    });
  });

  it("镜头状态流转与两类筛选：status / onlyWithVideo", async () => {
    const f = await filmRepository.create(CREATE);
    await filmShotRepository.createMany(f.id, [
      { order: 0, prompt: "甲", params: {} },
      { order: 1, prompt: "乙", params: {} },
    ]);
    const shots = await filmShotRepository.listByFilm(f.id);
    expect(shots.map((s) => s.status)).toEqual(["IDLE", "IDLE"]);

    await filmShotRepository.markQueued(shots[0]!.id, "task-1");
    expect(
      (await filmShotRepository.listByFilm(f.id, { status: "QUEUED" })).map(
        (s) => s.id,
      ),
    ).toEqual([shots[0]!.id]);

    await filmShotRepository.updateFromTask(shots[0]!.id, {
      status: "SUCCEEDED",
      progress: 100,
      videoPath: "/tmp/shot0.mp4",
      duration: 3.2,
    });
    await filmShotRepository.updateFromTask(shots[1]!.id, {
      status: "FAILED",
      progress: 0,
    });
    expect(
      (await filmShotRepository.listByFilm(f.id, { onlyWithVideo: true })).map(
        (s) => s.id,
      ),
    ).toEqual([shots[0]!.id]);
    expect(await filmShotRepository.listActiveWithTask(f.id)).toEqual([]);
    expect((await filmShotRepository.listByFilm(f.id))[0]).toMatchObject({
      videoPath: "/tmp/shot0.mp4",
      duration: 3.2,
    });

    // updateFromTask 不给 videoPath → 保留原值（`?? undefined` 不覆盖）
    await filmShotRepository.updateFromTask(shots[0]!.id, {
      status: "SUCCEEDED",
      progress: 100,
    });
    expect((await filmShotRepository.listByFilm(f.id))[0]!.videoPath).toBe(
      "/tmp/shot0.mp4",
    );
  });

  it("markAllActiveFailed 只动 QUEUED/RUNNING；markFailed 单条；listActiveWithTask", async () => {
    const f = await filmRepository.create(CREATE);
    await filmShotRepository.createMany(f.id, [
      { order: 0, prompt: "甲", params: {} },
      { order: 1, prompt: "乙", params: {} },
      { order: 2, prompt: "丙", params: {} },
    ]);
    const shots = await filmShotRepository.listByFilm(f.id);
    await filmShotRepository.markQueued(shots[0]!.id, "t0");
    await filmShotRepository.markQueued(shots[1]!.id, "t1");
    await filmShotRepository.updateFromTask(shots[2]!.id, {
      status: "SUCCEEDED",
      progress: 100,
    });

    expect(
      (await filmShotRepository.listActiveWithTask(f.id)).map((s) => s.taskId),
    ).toEqual(["t0", "t1"]);
    await filmShotRepository.markFailed(shots[0]!.id);
    await filmShotRepository.markAllActiveFailed(f.id);
    expect(
      (await filmShotRepository.listByFilm(f.id)).map((s) => s.status),
    ).toEqual(["FAILED", "FAILED", "SUCCEEDED"]);
    expect(await filmShotRepository.listActiveWithTask(f.id)).toEqual([]);
  });
});

/* ──────────────────────── LoraTrainingJob ──────────────────────── */

describe("LoraTrainingJobRepository", () => {
  const QUEUED = {
    userId: "u1",
    name: "风格 A",
    baseModel: "SDXL",
    triggerWord: "mystyle",
    datasetImages: ["1.png"],
    resolution: 512,
    steps: 1500,
    batchSize: 4,
    learningRate: 0.0001,
    rankDim: 32,
    networkAlpha: 16,
    optimizer: "AdamW8bit",
    scheduler: "cosine",
    seed: 1,
  };

  beforeEach(() => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
  });

  it("createQueued / listByUser / 归属隔离", async () => {
    const j = await loraTrainingJobRepository.createQueued(QUEUED);
    expect(j).toMatchObject({ status: "QUEUED", progress: 0, classWord: null });
    expect(await loraTrainingJobRepository.listByUser("u1")).toHaveLength(1);
    expect(await loraTrainingJobRepository.listByUser("u2")).toEqual([]);
    expect(
      await loraTrainingJobRepository.findByIdForUser("u2", j.id),
    ).toBeNull();
    expect(
      (await loraTrainingJobRepository.findByIdForUser("u1", j.id))?.name,
    ).toBe("风格 A");
  });

  it("findByIdForUser 传 select 走投影分支；findStatusById", async () => {
    const { loraTrainingJob } = await import("~/server/db/schema");
    const j = await loraTrainingJobRepository.createQueued(QUEUED);

    const projected = await loraTrainingJobRepository.findByIdForUser(
      "u1",
      j.id,
      { id: loraTrainingJob.id, status: loraTrainingJob.status },
    );
    expect(projected).toEqual({ id: j.id, status: "QUEUED" });
    // 投影分支也保持归属隔离
    expect(
      await loraTrainingJobRepository.findByIdForUser("u2", j.id, {
        id: loraTrainingJob.id,
      }),
    ).toBeNull();

    expect(await loraTrainingJobRepository.findStatusById(j.id)).toEqual({
      status: "QUEUED",
    });
    expect(await loraTrainingJobRepository.findStatusById("nope")).toBeNull();
  });

  it("日志追加与状态机；updateProgress 把进度夹在 0~100", async () => {
    const j = await loraTrainingJobRepository.createQueued(QUEUED);
    await loraTrainingJobRepository.appendLog(j.id, {
      t: 1,
      level: "info",
      msg: "炼丹开始",
    });
    await loraTrainingJobRepository.appendLog(j.id, {
      t: 2,
      level: "progress",
      msg: "第 1 步",
    });
    expect((await loraTrainingJobRepository.findById(j.id))?.logs).toHaveLength(
      2,
    );

    await loraTrainingJobRepository.markRunning(j.id);
    expect(await loraTrainingJobRepository.findStatusById(j.id)).toEqual({
      status: "RUNNING",
    });

    await loraTrainingJobRepository.updateProgress(j.id, 150);
    expect((await loraTrainingJobRepository.findById(j.id))?.progress).toBe(
      100,
    );
    await loraTrainingJobRepository.updateProgress(j.id, -5);
    expect((await loraTrainingJobRepository.findById(j.id))?.progress).toBe(0);

    await loraTrainingJobRepository.markDone(j.id, "out.safetensors");
    expect(await loraTrainingJobRepository.findById(j.id)).toMatchObject({
      status: "DONE",
      progress: 100,
      outputName: "out.safetensors",
    });

    await loraTrainingJobRepository.markFailed(j.id, "炸了");
    expect((await loraTrainingJobRepository.findById(j.id))?.error).toBe(
      "炸了",
    );
    await loraTrainingJobRepository.markCancelled(j.id);
    expect((await loraTrainingJobRepository.findById(j.id))?.status).toBe(
      "CANCELLED",
    );
  });
});

/* ─────────────────── 用户 / LLM 配置 / 远端模型 ─────────────────── */

describe("UserRepository", () => {
  it("按 email 查、建号、改邮箱与密码", async () => {
    expect(await userRepository.findByEmail("a@test.dev")).toBeNull();

    const created = await userRepository.createUser({
      email: "a@test.dev",
      name: "甲",
      password: "hash-1",
    });
    expect(created).toMatchObject({ email: "a@test.dev", password: "hash-1" });

    expect((await userRepository.findByEmail("a@test.dev"))?.id).toBe(
      created.id,
    );
    expect(
      (await userRepository.updateEmail(created.id, "b@test.dev")).email,
    ).toBe("b@test.dev");
    expect(
      (await userRepository.updatePassword(created.id, "hash-2")).password,
    ).toBe("hash-2");
    expect(await userRepository.findByEmail("a@test.dev")).toBeNull();
  });
});

describe("LlmConfigRepository", () => {
  it("首次 upsert 走 insert：缺省值补齐，返回明文、落库密文", async () => {
    const cfg = await llmConfigRepository.upsertSingleton({
      apiKey: "sk-plain",
    });
    expect(cfg).toMatchObject({
      id: "singleton",
      provider: "local",
      model: "",
      temperature: 0.7,
      maxTokens: 2048,
      apiKey: "sk-plain",
    });

    // 关键断言：DB 里存的不是明文（这条只有读原始行才能证明）
    const raw = tdb.$tables.llmConfig[0]!.apiKey as string;
    expect(raw).not.toBe("sk-plain");
    expect(raw.startsWith("enc:v1:")).toBe(true);

    // findSingleton 解密回明文
    expect((await llmConfigRepository.findSingleton())?.apiKey).toBe(
      "sk-plain",
    );
  });

  it("二次 upsert 走 update：只覆盖传入字段，未传字段保持原值", async () => {
    await llmConfigRepository.upsertSingleton({
      provider: "local",
      model: "llama3",
      apiKey: "sk-1",
      temperature: 0.3,
    });
    const patched = await llmConfigRepository.upsertSingleton({
      model: "qwen2",
      temperatureByTask: { chat: 0.9 },
    });
    expect(patched).toMatchObject({
      provider: "local",
      model: "qwen2",
      apiKey: "sk-1",
      temperature: 0.3,
      temperatureByTask: { chat: 0.9 },
    });
  });

  it("extraModels 里远端条目的独立 apiKey 也加密；字符串候选原样保留", async () => {
    const cfg = await llmConfigRepository.upsertSingleton({
      extraModels: [
        "local-candidate",
        {
          name: "rm",
          baseUrl: "https://r/v1",
          apiKey: "sk-remote",
          kind: "chat",
        },
      ],
    });
    expect(cfg.extraModels).toEqual([
      "local-candidate",
      {
        name: "rm",
        baseUrl: "https://r/v1",
        apiKey: "sk-remote",
        kind: "chat",
      },
    ]);

    const stored = JSON.stringify(tdb.$tables.llmConfig[0]!.extraModels);
    expect(stored).toContain("local-candidate");
    expect(stored).not.toContain("sk-remote");
    expect(stored).toContain("enc:v1:");
  });

  it("显式 apiKey=null 会清空密钥（undefined 才是不动）", async () => {
    await llmConfigRepository.upsertSingleton({ apiKey: "sk-1" });
    const cleared = await llmConfigRepository.upsertSingleton({ apiKey: null });
    expect(cleared.apiKey).toBeNull();
    expect(tdb.$tables.llmConfig[0]!.apiKey).toBeNull();
  });
});

describe("RemoteModelRepository", () => {
  it("replaceAll 是全量同步：新增 / 更新 / 删除，并去重与裁剪空白", async () => {
    await remoteModelRepository.replaceAll([
      {
        name: " 甲 ",
        baseUrl: " https://a/v1 ",
        apiKey: " sk-a ",
        kind: "chat",
      },
      { name: "甲", baseUrl: "https://dup/v1" },
      { name: "   " },
    ]);
    let rows = await remoteModelRepository.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "甲",
      baseUrl: "https://a/v1",
      kind: "chat",
    });
    // 密钥**不以明文落盘**（`llmConfig` 那条路径一直如此；`remoteModel` 此前直接
    // 落明文，而 `db.sqlite` 会被 next build 复制进 standalone 产物 —— 硬规则 17）
    expect(rows[0]!.apiKey).not.toBe("sk-a");
    expect(String(rows[0]!.apiKey).startsWith("enc:v1:")).toBe(true);
    expect(decryptLlmKey(rows[0]!.apiKey)).toBe("sk-a");

    /* 第二次保存没带 `apiKey` 键（= 服务端脱敏下发后原样回写的形态）→ 继承既有那把，
     * 不是清空。这正是台账 A11 修掉的语义，与 `workshopAdapters` 的继承同源。 */
    rows = await remoteModelRepository.replaceAll([
      { name: "甲", baseUrl: "https://b/v1" },
      { name: "乙", kind: "video" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["甲", "乙"]);
    expect(rows.find((r) => r.name === "甲")).toMatchObject({
      baseUrl: "https://b/v1",
    });
    expect(decryptLlmKey(rows.find((r) => r.name === "甲")!.apiKey)).toBe(
      "sk-a",
    );
    expect(rows.find((r) => r.name === "乙")?.apiKey).toBeNull();
    expect(rows.find((r) => r.name === "乙")?.kind).toBe("video");

    // 未给出的条目被删
    rows = await remoteModelRepository.replaceAll([{ name: "乙" }]);
    expect(rows.map((r) => r.name)).toEqual(["乙"]);
    // 空条目列表 → 不新增、不报错
    expect(await remoteModelRepository.replaceAll([])).toEqual([]);
  });

  it("replaceAll 保留已有的工坊适配器（不被配置同步清掉）", async () => {
    const adapters = [
      {
        mode: "t2i",
        inputs: [{ type: "prompt", field: "prompt" }],
        outputField: "data.0.url",
        endpointPath: "/v1/images/generations",
      },
    ];
    const created = await remoteModelRepository.replaceAll([{ name: "甲" }]);
    await remoteModelRepository.saveWorkshopAdapters("甲", adapters as never);
    expect(await remoteModelRepository.getWorkshopAdapters("甲")).toEqual([
      {
        mode: "T2I",
        inputs: [{ type: "prompt", field: "prompt" }],
        outputField: "data.0.url",
        endpointPath: "/v1/images/generations",
      },
    ]);

    await remoteModelRepository.replaceAll([
      { name: "甲", baseUrl: "https://new/v1" },
    ]);
    expect(await remoteModelRepository.getWorkshopAdapters("甲")).toEqual([
      {
        mode: "T2I",
        inputs: [{ type: "prompt", field: "prompt" }],
        outputField: "data.0.url",
        endpointPath: "/v1/images/generations",
      },
    ]);
    expect((await remoteModelRepository.list())[0]!.id).toBe(created[0]!.id);
  });

  it("replaceAll 的 apiKey 三态：缺键=继承既有、null/空串=清空、非空串=写新值（台账 A11）", async () => {
    /* 上一条验的是「保存一次会不会把密钥弄丢」，这一条把三种意图分开钉死。
     * 起因：`getConfigForClient` 下发的条目不带 `apiKey`（A4 的脱敏），而设置页保存
     * 是整份覆盖 —— 两态写法（「没带」和「清空」都成 null）会让用户原样保存一次
     * 就把所有远端密钥清掉。同一条批量语句里 `workshopAdapters` 早就在继承了，
     * 语义必须对齐。 */
    await remoteModelRepository.replaceAll([
      { name: "甲", baseUrl: "https://a/v1", apiKey: "sk-keep-me" },
    ]);
    const cipherOf = () =>
      remoteModelRepository.findByName("甲").then((r) => r?.apiKey ?? null);

    // ① 缺键 → 继承既有那份
    const before = await cipherOf();
    await remoteModelRepository.replaceAll([
      { name: "甲", baseUrl: "https://a2/v1" },
    ]);
    const after = await cipherOf();
    /* 继承必须是**原样搬运**：重新加密会换 IV、字节必然不同，而那份「二次加密」的
     * 东西读出来就解不开（`decryptLlmKey` 只解一层）。所以这里比的不是「能解出同一个
     * 明文」，而是「一个字节都没变」。 */
    expect(after).toBe(before);
    expect(decryptLlmKey(after)).toBe("sk-keep-me");

    // ② 显式 null → 清空（这才是「用户按了清除密钥」的形状）
    await remoteModelRepository.replaceAll([{ name: "甲", apiKey: null }]);
    expect(await cipherOf()).toBeNull();

    // ③ 空串 / 全空白同样按清空处理（表单里「把字段删空」的形态）
    await remoteModelRepository.replaceAll([
      { name: "甲", apiKey: "sk-again" },
    ]);
    expect(decryptLlmKey(await cipherOf())).toBe("sk-again");
    await remoteModelRepository.replaceAll([{ name: "甲", apiKey: "   " }]);
    expect(await cipherOf()).toBeNull();
  });

  it("findByName / 适配器读写 / 模型不存在时的空返回", async () => {
    expect(await remoteModelRepository.findByName("nope")).toBeNull();
    expect(await remoteModelRepository.getWorkshopAdapters("nope")).toEqual([]);
    expect(
      await remoteModelRepository.saveWorkshopAdapters("nope", []),
    ).toEqual([]);

    await remoteModelRepository.replaceAll([{ name: "甲" }]);
    expect((await remoteModelRepository.findByName("甲"))?.name).toBe("甲");
    expect(await remoteModelRepository.getWorkshopAdapters("甲")).toEqual([]);
  });

  it("parseAdaptersJson 对坏数据（非 JSON / 非数组）给空数组而不是抛错", () => {
    expect(parseAdaptersJson(null)).toEqual([]);
    expect(parseAdaptersJson("")).toEqual([]);
    expect(parseAdaptersJson("{")).toEqual([]);
    expect(parseAdaptersJson("null")).toEqual([]);
    expect(parseAdaptersJson('{"a":1}')).toEqual([]);
  });

  it("seedRemoteModel 落库的是密文（测试基建与生产写入同形）", async () => {
    seedRemoteModel(tdb, { name: "甲", apiKey: "sk-seed" });
    const raw = tdb.$tables.remoteModels[0]!.apiKey as string;
    expect(raw).not.toBe("sk-seed");
    expect(raw.startsWith("enc:v1:")).toBe(true);
  });
});

/* ─────────────────────────────── Post ─────────────────────────────── */

describe("PostRepository", () => {
  it("getLatest 取最新一条；create 落库", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    expect(await postRepository.getLatest()).toBeNull();

    await postRepository.create({ name: "旧公告", createdById: "u1" });
    await new Promise((r) => setTimeout(r, 5));
    const latest = await postRepository.create({
      name: "新公告",
      createdById: "u1",
    });
    expect(latest.name).toBe("新公告");
    expect(latest.createdAt).toBeInstanceOf(Date);
    expect((await postRepository.getLatest())?.id).toBe(latest.id);
  });
});
