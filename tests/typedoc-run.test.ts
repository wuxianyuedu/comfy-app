/**
 * `scripts/typedoc-run.mjs` 的判据 —— typedoc「跑 + 验 + 重试」的唯一实现。
 *
 * 要钉的是那条**无声**的失败：退出码 0 + 日志收尾 `[info] html generated at …` +
 * 一条 `[warning] Found 0 errors and N warnings`，而 `docs/api/**` 一个文件都没更新。
 * 现场里目录还堆着上一轮的产物，所以「文件数 > 0」会被蒙过去 —— 判据必须落在
 * 「探针文件是不是这一轮写的」上；而「退 0 就算成功」那种写法连这一条都问不到。
 *
 * 三条要钉的东西，各自都能「看起来还在、实际不判」：
 *   1. **验的是产物、不是退出码**：退出 0 但探针 mtime 早于本次开始 = 失败；
 *   2. **失败了要重试**：typedoc 冷跑以数十秒计（现值取法见规范 §13.5.17），用例不可能真跑它 —— 用 `spawnImpl`
 *      注入缝把「起了但没写」这个现场直接喂进来，验它真的会重试到用完次数；
 *   3. **重试能救回来**：第二次才写出来的场景要判**成功**，且报第 2 次 ——
 *      重试若把「失败过一次」记成失败，就等于白重试。
 *
 * 用一次性目录做夹具，不碰仓库里的 `docs/api`。
 */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PROBE_REL,
  judgeRun,
  resolveTypedocEntry,
  runTypedoc,
  snapshotOutput,
  typedocArgs,
} from "../scripts/typedoc-run.mjs";

const temps: Array<string> = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

/** 造一份「刚刚写过」的产物：探针文件存在且 mtime 是现在。 */
function writeProbe(outDir: string) {
  writeFileSync(path.join(outDir, PROBE_REL), "<html>ok</html>\n");
}

/**
 * 造一份「上一轮留下的」产物：探针存在但 mtime 在一分钟前。
 * 真实现场里 `docs/api` 就是这副样子 —— 目录里堆着上一轮的产物，所以
 * 「文件数 > 0」这条判据会被它蒙过去，只有 mtime 能问出「这一轮写没写」。
 */
function writeStaleProbe(outDir: string) {
  writeProbe(outDir);
  const past = new Date(Date.now() - 60_000);
  utimesSync(path.join(outDir, PROBE_REL), past, past);
}

/**
 * 重试提示在用例里是噪声：吞掉它。写成 `() => undefined` 而不是空函数体 ——
 * 后者会被 `@typescript-eslint/no-empty-function` 判成「忘了实现」。
 */
const quiet = () => undefined;

/** 注入缝里的「typedoc 起了、正常收尾」：退出 0，但什么都不写。 */
const silentRun = () => ({
  status: 0,
  signal: null,
  error: null,
  log: "[info] html generated",
});

