/**
 * `/api/materials` 的闸门用例 —— 素材库这一族**现在只有这一个入口**。
 *
 * 这里曾写着「与 tRPC 的 `material.*` 同一套判据、两个入口」：那条门后来因
 * **零消费方**删掉了（素材面板走的就是这条 REST，`~/lib/media/materials-client`），
 * 用例因此全部收拢到这一份 —— 包括原先由那扇门覆盖的分支（见「素材库根读不出来」
 * 那条）。判据本身在 `~/lib/media/materials.ts` 一处，两个入口曾经各写一份
 * `resolveScopes`、两份都不判归属，那才是这段历史的意义。
 *
 * 组织方式：读侧「越权与不存在同形」，写 / 删侧「拒绝发生在落盘之前」。
 *
 * mock 边界：`fs`（内存假象，读写调用都记下来 —— 「没落盘」与「没读盘」都是
 * 要断言的事）、`~/server/auth/request-user`（鉴权两态）、
 * `~/server/db`（内存库 + 真 Drizzle，项目归属真判）。
 */
import type { NextRequest } from "next/server";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { dirEntries, fileStats, disk, userMock } = vi.hoisted(() => ({
  dirEntries: new Map<string, { names?: string[]; subdirs?: string[] }>(),
  fileStats: new Map<string, { size: number; mtime: Date }>(),
  disk: {
    reads: [] as string[],
    mkdir: [] as string[],
    writeFile: [] as string[],
    unlink: [] as string[],
  },
  userMock: vi.fn<() => Promise<{ id: string } | null>>(),
}));

