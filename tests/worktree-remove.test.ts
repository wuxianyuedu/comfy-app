/**
 * `scripts/worktree-remove.mjs` —— 收掉 linked worktree 时**先摘 `node_modules` 链接、
 * 确认链接本体没了，再让 git 注销登记**（ISSUE #2997）。
 *
 * 判的是什么：临时 worktree 的 `node_modules` 可以是 junction，也可以是 symlink
 * （MSYS `ln -s`）。同一条外部命令（`cmd /c rmdir`）对两者的结果不同 —— junction 摘得掉，
 * MSYS symlink 退 145 且链接仍在；收尾脚本常把退出码丢掉。留下的链接随后被
 * `git worktree remove --force` 顺着走进主检出，把依赖树删空。本入口用 Node 原语
 * 走同一条路径，两形结果必须一致。
 *
 * 每一条都在 `mkdtempSync` 的夹具里做（自带 repo + worktree），**不拿运行它的那份
 * 检出做实验**；主树的 `node_modules/.bin/next` 是哨兵，收尾后必须逐字还在。
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";

const SCRIPT = resolve("scripts/worktree-remove.mjs");

/** 本文件造出来的夹具目录；用例失败也一律收尾。 */
const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gitIn(cwd: string, args: Array<string>) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: gitSandboxEnv() });
}

/**
 * 起一份「像真实检出」的夹具：一次提交 + 一份**不入库**的 `node_modules/.bin/next`。
 * `node_modules` 必须在提交之后才建，否则它会进索引、worktree 里检出成真目录。
 */
function makeFakeCheckout(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `worktree-remove-${name}-`));
  dirs.push(dir);
  const ok = (args: Array<string>) => {
    const r = gitIn(dir, args);
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  };
  ok(["init", "-q", "-b", "main", "."]);
  ok(["config", "user.email", "t@t.t"]);
  ok(["config", "user.name", "t"]);
  ok(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "tracked.txt"), "base\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  ok(["add", "-A"]);
  ok(["commit", "-qm", "base"]);
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "next"), "shim\n");
  return dir;
}

function addWorktree(checkout: string, name: string): string {
  const wt = mkdtempSync(join(tmpdir(), `worktree-remove-${name}-wt-`));
  dirs.push(wt);
  const r = gitIn(checkout, ["worktree", "add", "--detach", wt, "HEAD"]);
  expect(r.status, `git worktree add: ${r.stderr}`).toBe(0);
  return wt;
}

const shimOf = (root: string) => join(root, "node_modules", ".bin", "next");

/** 本机能不能造 `dir` 形态的 symlink（Windows 要开发者模式）；造不出就如实跳过那一向。 */
function canMakeDirSymlink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "worktree-remove-probe-"));
  try {
    mkdirSync(join(dir, "target"));
    symlinkSync(join(dir, "target"), join(dir, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DIR_SYMLINK_OK = canMakeDirSymlink();

function runRemove(checkout: string, wt: string) {
  return spawnSync(process.execPath, [SCRIPT, wt], {
    cwd: checkout,
    encoding: "utf8",
    env: gitSandboxEnv(),
  });
}

function registeredWorktree(checkout: string, wt: string): boolean {
  const r = gitIn(checkout, ["worktree", "list", "--porcelain"]);
  expect(r.status, `git worktree list: ${r.stderr}`).toBe(0);
  return r.stdout.split("\n").some((line) => line === `worktree ${wt}`);
}

/** 两形共用一套断言：worktree 收干净、登记没了、主树的哨兵逐字还在。 */
function expectCleanRemoval(checkout: string, wt: string, out: string, code: number | null) {
  expect(code, out).toBe(0);
  expect(out).toContain("摘链接（只摘链接本体）");
  expect(existsSync(shimOf(checkout)), "顺着链接删空了主检出的依赖").toBe(true);
  expect(readFileSync(shimOf(checkout), "utf8")).toBe("shim\n");
  expect(existsSync(wt), "worktree 目录没收干净").toBe(false);
  expect(registeredWorktree(checkout, wt), "`.git/worktrees` 里的登记还在").toBe(false);
}

describe("worktree:remove —— 先摘链接、再注销登记（ISSUE #2997）", () => {
  it("①junction：只摘链接本体，随后 worktree 收干净，主树依赖仍在", () => {
    const checkout = makeFakeCheckout("junction");
    const wt = addWorktree(checkout, "junction");
    symlinkSync(join(checkout, "node_modules"), join(wt, "node_modules"), "junction");

    const r = runRemove(checkout, wt);
    expectCleanRemoval(checkout, wt, r.stdout, r.status);
  }, 30_000);

  it.skipIf(!DIR_SYMLINK_OK)(
    "②dir symlink：与 junction 同一条结果（MSYS `ln -s` 那一形）",
    () => {
      const checkout = makeFakeCheckout("symlink");
      const wt = addWorktree(checkout, "symlink");
      symlinkSync(join(checkout, "node_modules"), join(wt, "node_modules"), "dir");

      const r = runRemove(checkout, wt);
      expectCleanRemoval(checkout, wt, r.stdout, r.status);
    },
    30_000,
  );

  it("③worktree 里是装着依赖的真目录：不摘、随 worktree 一起收，主树不受影响", () => {
    const checkout = makeFakeCheckout("real");
    const wt = addWorktree(checkout, "real");
    mkdirSync(join(wt, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(wt, "node_modules", ".bin", "next"), "own\n");

    const r = runRemove(checkout, wt);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain("是真目录，不是链接");
    expect(readFileSync(shimOf(checkout), "utf8")).toBe("shim\n");
    expect(existsSync(wt)).toBe(false);
    expect(registeredWorktree(checkout, wt)).toBe(false);
  }, 30_000);

  it("④目标不在 `git worktree list` 里 ⇒ 退 2，一个目录都不删", () => {
    const checkout = makeFakeCheckout("unregistered");
    const stranger = mkdtempSync(join(tmpdir(), "worktree-remove-stranger-"));
    dirs.push(stranger);

    const r = runRemove(checkout, stranger);
    expect(r.status, "这不是「事实为红」（1），是前置不成立（2）").toBe(2);
    expect(r.stderr).toContain("不在 `git worktree list` 里");
    expect(existsSync(stranger), "前置不成立时仍然删了目录").toBe(true);
  }, 30_000);
});
