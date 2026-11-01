/**
 * 构建缓存槽的判据（ISSUE #2158）。
 *
 * 这一档要钉住的是**机制的四条边界**，不是「省了多少秒」：
 *  ① **四道门分得开** —— 开关没开 / 槽根算不出 / 面算不出 / 工作区里已有缓存 /
 *    空间不够，是五件不同的事，合成一档之后日志上那句「不接槽」就说不清是哪一种；
 *  ② **面指纹不含源码** —— 源码变了指纹必须不变（变了就等于每次提交都丢缓存，
 *    这份机制的收益整个吃掉；而 Turbopack 自己按内容失效，实测过）；
 *  ③ **摘链不许穿链** —— 收尾时删掉的是「链接本身」，常驻目录里的东西必须还在
 *    （穿链删 = 一次构建把常驻缓存整个删掉）；
 *  ④ **失败即退回** —— 开关关着时，这一跑与「没有这个机制」逐字相同。
 *
 * 头注里那三跑读数（冷 95s / 暖 14.9s / 暖+改源码 14.8s）是**实测**，不是引用 ——
 * 但它是**性能**事实，不是一条会过期的门槛：这里判的是**形状**（接不接、接在哪、
 * 收尾收不干净），性能那部分归文档与那条读数。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BUILD_CACHE_ENABLED_ENV,
  BUILD_FACE_FILES,
  buildCacheSlotPath,
  buildFaceFingerprint,
  linkBuildCache,
  planBuildCache,
  withBuildCacheSlot,
} from "../scripts/ci-build-cache-slot.mjs";
import {
  CACHE_ROOT_ENV,
  resolveBuildCacheRoot,
  resolveCacheRoot,
} from "../scripts/ci-cache-slot.mjs";

const ROOT = path.resolve(__dirname, "..");
const FACE = "a".repeat(64);

/**
 * 临时目录（真实文件系统 —— 「链接摘掉之后目标还在」那一档造不出夹具）。
 *
 * 落在**仓库所在卷**上：槽根那一侧有「同卷」的推导，而 `os.tmpdir()` 在 C:、
 * 本仓在 G: —— 拿 tmp 当槽根会让「同卷」那一档永远测不到。
 */
const made: Array<string> = [];
const slotRoots: Array<string> = [];
function tmpDir(tag: string): string {
  const onRepoVolume = path.join(path.parse(ROOT).root, `comfy-build-cache-${tag}`);
  let dir: string;
  try {
    dir = fs.mkdtempSync(onRepoVolume);
  } catch {
    // POSIX 上卷根不可写 ⇒ 退回 tmp（此时同卷守卫在该平台上恒真，不影响这些用例）。
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `ci-build-cache-${tag}-`));
  }
  made.push(dir);
  return dir;
}

