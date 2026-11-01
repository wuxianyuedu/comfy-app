/**
 * 桌包发布那一格的判据（ISSUE #2503）。
 *
 * 这一档钉的是**形状**，不是「包有多大」：
 *  ① **常驻根与两份缓存槽同卷、不同目录** —— 混进 `ci-build-cache/` 里，那边按 TTL
 *    淘汰键位的刀就会把人要取的安装包删掉；
 *  ② **一份一个目录 + `latest` 是指针文件** —— 原地覆盖会让「这一份是什么时候的」
 *    只能靠 mtime 猜（规范 §4.3 那一族）；
 *  ③ **每份自带 manifest** —— 轮转那一刀的排序键就是它，读不到时按 mtime 退档并**念出来**；
 *  ④ **三态退出码分得开** —— 「今天没有新包」（构建没出成品 = 1）与「没能把包放出去」
 *    （问不出根 / 盘不够 = 2）不许都退 0，也不许退成同一个数。
 *
 * 临时目录一律落在**仓库所在卷**（同 `ci-build-cache-slot.test.ts` 的理由：卷是这份
 * 机制的一部分），并给各自的前缀，收尾删干净。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_ROOT_ENV,
  resolveArtifactRoot,
  resolveBuildCacheRoot,
  resolveCacheRoot,
} from "../scripts/ci-cache-slot.mjs";
import {
  DEFAULT_KEEP,
  LATEST_POINTER_FILE,
  MANIFEST_FILE,
  buildLabel,
  collectBundles,
  listReleases,
  main,
  planRotation,
} from "../scripts/publish-desktop-bundle.mjs";

const ROOT = path.resolve(__dirname, "..");
const made: Array<string> = [];

function tmpDir(tag: string): string {
  const onRepoVolume = path.join(path.parse(ROOT).root, `comfy-publish-${tag}`);
  let dir: string;
  try {
    dir = fs.mkdtempSync(onRepoVolume);
  } catch {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `comfy-publish-${tag}-`));
  }
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 一份「打出过成品」的工作区：bundle 根下两份安装包 + 一份非安装包（不许被收走）。 */
function fakeBundleRepo(tag: string): string {
  const repo = tmpDir(tag);
  const bundle = path.join(repo, "src-tauri", "target", "release", "bundle");
  fs.mkdirSync(path.join(bundle, "nsis"), { recursive: true });
  fs.mkdirSync(path.join(bundle, "msi"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "nsis", "app-setup.exe"), "x".repeat(2048));
  fs.writeFileSync(path.join(bundle, "msi", "app.msi"), "y".repeat(1024));
  fs.writeFileSync(path.join(bundle, "nsis", "icon.ico"), "z".repeat(64));
  return repo;
}

/** 起进程那一步的替身：`pnpm store path` 答一个已知卷根。 */
const storeOn = (volume: string) => () => ({
  status: 0,
  stdout: `${volume}\\store\\v10\n`,
});
const noStore = () => ({ status: 1, stdout: "" });

describe("常驻根（resolveArtifactRoot）", () => {
  it("显式出口优先；没配则与两份槽同卷、第三个目录", () => {
    const explicit = resolveArtifactRoot({
      cwd: ROOT,
      env: { [ARTIFACT_ROOT_ENV]: "G:/elsewhere/pkg" },
      run: noStore,
    });
    expect(explicit.root).toBe("G:/elsewhere/pkg");
    expect(explicit.from).toContain(ARTIFACT_ROOT_ENV);

    /* store 要落在**这一台机器真实存在的卷根**上：`path.parse` 认的是宿主平台，
     * 写死 `F:` 这种盘符时 Linux 宿主解析不出卷根（`root` 是空串）⇒ 推导照实答「取不到」。 */
    const volumeRoot = path.parse(ROOT).root;
    const derived = resolveArtifactRoot({ cwd: ROOT, env: {}, run: storeOn(volumeRoot) });
    /* 目录名取的是**本仓 package.json 的 name**（同依赖槽那一份推导），不写死字面量。 */
    /* SAFETY: 类型断言已复核 */
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      name?: string;
    };
    expect(derived.root).toBe(path.join(volumeRoot, "ci-artifacts", String(pkg.name).toLowerCase()));
  });

  it("成品根不许落在缓存槽的根里（那边按键位淘汰会删掉安装包）", () => {
    const io = { cwd: ROOT, env: {}, run: storeOn(path.parse(ROOT).root) };
    const artifacts = resolveArtifactRoot(io).root ?? "";
    for (const other of [resolveCacheRoot(io).root ?? "", resolveBuildCacheRoot(io).root ?? ""]) {
      expect(artifacts.startsWith(other)).toBe(false);
    }
  });

  it("`COMFY_CI_CACHE_ROOT` 只搬依赖槽，不带着成品根一起走 ⇒ 判「取不到」", () => {
    const r = resolveArtifactRoot({
      cwd: ROOT,
      env: { COMFY_CI_CACHE_ROOT: "G:/slots" },
      run: storeOn("G:"),
    });
    expect(r.root).toBeNull();
    expect(r.from).toContain("成品目录不跟着它走");
  });
});

