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
 *   R5  src/ 下超 900 行的文件即阻断(**硬闸**,无基线、无 `--strict`)。
 *       扫描范围是**整个 src/**:页面的纯展示视图在 src/app/,逻辑文件在
 *       src/lib/——只扫 components 会让当时最大的那几个文件完全落在护栏之外(ISSUE #536)。
 *       出口只有一个:拆。
 *       **为什么不留棘轮**(ISSUE #575 立它、ISSUE #1811 收掉它):「只提醒」挡不住
 *       新增长文件(提醒是一屏里的一行字,没有人会为它返工,于是文件只增不减),
 *       所以先是加了棘轮;存量清零后棘轮的两个动作**都无事可做**(`--update` 无余地、
 *       `--strict` 恒绿),留下的却是一条「手改那份 JSON 就能把新超限文件登记成
 *       已知存量」的通道 —— 那正是硬闸类本来没有的中间态(§13.6.2 的两类对照)。
 *       同一维度在基础设施层(`scripts/**` / `tools/**`)由
 *       `check-infra-file-size.cjs` 同口径硬闸守着(§12.6 的姊妹档)。
 *       **连带收掉的是整套 `baselineRev` 机制**(ISSUE #637):它存在只为让「基线那一刻的
 *       行数」与「今天的行数」在**同一个格式口径**下可比(全库 prettier 治理会让
 *       一字未改的文件凭空多出几十行)。没有基线就没有「两个格式时代」要拉平 ——
 *       判据退化成一句「这份文件现在是不是超过 900 行」。
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
/** 遍历途中消失的条目数（目录级 + 文件级）。要进结论行，不许静默跳过。 */
let vanished = 0;
/** R5 用:超限文件 → 行数(路径为仓库相对路径)。 */
const oversizedFiles = {};

/** R5 的文件行数阈值:超过即阻断(与 §12.6 的姊妹档 `check-infra-file-size.cjs` 同一个数)。 */
const SPLIT_HINT_LINES = 900;

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

/* 无 `--update` / `--strict`:R5 已是硬闸(ISSUE #1811 收掉那两条通道),
 * 而它们是这份脚本里唯一读 ARGS 的地方 —— 旗标整个删掉,不留「传了也没用」的
 * 参数契约(那种形态会让人以为还能登记存量)。 */




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

// ── R5 的读数:src/ 下超 900 行的文件 ──
// 扫描范围是**整个 src/**,不分层也不分文件类型:
//   · src/app/       页面的「纯展示视图」;
//   · src/lib/       逻辑文件;
//   · src/components/、src/server/  组件与服务端。
// 只扫 components(历史口径)会让「最大的那个文件」永远不被提醒;把范围缩到
// .tsx 会让逻辑文件同样漏网。行数超了就该拆,与它是不是组件、落在哪一层都无关。
// App Router 的保留文件(page/layout/route)一并计入。
// 测试文件与 `.d.ts` 排除:用例体量不是可维护性信号。
// 与函数长度门禁(check-function-length.cjs §12.13)的分工:那个管**函数**(400 行),
// 这个管**文件**(900 行);两条维度不可互相替代,也都是硬闸。
(function collectOversizedFiles() {
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

// ── R5:超 900 行的文件即阻断 ──
// 硬闸,无基线。上面 collectSplitHints 收的 oversizedFiles 就是全部读数 ——
// 一条 problem 一个文件,报的是「哪一份、多少行」,出口只有一个:拆。
// 不设排除清单:一份「这些文件不受本条约束」的白名单正是最容易静默失效的形状
// (改名 / 挪目录就看不见 = 假绿;同 `check-infra-file-size.cjs` 的口径)。
for (const [f, n] of Object.entries(oversizedFiles).sort((a, b) => b[1] - a[1])) {
  problems.push(
    "R5 超限文件(" +
      f +
      " → " +
      n +
      " 行,阈值 " +
      SPLIT_HINT_LINES +
      ")。拆分(规范 §12.6 R5)",
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
