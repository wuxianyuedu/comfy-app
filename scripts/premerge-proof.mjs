#!/usr/bin/env node
/**
 * premerge-proof.mjs — 把「合并前的固定动作」接到 push 这个生命周期事件上（规范 §13.6.2.1）。
 *
 * ── 为什么是 pre-push，而不是「记得敲一次」──────────────────────────────
 *
 * `pnpm check:premerge` 三段复算（干净快照上的全仓判据 / 提交信息里的机械可核声明 /
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHECK_SCRIPT = path.join(HERE, "premerge-check.mjs");
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
        "取不到上次 fetch 看到的上游引用 —— 复算没有可比的那条线（先 `git fetch` 再推）",
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
 * @param {string} gitDir
 * @returns {{headSha: string, upstreamSha: string | null}}
 */
function readRevisions(gitDir) {
  const run = (/** @type {string[]} */ args) => {
    const r = spawnSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: gitDir },
    });
    return r.status === 0 ? String(r.stdout ?? "").trim() : "";
  };
  return {
    headSha: run(["rev-parse", "HEAD"]),
    upstreamSha:
      run(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/master"]) ||
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
 * 「跑过」与「跑绿过」是两件事：只有全绿才写证明 —— 红着记一条「我复算过」会把两者混成
 * 一件（与新鲜度账同一口径，§11.8）。抽成纯函数是为了让这一条边界本身有人执行。
 *
 * @param {number | null | undefined} status
 * @returns {boolean}
 */
export function shouldRecordProof(status) {
  return status === 0;
}

/**
 * 只有**全绿**才写证明（由 `shouldRecordProof` 把关）。
 *
 * @param {string} gitDir
 * @param {{headSha: string, upstreamSha: string, who: string}} record
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
    `[pre-push] 跑合并前固定动作（check:premerge 三段；分钟级，代价与出处见规范 §13.6.2.1）\n` +
      `[pre-push]   为什么要跑：${verdict.reasons.join("；")}\n`,
  );
  const r = spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (shouldRecordProof(r.status)) {
    const who =
      spawnSync("git", ["config", "user.name"], {
        cwd: ROOT,
        encoding: "utf8",
      }).stdout?.trim() || "(未登记)";
    writeProof(gitDir, { headSha, upstreamSha: upstreamSha ?? "", who });
    process.stdout.write(
      `[pre-push] ✓ 合并前复算全绿，已记入 ${PROVEN_FILE_NAME}（本机、不入库）\n`,
    );
    return 0;
  }
  process.stderr.write(
    `[pre-push] ✗ 合并前复算没有通过（退 ${r.status ?? 2}）。` +
      `被拦下的这条分支现在合进 master 会把红一起带过去 —— 先按上面的输出修，` +
      `别用 \`git push --no-verify\` 换一条干净历史（硬规则 7 的同一口径）。\n`,
  );
  return typeof r.status === "number" ? r.status : 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const stdin = fs.readFileSync(0, "utf8");
  process.exit(runFromStdin(stdin));
}
