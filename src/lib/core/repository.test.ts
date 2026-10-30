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
/** 行类型只作类型用：`import type` 会被擦掉，不影响本文件「先 mock `~/server/db`
 *  再取 schema」的加载顺序。 */
import type { Project } from "~/server/db/schema";
/** `NotFoundError` 从**定义处**导入而不是 `repository-base`：基类只是 import 它
 *  （没有 re-export），`TaskWithCover` 也只经 `repository-task` 可用 —— 见本文件
 *  末尾「零消费导出」那一组断言。 */
import { NotFoundError } from "~/lib/core/errors";
import { projectRepository } from "~/lib/core/repository-project";
import { taskRepository } from "~/lib/core/repository-task";
import { workflowTemplateRepository } from "~/lib/core/repository-workflow-template";
import { workflowModelTagRepository } from "~/lib/core/repository-model-tag";
import { modelRepository, userModelConfigRepository } from "~/lib/core/repository-model";
import { filmRepository, filmShotRepository } from "~/lib/core/repository-film";
import { skillRepository } from "~/lib/core/repository-skill";
import {
  userRepository,
  llmConfigRepository,
  remoteModelRepository,
  saveLlmSettings,
  parseAdaptersJson,
} from "~/lib/core/repository-user";
import { decryptLlmKey } from "~/lib/llm/secrets";
import type { DbExecutor } from "~/lib/core/repository-executor-types";
import { SETTINGS_DB_WRITE } from "~/lib/retry-policy";
import { postRepository } from "~/lib/core/repository-post";
import {
  armStatementFailure,
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
    expect((await projectRepository.findAll()).map((r) => r.id)).toEqual(["p1"]);

    const updated = await projectRepository.update("p1", { name: "改名" });
    expect(updated.name).toBe("改名");

    await expect(projectRepository.update("nope", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

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
    const repo = new DrizzleRepository<{ id: string; name: string }>(project, project.id);
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await projectRepository.upsertForUser("u1", {
      id: "p-explicit",
      name: "显式主键列",
      nodes: "[]",
      edges: "[]",
    });

    expect((await repo.findById("p-explicit"))?.name).toBe("显式主键列");
    // update 走的是同一条 `this.id` 取值路径：命中则更新、未命中抛 NotFoundError
    expect((await repo.update("p-explicit", { name: "改名" })).name).toBe("改名");
    await expect(repo.update("nope", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("未显式传 id 列时从表定义里取 `id`（基类默认分支）", async () => {
    const repo = new DrizzleRepository<{ id: string; name: string }>(
      (await import("~/server/db/schema")).workflowModelTag,
    );
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await workflowModelTagRepository.upsertByName("u1", "动漫");
    expect(await repo.findAll()).toHaveLength(1);
  });

  it("create 落库并 returning 整行：默认列由库补，基类不自己拼", async () => {
    /* 基类的 create 此前零执行 —— 子类都各自重写 insert（要补自己的语义列），
     * 于是「基类那套标准 CRUD」实际只有三件套有人跑过。这条钉两件事：`.returning()`
     * 回的是**落库那一行**（`nodes`/`edges` 由 SQL 默认值补出来，入参里根本没有它们），
     * 而不是把入参原样吐回去。 */
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const { project } = await import("~/server/db/schema");
    const repo = new DrizzleRepository<Project>(project, project.id);

    /* `as Project` 是基类签名自己的形状：`create(entity: T)` 收整行类型，落库却只给
     * 必填列 —— 想证明「默认列由库补」就必须能少给字段，这里不放宽基类的签名。 */
    const created = await repo.create(
      /* SAFETY: 类型断言已复核 */ {
        id: "p-create",
        userId: "u1",
        name: "基类写入",
      } as Project,
    );

    expect(created).toMatchObject({ id: "p-create", name: "基类写入" });
    expect(created.nodes).toBe("[]");
    expect(created.edges).toBe("[]");
    expect(created.createdAt).toBeInstanceOf(Date);
    const raw = tdb.$tables.projects.find((r) => r.id === "p-create");
    expect(raw?.nodes).toBe("[]");
    expect((await repo.findById("p-create"))?.name).toBe("基类写入");
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
    expect((await skillRepository.findBySlug("cinematic"))?.isBuiltIn).toBe(true);
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

    expect((await skillRepository.list({})).map((s) => s.slug)).toEqual(["cinematic"]);
    // category:"all" **只**跳过 category 过滤 —— isActive 过滤仍在，
    // 所以停用的那条依然不出现（要看得传 includeInactive）
    expect((await skillRepository.list({ category: "all" })).map((row) => row.slug)).toEqual([
      "cinematic",
    ]);
    expect(await skillRepository.list({ category: "all", includeInactive: true })).toHaveLength(2);
    expect((await skillRepository.list({ category: "style" })).map((s) => s.slug)).toEqual([
      "cinematic",
    ]);
    // q 命中 tags 列（JSON 字符串里搜子串）
    expect((await skillRepository.list({ q: "film" })).map((s) => s.slug)).toEqual(["cinematic"]);
    // 停用的那条默认不可见，但 includeInactive 可见
    expect(await skillRepository.list({ q: "自定义", includeInactive: true })).toHaveLength(1);
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
    expect(rows.every((r) => typeof r.id === "string" && r.id !== "")).toBe(true);
  });

  it("upsertByNames 批量补齐缺失标签并按输入顺序返回 id；重复名收敛为同一个", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    const first = await workflowModelTagRepository.upsertByNames("u1", ["风景", "赛博", "风景"]);
    expect(first).toHaveLength(3);
    expect(first[0]).toBe(first[2]);

    const again = await workflowModelTagRepository.upsertByNames("u1", ["风景", "新建"]);
    expect(again[0]).toBe(first[0]);
    expect(again[1]).not.toBe(first[0]);
    expect(await workflowModelTagRepository.listByUser("u1")).toHaveLength(3);
  });

  it("rename 与 deleteById；listIdsByNames 空数组短路且不误命中他人标签", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    const a = await workflowModelTagRepository.upsertByName("u1", "甲");
    await workflowModelTagRepository.upsertByName("u2", "甲");

    expect(await workflowModelTagRepository.listIdsByNames("u1", [])).toEqual([]);
    expect(await workflowModelTagRepository.listIdsByNames("u1", ["甲"])).toEqual([{ id: a.id }]);
    expect(await workflowModelTagRepository.findByUserAndName("u1", "乙")).toBeNull();

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
      await workflowModelTagRepository.getTemplateTagRows([
        /* SAFETY: 类型断言已复核 */ wt.id as string,
      ]),
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
    await workflowTemplateRepository.setModelTags(created.id, [tagA.id, tagB.id]);
    expect(await workflowModelTagRepository.getTemplateTagRows([created.id])).toHaveLength(2);
    // 再设一次 → 旧关联被清掉（不是追加）
    await workflowTemplateRepository.setModelTags(created.id, [tagB.id]);
    expect(await workflowModelTagRepository.getTemplateTagRows([created.id])).toEqual([
      { templateId: created.id, name: "B" },
    ]);
    // 空数组 = 解绑全部
    await workflowTemplateRepository.setModelTags(created.id, []);
    expect(await workflowModelTagRepository.getTemplateTagRows([created.id])).toEqual([]);
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

    expect(await workflowTemplateRepository.findByIdForUser("u2", "wt1")).toBeNull();
    expect((await workflowTemplateRepository.findByIdForUser("u1", "wt1"))?.name).toBe(
      "甲的工作流",
    );
    expect((await workflowTemplateRepository.findByIdForUser("u1", "wt1"))?.id).toBe("wt1");

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
    expect((await workflowTemplateRepository.listByUser("u1")).map((t) => t.id)).toEqual([
      /* SAFETY: 类型断言已复核 */ wt.id as string,
    ]);
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

    expect((await modelRepository.list()).map((m) => m.name)).toEqual(["DreamShaper"]);
    expect(await modelRepository.list({ type: "LORA" })).toEqual([]);
    expect((await modelRepository.list({ q: "dream" })).map((m) => m.name)).toEqual([
      "DreamShaper",
    ]);
  });

  it("listAvailableFileNamesByFolders 空数组短路、去重且排序", async () => {
    for (const [fileName, folder] of /* SAFETY: 类型断言已复核 */ [
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
    expect(await modelRepository.listAvailableFileNamesByFolders([])).toEqual([]);
    expect(await modelRepository.listAvailableFileNamesByFolders(["checkpoints"])).toEqual([
      "a.safetensors",
      "b.safetensors",
    ]);
    expect(await modelRepository.listAvailableFileNamesByFolders(["missing"])).toEqual([]);
  });

  it("countsByFolder 只数可用项、按文件夹分组", async () => {
    await modelRepository.upsertScanned({
      fileName: "a.safetensors",
      folder: "checkpoints",
      name: "A",
      type: "CHECKPOINT",
      baseModel: "SDXL",
    });
    await modelRepository.upsertScanned({
      fileName: "b.safetensors",
      folder: "loras",
      name: "B",
      type: "LORA",
      baseModel: "SDXL",
    });
    // 不可用的一行不进计数
    await modelRepository.setAvailabilityByFolder("loras", false);

    expect(await modelRepository.countsByFolder()).toEqual({ checkpoints: 1 });
  });

  it("UserModelConfigRepository：addOrEnable / patchForUser 幂等，deleteForUser 只动本人", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });

    const c = await userModelConfigRepository.addOrEnable("u1", "loras", "LoRA");
    expect(c).toMatchObject({ enabled: true, isCustom: true });
    await userModelConfigRepository.addOrEnable("u1", "loras", "LoRA 改名");
    expect(await userModelConfigRepository.listByUser("u1")).toHaveLength(1);

    // patchForUser 对不存在的行是「先插后冲突更新」
    const patched = await userModelConfigRepository.patchForUser("u1", "checkpoints", {
      enabled: false,
      label: "CKPT",
    });
    expect(patched).toMatchObject({ enabled: false, label: "CKPT" });

    expect(await userModelConfigRepository.listEnabledFolders()).toEqual(["loras"]);

    await userModelConfigRepository.deleteForUser("u2", "loras");
    expect(await userModelConfigRepository.listByUser("u1")).toHaveLength(2);
    await userModelConfigRepository.deleteForUser("u1", "loras");
    expect((await userModelConfigRepository.listByUser("u1")).map((r) => r.folder)).toEqual([
      "checkpoints",
    ]);
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
      (await taskRepository.listByUser("u1", { statusList: ["FAILED"] })).map((r) => r.id),
    ).toEqual([t2.id]);
    expect(await taskRepository.listByUser("u1", { projectId: "p1" })).toHaveLength(1);
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
    expect(row!.images.map((i) => i.localPath)).toEqual(["cover.png", "a.png", "b.png"]);
    // includeImages 也支持 take / skip（relational query API 那条分支，
    // 与上面普通 select 分支是**两套** LIMIT/OFFSET 生成逻辑，得各测一遍）
    expect(
      await taskRepository.listByUser("u1", {
        includeImages: true,
        take: 1,
        skip: 0,
      }),
    ).toHaveLength(1);
    expect(await taskRepository.listByUser("u1", { includeImages: true, skip: 1 })).toHaveLength(0);
  });

  it("findByIdForUser 隔离他人；updateStatusForUser 对他人任务抛 NotFoundError", async () => {
    const t = await taskRepository.createQueued(queued);
    expect(await taskRepository.findByIdForUser("u1", t.id)).not.toBeNull();
    expect(await taskRepository.findByIdForUser("u2", t.id)).toBeNull();

    const updated = await taskRepository.updateStatusForUser("u1", t.id, "RUNNING", {
      progress: 10,
    });
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
    expect((await taskRepository.findById(ok2.id))?.workflowSnapshot).toBeNull();

    const bad = await taskRepository.createQueued(queued);
    await taskRepository.finalizeFailure(bad.id, "上游 500", [{ node: 1 }]);
    const badRow = await taskRepository.findById(bad.id);
    expect(badRow).toMatchObject({ status: "FAILED", error: "上游 500" });
    expect(badRow?.validationErrors).toBe(JSON.stringify([{ node: 1 }]));

    // validationErrors 空数组 → 落 null（不是 "[]"）
    const bad2 = await taskRepository.createQueued(queued);
    await taskRepository.finalizeFailure(bad2.id, "x", []);
    expect((await taskRepository.findById(bad2.id))?.validationErrors).toBeNull();

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
    await expect(taskRepository.replaceLogs("nope", [])).resolves.toBeUndefined();

    const cutoff = new Date(Date.now() + 60_000);
    /* 本刀改掉的判据：cutoff 放到未来也只该捞出「没有任何宿主片会领」的行。
     *  `createQueued` 不写 claimedBy ⇒ NULL 归 inline 片，那是一条健康的等待态行，
     *  不再被扫成死信（ISSUE #1204；正面命中形状在 impl 的契约测里）。 */
    const staleQueued = await taskRepository.listStaleUnownedQueued(cutoff, 10);
    expect(staleQueued).toEqual([]);

    // 有 promptId 的排队任务不算「从未开工」；RUNNING + 有 promptId 才算 stale running
    await taskRepository.markRunning(t.id, "pid-1");
    expect(await taskRepository.listStaleUnownedQueued(cutoff, 10)).toEqual([]);
    expect((await taskRepository.listStaleRunning(cutoff, 10)).map((r) => r.id)).toEqual([t.id]);

    // cutoff 在过去 / take 限制
    expect(await taskRepository.listStaleRunning(new Date(0), 10)).toEqual([]);
    expect(await taskRepository.listStaleRunning(cutoff, 10)).toHaveLength(1);
  });
});

