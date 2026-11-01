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
 * 用法示例：node scripts/check-reformat-only.cjs --range A..B
 *   node scripts/check-reformat-only.cjs --strict   # 阈值降为 1(排查/盘点用)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
// pnpm 可执行形态的唯一判据（scripts/launcher-core/shell.mjs 的 runPnpmSync）。
// 这里曾是**第二份**平台判据（`process.platform === "win32" ? "pnpm.cmd" : "pnpm"`）：
// Windows 上批处理 Node 起不来（EINVAL），一旦走到这一档，「纯格式化」判定就对每个
// 文件退回「无法判定」—— 门禁一声不吭地失效（ISSUE #638 同族）。
// 判据模块是 ESM，.cjs 只能动态 import()，故声明为惰性句柄、由 main 先加载。
let runPnpmSync = null;
async function loadShell() {
  if (runPnpmSync) {
    return runPnpmSync;
  }
  try {
    ({ runPnpmSync } = await import("./launcher-core/shell.mjs"));
  } catch (error) {
    console.error(
      `[reformat] 无法加载 pnpm 形态判据模块（scripts/launcher-core/shell.mjs）：${error.message}`,
    );
    process.exit(2);
  }
  return runPnpmSync;
}

const { discernRoots } = require("./gate-scan-read.cjs");
const { gateFail, gatePass, gateSkip, indentItems } = require("./ci-log.mjs");
/* 逐提交护栏（护栏 ②）的**机制层**（`reformat-per-commit.mjs`）：它按**职责**切出去
 * —— 取数与判定在那边，判决话术与三态出口仍在本文件（`report()`）。 */
const { perCommitShape, perCommitShapeOf } = require("./reformat-per-commit.mjs");

/* git 按 cwd 解析仓库(与 check-circular-deps.cjs 同口径):门禁在仓库根被调用。
 * prettier 则按**脚本自身所在仓库**解析 —— 见 formatFile 的注释。 */
const ROOT = process.cwd();

/**
 * `--staged`：暂存改动一点都没落在判据要看的面上时跳过（ISSUE #1993）。
 *
 * 这条判据看的是「本次提交改了哪些源文件」，而它在**只改文档 / 只改 `changelog.d/`** 的
 * 提交上一份源文件都列不出来 —— 于是它每次都在那里把暂存区与 `HEAD` 各取一遍、
 * 对每个文件跑一次 prettier，得到的结论恒为「没有文件改动，跳过」。
 *
 * 收窄的判据与其它门禁**共用同一份**（`gate-scan-read.cjs` 的 `skipUnlessStagedTouches`）：
 * 扫描面 = `SOURCE_RE` 认的那些扩展名，也就是这条判据真正会判的那批文件。
 * 口径三条：**有 `--range` 时一律不跳**（它按显式范围判，与暂存区无关）；
 * **拿不到暂存清单 ⇒ 不跳**（`skipUnlessStagedTouches` 走 fail-closed，exit 2）；
 * **「面上有源文件」照旧全跑** —— 收窄的只是「一份都不可能判」的那几类提交。
 */
const STAGED_GATE = process.argv.includes("--staged");

/** 脚本自身所在仓库根:用来定位 prettier 依赖(与「被检查的仓库」可以是两个)。 */
const HERE = path.resolve(__dirname, "..");

/** 触发阻断的纯格式化文件数(见文件头注释:1 会变成噪声源)。 */
const LIMIT = 10;

/** 迁移声明的尾注:`format-migration: <一句话说明>`(写在提交正文里)。 */
const MIGRATION_RE = /^format-migration:/m;

/**
 * 逐提交护栏要的那几件事实 —— **注入而不是让那边 import 本文件**：机制层不该反过来
 * 依赖判据的执行者（§18.4：内核里不放业务语义，取数件由入口注入）。
 */
const perCommitDeps = {
  limit: LIMIT,
  collectChangedFiles,
  collectPairs,
  classifyReformatOnly,
  gitOrEmpty,
};

/**
 * 「格式化迁移」声明:区间里**每一个**提交的正文都带 `format-migration:` 尾注。
 *
 * 为什么需要这一扇门:换格式化器时(2026-10-28 prettier → oxfmt),格式判据是**硬闸
 * 且没有基线** ⇒ 全量重排必须**和切换同批**落地;而本判据的阈值(10)又会拦住同批里
 * 的重排 —— 两条硬闸互锁,迁移没有可落地的形状。于是给迁移一条**显式的、一次性的**
 * 声明:声明了就按「这是一次格式化器迁移」读,不阻断,但清单照打、读数照报(可审计)。
 *
 * 两道护栏(不许拿它当万能钥匙):
 *   ① 区间里**每个**提交都要声明(漏一个就不认 —— 迁移是整件事的性质,不是某一笔的);
 *   ② 区间里**每个**提交本身都满足「重排独占」:要么纯格式化不到阈值(顺手那几份),
 *      要么这一条提交**整条都是重排**(`reformatOnly.size === files.length`)。
 * 想借声明把重排与功能改动埋进同一条提交,第 ② 关会把你拦回 `gateFail` 那一支
 * (这里不留「占比 90% 就放行」那种缝 —— 那条缝等于允许每 10 份重排夹带 1 份功能改动)。
 */
