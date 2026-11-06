/**
 * `pnpm ship` 的落盘回读点（ISSUE #3206）：**后台完成不保证唤醒**。
 *
 * 这一档锁住三件事：① sink 一创建就写 `running`（write-ahead，把 `flush()` 从
 * 创建处挪走必红）；② 读数只从 `log()` 原文提取，身份 / 阶段 / PR / 结论不另立
 * 判定；③ 写盘失败 best-effort，绝不把 ship 的三态退码带偏。
 *
 * 落盘路径靠 `resolve` 注入到临时目录，一次也不碰真实 `.git/`。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createShipResultSink, formatShipResult, readShipResult } from "../scripts/ship-result.mjs";

const ROOT = process.cwd();

let fakeGitDir: string;
/** 假 git 目录：让 `gitScratchPath()` 落进临时目录，不碰本机真实检出。 */
const resolve = () => fakeGitDir;

beforeEach(() => {
  fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-result-"));
});

afterEach(() => {
  fs.rmSync(fakeGitDir, { recursive: true, force: true });
});

const resultFile = () => path.join(fakeGitDir, "ship-result.json");

describe("write-ahead 落盘", () => {
  it("sink 一创建就落 status=running（不等第一行 log）", () => {
    createShipResultSink({ root: ROOT, resolve, now: () => "T0" });
    const reading = readShipResult(ROOT, resolve);
    expect(reading.found).toBe(true);
    expect(reading.result?.status).toBe("running");
    expect(reading.result?.exitCode).toBeNull();
    expect(reading.result?.finishedAt).toBeNull();
    expect(reading.result?.startedAt).toBe("T0");
  });

  it("running 的回读明说「没给结论」，不许念成通过", () => {
    createShipResultSink({ root: ROOT, resolve });
    const text = formatShipResult(readShipResult(ROOT, resolve)).join("\n");
    expect(text).toContain("没给结论");
    expect(text).not.toContain("全绿");
  });

  it("每笔 log 同步追加，身份 / 阶段 / PR / 结论都取自原文", () => {
    const seen: string[] = [];
    const sink = createShipResultSink({
      root: ROOT,
      resolve,
      args: ["--no-wait"],
      now: () => "T1",
    });
    const log = sink.wrapLog((s) => seen.push(s));
    log("[ship] 分支 feat/x · sha abc1234 · 仓库 moon-read/comfy-app-t3 · 远端 origin");
    log("[ship] ▶ 预检通过 | branch=feat/x | sha=abc1234");
    log("[ship] ▶ 新建 PR | pr=3206 | state=open");
    log("[ship] 结论：exit 1 —— 有事实是红的");

    const mid = readShipResult(ROOT, resolve).result;
    expect(mid?.status).toBe("running");
    expect(mid?.argv).toEqual(["--no-wait"]);
    expect(mid?.branch).toBe("feat/x");
    expect(mid?.headSha).toBe("abc1234");
    expect(mid?.repo).toBe("moon-read/comfy-app-t3");
    expect(mid?.pr).toBe(3206);
    expect(mid?.stages).toEqual([
      "预检通过 | branch=feat/x | sha=abc1234",
      "新建 PR | pr=3206 | state=open",
    ]);
    expect(mid?.conclusion).toContain("exit 1");
    expect(seen).toHaveLength(4);
  });

  it("读数行超上限 ⇒ 保留开头身份与末尾停点，并标 truncated", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.append("[ship] 分支 feat/x · sha abc · 仓库 moon-read/x");
    for (let i = 0; i < 600; i += 1) {
      sink.append(`读数 ${i}`);
    }
    const result = readShipResult(ROOT, resolve).result;
    expect(result?.truncated).toBe(true);
    expect(result?.lines).toHaveLength(500);
    expect(result?.lines[0]).toContain("分支 feat/x");
    expect(result?.lines.at(-1)).toBe("读数 599");
    expect(result?.lineCount).toBe(601);
  });

  it("身份行里的 `(取不到)` 是占位，不冒充仓库名", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.append("[ship] 分支 feat/x · sha abc1234 · 仓库 (取不到) · 远端 (无)");
    const r = readShipResult(ROOT, resolve).result;
    expect(r?.branch).toBe("feat/x");
    expect(r?.headSha).toBe("abc1234");
    expect(r?.repo).toBeNull();
  });

  it("收尾回收的最终结论覆盖先前那句，回读里不留被推翻的声明", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.append("[ship] 结论：exit 0 —— 全绿到终态");
    sink.append("[ship] 含收尾回收的最终结论：exit 1（上面那行 exit 0 是回收之前的结论）");
    expect(readShipResult(ROOT, resolve).result?.conclusion).toContain("exit 1");
  });
});