/** 一份「像样的仓库根」：四份构建面输入各有一份内容（`package.json` 得是能解析的 JSON）。 */
function fakeRepo(tag: string): string {
  const dir = tmpDir(tag);
  for (const file of BUILD_FACE_FILES) {
    fs.writeFileSync(
      path.join(dir, file),
      file === "package.json" ? JSON.stringify({ name: "comfy-fake" }) : `content of ${file}\n`,
      "utf8",
    );
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of slotRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("planBuildCache：五档关系分得开", () => {
  const base = {
    enabled: true,
    cacheRoot: "G:/slots",
    face: FACE,
    localCachePresent: false,
    spaceOk: true,
  };

  it("开关没开 ⇒ 不接槽，且那句话点名开关（这一档最容易被写成「静默不生效」）", () => {
    const plan = planBuildCache({ ...base, enabled: false });
    expect(plan.action).toBe("no-cache");
    expect(plan.path).toBeNull();
    expect(plan.why).toContain(BUILD_CACHE_ENABLED_ENV);
  });

  it("槽根算不出 / 面算不出 ⇒ 两句话不同（合成一档就分不出「没环境」与「算不出」）", () => {
    const noRoot = planBuildCache({ ...base, cacheRoot: null });
    const noFace = planBuildCache({ ...base, face: null });
    expect(noRoot.action).toBe("no-cache");
    expect(noFace.action).toBe("no-cache");
    expect(noRoot.why).toContain("槽根");
    expect(noFace.why).toContain("构建面");
    expect(noRoot.why).not.toBe(noFace.why);
  });

  it("工作区里已有 `.next/cache` ⇒ 不接槽（接上去要删掉本地那份缓存，是副作用不是加速）", () => {
    const plan = planBuildCache({ ...base, localCachePresent: true });
    expect(plan.action).toBe("no-cache");
    expect(plan.why).toContain(".next/cache");
  });

  it("空间不够 ⇒ 不接槽；四道门都成立 ⇒ 接槽并给出槽路径（按面指纹分目录）", () => {
    const noSpace = planBuildCache({ ...base, spaceOk: false });
    expect(noSpace.action).toBe("no-cache");
    expect(noSpace.why).toContain("空间");
    const ok = planBuildCache(base);
    expect(ok.action).toBe("link");
    expect(ok.path).toBe(buildCacheSlotPath("G:/slots", FACE));
    expect(ok.path).toContain(FACE.slice(0, 16));
  });
});

describe("构建面指纹：不含源码", () => {
  it("四份输入齐全 ⇒ 稳定的 sha；缺一份 ⇒ null（调用方据此不接槽）", () => {
    const repo = fakeRepo("face");
    const first = buildFaceFingerprint(repo);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(buildFaceFingerprint(repo)).toBe(first);
    fs.rmSync(path.join(repo, "next.config.js"));
    expect(buildFaceFingerprint(repo)).toBeNull();
  });

  it("改了源码 ⇒ 指纹**不变**（变了就等于每次提交都丢缓存，机制白做）", () => {
    const repo = fakeRepo("src");
    const before = buildFaceFingerprint(repo);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "app.tsx"), "export const x = 1;\n", "utf8");
    expect(buildFaceFingerprint(repo)).toBe(before);
    /* 而工具链变了 ⇒ 指纹要变（那是换一份槽目录的信号）。 */
    fs.writeFileSync(path.join(repo, "pnpm-lock.yaml"), "new lock", "utf8");
    expect(buildFaceFingerprint(repo)).not.toBe(before);
  });

  it("构建面就是那四份（不多不少 —— 少一份判据失效，多一份白丢缓存）", () => {
    expect([...BUILD_FACE_FILES]).toEqual([
      "pnpm-lock.yaml",
      "package.json",
      "next.config.js",
      "tsconfig.json",
    ]);
  });
});

describe("接槽与收尾：链接摘掉，常驻目录还在", () => {
  it("接上后 `.next/cache` 是链接；收尾摘链后**槽里的文件仍在**（穿链删 = 自毁缓存）", () => {
    const repo = fakeRepo("link");
    const slot = tmpDir("slot");
    fs.writeFileSync(path.join(slot, "keep.txt"), "must survive", "utf8");

    const link = linkBuildCache({ repoRoot: repo, slotDir: slot });
    expect(link.linked).toBe(true);
    const linkPath = path.join(repo, ".next", "cache");
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(linkPath, "keep.txt"), "utf8")).toBe("must survive");

    link.restore();
    expect(fs.existsSync(linkPath)).toBe(false);
    /* ⚠️ 这一条是整份机制里最贵的一条边界：摘链摘的是「链接」，不是「它指着的目录」。 */
    expect(fs.existsSync(slot)).toBe(true);
    expect(fs.readFileSync(path.join(slot, "keep.txt"), "utf8")).toBe("must survive");
  });

  it("接不上（`.next/cache` 已存在）⇒ 不接、且不动那个目录", () => {
    const repo = fakeRepo("busy");
    const slot = tmpDir("slot2");
    const existing = path.join(repo, ".next", "cache");
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, "mine.txt"), "keep", "utf8");

    const link = linkBuildCache({ repoRoot: repo, slotDir: slot });
    expect(link.linked).toBe(false);
    expect(fs.readFileSync(path.join(existing, "mine.txt"), "utf8")).toBe("keep");
  });

  it("`.next/cache` 是个**悬空**链接 ⇒ 也算「那个路径上有东西」⇒ 不接槽", () => {
    // `existsSync` 跟链走 ⇒ 悬空链接会被读成「不在」⇒ 于是去建链接 ⇒ 撞 EEXIST。
    // 本机实测踩到过这个形态（一次实验把 `.next/cache` 指到后来删掉的目录）。
    const repo = fakeRepo("dangling");
    const slot = tmpDir("slot3");
    const existing = path.join(repo, ".next", "cache");
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.symlinkSync(path.join(repo, "no-such-target"), existing, "junction");

    const link = linkBuildCache({ repoRoot: repo, slotDir: slot });
    expect(link.linked).toBe(false);
    expect(link.why).toContain(".next/cache");
  });
});

