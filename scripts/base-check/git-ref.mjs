/**
 * `base-check.mjs` 的 **git 与 ref 层**(ISSUE #1811 拆 R5 超限文件)。
 *
 * 这一层只回答一件事:「复算谁的基线」—— 上游引用怎么解析、在哪份检出上、
 * 用哪个环境跑 git。它此前与判决逻辑、CLI 报告混在同一份 1382 行的文件里。
 *
 * 无副作用:模块加载时不跑任何 git(只算 `ROOT` / `HOOK` 两个路径常量)。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/**
 * 「被复算的那份检出」= **调用时的 cwd**，不是脚本自己的位置。
 *
 * 这两者在人手里是同一个（在仓库根跑），但在用例里不是（临时仓库里跑真脚本）——
 * 而按脚本位置锚定会把「复算谁的基线」这件事**绑死在安装位置**上：临时仓库里
 * 跑它，它复算的却是 /workspace 的基线，两条红绿与输入毫无关系。
 * git 命令本来就以 cwd 为语义（`spawnSync` 不给 `cwd` 时继承进程的），所以
 * 这里跟着 cwd 走也最贴近 `git` 本身的口径。
 */
export const ROOT = process.cwd();
/**
 * 钩子（「有哪些门禁步骤」的清单）**从被复算的那份检出读** —— 与 `ROOT` 同源。
 *
 * 这一条是实测撞出来的：原来锚在**脚本安装位置**（`import.meta.url` 的上一级），理由是
 * 「标签 ⇄ 命令的对应关系是仓库级的」—— 那个理由对「查标签」成立，对 `--base`
 * 不成立：`--base` 的语义是「**这批**判据在这份检出上会怎么样」，而「这批」正是
 * 这份检出的钩子说的。锚在安装位置时，在两个不同的检出上跑同一条命令会各自拿到
 * **对方那份钩子**，而输出看起来完全正常（实测：临时仓库里报「50 条判据」，那 50
 * 条来自 `/workspace` 的钩子、在临时仓库里一条都跑不起来 ⇒ 整批假红）。
 *
 * 与 `ROOT` 的那条注释是同一个病（「复算谁的基线」不该绑死在安装位置），
 * 所以处置也同源：跟着 `cwd` 走。
 */
export const HOOK = path.join(ROOT, ".githooks", "pre-commit");

/**
 * 上游引用的候选顺序 —— **不写死 `cnb/master`**（§13.6.2 的示例里是它，但检出的
 * remote 名随克隆方式变；本地实测是 `origin`）：
 *   ① 当前分支的上游（`@{u}`，最贴近「我这份检出是从哪来的」）；
 *   ② 各 remote 的 `master`（`origin/master` / `cnb/master` / …）；
 *   ③ 本地 `master`（浅检出 / 单机仓库）。
 * 取不到任何一个即判复算失败并给出口，而不是静默拿一个错的基。
 *
 * ⚠️ 它**不再是「这条红是谁的」那一问的答案**：PR 分支的 `@{u}` 就是自己那条线，
 * 刚把主干合进来时它不含主干改动，拿它当基线会把主干自带的红判成 `yours`。
 * 那一问走 {@link resolveAttributionRef}；本函数只作候选表与它的退回分支。
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function resolveUpstreamRef(cwd = ROOT) {
  /** @param {string} ref */
  const tryRef = (ref) => git(["rev-parse", "--verify", "--quiet", ref], cwd).ok;
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
  if (upstream.ok && upstream.stdout && tryRef(upstream.stdout)) {
    return upstream.stdout;
  }
  const remotes = git(["remote"], cwd);
  if (remotes.ok) {
    for (const remote of remotes.stdout.split("\n").map((s) => s.trim())) {
      if (!remote) {
        continue;
      }
      const ref = `${remote}/master`;
      if (tryRef(ref)) {
        return ref;
      }
    }
  }
  if (tryRef("master")) {
    return "master";
  }
  return null;
}

/**
 * **合并前复算要拿哪条当基线** —— 与 `resolveUpstreamRef` 是**两个问题**。
 *
 * `resolveUpstreamRef()` 回答的是「我这份检出是从哪来的」（首选 `@{u}`）。它**曾经**
 * 也被当作「这红是不是本来就有的」的答案，而那个前提在推送过的 PR 分支上是错的
 * （见 {@link resolveAttributionRef} 那一段）—— 事后复算现在走后者。
 *
 * 但 `--base` 问的是**另一个**问题：「并进 `master` 之后会不会红」。在 PR 分支上
 * `@{u}` 是**你自己的分支**（推送时就设上了），拿它当基线等于「自己跟自己比」——
 * 输出是「50 条全绿」，看起来一切正常，而它一个字节都没回答「并进去会怎样」。
 * （实测撞到的就是这个形态。）
 *
 * 所以这一档**只认「要并进去的那条」**：候选是各 remote 的 `master`，再退回本地
 * `master`。**刻意不退回 `@{u}`** —— 宁可判「取不到基线」让人显式给一条，也不拿
 * 一个语义不对的引用充数（同 `resolveUpstreamRef` 那句「取不到就报失败，而不是静默
 * 拿一个错的基」）。
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function resolveMergeBaseRef(cwd = ROOT) {
  /** @param {string} ref */
  const tryRef = (ref) => git(["rev-parse", "--verify", "--quiet", ref], cwd).ok;
  const remotes = git(["remote"], cwd);
  if (remotes.ok) {
    for (const remote of remotes.stdout.split("\n").map((s) => s.trim())) {
      if (!remote) {
        continue;
      }
      const ref = `${remote}/master`;
      if (tryRef(ref)) {
        return ref;
      }
    }
  }
  if (tryRef("master")) {
    return "master";
  }
  return null;
}

