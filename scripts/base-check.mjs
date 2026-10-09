#!/usr/bin/env node
/**
 * base-check.mjs — 「被门禁拦下时，先复算 master 基线」这件事的执行者
 * （规范 §13.6.2 第 1 步）。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────
 *
 * `pre-commit` 拦的是**提交**，而 PR 在平台侧是 **squash 合并**、不跑本地钩子，
 * 且 ISSUE #623 之后**没有 CI 兜底**。两条合起来：**违规可以直接落进 `master`**，
 * 成为所有人接下来的基线。硬闸类（须为 0、没有基线文件可登记）落到主干之后，
 * **凡是从 `master` 分出的提交都被拦住**，包括与之无关的改动 —— 被拦的人第一
 * 反应是「我改坏了」。
 *
 * 规范 §13.6.2 把处置口径写得很清楚（先复算、再判断挡不挡路、修了要写清归属），
 * 但**这三步此前只靠人记得**：那段 `git worktree add … && node scripts/check-*.cjs
 * … && git worktree remove …` 写在文档与注释里，没有执行者。于是「这一条本身
 * 还没有机器判据」（§13.6.2 末段原话）。
 *
 * 本脚本把第 1 步变成一条命令：**把你被拦住的那条判据，在干净的上游提交上再跑一遍**，
 * 给出可归因的结论，并把碎片里要写的那句事实（哪个上游提交、命中几处）打出来。
 *
 * ── 它判什么 ──────────────────────────────────────────────────────────
 *
 * 四态，各对应一个明确动作：
 *
 *   · `baseline-red`  —— 干净基线上**同样命中** ⇒ 别线的红，与你的改动无关。
 *     动作：挡路的（硬闸类）就地修掉，不挡路的按 §11.12 登记；**不许**为它放宽
 *     判据，也不许 `--no-verify`。
 *   · `yours`         —— 干净基线上**绿**、你的检出上红 ⇒ 你的改动引入的。
 *     动作：修你自己的代码，别去动基线。
 *   · `current-green` —— 你的检出上已经不红了 ⇒ 没什么可复算的（已修 / 判据只在
 *     特定输入面触发）。
 *   · `inconclusive`  —— 命令在其中一侧**没跑起来**（127）⇒ 不构成证据。
 *     最典型的成因是那条判据只存在**本检出未提交的改动**里：基线的 worktree 是一个
 *     干净的上游快照，看不到工作区的未提交文件（这是正确语义，不是缺陷 ——
 *     本判据要复算的就是「干净的线上基线」）。此时**不许**把 127 读成「别线的红」。
 *
 * **不做的事**（都写进 §13.6.2 了）：不替你决定「挡不挡路」、不自动登记
 * `KNOWN_FAILED_FILES`、不自动改判据 —— 那是判断，本脚本只保证**事实**这一半可复算。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 *
 *   node scripts/base-check.mjs <门禁命令…>        # 复算（默认不清远端）
 *   node scripts/base-check.mjs --fetch <门禁命令…> # 先 git fetch 再复算
 *   node scripts/base-check.mjs --json <门禁命令…>  # 机器可读（碎片/脚本消费）
 *   node scripts/base-check.mjs --keep <门禁命令…>  # 保留临时 worktree（人工排查）
 *
 * `<门禁命令…>` 是**你被拦住的那一条**，按它在文档/钩子里的写法给，例如：
 *
 *   node scripts/base-check.mjs check-ui-primitives
 *   node scripts/base-check.mjs node scripts/check-ui-primitives.cjs
 *   node scripts/base-check.mjs pnpm exec vitest run tests/check-title-bar-clearance.test.ts
 *
 * 也支持「只给等宽标签」的简写：`.githooks/pre-commit` 里 `run "<标签>" <命令>`
 * 的标签可以直接当参数（脚本自己去钩子里查那条命令 —— 标签是唯一的，
 * 不抄第二份命令清单）。
 *
 * 退出码：`0` = 事实已复算（三态都算成功，结论在输出里）；`1` = 复算过程本身失败
 * （不是 git 检出 / 取不到上游引用 / 命令拼不出来）—— 与「判据红了」分开，
 * 因为后者是本脚本要**报告**的事实、不是它的失败。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * 「被复算的那份检出」= **调用时的 cwd**，不是脚本自己的位置。
 *
 * 这两者在人手里是同一个（在仓库根跑），但在用例里不是（临时仓库里跑真脚本）——
 * 而按脚本位置锚定会把「复算谁的基线」这件事**绑死在安装位置**上：临时仓库里
 * 跑它，它复算的却是 /workspace 的基线，两条红绿与输入毫无关系。
 * git 命令本来就以 cwd 为语义（`spawnSync` 不给 `cwd` 时继承进程的），所以
 * 这里跟着 cwd 走也最贴近 `git` 本身的口径。
 */
