#!/usr/bin/env node
/**
 * `ci-mirror-recipe.mjs` —— GA 侧「CI 配方核对」一格（ISSUE #4300）。
 *
 * ## 它回答的问题
 *
 * 镜像链路里，CNB 侧判的是平台合成的 merge 提交 M（merge(PR head, 目标快照)），镜像格
 * 把 M 连同 `base_sha` / `head_sha` / `merge_tree` 一起派发（`ci-github-mirror-push.mjs`
 * → `ci-mirror-payload.mjs`）；本 workflow 的各门禁 job 按 `client_payload.head_sha`
 * 检出**同一笔提交对象** —— 树天然一致。本格把这层「天然一致」变成**当场可验证**：
 *
 * 1. **打印配方**：base / head / merge_tree（payload 来的快照身份）+ 检出tree（本跑
 *    实际检出的树）。字段名与 CNB 侧镜像日志的配方段一致（`计划：HEAD … · tree … · base …`），
 *    两边日志可以逐字段对账 —— 回答「这一跑判的是哪一份 (base, head, tree) 快照」。
 * 2. **核对树**：payload 带了 `merge_tree` 时，`git rev-parse HEAD^{tree}` 必须与它
 *    逐字相等；不一致 ⇒ 退 1（fail-closed）—— 这跑判的不是 CNB 侧那棵树，后面所有
 *    判据的结果都不作数。典型触发：payload 的 `head_sha` 缺失导致 checkout 回落
 *    `github.sha`（镜像仓 master HEAD），没有指纹核对时这种跑会**静默判错树**。
 *
 * ## 边界
 *
 * 1. `merge_tree` 缺席（老 payload / 手动 `workflow_dispatch` 预知不了 tree）⇒ 只打印
 *    配方、不核对，退 0 —— 核对是**增量契约**，不把没有指纹的旧形状判红。
 * 2. 只读本地 git，不出网、不写状态、不吃 `pnpm install`（各 job 检出之后、装依赖
 *    之前就能跑；runner 预装的 node + git 就够）。
 * 3. 退出码两态：`0` 配方已打印（含「没指纹可核对」）、`1` 树不一致 / 本地 tree 取不到
 *    （检出失败的那一跑不能冒充「配方对上了」）。
 *
 * 环境变量：`MIRROR_BASE_SHA` / `MIRROR_HEAD_SHA` / `MIRROR_MERGE_TREE`
 * （pr-gate.yml 的配方 step 从 `client_payload` / `inputs` 注入，见该文件同名 step）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/** 仓根（GA runner 上 = 检出目录；本地自查 = 本检出根）。git 子进程只在这里跑。 */
const ROOT = path.resolve(import.meta.dirname, "../..");

/** 40 位十六进制 sha 的判定（base / head / tree 共用同一把尺）。 */
const SHA_RE = /^[0-9a-f]{40}$/i;

/** 退出码两态：`0` 配方已打印（含跳过核对）、`1` 树不一致 / 本地 tree 取不到。 */
export const CODE = Object.freeze({ OK: 0, MISMATCH: 1 });

/**
 * sha 的配方短形式：40 位取前 8 位；其余非空原样；空缺席。
 *
 * @param {unknown} sha 环境里来的 sha 原值
 * @returns {string}
 */
export function shortSha(sha) {
  const s = String(sha ?? "").trim();
  if (s === "") {
    return "缺席";
  }
  return SHA_RE.test(s) ? s.slice(0, 8) : s;
}

/**
 * 配方单行。字段名（base / head / merge_tree）与 CNB 侧镜像日志的配方段同词表 ——
 * 两边日志逐字段对账靠它，漂移由用例双向钉住（`tests/ci-mirror-recipe.test.ts`）。
 *
 * @param {{baseSha?: string, headSha?: string, mergeTree?: string, localTree?: string}} fields
 * @returns {string} 形如 `CI 配方：base=abcd1234 · head=… · merge_tree=… · 检出tree=…`
 */
export function renderRecipe({ baseSha = "", headSha = "", mergeTree = "", localTree = "" } = {}) {
  return (
    `CI 配方：base=${shortSha(baseSha)} · head=${shortSha(headSha)}` +
    ` · merge_tree=${shortSha(mergeTree)} · 检出tree=${shortSha(localTree)}`
  );
}

/**
 * 树核对三态：`verified`（payload 给了指纹且相等）/ `skipped`（没给指纹，不核对）/
 * `mismatch`（给了且不等，或本地 tree 取不到）。
 *
 * @param {{mergeTree?: string, localTree?: string}} args
 * @returns {{mode: "verified" | "skipped" | "mismatch", note: string}}
 */
export function verifyTree({ mergeTree = "", localTree = "" } = {}) {
  const expected = String(mergeTree ?? "")
    .trim()
    .toLowerCase();
  const actual = String(localTree ?? "")
    .trim()
    .toLowerCase();
  if (!SHA_RE.test(expected)) {
    return {
      mode: "skipped",
      note: "payload 未带 merge_tree（老 payload / 手动档）⇒ 只打印配方，不核对",
    };
  }
  if (!SHA_RE.test(actual)) {
    return {
      mode: "mismatch",
      note: `本地 tree 取不到（${actual === "" ? "空" : actual}）⇒ 检出失败的那一跑不能当作同一棵树放行`,
    };
  }
  if (expected !== actual) {
    return {
      mode: "mismatch",
      note: `树不一致：payload 要 ${expected.slice(0, 8)}，本跑检出 ${actual.slice(0, 8)} ⇒ 这跑判的不是 CNB 侧那棵树`,
    };
  }
  return { mode: "verified", note: `树一致（${actual.slice(0, 8)}）⇒ 与 CNB 侧判的是同一棵树` };
}

/**
 * 真 git 执行器（只读 `rev-parse`；cwd 钉在仓根，不靠继承的工作目录）。
 * 模块内私有：测试经 `main` / `localTreeSha` 的 `git` 注入面给假件，不直接消费本名。
 *
 * @param {string[]} args git 参数表
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runGit(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return {
    code: r.status ?? -1,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
  };
}

/**
 * 本地 tree：`git rev-parse HEAD^{tree}`。取不到回空串（调用方据此判 mismatch）。
 *
 * @param {(args: string[]) => {code: number, stdout: string, stderr: string}} [git] 注入面（测试假件）
 * @returns {string}
 */
export function localTreeSha(git = runGit) {
  const r = git(["rev-parse", "HEAD^{tree}"]);
  const out = r.stdout.trim();
  return r.code === 0 && SHA_RE.test(out) ? out : "";
}

/**
 * 主入口。打印配方并核对树；返回两态退码（0 / 1）。独立导出供测试整链注入。
 *
 * @param {{env?: Record<string, string | undefined>, git?: typeof runGit, log?: (line: string) => void}} [io]
 * @returns {number}
 */
export function main(io = {}) {
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const git = io.git ?? runGit;
  const baseSha = String(env.MIRROR_BASE_SHA ?? "").trim();
  const headSha = String(env.MIRROR_HEAD_SHA ?? "").trim();
  const mergeTree = String(env.MIRROR_MERGE_TREE ?? "").trim();
  const localTree = localTreeSha(git);
  log(renderRecipe({ baseSha, headSha, mergeTree, localTree }));
  const verdict = verifyTree({ mergeTree, localTree });
  log(`[mirror-recipe] ${verdict.note}`);
  return verdict.mode === "mismatch" ? CODE.MISMATCH : CODE.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
