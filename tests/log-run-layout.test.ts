/**
 * 「一次运行一包」日志布局的判据（ISSUE #1326）。
 *
 * 这些用例钉死的是**布局契约**，不是实现细节：目录名形状、归档后 current/
 * 仍在、崩溃标记、保留策略、zip 包结构、根目录只许那几样。改布局前先读
 * 规范 §4 —— 它们红了就是布局变了。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOG_LAYOUT,
  RETENTION,
  archiveCurrent,
  currentDir,
  dirSize,
  exportDiagnostics,
  listRuns,
  logRoot,
  newRunId,
  patchRun,
  pruneRuns,
  readLatest,
  recoverStaleCurrent,
  runDirName,
  runsDir,
  startRun,
  zipDirectory,
} from "../scripts/launcher-core/run.mjs";

/** run.json 的形态（判据只读这几个字段）。 */
type RunMeta = {
  runId?: string;
  mode?: string;
  args?: string[];
  crashed?: boolean;
  exitCode?: number | null;
  endedAt?: string | null;
  durationMs?: number | null;
  startedAt?: string;
};

/** 仓库根（「源码形态」那几条判据要读真文件，不走 tmpdir）。 */
const ROOT = path.resolve(import.meta.dirname, "..");

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "log-run-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** current/ 的绝对路径（`.mjs` 侧返回 string，这里收窄一次省得每处判空）。 */
function cur(): string {
  return path.join(root, "log", "current");
}

/** runs/ 的绝对路径。 */
function runs(): string {
  return path.join(root, "log", "runs");
}

/** 当前这份 run.json（判据都建立在「它一定写出来了」之上）。 */
function meta(): RunMeta {
  return JSON.parse(
    fs.readFileSync(path.join(cur(), LOG_LAYOUT.runJson), "utf8"),
  ) as RunMeta;
}

/** 指定目录下的 run.json（归档包里那份）。 */
function metaAt(dir: string): RunMeta {
  return JSON.parse(
    fs.readFileSync(path.join(dir, LOG_LAYOUT.runJson), "utf8"),
  ) as RunMeta;
}

/** 写一份 current/ 下的日志文件（模拟各写方）。 */
function writeCurrentLog(rel: string, text = "line\n"): string {
  const file = path.join(cur(), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

/** 造一个 runs/ 下的包（名字形如 <日期>_<时分秒>-aaaaaa，与真实归档同形）。 */
function makeRun(name: string, mtime?: Date): string {
  const dir = path.join(runs(), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "launcher.log"), "x");
  if (mtime) fs.utimesSync(dir, mtime, mtime);
  return dir;
}

/** 把某个包的 mtime 对齐到它名字里的日期（归档是复制，mtime 本来就跟着变）。 */
function alignMtimeToName(run: { name: string; dir: string }): void {
  const [date] = run.name.split("_");
  const [year, month, day] = (date ?? "").split("-").map(Number);
  const ts = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1, 0, 0, 0);
  fs.utimesSync(run.dir, ts, ts);
}

