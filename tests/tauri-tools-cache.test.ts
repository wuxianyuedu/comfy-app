/**
 * NSIS 工具镜像那一格的判据（ISSUE #2525）。
 *
 * 这一档钉的不是「能不能下载」，而是**三态分得开**与**不许覆盖**：
 *  ① 已在场 ⇒ 一个字都不动（否则每次作业都在重搓一棵正在被 bundler 用的树）；
 *  ② 不在场而镜像在 ⇒ 拷过去并逐件复算哈希（镜像坏了必须红，不许留半棵树继续打包）；
 *  ③ 两边都没有 ⇒ **退 2「没有结论」**并念出出口，而不是让 bundler 去撞那条 22–23s 的预算。
 *
 * `--seed` 那一侧再加两条：**种源不齐不种**（把缺陷钉成事实比不种更坏），
 * **同版本不覆盖**（覆盖之后「常驻根里这份是哪一天的」没有可读的来源）。
 *
 * 夹具用一份**可注入的 plan**：真件的 sha256 钉在生产常量 `NSIS_PLAN` 里，合成树造不出那个哈希，
 * 所以哈希这一族判据在夹具上跑、生产常量由「形状」那几条守着。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TOOLS_ROOT_ENV,
  resolveBuildCacheRoot,
  resolveCacheRoot,
  resolveToolRoot,
} from "../scripts/ci-cache-slot.mjs";
import {
  NSIS_PLAN,
  TOOLS_MANIFEST_FILE,
  ensure,
  listTreeFiles,
  mirrorDir,
  missingRequired,
  resolveTauriCacheRoot,
  seed,
} from "../scripts/tauri-tools-cache.mjs";

const ROOT = path.resolve(__dirname, "..");
const made: Array<string> = [];

function tmpDir(tag: string): string {
  const onRepoVolume = path.join(path.parse(ROOT).root, `comfy-tools-${tag}`);
  let dir: string;
  try {
    dir = fs.mkdtempSync(onRepoVolume);
  } catch {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `comfy-tools-${tag}-`));
  }
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 一份与生产同形状的 plan，但 dll 的哈希按夹具内容现算 —— 让「哈希认不过」这条能被测到。 */
function fixturePlan(dllContent: string) {
  return {
    ...NSIS_PLAN,
    version: "9.99",
    assets: {
      zip: { sha256: "z".repeat(64), bytes: 1 },
      dll: {
        sha256: crypto.createHash("sha256").update(dllContent).digest("hex"),
        bytes: dllContent.length,
      },
    },
  };
}

/**
 * 造一棵「bundler 已经下好」的缓存树。
 *
 * @param {string} tauriRoot 传给 seed/ensure 的 `cacheDir`（生产里它 = `LOCALAPPDATA\tauri`）
 * @param {{dllContent?: string, drop?: string[]}} [opts] `drop` = 故意缺哪几件
 */
function fakeCacheTree(
  tauriRoot: string,
  opts: { dllContent?: string; drop?: Array<string> } = {},
) {
  const dllContent = opts.dllContent ?? "dll-bytes";
  const plan = fixturePlan(dllContent);
  const root = path.join(tauriRoot, NSIS_PLAN.cacheRel);
  for (const rel of plan.required) {
    if (opts.drop?.includes(rel)) continue;
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, rel === plan.dllRel ? dllContent : `内容:${rel}`);
  }
  /* 一件非必需件：清单要把它一起收（bundler 那棵树是整体，缺件判据只管必需那几件）。 */
  const extra = path.join(root, "Include", "extra.nsh");
  fs.mkdirSync(path.dirname(extra), { recursive: true });
  fs.writeFileSync(extra, "extra");
  return { root, plan };
}

/** 那一档不看日志，但也不许交一个空函数出去（空函数正是「这句话没被读」的形状）。 */
function quiet() {
  const sink: Array<string> = [];
  return (line: string) => sink.push(line);
}

