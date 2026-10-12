// @ts-nocheck -- 提交门槛脚本:文件命名/组织硬规则(供 .githooks/pre-commit 调用)
/**
 * 文件组织硬规则(规范见 docs/standards/12-代码组织与文件结构.md):
 *   R1  src 下 .tsx 文件名必须 PascalCase(测试伙伴文件 X.test.tsx 同样以大写开头;
 *       豁免:src/app 下 Next 保留名、CONVENTION_EXEMPT 列出的库惯例文件、
 *       目录索引 index.tsx;src/components/ui/ 采用 shadcn 官方 kebab-case 约定
 *       (硬强制 kebab,禁止 PascalCase——§12.6/§12.8)
 *   R2  src 下 .ts 文件名禁止 PascalCase(非组件模块一律 kebab-case)
 *       (src/ 根下的 Next 约定文件 proxy.ts 由 R2_EXEMPT 豁免——它是框架
 *        保留名,不能改名;配套 R11 保证它没被放错位置或悄悄消失)
 *   R3  禁止时间戳备份文件(\d{8}_\d{6} 模式)——版本回退用 git,不进 src
 *   R4  src/lib 下禁止 .tsx(12.5:lib 无 React)
 *   R5  src/ 下超 900 行的文件列入拆分候选。**默认只提醒不阻塞**;
 *       `--strict` 下按棘轮 `scripts/.file-size-baseline.json` 判:**新增**
 *       超限文件即阻断(存量的只许降不许升)。
 *       **pre-commit 跑的就是带 `--strict` 的这一档**(ISSUE #1404)——这一档此前
 *       写在帮助文本里的执行者是「CI」,而那份流水线已随 ISSUE #623 删除。
 *       扫描范围是**整个 src/**:页面的纯展示视图在 src/app/,逻辑层的大文件在
 *       src/lib/——只扫 components 会让当时最大的那几个文件完全落在护栏之外(ISSUE #536)。
 *       棘轮的理由(ISSUE #575 第 8 项):「只提醒」挡不住新增长文件 ——
 *       提醒出现在一屏输出里,没有人会因为一行提示去拆文件,于是文件只增不减。
 *   R7  Windows 双击入口一律 .ps1:仓库内禁止新增 .bat/.cmd/.vbs
 *       (ISSUE #23 / 规范 launch-and-build.md §8:.bat 走 cmd 的 GBK 代码页,
 *        中文必乱码,历史上被迫做成"不含中文不含逻辑"的哑壳)
 *   R8  scripts/ tools/ 下含中文的 .ps1 必须以 UTF-8 BOM 保存(否则 PowerShell
 *       5.1 按 GBK 解码,与 .bat 乱码同源)
 *   R9  根目录只放工程配置。两种形态同罚:① 散落的 .ps1 双击入口(ISSUE #29)——
 *       入口一律归入 tools/<分类>/,根入口的 discoverability 由 README 的入口
 *       清单承担,不靠"铺在根目录第一眼看见";② git 自身的临时状态文件
 *       (MERGE_MSG / COMMIT_EDITMSG / SQUASH_MSG 一族,ISSUE #1586)——它们归
 *       `.git/`,落进工作区只说明"用 -F 指了个工作区文件、提交完忘了删",而那个
 *       文件此后没有任何读者(仓库里真的有过一份 `.merge_msg`)。
 *   R10 注释里禁止「历史流水」:日期(2026-08-17)、改动编号(R-ardot114 / R83 /
 *       R-Next)、任务批次号(T12-3)。这些归 git log,写进注释会随代码搬迁过期
 *       失真(ISSUE #46 / 规范 12.4.2 / 反模式表 G4)。
 *       扫 `.ts` / `.tsx` **与 `.css`** —— 样式文件的注释同样会写「R-ardot18
 *       (2026-08-14): 这里为什么这么写」,而它恰恰是最容易被搬来搬去的一类
 *       (只扫 TS 时,globals.css 里就有三处这样的遗留长期未被发现)。
 *   R13 src/lib 子域纪律:根目录只放「顶层单例地基」(见 DOMAIN_EXEMPT),
 *       其余模块一律归属某个子域目录(§12.5.3)。叶子域平铺、不再套一层
 *       admin/other/shared —— 那一层既说不出「谁属于它」,又会让
 *       「一个域一个目录」的对应关系变成「一个域一个目录 + 一个杂物间」。
 *   R14 src/lib 子域目录名必须在 DOMAINS 里登记(新增域是一次设计决定,
 *       不是 mkdir 的副作用;漏登记会让 R13 的归属判据永远为绿)。
 *   R12 src/ 源码禁止内嵌控制字符(NUL 及其它 C0/C1 控制符,制表/换行除外)。
 *       源码里带一个真的 NUL 字节 = git / diff / grep / 多数编辑器一律当
 *       **二进制文件**处理:`git diff` 只回「Binary files differ」(评审看不到
 *       改动)、`git show --stat` 显示为 bin、`grep -rn` 静默跳过整个文件。
 *       曾经用来做「占位符」的 NUL 哨兵(规范 12.11)是它的来源,现已改为
 *       可打印形式;本条防回潮。
 * 违反 R1-R4、R7-R12、R14 以退出码 1 阻断提交。
 *
 * R13（import 别名只有一种前缀 `~`，ISSUE #640）由**独立脚本**
 * `scripts/check-import-alias.cjs` 承担，不在这里实现：判据是「模块说明符的前缀」，
 * 与文件命名/位置无关，混进本文件的 R1-R12 只会让两套口径互相干扰。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
/* 扫描面的共用读取（`gate-scan-read.cjs`）：门禁读的是**工作树**，而工作区在遍历
 * 期间不是静止的 —— 别人的进程会清理自己的临时目录（编辑器 / 测试运行器 / 另一个
 * 代理工作区留下的 `_tmp_*`）。裸 `readdirSync` 撞上那个窗口 = 整个脚本以未捕获的
 * `ENOENT: … scandir '…'` 退出，判据的真实语义（有违规 / 没有）与执行故障
 * （环境竞争）被压成同一个退出码。容错口径（只降级 ENOENT、消失数进结论行、
 * 根不存在 ≠ 条目消失）全在那一份里。 */
