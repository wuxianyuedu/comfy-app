#!/usr/bin/env node
/**
 * merged-side-loss-git.mjs — 「整份退回」这一族判据的 **git 取证层**（批量读法）。
 *
 * ── 它在家族里的位置 ──────────────────────────────────────────────────
 *
 * 同一族有三个模块，分工是**单向**的：
 *
 *   · `merged-side-loss-core.mjs`：纯判定（「结果版是否等于某个更早版本」），
 *     不含任何传输层代码（§18.4 / §12.12 的口径）；
 *   · 本模块：纯传输（把 `<rev>:<path>` 与「某文件在历史上被哪些提交改过」批量取回），
 *     不含判定；
 *   · `check-merged-side-loss.mjs`（事后复算档）与 `check-pending-merge-loss.mjs`
 *     （提交前档）：业务语义 —— 谁是基线、候选取哪条线、命中怎么说话。
 *
 * 取证方式只有一份实现：两个执行者抄成两遍就是 §12.12 的字面孪生，而孪生对里
 * 「顺手改对了」的那一份会静默漂掉。
 *
 * ── 它消灭的是这条判据**自己的**成本 ──────────────────────────────────
 *
 * 旧写法逐文件 `git log -- <file>`、再对该文件的每条历史逐条 `git rev-parse <sha>:<file>`，
 * spawn 次数 = 变更文件数 ×（1 + 该文件的历史条目数）。两个真实范围上**同一时刻成对复测**
 * （本机 Windows、16 核；耗时含 git 进程冷启动）：
 *
 *     范围                       ① 逐文件（改前）   ② 一次遍历带 pathspec   ③ 一次遍历不带 pathspec
 *     65 个非生成物文件 / b62181bc     476.5s              30.7s                  35.7s
 *      8 个非生成物文件 / 4e77e3cf      45.1s              14.9s                  32.7s
 *
 * 另一次采样给出同一条规律的斜率：0 文件 0.72s ／ 3 文件 6.2s ／ 48 文件 133–218s，
 * 约 2–3s/文件。后果有两个，都是实测到的：`tests/premerge-check.test.ts` 里等这一段
 * 的两条用例在任何稍大的分支上**恒超时红**（vitest 全局 `testTimeout` 是 30s，而那颗
 * 注释明写它是「给真进程留的余量，不是给慢用例兜底」，所以不许抬它）；提交前档更糟 ——
 * 它挂在 `.githooks/prepare-commit-msg`，一次大合并会让 `git commit` 静默挂几分钟。
 *
 * ⚠️ **本模块选的是 ③，代价要说清**：③ 的成本 = **一次全历史遍历**，与本次范围有多少文件
 * 基本无关，而随仓库历史长度增长 —— 也就是说这条判据今天约 25–36s，以后只会更贵（但封顶在
 * 一趟遍历，不再乘以文件数）。选它而不是便宜 2 倍的 ②，是因为实测到 **② 的候选集与 ① 逐字
 * 相同**（0 份文件不同）：带 pathspec 的那次遍历仍然在合并处剪枝，盲区原样留着。
 *
 * 读数还带一个必须写进话术的性质：**离群值**。同一段 9 文件范围在冷缓存叠 31 个并发 node
 * 进程下测到 241–298s，而稳定态是 24.8s / 26.2s（两遍）。所以「跑了几分钟」在本机
 * **不构成结论**，要么复测要么先量并发；反过来拿一次离群值当「这条判据慢得不能用」也不成立。
 *
 * ── 读数等价性（不是「差不多」）──────────────────────────────────────
 *
 *   · **blob 解析**：`git cat-file --batch-check` 与逐条 `git rev-parse` 在 144 条真实
 *     `<rev>:<path>` 请求上逐字相同，含「该路径在那个版本不存在」（`missing`）的那些。
 *   · **候选历史**：新读法是「一次 `git log --name-only` 遍历，按提交列出它改了哪些文件」。
 *     与逐文件 `git log -- <file>` 的差别只有一个来源 —— 单路径遍历会在合并处按
 *     TREESAME 剪枝，把「只在被并进来的那条线上改过该文件」的非合并提交整条丢掉；
 *     也就是说**旧读法漏候选**（可能漏报真退回），新读法不再漏。
 *     等价性在 8 个真实范围上对跑过两侧的最终清单，含本判据立案的那次事故
 *     （`bfeb33f0..ad81a912`，128 文件、86 处命中，两侧逐字一致）。
 *
 * ── 解析失败一律判「没跑起来」 ────────────────────────────────────────
 *
 * 输出行数对不上、或某行读不懂时，两个函数都返回 `null` 交给调用方转成退出码 2，
 * **不猜、不部分采信**：这条判据最坏的失效形态不是报错，是「看起来在跑、实际什么都没判」。
 *
 * @module scripts/merged-side-loss-git — 「整份退回」家族的 git 取证层（批量读法，可注入 run）
 */