describe("judgeRun：结论来自产物，不来自退出码", () => {
  it("退出 0 但探针没被这一轮重写 = 失败（就是那个「说生成了、产物没动」的现场）", () => {
    const dir = tempDir("typedoc-run-stale-");
    writeStaleProbe(dir);
    const startedAt = Date.now();
    const verdict = judgeRun(silentRun(), {
      after: snapshotOutput(dir),
      startedAt,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("nothing was written");
  });

  it("探针是这一轮写的 = 成功（重试后真的写出来的那一次要走通）", () => {
    const dir = tempDir("typedoc-run-fresh-");
    const startedAt = Date.now();
    writeProbe(dir);
    expect(judgeRun(silentRun(), { after: snapshotOutput(dir), startedAt }).ok).toBe(true);
  });

  it("起不来 / 非零退出：这两种失败有声音，别让它们挤掉上面那条", () => {
    const after = { exists: true, files: 1, probeMtimeMs: Date.now() };
    expect(judgeRun({ status: null, error: new Error("EINVAL") }, { after, startedAt: 0 }).ok).toBe(
      false,
    );
    expect(judgeRun({ status: 1, error: null }, { after, startedAt: 0 }).ok).toBe(false);
  });

  it("目录不存在 / 空目录 / 缺探针文件：三种「没写出来」都要判失败", () => {
    const dir = tempDir("typedoc-run-empty-");
    const startedAt = Date.now();
    for (const after of [
      { exists: false, files: 0, probeMtimeMs: null },
      { exists: true, files: 0, probeMtimeMs: null },
      snapshotOutput(dir), // 目录存在但没有 index.html
    ]) {
      expect(judgeRun(silentRun(), { after, startedAt }).ok, JSON.stringify(after)).toBe(false);
    }
  });
});

describe("snapshotOutput", () => {
  it("目录不存在时三件事都是空（不抛）", () => {
    expect(snapshotOutput(path.join(tempDir("typedoc-run-missing-"), "nope"))).toEqual({
      exists: false,
      files: 0,
      probeMtimeMs: null,
    });
  });
});

describe("runTypedoc：静默失败会重试，救回来算成功", () => {
  it("每次都「退 0 但没写」→ 重试到用完次数，结论是失败", async () => {
    const outDir = tempDir("typedoc-run-retry-");
    writeStaleProbe(outDir); // 上一轮的产物还在：文件数 > 0，只有 mtime 问得出问题
    let calls = 0;
    const res = await runTypedoc({
      outDir,
      attempts: 3,
      backoff: [0, 0],
      spawnImpl: async () => {
        calls += 1;
        return silentRun();
      },
      onProgress: quiet,
    });
    expect(calls).toBe(3);
    expect(res.ok).toBe(false);
    expect(res.attempt).toBe(3);
    expect(res.reason).toContain("nothing was written");
    // 产物一个没少、也一个没更新 —— 正是「看起来没坏」的那一面
    expect(res.files).toBe(1);
  });

  it("第二次才写出来 → 判成功，且报的是第 2 次（不是「失败过」）", async () => {
    const outDir = tempDir("typedoc-run-recover-");
    let calls = 0;
    const res = await runTypedoc({
      outDir,
      attempts: 3,
      backoff: [0, 0],
      spawnImpl: async (_bin: string, dir: string) => {
        calls += 1;
        if (calls >= 2) {
          writeProbe(dir);
        }
        return silentRun();
      },
      onProgress: quiet,
    });
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
    expect(res.attempt).toBe(2);
    expect(res.files).toBe(1);
  });

  it("--attempts 1 时不重试（想看原始失败形态时不必等）", async () => {
    const outDir = tempDir("typedoc-run-once-");
    let calls = 0;
    const res = await runTypedoc({
      outDir,
      attempts: 1,
      backoff: [0, 0],
      spawnImpl: async () => {
        calls += 1;
        return silentRun();
      },
      onProgress: quiet,
    });
    expect(calls).toBe(1);
    expect(res.ok).toBe(false);
  });

  it("typedoc 没装：直接给结论，一次都不跑", async () => {
    const res = await runTypedoc({
      outDir: tempDir("typedoc-run-nobin-"),
      root: tempDir("typedoc-run-fakeroot-"),
      onProgress: quiet,
    });
    expect(res.ok).toBe(false);
    expect(res.attempt).toBe(0);
    expect(res.reason).toContain("pnpm install");
  });
});

describe("resolveTypedocEntry", () => {
  it("仓库里有本地 typedoc（JS 入口，不是 .cmd 垫片）；没有 node_modules 的根给 null", () => {
    const entry = resolveTypedocEntry();
    expect(entry).toBeTruthy();
    /* ISSUE #2445：起的是包真身（`typedoc/bin/typedoc`），不是 `node_modules/.bin`
     * 下的垫片 —— 垫片要 shell 层（DEP0190），真身用 `process.execPath` 直起。 */
    expect(entry!.replaceAll("\\", "/")).toContain("typedoc/bin/typedoc");
    expect(entry!.replaceAll("\\", "/")).not.toContain(".bin/");
    expect(resolveTypedocEntry(tempDir("typedoc-run-bare-"))).toBeNull();
  });
});

describe("typedocArgs：参数面钉在这里（ISSUE #2843）", () => {
  it("--out 指向调用方给的目录，且带 --skipErrorChecking", () => {
    expect(typedocArgs("G:/tmp/out")).toEqual(["--out", "G:/tmp/out", "--skipErrorChecking"]);
  });

  it("--skipErrorChecking 不是给 type error 的出口：它只跳过 typedoc 自己那趟检查", () => {
    /* 参数面**没有**任何「把 warning 也关掉」的旗标（`--logLevel Error` 之类）。
     * warning 类（未收录符号 / 死链 / JSDoc 漂移）必须照报 —— 本仓 §13.5.5.1 把
     * 「typedoc 报 error / 报 warning」两种读数分开算账，关了 warning 等于把那一格
     * 的判断抹平。这条断言就是那句「warning 照旧」的机器形态。 */
    expect(typedocArgs("G:/tmp/out")).not.toContain("--logLevel");
    expect(typedocArgs("G:/tmp/out")).not.toContain("--treatWarningsAsErrors");
  });
});

describe("spawnTypedoc 不经 shell 层（ISSUE #2445）", () => {
  it("模块源码里不再有 shell 选项与手工括引号（DEP0190 的形状判据）", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/typedoc-run.mjs"), "utf8");
    /* spawn 的 args 数组 + shell:true 是 Node 26 的 DEP0190 弃用形态；且 shell 一开
     * Node 就不转义参数，引号要自己括。两个形状都不许回来 —— 用例层测不到真 spawn
     * 的选项面，源码形状是那层覆盖的唯一口径（#2444 同款）。 */
    expect(source).not.toMatch(/shell\s*:/);
    expect(source).not.toMatch(/windowsVerbatimArguments|const q = /);
  });
});
