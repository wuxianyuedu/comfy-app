// ── 会话 ⇄ 界面真值桥的落库行为（内存 SQLite + 真 Drizzle）──────
// 桥（#2482）的正确性全在「表是同一批表」上：mock 掉 ./db 的 node:sqlite 客户端、
// 换成 tests/helpers/test-db 的内存库，仓储 / 桥 / 编排器写读的都是它。
// 验收主轴是 FR-AG-01①③：AI 写 → production（界面可见）；界面改 → AI 下一次
// get 读到（这里用「直接改 production 行」模拟界面侧写入）。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { workshopDb: createTestDb() };
});

import { eq } from "drizzle-orm";

import { isRecord } from "~/lib/is-record";
import type { Shot } from "~/lib/workshop/types";

import { getTestDb, seedProject, seedUser } from "../../../tests/helpers/test-db";
import { production, project, workshopSession } from "../db/schema";
import { workshopDb } from "./db";
import { ensureProductionProject, resolveOwnerUserId } from "./production-bridge";
import * as repo from "./repository";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
});

describe("resolveOwnerUserId", () => {
  it("显式 userId 必须存在", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    await expect(resolveOwnerUserId("user-a")).resolves.toBe("user-a");
    await expect(resolveOwnerUserId("user-missing")).rejects.toThrow(/userId 不存在/);
  });

  it("缺省落本机最早创建的用户（确定性兜底）", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    await expect(resolveOwnerUserId(null)).resolves.toBe("user-a");
  });

  it("一个用户都没有 → 可行动错误（指路应用内初始化）", async () => {
    await expect(resolveOwnerUserId(null)).rejects.toThrow(/先在应用内/);
  });
});

describe("ensureProductionProject", () => {
  beforeEach(() => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  });

  it("不给 projectId → 新建 proj_* 的 project + production 两行", async () => {
    const id = await ensureProductionProject(null, "user-a", "新项目");
    expect(id.startsWith("proj_")).toBe(true);
    const projs = await workshopDb.select().from(project);
    const prods = await workshopDb.select().from(production);
    expect(projs.find((p) => p.id === id)).toBeTruthy();
    expect(prods.find((p) => p.id === id)).toBeTruthy();
  });

  it("绑定既有项目：行不重复建；缺 production 行的画布项目补建 production", async () => {
    seedProject(tdb, { id: "proj_ui", userId: "user-a", name: "界面项目" });
    const id = await ensureProductionProject("proj_ui", "user-a", "新标题");
    expect(id).toBe("proj_ui");
    expect((await workshopDb.select().from(project)).length).toBe(1);
    // 画布项目原本没有 production 行 → 桥补建（标题不覆盖界面命名）
    const prod = await workshopDb.select().from(production).where(eq(production.id, "proj_ui"));
    expect(prod[0]).toBeTruthy();
  });

  it("项目不存在 / 归属冲突 → 拒绝绑定（可行动错误）", async () => {
    await expect(ensureProductionProject("proj_missing", "user-a", "x")).rejects.toThrow(
      /项目不存在/,
    );
    seedProject(tdb, { id: "proj_b", userId: "user-b", name: "别人的" });
    await expect(ensureProductionProject("proj_b", "user-a", "x")).rejects.toThrow(/归属.*冲突/);
  });
});

