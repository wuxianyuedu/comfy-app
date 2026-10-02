/**
 * 素材库判据层（`materials.ts`）自己的用例。
 *
 * 为什么单独一份：这里全是**挡在磁盘之前的清洗与包含判据**（scope 白名单、文件名剥
 * 目录成分并换掉特殊字符、`folderDir` 的「解析后仍在素材库根之内」）。入口
 * （`/api/materials`）送进来的是「合法入参 + 真归属」这条主干 —— 129 字符的 scope、
 * `..`、`a<b>.png`、201 字符的文件名这些形状一个都进不来，所以这些分支此前只被入口
 * 用例顺带走过。素材那一族收成一条入口之后（tRPC 的 `material.*` 因零消费方删掉，
 * 见台账 E3′），没人判的分支就退化成「写了但没人判」的双保险 —— 与 §11.2.1
 * 「改了判据却没有执行者」同族。所以按**判据本身**测。
 *
 * mock 边界：spy `process.cwd()`（素材库根由它派生）；文件落在**自己的临时根**，
 * 不碰仓库的 `generated/`（硬规则 17）；`~/lib/core/repository-project` 只判归属三态
 * （真库那部分由入口的用例判）。
 */
import fs, { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHARED_SCOPE,
  canWriteMaterialScope,
  collectByFolder,
  folderDir,
  folderName,
  isValidFolder,
  listFolderItems,
  listScopes,
  sanitizeFileName,
  sanitizeScope,
  visibleMaterialScopes,
} from "~/lib/media/materials";
import { generatedRoot, materialsRoot } from "~/lib/media/output-paths";

/** 归属三态的桩：`materialScopeOwnership` 只问「这一格属于谁」。
 *  真库 + 真 Drizzle 那一路由 `/api/materials` 的用例判（同一条判决不测两遍）。 */
const { owners, findById } = vi.hoisted(() => {
  const owners = new Map<string, string>();
  return {
    owners,
    findById: async (scope: string) =>
      owners.has(scope) ? { userId: owners.get(scope)! } : null,
  };
});
vi.mock("~/lib/core/repository-project", () => ({
  projectRepository: { findById },
}));

/** 每条用例一个独立的素材根：`listScopes()` 枚举的是**整个素材库根**，
 *  共用一份根会让上一条用例落下的目录混进下一条的期望里（第一版就是这么红的）。 */
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "materials-judgment-"));
let tmp = BASE;
let root = materialsRoot(generatedRoot(tmp));
const cwdSpy = vi.spyOn(process, "cwd");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(BASE, "case-"));
  root = materialsRoot(generatedRoot(tmp));
  cwdSpy.mockReturnValue(tmp);
  owners.clear();
});

/** 往当前用例的素材根里落一个条目；`mtimeMs` 固定排序方向（不靠机器时钟）。 */
function put(
  scope: string,
  folder: string,
  name: string,
  opts: { mtimeMs?: number; asDir?: boolean } = {},
): void {
  const dir = path.join(root, scope, folder);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (opts.asDir) fs.mkdirSync(target, { recursive: true });
  else fs.writeFileSync(target, "x");
  if (opts.mtimeMs !== undefined) {
    fs.utimesSync(target, opts.mtimeMs / 1000, opts.mtimeMs / 1000);
  }
}

afterAll(() => {
  cwdSpy.mockRestore();
  fs.rmSync(BASE, { recursive: true, force: true });
});

describe("sanitizeScope —— scope 是目录名，不是路径片段", () => {
  it("项目 id 与共享区原样通过（先去空白）", () => {
    expect(sanitizeScope("proj_17551234567890abcdef")).toBe(
      "proj_17551234567890abcdef",
    );
    expect(sanitizeScope(`  ${SHARED_SCOPE}  `)).toBe(SHARED_SCOPE);
  });

  it("空白、超长、含分隔符或点号的都拒绝", () => {
    expect(sanitizeScope(null)).toBeNull();
    expect(sanitizeScope("")).toBeNull();
    expect(sanitizeScope("   ")).toBeNull();
    expect(sanitizeScope("x".repeat(129))).toBeNull();
    expect(sanitizeScope("a/b")).toBeNull();
    expect(sanitizeScope("a\\b")).toBeNull();
    expect(sanitizeScope("..")).toBeNull();
    expect(sanitizeScope("../evil")).toBeNull();
    // 白名单只留字母数字下划线连字符 —— 点号被排除，`.hidden` 这类进不来
    expect(sanitizeScope("a.b")).toBeNull();
  });
});

