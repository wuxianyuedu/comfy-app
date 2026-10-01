/**
 * material.router 的闸门用例（体检清单 ⑨ 的第一刀：素材库的归属）。
 *
 * 素材库是**文件系统**支撑的，分片方式是把画布项目 id 直接当目录名
 * （`public/generated/materials/<projectId>/<folder>/<file>`）。于是「scope」这个
 * 参数同时是路径片段与权限边界，两件事都得出货：
 *  · **形状** —— `../x` 之类的必须被清洗掉（`sanitizeScope` / `sanitizeFileName`
 *    / `folderDir` 的包含断言），否则就是路径穿越；
 *  · **归属** —— 形状合法也不等于可以读写：把别人的 `proj_*` 填进来，读得到别人的
 *    素材、写进别人的面板、删得掉别人的文件。这一族与台账 A2 / A3 同源。
 * 两条判据的处置都按同一条口径：**越权与不存在同形**（不给探测项目 id 用），
 * 且**拒绝必须发生在 `writeFile` / `rm` 之前**（§11.2.1）。
 *
 * mock 边界：`fs`（整个换成内存假象 —— 用例既不该往仓库的 `public/` 里造目录，
 * 也要能断言「一次都没写盘」）、`~/server/db`（内存库，真 Drizzle，项目归属真判）、
 * `~/lib/core/logger`、`~/server/better-auth`。
 */
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { dirEntries, fileStats, disk } = vi.hoisted(() => ({
  /** 目录 → 内容。`names` 是文件（普通 readdir），`subdirs` 供 `withFileTypes` 用。 */
  dirEntries: new Map<string, { names?: string[]; subdirs?: string[] }>(),
  fileStats: new Map<string, { size: number; mtime: Date }>(),
  /** 写侧调用的记录：判「拒绝有没有发生在落盘之前」全靠它。 */
  disk: {
    mkdir: [] as string[],
    writeFile: [] as string[],
    rm: [] as string[],
  },
}));

