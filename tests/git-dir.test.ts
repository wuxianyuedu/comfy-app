/**
 * `scripts/git-dir.mjs` 的判据：判的是「写错地方」，不是「写不进去」。硬拼 `<root>/.git` 在 **worktree** 上拿到的是那个**指针文件**的路径（往里写东西会当场失败或写到不该在的地方）；设了 `GIT_DIR` 时，真正的 git 目录与仓库根可以毫无关系；两种都**不报错**。本仓恰好靠 worktree 跑事后复算（`base-check.mjs` 建临时快照检出），而 `.git/comfy-precommit-timing.jsonl` 与 `.git/comfy-premerge-proof.json` 都落在那个目录里——写错的那侧不会喊，读的那侧只是「永远读不到」，「这次没留下证据」看起来就像「这次没有证据要留」。
 * 所以建真 repo / 真 worktree 而不是造假形状：造一个「`.git` 是文件、内容写着 `gitdir: …`」的假目录，测的是**我自己猜的那份格式**，会在 git 换格式时继续绿（那正是本模块要避免的失效）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gitScratchPath, resolveGitDir } from "../scripts/git-dir.mjs";

/** 跑一次 git（静默，失败时把 stderr 带进断言消息）。 */
function git(args: Array<string>, cwd: string): string {
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
 * 比较前先归一分隔符不是和稀泥：git 回的是**它自己的正斜杠形式**（`C:/Users/…/repo/.git`），Windows 上 `path.join` 给反斜杠；拼落点没问题（Win32 两种都收），但做字符串比较就会错——反向断言（`not.toContain`）在两种拼法下**恒真**，「落错了地方」也测不出来（该差异早存在于 `precommit-timing` 实现里）。
 * ⚠️ **win32 上还要连大小写一起归一**（ISSUE #2087）：左值来自 git、右值来自 `os.tmpdir()`，Runner 常以 LocalSystem 跑，`%TEMP%` 是全大写 `C:\WINDOWS\TEMP`，而文件系统给 `C:/Windows/Temp` ⇒ 这一格在**开发身份恒绿、节点身份恒红**，且报 `AssertionError` 看着完全像回归；Windows 路径大小写不敏感，拼法从来不是被测对象。
 * **posix 那一侧不许跟着做**：那里大小写有意义，归一会把「取到了另一个目录」判成正确（与 `scripts/.runtime-budget-baseline.json` 的 `byPlatform` 同一条口径 —— 判据要在它跑得到的宿主上自证）。
 */
function norm(p: string | null): string {
  const slashed = String(p ?? "").replaceAll("\\", "/");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
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
    expect(norm(got)).toContain(".git/worktrees/");
    expect(fs.statSync(String(got)).isDirectory()).toBe(true);
    /* 归一之后再比 —— 不归一时两侧永不相等（分隔符 + 大小写两种拼法），
     * 那这句就是恒真的装饰：实现真的退化成硬拼 `<wt>/.git` 时它照样绿。
     * 上面那句 `toContain` 已经在判这件事，留着它是为了把「不是指针文件那条路径」
     * 说成一句能失败的断言，而不是一句永远成立的话。 */
    expect(norm(got)).not.toBe(norm(path.join(worktree, ".git")));
  });

  it("非检出 ⇒ null（不猜一个路径出去）", () => {
    expect(resolveGitDir(bare)).toBeNull();
  });

  /**
   * 归一函数自己的判据（ISSUE #2087 的回归位）。上面那组断言只用到 `norm()`，而**它坏掉的形态是恒绿**：开发身份下两种拼法本来就一致，
   * 只有节点身份能照出「大小写被当成事实」——那正是它一路活到每日档的原因。所以这里直接喂两种拼法给它，并且**按平台各判一次**：
   * posix 那一支断言「不许顺手把大小写归一掉」，否则取错目录会被判成正确。
   */
  it("norm() 按平台归一：win32 连大小写一起，posix 只动分隔符", () => {
    const slashed = "C:/Windows/Temp/git-dir-x/repo/.git";
    const upper = "C:/WINDOWS/TEMP/git-dir-x/repo/.git";
    const backslashed = String.raw`C:\Windows\Temp\git-dir-x\repo\.git`;
    expect(norm(backslashed)).toBe(norm(slashed));
    if (process.platform === "win32") {
      expect(norm(upper)).toBe(norm(slashed));
    } else {
      expect(norm(upper)).not.toBe(norm(slashed));
    }
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
    /* 这条反向断言必须先归一再比，否则它是恒真的：`p` 里是 git 给的正斜杠，
     * 而 `path.join` 在 Windows 给反斜杠 —— 两种拼法永远「不包含」，
     * 于是即便真的落到了主仓的 .git 也照样绿。
     * ⚠️ **两侧都要过同一个 `norm()`**：左边漏归一（或只归一分隔符、右边连大小写一起归）
     * 会让这句在 win32 上「永远不包含」，正是它要防的那种恒真形态（同 ISSUE #2087 那一族）。 */
    expect(norm(p)).not.toContain(`${norm(resolveGitDir(repo))}/comfy-x`);
  });

  it("非检出 ⇒ null，调用方据此跳过而不是写出去", () => {
    expect(gitScratchPath(bare, "comfy-x")).toBeNull();
  });

  it("解析器可注入（ship 的测试靠这一格把落点指到临时目录）", () => {
    const p = gitScratchPath("whatever", "comfy-y", () => "/injected/.git");
    expect(p).toBe(path.join("/injected/.git", "comfy-y"));
  });
});