vi.mock("fs", () => ({
  promises: {
    readdir: async (dir: string, opts?: { withFileTypes?: boolean }) => {
      disk.reads.push(`readdir:${dir}`);
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
      disk.reads.push(`stat:${p}`);
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
    unlink: async (p: string) => {
      if (!fileStats.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      disk.unlink.push(p);
    },
    access: async (p: string) => {
      if (!fileStats.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  },
}));
vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));

import { DELETE, GET, POST } from "./route";
import { materialsRoot, SHARED_SCOPE } from "~/lib/media/materials";
import {
  getTestDb,
  seedProject,
  seedUser,
} from "../../../../tests/helpers/test-db";

const tdb = getTestDb();
const ROOT = materialsRoot();
const nameOf = (id: string) => id.split("/").pop() ?? id;

/** handler 只要 `req.url` 与 `formData()`，用真 Request 顶替 NextRequest。 */
function reqOf(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

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

function urlOf(query: string): string {
  return `http://127.0.0.1:3000/api/materials${query}`;
}

/** multipart 上传体（形状与浏览器送上来的那份一致）。 */
function uploadForm(init: {
  type?: string;
  name?: string;
  sizeOverMax?: boolean;
  projectId?: string;
  folder?: string;
  shared?: string;
}): FormData {
  const file = new File(["abcd"], init.name ?? "note.txt", {
    type: init.type ?? "text/plain",
  });
  if (init.sizeOverMax) {
    // 不真分配 100MB：`file.size` 是原型上的 getter，实例属性就能顶掉它
    Object.defineProperty(file, "size", { value: 101 * 1024 * 1024 });
  }
  const form = new FormData();
  form.set("file", file);
  if (init.projectId !== undefined) form.set("projectId", init.projectId);
  if (init.folder !== undefined) form.set("folder", init.folder);
  if (init.shared !== undefined) form.set("shared", init.shared);
  return form;
}

const postWith = (form: FormData) =>
  POST(reqOf(urlOf(""), { method: "POST", body: form }));

beforeEach(() => {
  tdb.$reset();
  dirEntries.clear();
  fileStats.clear();
  for (const list of Object.values(disk)) list.length = 0;
  userMock.mockResolvedValue({ id: "user-a" });
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  seedProject(tdb, { id: "proj-a", userId: "user-a", name: "我的画布" });
  seedProject(tdb, { id: "proj-b", userId: "user-b", name: "别人的画布" });
  dirEntries.set(ROOT, { subdirs: ["proj-a", "proj-b", SHARED_SCOPE] });
  put("proj-a", "ref", "mine.png");
  put("proj-b", "ref", "secret.png");
  put(SHARED_SCOPE, "ref", "shared.png");
});

describe("GET /api/materials —— 读侧归属", () => {
  it("未登录 → 401，且一次磁盘都不读", async () => {
    userMock.mockResolvedValueOnce(null);
    const res = await GET(reqOf(urlOf("?projectId=proj-a")));
    expect(res.status).toBe(401);
    expect(disk.reads).toEqual([]);
  });

  it("本项目 + 共享区", async () => {
    const res = await GET(reqOf(urlOf("?projectId=proj-a&folder=ref")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => nameOf(i.id))).toEqual([
      "mine.png",
      "shared.png",
    ]);
  });

  it("别人的项目 → 与「没素材」同形（不给探测项目 id 用）", async () => {
    const body = (await (
      await GET(reqOf(urlOf("?projectId=proj-b&folder=ref")))
    ).json()) as { items: { id: string }[] };
    expect(body.items.map((i) => nameOf(i.id))).toEqual(["shared.png"]);
  });

  it("cross 不再枚举全库目录（别人项目里的文件一条都不出现）", async () => {
    const body = (await (
      await GET(reqOf(urlOf("?scope=cross&folder=ref")))
    ).json()) as { items: { scope: string }[] };
    expect(body.items.map((i) => i.scope)).not.toContain("proj-b");
  });

  it("素材库根本身读不出来 → cross 按「没有别的 scope」答，而不是 500", async () => {
    /* `listScopes()` 的 catch 分支：这一格的故障不是「用户没素材」，是磁盘层面
     * 读不到目录（权限 / 根目录还没建）。原先这一支由 tRPC 那扇门用例覆盖，
     * 门删掉之后必须由活着的这一扇判住 —— 否则「判据一条不减」只是句空话。 */
    dirEntries.delete(ROOT);
    const res = await GET(reqOf(urlOf("?scope=cross&folder=ref")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { scope: string }[];
      folders: unknown[];
    };
    // 只剩共享区那一份（它是末尾统一补的，不依赖能不能枚举到目录）
    expect(body.items.map((i) => i.scope)).toEqual([SHARED_SCOPE]);
    // 7 个分类仍然恒定存在（前端不必自己补齐缺失分类）
    expect(body.folders).toHaveLength(7);
  });

  it("未知分类 → 400（分类是枚举，不是路径片段）", async () => {
    expect(
      (await GET(reqOf(urlOf("?projectId=proj-a&folder=../docs")))).status,
    ).toBe(400);
  });

  it("库里没有的项目目录仍可写可见（画布镜像是尽力而为，别把正常流程堵死）", async () => {
    put("proj-fresh", "ref", "fresh.png");
    const body = (await (
      await GET(reqOf(urlOf("?projectId=proj-fresh&folder=ref")))
    ).json()) as { items: { id: string }[] };
    expect(body.items.map((i) => nameOf(i.id))).toContain("fresh.png");
  });
});

describe("POST /api/materials —— 上传", () => {
  it("写进自己的项目：落盘路径在素材库根之内", async () => {
    const res = await postWith(
      uploadForm({ projectId: "proj-a", folder: "docs", name: "note.txt" }),
    );
    expect(res.status).toBe(200);
    expect(disk.writeFile).toEqual([
      path.join(ROOT, "proj-a", "docs", "note.txt"),
    ]);
  });

  it("写别人的项目 → 404，且 mkdir / writeFile 都没发生", async () => {
    const res = await postWith(
      uploadForm({ projectId: "proj-b", folder: "docs", name: "x.txt" }),
    );
    expect(res.status).toBe(404);
    expect(disk.mkdir).toEqual([]);
    expect(disk.writeFile).toEqual([]);
  });

  it("shared=true 落到共享区（不设归属）", async () => {
    expect(
      (
        await postWith(
          uploadForm({ shared: "true", folder: "docs", name: "s.txt" }),
        )
      ).status,
    ).toBe(200);
    expect(disk.writeFile[0]).toBe(
      path.join(ROOT, SHARED_SCOPE, "docs", "s.txt"),
    );
  });

  it("重名不覆盖：追加 -1（同名上传不该把用户的旧文件冲掉）", async () => {
    put("proj-a", "docs", "note.txt");
    await postWith(
      uploadForm({ projectId: "proj-a", folder: "docs", name: "note.txt" }),
    );
    expect(disk.writeFile).toEqual([
      path.join(ROOT, "proj-a", "docs", "note-1.txt"),
    ]);
  });

  it("坏 MIME / 缺分类 / 缺 projectId：各自一个 400，且都不落盘", async () => {
    const cases: Parameters<typeof uploadForm>[0][] = [
      { type: "application/x-msdownload", projectId: "proj-a", folder: "docs" },
      { projectId: "proj-a", folder: "../../outside" },
      { projectId: "", folder: "docs" },
    ];
    for (const init of cases) {
      expect((await postWith(uploadForm(init))).status).toBe(400);
    }
    expect(disk.writeFile).toEqual([]);
  });

  it("超过 100MB 上限 → 400 且不落盘", async () => {
    /* 这一条不走 `new Request(body)`：multipart 序列化再解析会**重建** File，
     * 实例上顶掉的 `size` 会被真实字节数覆盖（测试里不该为了验一条上限去分配
     * 101MB 内存），所以直接把 `formData()` 交给 handler —— 被测的判据本来就在
     * 拿到 File 之后。 */
    const form = uploadForm({
      projectId: "proj-a",
      folder: "docs",
      sizeOverMax: true,
    });
    const res = await POST({
      formData: async () => form,
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(disk.writeFile).toEqual([]);
  });

  it("没带 file 字段 → 400", async () => {
    const form = new FormData();
    form.set("folder", "docs");
    expect((await postWith(form)).status).toBe(400);
  });

  it("文件名里的目录成分被剥掉，只写 basename", async () => {
    await postWith(
      uploadForm({
        projectId: "proj-a",
        folder: "docs",
        name: "..\\..\\evil.txt",
      }),
    );
    expect(disk.writeFile[0]).toBe(
      path.join(ROOT, "proj-a", "docs", "evil.txt"),
    );
  });
});

describe("DELETE /api/materials —— 删除侧归属", () => {
  it("删自己的素材", async () => {
    const res = await DELETE(reqOf(urlOf("?id=proj-a/ref/mine.png")));
    expect(res.status).toBe(200);
    expect(disk.unlink).toEqual([path.join(ROOT, "proj-a", "ref", "mine.png")]);
  });

  it("删别人项目里那一格 → 404，`fs.unlink` 一次都没被调用", async () => {
    expect(
      (await DELETE(reqOf(urlOf("?id=proj-b/ref/secret.png")))).status,
    ).toBe(404);
    expect(disk.unlink).toEqual([]);
  });

  it("id 形状不对（段数 / 分类 / scope）→ 400，什么都不删", async () => {
    for (const id of ["", "a/b", "proj-a/../x.png", "proj-b/nope/mine.png"]) {
      expect(
        (await DELETE(reqOf(urlOf(`?id=${encodeURIComponent(id)}`)))).status,
      ).toBe(400);
    }
    expect(disk.unlink).toEqual([]);
  });

  it("目标已经不在了 → 幂等成功（不报 500）", async () => {
    const res = await DELETE(reqOf(urlOf("?id=proj-a/ref/gone.png")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyGone: true });
  });
});