const {
  dirExists,
  readBytesForScan,
  readForScan,
  readdirForScan,
  vanishedNote,
} = require("./gate-scan-read.cjs");

const problems = [];
const splitHints = [];
/** 遍历途中消失的条目数（目录级 + 文件级）。要进结论行，不许静默跳过。 */
let vanished = 0;
/** R5 棘轮用:超限文件 → 行数(路径为仓库相对路径,与基线同一口径)。 */
const oversizedFiles = {};

/** R5 的文件行数阈值:超过即进「拆分候选」清单。 */
const SPLIT_HINT_LINES = 900;

/* ── R5 棘轮(ISSUE #575):超限文件路径 → 行数 ──
 * 默认(非 strict)只提醒;`--strict` 下「基线里没有的超限文件」即阻断,
 * 「基线里已有但变大了」一并阻断 —— 只许降不许升。
 * pre-commit 跑的是带 --strict 的这一档(ISSUE #1404)。 */
const FILE_SIZE_BASELINE = path.join(__dirname, ".file-size-baseline.json");
/** R5 棘轮的**判据版本**:只有「数行数的口径」本身变了(例如全库 prettier 治理
 *  拆行、整体抬高行长口径)才允许 `--update` 一次性重记,其余情况数字只许下降。
 *  理由与 check-function-length.cjs 的 RULE_VERSION 同源:基线是「该判据下的计数」,
 *  判据一变,旧数字与新计数就不是同一个量 —— 不做标记的重记会被读成「有人放宽棘轮」。
 *
 *  R5_RULE_VERSION 3 变更:行数比对改为按 `baselineRev` **同口径重数**(见下),
 *  不再拿不同「格式时代」的绝对行数直接相减。
 *
 *  R5_RULE_VERSION 4 变更:基线里被记的修订号不可达时,不再拿记录值顶替着比
 *  —— 那等于退回版本 3 要消灭的「跨格式时代相减」,且报错会把「基线过期」误报成
 *  「文件变大」。现在这一支直接指向「重记基线」;记录值也随之一次性重置为
 *  **当前内容**的同口径行数(版本 3 的重记没把这条陷阱一起堵上,存量数字仍
 *  停在另一个格式时代的源码上)。 */
const R5_RULE_VERSION = 4;

