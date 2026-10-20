#!/usr/bin/env node
/**
 * premerge-proof.mjs — 把「合并前的固定动作」接到 push 这个生命周期事件上（规范 §13.6.2.1）。
 *
 * ── 为什么是 pre-push，而不是「记得敲一次」──────────────────────────────
 *
 * `pnpm check:premerge` 各段复算（干净快照上的全仓判据 / 提交信息里的机械可核声明 /
 * 合并有没有丢一侧）此前**唯一的执行者就是人**。它天然跑不进 `pre-commit`：本地钩子面前
 * 没有平台侧那一次 squash 合并。于是「我的分支绿」到「master 绿」之间那一跳靠纪律补，
 * 而纪律的三种漏法（漏跑一步 / 顺序反了 / 只跑了自己记得的那条）都不报错。
 *
 * push 是本地能看到的**最后一个**、且语义上紧挨着「这条分支要被合了」的事件。所以这里
 * 把它变成触发点，同时用一份过期证明把代价压在「确实可能马上被合的那一次」上：
 *
 *   · 单次耗时是**分钟级**、且随缓存与负载明显漂（本机三次实测 84 / 116 / 336 秒，同一台
 *     机器、同样的 53–54 条判据）。所以这里不写死一个数、也不写区间，只留「分钟级 + 指路
 *     §13.6.2.1」—— 数写在三处就会漂，而那正是本仓刚立过的规矩。
 *     每一次 push 都跑它，等于按这仓库的节奏（一天几十次提交）给每人加十几分钟墙钟 ——
 *     那不会让人更严谨，只会让人 `--no-verify`。
 *   · 所以只在**两个输入之一变了**时跑：本检出的 HEAD、或上次 fetch 看到的上游引用。
 *     二者都没变 ⇒ 打印一句为什么直接过（放弃是被看见的，与 `affected-tests` 那条同口径）。
 *
 * ── 证明为什么落在 `.git/` 而不是仓库里 ──────────────────────────────────
 *
 * 它记的是「**这台检出**在某个上游引用位置上复算过某一颗 HEAD」。写进版本库的话，
 * 同仓的并行检出会互相作证（A 检出跑过、B 检出直接免检），而那正是这一族要防的假绿。
 * 新鲜度账（`FRESHNESS_TRACKS` 那三档）是**仓库级**的「今天有人自证过」，语义不同，
 * 所以不复用它的文件，也不登记成新档 —— 登记了就会被 pre-commit 判成「每天必须跑一次
 * 五分钟」，那是另一种仪式。
 *
 * ── 退出码 ──────────────────────────────────────────────────────────────
 *
 * 与 `premerge-check.mjs` / `base-check.mjs` **逐字同一套**（中间层不翻译，§12.18）：
 *   0 = 已证明过、或本次复算全绿；1 = 复算红了；2 = 没跑起来 / 无法归因（含取不到上游引用）。
 *
 * 用法：由 `.githooks/pre-push` 调用，stdin 是 git 给的 ref 行
 *      `<local-ref> <local-sha> <remote-ref> <remote-sha>`；也可手工喂同一份输入复现。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveMergeBaseRef } from "./base-check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROVEN_FILE_NAME = "comfy-premerge-proof.json";
const ZERO_SHA = /^0+$/;

/**
 * 解析 pre-push 的 stdin（一行一个待推送的 ref）。
 *
 * @param {string} stdinText
 * @returns {{localRef: string, localSha: string, remoteRef: string, remoteSha: string}[]}
 */
export function parseRefLines(stdinText) {
  return String(stdinText)
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 4)
    .map((cols) => ({
      localRef: cols[0] ?? "",
      localSha: cols[1] ?? "",
      remoteRef: cols[2] ?? "",
      remoteSha: cols[3] ?? "",
    }));
}

/**
 * 挑出「值得为它复算」的 ref：推向分支（不是 tag、不是删除）、且不是 master 本身。
 *
 * master 不在这里判：直连 master 被 `check-branch-guard.cjs` 挡在提交那一层（硬规则 6），
 * 而对 PR 分支来说 master 是**目标**，对它复算「合并前那一跳」没有意义。
 *
 * @param {ReturnType<typeof parseRefLines>} refs
 * @param {string} [targetBranch]
 * @returns {ReturnType<typeof parseRefLines>}
 */