describe("唯一出口收口", () => {
  it("finish(0) ⇒ green", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.finish(0);
    expect(readShipResult(ROOT, resolve).result).toMatchObject({ status: "green", exitCode: 0 });
  });

  it("finish(1) ⇒ red", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.finish(1);
    expect(readShipResult(ROOT, resolve).result).toMatchObject({ status: "red", exitCode: 1 });
  });

  it("finish(2) ⇒ not-run（没跑起来不等于通过）", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.finish(2);
    expect(readShipResult(ROOT, resolve).result).toMatchObject({ status: "not-run", exitCode: 2 });
  });

  it("编排抛异常 ⇒ interrupted，且把原因留下来", () => {
    const sink = createShipResultSink({ root: ROOT, resolve });
    sink.fail(new Error("SIGTERM"));
    const result = readShipResult(ROOT, resolve).result;
    expect(result?.status).toBe("interrupted");
    expect(result?.interruptedBy).toBe("SIGTERM");
    expect(result?.exitCode).toBeNull();
  });
});

describe("best-effort 与回读分档", () => {
  it("写盘写不出去 ⇒ 不抛，内存里的结论照旧", () => {
    const sink = createShipResultSink({
      root: ROOT,
      resolve: () => path.join(fakeGitDir, "no", "such", "dir"),
    });
    expect(() => {
      sink.append("[ship] 读数");
    }).not.toThrow();
    expect(() => {
      sink.finish(0);
    }).not.toThrow();
    expect(sink.result.status).toBe("green");
    expect(fs.existsSync(resultFile())).toBe(false);
  });

  it("没有上一次 ⇒ missing（合法读数，不是「没跑过」也不是「通过」）", () => {
    const reading = readShipResult(ROOT, resolve);
    expect(reading).toMatchObject({ found: false, reason: "missing" });
    expect(formatShipResult(reading).join("\n")).toContain("不构成结论");
  });

  it("JSON 坏了 ⇒ unreadable（不是「没有上一次」）", () => {
    fs.writeFileSync(resultFile(), "{ 半截", "utf8");
    const reading = readShipResult(ROOT, resolve);
    expect(reading).toMatchObject({ found: false, reason: "unreadable" });
    expect(formatShipResult(reading).join("\n")).toContain("读不出来");
  });

  it("形状对不上 ⇒ 同样是 unreadable", () => {
    fs.writeFileSync(resultFile(), JSON.stringify({ status: 42 }), "utf8");
    expect(readShipResult(ROOT, resolve).reason).toBe("unreadable");
  });

  it("取不到 git 目录 ⇒ no-git-dir，不往工作区猜路径", () => {
    expect(readShipResult(ROOT, () => null).reason).toBe("no-git-dir");
  });

  it("CLI 回读口跑得起来，且只吐读数", () => {
    const r = spawnSync(process.execPath, ["scripts/ship-result.mjs", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect([0, 2]).toContain(r.status);
    expect(r.stdout).toContain('"found"');
    expect(r.stdout).toContain('"path"');
  });
});