/* ── R5 的行数口径:不同「格式时代」的绝对行数不可直接比较 ──
 * 基线里的数字是在**记它的那个格式口径**的源码上数出来的。而「数行数」这件事
 * 不做归一化(逐行状态机,不重排、不合并行长),于是同一段逻辑的行数完全取决于
 * 它写得多紧凑 —— 一次全库 prettier 治理(把紧凑的单行参数表 / 对象字面量展开、
 * 按宽度拆行)就能让「一个字都没改」的文件凭空多出几十行。
 *
 * 实例(ISSUE #637):`LogPanel.tsx` 的基线 1102 记于 prettier 治理**之前**;
 * 治理后同一文件(内容未增)已是 1236 行。此后任何人**一行都不改它**,CI 也会报
 * 「R5 超限文件继续变大(1102 → 1236)」—— 棘轮把「格式口径变化」读成了「这次
 * 改动让文件变大」,而作者根本无从下手(要他为了过门禁把已格式化的文件再压缩回
 * 1102 行,等于让门禁否掉 §13 的 prettier 口径)。
 *
 * 修法:**基线自带记它那一刻的修订号**,比对前先把「基线数字」按那个修订号的
 * 源码重新数一遍 —— 即同口径重数,而不是拿两个时代的绝对行数相减。
 *   · 基线记录 `baselineRev`;
 *   · 比对时用 `git show <rev>:<file>` 取基线版本的文件内容,按**今天同一套
 *     逐行计数**重新数出 `baseLines`,再与当前行数比较;
 *   · 文件在基线版本里不存在(git 取不到)→ 退回基线上的记录值(不误报);
 *   · 基线缺 `baselineRev`(旧基线)→ 退回基线上的记录值(与历史行为一致),
 *     由下一次 `--update` 补上。
 * 判据是「这个文件在**同口径**下比基线那一刻多没多」——格式时代造成的系统性差异
 * 被自动吸收,而真实的膨胀(有人往文件里加代码)照旧阻断。
 *
 * 为什么不用「全仓整体行数比」换算:实测不行。prettier 是**逐文件**重排,各文件
 * 的展开倍率差异极大(同一批文件里既有 0.958 也有 1.130),全仓比例约等于 1.0,
 * 换算后对 `LogPanel.tsx` 仍判「变大 136 行」——即该口径解决不了它要解决的问题。
 *
 * 「取不到基线修订号」这一支有个陷阱:它同时覆盖「真新增的文件」与「基线修订号
 * 已经不可达的存量文件」——后者是**基线自身过期**,不是文件变大,而退回记录值会
 * 把它判成「继续变大」。故判据拆成两支,并把「修订号是否可用」直接写进报错,
 * 见 `BASELINE_REV_USABLE` 与下面的两条 problems。 */

/** 取当前 HEAD 的修订号,写进基线供日后「同口径重数」用。
 *  git 不可用 / 不在检出里时返回 null(退回记录值,不阻断)。 */
function headRev() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.trim() || null;
}

/** 按**今天的行数口径**重数 `rev` 里该文件的行数;取不到返回 null。
 *  行数口径与主扫描(collectSplitHints)逐字一致:`split("\n").length`。 */
function linesAtRev(rev, rel) {
  if (!rev) return null;
  const res = spawnSync("git", ["show", rev + ":" + rel], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.split("\n").length;
}

/* ── 基线修订号必须仍可达 ──
 * 「按 baselineRev 同口径重数」有个前提:**那个提交还在当前检出里**。合并提交删掉
 * 被并入的分支后,基线记的修订号(通常是某个分支提交)会变成不可达对象,下一次
 * `git gc` 就把它清掉 —— 此后 `git show <rev>:<file>` 一律失败,同口径重数静默
 * 退化成「拿记录值直接比」,而记录值记在**另一个格式时代**的源码上(见上)。
 *
 * 现场:`LogPanel.tsx` 的基线 988 记于一个已被合并吸收、不再有 ref 指向的分支提交,
 * 而按今天的计数口径、今天的内容重数是 993 行 —— 这个文件**一个字都没改**却天天
 * 判红,且报错写作「R5 超限文件继续变大」,与真实原因(基线修订号不可达)毫无关系。
 *
 * 所以查基线前先确认**基线里那个**修订号真的能被重数:取不到就报出来、指向
 * 「重记基线」,而不是悄悄退回记录值把红判成「文件变大了」。 */
const BASELINE_REV = (function readBaselineRev() {
  if (!fs.existsSync(FILE_SIZE_BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE_SIZE_BASELINE, "utf8")).baselineRev;
  } catch {
    /* 基线损坏由棘轮那一支报「基线文件缺失 / 不可解析」,这里不重复报。 */
    return null;
  }
})();

/** 基线修订号能不能真的拿去重数(在当前检出里可达)。 */
const BASELINE_REV_USABLE =
  typeof BASELINE_REV === "string" &&
  BASELINE_REV.length > 0 &&
  spawnSync("git", ["cat-file", "-e", BASELINE_REV + "^{commit}"], {
    encoding: "utf8",
  }).status === 0;

// 声明层(常量与清单表)拆在同目录的 file-structure-rules.cjs(ISSUE #1811):
// 这份脚本此前 1213 行、过半是纯数据,R5「超 900 行须拆」正是冲这个形态来的。
const {
  FORBIDDEN_SCRIPT_EXT,
  BOM_REQUIRED_DIRS,
  NON_ASCII,
  HISTORY_DATE,
  HISTORY_TAG,
  HISTORY_TASK_DASHED,
  HISTORY_TASK_BARE,
  HISTORY_TASK_REF_CONTEXT,
  BLOCK_COMMENT_CLOSE,
  DOMAINS,
  DOMAIN_EXEMPT,
  R2_EXEMPT,
  NEXT_RESERVED,
  CONVENTION_EXEMPT,
  SCAN_EXCLUDED,
  GIT_TRANSIENT_ROOT_FILES,
} = require("./file-structure-rules.cjs");

const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");