export function mergeCandidates(refs, targetBranch = "master") {
  return refs.filter((r) => {
    if (!r.remoteRef.startsWith("refs/heads/")) return false;
    if (ZERO_SHA.test(r.localSha)) return false;
    const branch = r.remoteRef.slice("refs/heads/".length);
    return branch !== targetBranch;
  });
}

/**
 * 判决本体（纯函数，便于逐条边界都被用例走到）。
 *
 * @param {{candidates: ReturnType<typeof mergeCandidates>, headSha: string, upstreamSha: string | null, proof: {headSha?: string, upstreamSha?: string, verifiedAt?: string} | null}} input
 * @returns {{run: boolean, reasons: string[]}}
 */
export function decidePremergePush({
  candidates,
  headSha,
  upstreamSha,
  proof,
}) {
  if (candidates.length === 0) {
    return { run: false, reasons: ["本次 push 没有要合进 master 的分支 ref"] };
  }
  if (!upstreamSha) {
    return {
      run: false,
      reasons: [
        "取不到上次 fetch 看到的上游引用 —— 复算没有可比的那条线（按「各 remote 的 `master` → 本地 " +
          "`master`」依次找过，远端名不假定叫 origin；先 `git fetch` 再推）",
      ],
    };
  }
  /** @type {string[]} */
  const reasons = [];
  if (!proof || !proof.verifiedAt) {
    reasons.push("本机还没有过合并前复算的记录");
  } else if (proof.headSha !== headSha) {
    reasons.push(
      `记录停在 ${shortSha(proof.headSha)}，而本检出现在是 ${shortSha(headSha)}`,
    );
  }
  if (proof && proof.upstreamSha && proof.upstreamSha !== upstreamSha) {
    reasons.push(
      `复算时上游在 ${shortSha(proof.upstreamSha)}，上次 fetch 看到的已经是 ${shortSha(upstreamSha)}`,
    );
  }
  /* 推的不只是当前 HEAD 时，那颗证明只覆盖 HEAD 自己 —— 其余分支得另说。 */
  const others = candidates.filter((c) => c.localSha !== headSha);
  if (others.length > 0) {
    reasons.push(
      `本次还带了不在当前 HEAD 上的分支（${others.map((o) => o.remoteRef.replace("refs/heads/", "")).join(" / ")}）`,
    );
  }
  return { run: reasons.length > 0, reasons };
}

/**
 * @param {string | null | undefined} sha
 * @returns {string}
 */
function shortSha(sha) {
  return sha ? String(sha).slice(0, 8) : "(无)";
}

/**
 * 本检出的两颗 sha：HEAD 与「上次 fetch 看到的上游 `master`」。
 *
 * 上游那条**不写死 `refs/remotes/origin/master`**：本仓的远端实测叫 `cnb`（`git remote -v` 里
 * 没有 `origin`），那句在这份检出里恒取不到 ⇒ `decidePremergePush` 走「取不到上游引用」那一支
 * ⇒ 每一次 topic 分支的 push 都被判成「没法复算」而退 2 —— §13.6.2.1 刚立的执行者反过来
 * 挡住了所有 push。远端名随克隆方式变（`base-check.mjs` 的注释早就记过这件事），所以复用它的
 * `resolveMergeBaseRef()`，但**只收它第②档那种 `<remote>/master` 的形状**（下面 `includes("/")`
 * 那句）：它的第③档「本地 `master`」对 `--base` 是对的（浅检出 / 单机仓库），对这一跳不对 ——
 * 这一档要的是**会被 `git fetch` 移动**的引用，本地 `master` 不会动。同一处也**不走 `@{u}`**：
 * 推送之后 `@{u}` 就是你自己的分支，拿它当上游等于「自己跟自己比」，看起来全绿而什么都没回答。
 *
 * @param {string} gitDir
 * @param {string} [cwd]
 * @returns {{headSha: string, upstreamSha: string | null}}
 */
