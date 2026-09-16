#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:格式化提交必须与行为改动分离(供 pre-commit 与 CI 调用)
/**
 * 格式化提交与行为改动分离 —— 规范见 docs/standards/13-提交与-code-review.md §13.5。
 *
 * 背景(ISSUE #575 第 9 项 / 存量 576 个文件未过 prettier):
 * 格式门禁走**棘轮**(scripts/check-format.cjs)而不是「一次性全库格式化」,原因是
 * 后者会产出与功能无关的全文件 diff(违反 §13.7)。但只要存量还没清完,
 * 「顺手全库 format:write」就始终是一个高效但破坏性极强的动作 —— 它把一次真实
 * 改动埋在几百个文件的重排里,`git blame` 当场失效,评审无法从 diff 里看出改了什么。
 *
 * 本门禁判**这次提交的形态**,不判格式本身:
 *   ① 某文件在本次提交里**只被重新格式化**(改动前的内容过一遍 prettier 就逐字
 *      变成改动后的内容)→ 记为一个「纯格式化文件」;
 *   ② 纯格式化文件数 ≥ 阈值 → 阻断,并给出可照抄的补救命令(拆成两次提交)。
 *
 * 判据为什么是「把改动前的整份文件交给 prettier 重排,看是否逐字等于改动后」:
 *
 *   · 这是「纯格式化」的**权威定义** —— 格式化 = 跑一次 formatter、内容不变。
 *     任何绕过 formatter 的近似都会有漏报,实测踩到过两档:
 *     (a) prettier 的**重新断行**(超宽对象字面量拆成多行、多行表达式合并回一行);
 *     (b) `prettier-plugin-tailwindcss` 的**类名重排**(`mt-1 text-sm` →
 *         `text-sm mt-1`)—— 它既不是空白差异也不是标点差异,抹空白比对看不见。
 *     用真实 formatter 当判据,这两档自动覆盖,而且用的是 devDependencies 里
 *     同一个 prettier(版本不会与 format:check 漂移)。
 *
 *   · **必须比整份文件,不能比 diff 片段**:`git diff` 给的是 hunk 上下文,
 *     单独交给 prettier 会 `SyntaxError`(实测:`<p className=...>` 片段报
 *     `'>' expected`)—— 那样每个文件都会「无法判定」,门禁静默失效。
 *     所以这里用 `git show <rev>:<path>` 取改动前/后的**整份文件**再比。
 *     取整份文件还有一个好处:缩进深度、import 排序等**跨行**排版决策才成立。
 *
 *   · 判据是**保守**的:prettier 重排后只要有一个字符不同就当成真实改动 ——
 *     宁可漏报(放行一次没拆开的提交)也不误伤(把真实改动判成格式化而阻断)。
 *     文件名以 `-M` 检出改名的场景不做判定(路径取不到就跳过该文件)。
 *
 * 阈值取 10 而不是 1:改一行时顺手格式化同文件是正常操作,拦在 1 会让门禁变成
 * 「每次提交都要拆两次」的噪声源 —— 那样的门禁活不过一周。10 个以上文件同时
 * 「只动格式」已经不是顺手,而是一次全库/全目录格式化。
 *
 * 为什么 CI 也要跑:squash 合并后 master 上只剩一个提交,「拆成两次提交」在本地
 * 不做就再没有机会补,而它造成的后果(blame 失真)是永久性的。
 *
 * **pre-commit 看的是「暂存区」，不是 HEAD**：这个脚本接在 `.githooks/pre-commit`
 * 里,而 pre-commit 在提交对象生成**之前**运行 —— 此时 `HEAD` 仍是上一次提交。
 * 早先的实现无条件取 `HEAD~1..HEAD`,于是它判的其实是**上一次提交**：本次暂存内容
 * 一个都没参与,而只要上一次恰好是格式化提交(例如 master 上的存量治理),门禁就会
 * 把那次已合并的提交当成「本次」拦下,后续每个提交都过不去。
 * 所以默认口径改为「有暂存改动就判暂存区,否则判 HEAD 这一次提交」——
 * CI(`--range`)与本地盘点的行为都不变,pre-commit 拿到的是它真正该看的东西。
 *
 * 用法:
 *   node scripts/check-reformat-only.cjs            # 判暂存区；无暂存改动则判 HEAD
 *   node scripts/check-reformat-only.cjs --range A..B
 *   node scripts/check-reformat-only.cjs --strict   # 阈值降为 1(排查/盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
// pnpm 可执行形态的唯一判据（scripts/launcher-core/shell.mjs 的 runPnpmSync）。
// 这里曾是**第二份**平台判据（`process.platform === "win32" ? "pnpm.cmd" : "pnpm"`）：
// Windows 上批处理 Node 起不来（EINVAL），一旦走到这一档，「纯格式化」判定就对每个
// 文件退回「无法判定」—— 门禁一声不吭地失效（ISSUE #638 同族）。
// 判据模块是 ESM，.cjs 只能动态 import()，故声明为惰性句柄、由 main 先加载。
let runPnpmSync = null;
async function loadShell() {
  if (runPnpmSync) return runPnpmSync;
  try {
    ({ runPnpmSync } = await import("./launcher-core/shell.mjs"));
  } catch (e) {
    console.error(
      `[reformat] 无法加载 pnpm 形态判据模块（scripts/launcher-core/shell.mjs）：${e.message}`,
    );
    process.exit(2);
  }
  return runPnpmSync;
}

/* git 按 cwd 解析仓库(与 check-circular-deps.cjs 同口径):门禁在仓库根被调用。
 * prettier 则按**脚本自身所在仓库**解析 —— 见 formatFile 的注释。 */