/** R13/R14 的扫描:只看 `src/lib` 的顶层条目,不递归。 */
(function checkLibDomainDiscipline() {
  const LIB = "src/lib";
  /* 根不存在 = 真故障（仓库被切了一半 / 跑错工作目录），静默跳过会得到一个
   * 「一份输入都没读」的假绿；条目级消失由下面的读取器降级。 */
  if (!dirExists(LIB)) return;
  const libEntries = readdirForScan(LIB);
  if (libEntries === null) {
    vanished++;
    return;
  }
  for (const e of libEntries) {
    const rel = LIB + "/" + e.name;
    if (e.isDirectory()) {
      if (!DOMAINS.includes(e.name))
        problems.push(
          "R14 src/lib 子域目录未登记:" +
            rel +
            "。新增域须同时登记到 scripts/check-file-structure.cjs 的 DOMAINS," +
            "并在 vitest.config.ts 按实测值设覆盖率门槛(规范 §18.6 / §12.5.3)",
        );
      continue;
    }
    if (!/\.ts$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
    /* 测试伙伴文件跟着它的被测模块走:模块在豁免清单里,它的用例也在。 */
    const moduleRel = rel.replace(/(\.windows)?\.test\.ts$/, ".ts");
    if (DOMAIN_EXEMPT.has(moduleRel)) continue;
    problems.push(
      "R13 src/lib 根目录模块必须有子域目录:" +
        rel +
        "。根目录只放顶层单例(DOMAIN_EXEMPT);分类到对应子域,或" +
        "「新增域 + 登记 DOMAINS + 设覆盖率门槛」——后者是设计决定,见规范 §12.5.3",
    );
  }
})();


(function walk(dir) {
  const entries = readdirForScan(dir);
  if (entries === null) {
    vanished++;
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(tsx?|mjs|cjs|js)$/.test(e.name)) continue;
    const rel = p;
    // shadcn/ui 官方约定:组件文件 kebab-case(button.tsx/dialog.tsx),
    // 与本项目 R1(PascalCase)相反——本脚本对 src/components/ui/ 硬强制 kebab
    // (禁止大写开头,§12.6),不再豁免。
    const isUiDir = rel.startsWith("src/components/ui/");
    const base = e.name
      .replace(/\.(tsx?|mjs|cjs|js)$/, "")
      .replace(/\.test$/, "");
    if (/\d{8}_\d{6}/.test(e.name)) problems.push("R3 时间戳备份文件:" + rel);
    /* R11 的位置判据:Next 约定文件只允许出现在 src/ 根。放进 app/ 或更深
     * 的目录 Next 不会加载 —— 文件在、代理不在,构建期毫无提示。
     * 只看**约定文件本身**:`base` 上面已经把 `.test` 摘掉了(那是给 R2 命名规则
     * 用的),不清这一下会把 `src/proxy.test.ts` 判成「约定文件放错位置」——
     * 测试文件既不会被 Next 加载,也就无从「静默丢失」。 */
    if (
      (base === "proxy" || base === "middleware") &&
      !/\.test\.(tsx?|mjs|cjs|js)$/.test(e.name)
    ) {
      const canonical = "src/" + base + ".ts";
      if (rel !== canonical)
        problems.push(
          "R11 Next 约定文件位置错:" + rel + "(须在 " + canonical + ")",
        );
    }
    /* 文件级读取同样走容错版:条目在「列到名字」与「读内容」之间被删时返回 null,
     * 而那个文件里已无违规可判 —— 「没读到」与「读到了、没有违规」在这条判据上等价,
     * 但计数要进结论行。 */
    const head = readForScan(p);
    if (head === null) vanished++;
    else if (
      /^\/\* eslint-disable @typescript-eslint\/no-explicit-any/.test(
        head.split("\n")[0] || "",
      )
    )
      problems.push(
        "R6 文件级 no-explicit-any 禁用头(战役已清零,禁止回流):" + rel,
      );
    if (/\.(tsx|mjs|cjs|js)$/.test(e.name) && rel.startsWith("src/")) {
      if (e.name.endsWith(".tsx")) {
        /* §12.6:目录索引 index.tsx 是 barrel,不承载组件实现,不受 R1 约束。
         *  src/components/ui/ 采用 shadcn 官方 kebab-case 约定(§12.6),
         *  故 ui/ 下组件文件须 kebab-case(禁止 PascalCase)。 */
        const isDirectoryIndex = base === "index";
        const reserved =
          (rel.startsWith("src/app/") && NEXT_RESERVED.has(base)) ||
          CONVENTION_EXEMPT.has(rel) ||
          isDirectoryIndex;
        if (isUiDir) {
          // shadcn 约定:kebab-case,禁止大写开头
          if (/^[A-Z]/.test(base))
            problems.push("R1(ui) 组件文件须 kebab-case:" + rel);
        } else if (!reserved && !/^[A-Z]/.test(base)) {
          problems.push("R1 组件文件须 PascalCase:" + rel);
        }
        if (rel.startsWith("src/lib/"))
          problems.push("R4 lib 下禁止 .tsx:" + rel);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        // ui/ 下 .ts 模块同样须 kebab-case(shadcn 约定)
        if (/^[A-Z]/.test(base) && !R2_EXEMPT.has(rel))
          problems.push("R2 模块文件须 kebab-case:" + rel);
      }
    }
  }
})("src");