export function readRevisions(gitDir, cwd = ROOT) {
  const run = (/** @type {string[]} */ args) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: gitDir },
    });
    return r.status === 0 ? String(r.stdout ?? "").trim() : "";
  };
  /* `resolveMergeBaseRef()` 的第③档是「本地 `master`」，那一档在**这里**语义不对：这一跳要的
   * 语义是「这条引用会被 `git fetch` 移动」，而本地 `master` 不会 —— 远端前移、本地没动时拿它
   * 当上游，等于给一份陈旧证明发免检条。所以只收 `<remote>/master` 那种带命名空间的形状。 */
  const ref = resolveMergeBaseRef(cwd);
  const upstreamRef = ref && ref.includes("/") ? ref : null;
  return {
    headSha: run(["rev-parse", "HEAD"]),
    upstreamSha:
      (upstreamRef && run(["rev-parse", "--verify", "--quiet", upstreamRef])) ||
      null,
  };
}

/**
 * @param {string} gitDir
 * @returns {{headSha?: string, upstreamSha?: string, verifiedAt?: string, who?: string, how?: string} | null}
 */
export function readProof(gitDir) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(gitDir, PROVEN_FILE_NAME), "utf8"),
    );
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    /* 没有记录 = 从没复算过；读不出（半截文件 / 手工改坏）同样按「没有」处理，
     * 因为这一侧的失败代价是「多跑一次」，而不是「少跑一次」。 */
    return null;
  }
}

/**
 * 「跑过」与「跑绿过」是两件事：写证明的三个入口都只在**没有引入新的红**时到达 ——
 * 全绿写一条干净的，`baseline-red` 那种写一条带 `baselineRed` 名单的（见
 * `decideBaseAttribution`），红了直接返回不写。
 *
 * @param {string} gitDir
 * @param {{headSha: string, upstreamSha: string, who: string, baselineRed?: string[]}} record
 */
export function writeProof(gitDir, record) {
  const body = {
    ...record,
    verifiedAt: new Date().toISOString(),
    how: "node scripts/premerge-check.mjs（由 .githooks/pre-push 触发）",
  };
  try {
    fs.writeFileSync(
      path.join(gitDir, PROVEN_FILE_NAME),
      `${JSON.stringify(body, null, 2)}\n`,
      "utf8",
    );
  } catch (err) {
    process.stderr.write(
      `[pre-push] 证明没能落盘（${err instanceof Error ? err.message : String(err)}）—— ` +
        `本次复算的结论仍然有效，下次 push 会再跑一遍。\n`,
    );
  }
}

/**
 * 「别线的红」不挡路，其余一律挡。
 *
 * 立案现场：这条接线刚接上就撞上一条红 —— 上游刚加的「基础设施层文件长度棘轮」在
 * **干净的 origin/master 上就已经命中**（那条文件 957 行、基线登记 952），而本分支只是
 * 叠在上面。`base-check` 归成 `baseline-red`，钩子却照 1 拦下 push —— 那是把别人的库存红
 * 变成每个人每次 push 的墙钟，而这一族最终的结局只有一个：学会用 `--no-verify`。
 * §13.6.2 自己的口径也是「不挡路的（棘轮类 / 测试基线红）登记并写清归属」。
 *
 * 所以放行只放行在**证据说它是别线的红**那一格：`yours`（自己的）、`load-flake`（拿不准，
 * 不许照别线的动作走）、`inconclusive`（没跑起来 ⇒ 不构成证据）三种都拦。
 */
const BLOCKING_BASE_STATES = new Set(["yours", "load-flake", "inconclusive"]);

/**
 * 把 `base-check --base --json` 的逐条归属折成「拦 / 放 + 名单」。
 *
 * @param {{rows?: Array<{label?: string, currentCode?: number, verdict?: string}>, summary?: string} | null} attribution
 * @returns {{allowed: boolean, blocking: string[], baselineOnly: string[], reason: string | null}}
 */