const ROOT = process.cwd();

/** 脚本自身所在仓库根:用来定位 prettier 依赖(与「被检查的仓库」可以是两个)。 */
const HERE = path.resolve(__dirname, "..");

/** 触发阻断的纯格式化文件数(见文件头注释:1 会变成噪声源)。 */
const LIMIT = 10;

/** 只看这些扩展名:其余(图片、锁文件)不参与格式判定。 */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|mdx)$/;

function git(args) {
  // 必须显式给 cwd：不给的话 git 会沿「脚本所在进程」的 cwd 向上找仓库，
  // 于是门禁检查的是**调用者所在的仓库**而不是被检查的那个 —— 在临时仓库里
  // 复跑时表现为「看了另一个仓库的历史」，判定结果与现场无关。
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // 「对象不存在」是可预期的跳过分支,git 的 `fatal:` 不该冒充门禁的失败输出。
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function gitOrEmpty(args) {
  try {
    return git(args);
  } catch {
    /* 「取不到」是**预期分支**而不是异常:新增文件在 HEAD 里本就不存在,
     * `git show HEAD:<新文件>` 会以非零码退出。默认实现会把它连同 git 自己的
     * `fatal: path ... does not exist in 'HEAD'` 一起打到 stderr —— 那种输出
     * 看起来像门禁自己崩了,会诱导人去排查一个正常的跳过分支。
     * 所以这里显式吞掉子进程输出,只保留「拿不到 = 空串」这一条语义。 */
    return "";
  }
}

/**
 * 从补丁里挑出「有内容增删」的源文件,并给出它们的改动前 / 改动后路径。
 *
 * 只看 `diff --git` 头:补丁体对「有没有真的改这个文件」不敏感(重命名、
 * 只改权限都会出现 hunk 头),而在文件头判定更直接。
 */
function collectChangedFiles(patch) {
  const out = [];
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!m) continue;
    const [, before, after] = m;
    if (!SOURCE_RE.test(after)) continue;
    out.push({ before, after });
  }
  return out;
}

/**
 * 用 prettier 重排整份文件,返回规范形态;prettier 跑不起来时返回 null。
 *
 * **不能带 `--cache`**:prettier 明确拒绝「stdin + cache」的组合
 * (`--cache cannot be used when formatting stdin`),带上去会拿到空输出 ——
 * 那种失败看起来像「这个文件不是格式化出来的」(每个文件都判成真实改动),
 * 于是整条门禁一声不吭地失效。这里逐次调用、不缓存。
 *
 * **prettier 从脚本自身所在仓库解析**(`HERE`),不是从 cwd:门禁被
 * `tests/check-reformat-only.test.ts` 在**临时仓库**里复跑(那里的 cwd 没有
 * node_modules),而真实 CI / pre-commit 里两者恰好重合。用 `pnpm exec` 会让
 * 「被检查的仓库」与「提供 prettier 的仓库」绑死 —— 临时仓库里直接拿不到
 * prettier,每个文件都退回「无法判定」,门禁静默失效。改为直接执行仓库内的
 * prettier 入口(`require.resolve`),与 cwd 解耦。
 */
let runner = undefined;

/**
 * 找一个能跑 prettier 的入口。
 *
 * 从**脚本所在目录开始向上找**（`node_modules` 的常规解析方式），找到就用仓库
 * 内的 prettier；一路到根都没有时退回 `pnpm exec prettier`。
 *
 * 为什么不能只靠 cwd 或 `pnpm exec`：门禁会被 `tests/check-reformat-only.test.ts`
 * 在**临时仓库**里复跑（脚本被拷进去、cwd 也在那里），而 prettier 与它的插件装在
 * **源码仓库**的 node_modules 里 —— 临时仓库一个都没有。这时 `pnpm exec` 会直接
 * 报「Command "prettier" not found」，`formatFile` 对每个文件都返回 null，
 * 于是所有文件都判成「不是格式化」：门禁一声不吭地失效（本仓库最忌讳的失败形态）。
 * 向上找 + 兜底解析让两种情况都能跑起来：CI / pre-commit 命中第一档（就是本仓库），
 * 复跑场景命中第二档（上溯到源码仓库）。
 */