function migrationDeclaration(revRange) {
  /* `--no-merges`:平台侧跑的是**合并预览**(HEAD 是合并提交),而合并提交那一条
   * 自动生成的正文不会带尾注 —— 把它算进「每个提交都要声明」等于这条门在 CI 上
   * 永远不成立。合并提交本来就是本门禁豁免的那一档(见 `perCommitShape` 的头注)。*/
  const bodies = gitOrEmpty(["log", "--no-merges", "--format=%B%x00", revRange]);
  const commits = bodies
    .split("\0")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!commits.length) {
    return { declared: false, commits: 0 };
  }
  return { declared: commits.every((b) => MIGRATION_RE.test(b)), commits: commits.length };
}

/**
 * 护栏 ② 的取数:区间里**逐提交**各判一遍「纯格式化占多少」。
 *
 * 为什么只按「每条提交各自的形态」判:换格式化器那一笔本身要改判据脚本、文档、
 * 依赖清单 —— 它们**不是**纯格式化,却必须和重排同批落地(格式判据是硬闸且无基线)。
 * 若按区间汇总取「占比」,这些文件进分母把占比稀释(实测 32 份重排 / 56 份源文件
 * = 57%),于是「重排独占一条」这种**正确形态**反而被自己的护栏拦死 —— 那正是
 * 这道门要解的互锁,不能换一副样子又锁回去。判「每个提交各自干不干净」才是这件事
 * 的真形状:重排独占的提交整条都是重排,迁移那一笔的重排量又在阈值以下,两边都干净。
 *
 * 成本按提交数线性叠加(每个提交一次 oxfmt 批量调用),只在**命中阈值**时才付 ——
 * 未命中的区间根本走不到这里。
 *
 * **合并提交不进这一张表**:平台侧那条流水线跑的是**合并预览**(HEAD 是合并提交,
 * `HEAD~1..HEAD` 于是覆盖整个 PR 区间),而合并提交相对第一父提交的 diff 就是整份
 * PR —— 把它算进来等于把汇总又请回分母,护栏 ② 当场自锁。合并提交本来就是本门禁
 * 豁免的那一档(上游形态已定死在历史里,见 `main()` 里 `MERGE_HEAD` 那一支),
 * 所以这里按**父提交数 ≥ 2** 跳过它,只判区间里那些**真有人做了改动**的提交。
 *
 * @param {string} range `A..B` 区间
 * @param {number} limit 触发阈值(与 `LIMIT` 同义,由调用方传,便于按 `--strict` 走)
 * @returns `{{commits: Array<{rev: string, files: number, reformatOnly: number}>, ok: boolean, offenders: string[]}}`
 */
/** 只看这些扩展名:其余(图片、锁文件)不参与格式判定。 */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|mdx)$/;

/**
 * `--staged` 的扫描面（仓库根相对）。
 *
 * 本判据按**扩展名**筛文件（`SOURCE_RE`），而 `skipUnlessStagedTouches()` 按**根前缀**
 * 筛暂存清单（`isUnderAny()` 的语义是 `rel === root || rel.startsWith(root + "/")`，
 * 空串根**不命中任何东西**）—— 所以：
 *
 *   · 顶层**目录**转成 `<dir>/` 根（`src/`、`docs/`、`scripts/` …）；
 *   · 根级**文件名**原样作为根（`package.json`、`README.md` …）—— 只给目录会让它们
 *     落在面外，而它们确实是本判据会判的源文件。
 *
 * ⚠️ 取「宁宽勿窄」：判宽只是少省几秒（多扫一遍 prettier），判窄是**静默漏判**
 * （那一处的纯格式化提交从此不再触发这条判据）。「根清单由仓库现算」也收在一处
 * （`gate-scan-read.cjs` 的 `discernRoots`），不在这里再写一遍 `readdir`。
 *
 * @param {string} [root]
 * @returns {string[]}
 */