const ROOT = process.cwd();
/* 钩子只从**安装位置**读：它是「有哪些门禁步骤」的清单，与复算哪份检出无关
 * （标签 ⇄ 命令的对应关系是仓库级的，不随检出变）。 */
const HOOK = path.join(HERE, "..", ".githooks", "pre-commit");

/**
 * 上游引用的候选顺序 —— **不写死 `cnb/master`**（§13.6.2 的示例里是它，但检出的
 * remote 名随克隆方式变；本地实测是 `origin`）：
 *   ① 当前分支的上游（`@{u}`，最贴近「我这份检出是从哪来的」）；
 *   ② 各 remote 的 `master`（`origin/master` / `cnb/master` / …）；
 *   ③ 本地 `master`（浅检出 / 单机仓库）。
 * 取不到任何一个即判复算失败并给出口，而不是静默拿一个错的基。
 *
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function resolveUpstreamRef(cwd = ROOT) {
  /** @param {string} ref */
  const tryRef = (ref) => git(["rev-parse", "--verify", "--quiet", ref], cwd).ok;
  const upstream = git(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    cwd,
  );
  if (upstream.ok && upstream.stdout && tryRef(upstream.stdout)) {
    return upstream.stdout;
  }
  const remotes = git(["remote"], cwd);
  if (remotes.ok) {
    for (const remote of remotes.stdout.split("\n").map((s) => s.trim())) {
      if (!remote) continue;
      const ref = `${remote}/master`;
      if (tryRef(ref)) return ref;
    }
  }
  if (tryRef("master")) return "master";
  return null;
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
const GIT_ENV_DENY = [
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
function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_DENY) delete env[key];
  return env;
}

/**
 * 在给定工作目录跑一条 git 命令。
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{ok: boolean, status: number, stdout: string, stderr: string}}
 */
function git(args, cwd = ROOT) {
  try {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanGitEnv(),
    });
    return {
      ok: r.status === 0,
      status: r.status ?? -1,
      stdout: String(r.stdout ?? "").trim(),
      stderr: String(r.stderr ?? "").trim(),
    };
  } catch (err) {
    return {
      ok: false,
      status: -1,
      stdout: "",
      stderr: String(err instanceof Error ? err.message : err),
    };
  }
}

/** 本检出是不是 git 仓库（不在检出里就没有「上游基线」这回事）。 */
export function isGitCheckout(cwd = ROOT) {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}

/**
 * 把一个「门禁命令」参数数组规范化成 `{ label, argv }`。
 *
 * 接受三种写法（都在 §13.6.2 的现场出现过）：
 *   · 钩子标签：`check-ui-primitives`（唯一命中 `.githooks/pre-commit` 的
 *     `run "<标签>" <命令>` 那一行，命令从钩子里取，不抄第二份）；
 *   · 裸脚本名：`scripts/check-ui-primitives.cjs`（补 `node` 前缀）；
 *   · 完整命令：`node scripts/x.cjs --strict` / `pnpm exec vitest run …`（原样）。
 *
 * 标签匹配**必须唯一** —— 命中 0 条或多条都判失败并列出候选，别猜。
 *
 * @param {string[]} input
 * @param {string} [hookPath]
 * @returns {{ok: true, label: string, argv: string[]} | {ok: false, error: string}}
 */
export function resolveGateCommand(input, hookPath = HOOK) {
  const first = input[0];
  if (first === undefined) {
    return { ok: false, error: "没有给门禁命令（用法见脚本头）" };
  }
  // 只给一个词、且不以路径/命令形态出现 ⇒ 当成钩子标签查。
  if (input.length === 1 && !first.includes("/") && !first.includes(".")) {
    const steps = readHookSteps(hookPath);
    const hits = steps.filter((s) => s.label === first);
    if (hits.length === 1 && hits[0]) {
      return { ok: true, label: hits[0].label, argv: hits[0].argv };
    }
    if (hits.length === 0) {
      const labels = steps.map((s) => s.label).join("\n    ");
      return {
        ok: false,
        error: `钩子里没有标签「${first}」。可用的标签：\n    ${labels}`,
      };
    }
    return {
      ok: false,
      error: `标签「${first}」在钩子里命中 ${hits.length} 条，无法唯一确定`,
    };
  }
  // 裸脚本名 ⇒ 补 `node`（仓库里 Node 是共同前提，§9.5）。
  if (input.length === 1 && /\.(cjs|mjs|js)$/.test(first)) {
    return { ok: true, label: first, argv: ["node", first] };
  }
  return { ok: true, label: input.join(" "), argv: input };
}

