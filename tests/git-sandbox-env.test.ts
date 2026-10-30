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
 *
 * 第四档（④，ISSUE #2787）：平台那一跑的改动面变量（`CNB_PULL_REQUEST_TARGET_SHA` 一族）
 * 同样进不来。判的是同一件事——「只对当前那一跑成立的读数」不许被子进程继承——只是
 * 这一族不是 git 导出的，第一类清单收不到，而它会一路走进用例 spawn 的判据脚本，
 * 让沙箱拿**真仓库的 sha** 去算自己的改动面（现场见 `git-sandbox-env.ts` 文件头第三类）。
 *
 * 第三档（③）：宿主开着 `core.autocrlf=true` 时，夹具的 `git add` **一条 advice 都不打**。
 * 那一行 `LF will be replaced by CRLF` 不改变任何结论，却是 CI 里最像「真红」的噪音；
 * 反向锚点同样是「先证明宿主那一档确实会叫」——不先造一次带噪的 `git add`，
 * ③ 在「宿主本来就没开 autocrlf」的世界里也照样为绿，那就等于没判。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GIT_INHERITED_ENV_KEYS,
  PLATFORM_RUN_ENV_KEYS,
  gitSandboxEnv,
  stripInheritedGitEnv,
  withNoPlatformBaseline,
} from "./helpers/git-sandbox-env";

/** 本文件造出来的夹具仓库；收尾全删，用例中途失败也不把临时目录留在 `tmpdir`。 */
const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 起一个夹具仓库：一次提交、干净工作区，返回根目录。 */
function makeRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `git-sandbox-${name}-`));
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
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  return dir;
}

/**
 * 「没有夹具注入」的那份环境：只剥掉继承的仓库定位变量，**一个 `GIT_CONFIG_*` 都不加**。
 *
 * ③ 的反向锚点要用它 —— 先证明宿主的 `autocrlf=true` 确实会让 `git add` 叫一声，
 * 再证明夹具注入之后一声都不叫。少了这份，那条断言在「宿主本来就没开 autocrlf」
 * 的世界里同样为绿，等于没判（§13.5.8）。
 * @returns 可直接交给子进程的 `env`
 */
function bareEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of GIT_INHERITED_ENV_KEYS) {
    delete env[key];
  }
  return env;
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
function indexPaths(repoDir: string): Array<string> {
  const r = spawnSync("git", ["--git-dir", join(repoDir, ".git"), "ls-files", "--stage"], {
    encoding: "utf8",
    env: gitSandboxEnv(),
  });
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

    /* 这就是钩子里的真实形态：`GIT_DIR` 指向调用方的仓库，cwd 在别处。
     * 它走**继承**那条路（`process.env` 那一档），不是 `gitSandboxEnv(extra)` ——
     * 后者是「调用方显式要的」，剥完之后照传（口径见 `gitSandboxEnv()` 那段与 #2799）。 */
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

    /* 走「继承」那条路：把它放进 `process.env` 再让 `gitSandboxEnv()` 去剥 ——
     * 这正是钩子里发生的事，也正是这一档要判的。 */
    const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = poisoned.GIT_DIR;
    process.env.GIT_WORK_TREE = poisoned.GIT_WORK_TREE;
    try {
      addProbeWithEnv(scratch, gitSandboxEnv());
    } finally {
      if (saved.dir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = saved.dir;
      }
      if (saved.tree === undefined) {
        delete process.env.GIT_WORK_TREE;
      } else {
        process.env.GIT_WORK_TREE = saved.tree;
      }
    }

    expect(indexPaths(victim), "清理无效：目标仓库索引被写进了探针").toEqual(["tracked.txt"]);
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

  it("③ 宿主开了 `autocrlf=true` 时，夹具的 `git add` 一条 advice 都不打", () => {
    const dir = makeRepo("autocrlf");
    /* 先把**宿主**那一档配成会叫的形态（写在这份临时仓库自己的 config 里 —— 它就是
     * 模拟「宿主全局 .gitconfig 带着它」，而夹具注入的那一层要压得住同一份配置的这层）。 */
    const cfg = spawnSync("git", ["config", "core.autocrlf", "true"], {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
    expect(cfg.status, `配 autocrlf 失败: ${cfg.stderr}`).toBe(0);

    /* 反向锚点：不带夹具注入时，同一句 `git add` **确实**会打那条 warning。
     * 少了这一半，本条在「宿主本来就没开 autocrlf」的世界里同样为绿。 */
    writeFileSync(join(dir, "probe.txt"), "probe\n");
    const raw = spawnSync("git", ["add", "-A"], {
      cwd: dir,
      encoding: "utf8",
      /* 只剥继承变量，**不**注入沙箱配置 —— 这是「没修之前」的形态。 */
      env: bareEnv(),
    });
    const rawOut = `${raw.stdout ?? ""}${raw.stderr ?? ""}`;
    expect(
      rawOut,
      "宿主 autocrlf=true 却一条 warning 都没打 ⇒ 反向锚点失效，本条判不出东西",
    ).toContain("LF will be replaced by CRLF");

    /* 正面那一档：带上夹具注入，同一条路径一个字节的 advice 都不许留。 */
    writeFileSync(join(dir, "probe2.txt"), "probe2\n");
    const sandboxed = spawnSync("git", ["add", "-A"], {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
    expect(sandboxed.status, `git add 失败: ${sandboxed.stderr}`).toBe(0);
    expect(
      `${sandboxed.stdout ?? ""}${sandboxed.stderr ?? ""}`,
      "夹具的 git add 又打起换行 advice 了（CI 日志会被几十条这样的噪音盖满）",
    ).not.toContain("LF will be replaced by CRLF");
    /* 也**不**许换个方向叫（`CRLF will be replaced by LF`）—— 那一档说明
     * `core.autocrlf=false` 没压住宿主的相反设置。 */
    expect(`${sandboxed.stdout ?? ""}${sandboxed.stderr ?? ""}`).not.toContain(
      "will be replaced by",
    );
  });

  it("④ 平台那一跑的改动面变量进不了沙箱（两个出口都要剥）", () => {
    /* 三个键都是「指向某一个具体提交」的读数：`resolveBaseRef()` 优先认第一个，
     * 另外两个进 `reconcileSyntheticMergeFace()` 的合成提交对账。 */
    for (const key of ["CNB_PULL_REQUEST_TARGET_SHA", "CNB_PULL_REQUEST_MERGE_SHA", "CNB_COMMIT"]) {
      expect(PLATFORM_RUN_ENV_KEYS, `清单里没有 ${key}`).toContain(key);
    }
    const poisoned: Record<string, string> = {
      CNB_PULL_REQUEST_TARGET_SHA: "deadbeef".repeat(5),
      CNB_PULL_REQUEST_MERGE_SHA: "feedface".repeat(5),
      CNB_COMMIT: "abad1dea".repeat(5),
    };
    /* 判的是**继承**那条路（`process.env` → `gitSandboxEnv()`），所以就地注入再剥。
     * `gitSandboxEnv(extra)` 是另一件事：调用方显式给的要照传（#2799 现场就是它）。 */
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(poisoned)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    let viaSpawn: NodeJS.ProcessEnv;
    try {
      viaSpawn = gitSandboxEnv();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
    for (const key of PLATFORM_RUN_ENV_KEYS) {
      expect(viaSpawn[key], `gitSandboxEnv() 没剥掉继承来的 ${key}`).toBeUndefined();
    }
    /* 反向那一半：显式给的**照传** —— 剥的是继承，不是调用方的意图。
     * 少了这条，`gitSandboxEnv({ CNB_PULL_REQUEST_TARGET_SHA })` 会被静默吞掉，
     * 而「我明明传了」与「它说没有」可以同时成立（#2799 的第二个现场）。 */
    const explicit = gitSandboxEnv(poisoned);
    for (const [key, value] of Object.entries(poisoned)) {
      expect(explicit[key], `显式给的 ${key} 被吞掉了`).toBe(value);
    }
    /* 另一条出口：`tests/setup.ts` 在 worker 启动时改的是 `process.env` 本身。
     * 两个出口剥的必须是**同一张清单** —— 只改一处时，另一处会静默漏掉新增的键。 */
    const marker = "[sandbox-env-probe]";
    expect(poisoned.CNB_COMMIT).toBeTruthy();
    process.env.CNB_COMMIT = "abad1dea".repeat(5);
    process.env.CNB_PULL_REQUEST_TARGET_SHA = "deadbeef".repeat(5);
    try {
      stripInheritedGitEnv();
      expect(process.env.CNB_COMMIT, `${marker} stripInheritedGitEnv() 没剥掉 CNB_COMMIT`).toBe(
        undefined,
      );
      expect(process.env.CNB_PULL_REQUEST_TARGET_SHA).toBe(undefined);
    } finally {
      /* 全局那一档是**就地改** `process.env` 的，用例必须自己收拾（同文件 `dirs` 的理由）。 */
      delete process.env.CNB_COMMIT;
      delete process.env.CNB_PULL_REQUEST_TARGET_SHA;
    }
  });

  it("⑤ `local` 档：平台基座填成空串（在场且 falsy，兜底链才会走）", () => {
    /* ISSUE #2797：临时仓库里没有平台给的那个 sha，而 `resolveBaseRef()` 优先认它 ⇒
     * 判据 fail-closed。名字里写着「本地那一档」的用例必须能**声明**自己的前提，
     * 而不是指望环境恰好干净（本机干净、平台上不干净 —— 那是最难看见的一类）。
     *
     * 三向都钉：
     *   · 没给 ⇒ 空串（不是删键：删键与「从没出现过」同形，平台的环境会把它加回来）；
     *   · 显式给了的那一个是**被测输入**，不许被这一档吃掉；
     *   · 不给 `local` 的那些调用不受影响（既有语义不动）。 */
    const given: Record<string, string> = {
      CNB_PULL_REQUEST_TARGET_SHA: "cafebabe".repeat(5),
    };
    const filled = withNoPlatformBaseline({ ...process.env }, {});
    for (const key of PLATFORM_RUN_ENV_KEYS) {
      expect(key in filled, `${key} 缺席了（要的是空串在场）`).toBe(true);
      expect(filled[key], `${key} 不是空串`).toBe("");
    }

    /* `given` 里显式给了的那一个是**被测输入**：这一档只填 `given` 没声明的键，
     * 所以它必须原样留着。 */
    const kept = withNoPlatformBaseline(
      { ...process.env, CNB_PULL_REQUEST_TARGET_SHA: "cafebabe".repeat(5) },
      given,
    );
    expect(kept.CNB_PULL_REQUEST_TARGET_SHA).toBe("cafebabe".repeat(5));
    expect(kept.CNB_COMMIT).toBe("");
  });

  it("全局那一档挂在 `tests/setup.ts` 上（否则 20 份自起仓库的用例各扫各的）", () => {
    /* `vitest.config.ts` 的 `setupFiles` 指向它，且两档 project 都继承（文件里已注明）。
     * 这里判的是**接线**：那一档一旦被删，本文件 ② 的清理仍绿、而 20 份用例全部回到
     * 污染状态 —— 单靠行为用例看不见这件事。 */
    const setup = readFileSync("tests/setup.ts", "utf8");
    expect(setup, "tests/setup.ts 里没有那次全局剥离").toContain("stripInheritedGitEnv();");
  });
});