// ── R5:超大文件的拆分候选(提示级,不阻断) ──
// 扫描范围是**整个 src/**,不分层也不分文件类型:
//   · src/app/       页面的「纯展示视图」(settings/SettingsPageView.tsx 2499 行);
//   · src/lib/       逻辑层的大文件(comfyui/lifecycle.ts 1041 行);
//   · src/components/、src/server/  组件与服务端。
// 只扫 components(历史口径)会让「最大的那个文件」永远不被提醒;把范围缩到
// .tsx 会让逻辑层的大文件同样漏网。行数超了就该拆,与它是不是组件、落在哪一层
// 都无关。App Router 的保留文件(page/layout/route)一并计入。
// 与函数长度门禁(check-function-length.cjs §12.13)的分工:那个管**函数**,
// 这个管**文件**;两者都只提示,把存量交给排期,把增量交给棘轮。
(function collectSplitHints() {
  (function walkHints(dir) {
    const entries = readdirForScan(dir);
    if (entries === null) {
      vanished++;
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walkHints(p);
        continue;
      }
      if (!/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) continue;
      if (/\.test\.[cm]?[jt]sx?$/.test(e.name) || /\.d\.ts$/.test(e.name))
        continue;
      const text = readForScan(p);
      if (text === null) {
        vanished++;
        continue;
      }
      const lines = text.split("\n").length;
      if (lines > SPLIT_HINT_LINES) {
        splitHints.push(p + " (" + lines + " 行,建议拆分)");
        oversizedFiles[p] = lines;
      }
    }
  })("src");
})();

// ── R7/R8:仓库内 Windows 脚本入口扫描 ──
(function walkScripts(dir) {
  const entries = readdirForScan(dir);
  if (entries === null) {
    vanished++;
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    const rel = p.startsWith("./") ? p.slice(2) : p;
    if (e.isDirectory()) {
      if (
        SCAN_EXCLUDED.some((d) => rel === d.slice(0, -1) || rel.startsWith(d))
      )
        continue;
      walkScripts(p);
      continue;
    }
    if (FORBIDDEN_SCRIPT_EXT.test(e.name)) {
      problems.push("R7 Windows 入口须 .ps1(禁用 .bat/.cmd/.vbs):" + rel);
      continue;
    }
    if (!e.name.toLowerCase().endsWith(".ps1")) continue;
    if (!BOM_REQUIRED_DIRS.some((d) => rel.startsWith(d))) continue;
    /* BOM 判据要的是**字节**,走共用件的字节版(读不到 = 条目在遍历途中消失,
     * 那个文件已不存在,不可能是一份「缺 BOM 的现役脚本」)。 */
    const buf = readBytesForScan(p);
    if (buf === null) {
      vanished++;
      continue;
    }
    if (
      buf.length >= 3 &&
      buf[0] === 0xef &&
      buf[1] === 0xbb &&
      buf[2] === 0xbf
    )
      continue;
    // 无 BOM:只有含非 ASCII 字符(中文提示)的脚本才会被 PS5.1 按 GBK 误解码
    if (NON_ASCII.test(buf.toString("utf8"))) {
      problems.push(
        "R8 含中文的 .ps1 须以 UTF-8 BOM 保存(否则 PS5.1 按 GBK 解码):" + rel,
      );
    }
  }
})(".");

// ── R9:根目录只放工程配置 ──
// 两种形态同罚,理由是同一个:根目录的那一份名单应当全是"这个项目是什么"
// (配置/文档),混进"一次操作留下的临时物"之后,第一眼就分不出哪些是工程配置。
(function checkRootEntries() {
  const entries = readdirForScan(".");
  if (entries === null) {
    vanished++;
    return;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (lower.endsWith(".ps1")) {
      problems.push(
        "R9 根目录禁止 .ps1 双击入口(请放进 tools/<分类>/,启动类放 tools/start/):" +
          e.name,
      );
      continue;
    }
    if (GIT_TRANSIENT_ROOT_FILES.has(lower)) {
      problems.push(
        "R9 根目录禁止 git 临时状态文件(它归 .git/,写成文件只说明 -F 用完没删):" +
          e.name,
      );
    }
  }
})();

