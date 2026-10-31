/**
 * `base-check` 那条「把本检出的依赖树链进干净快照」的链接，收尾**必须先摘**（ISSUE #1913 收尾翻出来的）。
 *
 * 判的是什么：`linkDependencies` 建的是一条**方向朝外**的链接 ——
 * `<快照>/node_modules` → 本检出的 `node_modules`。而清理那一步原本是
 * `git worktree remove --force <快照>`，实测它在 Windows 上**穿 junction 走进目标**逐个删，
 * 于是「销毁一个临时快照」变成了「销毁调用者正在干活的那棵树」。现场形态：
 * 跑完一次复算后 `node_modules/.bin` 整批不见，下一次 e2e 报
 * `Command "next" not found` + `Timed out waiting 180000ms from config.webServer`，
 * 全量档记成 `exit 1` —— 红的形状与「应用坏了」逐字同形，一个字都不指向复算工具。
 *
 * 两向都钉（与本仓 `tests/git-sandbox-env.test.ts` 同一个口径：只判正向的那一档，
 * 在「机制其实不成立」的世界里同样为绿）：
 *   ① **不摘就删 ⇒ 目标树确实被删穿**（机制成立，不是臆测）。只在 win32 判 ——
 *      POSIX 上 `git` 把符号链接当链接摘掉，没有这一跳；按平台分档判据的先例见
 *      `scripts/.runtime-budget-baseline.json`。
 *   ② **先 `unlinkDependencies` 再删 ⇒ 两边都活着**（修法有效）。
 *
 * ① 用的「被删的那棵树」是本测试自己 `mkdtempSync` 出来的夹具，**绝不是运行它的那份检出**
 * —— 判据可以随便毁夹具，但不许拿调用方的工作树做实验（那正是被测事故本身的形态）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { linkDependencies, unlinkDependencies } from "../scripts/base-check.mjs";
import { gitSandboxEnv } from "./helpers/git-sandbox-env";

/** 本文件造出来的夹具目录；用例失败也一律收尾。 */
const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 起一份「像真实检出」的夹具：一次提交 + 一份**不入库**的 `node_modules/.bin/next`。
 *
 * `node_modules` 必须在提交之后才建 —— 否则它会进了索引，`git worktree add` 就在快照里
 * 直接检出一份真目录，`linkDependencies` 那条「已存在就不链」的短路会生效，
 * 实验就退化成「链都没建」的假绿。
 */
function makeFakeCheckout(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `base-check-snap-${name}-`));
  dirs.push(dir);
  const git = (args: Array<string>) => {
    const r = spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  };
  git(["init", "-q", "-b", "main", "."]);
  git(["config", "user.email", "t@t.t"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "tracked.txt"), "base\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "next"), "shim\n");
  return dir;
}

/** 给夹具建一个分离头快照（等价于 `base-check` 里那一次 `git worktree add --detach`）。 */
function addWorktree(
  checkout: string,
  name: string,
): { git: (args: Array<string>) => void; path: string; } {
  const wt = mkdtempSync(join(tmpdir(), `base-check-snap-${name}-wt-`));
  dirs.push(wt);
  const run = (args: Array<string>) => {
    const r = spawnSync("git", args, {
      cwd: checkout,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  };
  // `mkdtempSync` 出来的目录非空都不算问题：`git worktree add` 要求目标不存在或为空，
  // 空目录正好满足，所以这里不预先删掉它（删了路径就没了，`dirs` 收尾也管不到）。
  run(["worktree", "add", "--detach", wt, "HEAD"]);
  return { path: wt, git: run };
}

const shimOf = (root: string) => join(root, "node_modules", ".bin", "next");

describe("复算快照的依赖链接：谁在链上、收尾谁先走", () => {
  it("①不摘链接就 `git worktree remove --force` ⇒ 链出去的那半边被删穿（win32 机制在案）", () => {
    // POSIX 上 `git` 把符号链接当**链接**摘掉，不走进目标；这一跳只在 Windows 上存在。
    // 跳过时不冒充结论：判据自己说清「这条在本平台不判」。
    const checkout = makeFakeCheckout("traverse");
    const { path: wt, git } = addWorktree(checkout, "traverse");
    const link = linkDependencies(checkout, wt);
    expect(link, "链接没建出来 ⇒ 这一向判了个空").not.toBeNull();
    expect(existsSync(shimOf(checkout)), "夹具的依赖树先没了？").toBe(true);

    git(["worktree", "remove", "--force", wt]);

    if (process.platform === "win32") {
      /**
       * 这里断言的是**伤害确实发生**：目标树上的 `next` 垫片没了。
       * 若哪天 git 修成「穿链接不删」，这条会红 —— 那是好消息（危害消失，届时把
       * `unlinkDependencies` 降级成防御性冗余并订正碎片），不许反过来把它 skip 掉。
       */
      expect(
        existsSync(shimOf(checkout)),
        "win32 上 `git worktree remove --force` 不再穿 junction —— 危害假设变了，" +
          "请回来订正 base-check 的这段注释与碎片，别直接 skip",
      ).toBe(false);
    } else {
      expect(existsSync(shimOf(checkout))).toBe(true);
    }
  }, 30_000);

  it("②先 `unlinkDependencies` 再摘 worktree ⇒ 两边都活着（这就是修法的顺序）", () => {
    const checkout = makeFakeCheckout("safe");
    const { path: wt, git } = addWorktree(checkout, "safe");
    const link = linkDependencies(checkout, wt);
    expect(link, "链接没建出来 ⇒ 这一向判了个空").not.toBeNull();

    unlinkDependencies(link);
    /* 这两条断言都排在 `git worktree remove` **之前** —— 摘完链接的那一刻才是
     * 「只摘那一个点、不碰目标」的可判窗口；等快照整份被删掉之后再判就没意义了。 */
    expect(existsSync(link!), "reparse point 没摘掉").toBe(false);
    expect(existsSync(shimOf(checkout)), "摘链接时删到了目标").toBe(true);

    git(["worktree", "remove", "--force", wt]);

    expect(existsSync(shimOf(checkout)), "收尾把本检出的依赖树删穿了").toBe(true);
    expect(readFileSync(shimOf(checkout), "utf8")).toBe("shim\n");
    expect(existsSync(join(checkout, "tracked.txt")), "根上的受版本控制文件也没了").toBe(true);
  }, 30_000);

  it("③`unlinkDependencies(null)` 不许抛（没链成时收尾仍要走下去）", () => {
    expect(() => unlinkDependencies(null)).not.toThrow();
  });

  it("④生产路径里的顺序钉住：先摘链接，再 `git worktree remove`", () => {
    /* 上面两向判的是机制，这一条判的是**编排**：`finally` 里若有人把
     * `git worktree remove` 挪回 `unlinkDependencies` 之前，机制那条会红，
     * 但红在「谁先跑」这种读起来像实现细节的地方 —— 这一条把顺序本身说出口。 */
    const src = readFileSync("scripts/base-check.mjs", "utf8");
    const unlinkAt = src.indexOf("unlinkDependencies(dependencyLink)");
    const removeAt = src.indexOf('git(["worktree", "remove", "--force"');
    expect(unlinkAt, "finally 里不再调用 unlinkDependencies —— 链接会被穿删").toBeGreaterThan(-1);
    expect(removeAt).toBeGreaterThan(-1);
    expect(unlinkAt < removeAt, "顺序反了：先摘 worktree 就会穿 junction 删进本检出").toBe(true);
    expect(src).toContain("dependencyLink = linkDependencies(ROOT, worktreePath)");
  });
});