vi.mock("fs", () => ({
  promises: {
    readdir: async (dir: string, opts?: { withFileTypes?: boolean }) => {
      const entry = dirEntries.get(dir);
      if (!entry) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      if (opts?.withFileTypes)
        return (entry.subdirs ?? []).map((name) => ({
          name,
          isDirectory: () => true,
        }));
      return entry.names ?? [];
    },
    stat: async (p: string) => {
      const f = fileStats.get(p);
      if (!f) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { isFile: () => true, size: f.size, mtime: f.mtime };
    },
    mkdir: async (p: string) => {
      disk.mkdir.push(p);
    },
    writeFile: async (p: string) => {
      disk.writeFile.push(p);
    },
    rm: async (p: string) => {
      disk.rm.push(p);
    },
  },
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

import { createCallerFactory } from "~/server/api/trpc";
import { materialRouter } from "~/server/api/routers/material";
import { materialsRoot, SHARED_SCOPE } from "~/lib/media/materials";
import {
  getTestDb,
  seedUser,
  seedProject,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(materialRouter);
const tdb = getTestDb();

const ROOT = materialsRoot();
const nameOf = (id: string) => id.split("/").pop() ?? id;

/** 在假磁盘上铺一格素材。 */
function put(scope: string, folder: string, name: string): void {
  const dir = path.join(ROOT, scope, folder);
  const entry = dirEntries.get(dir) ?? {};
  entry.names = [...(entry.names ?? []), name];
  dirEntries.set(dir, entry);
  fileStats.set(path.join(dir, name), {
    size: 10,
    mtime: new Date("2026-01-01T00:00:00.000Z"),
  });
}

beforeEach(() => {
  tdb.$reset();
  dirEntries.clear();
  fileStats.clear();
  disk.mkdir.length = 0;
  disk.writeFile.length = 0;
  disk.rm.length = 0;
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  seedProject(tdb, { id: "proj-a", userId: "user-a", name: "我的画布" });
  seedProject(tdb, { id: "proj-b", userId: "user-b", name: "别人的画布" });
  // 素材库根下三个 scope 目录：我的、别人的、共享区
  dirEntries.set(ROOT, { subdirs: ["proj-a", "proj-b", SHARED_SCOPE] });
  put("proj-a", "ref", "mine.png");
  put("proj-b", "ref", "secret.png");
  put(SHARED_SCOPE, "ref", "shared.png");
});

// ────────────────────────────────────── list ──────────────────────────────────────

describe("material.list —— 读侧归属", () => {
  it("本项目：看得到自己的与共享的", async () => {
    const res = await createCaller(makeCtx()).list({
      projectId: "proj-a",
      folder: "ref",
    });
    expect(res.items.map((i) => nameOf(i.id))).toEqual([
      "mine.png",
      "shared.png",
    ]);
  });

  it("别人的项目 → 与「这个项目没素材」同形：只剩共享区（台账 A3 同族）", async () => {
    const res = await createCaller(makeCtx()).list({
      projectId: "proj-b",
      folder: "ref",
    });
    expect(res.items.map((i) => nameOf(i.id))).toEqual(["shared.png"]);
  });

  it("跨项目模式不再把磁盘上所有目录都列出来（旧写法等于交出一份别人的项目 id 清单）", async () => {
    const res = await createCaller(makeCtx()).list({
      scope: "cross",
      folder: "ref",
    });
    expect(res.items.map((i) => nameOf(i.id))).toEqual([
      "mine.png",
      "shared.png",
    ]);
    expect(res.items.some((i) => i.scope === "proj-b")).toBe(false);
  });

  it("库里没登记的项目目录仍可见（画布 id 由客户端生成，镜像是尽力而为）", async () => {
    put("proj-unsynced", "ref", "fresh.png");
    const res = await createCaller(makeCtx()).list({
      projectId: "proj-unsynced",
      folder: "ref",
    });
    expect(res.items.map((i) => nameOf(i.id))).toContain("fresh.png");
  });

  it("分类计数恒定给出 7 格（面板不必自己补齐缺项）", async () => {
    const res = await createCaller(makeCtx()).list({ projectId: "proj-a" });
    expect(res.folders.map((f) => f.id)).toEqual([
      "ref",
      "scenes",
      "storyboard",
      "styles",
      "characters",
      "docs",
      "music",
    ]);
    expect(res.folders.find((f) => f.id === "ref")?.count).toBe(2);
  });

  it("搜索走同一份归属判据：搜不到别人项目里的文件", async () => {
    const res = await createCaller(makeCtx()).list({
      scope: "cross",
      q: "secret",
    });
    expect(res.items).toEqual([]);
  });

  it("未知分类 → 抛错（分类是枚举，不是路径片段）", async () => {
    await expect(
      createCaller(makeCtx()).list({ projectId: "proj-a", folder: "../docs" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("scope 形状攻击被收成 null → 落到共享区，不越界", async () => {
    const res = await createCaller(makeCtx()).list({
      projectId: "../../etc",
      folder: "ref",
    });
    expect(res.items.map((i) => nameOf(i.id))).toEqual(["shared.png"]);
  });
});

// ────────────────────────────────────── save ──────────────────────────────────────

describe("material.save —— 写侧归属与清洗", () => {
  it("写进自己的项目：目录与文件都在素材库根之内", async () => {
    const res = await createCaller(makeCtx()).save({
      name: "note.md",
      content: "hi",
      folder: "docs",
      projectId: "proj-a",
    });
    expect(res.ok).toBe(true);
    expect(disk.writeFile).toHaveLength(1);
    expect(disk.writeFile[0]).toBe(
      path.join(ROOT, "proj-a", "docs", "note.md"),
    );
  });

  it("写别人的项目 → NOT_FOUND，且 mkdir / writeFile 一次都没发生", async () => {
    await expect(
      createCaller(makeCtx()).save({
        name: "x.md",
        content: "hi",
        folder: "docs",
        projectId: "proj-b",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(disk.mkdir).toEqual([]);
    expect(disk.writeFile).toEqual([]);
  });

  it("共享区不设归属：任何登录用户都能存（本来就是跨项目共用池）", async () => {
    await createCaller(makeCtx()).save({
      name: "shared-note.md",
      content: "hi",
      folder: "docs",
    });
    expect(disk.writeFile[0]).toBe(
      path.join(ROOT, SHARED_SCOPE, "docs", "shared-note.md"),
    );
  });

  it("文件名里的目录成分被剥掉（`../../x` 只会写成一个 basename）", async () => {
    await createCaller(makeCtx()).save({
      name: "../../evil.md",
      content: "hi",
      folder: "docs",
      projectId: "proj-a",
    });
    expect(disk.writeFile[0]).toBe(
      path.join(ROOT, "proj-a", "docs", "evil.md"),
    );
  });

  it("未知分类 → 抛错且不落盘", async () => {
    await expect(
      createCaller(makeCtx()).save({
        name: "a.md",
        content: "hi",
        folder: "../../outside",
        projectId: "proj-a",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(disk.writeFile).toEqual([]);
  });

  it("清洗后文件名为空 → BAD_REQUEST，且 mkdir / writeFile 一次都没发生", async () => {
    // `sanitizeFileName` 对「整名是目录成分」「只有分隔符」「全是空白」都返回 null；
    // 这条判据要落到**码**上 —— 旧写法是裸 Error，界面与故障分不开（台账 E8）。
    for (const name of ["..", "/", "   ", "\\..\\"]) {
      await expect(
        createCaller(makeCtx()).save({
          name,
          content: "hi",
          folder: "docs",
          projectId: "proj-a",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(disk.mkdir).toEqual([]);
    expect(disk.writeFile).toEqual([]);
  });

  it("scope 形状攻击收成共享区（不越界写）", async () => {
    await createCaller(makeCtx()).save({
      name: "a.md",
      content: "hi",
      folder: "docs",
      projectId: "../proj-b",
    });
    expect(disk.writeFile[0]).toBe(
      path.join(ROOT, SHARED_SCOPE, "docs", "a.md"),
    );
  });
});

// ────────────────────────────────────── delete ──────────────────────────────────────

describe("material.delete —— 删除侧归属（拒绝必须发生在 rm 之前）", () => {
  it("删自己的素材：目标就是那一格文件", async () => {
    const res = await createCaller(makeCtx()).delete({
      name: "mine.png",
      folder: "ref",
      projectId: "proj-a",
    });
    expect(res.ok).toBe(true);
    expect(disk.rm).toEqual([path.join(ROOT, "proj-a", "ref", "mine.png")]);
  });

  it("删别人的项目里那一格 → NOT_FOUND，`fs.rm` 一次都没被调用", async () => {
    await expect(
      createCaller(makeCtx()).delete({
        name: "secret.png",
        folder: "ref",
        projectId: "proj-b",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(disk.rm).toEqual([]);
  });

  it("文件名清洗让 `..` 到不了父目录（删的是 basename 那一格）", async () => {
    await createCaller(makeCtx()).delete({
      name: "../ref/secret.png",
      folder: "ref",
      projectId: "proj-a",
    });
    expect(disk.rm).toEqual([path.join(ROOT, "proj-a", "ref", "secret.png")]);
  });

  it("分类不在枚举里 → 抛错且不 rm（分类不是路径片段）", async () => {
    await expect(
      createCaller(makeCtx()).delete({
        name: "mine.png",
        folder: "../../outside",
        projectId: "proj-a",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(disk.rm).toEqual([]);
  });

  it("文件名清洗后为空 → BAD_REQUEST 且不 rm（整名就是 `..` 时没东西可删）", async () => {
    await expect(
      createCaller(makeCtx()).delete({
        name: "..",
        folder: "ref",
        projectId: "proj-a",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(disk.rm).toEqual([]);
  });
});
