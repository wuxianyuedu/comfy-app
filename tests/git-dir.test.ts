/**
 * `scripts/git-dir.mjs` 的判据。
 *
 * ## 这一族判的是「写错地方」，不是「写不进去」
 *
 * 「本检出的 `.git` 在哪」看起来是个 trivial 问题，而它有两种失效形态，**两种都不报错**：
 *
 *   · 硬拼 `<root>/.git` 在 **worktree** 上拿到的是那个**指针文件**的路径 ——
 *     往里写东西会当场失败或写到一个不该在的地方；
 *   · 设了 `GIT_DIR` 时，真正的 git 目录与仓库根可以毫无关系。
 *
 * 本仓**恰好靠 worktree 跑事后复算**（`base-check.mjs` 建临时快照检出），
 * 而 `.git/comfy-precommit-timing.jsonl` 与 `.git/comfy-premerge-proof.json`
 * 两户都落在那个目录里。写错的那一侧不会喊 —— 读的那一侧只是「永远读不到」，
 * 于是「这次没留下证据」看起来就像「这次没有证据要留」。
 *
 * ## 为什么这里建真 repo / 真 worktree 而不是造假形状
 *
 * 造一个「`.git` 是文件、内容写着 `gitdir: …`」的假目录，测的是**我自己猜的那份格式**；
 * 真跑一次 `git worktree add` 测的才是 git 实际会给什么。前者会在 git 换格式时
 * 继续绿（那正是本模块要避免的那类失效）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gitScratchPath, resolveGitDir } from "../scripts/git-dir.mjs";

/** 跑一次 git（静默，失败时把 stderr 带进断言消息）。 */
function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} 失败：${r.stderr || r.status}`);
  }
  return String(r.stdout ?? "").trim();
}

/** 取 git 目录并断言取到了 —— 免得下面每处都写一遍 `String(...)` 把 null 混进去。 */
function mustGitDir(cwd: string): string {
  const d = resolveGitDir(cwd);
  expect(d, `resolveGitDir 在 ${cwd} 上回了 null`).toBeTruthy();
  return String(d);
}

/**
 * 比较前先归一分隔符 —— 这不是和稀泥，是这组判据真正要说的东西：
 * git 回的是**它自己的正斜杠形式**（`C:/Users/…/repo/.git`），而 Windows 上
 * `path.join` 给反斜杠。同一个路径两种拼法：拿去拼落点没问题（Win32 两种都收），
 * 但**做字符串比较就会错** —— 反向断言（`not.toContain`）在两种拼法下**恒真**，
 * 于是「落错了地方」也测不出来。这条差异在本模块搬过来之前就存在于
 * `precommit-timing` 那份实现里，只是没人把它测出来过。
 */
function norm(p: string | null): string {
  return String(p ?? "").replace(/\\/g, "/");
}

let repo = "";
let worktree = "";
let bare = "";

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "git-dir-"));
  repo = path.join(base, "repo");
  worktree = path.join(base, "wt");
  bare = path.join(base, "nogit");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(bare, { recursive: true });
  git(["init", "-q", "--initial-branch=main"], repo);
  git(["config", "user.email", "t@example.com"], repo);
  git(["config", "user.name", "t"], repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(["add", "a.txt"], repo);
  git(["commit", "-q", "-m", "init"], repo);
  // 真 worktree：`<wt>/.git` 是一个写着 `gitdir: …` 的**文件**。
  git(["worktree", "add", "-q", "-b", "wt-branch", worktree], repo);
});

afterAll(() => {
  if (repo && fs.existsSync(path.dirname(repo))) {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

describe("resolveGitDir：三种检出形态", () => {
  it("普通检出 ⇒ 仓库根下的 .git", () => {
    expect(norm(resolveGitDir(repo))).toBe(norm(path.join(repo, ".git")));
  });

  it("worktree ⇒ 主仓 `.git/worktrees/<名>`，**不是** `<wt>/.git`", () => {
    const got = resolveGitDir(worktree);
    expect(got).toBeTruthy();
    /* 这一条是整个模块的存在理由：硬拼 `path.join(wtRoot, ".git")` 拿到的是
     * 那个指针文件，而它不是目录。断言「在主仓的 .git/worktrees 下面」而不是
     * 等值比较某个具体路径 —— 后者会随 git 的命名规则漂。 */
    expect(String(got).replace(/\\/g, "/")).toContain(".git/worktrees/");
    expect(fs.statSync(String(got)).isDirectory()).toBe(true);
    expect(got).not.toBe(path.join(worktree, ".git"));
  });

  it("非检出 ⇒ null（不猜一个路径出去）", () => {
    expect(resolveGitDir(bare)).toBeNull();
  });

  it("前置自证：那个 worktree 的 `.git` 确实是个文件 —— 否则上面两条白测", () => {
    // 假若 git 哪天把 `.git` 改回目录，本模块的必要性要重判，而不是让判据静默空转。
    const pointer = path.join(worktree, ".git");
    expect(fs.existsSync(pointer), `worktree 没建起来：${pointer}`).toBe(true);
    expect(fs.statSync(pointer).isFile()).toBe(true);
    expect(fs.readFileSync(pointer, "utf8")).toMatch(/^gitdir:\s*\S+/m);
  });
});

describe("gitScratchPath：机器本地状态的落点", () => {
  it("在检出里 ⇒ 落在 git 目录内", () => {
    const p = gitScratchPath(repo, "comfy-x");
    expect(p).toBe(path.join(mustGitDir(repo), "comfy-x"));
  });

  it("worktree 上 ⇒ 落在**那份 worktree 自己的** git 目录（各检出各一份，不互相作证）", () => {
    const p = gitScratchPath(worktree, "comfy-x");
    expect(p).toBe(path.join(mustGitDir(worktree), "comfy-x"));
    /* 这条反向断言必须先归一分隔符，否则它是恒真的：`p` 里是 git 给的正斜杠，
     * 而 `path.join` 在 Windows 给反斜杠 —— 两种拼法永远「不包含」，
     * 于是即便真的落到了主仓的 .git 也照样绿。 */
    expect(String(p).replace(/\\/g, "/")).not.toContain(
      `${norm(resolveGitDir(repo))}/comfy-x`,
    );
  });

  it("非检出 ⇒ null，调用方据此跳过而不是写出去", () => {
    expect(gitScratchPath(bare, "comfy-x")).toBeNull();
  });

  it("解析器可注入（ship 的测试靠这一格把落点指到临时目录）", () => {
    const p = gitScratchPath("whatever", "comfy-y", () => "/injected/.git");
    expect(p).toBe(path.join("/injected/.git", "comfy-y"));
  });
});
