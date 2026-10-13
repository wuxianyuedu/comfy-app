/**
 * 测试夹具的 git 环境隔离（`tests/helpers/git-sandbox-env.ts`）的契约测试。
 *
 * 判的是什么：在临时目录里 `git add` 时，如果带着从钩子继承来的 `GIT_DIR`，
 * 这条命令作用的对象**不是**临时仓库，而是**调用方的真仓库** —— 探针文件进真索引，
 * 下一次提交报 `Error building trees`，而报错一个字都不指向那条测试。
 * 全仓实测 20 份用例文件自己 `git init` 临时仓库，所以这是一个类别，不是一个点。
 *
 * 为什么这里要**主动造污染**来判（而不是只判「清理后没事」）：
 * 只判正向的那一档，在「污染其实不会发生」的世界里同样为绿 —— 那是一条看起来在判、
 * 实际判不出的用例（本仓库对这类坑的口径见 §13.5.8 / §11.16）。所以两向都要钉：
 *   ① 带 `GIT_DIR` ⇒ 真仓库索引**确实**被写进探针条目（机制成立，不是臆测）；
 *   ② 带 `gitSandboxEnv()` ⇒ 真仓库索引**一个条目都没多**（清理有效）。
 *
 * ① 用的是本测试**自己 mkdtemp 出来的一份仓库**，不是运行它的那个仓库 ——
 * 判据可以随便污染夹具，但绝不许碰调用方的检出（这正是被测事故本身的形态）。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GIT_INHERITED_ENV_KEYS,
  gitSandboxEnv,
} from "./helpers/git-sandbox-env";

/** 本文件造出来的夹具仓库；收尾全删，用例中途失败也不把临时目录留在 `tmpdir`。 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** 起一个夹具仓库：一次提交、干净工作区，返回根目录。 */
function makeRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `git-sandbox-${name}-`));
  dirs.push(dir);
  const git = (args: string[]) => {
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
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  return dir;
}

/** 在 `scratch` 放一个探针文件并按给定环境 `git add -A`；返回 git 的输出（给断言消息用）。 */
function addProbeWithEnv(scratch: string, env: NodeJS.ProcessEnv): string {
  writeFileSync(join(scratch, "probe.txt"), "probe\n");
  const r = spawnSync("git", ["add", "-A"], {
    cwd: scratch,
    env,
    encoding: "utf8",
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

/** 读那份仓库**索引**里的路径（按 `--git-dir` 指名，不依赖环境）。 */
function indexPaths(repoDir: string): string[] {
  const r = spawnSync(
    "git",
    ["--git-dir", join(repoDir, ".git"), "ls-files", "--stage"],
    { encoding: "utf8", env: gitSandboxEnv() },
  );
  expect(r.status, `读索引失败: ${r.stderr}`).toBe(0);
  return (r.stdout ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (line.split("\t")[1] ?? "").trim());
}

describe("临时仓库夹具的 git 环境隔离", () => {
  it("① 带着 `GIT_DIR` 时，临时目录的 `git add` 写进的是**那份仓库**的索引", () => {
    const victim = makeRepo("victim");
    const scratch = makeRepo("scratch");
    expect(indexPaths(victim)).toEqual(["tracked.txt"]);

    /* 这就是钩子里的真实形态：`GIT_DIR` 指向调用方的仓库，cwd 在别处。 */
    const output = addProbeWithEnv(scratch, {
      ...process.env,
      GIT_DIR: join(victim, ".git"),
    });

    expect(
      indexPaths(victim),
      `污染没发生 ⇒ 本文件的机制前提变了，② 那一档也随之失去意义（git 输出：${output}）`,
    ).toContain("probe.txt");
  });

  it("② 换成 `gitSandboxEnv()` 后，同一句 `git add` 落在自己的仓库里", () => {
    const victim = makeRepo("victim2");
    const scratch = makeRepo("scratch2");

    const poisoned = {
      ...process.env,
      GIT_DIR: join(victim, ".git"),
      GIT_WORK_TREE: victim,
    };
    /* 清理**之前**那份环境里确实带着 `GIT_DIR`（否则这一档只是在判空气）。 */
    expect(poisoned.GIT_DIR).toBeTruthy();

    addProbeWithEnv(scratch, gitSandboxEnv(poisoned));

    expect(indexPaths(victim), "清理无效：目标仓库索引被写进了探针").toEqual([
      "tracked.txt",
    ]);
    /* 探针进的是**自己**的索引 —— 清理没有把命令变成空操作，只是换了归属。 */
    expect(indexPaths(scratch)).toContain("probe.txt");
  });

  it("清单含 `git commit` 导出给钩子的全部仓库定位变量", () => {
    /* `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` 是事故三件套；
     * 其余四个同族（`git` 在 worktree / 共享对象库场景下导出的）。 */
    for (const key of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_COMMON_DIR",
    ]) {
      expect(GIT_INHERITED_ENV_KEYS, `清单里没有 ${key}`).toContain(key);
    }
  });

  it("全局那一档挂在 `tests/setup.ts` 上（否则 20 份自起仓库的用例各扫各的）", () => {
    /* `vitest.config.ts` 的 `setupFiles` 指向它，且两档 project 都继承（文件里已注明）。
     * 这里判的是**接线**：那一档一旦被删，本文件 ② 的清理仍绿、而 20 份用例全部回到
     * 污染状态 —— 单靠行为用例看不见这件事。 */
    const setup = readFileSync("tests/setup.ts", "utf8");
    expect(setup, "tests/setup.ts 里没有那次全局剥离").toContain(
      "stripInheritedGitEnv();",
    );
  });
});