/** 提交标记行：`@` + 纯十六进制 sha。路径本身叫 `@<40 位十六进制>` 的情况按「不可能」处理，
 *  真出现时它只会落进「读不懂 ⇒ 退 2」那一格，不会静默当成文件。 */
const COMMIT_LINE = /^@([0-9a-f]{4,64})$/;
/** `--batch-check` 的一行：`<对象 sha> <类型> <字节数>`。 */
const BATCH_LINE = /^([0-9a-f]{4,64}) \S+ -?\d+$/;

/**
 * 一次批量解析把 `<rev>:<path>` 请求表换成对象 sha 表。
 *
 * @param {(args: string[], input?: string) => (string | null)} run 跑一条 git 命令，失败回 null
 * @param {string[]} specs 形如 `HEAD:src/a.ts`；重复项自动去掉，只解析一次
 * @returns {Map<string, string | null> | null} `null` = 批量解析没跑起来或输出对不上；
 *   值取到 `null` 表示该路径在那个版本不存在（与逐条 `rev-parse` 失败同义）。
 */
export function resolveBlobs(run, specs) {
  const uniq = [...new Set(specs)];
  /** @type {Map<string, string | null>} */
  const out = new Map();
  if (uniq.length === 0) return out;

  const raw = run(["cat-file", "--batch-check"], uniq.join("\n") + "\n");
  if (raw === null) return null;
  const lines = raw.split("\n");
  /* 每个请求恰好一行；对不上说明我们的读法与 git 的格式不一致了 ⇒ 不许继续猜。 */
  if (lines.length < uniq.length) return null;

  for (let i = 0; i < uniq.length; i++) {
    const line = lines[i];
    const spec = uniq[i];
    /* 越界 = 输出比请求少，形状已经不对了 ⇒ 整单判「没跑起来」。 */
    if (line === undefined || spec === undefined) return null;
    if (line.endsWith(" missing")) {
      out.set(spec, null);
      continue;
    }
    const hit = BATCH_LINE.exec(line);
    const blobSha = hit ? hit[1] : undefined;
    if (!blobSha) return null;
    out.set(spec, blobSha);
  }
  return out;
}

/**
 * 一次遍历得到「`ref` 的历史上，每个被关心的文件被哪些非合并提交改过」。
 *
 * 返回的清单按 git 的日志序（新 → 旧），与逐文件 `git log -- <file>` 同序，
 * 因此调用方的「命中哪一版」取法不变。
 *
 * @param {(args: string[], input?: string) => (string | null)} run 跑一条 git 命令，失败回 null
 * @param {{ref: string, files: string[]}} scope 遍历上界与要盯的文件
 * @returns {Map<string, string[]> | null} 每个文件一条候选历史；`null` = 遍历没跑起来
 */
export function historyByFile(run, { ref, files }) {
  /** @type {Map<string, string[]>} */
  const map = new Map(files.map((f) => [f, /** @type {string[]} */ ([])]));
  if (files.length === 0) return map;

  const raw = run(["log", "--format=@%H", "--name-only", "--no-merges", ref]);
  if (raw === null) return null;

  const set = new Set(files);
  let cur = null;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const marker = COMMIT_LINE.exec(line);
    if (marker) {
      cur = marker[1];
      continue;
    }
    if (cur && set.has(line)) {
      const bucket = map.get(line);
      if (bucket) bucket.push(cur);
    }
  }
  return map;
}