describe("withBuildCacheSlot：开关关着时与「没有这个机制」逐字相同", () => {
  /** 假 store 出口：把槽根指到临时目录（不必真起一次 pnpm）。 */
  function fakeStore(root: string) {
    return () => ({ status: 0, stdout: `${root}\\.pnpm-store\\v11\n` });
  }

  it("开关没开 ⇒ 不建 `.next`、不接槽，跑的东西照跑", () => {
    const repo = fakeRepo("off");
    const lines: Array<string> = [];
    const result = withBuildCacheSlot(() => "built", {
      cwd: repo,
      env: {},
      log: (line) => lines.push(line),
      runStorePath: fakeStore(path.parse(repo).root),
      hasRoom: () => ({ ok: true }),
    });
    expect(result).toBe("built");
    expect(fs.existsSync(path.join(repo, ".next", "cache"))).toBe(false);
    expect(lines.join("\n")).toContain(BUILD_CACHE_ENABLED_ENV);
  });

  it("开关开着 ⇒ 接上槽、跑完摘链，常驻目录留在原处", () => {
    const repo = fakeRepo("on");
    const storeRoot = path.parse(repo).root;
    const slotRoot = path.join(storeRoot, "ci-build-cache", "comfy-fake");
    slotRoots.push(slotRoot);
    const lines: Array<string> = [];
    let linkedDuringRun = false;
    const result = withBuildCacheSlot(
      () => {
        const linkPath = path.join(repo, ".next", "cache");
        linkedDuringRun = fs.existsSync(linkPath);
        return "built";
      },
      {
        cwd: repo,
        env: { [BUILD_CACHE_ENABLED_ENV]: "1" },
        log: (line) => lines.push(line),
        runStorePath: fakeStore(storeRoot),
        hasRoom: () => ({ ok: true }),
      },
    );
    expect(result).toBe("built");
    expect(linkedDuringRun).toBe(true);
    expect(fs.existsSync(path.join(repo, ".next", "cache"))).toBe(false);
    /* 槽留在**推导出来的那个根**下（`ci-build-cache/<包名>/<面指纹>`）。 */
    expect(fs.existsSync(slotRoot)).toBe(true);
  });

  it("跑的东西抛错 ⇒ 链照样摘掉（收尾在 finally 里，不靠「跑完了」）", () => {
    const repo = fakeRepo("throw");
    const storeRoot = path.parse(repo).root;
    slotRoots.push(path.join(storeRoot, "ci-build-cache", "comfy-fake"));
    expect(() =>
      withBuildCacheSlot(
        () => {
          throw new Error("boom");
        },
        {
          cwd: repo,
          env: { [BUILD_CACHE_ENABLED_ENV]: "1" },
          log: () => undefined,
          runStorePath: fakeStore(storeRoot),
          hasRoom: () => ({ ok: true }),
        },
      ),
    ).toThrow("boom");
    expect(fs.existsSync(path.join(repo, ".next", "cache"))).toBe(false);
  });
});

describe("槽根：与依赖面那套槽同源、不同目录", () => {
  /* store 要落在**本机上真实存在的那块卷**上：`path.parse` 认的是宿主平台，
   * 拿 `G:\` 这种盘符当输入时，Linux 宿主解析不出卷根（`root` 是空串）⇒ 推导那一侧
   * 只是照实答「问不出 store」。这里钉的是「两份槽同卷不同目录」，与盘符叫什么无关。 */
  const store = path.join(path.parse(ROOT).root, ".pnpm-store", "v11");
  const run = () => ({ status: 0, stdout: `${store}\\n` });

  it("两者同卷、不同目录（混在一个根下时依赖面那侧的淘汰会删掉这边在用的目录）", () => {
    const deps = resolveCacheRoot({ cwd: ROOT, env: {}, run });
    const build = resolveBuildCacheRoot({ cwd: ROOT, env: {}, run });
    expect(deps.root).not.toBeNull();
    expect(build.root).not.toBeNull();
    expect(path.parse(String(build.root)).root).toBe(path.parse(String(deps.root)).root);
    expect(String(build.root)).not.toBe(String(deps.root));
    expect(String(build.root)).toContain("ci-build-cache");
  });

  it("显式出口只覆盖依赖面那套槽（构建缓存槽不跟着它搬走 —— 它的语义是「那个槽根」）", () => {
    const env = { [CACHE_ROOT_ENV]: "H:/somewhere" };
    expect(resolveCacheRoot({ cwd: ROOT, env, run }).root).toBe("H:/somewhere");
    const build = resolveBuildCacheRoot({ cwd: ROOT, env, run });
    expect(build.root).toBeNull();
    expect(build.from).toContain(CACHE_ROOT_ENV);
  });

  it("问不出 store ⇒ 两边都答「不猜路径」（宁可不省，也不猜一个卷）", () => {
    const noStore = () => ({ status: 1, stdout: "" });
    expect(resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: noStore }).root).toBeNull();
    expect(resolveCacheRoot({ cwd: ROOT, env: {}, run: noStore }).root).toBeNull();
  });
});