function stagedRoots(root = ROOT) {
  /* 尾斜杠**去掉**：`isUnderAny()` 判的是 `rel.startsWith(dir + "/")`，留着 `src/`
   * 会变成 `"src//"`（永不命中）。这一句是整条收窄的对错分界 —— 写错了它，
   * 面上明明有源文件也会被跳过，而读数是「0 个落在 N 条根内」，看着像真的没有。 */
  return discernRoots(root).map((name) => name);
}

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
    if (!line.startsWith("diff --git ")) {
      continue;
    }
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!m) {
      continue;
    }
    const [, before, after] = m;
    if (!SOURCE_RE.test(after)) {
      continue;
    }
    out.push({ before, after });
  }
  return out;
}

/**
 * 批量口径的**硬约束与三档判据边界**(实现见 `formatMany` 与 `formatOne`)。
 *
 * **为什么是「一次 prettier 处理整批文件」而不是逐文件**:
 * prettier 的启动 + 插件加载是主要成本(prettier 与
 * `prettier-plugin-tailwindcss` 各自要跑一遍 ESM 加载,实测单次约 120ms,
 * 与文件大小几乎无关)。逐文件 stdin 在这条门禁上线性叠加:一次改动 12 个
 * 文件 → 约 5s,PR 改了 100 个文件 → 约 40s。真实用户提交的「批量格式化」
 * 提交正好是这种形态,而 CI 的 vitest 默认 testTimeout 是 5s —— 本脚本被
 * `tests/check-reformat-only.test.ts` 以子进程复跑,于是**门禁本身**在 CI 上
 * 偶发超时(现场是 `Test timed out in 5000ms`,看起来像测试写得慢,实际是
 * 每条用例都要起十几个 prettier)。
 *
 * 批量口径必须与逐文件 stdin **等价**,所以不是「就地 --write 原文件」,而是
 * 把「改动前的整份文件」(换行符归一成 LF)写进一个临时目录的文件树、**保持
 * 原文件的相对路径** —— prettier 按路径选 parser,相对路径丢了等于换了一套
 * 判据。
 *
 * **`--write <目录>` 的逐行输出本身就是判据,三档语义各不相同**(prettier
 * 3.x 实测,路径可能被 ANSI 灰化):
 *
 *   | stdout 那一行长什么样       | 真结论                                  |
 *   | --------------------------- | --------------------------------------- |
 *   | `<path> <ms>ms`             | prettier **改写了它** → 规范形态可回读  |
 *   | `<path> <ms>ms (unchanged)` | prettier 看过它、它**本来就规范**       |
 *   | **没有这一行**              | **没有结论**(无 parser / 被忽略跳过)  |
 *
 * 第三档必须退回逐文件 stdin:忽略规则**以 cwd 为根读 `.gitignore`**,命中目录
 * 名时连**显式点名**的路径也一并跳过(`--write <file>` 静默返回空输出、退出码
 * 0),而 stdin 会把内容无条件当成对应扩展名来格式化(它能格式化 `.gitignore`
 * 掉的路径)。实测三档的分别:忽略路径下的 `probe.ts` 在「整目录」与「显式点名」
 * 两档**都没有输出行**,`.foo` 这类没有 parser 的路径同样没有,而 stdin 两档都
 * 给出格式化后的正文。**判据必须以后者为准** —— 仓库里已经有过「忽略路径下的
 * 源码」被格式化一次就判成「只改格式」的先例(#619 合并提交里的
 * `.workbuddy/skills/build-guard/guard.js`,删除于 #623/#636)。
 *
 * 反过来,「没有输出行就一律退回 stdin」才是旧口径真正贵的地方:**实际提交里
 * 绝大多数文件本来就规范**(实测 59 个改动文件里 49 个 `(unchanged)`),它们
 * 全部白跑一次 stdin 兜底 —— 那是 D 组最大头 14.8s 里占 ~13s 的那一段
 * (ISSUE #1610)。把 `(unchanged)` 读成**结论**、只对「真的没有那一行」兜底,
 * 成本就从「改动文件数」降到「prettier 不认识的路径数」(正常提交里是 0)。
 *
 * **不能带 `--cache`**:prettier 明确拒绝「stdin + cache」的组合
 * (`--cache cannot be used when formatting stdin`),带上去会拿到空输出 ——
 * 那种失败看起来像「这个文件不是格式化出来的」(每个文件都判成真实改动),
 * 于是整条门禁一声不吭地失效。这里同样不缓存。
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
 * 从**脚本所在目录开始向上找**(`node_modules` 的常规解析方式),找到就用仓库
 * 内的 prettier;一路到根都没有时退回 `pnpm exec prettier`。
 */
