#!/usr/bin/env node
/**
 * reformat-scan-core.mjs — 「格式化提交分离」的**取数件**（git 侧，ISSUE #3035 拆出）。
 *
 * ── 为什么单独一份模块 ────────────────────────────────────────────────
 *
 * `check-reformat-only.cjs` 加上合并行的取数与读数后越过 900 行硬闸（§12.6 R5 /
 * `check-infra-file-size.cjs`），而这一组 git 取数件是文件里**自包含**的一块：
 * 只依赖一个 `root`（cwd 绑定）与 node 内置，不碰 oxfmt、不打印判决行 ——
 * 拆的是职责，不是行数，搬走之后两边的判据都不动（与 `reformat-per-commit.mjs`
 * 同一条理由）。它们同时以 `perCommitDeps` 的形态注入机制层（§18.4：内核不
 * 反过来依赖执行者）—— 这里就是那份注入的**唯一出处**。
 *
 * @module scripts/reformat-scan-core — 判据取数件（git 差分 / 配对 / 区间解析）
 */
import { execFileSync } from "node:child_process";

/**
 * 造一套绑定到 `root` 的 git 取数件。
 *
 * 为什么是工厂而不是散函数：`git` 必须**显式给 cwd**——不给的话 git 会沿
 * 「脚本所在进程」的 cwd 向上找仓库，于是门禁检查的是**调用者所在的仓库**而不是
 * 被检查的那个 —— 在临时仓库里复跑时表现为「看了另一个仓库的历史」，判定结果
 * 与现场无关。
 *
 * @param {string} root 被检查的仓库根
 * @param {RegExp} sourceRe 判据认的源文件扩展名（与入口的 `SOURCE_RE` 同一份）
 * @returns {{
 *   git: (args: string[]) => string,
 *   gitOrEmpty: (args: string[]) => string,
 *   collectChangedFiles: (patch: string) => Array<{before: string, after: string}>,
 *   collectPairs: (
 *     files: Array<{before: string, after: string}>,
 *     beforeRev: string,
 *     readAfter: (f: {before: string, after: string}) => string,
 *   ) => Array<{file: string, before: string, after: string}>,
 * }}
 */
export function makeScanFns(root, sourceRe) {
  /**
   * 跑一条 git；失败抛错（`gitOrEmpty` 捕获，或按需另行处理）。
   *
   * @param {string[]} args git 参数
   * @returns {string} stdout（trim 后）
   */
  function git(args) {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // 「对象不存在」是可预期的跳过分支,git 的 `fatal:` 不该冒充门禁的失败输出。
      stdio: ["ignore", "pipe", "ignore"],
    });
  }
  /**
   * 跑一条 git；取不到回**空串**。
   *
   * 「取不到」是**预期分支**而不是异常:新增文件在 HEAD 里本就不存在,
   * `git show HEAD:<新文件>` 会以非零码退出。默认实现会把它连同 git 自己的
   * `fatal: path ... does not exist in 'HEAD'` 一起打到 stderr —— 那种输出
   * 看起来像门禁自己崩了,会诱导人去排查一个正常的跳过分支。
   * 所以这里显式吞掉子进程输出,只保留「拿不到 = 空串」这一条语义。
   *
   * ⚠️ 只用于「空串是合法读数」的调用点；要区分「没读到」的（合并行的
   * 祖先探测、正文表）用 `runGit` 那一形（`null` ≠ 空串）。
   *
   * @param {string[]} args git 参数
   * @returns {string}
   */
  function gitOrEmpty(args) {
    try {
      return git(args);
    } catch {
      return "";
    }
  }

  /**
   * 从补丁里挑出「有内容增删」的源文件,并给出它们的改动前 / 改动后路径。
   *
   * 只看 `diff --git` 头:补丁体对「有没有真的改这个文件」不敏感(重命名、
   * 只改权限都会出现 hunk 头),而在文件头判定更直接。
   *
   * @param {string} patch `git diff --unified=0` 的输出
   * @returns {Array<{before: string, after: string}>}
   */
  function collectChangedFiles(patch) {
    const out = [];
    for (const line of patch.split("\n")) {
      if (!line.startsWith("diff --git ")) {
        continue;
      }
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (!m) {
        continue;
      }
      const [, before = "", after = ""] = m;
      if (!sourceRe.test(after)) {
        continue;
      }
      out.push({ before, after });
    }
    return out;
  }

  /**
   * 收集「建议比对」的一批文件:两侧内容都取得到(新增 / 删除 / 改名不判定 ——
   * 本门禁只判「既有的文件被重排」)。
   *
   * `beforeRev` 是改动前的版本;`after` 的取法由调用方决定(某个 rev 或 index)。
   *
   * @param {Array<{before: string, after: string}>} files 改动文件清单
   * @param {string} beforeRev 改动前的那一版
   * @param {(f: {before: string, after: string}) => string} readAfter 改动后内容的取法
   * @returns {Array<{file: string, before: string, after: string}>}
   */
  function collectPairs(files, beforeRev, readAfter) {
    const out = [];
    for (const f of files) {
      const before = gitOrEmpty(["show", `${beforeRev}:${f.after}`]);
      const after = readAfter(f);
      if (!before || !after) {
        continue;
      }
      out.push({ file: f.after, before, after });
    }
    return out;
  }

  return { git, gitOrEmpty, collectChangedFiles, collectPairs };
}

