/**
 * 平台侧「重档静态判据」那一格（`scripts/ci-heavy-gates.mjs`）。
 *
 * 这一格治的是 ISSUE #2224 的现场：**判决面只在「本次改动」上的那一步，在平台侧
 * 恒绿且一个字都不打** —— 平台上没有暂存区，`shell-gate` 读的是那份空清单 ⇒
 * `touchesShell` 恒假 ⇒ 硬规则 5 那两条（改了壳必须重编 / 壳内那批 `#[test]`）
 * 在平台侧**一个执行者都没有**，而账面全绿。
 *
 * 这里钉的是三件事：
 *   ① 带 `--staged` 的步骤**照旧剥掉**（判全量档，判决面还在）；
 *   ② 判决面只在「本次改动」上的那一步 ⇒ **换成基线**（`--base`），真判，不再恒绿；
 *   ③ 换不了（拿不到基线）⇒ 这一条**「没判」**，单列退 2，**不许计入「绿」**。
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { heavyGateArgv, main } from "../scripts/ci-heavy-gates.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 一个「有钩子、但不是 git 检出」的目录：钩子在，取基线取不到。 */
function dirWithHook(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "heavy-gates-hook-"));
  temps.push(dir);
  mkdirSync(path.join(dir, ".githooks"), { recursive: true });
  copyFileSync(HOOK, path.join(dir, ".githooks", "pre-commit"));
  return dir;
}

describe("复合档 —— 判决面只在「本次改动」上的那一步（ISSUE #2224）", () => {
  it("带 `--staged` 的步骤照旧剥掉：判全量档，判决面还在", () => {
    const got = heavyGateArgv([
      "node",
      "scripts/check-dead-exports.cjs",
      "--staged",
    ]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.argv).toEqual(["node", "scripts/check-dead-exports.cjs"]);
    expect(got.notRunCodes).toEqual([]);
  });

  it("拿得到基线 ⇒ 换成 `--base` 形态（真判，不再恒绿无声）", () => {
    const got = heavyGateArgv(["node", "scripts/shell-gate.mjs"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.argv).toEqual([
      "node",
      "scripts/shell-gate.mjs",
      "--base",
      "abc123",
    ]);
    /* 这一族把「没跑起来」报成 2（仓库三态），这一档必须认它 —— 不然「拿不到
     * 基线」会被读成「判红」。 */
    expect(got.notRunCodes).toContain(2);
  });

  it("拿不到基线 ⇒ 这一条「没判」（不许计入绿）", () => {
    const got = heavyGateArgv(["node", "scripts/shell-gate.mjs"], {
      cwd: dirWithHook(),
      env: {},
    });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toContain("取不到");
  });

  it("有「没判」的那一条 ⇒ 退 2，且逐条点名（不许默默算绿）", () => {
    const lines: string[] = [];
    const code = main({
      cwd: dirWithHook(),
      argv: ["--only=桌面壳"],
      env: {},
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(2);
    const all = lines.join("\n");
    expect(all).toContain("没判");
    expect(all).toContain("桌面壳");
  });

  it("那一步自己报「没跑起来」（退 2）⇒ 这一格退 2，不读成「判红」", () => {
    const lines: string[] = [];
    const code = main({
      cwd: ROOT,
      argv: ["--only=桌面壳"],
      /* 这条 sha 不在对象库里 ⇒ `shell-gate --base` 取不到改动面 ⇒ 退 2。 */
      env: { CNB_PULL_REQUEST_TARGET_SHA: "no-such-sha-xyz" },
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("没跑起来");
  });
});