/**
 * 从 `.githooks/pre-commit` 里读出 `run "<标签>" <命令…>` 的步骤。
 *
 * 只认**步骤行**、不认文件全文 —— 同 `check-gate-executors.cjs` 的理由：
 * 全文匹配会把散文里被提到的脚本一起打进来（那边实测凭空多出三份）。
 *
 * @param {string} hookPath
 * @returns {Array<{label: string, argv: string[]}>}
 */
export function readHookSteps(hookPath = HOOK) {
  let text;
  try {
    text = fs.readFileSync(hookPath, "utf8");
  } catch {
    return [];
  }
  const steps = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*run\s+"([^"]+)"\s+(.+?)\s*$/);
    if (!m) continue;
    const label = m[1];
    const command = m[2];
    if (label === undefined || command === undefined) continue;
    // 命令里可能带行内注释（`--strict` 之后跟 `# …`）—— 去掉注释再分词。
    const bare = command.replace(/\s+#.*$/, "").trim();
    steps.push({ label, argv: tokenize(bare) });
  }
  return steps;
}

/**
 * 极简分词：按空白切，尊重单/双引号。
 *
 * 不做 shell 展开（`$VAR` / 通配符）—— 钩子里的步骤本来就不依赖展开
 * （它们走 `pnpm exec` / `node`，参数是显式的）。真需要 shell 语法的命令
 * 请**整条**作为参数传进来，本脚本会原样 `spawn` 给复核的那份检出。
 *
 * @param {string} line
 * @returns {string[]}
 */
export function tokenize(line) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 把一次 spawn 结果归一成 `{ code, output }`（同 `tests/helpers/gate-repo.ts` 的口径）。
 *
 * @param {import("node:child_process").SpawnSyncReturns<string>} r
 * @returns {{code: number, output: string}}
 */
export function normalizeRun(r) {
  if (r.error) return { code: 127, output: String(r.error.message) };
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { code: r.status ?? -1, output };
}

/**
 * 命令的**目标条目**（脚本文件 / 目录）在给定工作目录里存不存在。
 *
 * 为什么需要这一步：基线 worktree 是一个**干净的上游快照**，看不到本检出的未提交
 * 文件。一条「本检出有、未提交」的判据在基线侧会因 `MODULE_NOT_FOUND` 退出 ——
 * 而 Node 那条路径的退出码是 **1**，与「判据跑了且红」逐字同形（实测过：只读退出码
 * 必然误判）。所以「跑不起来」必须由**目标存不存在**判，不能由退出码判。
 *
 * 只对**能识别的形态**（`node <相对路径>`）做这一步：`pnpm exec` / `vitest` 这类
 * 目标不在文件系统上的命令交给它们自己报错（那时退出码与消息会说明问题）。
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{kind: "ok"} | {kind: "missing", target: string} | {kind: "unknown"}}
 */
export function commandTargetState(argv, cwd) {
  const [cmd, first] = argv;
  if (cmd !== "node" || !first || first.startsWith("-")) return { kind: "unknown" };
  const target = path.resolve(cwd, first);
  return fs.existsSync(target) ? { kind: "ok" } : { kind: "missing", target: first };
}

/**
 * 在给定工作目录跑一次门禁。**只做「跑 + 收码」**，判决在 `judge()`。
 *
 * `pnpm` 一律经 `pnpm exec`（AGENTS 硬规则 1：禁 npm/npx）；`node` 用当前
 * 可执行文件（`process.execPath`）而不是裸 `node`，避免复核环境里 PATH 上
 * 是另一套 Node。
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{code: number, output: string}}
 */
export function runGate(argv, cwd) {
  const state = commandTargetState(argv, cwd);
  if (state.kind === "missing") {
    // 127 是本脚本自己的「没跑起来」哨兵（`normalizeRun` 用同一个码）。
    return { code: 127, output: `[base-check] 目标不存在于该工作目录：${state.target}` };
  }
  const [cmd, ...rest] = argv;
  if (cmd === undefined) {
    return { code: 127, output: "[base-check] 命令是空的" };
  }
  const finalCmd = cmd === "node" ? process.execPath : cmd;
  const r = spawnSync(finalCmd, rest, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    /* 同样走干净环境：被判的判据自己也可能是 git 判据（`check-branch-guard` 等），
     * 继承来的 `GIT_*` 会让它判的**不是这个检出**。 */
    env: { ...cleanGitEnv(), CI: "1" },
  });
  return normalizeRun(r);
}