/* ─────────────── Task：状态栏两格 / 分页装载 / 领取三口 ─────────────── */

/**
 * 这一组补的是 `repository-task.ts` 里**只有类入口才走得到**的那几行。
 *
 * 为什么单独一组（而不是接着上面那条写）：上面那批已经用真 SQL 覆盖了 12 个
 * delegate 与四套 LIMIT/OFFSET 形状，剩下没执行者的恰好都是「另一个消费者」在用 ——
 * 底部状态栏那两格（刻意跨归属）、成片监看的批量进度、SSE 轮询的轻投影，
 * 以及执行宿主的领取 / 只读窥视 / 载荷读。全库覆盖表里
 * `countQueuedForStatusBar` 整块空白就是这一组补的。
 */
describe("TaskRepository 的状态栏 / 分页装载 / 领取三口", () => {
  const queued = {
    userId: "u1",
    type: "TXT2IMG",
    prompt: "一条镜头",
    params: {},
    workflowName: "wf-wire",
  };

  beforeEach(() => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
  });

  it("includeImages 且只给 skip：第二页照样装着 images（LIMIT -1 OFFSET 那条语法）", async () => {
    /* `task.list` 每次都带 includeImages，而 media 过滤那条路径是按 skip 补页的 ——
     * 这一条走的不是 `db.query` 关系装载，而是「普通 select 取页 + 按 id 装载」。
     * 上一条用例里那条路只跑到「这一页是空的」，于是 attachImages 的真实装载
     * 一次都没被执行过：那条分支要是写成不带 images，界面上只是少一张封面，
     * 而 SQL 一声不响。 */
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await taskRepository.createQueued({
        ...queued,
        prompt: `第 ${i} 条`,
      });
      await taskRepository.createImages(t.id, [
        {
          localPath: `${t.id}.png`,
          sortIndex: 0,
          isCover: true,
          mediaType: "image",
          seed: null,
        },
      ]);
      ids.push(t.id);
    }

    const all = await taskRepository.listByUser("u1", { includeImages: true });
    expect(all).toHaveLength(3);
    const page = await taskRepository.listByUser("u1", {
      includeImages: true,
      skip: 1,
    });
    expect(page).toHaveLength(2);
    /*  createdAt 同刻时哪一条被跳过由 SQL 决定，所以按集合判；
     *  但「少一条」与「每行都带 images」这两件事必须当场成立。 */
    for (const row of page) {
      expect(ids).toContain(row.id);
      expect(row.images.map((image) => image.localPath)).toEqual([`${row.id}.png`]);
    }
    expect(new Set(page.map((row) => row.id)).size).toBe(2);
    expect(all.filter((row) => !page.some((p) => p.id === row.id))).toHaveLength(1);
  });

  it("状态栏两格跨归属：host 那条也计入排队数、也认作「当前在跑」", async () => {
    const inlineTask = await taskRepository.createQueued(queued);
    const hostTask = await taskRepository.createQueued({
      ...queued,
      claimedBy: "host",
    });
    /* 这一格答的是「本应用」而不是「我这个片区」：判据里刻意没有归属条件，
     * 一旦有人补上 owner，host 执行的队列在这格上就永远是 0。 */
    expect(await taskRepository.countQueuedForStatusBar()).toBe(2);

    await taskRepository.claimNextQueued("host", 1);
    const bar = await taskRepository.findRunningForStatusBar();
    expect(bar?.id).toBe(hostTask.id);
    expect(bar?.claimedAt).toBeInstanceOf(Date);
    expect(bar?.workflowName).toBe("wf-wire");
    /* 大列不拉：状态栏 2s 一轮，取的是那条小载荷（主模型要从图里认）。 */
    expect(bar).not.toHaveProperty("workflowSnapshot");
    expect(bar).not.toHaveProperty("logs");
    expect(bar).toHaveProperty("execPayload");

    expect(await taskRepository.countQueuedForStatusBar()).toBe(1);
    /* inline 那条还排着队 → 在跑的只有 host 那一条。 */
    expect(await taskRepository.findStatusById(inlineTask.id)).toMatchObject({
      status: "QUEUED",
    });
  });

  it("findExecutionProgressMany：一条 IN 拿到多条进度；空数组短路", async () => {
    const a = await taskRepository.createQueued(queued);
    const b = await taskRepository.createQueued({
      ...queued,
      prompt: "另一条",
    });
    await taskRepository.updateProgress(a.id, 30);

    const got = await taskRepository.findExecutionProgressMany([a.id, b.id, "nope"]);
    expect(got).toHaveLength(2);
    expect(got.find((row) => row.id === a.id)).toMatchObject({
      status: "RUNNING",
      progress: 30,
    });
    expect(got.find((row) => row.id === b.id)).toMatchObject({ progress: 0 });
    /* 空数组不发 SQL：成片监看每 4s 一轮，镜头为空的轮次不该打一条 `IN ()`。 */
    expect(await taskRepository.findExecutionProgressMany([])).toEqual([]);
  });

  it("findSseSnapshot：轮询要的列都在，唯独 workflowSnapshot 不拉", async () => {
    const t = await taskRepository.createQueued({
      ...queued,
      workflowSnapshot: { nodes: [1] },
    });
    await taskRepository.replaceLogs(t.id, [{ level: "info", msg: "起图" }]);
    await taskRepository.replaceRawCli(t.id, ["CLI 第一行", "第二行"]);

    const snap = await taskRepository.findSseSnapshot(t.id);
    expect(snap).toMatchObject({
      status: "QUEUED",
      progress: 0,
      error: null,
      workflowName: "wf-wire",
      logs: [{ level: "info", msg: "起图" }],
    });
    /* 「轻投影」的边界是不含 workflowSnapshot（整份工作流，单行可达数 MB），
     * 而 progressNode / logs 是 3-C 之后轮询要读的。写成整行查询不报错，
     * 只是每条 SSE 连接每 3s 白拉一份工作流。 */
    expect(snap).not.toHaveProperty("workflowSnapshot");
    expect(snap).toHaveProperty("progressNode");
    /* rawCli 是同一条轮询要的另一列：写进去读得回来，未知行给 null。 */
    expect(await taskRepository.findRawCli(t.id)).toEqual(["CLI 第一行", "第二行"]);
    expect(await taskRepository.findRawCli("nope")).toBeNull();
    expect(await taskRepository.findSseSnapshot("nope")).toBeNull();
  });

  it("领取三口：只读窥视不改状态、领取按归属分片、载荷读只认自己那片", async () => {
    const nullShard = await taskRepository.createQueued(queued);
    const hostShard = await taskRepository.createQueued({
      ...queued,
      claimedBy: "host",
    });

    /* 只读窥视：给出 id 而**不领走**（领了不跑正是这一刀要消灭的形态）。 */
    expect(await taskRepository.listQueuedIds("inline", 5)).toEqual([nullShard.id]);
    expect(await taskRepository.listQueuedIds("host", 5)).toEqual([hostShard.id]);
    expect(await taskRepository.findStatusById(nullShard.id)).toMatchObject({
      status: "QUEUED",
    });

    const claimed = await taskRepository.claimNextQueued("inline", 1);
    expect(claimed).toEqual([nullShard.id]);
    expect(await taskRepository.findStatusById(nullShard.id)).toMatchObject({
      status: "RUNNING",
    });
    expect(await taskRepository.findStatusById(hostShard.id)).toMatchObject({
      status: "QUEUED",
    });

    /* `findExecJob` 用的是**绑片**的归属谓词（本进程的 impl 是 inline）：
     * 这条读出来的就是要交给 ComfyUI 执行的图，跨片读到别人的载荷等于替别的宿主起跑。 */
    expect(await taskRepository.findExecJob(hostShard.id)).toBeNull();
    expect(await taskRepository.findExecJob(nullShard.id)).toMatchObject({
      workflowName: "wf-wire",
    });
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

  it("listByStatus 空集合直接返回空数组", async () => {
    /* 实测（变异复核 M6）：把 `statuses.length === 0` 那道早退摘掉，这条**照样绿** ——
     * drizzle 对空数组不生成语法错的 SQL，SQLite 数出零行。所以这一格钉的是
     * **调用方面向的契约**（恢复扫描传空集合拿到空数组、不抛），不是「挡住一条坏 SQL」；
     * 那道守卫的真实价值是省一次查询 + 不依赖方言对空 `in` 的处理。 */
    await filmRepository.create(CREATE);
    expect(await filmRepository.listByStatus([])).toEqual([]);
  });

  it("listByStatus 按 createdAt 升序（先起先续）、且**刻意不看归属**", async () => {
    const first = await filmRepository.create({
      ...CREATE,
      title: "先落库",
      userId: "u1",
    });
    const second = await filmRepository.create({
      ...CREATE,
      title: "后落库",
      userId: "u2",
    });
    await filmRepository.markDone(first.id, "/tmp/a.mp4");
    await filmRepository.markDone(second.id, "/tmp/b.mp4");

    const queued = await filmRepository.listByStatus(["PARSING", "GENERATING"]);
    /* 两条都是终态 ⇒ 一条都不该被列出来（这条扫描的语义是「还有哪些行该有人推进」）。 */
    expect(queued).toEqual([]);

    /* 把**先落库那一行**的时间戳推到更晚：自然扫描顺序（插入序）与 `createdAt`
     * 序就此相反 —— 少了 `orderBy` 时这条必红（实测 M7），否则它只是碰巧跟着插入序绿。 */
    await filmRepository.update(first.id, {
      createdAt: new Date(second.createdAt.getTime() + 60_000),
    });
    await filmRepository.markGenerating(first.id);
    await filmRepository.markGenerating(second.id);

    const resumed = await filmRepository.listByStatus(["GENERATING"]);
    /* 跨 userId：`first` 属 u1、`second` 属 u2，两条都要被列出 —— 补上归属条件
     * 就把「另一个用户那次没人续跑」的窗口重新打开了，注释里写明了不要。 */
    expect(resumed.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(resumed.every((r) => r.status === "GENERATING")).toBe(true);
    expect(Object.keys(resumed[0]!).sort()).toEqual(["id", "status"]);
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
    expect(/* SAFETY: 类型断言已复核 */ (plain as Record<string, unknown>).shots).toBeUndefined();

    const withShots = await filmRepository.findByIdForUser("u1", f.id, {
      includeShots: true,
    });
    expect(
      /* SAFETY: 类型断言已复核 */ (
        withShots as unknown as { shots: Array<{ order: number }> }
      ).shots.map((s) => s.order),
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
      (await filmShotRepository.listByFilm(f.id, { status: "QUEUED" })).map((s) => s.id),
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
      (await filmShotRepository.listByFilm(f.id, { onlyWithVideo: true })).map((s) => s.id),
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
    expect((await filmShotRepository.listByFilm(f.id))[0]!.videoPath).toBe("/tmp/shot0.mp4");
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

    expect((await filmShotRepository.listActiveWithTask(f.id)).map((s) => s.taskId)).toEqual([
      "t0",
      "t1",
    ]);
    await filmShotRepository.markFailed(shots[0]!.id);
    await filmShotRepository.markAllActiveFailed(f.id);
    expect((await filmShotRepository.listByFilm(f.id)).map((s) => s.status)).toEqual([
      "FAILED",
      "FAILED",
      "SUCCEEDED",
    ]);
    expect(await filmShotRepository.listActiveWithTask(f.id)).toEqual([]);
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

    expect((await userRepository.findByEmail("a@test.dev"))?.id).toBe(created.id);
    expect((await userRepository.updateEmail(created.id, "b@test.dev")).email).toBe("b@test.dev");
    expect((await userRepository.updatePassword(created.id, "hash-2")).password).toBe("hash-2");
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
    const raw = /* SAFETY: 类型断言已复核 */ tdb.$tables.llmConfig[0]!.apiKey as string;
    expect(raw).not.toBe("sk-plain");
    expect(raw.startsWith("enc:v1:")).toBe(true);

    // findSingleton 解密回明文
    expect((await llmConfigRepository.findSingleton())?.apiKey).toBe("sk-plain");
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
    expect(decryptLlmKey(rows.find((r) => r.name === "甲")!.apiKey)).toBe("sk-a");
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
    await remoteModelRepository.saveWorkshopAdapters(
      "甲",
      /* SAFETY: 类型断言已复核 */ adapters as never,
    );
    expect(await remoteModelRepository.getWorkshopAdapters("甲")).toEqual([
      {
        mode: "T2I",
        inputs: [{ type: "prompt", field: "prompt" }],
        outputField: "data.0.url",
        endpointPath: "/v1/images/generations",
      },
    ]);

    await remoteModelRepository.replaceAll([{ name: "甲", baseUrl: "https://new/v1" }]);
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
    const cipherOf = () => remoteModelRepository.findByName("甲").then((r) => r?.apiKey ?? null);

    // ① 缺键 → 继承既有那份
    const before = await cipherOf();
    await remoteModelRepository.replaceAll([{ name: "甲", baseUrl: "https://a2/v1" }]);
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
    await remoteModelRepository.replaceAll([{ name: "甲", apiKey: "sk-again" }]);
    expect(decryptLlmKey(await cipherOf())).toBe("sk-again");
    await remoteModelRepository.replaceAll([{ name: "甲", apiKey: "   " }]);
    expect(await cipherOf()).toBeNull();
  });

  /* ── 事务性（ISSUE #2586）──────────────────────────────────────────
   * 这三条是本仓**第一处事务站点**的锚点，没有现成形状可照抄，所以每条自带反证：
   * 「中途失败」与「撞锁」都必须由测试宿主的语句钩子造出来（`armStatementFailure`），
   * 而不是靠构造某种会让 SQL 失败的输入 —— 约束面已经被仓储自己去重挡掉了，
   * 拿巧合当夹具的话，这条用例会在某一天因为仓储变好而静默失去意义。 */
  it("replaceAll 把读、删、写三条语句都放进同一个事务（顺序由宿主的 SQL trace 判）", async () => {
    await remoteModelRepository.replaceAll([{ name: "甲" }]);
    tdb.$sqlTrace.length = 0;
    await remoteModelRepository.replaceAll([{ name: "乙" }]);

    const head = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase();
    const heads = tdb.$sqlTrace.map(head);
    const commit = heads.indexOf("commit");
    expect(commit, "事务要收在 commit 上").toBeGreaterThan(0);
    /* begin 与 commit **之间**只许有那三条：读（继承来源）、删、批量 upsert。
     * 写成整段等式而不是逐条 toBeGreaterThan，是因为「多一条藏在事务里」与
     * 「少一条被挪到外面」都必须当场红——只比顺序的话，把 commit 之前塞进
     * 一次额外读也照样绿。 */
    expect(heads.slice(0, commit + 1)).toEqual(["begin", "select", "delete", "insert", "commit"]);
    expect(heads.at(-1), "返回给调用方的那份是 commit **之后**重读的").toBe("select");
  });

  it("第二条写失败 ⇒ 第一条不残留：整份配置与其中的密钥都还在（#2586 的正案）", async () => {
    await remoteModelRepository.replaceAll([
      { name: "甲", baseUrl: "https://a/v1", apiKey: "sk-lost" },
      { name: "丙", baseUrl: "https://c/v1" },
    ]);
    /* 注入一个**非锁族**错误：那样有界重试会「认不出原因就原样抛」，
     * 这条用例测到的才是回滚，而不是重试成功后又落了一遍。 */
    const gate = armStatementFailure((sql) => sql.toLowerCase().startsWith("insert"));
    const failure = await remoteModelRepository
      .replaceAll([{ name: "乙" }])
      .then(() => null)
      .catch(
        (e: unknown) =>
          /* SAFETY: 类型断言已复核 */ e as {
            message: string;
            cause?: { message?: string };
          },
      );
    expect(failure, "第二条写失败必须让整条调用失败得看得见").not.toBeNull();
    /* drizzle 会把宿主抛的东西包成 `Failed query: …`，原因挂在 `cause` 上——
     * 比的正是这两段合起来（只看 message 会读不到注入的那句，那正是 #1250 记的形态）。
     * `failure` 若真是 null，拼出来的是空串、下面那条照样红，所以这里用 `?.` 不是放宽断言。 */
    expect(
      `${failure?.message ?? ""} ${failure?.cause?.message ?? ""}`,
      "包装层不许把原因吞掉",
    ).toContain("测试注入");
    expect(gate.hits(), "非锁族错误不许重试，只该撞一次").toBe(1);

    const rows = await remoteModelRepository.list();
    expect(rows.map((r) => r.name).sort()).toEqual(["丙", "甲"]);
    expect(
      decryptLlmKey(rows.find((r) => r.name === "甲")?.apiKey ?? null),
      "删掉的那条带着加密密钥，回滚不成就会永久找不回来",
    ).toBe("sk-lost");
  });

  it("起事务撞锁 ⇒ 按 SETTINGS_DB_WRITE 的预算重试，成功后一次落定", async () => {
    const busy = () => {
      const e = new Error("database is locked");
      /* SAFETY: 类型断言已复核 */ (e as { code?: string }).code = "SQLITE_BUSY";
      return e;
    };
    /* 前 maxAttempts-1 次让 `begin` 撞锁，第三次放行：既验「认锁码才重试」，
     * 也验重试的是**整条事务**而不是某一条语句（每次重试都重新起一次 begin）。 */
    const gate = armStatementFailure(
      (sql) => sql.trim().toLowerCase() === "begin",
      busy,
      SETTINGS_DB_WRITE.maxAttempts - 1,
    );
    const rows = await remoteModelRepository.replaceAll([{ name: "甲" }]);
    expect(gate.hits()).toBe(SETTINGS_DB_WRITE.maxAttempts - 1);
    expect(rows.map((r) => r.name)).toEqual(["甲"]);
  });

  it("findByName / 适配器读写 / 模型不存在时的空返回", async () => {
    expect(await remoteModelRepository.findByName("nope")).toBeNull();
    expect(await remoteModelRepository.getWorkshopAdapters("nope")).toEqual([]);
    expect(await remoteModelRepository.saveWorkshopAdapters("nope", [])).toEqual([]);

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
    const raw = /* SAFETY: 类型断言已复核 */ tdb.$tables.remoteModels[0]!.apiKey as string;
    expect(raw).not.toBe("sk-seed");
    expect(raw.startsWith("enc:v1:")).toBe(true);
  });
});

/* ── saveLlmSettings：一次设置保存跨两张表（ISSUE #2592）─────────────────────
 * #2586 那组判的是 `replaceAll` **内部**三条语句；这一组判的是**调用它的那条链**
 * 跨 `remoteModel` ⇄ `llmConfig` 那一层。这一族在本仓没有现成锚点可照抄，所以
 * 每条都自带反证：「中途失败」一律由测试宿主的语句钩子造出来。
 *
 * ⚠️ 单子期望 3 里那句「并发两次保存」在这里只能是**串行**：宿主是一条
 * `:memory:` 连接，第二次 `begin` 会直接撞上第一条还没提交的事务并报 SQLite 自己的
 * 错 —— 那是测试的形状，不是生产的并发语义（libsql 每次事务绑连接池里的不同连接）。
 * 真正要的那条性质（「别的保存在这两次写之间插不进来」）由下面那条 trace 用例证明：
 * 一次保存的 `begin…commit` 之间语句连续、且不出现第二个 begin。 */
describe("saveLlmSettings —— 远端清单与 llmConfig 单例在同一次事务里落定", () => {
  const head = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase();
  /** 只认「往 llmConfig 写」那两条；同一张表上那条 select 是 read-modify-write 的读。 */
  const llmConfigWrite = (sql: string) => /^(insert into|update)\s+"llmconfig"/i.test(sql);
  const remoteModelInsert = (sql: string) => /^insert into "remotemodel"/i.test(sql);

  /** 起态：库里已有一份单例配置与两条远端模型 —— 回滚的断言要有对照物。 */
  async function seedState(): Promise<void> {
    await llmConfigRepository.upsertSingleton({
      model: "旧模型",
      apiKey: "sk-old",
    });
    await remoteModelRepository.replaceAll([
      { name: "甲", baseUrl: "https://a/v1", apiKey: "sk-a" },
      { name: "丙", baseUrl: "https://c/v1" },
    ]);
  }
  const names = async () => (await remoteModelRepository.list()).map((r) => r.name).sort();

  it("一次保存的全部语句落在同一个 begin…commit 里（顺序整段相等，不多不少）", async () => {
    await seedState();
    tdb.$sqlTrace.length = 0;
    await saveLlmSettings({
      model: "新模型",
      extraModels: ["llama3", { name: "乙", baseUrl: "https://b/v1", apiKey: "sk-b" }],
    });
    expect(tdb.$sqlTrace.map(head)).toEqual([
      "begin",
      /* remoteModel 那一侧：读（继承来源）→ 删（本次未给出的甲、丙）→ 批量 upsert */
      "select",
      "delete",
      "insert",
      /* llmConfig 那一侧：读—改—写也在同一次 begin…commit 内。
       * 写成**整段等式**而不是「都比第一个 commit 小」，是因为两种改法都必须当场红：
       * ① 拆回两个事务（本单的症状）⇒ 数组里会多出第二个 begin…commit 段；
       * ② 在提交后补一次重读 ⇒ 尾巴上多一条 select。
       * （#2586 那一族用的是 slice，那两种写法在那里都判不出第二条事务 —— 这里不沿用。）
       * ⚠️ 本条**不**证明「单例那次读用的是事务而不是模块级连接」：宿主只有一条连接，
       * 两者在 trace 上逐字相同。那一格由下面那条按身份判的用例钉。 */
      "select",
      "update",
      "commit",
    ]);
  });

  it("llmConfig 那一写失败 ⇒ remoteModel 表保持原样（含密钥），单例行也没动", async () => {
    await seedState();
    /* 注入**非锁族**错误：有界重试会「认不出原因就原样抛」，这条测到的才是回滚。 */
    const gate = armStatementFailure(llmConfigWrite);
    const failure = await saveLlmSettings({
      model: "坏模型",
      extraModels: [{ name: "乙", baseUrl: "https://b/v1", apiKey: "sk-b" }],
    })
      .then(() => null)
      .catch(
        (e: unknown) =>
          /* SAFETY: 类型断言已复核 */ e as {
            message: string;
            cause?: { message?: string };
          },
      );
    expect(failure, "第二条写失败必须让整条保存失败得看得见").not.toBeNull();
    expect(
      `${failure?.message ?? ""} ${failure?.cause?.message ?? ""}`,
      "包装层不许把原因吞掉",
    ).toContain("测试注入");
    expect(gate.hits(), "非锁族错误不许重试，整条事务只该撞一次").toBe(1);

    /* 这就是 #2592 的症状本体：此前 `replaceAll` 已经提交，这里会是「远端清单已换」。 */
    const rows = await remoteModelRepository.list();
    expect(rows.map((r) => r.name).sort()).toEqual(["丙", "甲"]);
    expect(
      decryptLlmKey(rows.find((r) => r.name === "甲")?.apiKey ?? null),
      "删掉的那条带着加密密钥，回滚不成就会永久找不回来",
    ).toBe("sk-a");
    expect((await llmConfigRepository.findSingleton())?.model).toBe("旧模型");
  });

  it("反向那一半：remoteModel 的批量写失败 ⇒ llmConfig 一个字都没写", async () => {
    await seedState();
    const gate = armStatementFailure(remoteModelInsert);
    /* 包装层与 #2586 那条同形：drizzle 把宿主抛的东西放进 `Failed query: …`，
     * 注入的那句挂在 `cause` 上 —— 只看 message 会读不到原因（#1250 记的形态）。 */
    const failure = await saveLlmSettings({
      provider: "remote",
      extraModels: [{ name: "乙", baseUrl: "https://b/v1" }],
    })
      .then(() => null)
      .catch(
        (e: unknown) =>
          /* SAFETY: 类型断言已复核 */ e as {
            message: string;
            cause?: { message?: string };
          },
      );
    expect(failure, "远端那一写失败必须让整条保存失败").not.toBeNull();
    expect(`${failure?.message ?? ""} ${failure?.cause?.message ?? ""}`).toContain("测试注入");
    expect(gate.hits()).toBe(1);
    expect((await llmConfigRepository.findSingleton())?.provider).toBe("local");
    expect((await llmConfigRepository.findSingleton())?.model).toBe("旧模型");
    expect(await names()).toEqual(["丙", "甲"]);
  });

  it("没给 extraModels ⇒ 事务里一条 remoteModel 语句都没有（不是「按空清单覆盖」）", async () => {
    await seedState();
    tdb.$sqlTrace.length = 0;
    await saveLlmSettings({ model: "新模型" });
    expect(
      tdb.$sqlTrace.some((s) => /remotemodel/i.test(s)),
      "缺键就是「本次不动这张表」——按空清单覆盖等于替用户清空远端模型与其密钥（A11）",
    ).toBe(false);
    expect(await names()).toEqual(["丙", "甲"]);
    expect((await llmConfigRepository.findSingleton())?.model).toBe("新模型");
  });

  it("成功那一跑：本地候选名进 llmConfig、远端条目进 remoteModel，两份是同一次的新态", async () => {
    await saveLlmSettings({
      extraModels: ["llama3", { name: "乙", baseUrl: "https://b/v1", apiKey: "sk-b" }],
    });
    const cfg = await llmConfigRepository.findSingleton();
    expect(cfg?.extraModels).toEqual(["llama3"]);
    const rows = await remoteModelRepository.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "乙", baseUrl: "https://b/v1" });
    expect(decryptLlmKey(rows[0]!.apiKey)).toBe("sk-b");
    expect(String(rows[0]!.apiKey).startsWith("enc:v1:")).toBe(true);
  });

  it("起事务撞锁 ⇒ 整条跨表事务按 SETTINGS_DB_WRITE 重试（与 #2586 同一份预算）", async () => {
    await seedState();
    const busy = () => {
      const e = new Error("database is locked");
      /* SAFETY: 类型断言已复核 */ (e as { code?: string }).code = "SQLITE_BUSY";
      return e;
    };
    const gate = armStatementFailure(
      (sql) => sql.trim().toLowerCase() === "begin",
      busy,
      SETTINGS_DB_WRITE.maxAttempts - 1,
    );
    /* 起态那份 `replaceAll` 自己也是一条事务（一个 begin…commit），不在这里的账上：
     * 断言的是**这一次保存**重试了几回，不清零就会把起态那次一起数进来。 */
    tdb.$sqlTrace.length = 0;
    await saveLlmSettings({
      model: "新模型",
      extraModels: [{ name: "乙", baseUrl: "https://b/v1" }],
    });
    expect(gate.hits()).toBe(SETTINGS_DB_WRITE.maxAttempts - 1);
    const heads = tdb.$sqlTrace.map(head);
    /* 每次重试都重新起一条**完整**事务（begin 数 = 尝试数），而只有成功那一次落到
     * commit ——「重试的是某一条语句」的写法会在这里红。 */
    expect(heads.filter((h) => h === "begin")).toHaveLength(SETTINGS_DB_WRITE.maxAttempts);
    expect(heads.filter((h) => h === "commit")).toHaveLength(1);
  });

  it("两次保存按顺序整体生效：终态等于后一次，不留前一次的远端残行", async () => {
    await saveLlmSettings({
      model: "A",
      extraModels: [{ name: "甲" }, "llama-A"],
    });
    await saveLlmSettings({
      model: "B",
      extraModels: [{ name: "乙" }, "llama-B"],
    });
    expect(await names()).toEqual(["乙"]);
    const cfg = await llmConfigRepository.findSingleton();
    expect(cfg?.model).toBe("B");
    expect(cfg?.extraModels).toEqual(["llama-B"]);
  });

  /* 期望 2「单例那次读也落在同一个 executor 上」在**本宿主里只能按身份判**：
   * 测试宿主是一条 `:memory:` 连接，`db` 与 `tx` 打的是同一个实例，所以「读走模块级
   * 连接还是走事务」在 SQL trace 上**看不出区别** —— 上面那条 trace 用例证明不了它。
   * 生产侧这个区别是实的：libsql 的 `file:` 客户端是连接池，整条事务绑其中一条连接，
   * 另一条只会读到提交前的旧行。于是这条钉的是「传进来的到底是谁」。 */
  it("单例的 read-modify-write 把事务对象交给读，而不是让它回落模块级连接", async () => {
    await seedState();
    const original = llmConfigRepository.findSingleton.bind(llmConfigRepository);
    const seen: Array<DbExecutor | undefined> = [];
    const spy = vi
      .spyOn(llmConfigRepository, "findSingleton")
      .mockImplementation(async (executor?: DbExecutor) => {
        seen.push(executor);
        return original(executor);
      });
    await saveLlmSettings({ model: "新模型" });
    spy.mockRestore();
    expect(seen, "这一次保存里，那份 read-modify-write 的读只发生一次").toHaveLength(1);
    expect(seen[0], "读必须拿到调用方传下来的 executor —— 缺省就回落到模块级连接").toBeDefined();
    expect(seen[0], "而且拿到的不是模块级那个 db，是事务本身").not.toBe(tdb);
  });
});

/* ─────────────────────────────── Post ─────────────────────────────── */

describe("PostRepository", () => {
  it("getLatest 取最新一条；create 落库", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    expect(await postRepository.getLatest()).toBeNull();

    await postRepository.create({ name: "旧公告", createdById: "u1" });
    // sleep-ok: 必须走真挂钟：要 createdAt / updatedAt 拉开真实的毫秒差，假定时器会把被测的时间戳逻辑一起冻住。
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