describe("sanitizeFileName —— 先剥目录成分，再换掉有特殊含义的字符", () => {
  it("两种分隔符一起切，只留 basename", () => {
    expect(sanitizeFileName("a/b/c.png")).toBe("c.png");
    expect(sanitizeFileName("a\\b\\c.png")).toBe("c.png");
  });

  it("空串与纯点判不可用；带目录成分的只留 basename", () => {
    expect(sanitizeFileName(null)).toBeNull();
    expect(sanitizeFileName("")).toBeNull();
    expect(sanitizeFileName(".")).toBeNull();
    expect(sanitizeFileName("..")).toBeNull();
    // 尾部分隔符不是「剥完就空」：`a/` 的 basename 就是 `a`，那是个合法文件名
    expect(sanitizeFileName("a/")).toBe("a");
  });

  it("有特殊含义的字符换成下划线而不是整条拒掉，超长才不可用", () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.png')).toBe("a_b_c_d_e_f_g_h.png");
    expect(sanitizeFileName("x".repeat(201) + ".png")).toBeNull();
  });
});

describe("folderDir —— 「解析后仍在素材库根之内」这一条本身", () => {
  it("合法的 scope/folder 落在素材库根之下", () => {
    const dir = folderDir("proj_a", "ref");
    expect(dir).toBe(path.join(root, "proj_a", "ref"));
  });

  it(`把 \`..\` 直接交给 folderDir（绕过入口的 sanitize）时必须判掉`, () => {
    // 这就是那条「双保险」：上游有两道白名单，这一条负责在放宽那天仍然不把根外路径交出去
    expect(folderDir("..", "ref")).toBeNull();
    expect(folderDir("../../etc", "passwd")).toBeNull();
  });

  it("分类是枚举：已知的算合法，未知的与空串都不算", () => {
    expect(isValidFolder("ref")).toBe(true);
    expect(isValidFolder("docs")).toBe(true);
    expect(isValidFolder("nope")).toBe(false);
    expect(isValidFolder("../docs")).toBe(false);
    expect(isValidFolder(null)).toBe(false);
    expect(isValidFolder(undefined)).toBe(false);
  });

  it("展示名取自分类表；未知 id 原样回，不编一个名字", () => {
    expect(folderName("ref")).toBe("参考素材");
    expect(folderName("nope")).toBe("nope");
  });
});

describe("listFolderItems —— 目录里的每一项都要过形状与 stat 两道", () => {
  it("分类目录还不存在时回空数组，而不是抛错", async () => {
    await expect(listFolderItems("proj_none", "music")).resolves.toEqual([]);
    // scope 越界那一支同理：先被包含判据挡掉，一次磁盘都不碰
    await expect(listFolderItems("..", "ref")).resolves.toEqual([]);
  });

  it("隐藏文件与子目录都不算素材；剩下的按修改时间新在前", async () => {
    const scope = "proj_sort";
    put(scope, "ref", "old.png", { mtimeMs: 1_700_000_000_000 });
    put(scope, "ref", "new.png", { mtimeMs: 1_800_000_000_000 });
    put(scope, "ref", ".DS_Store", { mtimeMs: 1_900_000_000_000 });
    put(scope, "ref", "子目录", { asDir: true });
    const items = await listFolderItems(scope, "ref");
    expect(items.map((i) => i.name)).toEqual(["new.png", "old.png"]);
    // 稳定 id 与浏览器可吃的地址都由判据层给（删除时原样回传即可）
    expect(items[0]).toMatchObject({
      id: `${scope}/ref/new.png`,
      folder: "ref",
      folderName: "参考素材",
      kind: "image",
      url: `/api/generated/materials/${scope}/ref/new.png`,
    });
  });

  it("单个文件 stat 失败（被占用 / 刚被删）不拖垮整批", async () => {
    const scope = "proj_statfail";
    put(scope, "docs", "a.txt");
    put(scope, "docs", "b.txt");
    const originalStat = fsp.stat;
    const stat = vi.spyOn(fsp, "stat").mockImplementation(async (p) => {
      if (String(p).endsWith("b.txt"))
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      return originalStat(p);
    });
    const items = await listFolderItems(scope, "docs");
    expect(items.map((i) => i.name)).toEqual(["a.txt"]);
    stat.mockRestore();
  });
});

