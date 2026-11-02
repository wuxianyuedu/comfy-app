// ── 会话 ⇄ 界面真值桥的落库行为（内存 SQLite + 真 Drizzle）──────
// 桥（#2482）的正确性全在「表是同一批表」上：mock 掉 ./db 的 libsql 客户端、
// 换成 tests/helpers/test-db 的内存库，仓储 / 桥 / 编排器写读的都是它。
// 验收主轴是 FR-AG-01①③：AI 写 → production（界面可见）；界面改 → AI 下一次
// get 读到（这里用「直接改 production 行」模拟界面侧写入）。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { workshopDb: createTestDb() };
});

import { eq } from "drizzle-orm";

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