/** 用 python3 的 zipfile 验包（它是最严格的那个解压端：Bad CRC-32 当场报）。 */
function unzip(paths: string[]): string[] {
  return execFileSync(
    "python3",
    [
      "-c",
      `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print("BAD" if bad else "OK")
print(",".join(sorted(z.namelist())))
`,
      ...paths,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
}

describe("目录名与路径", () => {
  it("归档目录名不带冒号（Windows 非法字符），且排序即时间序", () => {
    const a = runDirName(new Date(2026, 8, 30, 19, 36, 12), "a1b2c3");
    const b = runDirName(new Date(2026, 8, 30, 21, 10, 4), "9f8e7d");
    expect(a).toBe("2026-09-30_193612-a1b2c3");
    expect(a.includes(":")).toBe(false);
    expect([b, a].sort()).toEqual([a, b]);
  });

  it("runId 是 6 位小写十六进制", () => {
    for (let i = 0; i < 50; i++) expect(newRunId()).toMatch(/^[0-9a-f]{6}$/);
  });

  it("路径常量全在 log/ 下，current 与 runs 是同级子目录", () => {
    expect(logRoot(root)).toBe(path.join(root, "log"));
    expect(currentDir(root)).toBe(cur());
    expect(runsDir(root)).toBe(runs());
    expect(path.dirname(currentDir(root))).toBe(path.dirname(runsDir(root)));
  });
});

describe("current/ 与 run.json", () => {
  it("startRun 建 current/ 并写 run.json（含版本/分支/commit/参数）", () => {
    const { runId, dir } = startRun(root, {
      runId: "a1b2c3",
      args: ["--mode", "prebuilt"],
      mode: "prebuilt",
    });
    expect(runId).toBe("a1b2c3");
    expect(dir).toBe(cur());
    const m = meta();
    expect(m.runId).toBe("a1b2c3");
    expect(m.mode).toBe("prebuilt");
    expect(m.args).toEqual(["--mode", "prebuilt"]);
    expect(m.crashed).toBe(false);
    expect(m.exitCode).toBe(null);
    expect(typeof m.startedAt).toBe("string");
  });

  it("patchRun 是合并不是替换（各进程各记各的，谁都拿不到全量）", () => {
    startRun(root, { runId: "a1b2c3" });
    patchRun(root, { pids: { nextjs: 111 } });
    patchRun(root, { exitCode: 0 });
    const m = meta();
    expect(m.runId).toBe("a1b2c3");
    expect(m.exitCode).toBe(0);
  });
});

describe("归档（正常退出）", () => {
  it("current/ 被复制进 runs/，且目录本身保留（进程手里的路径不能消失）", () => {
    const { runId } = startRun(root, { runId: "a1b2c3" });
    writeCurrentLog("launcher.log");
    writeCurrentLog(path.join("services", "comfyui.log"));

    const target = archiveCurrent(root, {
      exitCode: 0,
      at: new Date(2026, 8, 30, 19, 36, 12),
    });
    expect(target).toBe(path.join(runs(), "2026-09-30_193612-a1b2c3"));

    // 归档里内容齐全
    expect(fs.existsSync(path.join(target ?? "", "launcher.log"))).toBe(true);
    expect(
      fs.existsSync(path.join(target ?? "", "services", "comfyui.log")),
    ).toBe(true);
    // 归档的那份 run.json 补全了收尾字段
    const m = metaAt(target ?? "");
    expect(m.runId).toBe(runId);
    expect(m.exitCode).toBe(0);
    expect(m.crashed).toBe(false);
    expect(typeof m.endedAt).toBe("string");
    expect(typeof m.durationMs).toBe("number");

    // current/ 目录还在，但内容清空
    expect(fs.existsSync(cur())).toBe(true);
    expect(fs.existsSync(path.join(cur(), "launcher.log"))).toBe(false);
    expect(readLatest(root)).toBe("2026-09-30_193612-a1b2c3");
  });

  it("什么都没写、又正常结束的运行不留空包", () => {
    startRun(root, { runId: "a1b2c3" });
    expect(archiveCurrent(root, { exitCode: 0 })).toBe(null);
    expect(listRuns(root)).toEqual([]);
  });
});

describe("崩溃补做（下次启动）", () => {
  it("残留 current/ 被收进 runs/，run.json 标 crashed:true / exitCode:null", () => {
    startRun(root, { runId: "a1b2c3", at: new Date(2026, 8, 30, 19, 36, 12) });
    writeCurrentLog("launcher.log", "崩之前的现场\n");

    const target = recoverStaleCurrent(root, { at: new Date(2026, 9, 1, 8, 0, 0) });
    expect(target).toBe(path.join(runs(), "2026-10-01_080000-a1b2c3"));
    const m = metaAt(target ?? "");
    expect(m.crashed).toBe(true);
    expect(m.exitCode).toBe(null);
    // 现场内容一字不少
    expect(
      fs.readFileSync(path.join(target ?? "", "launcher.log"), "utf8"),
    ).toBe("崩之前的现场\n");
  });

  it("已归档过的 current/ 不重复收（endedAt 在场即跳过）", () => {
    startRun(root, { runId: "a1b2c3" });
    writeCurrentLog("launcher.log");
    archiveCurrent(root, { exitCode: 0 });
    writeCurrentLog("launcher.log"); // 归档后又写了（边缘：清空失败）
    patchRun(root, { endedAt: "2026-09-30T11:36:12.000Z" });
    expect(recoverStaleCurrent(root)).toBe(null);
  });

  it("崩溃补做不覆盖 latest.txt（最近一次**正常完成**的仍是上一次）", () => {
    startRun(root, { runId: "aaaaaa", at: new Date(2026, 8, 30, 10, 0, 0) });
    writeCurrentLog("launcher.log", "正常那次\n");
    archiveCurrent(root, { exitCode: 0, at: new Date(2026, 8, 30, 10, 0, 5) });
    startRun(root, { runId: "bbbbbb", at: new Date(2026, 8, 30, 19, 0, 0) });
    writeCurrentLog("launcher.log", "崩那次\n");
    recoverStaleCurrent(root, { at: new Date(2026, 8, 31, 9, 0, 0) });
    expect(readLatest(root)).toBe("2026-09-30_100005-aaaaaa");
  });
});

describe("保留策略", () => {
  it("只留最近 20 包（更早的删掉）", async () => {
    const names: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const name = `2026-09-${String(i).padStart(2, "0")}_000000-aaaaaa`;
      makeRun(name);
      names.push(name);
    }
    for (const run of listRuns(root)) alignMtimeToName(run);
    // now 设在最后一个包的一个月后：25 包全部掉出 7 天窗口，只剩「最近 20」这条通道
    const now = new Date(2026, 9, 10, 12, 0, 0).getTime();
    const result = await pruneRuns(root, { now });
    expect(result.removed).toBe(5);
    const left = listRuns(root).map((r) => r.name);
    expect(left.length).toBe(20);
    expect(left).not.toContain(names[0]);
    expect(left).toContain(names[24]);
  });

  it("7 天内的包即使超过 20 个也留着（两条通道各管一头）", async () => {
    // 同一天里 25 包（高频调试的真实形态）—— 全部落在 7 天窗口内，
    // 若只剩「20 包上限」这一条通道生效，最早的 5 包会被删。
    const names: string[] = [];
    for (let i = 0; i < 25; i++) {
      const name = `2026-09-10_00000${String(i).padStart(2, "0")}-aaaaaa`;
      makeRun(name, new Date(2026, 8, 10, 12, 0, i));
      names.push(name);
    }
    const now = new Date(2026, 8, 12, 12, 0, 0).getTime();
    const result = await pruneRuns(root, { now });
    expect(result.removed).toBe(0);
    expect(listRuns(root).length).toBe(25);
    expect(listRuns(root).map((r) => r.name)).toContain(names[0]);
  });

  it("两条通道的阈值都写死在常量里（读文档的人一眼看得到）", () => {
    expect(RETENTION.maxRuns).toBe(20);
    expect(RETENTION.maxAgeDays).toBe(7);
    expect(RETENTION.zipAboveBytes).toBe(32 * 1024 * 1024);
    expect(RETENTION.diagnosticsRuns).toBe(3);
  });

  it("目录大小递归统计（不跟符号链接、不数目录项自身）", () => {
    const dir = path.join(cur(), "services");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.log"), "12345");
    fs.writeFileSync(path.join(dir, "b.log"), "123");
    expect(dirSize(dir)).toBe(8);
  });
});

describe("zip 写入器与诊断包", () => {
  it("打出来的包能被系统解压工具读（compress_size 与 uncompressed_size 分开写）", async () => {
    const dir = path.join(root, "src");
    fs.mkdirSync(dir, { recursive: true });
    // 高可压缩内容：store 模式下两个 size 字段恰好相等，**只有这条路径会露馅**
    fs.writeFileSync(path.join(dir, "a.log"), "A".repeat(5000));
    fs.writeFileSync(path.join(dir, "b.bin"), Buffer.from([0, 1, 2, 3, 255]));
    const out = path.join(root, "out.zip");
    await zipDirectory(dir, out);

    const listing = unzip([out]);
    expect(listing[0]).toBe("OK");
    expect(listing[1]).toBe("a.log,b.bin");
    // 内容长度对：压坏 / 截断都会在这里露馅
    const sizes = execFileSync(
      "python3",
      [
        "-c",
        `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
print(len(z.read("a.log")), len(z.read("b.bin")))
`,
        out,
      ],
      { encoding: "utf8" },
    ).trim();
    expect(sizes).toBe("5000 5");
  });

  it("诊断包 = current/ + 最近 3 次 runs/，落在 exports/ 而不是 current/ 下", async () => {
    startRun(root, { runId: "a1b2c3" });
    writeCurrentLog("launcher.log", "本次\n");
    for (let i = 0; i < 5; i++) {
      const name = `2026-09-${String(20 + i).padStart(2, "0")}_000000-aaaaaa`;
      makeRun(name);
    }
    const out = await exportDiagnostics(root, {
      at: new Date(2026, 8, 30, 19, 36, 12),
    });
    expect(path.dirname(out)).toBe(path.join(root, "log", LOG_LAYOUT.exports));
    expect(path.basename(out)).toBe("diagnostics-2026-09-30_193612-a1b2c3.zip");

    const names = unzip([out])[1]?.split(",") ?? [];
    expect(names).toContain("current/launcher.log");
    // 最近 3 次：22/23/24（19/20/21 更早的被排除）—— 按目录去重数，不是数文件
    const packed = new Set(
      names.filter((n) => n.startsWith("runs/")).map((n) => n.split("/")[1]),
    );
    expect([...packed].sort()).toEqual([
      "2026-09-22_000000-aaaaaa",
      "2026-09-23_000000-aaaaaa",
      "2026-09-24_000000-aaaaaa",
    ]);
    // 暂存目录不留痕（否则下一次会被一起打进去）
    expect(
      fs
        .readdirSync(path.join(root, "log", LOG_LAYOUT.exports))
        .filter((n) => n.startsWith(".stage")),
    ).toEqual([]);
  });
});

describe("log/ 根目录只许那几样", () => {
  it("跑完一轮后根目录恰好是 current/ runs/ exports/ latest.txt", async () => {
    startRun(root, { runId: "a1b2c3" });
    writeCurrentLog("launcher.log");
    archiveCurrent(root, { exitCode: 0 });
    await exportDiagnostics(root, { at: new Date(2026, 8, 30, 19, 36, 12) });
    expect(fs.readdirSync(logRoot(root)).sort()).toEqual(
      ["current", "exports", "latest.txt", "runs"].sort(),
    );
  });
});

describe("布局的单一出处（写方不得自己拼路径）", () => {
  it("scripts 侧的 current/ 分区与 log-paths.ts 逐项同形", async () => {
    const { LOG_DIRS } = await import("../scripts/launcher-core/log.mjs");
    const paths = await import("../src/lib/log/log-paths.ts");
    // current/ 下的分区：两侧都必须认识同一批名字（少一个 = 那一处写到了别处，
    // 归档时收不走；多一个 = 有一侧在往不存在的位置写）。
    const scriptDirs = new Set(Object.values(LOG_DIRS));
    for (const name of ["launcher", "nextjs", "services", "tools", "comfyui"]) {
      expect(scriptDirs.has(name), `${name} 不在 scripts 侧分区里`).toBe(true);
    }
    const tsCurrent = path.dirname(paths.LAUNCHER_LOG_DIR);
    expect(path.basename(tsCurrent)).toBe(LOG_LAYOUT.current);
    expect(paths.NEXTJS_LOG_DIR.startsWith(tsCurrent)).toBe(true);
    expect(paths.SERVICES_LOG_DIR.startsWith(tsCurrent)).toBe(true);
    expect(paths.WORKSHOP_LOG_DIR.startsWith(tsCurrent)).toBe(true);
  });

  it("schema-sync 两个孤儿已归入 current/tools/（根目录不再有它们）", async () => {
    const paths = await import("../src/lib/log/log-paths.ts");
    expect(path.basename(path.dirname(paths.SCHEMA_SYNC_STATUS_FILE))).toBe(
      "tools",
    );
    expect(path.dirname(paths.SCHEMA_SYNC_STATUS_FILE)).toBe(paths.TOOLS_LOG_DIR);
    // 与 scripts/db-schema-state.mjs 的相对路径同形（写方在那边、读方在这边）
    const { SCHEMA_SYNC_STATUS_FILE } = await import(
      "../scripts/db-schema-state.mjs"
    );
    expect(SCHEMA_SYNC_STATUS_FILE.split(path.sep)).toEqual([
      "log",
      "current",
      "tools",
      "schema-sync.json",
    ]);
  });

  it("log/ 根下的固定名只有那几样 —— 没有第二处拼 'log/xxx' 的地方", () => {
    // 扫描各写方源码：出现 `"log", "<分区>"` 直连（跳过 current）即违规。
    const files = [
      "scripts/dev-launcher.mjs",
      "scripts/executor-host.mjs",
      "scripts/standalone-runtime.mjs",
      "scripts/db-schema-state.mjs",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const offenders = src
        .split("\n")
        .filter((line) => /"log",\s*"(launcher|nextjs|services|shell|tools|comfyui|workshop)"/.test(line));
      expect(offenders, `${rel} 里仍有绕过 current/ 的日志路径`).toEqual([]);
    }
  });
});