/**
 * 三态判决 —— **纯函数**（好让两向都能被用例钉住）。
 *
 * **「跑不起来」不是「判据红了」**（`baseCode === 127` / `currentCode === 127`）：判据没
 * 跑起来时非零退出码与「跑了且红」同形 —— 只读退出码必然把后者读成前者，而这两件事
 * 的下一动作完全相反（一个去修代码，一个去查命令为什么不存在）。所以先判这一档。
 *
 * @param {{currentCode: number, baseCode: number}} input
 * @returns {"current-green" | "inconclusive" | "baseline-red" | "yours"}
 */
export function judge({ currentCode, baseCode }) {
  if (currentCode === 0) return "current-green";
  if (currentCode === 127 || baseCode === 127) return "inconclusive";
  return baseCode !== 0 ? "baseline-red" : "yours";
}

/**
 * 结论的「下一动作」话术 —— 与 §13.6.2 的处置口径逐字对应，不在这里发明新口径。
 *
 * @param {"current-green" | "inconclusive" | "baseline-red" | "yours"} verdict
 * @param {{ref: string}} context
 * @returns {string[]}
 */
export function nextSteps(verdict, { ref }) {
  if (verdict === "current-green") {
    return ["你的检出上这条判据已经是绿的（已修 / 或它只在别的输入面上触发）—— 无需复算。"];
  }
  if (verdict === "inconclusive") {
    return [
      "命令在其中一侧**没跑起来**（127 = 找不到模块 / 命令），不是「判据红了」——",
      "  这次不构成「别线的红」的证据。常见原因：",
      "  · 那条判据只存在**本检出的未提交改动**里（基线是干净的上游提交，看不到它）；",
      "  · 命令写错 / 路径相对本检出（基线 worktree 在系统临时目录下）。",
      "先让它在本检出里真能跑（提交或修正命令），再复算。",
    ];
  }
  if (verdict === "baseline-red") {
    return [
      `干净基线上**同样命中** ⇒ 这是别线的红（${ref}），与你的改动无关。`,
      "挡路的（硬闸类，所有人都提交不了）就地修掉：单独一个 commit + 单独一条 changelog.d 碎片，",
      "  碎片里写明「这条不是本 PR 引入的」+ 上面那句复算证据 + 为什么顺手收掉。",
      "不挡路的（棘轮类 / 测试基线红）按规范 §11.12 登记 KNOWN_FAILED_FILES 并写清归属。",
      "**不许**为它放宽判据，也不许 --no-verify 换一条干净历史。",
    ];
  }
  return [
    "干净基线上是绿的 ⇒ 这是**你的改动**引入的。",
    "修你自己的代码；不要去动基线、也不要把它登记成「别线的红」。",
  ];
}

/**
 * 复算一次（编排本体）。
 *
 * 临时 worktree 建在系统临时目录（**不在仓库旁边**）：§13.6.2 的示例写
 * `../.wt-base-check`，那会把 worktree 留在仓库的父目录里，忘记删就永久占位
 * （而且会被某些工具的目录遍历扫到）。放 `os.tmpdir()` 下不会有这个问题。
 *
 * @param {{argv: string[], label: string, ref: string, keep?: boolean, json?: boolean}} input
 * @returns {number} 退出码（0 = 事实已复算；1 = 复算过程失败）
 */