export function decideBaseAttribution(attribution) {
  if (!attribution || !Array.isArray(attribution.rows)) {
    return {
      allowed: false,
      blocking: [],
      baselineOnly: [],
      reason: "取不到逐条归属（`base-check --base --json` 没给出可读结果）",
    };
  }
  const reds = attribution.rows.filter((r) => (r.currentCode ?? 0) !== 0);
  if (reds.length === 0) {
    return {
      allowed: false,
      blocking: [],
      baselineOnly: [],
      reason:
        "base 段报了红，但逐条里没有红项 —— 两份读数不一致，按没跑起来处理",
    };
  }
  const blocking = [];
  const baselineOnly = [];
  for (const r of reds) {
    const label = String(r.label ?? "(未命名判据)");
    if (BLOCKING_BASE_STATES.has(String(r.verdict))) blocking.push(label);
    else if (String(r.verdict) === "baseline-red") baselineOnly.push(label);
    else blocking.push(`${label}（归属读数：${String(r.verdict ?? "未知")}）`);
  }
  return {
    allowed: blocking.length === 0,
    blocking,
    baselineOnly,
    reason: null,
  };
}

/**
 * `premerge-check --json` 的读数（逐段码）。
 *
 * @typedef {object} PremergeReport
 * @property {number} [code]
 * @property {Array<{key?: string, label?: string, code?: number}>} [segments]
 */

/**
 * `base-check --base --json` 的读数（逐条归属）。
 *
 * @typedef {object} BaseCheckReport
 * @property {string} [summary]
 * @property {Array<{label?: string, currentCode?: number, verdict?: string}>} [rows]
 */

/**
 * 读一个子进程 stdout 里的 JSON（读不出返回 null，由调用方按「不构成证据」处理）。
 * 返回 `unknown`：两个调用点各自用 typedef 收窄，不在这里替它们猜形状。
 *
 * @param {string | undefined} text
 * @returns {unknown}
 */
function parseJson(text) {
  try {
    return JSON.parse(String(text ?? "").trim());
  } catch {
    return null;
  }
}

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {{status: number, stdout: string}}
 */
function runQuiet(script, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return {
    status: typeof r.status === "number" ? r.status : 2,
    stdout: r.stdout ?? "",
  };
}

/**
 * @param {string} stdinText
 * @returns {number} 退出码
 */