describe("落点与根", () => {
  it("工具根：显式出口优先；没配则与两份槽同卷、第四个目录", () => {
    const explicit = resolveToolRoot({
      cwd: ROOT,
      env: { [TOOLS_ROOT_ENV]: "G:/tools-mirror" },
      run: () => ({ status: 1, stdout: "" }),
    });
    expect(explicit.root).toBe("G:/tools-mirror");

    const run = () => ({ status: 0, stdout: "G:\\.pnpm-store\\v11\n" });
    const pkgName = String(
      /* SAFETY: 类型断言已复核 */ (
        JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { name?: string }
      ).name,
    ).toLowerCase();
    expect(resolveToolRoot({ cwd: ROOT, env: {}, run }).root).toBe(
      path.join("G:\\", "ci-tools", pkgName),
    );
    /* 不许住在两份槽根之下：那边的淘汰器按 TTL 删键位，而这一份删了今天就没包。 */
    const roots = {
      deps: resolveCacheRoot({ cwd: ROOT, env: {}, run }).root ?? "",
      build: resolveBuildCacheRoot({ cwd: ROOT, env: {}, run }).root ?? "",
      tools: resolveToolRoot({ cwd: ROOT, env: {}, run }).root ?? "",
    };
    expect(roots.tools.startsWith(roots.deps)).toBe(false);
    expect(roots.tools.startsWith(roots.build)).toBe(false);
  });

  it("bundler 落点由 LOCALAPPDATA 推（作业账号里它就是已知目录）", () => {
    const r = resolveTauriCacheRoot({ LOCALAPPDATA: "G:/la" });
    expect(r.dir).toBe(path.join("G:/la", "tauri"));
    expect(r.from).toContain("LOCALAPPDATA");
    expect(resolveTauriCacheRoot({}).dir).toBeNull();
  });
});

describe("必需件视图", () => {
  it("缺件清单按 bundler 那份路径点名；相对路径一律正斜杠", () => {
    const la = tmpDir("missing");
    const { root } = fakeCacheTree(la, { drop: ["NSIS.exe", "makensis.exe"] });
    expect(missingRequired(root, NSIS_PLAN.required)).toEqual(["NSIS.exe", "makensis.exe"]);
    expect(listTreeFiles(root)).toContain("Include/extra.nsh");
    expect(listTreeFiles(path.join(la, "nope"))).toEqual([]);
  });

  it("dll 的落点必须在必需件清单里（补了别的、漏了它 = bundler 照样判「不完整」）", () => {
    expect(NSIS_PLAN.required).toContain(NSIS_PLAN.dllRel);
  });
});

describe("--seed", () => {
  it("种成功：逐件进清单，且同版本不覆盖", () => {
    const la = tmpDir("seed-ok");
    const tools = tmpDir("seed-tools");
    const { plan } = fakeCacheTree(la);
    const mirror = mirrorDir(tools, plan);
    const lines: Array<string> = [];
    const log = (line: string) => lines.push(line);
    expect(seed({ cacheDir: la, mirror, dryRun: false, log, plan })).toBe(0);
    const manifest = /* SAFETY: 类型断言已复核 */ JSON.parse(
      fs.readFileSync(path.join(mirror, TOOLS_MANIFEST_FILE), "utf8"),
    ) as { version: string; files: Array<{ path: string; sha256: string }> };
    expect(manifest.version).toBe(plan.version);
    expect(manifest.files.map((f) => f.path)).toContain(plan.dllRel);
    /* 清单里的哈希必须真能对上盘上的内容 —— 否则 ensure 那侧的复算就是走过场。 */
    const dllEntry = manifest.files.find((f) => f.path === plan.dllRel);
    expect(dllEntry?.sha256).toBe(plan.assets.dll.sha256);
    /* 第二次种同一版本 = 拒绝，不是覆盖。 */
    expect(seed({ cacheDir: la, mirror, dryRun: false, log, plan })).toBe(1);
    expect(lines.join("\n")).toContain("已经种过");
  });

  it("种源不齐 ⇒ 退 2；哈希认不过 ⇒ 退 1 且不落盘", () => {
    const la = tmpDir("seed-incomplete");
    fakeCacheTree(la, { drop: ["NSIS.exe"] });
    const mirror = path.join(tmpDir("seed-incomplete-tools"), "nsis", "9.99");
    const lines: Array<string> = [];
    expect(
      seed({
        cacheDir: la,
        mirror,
        dryRun: false,
        log: (l) => lines.push(l),
        plan: fixturePlan("dll-bytes"),
      }),
    ).toBe(2);
    expect(lines.join("\n")).toContain("缺 1 件必需件");

    const la2 = tmpDir("seed-baddll");
    const plan = fakeCacheTree(la2).plan;
    const bad = { ...plan, assets: { ...plan.assets, dll: { sha256: "f".repeat(64), bytes: 1 } } };
    const mirror2 = path.join(tmpDir("seed-baddll-tools"), "nsis", "9.99");
    const lines2: Array<string> = [];
    expect(
      seed({
        cacheDir: la2,
        mirror: mirror2,
        dryRun: false,
        log: (l) => lines2.push(l),
        plan: bad,
      }),
    ).toBe(1);
    expect(lines2.join("\n")).toContain("对不上");
    expect(fs.existsSync(mirror2)).toBe(false);
  });
});