// ── R10:注释里禁止「历史流水」(日期 / 改动编号 / 任务批次号) ──
// 规范 12.4.2:作者、日期、版本流水归 git log / commit message,写进注释会随
// 代码搬迁过期失真。本条只扫「整行都是注释」的行,不碰字符串字面量与代码。
(function checkHistoryComments() {
  const files = [];
  (function walkComments(dir) {
    const entries = readdirForScan(dir);
    if (entries === null) {
      vanished++;
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walkComments(p);
        continue;
      }
      // `.css` 一并纳入:样式注释里的改动编号 / 日期同样是「历史流水」,
      // 且样式块常被整段搬运,过期的落点说明比代码里的更容易失真。
      if (/\.(ts|tsx|css)$/.test(e.name)) files.push(p);
    }
  })("src");
  for (const rel of files) {
    const text = readForScan(rel);
    if (text === null) {
      vanished++;
      continue;
    }
    const lines = text.split("\n");
    /* 逐行找「这一行是不是注释」。**必须带块注释状态**：只按行首形态判
     * (以 `*` 开头等)会漏掉「块内不以 `*` 开头的续行」—— JSX 注释块里手写的
     * 多行说明、以及块注释里整段贴进来的旧说明,续行常常顶格或缩进对齐,
     * 行首既不是 `*` 也不是 `//`。实测 src/ 里有 3 行这样的 `R-ardot` /
     * 日期标记长期漏在判据之外(见 WorkflowWirePortRows /
     * ImageGenerationPanel),而它们恰恰是最容易被整段搬运的一类。
     * 状态机只在注释内判定,不碰字符串字面量里的日期(如用例里的示例文本)。 */
    let inBlock = false;
    lines.forEach((l, i) => {
      const t = l.trim();
      let isComment = inBlock;
      // JSX 注释块与普通块注释同形,统一按开闭标记计
      if (inBlock) {
        if (BLOCK_COMMENT_CLOSE.test(l)) inBlock = false;
      } else if (
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("{/*") ||
        t.startsWith("*")
      ) {
        isComment = true;
        // 本行开了块注释、且本行没有把它闭合 → 后续行都在注释里
        const opensBlock = t.startsWith("/*") || t.startsWith("{/*");
        if (opensBlock && !BLOCK_COMMENT_CLOSE.test(l)) inBlock = true;
      }
      if (!isComment) return;
      // 一行里可能同时有日期与编号,逐个报出来,便于一次改干净
      const found = new Set();
      for (const re of [HISTORY_DATE, HISTORY_TAG]) {
        for (const m of l.matchAll(new RegExp(re.source, "g"))) {
          if (m[0] !== "") found.add(m[0]);
        }
      }
      // 任务批次号两档:带连接号的 `T12-3` 无歧义;裸 `Tn` 在「同行的反模式 /
      // 规范章节引用」语境下不算流水(理由见 HISTORY_TASK_* 的声明处)。
      for (const re of [HISTORY_TASK_DASHED]) {
        for (const m of l.matchAll(new RegExp(re.source, "g"))) {
          if (m[0] !== "") found.add(m[0]);
        }
      }
      if (!HISTORY_TASK_REF_CONTEXT.test(l)) {
        for (const m of l.matchAll(new RegExp(HISTORY_TASK_BARE.source, "g"))) {
          if (m[0] !== "") found.add(m[0]);
        }
      }
      for (const hit of found) {
        problems.push(
          "R10 注释禁止历史流水(日期 / 编号 / 批次号归 git):" +
            rel +
            ":" +
            (i + 1) +
            " → " +
            hit,
        );
      }
    });
  }
})();

// ── R11:Next 16 起 middleware 必须叫 proxy,且不得静默丢失(ISSUE #489) ──
// 两条判据合起来才拦得住:
//   ① 存在性——约定文件被删 = 代理凭空消失,构建期不报错,要等到真拦请求时
//      才发现「根本没跑」;本仓库唯一用途是挂 config.matcher 给后来人留落点,
//      删掉它等于把落点一起删了;
//   ② 片段存在性——文件在、但改名回 middleware = 重新吃 Next 16 的 deprecation
//      警告(改名是「消警告」而不是「消掉需求」的典型误修)。
(function checkProxyConvention() {
  const proxyPath = "src/proxy.ts";
  const legacyPath = "src/middleware.ts";
  if (!fs.existsSync(proxyPath)) {
    problems.push(
      "R11 缺少 Next 16 代理约定文件:" +
        proxyPath +
        "(middleware 已废弃,勿删除本文件)",
    );
  }
  if (fs.existsSync(legacyPath)) {
    problems.push(
      "R11 middleware 约定名已废弃(Next 16):" +
        legacyPath +
        " → 改名为 src/proxy.ts",
    );
  }
})();