/**
 * 把 `--range` 的两种写法拆成两侧：两点（`A..B`）与三点（`A...B`）。
 *
 * 三点的语义是「**分叉点**..B」（`git diff A...B` = `git diff $(git merge-base A B) B`），
 * 而 `git show <侧>:<路径>` 只能吃一条 rev —— 所以拿它去取「改动后的内容」之前，
 * 必须先把分叉点算出来。**不能按 `".."` 裸切**：`A...B` 切出来是 `["A", ".B"]`，
 * 于是每一份文件的「改动后」都取不到、判据静默退化成「本批没有纯格式化」
 * （ISSUE #3024，现场是平台 `重档静态判据` 那一格）。
 *
 * @param {string} range `--range` 的值
 * @returns {{before: string, after: string, dots: string} | null} 解析不出给 `null`
 */
export function parseRange(range) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 实参源自 --range 命令行参数，类型按 string 标窄
  const trimmed = String(range ?? "").trim();
  const three = /^(.*?)\.\.\.(.*)$/.exec(trimmed);
  if (three) {
    const [, beforeRaw = "", afterRaw = ""] = three;
    const after = afterRaw === "" ? "HEAD" : afterRaw;
    if (beforeRaw === "") {
      return null;
    }
    return { before: beforeRaw, after, dots: "..." };
  }
  const two = /^(.*?)\.\.(.*)$/.exec(trimmed);
  if (!two) {
    return null;
  }
  const [, beforeRaw = "", afterRaw = ""] = two;
  if (beforeRaw === "") {
    return null;
  }
  return { before: beforeRaw, after: afterRaw === "" ? "HEAD" : afterRaw, dots: ".." };
}

/**
 * 判决面参数的**唯一解析处**（ISSUE #3163）。认识的只有三个：`--staged`（收窄）、
 * `--strict`（阈值降为 1）、`--range <before>..<after>`。
 *
 * 不认识的旗标 / 缺取值的 `--range` 都记成问题，由 `faceArgRefusal()` 念清「实际
 * 判的是哪个面」后以 **2** 退出（2 = 没有给出结论，不是「判红」）。旧行为是静默
 * 忽略：传 `--base` 时判据照样按暂存区 / `HEAD` 给一句干净的 `[ok]` —— 判决面在
 * 没人说话的情况下换了，而屏幕上看不出来。现有调用方逐处核过（`package.json` 的
 * `format:reformat-guard` 不带旗标、钩子只传 `--staged`、`ci-heavy-gates.mjs` 换发
 * `--range <值>`），没有一处传未知旗标，所以这一档收紧不会误伤。
 *
 * @param {string[]} args `process.argv.slice(2)`
 * @returns {{unknown: string[], rangeMissing: boolean, range: string | null, strict: boolean}}
 */
export function parseFaceArgs(args) {
  const unknown = [];
  let rangeMissing = false;
  let range = null;
  let strict = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    /* `noUncheckedIndexedAccess` 下索引访问可能是 undefined；`args` 来自 argv，
     * 理论上不会有空位，留一行收窄即可。 */
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === "--staged") {
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--range") {
      const value = args[i + 1];
      /* 缺值 / 下一项是另一个旗标 ⇒ 不消费它，让它按自己的旗标判（`--range --strict`
       * 于是同时报「缺值」与保留 `--strict`）。 */
      if (typeof value !== "string" || value === "" || value.startsWith("-")) {
        rangeMissing = true;
        continue;
      }
      range = value;
      i += 1;
      continue;
    }
    unknown.push(arg);
  }
  return { unknown, rangeMissing, range, strict };
}

/**
 * 把 `parseFaceArgs()` 记下的问题变成一段自证的拒绝话术；没有问题回 `null`。
 *
 * 三件必须都在：① 哪个旗标/参数不认识（或 `--range` 缺了什么）；② **当前实际判决面**
 * 是什么；③ 怎么传才叫对。只写「invalid flag」等于让下一个人继续猜。
 *
 * @param {ReturnType<typeof parseFaceArgs>} parsed
 * @returns {string | null}
 */
export function faceArgRefusal(parsed) {
  const problems = [];
  if (parsed.rangeMissing) {
    problems.push("「--range」缺少取值（未被识别为有效参数）");
  }
  if (parsed.range !== null && parseRange(parsed.range) === null) {
    problems.push(`「--range」的取值「${parsed.range}」解析不成区间（要 <before>..<after>）`);
  }
  for (const arg of parsed.unknown) {
    problems.push(`收到不认识的${arg.startsWith("-") ? "旗标" : "参数"}「${arg}」（未被识别）`);
  }
  if (problems.length === 0) {
    return null;
  }
  let face = "暂存区（无暂存改动时回落 HEAD 这一次提交）";
  if (parsed.range !== null) {
    face =
      parseRange(parsed.range) === null
        ? "（无法确定：--range 的取值解析不成区间）"
        : `--range ${parsed.range}（改动前取起点、改动后取终点）`;
  }
  return [
    ...problems.map((problem) => `[reformat] ${problem}`),
    `[reformat] 当前实际判决面：${face}`,
    "[reformat] 合法写法：node scripts/check-reformat-only.cjs [--staged] [--strict] [--range <before>..<after>]",
    "[reformat] 例：node scripts/check-reformat-only.cjs --range origin/master..HEAD",
    "[reformat] 判据面不确定 ⇒ 不给结论（exit 2，不是「判红」）。ISSUE #3163",
  ].join("\n");
}