describe("ensure（作业起手那一格）", () => {
  /** 一整套：镜像由 seed 造出来，ensure 面对的是**空缓存**。 */
  function seededPair() {
    const la = tmpDir("ens-la");
    const tools = tmpDir("ens-tools");
    const { plan } = fakeCacheTree(la);
    const mirror = mirrorDir(tools, plan);
    seed({ cacheDir: la, mirror, dryRun: false, log: quiet(), plan });
    /* 把 bundler 落点清干净，模拟「新作业 / 被 bundler 删过」。 */
    fs.rmSync(path.join(la, NSIS_PLAN.cacheRel), {
      recursive: true,
      force: true,
    });
    return { la, tools, plan, mirror };
  }

  it("空缓存 + 镜像在场 ⇒ 补齐、必需件全在、退 0", () => {
    const { la, tools, plan } = seededPair();
    const lines: Array<string> = [];
    const code = ensure({
      cacheDir: la,
      toolRoot: tools,
      toolRootFrom: "用例注入",
      dryRun: false,
      log: (l) => lines.push(l),
      plan,
    });
    expect(code).toBe(0);
    expect(missingRequired(path.join(la, NSIS_PLAN.cacheRel), plan.required)).toEqual([]);
    expect(lines.join("\n")).toContain("已补齐");
  });

  it("已在场 ⇒ 不动任何东西（不许每次作业重搓一棵正在被用的树）", () => {
    const { la, tools, plan } = seededPair();
    const first = ensure({
      cacheDir: la,
      toolRoot: tools,
      toolRootFrom: "用例注入",
      dryRun: false,
      log: quiet(),
      plan,
    });
    expect(first).toBe(0);
    const dll = path.join(la, NSIS_PLAN.cacheRel, ...plan.dllRel.split("/"));
    const before = fs.statSync(dll);
    const lines: Array<string> = [];
    expect(
      ensure({
        cacheDir: la,
        toolRoot: tools,
        toolRootFrom: "用例注入",
        dryRun: false,
        log: (l) => lines.push(l),
        plan,
      }),
    ).toBe(0);
    expect(lines.join("\n")).toContain("不动任何东西");
    expect(fs.statSync(dll).mtimeMs).toBe(before.mtimeMs);
  });

  it("两边都没有 ⇒ 退 2「没有结论」并给出出口，而不是放行让 bundler 去撞预算", () => {
    const la = tmpDir("ens-empty");
    const lines: Array<string> = [];
    const code = ensure({
      cacheDir: la,
      toolRoot: tmpDir("ens-none-tools"),
      toolRootFrom: "用例注入",
      dryRun: false,
      log: (l) => lines.push(l),
      plan: fixturePlan("dll-bytes"),
    });
    expect(code).toBe(2);
    const text = lines.join("\n");
    expect(text).toContain("没有结论");
    expect(text).toContain("--seed");
  });

  it("镜像被改过 ⇒ 拷完复算哈希不过就退 1，不许留半棵树继续打包", () => {
    const { la, tools, plan } = seededPair();
    const dllInMirror = path.join(tools, "nsis", plan.version, ...plan.dllRel.split("/"));
    fs.writeFileSync(dllInMirror, "被人换过的内容");
    const lines: Array<string> = [];
    const code = ensure({
      cacheDir: la,
      toolRoot: tools,
      toolRootFrom: "用例注入",
      dryRun: false,
      log: (l) => lines.push(l),
      plan,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("与清单对不上");
  });
});

describe("被钉住的那一份", () => {
  it("版本、两件资产的哈希与字节都在场（升版本必须是一次看得见的改动）", () => {
    expect(NSIS_PLAN.name).toBe("nsis");
    expect(NSIS_PLAN.cacheRel).toBe("NSIS");
    expect(NSIS_PLAN.version).toMatch(/^\d+\.\d+$/);
    for (const asset of Object.values(NSIS_PLAN.assets)) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.bytes).toBeGreaterThan(0);
    }
  });
});