describe("会话桥：create / update / get 与界面同一份真值", () => {
  beforeEach(() => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  });

  it("createSession 即绑定：会话行带 projectId，production 行在场", async () => {
    const sessionId = await repo.createSession({
      title: "桥测试",
      idea: "灵感",
    });
    const rows = await workshopDb
      .select()
      .from(workshopSession)
      .where(eq(workshopSession.id, sessionId));
    const prodId = rows[0]?.projectId;
    if (prodId === undefined || prodId === null) {
      throw new Error("绑定失败：会话行没有 projectId");
    }
    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    expect(prod[0]).toBeTruthy();
  });

  it("AI 写 → production 与会话行镜像一致；界面直改 production → AI 下一次 get 读到", async () => {
    const sessionId = await repo.createSession({ title: "双向" });
    await repo.updateState(sessionId, {
      idea: "灵感",
      meta: {
        title: "双向",
        type: "short_video",
        tone: "",
        logline: "",
        scriptMarkdown: "# AI 写的剧本",
      },
      scenes: [],
      characters: [],
      shots: [],
      stage: "script",
      projectId: null,
    });
    const rows = await workshopDb
      .select()
      .from(workshopSession)
      .where(eq(workshopSession.id, sessionId));
    const row = rows[0]!;
    const prodId = row.projectId;
    if (prodId === undefined || prodId === null) {
      throw new Error("绑定失败：会话行没有 projectId");
    }
    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    expect(prod[0]?.scriptMarkdown).toBe("# AI 写的剧本");

    // 界面侧直改 production（模拟人在界面编辑后保存）：
    await workshopDb
      .update(production)
      .set({ scriptMarkdown: "# 人改过的剧本" })
      .where(eq(production.id, prodId));
    const state = await repo.getSession(sessionId);
    expect(state?.meta.scriptMarkdown).toBe("# 人改过的剧本");
  });

  it("遗留会话（projectId 为 NULL）首次写时桥接：建项目并落当前内容", async () => {
    await workshopDb.insert(workshopSession).values({
      id: "sess-legacy",
      userId: "user-a",
      title: "遗留",
      idea: "旧灵感",
      scriptMarkdown: "# 旧剧本",
    });
    await repo.updateState("sess-legacy", {
      idea: "旧灵感",
      meta: {
        title: "遗留",
        type: "short_video",
        tone: "",
        logline: "",
        scriptMarkdown: "# 新剧本",
      },
      scenes: [],
      characters: [],
      shots: [],
      stage: "character",
      projectId: null,
    });
    const rows = await workshopDb
      .select()
      .from(workshopSession)
      .where(eq(workshopSession.id, "sess-legacy"));
    const prodId = rows[0]?.projectId;
    if (prodId === undefined || prodId === null) {
      throw new Error("绑定失败：会话行没有 projectId");
    }
    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    expect(prod[0]?.scriptMarkdown).toBe("# 新剧本");
    const state = await repo.getSession("sess-legacy");
    expect(state?.stage).toBe("character");
    expect(state?.projectId).toBe(prodId);
  });

  it("updateState 对不存在的会话保持既有语义：不抛、不建行", async () => {
    await expect(
      repo.updateState("sess-none", {
        idea: "",
        meta: {
          title: "x",
          type: "short_video",
          tone: "",
          logline: "",
          scriptMarkdown: "",
        },
        scenes: [],
        characters: [],
        shots: [],
        stage: "script",
        projectId: null,
      }),
    ).resolves.toBeUndefined();
    expect((await workshopDb.select().from(workshopSession)).length).toBe(0);
  });
});