function resolveRunner() {
  if (runner !== undefined) return runner;

  const candidates = [path.dirname(__dirname), __dirname];
  let dir = path.dirname(__dirname);
  for (;;) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  runner = null;
  for (const base of candidates) {
    try {
      runner = {
        kind: "entry",
        entry: require.resolve("prettier/bin/prettier.cjs", { paths: [base] }),
        cwd: base,
      };
      break;
    } catch {
      /* 换下一个基准目录 */
    }
  }
  if (runner === null) runner = { kind: "pnpm", cwd: HERE };
  return runner;
}

function formatFile(text, file) {
  const r = resolveRunner();
  const ext = path.extname(file).slice(1);
  const args =
    r.kind === "entry"
      ? [r.entry, "--stdin-filepath", `probe.${ext}`]
      : ["exec", "prettier", "--stdin-filepath", `probe.${ext}`];
  // 两档都经同一处判据：`entry` 档起的是当前 Node 运行时（跨平台无分支），
  // 兜底档起的是 pnpm —— 后者必须复用 runPnpmSync，不许自己拼可执行名。
  const res =
    r.kind === "entry"
      ? spawnSync(process.execPath, args, {
          cwd: r.cwd,
          input: text,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        })
      : runPnpmSync(args, { cwd: r.cwd, timeoutMs: 600_000 });
  if (res.error || typeof res.stdout !== "string" || res.status !== 0)
    return null;
  return res.stdout;
}

/**
 * 判断 `before` 版本的文件是否「过一遍 prettier 就变成 after 版本」。
 *
 * 两侧都按行尾归一化后比较:prettier 会按配置统一行尾,而仓库里混有 CRLF 的
 * 历史文件(§13.7)—— 把行尾算成差异会让这些文件永远判成「真实改动」。
 */
function isReformatOnly(beforeRev, afterRev, file) {
  const before = gitOrEmpty(["show", `${beforeRev}:${file}`]);
  const after = gitOrEmpty(["show", `${afterRev}:${file}`]);
  return compareReformatted(before, after, file);
}

/** 判据本体(与「内容从哪来」解耦):`before` 过一遍 prettier 是否逐字变成 `after`。 */
function compareReformatted(before, after, file) {
  // 任一侧取不到(新增 / 删除 / 改名)→ 不判定:本门禁只判「既有的文件被重排」。
  if (!before || !after) return false;

  const formatted = formatFile(before, file);
  if (formatted === null) return false;

  const norm = (s) => s.replace(/\r\n/g, "\n").trimEnd();
  return norm(formatted) === norm(after);
}

/**
 * 暂存区口径:改动前取 `HEAD:<path>`,改动后取 `:<path>`(index)。
 * 新增文件在 HEAD 里不存在 → 任一侧为空即跳过(纯新增不是「重排既有文件」)。
 */
function isStagedReformatOnly(headRev, file) {
  const before = gitOrEmpty(["show", `${headRev}:${file}`]);
  const after = gitOrEmpty(["show", `:${file}`]);
  return compareReformatted(before, after, file);
}