export function runFromStdin(stdinText) {
  const gitDirOut = spawnSync("git", ["rev-parse", "--git-dir"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (gitDirOut.status !== 0) {
    process.stderr.write(
      "[pre-push] 当前目录不是 git 检出 —— 无从复算（退 2）\n",
    );
    return 2;
  }
  const gitDir = path.resolve(ROOT, String(gitDirOut.stdout ?? "").trim());
  const candidates = mergeCandidates(parseRefLines(stdinText));
  const { headSha, upstreamSha } = readRevisions(gitDir);
  const proof = readProof(gitDir);
  const verdict = decidePremergePush({
    candidates,
    headSha,
    upstreamSha,
    proof,
  });

  if (!verdict.run) {
    /* 唯一「不跑但也不拦」的形态：确实没什么要复算的（没有目标分支 ref），
     * 或已经有一份仍然成立的证明。其余不跑都是**没法跑**，得拦下来。 */
    if (verdict.reasons.some((r) => r.startsWith("取不到"))) {
      process.stderr.write(
        `[pre-push] ✗ ${verdict.reasons.join("；")}（退 2 —— 这一跳没有被复算过，` +
          `也不能确认它没必要）\n`,
      );
      return 2;
    }
    if (proof?.verifiedAt && candidates.length > 0) {
      process.stdout.write(
        `[pre-push] ✓ 跳过合并前复算：HEAD ${shortSha(headSha)} 与上游 ${shortSha(upstreamSha)} ` +
          `自上次自证（${proof.verifiedAt}）以来都没变。\n`,
      );
      return 0;
    }
    process.stdout.write(
      `[pre-push] 不跑合并前复算：${verdict.reasons.join("；")}\n`,
    );
    return 0;
  }

  process.stdout.write(
    `[pre-push] 跑合并前固定动作（check:premerge 各段；分钟级 —— 干净快照上的全仓判据那一档最贵）\n` +
      `[pre-push]   为什么要跑：${verdict.reasons.join("；")}\n` +
      `[pre-push]   受影响用例那一档不在这里：2026-10-20 起它的执行者是平台侧 PR 流水线的\n` +
      `[pre-push]   「受影响用例」一格（scripts/ci-affected-tests.mjs → run-affected-tests.mjs）。\n`,
  );
  /* `--json` 拿逐段码：只有 base 段红时才再问一次归属（那是一批全仓判据的量级，放在稀有
   * 路径上付；绿的那条路径仍然只跑一次）。 */
  const run = runQuiet("premerge-check.mjs", ["--json"]);
  const report = /** @type {PremergeReport | null} */ (parseJson(run.stdout));
  const segments = Array.isArray(report?.segments) ? report.segments : null;
  const who =
    spawnSync("git", ["config", "user.name"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout?.trim() || "(未登记)";

  if (run.status === 0) {
    writeProof(gitDir, { headSha, upstreamSha: upstreamSha ?? "", who });
    process.stdout.write(
      `[pre-push] ✓ 合并前复算全绿，已记入 ${PROVEN_FILE_NAME}（本机、不入库）\n`,
    );
    return 0;
  }
  if (run.status === 2 || !segments) {
    process.stderr.write(
      `[pre-push] ✗ 合并前复算没跑成（退 ${run.status}）或读数不可归因 —— ` +
        `拿不到测量不等于测量是绿的，本次 push 不放行。细节看 \`pnpm check:premerge\`。\n`,
    );
    return 2;
  }

  const reds = segments.filter((s) => (s?.code ?? 0) !== 0);
  /** @type {string[]} */
  let blocking = reds.map(
    (s) =>
      `${String(s?.label ?? s?.key ?? "?")}（退 ${String(s?.code ?? "?")}）`,
  );
  /** @type {string[]} */
  let baselineOnly = [];

  if (reds.every((s) => s?.key === "base")) {
    /* 只有 base 段红 ⇒ 去要逐条归属。别的段红（提交信息里的声明 / 合并丢一侧）按构造
     * 就是本分支的事，不查也拦。 */
    const attr = runQuiet("base-check.mjs", ["--base", "--json"]);
    const decided = decideBaseAttribution(
      /** @type {BaseCheckReport | null} */ (parseJson(attr.stdout)),
    );
    if (decided.allowed) {
      baselineOnly = decided.baselineOnly;
      blocking = [];
    } else if (decided.blocking.length > 0) {
      blocking = decided.blocking;
    } else {
      blocking = [decided.reason ?? "归属读不出"];
    }
  }

  if (blocking.length > 0) {
    process.stderr.write(
      `[pre-push] ✗ 合并前复算红了，本次 push 不放行：\n` +
        blocking.map((l) => `      · ${l}\n`).join("") +
        `  这条分支现在合进 master 会把红一起带过去 —— 先修（\`yours\`），或按 §13.6.2 ` +
        `复算归属；别用 \`git push --no-verify\` 换一条干净历史（硬规则 7 同一口径）。\n`,
    );
    return 1;
  }

  /* 走到这里 = base 段有红、逐条却全是 `baseline-red`（master 上本来就红）。放行，
   * 但把它记进证明并逐条念出来 —— 「不挡路」不等于「不说」。 */
  writeProof(gitDir, {
    headSha,
    upstreamSha: upstreamSha ?? "",
    who,
    baselineRed: baselineOnly,
  });
  process.stderr.write(
    `[pre-push] ⚠ 本分支没有引入新的红，但 master 上已有 ${baselineOnly.length} 条：\n` +
      baselineOnly.map((l) => `      · ${l}\n`).join("") +
      `  那是别线的账（就地收掉，或按 §11.12 登记 KNOWN_FAILED_FILES），不该由这条 push ` +
      `承担，所以放行；已随证明记下，下一次复算还会念。\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const stdin = fs.readFileSync(0, "utf8");
  process.exit(runFromStdin(stdin));
}