/**
 * 「被拦下时这条红是谁的」该拿哪条当基线 —— **优先主干，`@{u}` 只在它仍有意义时留下**。
 *
 * 旧口径那句「与你对比的就是你这条线的上游」在**推送过的 PR 分支**上不成立：
 * `@{u}` 就是你自己的分支，而人在复算前往往刚把 `origin/master` 合进来。此时
 * 「你这条线的上游」= 你上一次推送的那个提交 = **不含那批合并进来的主干改动**，于是：
 *   · 主干早就有的红，在基线那一侧不复现 ⇒ 判成 `yours`，把别线的债算到复算的人头上；
 *   · 极端形态是 `@{u}` 逐字等于 `HEAD`（合并还没推）⇒ 拿**自己跟自己比**。
 * 实测（ISSUE #1913）就是前者：合并主干后 e2e 冒出的 3 条红属于 `baseline-red`，
 * 而按旧口径会被算成我的 —— 当时是靠两条静态证据（失败行段与主干逐字一致 +
 * 本分支改动面不覆盖那两个功能目录）绕开的，不该指望每个人都手搓一遍。
 *
 * 所以顺序是：**主干与 `HEAD` 不同 ⇒ 用主干**（那才是「不是我引入的」的对照面）；
 * 主干与 `HEAD` 相同（直接在 `master` 上干活 / 刚快进过）⇒ 退回 `resolveUpstreamRef`
 * 那套候选，此时它们与主干同义。都取不到 ⇒ `null`，由调用方判失败 ——
 * 与这个模块通篇的「不许静默拿一个错的基」同一条口径。
 *
 * @param {string} [cwd]
 * @returns {{ref: string | null, why: string | null}} `why` 是给报告说的一句话：
 *   **取了哪条基线必须说出口** —— 一份写着 `up/<自己的分支>` 的输出读起来像「与主干比过」，
 *   而它一个字都没比。
 */
export function resolveAttributionRef(cwd = ROOT) {
  const upstream = resolveUpstreamRef(cwd);
  const trunk = resolveMergeBaseRef(cwd);
  const head = git(["rev-parse", "HEAD"], cwd);
  const trunkSha = trunk ? git(["rev-parse", trunk], cwd).stdout : "";
  if (trunk && head.ok && trunkSha && trunkSha !== head.stdout) {
    return {
      ref: trunk,
      /* 话术里**不许断言原因**（「不含你刚合进来的主干改动」）：主干与 HEAD 不同也可能只是
       * 本分支领先主干一笔常规提交 —— 那时 upstream 不含的是你自己的改动。这一行要说的是
       * 可比的那件事：复算对照的是**主干上有没有**，不是「我上次推过什么」。 */
      why:
        `基线取的是主干 \`${trunk}\`（本分支的 upstream 是${
        upstream && upstream !== trunk
          ? ` \`${upstream}\`，两者不同 —— 判「这红是不是本来就有的」要比主干上有没有，` +
            "不是比上次推过什么）"
          : "，本次不按它取）"}`,
    };
  }
  const ref = upstream ?? trunk;
  return {
    ref,
    why: ref ? `基线取的是 \`${ref}\`（与主干同一份）` : null,
  };
}

/**
 * 会改写「仓库在哪 / 索引在哪」的环境变量 —— 一律剥掉。
 *
 * 为什么：本脚本的语义是「在**这个**检出里，拿**这个**上游引用复算」，而这些变量
 * 一旦从调用环境里带进来，`git` 就不再操作那个检出 —— 实测（并发跑门禁时）撞到
 * `fatal: .git/index: index file open failed: Not a directory`：`git worktree add`
 * 的 `Preparing worktree` 那一步成功了，紧接着读索引时被一个外来的 `GIT_*` 指到了
 * 别处。这类继承来的变量**不报错、只改指向**，正是最坏的一类失效。
 *
 * @type {string[]}
 */
export const GIT_ENV_DENY = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

/**
 * 剥掉 `GIT_ENV_DENY` 之后的进程环境（其余原样，保住 PATH / HOME 等）。
 *
 * @returns {NodeJS.ProcessEnv}
 */
export function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_DENY) {
    delete env[key];
  }
  return env;
}

/**
 * 在给定工作目录跑一条 git 命令。
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{ok: boolean, status: number, stdout: string, stderr: string}}
 */
export function git(args, cwd = ROOT) {
  try {
    /* `stdout` / `stderr` 实测在 git 起不来（ENOENT）时是 `undefined`，
     * `@types/node` 按 `encoding` 声明成 `string` ⇒ 下面 `?? ""` 是给运行时兜的。 */
    const r = /** @type {{ status: number | null, stdout?: string, stderr?: string }} */ (
      spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: cleanGitEnv(),
      })
    );
    return {
      ok: r.status === 0,
      status: r.status ?? -1,
      stdout: String(r.stdout ?? "").trim(),
      stderr: String(r.stderr ?? "").trim(),
    };
  } catch (error) {
    return {
      ok: false,
      status: -1,
      stdout: "",
      stderr: String(error instanceof Error ? error.message : error),
    };
  }
}

/** 本检出是不是 git 仓库（不在检出里就没有「上游基线」这回事）。 */
export function isGitCheckout(cwd = ROOT) {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}