export function baseCheck({ argv, label, ref, keep = false, json = false }) {
  const current = runGate(argv, ROOT);
  if (current.code === 0) {
    return report(
      { label, ref, verdict: "current-green", currentCode: 0, baseCode: null },
      { json },
    );
  }

  /** 本次尝试过的候选目录（成功那个是 worktree，其余都只是空目录）—— 收尾一律清。 */
  const attempts = [];
  let worktreePath = null;
  try {
    // `--detach` 是必须的：上游 ref 是 remote-tracking 分支，直接 checkout 会
    // 让 git 拒绝（「already checked out」/ 进不了分离态）。复核只需一个只读快照。
    //
    // **建一次、失败了换一个目录再建一次**：这一层在并发跑门禁时是环境噪声的受害者
    // （实测 `.git/index: index file open failed: Not a directory`，见 `GIT_ENV_DENY`
    // 那段）。两次都失败才是真失败 —— 不许把它读成「复算不出结论」。
    for (let attempt = 0; attempt < 2 && !worktreePath; attempt++) {
      const candidate = fs.mkdtempSync(
        path.join(os.tmpdir(), "comfy-base-check-"),
      );
      attempts.push(candidate);
      // `mkdtempSync` 建出的目录必须为空，而 `git worktree add` 要求目标**不存在**。
      fs.rmSync(candidate, { recursive: true, force: true });
      const add = git(["worktree", "add", "--detach", candidate, ref]);
      if (add.ok) {
        worktreePath = candidate;
      } else if (attempt === 1) {
        fail(`建临时 worktree 失败（${ref}）：${add.stderr}`);
        return 1;
      }
    }
    if (!worktreePath) {
      /* 循环保证到不了这里（两次都失败已在上面的 `attempt === 1` 分支 return 1）——
       * 显式收口只是让类型收窄，不是判据。 */
      fail(`建临时 worktree 失败（${ref}）：两次都没成功`);
      return 1;
    }
    const base = runGate(argv, worktreePath);
    const verdict = judge({ currentCode: current.code, baseCode: base.code });
    return report(
      {
        label,
        ref,
        verdict,
        currentCode: current.code,
        baseCode: base.code,
        commit: git(["rev-parse", "--short", "HEAD"], worktreePath).stdout,
        baseOutputTail: tail(base.output),
      },
      { json },
    );
  } finally {
    /* 未成为 worktree 的候选目录（建失败那一次留下的空目录）直接删。 */
    for (const candidate of attempts) {
      if (candidate !== worktreePath) {
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    }
    if (worktreePath && !keep) {
      // 先让 git 摘掉登记，再兜底 rm —— `git worktree remove` 在目录已被删时
      // 会失败，所以两条都要（顺序不能反）。
      git(["worktree", "remove", "--force", worktreePath]);
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } else if (worktreePath) {
      process.stdout.write(`[base-check] 保留临时 worktree：${worktreePath}\n`);
    }
  }
}

/**
 * 输出末 N 行（红线常在末尾；全量输出会把结论挤出屏幕）。
 *
 * @param {unknown} text
 * @param {number} [lines]
 * @returns {string}
 */
function tail(text, lines = 20) {
  const all = String(text ?? "").trimEnd().split("\n");
  return all.slice(-lines).join("\n");
}

/**
 * 复算过程本身失败（与「判据红了」分开）。
 *
 * @param {unknown} message
 */
function fail(message) {
  process.stderr.write(`[base-check] ${message}\n`);
}

/**
 * 打印结论 + 返回退出码（四态都是 0 —— 它是**读数**，不是判决）。
 *
 * @param {{label: string, ref: string, verdict: "current-green" | "inconclusive" | "baseline-red" | "yours", currentCode: number, baseCode: number | null, commit?: string, baseOutputTail?: string}} result
 * @param {{json: boolean}} opts
 * @returns {number}
 */
function report(result, { json }) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const { label, ref, verdict, currentCode, baseCode, commit } = result;
  process.stdout.write(`[base-check] 判据：${label}\n`);
  process.stdout.write(
    `[base-check] 结论：${verdict}` +
      `（本检出 ${currentCode}，${ref}${commit ? ` @ ${commit}` : ""} ${
        baseCode === null ? "未跑" : baseCode
      }）\n`,
  );
  if (result.baseOutputTail) {
    process.stdout.write(`[base-check] 基线那次输出的末尾：\n`);
    process.stdout.write(
      `${result.baseOutputTail
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n`,
    );
  }
  for (const line of nextSteps(verdict, { ref })) {
    process.stdout.write(`[base-check] ${line}\n`);
  }
  return 0;
}

/** @param {string[]} argv */
function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const JSON_OUT = flags.has("--json");

  if (!isGitCheckout()) {
    fail("当前目录不是 git 检出 —— 没有「上游基线」可复算");
    return 1;
  }
  if (flags.has("--fetch")) {
    const f = git(["fetch", "--prune"]);
    if (!f.ok) {
      fail(`git fetch 失败（可去掉 --fetch 用现有引用复算）：${f.stderr}`);
      return 1;
    }
  }
  const ref = resolveUpstreamRef();
  if (!ref) {
    fail(
      "取不到上游 master 引用 —— 先 `git fetch`（或确认克隆带了远端分支）再复算",
    );
    return 1;
  }
  const resolved = resolveGateCommand(args);
  if (!resolved.ok) {
    fail(resolved.error);
    return 1;
  }
  return baseCheck({
    argv: resolved.argv,
    label: resolved.label,
    ref,
    keep: flags.has("--keep"),
    json: JSON_OUT,
  });
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