function resolveRunner() {
  if (runner !== undefined) {
    return runner;
  }

  // oxfmt 入口的接缝(与 check-format.cjs 同口径):用例在临时仓库里跑,
  // 那里的 cwd 没有 node_modules,不给这条缝就只能撞「找不到格式化器」。
  const fromEnv = process.env.COMFYAPP_OXFMT_ENTRY;
  if (fromEnv && fs.existsSync(fromEnv)) {
    runner = { kind: "entry", entry: fromEnv, cwd: HERE };
    return runner;
  }

  const candidates = [path.dirname(__dirname), __dirname];
  let dir = path.dirname(__dirname);
  for (;;) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  runner = null;
  for (const base of candidates) {
    try {
      // 取 `oxfmt/package.json` 再拼 bin:直接 resolve `oxfmt/bin/oxfmt` 可能被
      // 包的 `exports` 字段挡住(子路径不导出)。
      const pkg = require.resolve("oxfmt/package.json", { paths: [base] });
      const entry = path.join(path.dirname(pkg), "bin", "oxfmt");
      if (!fs.existsSync(entry)) {
        throw new Error("oxfmt entry missing");
      }
      runner = { kind: "entry", entry, cwd: base };
      break;
    } catch {
      /* 换下一个基准目录 */
    }
  }
  if (runner === null) {
    runner = { kind: "pnpm", cwd: HERE };
  }
  return runner;
}

/** prettier 的调用前缀(入口路径 / 兜底命令),两个口径共用。 */
function runnerPrefix() {
  const r = resolveRunner();
  const cmd = r.kind === "entry" ? process.execPath : "pnpm";
  const head = r.kind === "entry" ? [r.entry] : ["exec", "oxfmt"];
  return { kind: r.kind, cmd, head, cwd: r.cwd };
}

/**
 * 起一次 prettier。两档共用一处出口:
 *   · `entry` 档起的是当前 Node 运行时(跨平台无分支);
 *   · 兜底档起的是 pnpm —— 只能经 `runPnpmSync` 拿可执行形态(判据收在
 *     `launcher-core/shell.mjs`),不许自己拼 `pnpm.cmd` 之类的平台后缀:
 *     Windows 上批处理文件只有 cmd.exe 会解释,Node 起它必 EINVAL,
 *     而这一档的失败形态是**静默**的(每个文件都退回「无法判定」)。
 */