describe("标签与清单", () => {
  it("CI 上有构建号就用构建号，本机退回可排序的 UTC 时刻", () => {
    const now = new Date("2026-10-27T09:40:31.500Z");
    expect(buildLabel({ sha: "abc123def", buildId: "cnb-g35-1k5u" })).toBe(
      "abc123def-bcnb-g35-1k5u",
    );
    expect(buildLabel({ sha: "abc123def", buildId: "(无)", now })).toBe(
      "abc123def-20261027t094031",
    );
    expect(buildLabel({ sha: "", buildId: "", now })).toMatch(/^nosha-/);
    expect(buildLabel({ sha: "a/b:c", buildId: "", now })).not.toMatch(/[/:]/);
  });

  it("只收安装包，相对路径保留目录层级", () => {
    const bundle = path.join(fakeBundleRepo("collect"), "src-tauri", "target", "release", "bundle");
    const found = collectBundles(bundle);
    expect(found.map((e) => e.relPath)).toEqual(["msi/app.msi", "nsis/app-setup.exe"]);
    expect(collectBundles(path.join(bundle, "nope"))).toEqual([]);
  });
});

describe("轮转（留 N 份）", () => {
  const release = (name: string, builtAt: string | null) => ({
    name,
    dir: path.join(tmpDir("rot"), name),
    builtAt,
  });

  it("按 manifest 的 builtAt 排，留下的那一组是最靠后的 N 个", () => {
    const plan = planRotation(
      [
        release("r1", "2026-10-25T00:00:00.000Z"),
        release("r2", "2026-10-26T00:00:00.000Z"),
        release("r3", "2026-10-27T00:00:00.000Z"),
      ],
      2,
    );
    expect(plan.keepDirs.map((d) => d.name)).toEqual(["r3", "r2"]);
    expect(plan.dropDirs.map((d) => d.name)).toEqual(["r1"]);
    expect(plan.unstamped).toEqual([]);
  });

  it("读不到 builtAt 时按 mtime 退档，但必须把这件事念出来", () => {
    const said: Array<string> = [];
    const plan = planRotation([release("r1", null)], 2, (line) => said.push(line));
    expect(plan.unstamped).toEqual(["r1"]);
    expect(said.join("\n")).toContain("读不到 manifest 的 builtAt");
  });
});