// ── 带基线写回（ISSUE #4730）：慢 IO 期间界面的并发改动不被旧快照整列覆盖 ──
describe("updateState 带变更基线（#4730）", () => {
  beforeEach(() => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  });

  /** 造一个最小可用的镜头（production.shots JSON 列的元素形状）。 */
  function mkShot(id: string, prompt: string): Shot {
    return {
      id,
      index: 1,
      sceneId: "",
      sceneHeading: "",
      shotType: "medium",
      description: "",
      characterIds: [],
      prompt,
      negativePrompt: "",
      params: {},
      status: "idle",
    };
  }

  /** production 行的 shots 是 unknown JSON 列：按形状收窄回 Shot 列表再断言。 */
  function shotsOf(row: { shots: unknown } | undefined): Array<Shot> {
    const raw = row?.shots;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((s): s is Shot => isRecord(s) && typeof s.id === "string");
  }

  async function prodIdOf(sessionId: string): Promise<string> {
    const rows = await workshopDb
      .select()
      .from(workshopSession)
      .where(eq(workshopSession.id, sessionId));
    const prodId = rows[0]?.projectId;
    if (prodId === undefined || prodId === null) {
      throw new Error("绑定失败：会话行没有 projectId");
    }
    return prodId;
  }

  it("慢 IO 期间界面改的剧本列保留，会话改的镜头列照常落库", async () => {
    const sessionId = await repo.createSession({ title: "并发" });
    const before = await repo.getSession(sessionId);
    if (!before) throw new Error("会话不存在");
    const baseline = structuredClone(before);
    const prodId = await prodIdOf(sessionId);

    // 界面在慢 IO 期间直改 production 的剧本列：
    await workshopDb
      .update(production)
      .set({ scriptMarkdown: "# 界面改的剧本" })
      .where(eq(production.id, prodId));

    // 会话态只改了 shots（剧本列与基线相同）：
    const next = structuredClone(baseline);
    next.shots = [mkShot("shot-1", "AI 改的提示词")];
    await repo.updateState(sessionId, next, baseline);

    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    expect(prod[0]?.scriptMarkdown).toBe("# 界面改的剧本");
    expect(shotsOf(prod[0])[0]?.prompt).toBe("AI 改的提示词");
  });

  it("shots 按 shotId 叠加：会话覆盖同 id 镜头，界面新增的镜头保留", async () => {
    const sessionId = await repo.createSession({ title: "镜头合并" });
    const before = await repo.getSession(sessionId);
    if (!before) throw new Error("会话不存在");
    const baseline = structuredClone(before);
    baseline.shots = [mkShot("s1", "基线镜头")];
    const prodId = await prodIdOf(sessionId);

    // 界面在慢 IO 期间：改了 s1 的提示词、又新增了 s2：
    await workshopDb
      .update(production)
      .set({ shots: [mkShot("s1", "界面改的提示词"), mkShot("s2", "界面新增")] })
      .where(eq(production.id, prodId));

    // 会话态只带着自己改过的 s1：
    const next = structuredClone(baseline);
    next.shots = [mkShot("s1", "AI 改的提示词")];
    await repo.updateState(sessionId, next, baseline);

    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    const shots = shotsOf(prod[0]);
    expect(shots).toHaveLength(2);
    expect(shots.find((s) => s.id === "s1")?.prompt).toBe("AI 改的提示词");
    expect(shots.find((s) => s.id === "s2")?.prompt).toBe("界面新增");
  });

  it("相对基线无变化 → 不写 production，界面并发改动完整保留", async () => {
    const sessionId = await repo.createSession({ title: "无变化" });
    const before = await repo.getSession(sessionId);
    if (!before) throw new Error("会话不存在");
    const baseline = structuredClone(before);
    const prodId = await prodIdOf(sessionId);
    await workshopDb
      .update(production)
      .set({ scriptMarkdown: "# 界面改的剧本" })
      .where(eq(production.id, prodId));

    const next = structuredClone(baseline); // 会话什么都没改
    await repo.updateState(sessionId, next, baseline);

    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    expect(prod[0]?.scriptMarkdown).toBe("# 界面改的剧本");
  });

  it("会话在慢 IO 期间被删 → 在途变更不再写 production（行检查在事务内）", async () => {
    const sessionId = await repo.createSession({ title: "被删" });
    const before = await repo.getSession(sessionId);
    if (!before) throw new Error("会话不存在");
    const baseline = structuredClone(before);
    const prodId = await prodIdOf(sessionId);
    await workshopDb.delete(workshopSession).where(eq(workshopSession.id, sessionId));

    const next = structuredClone(baseline);
    next.meta.scriptMarkdown = "# 迟到的旧快照";
    await expect(repo.updateState(sessionId, next, baseline)).resolves.toBeUndefined();

    const prod = await workshopDb.select().from(production).where(eq(production.id, prodId));
    expect(prod[0]?.scriptMarkdown).not.toBe("# 迟到的旧快照");
  });
});