// ── R12:src/ 源码禁止内嵌控制字符(规范 12.11) ──
// 判据是「这个字节在源码里是不是一个字符」,而不是「文件里有没有某个字符串」:
// 带 NUL 的文件被 git / diff / grep / 多数编辑器一律当二进制处理,评审与检索
// 从此对它失效——这正是历史上 markdown.ts 用 NUL 做占位符哨兵留下的坑。
// 详情与替代写法见 docs/standards/12-代码组织与文件结构.md §12.11。
(function checkControlCharacters() {
  /** 允许的控制字符:制表符、换行、回车(源码里的正常排版)。 */
  const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
  /** C0(0x00-0x1f,除上列)、DEL(0x7f)、C1(0x80-0x9f / U+0080-U+009F)。 */
  function isForbidden(code) {
    if (code <= 0x1f) return !ALLOWED.has(code);
    if (code === 0x7f) return true;
    return code >= 0x80 && code <= 0x9f;
  }
  function describe(code) {
    const hex = "U+00" + code.toString(16).toUpperCase().padStart(2, "0");
    return code === 0 ? hex + " (NUL)" : hex;
  }
  const files = [];
  (function walkControl(dir) {
    const entries = readdirForScan(dir);
    if (entries === null) {
      vanished++;
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) {
        walkControl(p);
        continue;
      }
      if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  })("src");
  for (const rel of files) {
    const text = readForScan(rel);
    if (text === null) {
      vanished++;
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const hits = new Set();
      for (const char of line) {
        const code = char.codePointAt(0);
        if (isForbidden(code)) hits.add(describe(code));
      }
      for (const hit of hits) {
        problems.push(
          "R12 源码禁止内嵌控制字符(" +
            rel +
            ":" +
            (i + 1) +
            " → " +
            hit +
            ")。改可打印哨兵,见规范 §12.11;若确需 NUL 请显式写成转义 `\\u0000`",
        );
      }
    });
  }
})();