describe("发布那一跑（main）", () => {
  /** 跑一次发布，返回退出码 + 日志 + 落点。 */
  function runPublish(opts: {
    argv?: Array<string>;
    env?: Record<string, string>;
    repo?: string;
    root?: string;
    runStore?: () => { status: number; stdout?: string };
  }) {
    const log: Array<string> = [];
    const code = main({
      argv: opts.argv ?? ["--label", "r1"],
      cwd: opts.repo ?? fakeBundleRepo("main"),
      env: { [ARTIFACT_ROOT_ENV]: opts.root ?? tmpDir("root") },
      log: (line: string) => log.push(line),
      runStore: opts.runStore ?? storeOn("G:"),
      runGit: () => "cafe1234567890",
      now: new Date("2026-10-27T09:40:31.000Z"),
    });
    return { code, log: log.join("\n"), root: opts.root };
  }

  it("落一份带 manifest 的目录 + 指针文件，退出 0", () => {
    const root = tmpDir("ok");
    const { code } = runPublish({ root });
    expect(code).toBe(0);
    const dir = path.join(root, "r1");
    /* SAFETY: 类型断言已复核 */
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), "utf8")) as Record<
      string,
      unknown
    >;
    expect(manifest.label).toBe("r1");
    expect(manifest.sha).toBe("cafe1234567890");
    expect(manifest.keep).toBe(DEFAULT_KEEP);
    expect(
      /* SAFETY: 类型断言已复核 */ (manifest.files as Array<{ path: string }>).map((f) => f.path),
    ).toEqual(["msi/app.msi", "nsis/app-setup.exe"]);
    expect(fs.readFileSync(path.join(root, LATEST_POINTER_FILE), "utf8").trim()).toBe("r1");
    /* 指针是**文件**：`<root>/latest` 长成一个目录就是本单禁掉的那个形态。 */
    expect(fs.statSync(path.join(root, LATEST_POINTER_FILE)).isFile()).toBe(true);
    expect(fs.readdirSync(root)).not.toContain("latest");
  });

  it("同标签再来一次 = 退 1，旧目录一个字都不动", () => {
    const root = tmpDir("dup");
    expect(runPublish({ root }).code).toBe(0);
    const before = fs.readFileSync(path.join(root, "r1", MANIFEST_FILE), "utf8");
    const again = runPublish({ root });
    expect(again.code).toBe(1);
    expect(again.log).toContain("已经发布过");
    expect(fs.readFileSync(path.join(root, "r1", MANIFEST_FILE), "utf8")).toBe(before);
  });

  it("超出 keep 的那一份被删掉，永远留 DEFAULT_KEEP 份", () => {
    const root = tmpDir("rotate");
    const sink: Array<string> = [];
    for (const label of ["a1", "a2", "a3"]) {
      expect(
        main({
          argv: ["--label", label],
          cwd: fakeBundleRepo(`rot-${label}`),
          env: { [ARTIFACT_ROOT_ENV]: root },
          log: (line: string) => sink.push(line),
          runStore: storeOn("G:"),
          runGit: () => "cafe1234567890",
          now: new Date(`2026-10-2${label === "a1" ? 5 : label === "a2" ? 6 : 7}T00:00:00.000Z`),
        }),
      ).toBe(0);
    }
    expect(
      listReleases(root)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["a2", "a3"]);
    /* 删了谁必须念得出来 —— 「悄悄少了一份」与「按 keep 轮转掉」在盘上长得一样。 */
    expect(sink.join("\n")).toContain("轮转删 a1");
  });

  it("构建没出成品 = 退 1；问不出常驻根 = 退 2 —— 两种红不许同形", () => {
    const emptyRoot = tmpDir("root2");
    const empty = runPublish({ repo: tmpDir("nobundle"), root: emptyRoot });
    expect(empty.code).toBe(1);
    expect(empty.log).toContain("没有安装包");
    expect(fs.readdirSync(emptyRoot)).toEqual([]);

    const log: Array<string> = [];
    const code = main({
      argv: ["--label", "r1"],
      cwd: fakeBundleRepo("noroot"),
      env: {},
      log: (line: string) => log.push(line),
      runStore: noStore,
      runGit: () => "cafe1234567890",
    });
    expect(code).toBe(2);
    expect(log.join("\n")).toContain("没有结论");
    /* 退 2 那一档的语义是「一份都不落」——落点问不出来的时候不许往任何地方写。 */
    expect(log.join("\n")).toContain("一份成品都不落");
  });

  it("--dry-run 只打印计划，不落盘", () => {
    const root = tmpDir("dry");
    const { code, log } = runPublish({ root, argv: ["--label", "r1", "--dry-run"] });
    expect(code).toBe(0);
    expect(log).toContain("--dry-run：不落盘");
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
