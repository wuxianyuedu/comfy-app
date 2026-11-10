/**
 * 构建缓存槽判据（#2158）：钉机制形状而非省多少秒 —— ①几道门分得开（没开 / 槽根算不出 / 面算不出 / 已有缓存 / 空间不够）；
 * ②面指纹不含源码（源码变了必须不变，否则每次提交丢缓存）；③摘链不穿链（删链接本身，常驻目录必须还在，否则一次构建删光）；
 * ④开关关着时与「没有这机制」逐字相同。头注 95s / 14.9s 是实测性能读数，不参与判形状。
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
import { resolveBuildCacheRoot } from "../scripts/ci-cache-slot.mjs";

const ROOT = path.resolve(__dirname, "..");
const FACE = "a".repeat(64);

/**
 * 临时目录（真实文件系统 —— 「摘链后目标还在」那一档造不出夹具）。必须落在仓库所在卷：槽根有「同卷」推导，
 * `os.tmpdir()` 在 C:、本仓在 G:，拿 tmp 当槽根会让「同卷」那一档永远测不到。
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
    /* 槽根**注入**（#3095）：槽根按设计落在卷根下，而 POSIX 上 `/` 不可写（Windows
     * 盘符根可写）—— 那是平台事实，不该让用例红。注入一个可写目录后，链接 / 摘链 /
     * 常驻目录三条断言一字不改；生产路径不传这个键，照推导走。 */
    const cacheRoot = path.join(path.dirname(repo), "ci-build-cache-root-on");
    const slotRoot = buildCacheSlotPath(cacheRoot, String(buildFaceFingerprint(repo)));
    slotRoots.push(cacheRoot);
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
        cacheRoot,
        log: (line) => lines.push(line),
        runStorePath: fakeStore(path.parse(repo).root),
        hasRoom: () => ({ ok: true }),
      },
    );
    expect(result).toBe("built");
    expect(linkedDuringRun).toBe(true);
    expect(fs.existsSync(path.join(repo, ".next", "cache"))).toBe(false);
    /* 槽留在**槽根**下（`<槽根>/<面指纹>`）。 */
    expect(fs.existsSync(slotRoot)).toBe(true);
  });

  it("跑的东西抛错 ⇒ 链照样摘掉（收尾在 finally 里，不靠「跑完了」）", () => {
    const repo = fakeRepo("throw");
    /* 与上一条同因（#3095）：注入可写槽根，让「链接已建 ⇒ 抛错 ⇒ 照样摘链」这条
     * 真的被走到（否则 Linux 上压根没接槽，finally 那一段就没被测）。 */
    const cacheRoot = path.join(path.dirname(repo), "ci-build-cache-root-throw");
    slotRoots.push(cacheRoot);
    expect(() =>
      withBuildCacheSlot(
        () => {
          throw new Error("boom");
        },
        {
          cwd: repo,
          env: { [BUILD_CACHE_ENABLED_ENV]: "1" },
          cacheRoot,
          log: () => undefined,
          runStorePath: fakeStore(path.parse(repo).root),
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

  it("构建缓存槽的根带自己的目录名（与成品 / 工具两套根互不相扰）", () => {
    const build = resolveBuildCacheRoot({ cwd: ROOT, env: {}, run });
    expect(build.root).not.toBeNull();
    expect(String(build.root)).toContain("ci-build-cache");
  });

  it("问不出 store ⇒ 答「不猜路径」（宁可不省，也不猜一个卷）", () => {
    const noStore = () => ({ status: 1, stdout: "" });
    expect(resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: noStore }).root).toBeNull();
  });
});