// ── R5 棘轮(ISSUE #575 第 8 项) ──
// 默认只提醒;`--strict` 下按 `scripts/.file-size-baseline.json` 判定:
//   ① 基线里没有的超限文件 = 新增 → 阻断;
//   ② 基线里已有但配额(基线行数 × 行数口径换算比)被突破 → 阻断(文件还在长);
//   ③ 基线里已有但已降到阈值内/行数变小 → 提示收紧基线(不阻断,避免打断提交)。
// 反模式:只在输出里打一行「建议拆分」。提醒与阻断的区别就是「有没有人为它返工」——
// 写下那句「只增不减」时本仓有 11 个超限文件,现在基线是 total: 0 / files: {}。
// pre-commit 从 ISSUE #1404 起跑的就是带 `--strict` 的这一档:再长出一个超限文件即当场拦。
(function checkFileSizeRatchet() {
  const names = Object.keys(oversizedFiles).sort();
  const prev = fs.existsSync(FILE_SIZE_BASELINE)
    ? JSON.parse(fs.readFileSync(FILE_SIZE_BASELINE, "utf8"))
    : null;
  const prevFiles = prev?.files ?? null;
  /** 基线里这个文件的**同口径行数**:按 baselineRev 的内容、今天的计数口径重数。
   *  取不到(旧基线 / 文件当时不存在 / git 不可用)时退回基线上的记录值 ——
   *  退回是「按历史行为比」,只会更严,不会漏放。 */
  const baseLinesOf = (f, recorded) =>
    linesAtRev(BASELINE_REV_USABLE ? prev?.baselineRev : null, f) ?? recorded;
  /** 基线修订号存在却不可达 ⇒ 同口径重数做不了,只能退回记录值(见文件头)。 */
  const baseRevMissing = Boolean(prev?.baselineRev) && !BASELINE_REV_USABLE;

  if (UPDATE) {
    /* 「有文件没读到」时一律拒绝重记基线（§11 那一族的棘轮同口径）：把一次不完整的
     * 读数写进基线，等于让那些条目从此报不出来 —— 下一轮它会以「基线里没有」的形态
     * 重新变成新增。消失的条目本来就可能是超限文件（读不到行数 ⇒ 不在 `oversizedFiles`
     * 里 ⇒ 被算成「已修好」），这一支必须关掉。 */
    if (vanished > 0) {
      console.error(
        "[structure] R5 基线拒绝更新:本轮有 " +
          vanished +
          " 个条目在遍历期间消失(并发变更),读数不完整 —— 基线里没有它们不代表它们不超限。" +
          "\n  等扫描面稳定后重跑(理由与同族棘轮一致,见规范 §11 那一族的「棘轮类拒绝 --update」)。",
      );
      process.exit(1);
    }
    const prevTotal = prevFiles ? Object.keys(prevFiles).length : 0;
    /* 棘轮只许下降;唯一例外是判据版本抬升(旧数字与新计数不是同一个量)。 */
    const ruleChanged =
      Boolean(prevFiles) && prev.ruleVersion !== R5_RULE_VERSION;
    const grew = prevFiles
      ? names.filter((f) => f in prevFiles && oversizedFiles[f] > prevFiles[f])
      : [];
    const added = prevFiles ? names.filter((f) => !(f in prevFiles)) : [];
    if (
      prevFiles &&
      (grew.length || added.length || names.length > prevTotal) &&
      !ruleChanged
    ) {
      console.error(
        "[structure] 拒绝放宽 R5 基线(棘轮只许下降):" +
          (grew.length ? " 变大 " + grew.join(", ") : "") +
          (added.length ? " 新增 " + added.join(", ") : "") +
          "\n  新增的先拆分,不要用 --update 掩盖。" +
          "\n  若确属判据变更(现为 R5_RULE_VERSION=" +
          R5_RULE_VERSION +
          "),须先改脚本里的常数再 --update。",
      );
      process.exit(1);
    }
    fs.writeFileSync(
      FILE_SIZE_BASELINE,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          ruleVersion: R5_RULE_VERSION,
          note:
            "超 " +
            SPLIT_HINT_LINES +
            " 行的文件(规范 §12.6 R5 / ISSUE #575)。" +
            "棘轮只许下降:新增超限文件须先拆分,再收紧基线。" +
            "比对前按 `baselineRev` 的内容**同口径重数**基线行数(见脚本注释)。",
          threshold: SPLIT_HINT_LINES,
          baselineRev: headRev(),
          total: names.length,
          files: Object.fromEntries(names.map((f) => [f, oversizedFiles[f]])),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "[structure] R5 基线已更新:" +
        names.length +
        " 个超限文件(scripts/.file-size-baseline.json)" +
        (ruleChanged
          ? "【判据版本 " +
            (prev.ruleVersion ?? "?") +
            " → " +
            R5_RULE_VERSION +
            ",一次性重记】"
          : ""),
    );
    if (!BASELINE_REV_USABLE) {
      console.warn(
        "[structure] 警告:新记的基线修订号在本检出里取不到 —— 同口径重数会退化成\n" +
          "  拿记录值直接比。浅克隆 / 只取单分支的 CI 请先 git fetch --unshallow。",
      );
    }
    return;
  }

  // 非 strict 只提醒、不判失败 —— 那是一步快跑口径;pre-commit 的那一步带 --strict。
  if (!STRICT) return;

  if (!prevFiles) {
    problems.push(
      "R5 基线文件缺失:先执行 node scripts/check-file-structure.cjs --update",
    );
    return;
  }
  for (const f of names) {
    const base = prevFiles[f];
    if (base === undefined) {
      problems.push(
        "R5 新增超限文件(" +
          f +
          " → " +
          oversizedFiles[f] +
          " 行,阈值 " +
          SPLIT_HINT_LINES +
          ")。先拆分,再收紧基线(规范 §12.6 R5)",
      );
    } else if (oversizedFiles[f] > baseLinesOf(f, base)) {
      const baseline = baseLinesOf(f, base);
      /* 取不到基线修订号 ⇒ 比的是「两个格式时代的绝对行数」,差值不构成判据。
       * 把这支单独报出来:它的可行动作是**重记基线**,不是拆文件。 */
      if (baseRevMissing) {
        problems.push(
          "R5 基线修订号 " +
            prev.baselineRev +
            " 在本检出里取不到(" +
            f +
            " → 记录值 " +
            base +
            " → 当前 " +
            oversizedFiles[f] +
            " 行)。同口径重数无法进行,比的是两个格式时代的绝对行数 —— " +
            "先补历史(git fetch --unshallow),再执行 node scripts/check-file-structure.cjs --update 重记基线(规范 §12.13.3)",
        );
        continue;
      }
      problems.push(
        "R5 超限文件继续变大(" +
          f +
          " → " +
          base +
          " → " +
          oversizedFiles[f] +
          " 行" +
          (baseline === base ? "" : ";按同口径重数基线为 " + baseline + " 行") +
          ")。拆分或收紧基线(规范 §12.6 R5)",
      );
    }
  }
  const shrunk = names.filter(
    (f) =>
      prevFiles[f] !== undefined &&
      oversizedFiles[f] < baseLinesOf(f, prevFiles[f]),
  );
  const removed = Object.keys(prevFiles).filter((f) => !(f in oversizedFiles));
  if (shrunk.length || removed.length) {
    console.log(
      "[structure] R5 基线可收紧(执行 --update):" +
        [...shrunk, ...removed].map((f) => "\n  · " + f).join(""),
    );
  }
})();

if (splitHints.length) {
  console.log(
    "[structure] 拆分候选" +
      (STRICT ? "" : "(仅提醒)") +
      ":\n  " +
      splitHints.join("\n  "),
  );
}
if (problems.length) {
  /* 消失数两条出口都要给：只在绿色那一行给，等于「判据报红时覆盖范围不可见」——
   * 而那恰恰是最需要读数的时刻（报红的这一轮到底看全了没有）。 */
  console.error(
    "[structure] 违规(阻断提交):\n  " +
      problems.join("\n  ") +
      vanishedNote(vanished),
  );
  console.error(
    "规范见 docs/standards/12-代码组织与文件结构.md §12.6/§12.8/§12.11",
  );
  console.error(
    "      以及 docs/standards/launch-and-build.md §8(Windows 入口 .ps1 化)",
  );
  process.exit(1);
}
console.log("[structure] OK" + vanishedNote(vanished));