describe("listScopes / collectByFolder —— 跨项目聚合那一侧", () => {
  it("只列素材库根下的目录，根读不出来时回空", async () => {
    put("proj_disk", "ref", "x.png");
    put(SHARED_SCOPE, "ref", "y.png");
    await expect(listScopes()).resolves.toEqual(
      expect.arrayContaining(["proj_disk", SHARED_SCOPE]),
    );
    // 根目录不存在（素材库还没被用过）不是错误
    cwdSpy.mockReturnValue(path.join(tmp, "没有这一层"));
    await expect(listScopes()).resolves.toEqual([]);
  });

  it("七个分类恒定存在（哪怕全空），聚合后仍按时间新在前", async () => {
    put("proj_c1", "ref", "one.png", { mtimeMs: 1_700_000_000_000 });
    put("proj_c2", "ref", "two.png", { mtimeMs: 1_800_000_000_000 });
    const map = await collectByFolder(["proj_c1", "proj_c2"]);
    expect([...map.keys()]).toEqual([
      "ref",
      "scenes",
      "storyboard",
      "styles",
      "characters",
      "docs",
      "music",
    ]);
    expect(map.get("ref")?.map((i) => i.name)).toEqual(["two.png", "one.png"]);
    expect(map.get("music")).toEqual([]);
  });
});

describe("归属三态 —— visibleMaterialScopes 与 canWriteMaterialScope", () => {
  it("project 模式：自己的项目 + 共享区；没给项目 id 时只剩共享区", async () => {
    owners.set("proj_mine", "user-a");
    await expect(
      visibleMaterialScopes("user-a", { cross: false, projectId: "proj_mine" }),
    ).resolves.toEqual(["proj_mine", SHARED_SCOPE]);
    await expect(
      visibleMaterialScopes("user-a", { cross: false, projectId: null }),
    ).resolves.toEqual([SHARED_SCOPE]);
  });

  it("别人的项目 → 与「这个项目根本没有素材」同形", async () => {
    owners.set("proj_theirs", "user-b");
    await expect(
      visibleMaterialScopes("user-a", {
        cross: false,
        projectId: "proj_theirs",
      }),
    ).resolves.toEqual([SHARED_SCOPE]);
  });

  it("cross 模式：别人项目里的文件一条都不出现，共享区只补一次", async () => {
    owners.set("proj_mine", "user-a");
    owners.set("proj_theirs", "user-b");
    put("proj_mine", "ref", "mine.png");
    put("proj_theirs", "ref", "secret.png");
    put(SHARED_SCOPE, "ref", "shared.png");
    const scopes = await visibleMaterialScopes("user-a", {
      cross: true,
      projectId: null,
    });
    expect(scopes).toEqual(["proj_mine", SHARED_SCOPE]);
    const collected = await collectByFolder(scopes);
    expect(collected.get("ref")?.map((i) => i.name)).toEqual([
      "shared.png",
      "mine.png",
    ]);
  });

  it("写 / 删许可：明确属于别人的才拒，库里没登记的放行（画布 id 镜像是尽力而为）", async () => {
    owners.set("proj_theirs", "user-b");
    await expect(canWriteMaterialScope("user-a", "proj_theirs")).resolves.toBe(
      false,
    );
    owners.set("proj_mine", "user-a");
    await expect(canWriteMaterialScope("user-a", "proj_mine")).resolves.toBe(
      true,
    );
    await expect(canWriteMaterialScope("user-a", SHARED_SCOPE)).resolves.toBe(
      true,
    );
    await expect(
      canWriteMaterialScope("user-a", "还没同步上来的项目"),
    ).resolves.toBe(true);
  });
});