function runOxfmt(args, cwd, input) {
  const { kind, head } = runnerPrefix();
  if (kind === "entry") {
    return spawnSync(process.execPath, [...head, ...args], {
      cwd,
      input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  if (typeof runPnpmSync !== "function") {
    throw new Error("pnpm 形态判据未加载(runPnpmSync 不可用)—— 调用方需先 await loadShell()");
  }
  return runPnpmSync([...head, ...args], {
    cwd,
    timeoutMs: 600_000,
    ...(input === undefined ? {} : { input }),
  });
}

/**
 * 回读比对:分拣出「oxfmt 改写过的」文件,返回 `相对路径 → 规范形态`。
 *
 * 与 prettier 时代的口径**不同**:那时是解析 `--write` 的 stdout,靠行尾的
 * `(unchanged)` 标记区分(没标记 = 改写过);oxfmt 的写盘输出没有这个标记,
 * 于是改为**写盘前留快照、写盘后回读比对正文** —— 判定只依赖文件内容本身,
 * 不再依赖任何格式化器的输出文案(将来再换工具也不会因为文案变一次而漂)。
 *
 * @param {{file: string}[]} entries
 * @param {string} dir 临时目录根
 * @param {Map<string, string>} before 写盘前正文(相对路径 → 内容,已归一化行尾)
 * @returns {Map<string, string>} 被改写文件的 `相对路径 → 规范形态`
 */
function collectRewritten(entries, dir, before) {
  const out = new Map();
  for (const { file } of entries) {
    const after = fs.readFileSync(path.join(dir, file), "utf8");
    if (after !== before.get(file)) {
      out.set(file, after);
    }
  }
  return out;
}

/**
 * 一次 prettier 调用处理整批「改动前的内容」,返回两档判决。
 *
 * 返回:
 *   · `ok: false` —— prettier 整批没跑起来 / 配置写错,**没有结论**,调用方
 *     全部退回 stdin 兜底(退回是把判据降级,不是把它改写成「没格式化」);
 *   · `ok: true` + `rewritten`(被改写文件的 `相对路径 → 规范形态`)+
 *     `settled`(prettier 给过结论的相对路径集合)。
 */
function formatMany(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reformat-ref-"));
  try {
    const before = new Map();
    for (const { file, text } of entries) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // 归一化行尾的理由见文件头那段:副本保持 CRLF 会让每个 CRLF 文件都进
      // 「被改写」,等于把成本又放回去。
      const normalized = text.replaceAll("\r\n", "\n");
      fs.writeFileSync(target, normalized);
      before.set(file, normalized);
    }
    const { cwd } = runnerPrefix();
    // oxfmt 默认就是写盘(不带 `--check` 即写),没有 `--write` / 缓存那一档。
    const res = runOxfmt([dir], cwd);
    if (res.error || res.status !== 0 || typeof res.status !== "number") {
      return { ok: false, rewritten: new Map(), settled: new Set() };
    }
    // 整批退出 0 ⇒ 每个文件都拿到了结论(与 prettier 时代「出现在输出里」同义);
    // 改写与否交给回读比对(见 `collectRewritten` 的口径说明)。
    return {
      ok: true,
      rewritten: collectRewritten(entries, dir, before),
      settled: new Set(entries.map((e) => e.file)),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 逐文件 stdin 兜底:prettier 整批没跑起来,或某个文件**没拿到结论**时用。
 *
 * 它是**判据的一侧**而不只是性能兜底:整批口径下 prettier 自己的筛选(无
 * parser / 自带 ignore 规则)会让一部分文件**根本不出现在输出里**,而 stdin
 * 会把内容无条件当成对应扩展名来格式化 —— 只有这个口径能把「prettier 不认识
 * 它」与「它本来就规范」分开。
 */
function formatOne(text, file) {
  const ext = path.extname(file).slice(1);
  // oxfmt 没有 `--stdin-filepath` 那一档;单文件兜底改为落到临时目录再跑一次 ——
  // 语义与 stdin 同(无条件按扩展名格式化),判定口径不变。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reformat-one-"));
  try {
    const target = path.join(dir, `probe.${ext}`);
    fs.writeFileSync(target, text.replaceAll("\r\n", "\n"));
    const { cwd } = runnerPrefix();
    const res = runOxfmt([dir], cwd);
    if (res.error || res.status !== 0 || typeof res.status !== "number") {
      return null;
    }
    return fs.readFileSync(target, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 判断一批文件里哪些「过一遍 prettier 就变成改动后的内容」。
 *
 * 输入是 `{ file, before, after }`(同一批走一条 prettier 路径,避免每文件一次
 * 启动开销),输出是其中判为纯格式化的文件名集合。
 *
 * 两侧都按行尾归一化后比较:prettier 会按配置统一行尾,而仓库里混有 CRLF 的
 * 历史文件(§13.7)—— 把行尾算成差异会让这些文件永远判成「真实改动」。
 */
function classifyReformatOnly(entries) {
  const norm = (s) => s.replaceAll("\r\n", "\n").trimEnd();
  const pending = entries.filter((e) => e.before && e.after);
  const { ok, rewritten, settled } = formatMany(
    pending.map((e) => ({ file: e.file, text: e.before })),
  );

  const reformatOnly = new Set();
  for (const e of pending) {
    // 兜底只在「prettier 没给过结论」时付:整批没跑起来,或这个文件根本没出现
    // 在输出里(无 parser / 被忽略跳过)。`(unchanged)` 是**结论**(prettier 看过
    // 它、它本来就规范),不是「不知道」—— 把它当成不知道会让绝大多数提交白付
    // 一次 stdin,而 stdin 的答案是确定的「原样」(ISSUE #1610 的那 13s)。
    const known = ok && settled.has(e.file);
    let formatted = known ? rewritten.get(e.file) : undefined;
    if (!known) {
      formatted = formatOne(e.before, e.file) ?? undefined;
    }
    if (formatted === undefined) {
      continue;
    }
    if (norm(formatted) === norm(e.after)) {
      reformatOnly.add(e.file);
    }
  }
  return reformatOnly;
}

/**
 * 收集「建议比对」的一批文件:两侧内容都取得到(新增 / 删除 / 改名不判定 ——
 * 本门禁只判「既有的文件被重排」)。
 *
 * `beforeRev` 是改动前的版本;`after` 的取法由调用方决定(某个 rev 或 index)。
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

/**
 * 合并预览下「本次改动」的基线（ISSUE #3022）。少一件就回 `null`。
 *
 * 平台那一跑**没有暂存区**，于是判据落到「判 HEAD 这一次提交」那一支，而
 * `HEAD~1` 是**第一父** —— 合并预览那一笔的第一父是哪一侧由平台拼法决定
 * （实测现场：第一父 = 本分支侧），于是 `HEAD~1..HEAD` 覆盖**整条主干**带来的
 * 20+ 条提交。它们没有 `format-migration:` 尾注 ⇒ 声明恒 false、护栏 ② 恒
 * 「不干净」，判据红得与本次改动是什么无关（#3022：162 份里 120 份判纯格式化，
 * 而那 120 份没有一份是「顺手全库格式化」）。
 *
 * 成立条件两件：**HEAD 是合并提交**（父提交数 ≥ 2）**且**平台给了目标分支 sha
 * （`CNB_PULL_REQUEST_TARGET_SHA`，与 `changed-scope.mjs` 同一份来源）。
 * 有了它，区间就是「目标 sha..HEAD」= 本 PR 带来的提交 —— 平台合进来的主干那边
 * 本来就以它为起点，不在区间里。少一件就退回 `HEAD~1`：本地事后复盘那一档 HEAD
 * 是普通提交，两者等价，行为与改动前一致。
 */
function mergePreviewBase() {
  const parents = gitOrEmpty(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  if (parents.length < 3) {
    return null;
  }
  const target = String(process.env.CNB_PULL_REQUEST_TARGET_SHA ?? "").trim();
  return target === "" ? null : target;
}

async function main() {
  await loadShell();
  /* **合并提交豁免**：合并会把上游整批（含它们在别处做的格式化）一次性带进来，
   *  「拆成两次提交」在这里不是可选动作 —— 上游的形态已经定死在历史里，本地
   *  无法把一次 merge 的重排与行为改动分开。判据取 `MERGE_HEAD` 是否存在：
   *  pre-commit 在合并提交对象生成**之前**运行，此时 `MERGE_HEAD` 由
   *  `git merge` 写入、合并完成后删除，正是「本次提交是合并提交」的唯一事实源。
   *  仅当**没有**走 `--range`（CI 盘点按范围判，与合并现场无关）时豁免。
   * ⚠️ 取法必须走 `git-dir.mjs` 的 `hasInProgressMerge`，**不许**硬拼 `<根>/.git/MERGE_HEAD`：
   *  链接工作树里 `.git` 是个文件而不是目录，拼出来的路径永远读不到 —— 于是这一档豁免
   *  在那种检出里**永不点火**（ISSUE #2785；同一形状在 `check-format.cjs` 里已经收口过一次）。 */
  const { hasInProgressMerge } = require("./git-dir.mjs");
  const mergeHeadPresent = hasInProgressMerge(ROOT);
  if (!process.argv.includes("--range") && mergeHeadPresent) {
    gateSkip("格式化提交分离", "合并提交（MERGE_HEAD 存在），「格式化与行为改动分离」不适用");
    return;
  }

  const args = process.argv.slice(2);
  const limit = args.includes("--strict") ? 1 : LIMIT;
  const rangeIdx = args.indexOf("--range");
  const range = rangeIdx === -1 ? null : args[rangeIdx + 1];

  /* 收窄（`--staged`，见 `STAGED_GATE` 的注释）：暂存里一份源文件都没有时，
   * 下面的每一支都只会得出「没有文件改动，跳过」—— 那就不必先跑一遍 prettier。
   * 显式 `--range` 与合并提交豁免都在它前面判过，不走这条。 */
  if (STAGED_GATE && !range) {
    require("./gate-scan-read.cjs").skipUnlessStagedTouches({
      roots: stagedRoots(),
      tag: "[reformat]",
    });
  }

  /* 默认口径(无 --range):**优先判暂存区**。
   * pre-commit 在提交对象生成之前运行,`HEAD~1..HEAD` 指向的是上一次提交 ——
   * 判它等于本次提交完全没被检查(见文件头)。`git diff --cached` 正是「本次将要
   * 提交的内容」,且它的 diff 基线是 HEAD,与 `git show HEAD:<path>` 天然对齐。 */
  const staged = range ? "" : gitOrEmpty(["diff", "--cached", "--no-color", "--unified=0"]);

  if (!range && !staged.trim()) {
    /* 没有暂存改动:回落到「判 HEAD 这一次提交」(本地事后复盘 / CI 之外的用法)。
     * 基准怎么取见 `mergePreviewBase()`：平台那一跑 HEAD 是**合并预览**，
     * `HEAD~1` 是第一父（是哪一侧由平台拼法决定），区间会整条跨过主干。 */
    const [afterRev, beforeRev] = ["HEAD", mergePreviewBase() ?? "HEAD~1"];
    if (gitOrEmpty(["rev-parse", "--verify", "--quiet", beforeRev]).trim() === "") {
      gateSkip("格式化提交分离", `无可比父提交（${beforeRev} 不存在，首次提交或浅克隆）`);
      return;
    }
    const patch = gitOrEmpty(["diff", "--no-color", "--unified=0", `${beforeRev}..${afterRev}`]);
    if (!patch.trim()) {
      gateSkip("格式化提交分离", "本次提交没有文件改动");
      return;
    }
    const files = collectChangedFiles(patch);
    const pairs = collectPairs(files, beforeRev, (f) =>
      gitOrEmpty(["show", `${afterRev}:${f.after}`]),
    );
    process.exit(
      report(
        files,
        classifyReformatOnly(pairs),
        limit,
        migrationDeclaration(`${beforeRev}..${afterRev}`),
        /* 这一支也要**逐提交**取数，不能拿汇总当分母：`HEAD~1..HEAD` 在**合并预览**
         * 那一档（平台侧 PR 流水线把分支合进主干后跑判据，此时 HEAD 是合并提交）
         * 覆盖的是**整个 PR 的区间**，而不是「一条提交」—— 汇总口径下切换那一笔
         * 的判据脚本 / 文档 / 依赖清单照样进分母（实测 32/56），护栏 ② 会把
         * 「重排独占一条」这个正确形态判成夹带。区间口径同一把尺，见
         * `perCommitShape` 的头注。 */
        perCommitShape(`${beforeRev}..${afterRev}`, limit, ROOT, perCommitDeps),
      ),
    );
    return;
  }

  /* `--range <before>..<after>` 的两侧:改动前的内容从 `before` 取,改动后的
   * 从 `after` 取。暂存区口径下两者都是 `HEAD`(改动后在 index 里,见下)。 */
  const [rangeBefore, rangeAfter] = range ? range.split("..") : ["HEAD", "HEAD"];

  if (range && gitOrEmpty(["rev-parse", "--verify", "--quiet", rangeBefore]).trim() === "") {
    gateSkip("格式化提交分离", `无可比父提交（${rangeBefore} 不存在，首次提交或浅克隆）`);
    return;
  }

  const patch = range
    ? gitOrEmpty(["diff", "--no-color", "--unified=0", `${rangeBefore}..${rangeAfter}`])
    : staged;

  if (!patch.trim()) {
    /* 「没有改动」是**这一轮没判**（skip），不是「判过且干净」—— 两件事在
     * 屏幕上是两档（ISSUE #2506）。 */
    gateSkip("格式化提交分离", "本次提交没有文件改动");
    return;
  }

  /* 暂存区口径下,「改动后」的内容在 index 里而不是某个 rev —— 新增文件的
   * 改动前版本不存在(该文件在 HEAD 里没有),所以内容取空串,由 collectPairs
   * 按「任一侧取不到就不判定」跳过(纯新增不算格式化)。 */
  const files = collectChangedFiles(patch);
  const pairs = collectPairs(files, rangeBefore, (f) =>
    // 暂存区口径:改动后的内容在 index 里,`:<path>` 正是它的取法。
    gitOrEmpty(["show", range ? `${rangeAfter}:${f.after}` : `:${f.after}`]),
  );
  process.exit(
    report(
      files,
      classifyReformatOnly(pairs),
      limit,
      // 区间口径:按传入的 A..B 读声明;暂存区口径(range 为空)按 HEAD 那一次读。
      migrationDeclaration(range ?? "HEAD~1..HEAD"),
      // 护栏 ② 只在区间口径下逐提交取数:暂存区口径下「这一次提交」就是汇总本身,
      // 由 `report()` 按汇判定(迁那一支读 `reformatOnly.size === files.length`)。
      range ? perCommitShape(range, limit, ROOT, perCommitDeps) : null,
    ),
  );
}

/** 输出结论并按阈值决定是否阻断(两个口径共用,避免两份会各自漂移的判定)。 */
function report(files, reformatOnly, limit, migration, perCommit) {
  /* 判决行的形状只有一处出处：`scripts/ci-log.mjs`（ISSUE #2506）。
   * ⚠️ 两条分支**都要交回退出码**，调用点是 `process.exit(report(…))`：从前红的那
   * 一支就地 `process.exit(1)`，搬进出口之后若就地退，`report()` 之后的收尾就再没有
   * 执行者 —— 退 0 = 判据恒绿（这一条在把红那一支改成 `return 1` 时当场验过）。 */
  /* **取不到的读数要念出来**（ISSUE #2990 的 `cnb-rmn-1k6bqsdfg`）：护栏 ② 的结论只有
   * 「通过 / 不通过」两个出口，于是一屏全是「声明了但重排没独占」而一个 offender 都
   * 不点名 —— 现场那些指纹（哪条提交没读到、为什么）一个字都没出现，读者只能去猜。
   * 这一格只加**读数**，不改任何判决：`ok` 仍由 `perCommitShape` 的 `offenders` 决定。 */
  if (perCommit && perCommit.offenders.length > 0) {
    for (const line of indentItems([`护栏 ② 没通过：${perCommit.offenders.join("、")}`])) {
      console.log(line);
    }
  }
  if (reformatOnly.size >= limit) {
    /* 「格式化迁移」声明成立 ⇒ 按迁移读（不阻断），但清单与读数照打（可审计）。
     * 护栏 ② 是第二道锁：逐提交看「重排占不占得住这一条」（`perCommitShape`），
     * 声明不是万能钥匙 —— 把重排与功能改动埋进同一条提交，这一关照样拦。 */
    const isolated = perCommit
      ? perCommit.ok
      : files.length > 0 && reformatOnly.size === files.length;
    if (migration?.declared === true && isolated) {
      gatePass(
        "格式化提交分离",
        `格式化器迁移：本次改动 ${files.length} 个源文件，纯格式化 ` +
          `${reformatOnly.size} 个（阈值 ${limit}，按迁移放行）`,
      );
      const basis = [
        `依据：区间 ${migration.commits} 个提交**都**带 \`format-migration:\` 尾注，` +
          "且**逐提交**看过去重排都是独占的（或不到阈值）—— " +
          "这是换格式化器的重排，不是把功能改动埋进格式 diff。",
      ];
      if (perCommit) {
        for (const c of perCommit.commits) {
          const pct = c.files ? ((c.reformatOnly / c.files) * 100).toFixed(0) : "0";
          basis.push(
            `· ${c.rev.slice(0, 8)}：${c.files} 个源文件里 ${c.reformatOnly} 个纯格式化（${pct}%）`,
          );
        }
      }
      basis.push(
        `重排的文件（照常点名，可审计）：${[...reformatOnly]
          .sort()
          .slice(0, 5)
          .join(", ")}${reformatOnly.size > 5 ? " …" : ""}`,
      );
      for (const line of indentItems(basis)) {
        console.log(line);
      }
      return 0;
    }
    gateFail("格式化提交分离", [...reformatOnly].sort(), {
      detail: `本次改动 ${files.length} 个源文件，其中纯格式化 ${reformatOnly.size} 个（阈值 ${limit}）${
        migration?.declared === true
          ? `；声明了 \`format-migration:\`，但**逐提交**看有提交把重排与功能改动混在一条里（${perCommit?.offenders.join("、") ?? "重排没有独占本次改动"}）⇒ 不按迁移读`
          : ""
      }`,
      hint:
        "为什么拦:格式化 diff 会把真实的功能改动埋掉 —— `git blame` 失效,\n" +
        "评审也无法从 diff 里看出改了什么（§13.7 的提交噪声口径）。\n" +
        "修法:拆成两次提交。\n" +
        "  git reset --soft HEAD~1\n" +
        "  git restore --staged .\n" +
        '  git add <仅功能相关的文件> && git commit -m "fix(scope): <本次改动>"\n' +
        "  # 用 pnpm exec oxfmt <文件> 格式化（别对全库跑 format:write）\n" +
        '  git add -A && git commit -m "style: 格式化 <范围>"\n' +
        "若确实要一次性格式化某批文件（清理存量），那就**单独一个提交/PR**做它。\n" +
        "（`check-format.cjs` 已是硬闸、没有 `--update`：存量清零后删掉了那条通道，见 ISSUE #1811。）",
    });
    return 1;
  }

  /* 放行但不必点名的那一档，读数要带上「为什么不必点名」——
   * 一行判决里说不完的，跟在后面缩进（判过仍然是判过了）。 */
  if (reformatOnly.size > 0) {
    gatePass(
      "格式化提交分离",
      `本次改动 ${files.length} 个源文件，纯格式化 ${reformatOnly.size} 个（阈值 ${limit}，未达阈值）`,
    );
    for (const line of indentItems([
      `放行但不计入噪声的：${[...reformatOnly]
        .sort()
        .slice(0, 5)
        .join(", ")}${reformatOnly.size > 5 ? " …" : ""}`,
    ])) {
      console.log(line);
    }
    return 0;
  }
  gatePass("格式化提交分离", `本次改动 ${files.length} 个源文件，没有纯格式化的`);
  return 0;
}

if (require.main === module) {
  main();
}

/**
 * 供测试直接引用。
 *
 * `classifyReformatOnly` 会**真的起 prettier**（那是它的判据本体），测试用它
 * 锁「批量结果里没被改过的文件也必须回落到 stdin 口径」—— 用桩替换掉 prettier
 * 就锁不住这条，因为被锁的正是「谁来给答案」。
 */
module.exports = {
  collectChangedFiles,
  /* 自测入口：区间那一支在悬空父上根本进不去，而这条判据要断的正是
   * 「逐提交取不到 diff」那一档。实现在机制层（`reformat-per-commit.mjs`）。 */
  perCommitShapeOf: (rev, spec = {}) =>
    perCommitShapeOf(rev, {
      root: spec.root ?? ROOT,
      limit: spec.limit ?? LIMIT,
      deps: perCommitDeps,
    }),
  classifyReformatOnly,
  LIMIT,
  SOURCE_RE,
  stagedRoots,
};