async function main() {
  await loadShell();
  /* **合并提交豁免**：合并会把上游整批（含它们在别处做的格式化）一次性带进来，
   *  「拆成两次提交」在这里不是可选动作 —— 上游的形态已经定死在历史里，本地
   *  无法把一次 merge 的重排与行为改动分开。判据取 `MERGE_HEAD` 是否存在：
   *  pre-commit 在合并提交对象生成**之前**运行，此时 `.git/MERGE_HEAD` 由
   *  `git merge` 写入、合并完成后删除，正是「本次提交是合并提交」的唯一事实源。
   *  仅当**没有**走 `--range`（CI 盘点按范围判，与合并现场无关）时豁免。 */
  const mergeHeadPresent = fs.existsSync(path.join(ROOT, ".git", "MERGE_HEAD"));
  if (!process.argv.includes("--range") && mergeHeadPresent) {
    console.log(
      "[reformat] 合并提交（MERGE_HEAD 存在），跳过「格式化与行为改动分离」判定",
    );
    return;
  }

  const args = process.argv.slice(2);
  const limit = args.includes("--strict") ? 1 : LIMIT;
  const rangeIdx = args.indexOf("--range");
  const range = rangeIdx >= 0 ? args[rangeIdx + 1] : null;

  /* 默认口径(无 --range):**优先判暂存区**。
   * pre-commit 在提交对象生成之前运行,`HEAD~1..HEAD` 指向的是上一次提交 ——
   * 判它等于本次提交完全没被检查(见文件头)。`git diff --cached` 正是「本次将要
   * 提交的内容」,且它的 diff 基线是 HEAD,与 `git show HEAD:<path>` 天然对齐。 */
  const staged = range
    ? ""
    : gitOrEmpty(["diff", "--cached", "--no-color", "--unified=0"]);

  if (!range && !staged.trim()) {
    /* 没有暂存改动:回落到「判 HEAD 这一次提交」(本地事后复盘 / CI 之外的用法)。
     * 此时基准是 HEAD~1,与改动前版本一致。 */
    const [afterRev, beforeRev] = ["HEAD", "HEAD~1"];
    if (
      gitOrEmpty(["rev-parse", "--verify", "--quiet", beforeRev]).trim() === ""
    ) {
      console.log(
        `[reformat] 无可比父提交（${beforeRev} 不存在，首次提交或浅克隆），跳过`,
      );
      return;
    }
    const patch = gitOrEmpty([
      "diff",
      "--no-color",
      "--unified=0",
      `${beforeRev}..${afterRev}`,
    ]);
    if (!patch.trim()) {
      console.log("[reformat] 本次提交没有文件改动，跳过");
      return;
    }
    const files = collectChangedFiles(patch);
    const reformatOnly = files.filter((f) =>
      isReformatOnly(beforeRev, afterRev, f.after),
    );
    report(files, reformatOnly, limit);
    return;
  }

  const [afterRev, beforeRev] = range
    ? (() => {
        const [a, b] = range.split("..");
        return [b, a];
      })()
    : ["HEAD", "HEAD"];

  if (
    range &&
    gitOrEmpty(["rev-parse", "--verify", "--quiet", beforeRev]).trim() === ""
  ) {
    console.log(
      `[reformat] 无可比父提交（${beforeRev} 不存在，首次提交或浅克隆），跳过`,
    );
    return;
  }

  const patch = range
    ? gitOrEmpty([
        "diff",
        "--no-color",
        "--unified=0",
        `${beforeRev}..${afterRev}`,
      ])
    : staged;

  if (!patch.trim()) {
    console.log("[reformat] 本次提交没有文件改动，跳过");
    return;
  }

  /* 暂存区口径下,「改动后」的内容在 index 里而不是某个 rev —— 新增文件的
   * 改动前版本不存在(该文件在 HEAD 里没有),所以用空串表示,由 isReformatOnly
   * 按「任一侧取不到就不判定」跳过(纯新增不算格式化)。 */
  const files = collectChangedFiles(patch);
  const reformatOnly = files.filter((f) =>
    isStagedReformatOnly(beforeRev, f.after),
  );

  report(files, reformatOnly, limit);
}

/** 输出结论并按阈值决定是否阻断(两个口径共用,避免两份会各自漂移的判定)。 */
function report(files, reformatOnly, limit) {
  console.log(
    `[reformat] 本次提交改动 ${files.length} 个源文件，其中纯格式化 ${reformatOnly.length} 个（阈值 ${limit}）`,
  );

  if (reformatOnly.length >= limit) {
    console.error(
      `\n[reformat] 本次提交混入了 ${reformatOnly.length} 个「只改格式」的文件（规范 §13.5）:\n` +
        reformatOnly
          .slice(0, 20)
          .map((f) => `  · ${f.after}`)
          .join("\n") +
        (reformatOnly.length > 20
          ? `\n  … 其余 ${reformatOnly.length - 20} 个省略`
          : "") +
        "\n\n  为什么拦:格式化 diff 会把真实的功能改动埋掉 —— `git blame` 失效," +
        "\n  评审也无法从 diff 里看出改了什么（§13.7 的提交噪声口径）。" +
        "\n\n  修法:拆成两次提交。" +
        "\n    git reset --soft HEAD~1" +
        "\n    git restore --staged ." +
        '\n    git add <仅功能相关的文件> && git commit -m "fix(scope): <本次改动>"' +
        "\n    # 用 pnpm exec prettier --write <文件> 格式化（别对全库跑 format:write）" +
        '\n    git add -A && git commit -m "style: 格式化 <范围>"' +
        "\n\n  若确实要一次性格式化某批文件（清理存量），那就**单独一个提交/PR**做它 ——" +
        "\n  存量清掉后记得 node scripts/check-format.cjs --update 收紧格式棘轮。",
    );
    process.exit(1);
  }

  if (reformatOnly.length > 0) {
    console.log(
      `  （未达阈值，放行）${reformatOnly
        .slice(0, 5)
        .map((f) => f.after)
        .join(", ")}` + (reformatOnly.length > 5 ? " …" : ""),
    );
  }
  console.log("[reformat] OK");
}

if (require.main === module) main();

/** 供测试直接引用:纯判定函数（不执行 git / prettier）。 */
module.exports = { collectChangedFiles, compareReformatted, LIMIT, SOURCE_RE };
