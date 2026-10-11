#!/usr/bin/env node
/**
 * check-ps1-consistency.mjs — 两个平台上的「同一件事」不得分叉（规范 §9）
 *
 * 背景：Windows 入口一律 `.ps1`（规范 §8），而 Linux / macOS 上跑不了 `.ps1`。
 * 于是同一个动作（跑门禁 / 只跑测试 / 校验端口推导 / 生成文档）在两侧各有一份
 * 实现 —— 这正是历史上启动编排踩过的坑（Windows 一条 `.ps1` 链、POSIX 一条
 * `.mjs` 链，各自演进，靠「记得同步另一侧」维持，而漏同步是静默的）。
 *
 * 本门禁把两条约定机器化：
 *
 *   ① **动作对** 一一对应：每条 `.mjs` 都必须在 `launch-and-build.md` §9.5 的
 *      对照表里登记，且表中每一条的 `.ps1`/`.mjs` 两侧文件都真实存在。
 *      新增一个跨平台动作却忘了另一侧 → 这里失败（而不是等用户在另一个平台上
 *      发现「文档里那条命令不存在」）。
 *
 *   ② **会失效的标记不许各写一份**：`KNOWN_FAILED_FILES`（已知基线失败清单）
 *      只允许在 `scripts/quality-gate-shared.mjs` 里定义一次；两侧的 `.ps1`
 *      只能是**读取**它。此前它定义在 `quality-gate.ps1` 里、由 `run-tests.ps1`
 *      正则解析 `.ps1` 源码 —— 那等于把另一门语言的源码当数据源，改一次写法
 *      就静默返回空数组，而「排除项悄悄为空」看起来就像「本来就没有基线失败」。
 *
 * 用法：node scripts/check-ps1-consistency.mjs
 * 退出码：0 通过；1 违规。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

/** 跨平台动作对照表所在的规范文档（唯一登记处）。 */
const SPEC_REL = "docs/standards/launch-and-build.md";
/** 清单类标记的单点定义处。 */
const SHARED_REL = "scripts/quality-gate-shared.mjs";
/** 本门禁自身（它的正则里会出现被检标记的字面量，必须跳过自己）。 */
const SELF_REL = "scripts/check-ps1-consistency.mjs";
/** 标注为「跨平台动作对」的表格锚点：以它开头的代码行才算登记。 */
const PAIR_MARKER = "<!-- cross-platform-pairs -->";

/**
 * README 里那两张「入口表」的标题（**唯一的入口清单**）。
 *
 * 为什么这里要解析它们：`tools/<分类>/` 的结构由 R9 守着（根目录不许散落 `.ps1`），
 * 而 R9 的注释把「入口的 discoverability」明确托付给了 README —— 也就是说
 * **README 那张表就是入口清单的权威**。但它此前一个字都没有判据：表里的路径写错了
 * （改名 / 搬目录 / 写了个从不存在的文件）、或新加了一个入口却忘了登记，两件事
 * 都不构成本地任何一层变红，只有用户双击时才发现「文档里那条命令不存在」。
 *
 * 两张表分工不同，所以判据也不同：
 *   ①「双击入口速查（Windows）」两列 —— 左列「我想…」、右列 `.ps1` 路径；
 *   ②「同一件事在 Linux / macOS / CI 上怎么写」三列 —— 中列 `pnpm` 命令、
 *      右列「对应 Windows 双击」。
 */
const README_REL = "README.md";
/** Windows 双击入口表的标题（从它开始、到下一个二级标题为止）。 */
const README_WINDOWS_SECTION = "## 双击入口速查（Windows）";
/** 跨平台入口表的标题。 */
const README_CROSS_SECTION = "### 同一件事在 Linux / macOS / CI 上怎么写";
/** 逻辑脚本目录：与入口同名不同层，**不是**双击入口（`tools/README.md` 的对照表）。 */
const ENTRY_LOGICS_DIR = "tools/scripts/";
/** 后缀 `.logic.ps1` 的也是逻辑层（`tools/database-studio/start-database-studio.logic.ps1`）。 */
const LOGIC_SUFFIX = ".logic.ps1";
/**
 * 入口清单的**第二站**：`tools/README.md` 的「全目录视图」。
 *
 * README 的「双击入口速查」表刻意只收**日常动作**（我能双击它做什么），而构建 / Registry /
 * Studio 那几类指向它自己的清单 —— 「完整表见 `tools/README.md`」。所以 discoverability
 * 的权威是**两份文档**：README 那张表（日常动作）+ `tools/README.md`（全量入口）。
 * 本条判据因此判「**至少出现在其中一处**」，不是「必须出现在 README 那张表里」——
 * 后者会把「README 表只收日常动作」这个刻意的克省判成违规。
 */
const TOOLS_INDEX_REL = "tools/README.md";

/**
 * 已登记为「**两份清单都不收**」的条目 —— **逐条给理由**，不是赦免名单。
 *
 * 只允许收「它不是一个供人双击的独立用途」这一种（构建内联逻辑 / 一次性补生成工具）。
 * **新增入口必须能说出「为什么两份清单都不收它」**，说不出来就该去登记 ——
 * 那正是本条判据要逼出来的动作。名单越短越好；判据同时核「指向的文件真实存在」
 * 与「已经登记过了却还留在这」（过期账 / 会静默放行退回），与 §12.16 的口径一致。
 */
const ENTRY_LIST_EXEMPT = {};

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * 解析规范里的对照表：`<!-- cross-platform-pairs -->
 *  | `a.mjs` | `b.ps1` | ... |` 形式的 Markdown 表行。
 */
function parsePairs() {
  const spec = read(SPEC_REL);
  if (spec === null) {
    problems.push(`缺少规范文档：${SPEC_REL}`);
    return [];
  }
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(PAIR_MARKER));
  if (start < 0) {
    problems.push(`${SPEC_REL} 缺少 ${PAIR_MARKER} 标记（跨平台动作对照表的锚点）`);
    return [];
  }
  const pairs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) {
      if (pairs.length > 0) break;
      continue;
    }
    if (/^\|[\s|:-]+\|$/.test(line)) continue; // 表头下的分隔行
    // 单元格里可能是裸路径，也可能带补充说明（`a/b.mjs`（`pnpm xxx`））——
    // 用「反引号里的、看起来像仓库内路径的 token」而不是「整格恰好是一个路径」，
    // 否则写清楚用法的那一格会被漏掉，门禁就会对新增动作一声不吭。
    const files = [...line.matchAll(/`([\w./-]+\.(?:ps1|mjs|cjs|py))`/g)].map((m) => m[1]);
    if (files.length === 0) continue;
    pairs.push(files);
  }
  return pairs;
}

/**
 * ① 动作对：每一行都必须同时给出 `.ps1` 与跨平台侧的脚本，且两侧文件真实存在。
 *
 * 判据落在**每一行**上而不是「整张表出现过 .mjs」：后者会被「一行只有 .ps1、
 * 另一行只有 .mjs」蒙混过去 —— 而那正是「只写了一侧」的形态。
 */
function checkPairs() {
  const rows = parsePairs();
  if (rows.length === 0) {
    problems.push(`${SPEC_REL} 的跨平台动作对照表为空（登记被删 = 门禁静默失效）`);
    return;
  }
  for (const row of rows) {
    const ps1s = row.filter((f) => f.endsWith(".ps1"));
    const others = row.filter((f) => /\.(mjs|cjs|py)$/.test(f));
    if (ps1s.length === 0 || others.length === 0) {
      problems.push(
        `跨平台动作对照表有一行只登记了一侧：${row.join(" / ") || "(解析不到脚本路径)"}` +
          `（每个动作必须同时给出 .ps1 与跨平台侧脚本）`,
      );
    }
    for (const rel of row) {
      if (!fs.existsSync(path.join(ROOT, rel))) {
        problems.push(`跨平台动作对照表登记的脚本不存在：${rel}`);
      }
    }
  }
}

/**
 * ② 单点定义：会「静默失效」的清单标记不许在别处再定义一份。
 *
 * 判据刻意简单：**出现了 `$KNOWN_FAILED_FILES =` 这个赋值**就算又定义一份。
 * 「从共享模块读进来的」那种写法（`@(Get-KnownFailedFilesFromShared)`）不需要
 * 用变量承接 —— 门禁一上线就先放过自己想要的形态，等于逼人绕开它。真实用法是
 * `Get-KnownFailedFilesFromShared` 直接内联，或读进一个局部变量（局部名不同）。
 */
/**
 * 是否在别处**又定义了一份**字面量清单。
 *
 * 只认「等号右边直接是字面量 / 数组字面量」的形态；`@(Get-KnownFailedFilesFromShared)`
 * 这类读取不算 —— 门禁一上线就先误伤正确写法，等于逼人绕开它。
 * 正则里的 `KNOWN_FAILED_FILES` 用拼接写，免得本脚本自己被自己的规则命中。
 */
function definesLiteral(text) {
  const NAME = "KNOWN_" + "FAILED_FILES";
  const re = new RegExp(`(?:export\\s+const\\s+)?\\$?${NAME}\\s*=\\s*(?:@\\s*\\(\\s*)?[\"']`, "g");
  return re.test(text);
}

function checkSingleSource() {
  const shared = read(SHARED_REL);
  if (shared === null) {
    problems.push(`缺少共享常量模块：${SHARED_REL}`);
  } else if (!/export\s+const\s+KNOWN_FAILED_FILES\s*=/.test(shared)) {
    problems.push(`${SHARED_REL} 未导出 KNOWN_FAILED_FILES（单点定义被破坏）`);
  }
  for (const dir of ["scripts", "tools"]) {
    for (const rel of walk(dir)) {
      if (!/\.(ps1|mjs)$/.test(rel)) continue;
      if (rel === SHARED_REL || rel === SELF_REL) continue;
      const text = read(rel) ?? "";
      if (definesLiteral(text)) {
        problems.push(
          `${rel} 里又定义了一份 KNOWN_FAILED_FILES —— 它会静默失效（漏改一处即红/绿不可归因），` +
            `必须从 ${SHARED_REL} 读取`,
        );
      }
    }
  }
}

/** 遍历目录下所有文件（相对仓库根的 POSIX 路径）。 */
function walk(dir) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__pycache__") continue;
      out.push(...walk(rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * ③ README 的「入口清单」表 + `tools/README.md` 的全目录视图：入口 discoverability
 * 的**唯一落点**，此前无判据。
 *
 * R9 把「根目录不许散落 `.ps1`」机器化了，理由写在它的注释里：入口一律归
 * `tools/<分类>/`，**根入口的 discoverability 由 README 的入口清单承担**。
 * 于是「新加一个入口」这件事有两条腿 —— 放对目录（R9 管）、登记进清单（此前没人管）。
 * 本条把第二条腿补上，判三件（每一件都有「静默」的失效形态）：
 *
 *   1. **清单 → 磁盘**：两张表里写出的每个 `.ps1` 路径必须真实存在。
 *      失效形态：入口改名或搬目录后表里留着旧路径，用户照着双击才发现。
 *   2. **`pnpm` 命令 → `package.json`**：跨平台表里写的命令必须是真实的脚本名。
 *      失效形态：脚本改名后表里留着旧名，而它读起来像一条能跑的命令。
 *   3. **磁盘 → 清单**：`tools/**` 下的双击入口必须出现在 README 那张表**或**
 *      `tools/README.md` 的全目录视图里（或在 `ENTRY_LIST_EXEMPT` 里逐条说明
 *      为什么两份都不收）。失效形态：新入口默默可用而**没人知道它存在** ——
 *      与「铺在根目录第一眼看见」被 R9 否掉后所依赖的那条承诺正好相反。
 */

/** 把 README 里某一节切出来（从标题行到下一个同级或更高级标题为止）。 */
function readmeSection(title) {
  const text = read(README_REL);
  if (text === null) return null;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === title);
  if (start < 0) return null;
  const level = title.match(/^#+/)?.[0].length ?? 2;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/**
 * 按给定的正则取出捕获组 1 —— 调用点各自决定「收什么形状」。
 *
 * 为什么不让这一层自己判「什么算路径」：表格里的行内代码有三类 —— **路径**
 * （`tools/start/start-web.ps1`）、**命令**（`pnpm dev`）、**标志**（`-Full`），
 * 而它们混在同一格文字里。一刀切成「反引号里的都是路径」会把后两类全判成
 * 「文件不存在」。所以形状由各调用点的正则负责，这一层只做提取。
 */
function pathsIn(text, re) {
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** 收集磁盘上真实存在的双击入口（`tools/**`，排除逻辑层）。 */
function diskEntries() {
  const out = [];
  for (const rel of walk("tools")) {
    if (!rel.endsWith(".ps1")) continue;
    if (rel.startsWith(ENTRY_LOGICS_DIR)) continue; // 逻辑脚本不是入口
    if (rel.endsWith(LOGIC_SUFFIX)) continue; // `.logic.ps1` 的也是逻辑层
    out.push(rel);
  }
  return out.sort();
}

function checkReadmeEntryList() {
  const windows = readmeSection(README_WINDOWS_SECTION);
  const cross = readmeSection(README_CROSS_SECTION);
  if (windows === null) {
    problems.push(
      `${README_REL} 缺少「${README_WINDOWS_SECTION}」一节 —— 它是入口清单的权威，` +
        `删掉 = 入口的 discoverability 承诺失去落点（R9 的注释把它托付在这里）`,
    );
    return;
  }
  if (cross === null) {
    problems.push(`${README_REL} 缺少「${README_CROSS_SECTION}」一节（跨平台入口对照）`);
    return;
  }

  // ── 1. README → 磁盘 ────────────────────────────────────────────────
  // 两张表都可能有 `tools/…` / `scripts/…` 的路径 token。判据统一：写出来的
  // 每条路径都要真实存在（`tools/build/*.ps1` 这种通配形态按「至少命中一个」判）。
  for (const [section, label] of [
    [windows, "双击入口速查"],
    [cross, "跨平台入口对照"],
  ]) {
    const found = pathsIn(section, /`((?:tools|scripts)\/[\w./-]+\.ps1)`/g);
    for (const rel of found) {
      if (!fs.existsSync(path.join(ROOT, rel))) {
        problems.push(
          `${README_REL} 的「${label}」列了不存在的入口：${rel}` +
            `（入口搬了目录 / 改了名，而表没跟着改 —— 用户照着双击才发现）`,
        );
      }
    }
    // 通配形态单列：`tools/build/*.ps1` 必须真的命中脚本，否则那是张空承诺。
    for (const pattern of pathsIn(section, /`(tools\/[\w-]+\/)\*\.ps1`/g)) {
      const dir = path.join(ROOT, pattern);
      const hit = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith(".ps1"))
        : [];
      if (hit.length === 0) {
        problems.push(
          `${README_REL} 的「${label}」用了通配 \`${pattern}*.ps1\`，但该目录下没有脚本` +
            `（通配写错目录时它看起来仍像一条能走的路径）`,
        );
      }
    }
  }

  // ── 2. `pnpm` 命令 → `package.json` ──────────────────────────────
  const pkgText = read("package.json");
  let scripts = {};
  if (pkgText !== null) {
    try {
      scripts = JSON.parse(pkgText).scripts ?? {};
    } catch {
      problems.push("package.json 解析失败（跨平台入口表的命令无法核对）");
    }
  }
  // `pnpm install` 是包管理器的内建命令，不在 `scripts` 里；它出现在依赖同步
  // 那一格是正当的（`pnpm install && pnpm lint`）。
  const PNPM_BUILTIN = new Set(["install", "dlx", "exec", "run"]);
  for (const name of pathsIn(cross, /`pnpm\s+([\w:@.-]+)/g)) {
    if (PNPM_BUILTIN.has(name)) continue;
    // `pnpm run test:coverage` 这类带 `run` 的形态由上面那个 token 吃掉 `run`，
    // 真正的脚本名在它后面 —— 单独再收一遍。
    if (!(name in scripts)) {
      problems.push(
        `${README_REL}「${README_CROSS_SECTION}」写了 \`pnpm ${name}\`，` +
          `而 package.json 里没有这条脚本（脚本改名后表里留着旧名，读起来像能跑的）`,
      );
    }
  }
  for (const m of cross.matchAll(/`pnpm\s+run\s+([\w:@.-]+)/g)) {
    if (!(m[1] in scripts)) {
      problems.push(
        `${README_REL}「${README_CROSS_SECTION}」写了 \`pnpm run ${m[1]}\`，` +
          `而 package.json 里没有这条脚本`,
      );
    }
  }

  // ── 3. 磁盘 → 两份清单（+ 豁免逐条给理由）──────────────────────────
  // dailyActions = README 那张表里的入口（我双击它做什么）。
  const dailyActions = new Set(
    pathsIn(windows, /`(tools\/[\w./-]+\.ps1)`/g).map((p) => p),
  );
  // index = `tools/README.md` 的「全目录视图」里的入口（全量，含按用途成组的那些）。
  // 两处的路径写法不同（README 表写 `tools/start/x.ps1`，tools/README.md 的目录表写
  // `start/x.ps1`），所以索引侧按「`tools/` 后面的尾段」认。
  const indexText = read(TOOLS_INDEX_REL);
  if (indexText === null) {
    problems.push(`缺少 ${TOOLS_INDEX_REL} —— 入口清单的第二站没了（README 明确把完整表指向它）`);
  }
  const indexed = new Set(
    (indexText === null ? [] : [...indexText.matchAll(/`((?:tools\/)?[\w-]+\/[\w.-]+\.ps1)`/g)])
      .map((m) => m[1])
      .map((p) => (p.startsWith("tools/") ? p : `tools/${p}`)),
  );
  for (const rel of diskEntries()) {
    if (dailyActions.has(rel) || indexed.has(rel)) continue;
    if (rel in ENTRY_LIST_EXEMPT) continue;
    problems.push(
      `双击入口 ${rel} 在两份清单里都没有登记（${README_REL} 的「${README_WINDOWS_SECTION}」表、` +
        `${TOOLS_INDEX_REL} 的全目录视图）—— 它现在**可用但没有人知道它存在**` +
        `（R9 把入口 discoverability 托付给这两份文档）。请补一处，或在` +
        ` check-ps1-consistency.mjs 的 ENTRY_LIST_EXEMPT 里逐条说明「为什么两份都不收」`,
    );
  }
  // 豁免名单自身也要对得上磁盘：指向不存在文件 = 过期账；已经在某份清单里 =
  // 会静默放行「下一个人把它从清单里删回去」。与覆盖率台账同一手法（§12.16 的口径）。
  for (const [rel, reason] of Object.entries(ENTRY_LIST_EXEMPT)) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      problems.push(`ENTRY_LIST_EXEMPT 里的 ${rel} 在磁盘上不存在（过期账）`);
    }
    if (dailyActions.has(rel) || indexed.has(rel)) {
      problems.push(
        `ENTRY_LIST_EXEMPT 里的 ${rel} 已经在清单里登记过了 —— ` +
          `两处同时存在会静默放行「下一个人把它从清单里删回去」`,
      );
    }
    if (!reason || reason.trim() === "") {
      problems.push(`ENTRY_LIST_EXEMPT 里的 ${rel} 没有给理由（逐条给理由，不是赦免名单）`);
    }
  }
  // 表里也不能出现**逻辑脚本**：`tools/scripts/*.ps1` 与 `*.logic.ps1` 是同名
  // 不同层的实现，双击它们不是任何人的用法（它们由入口调用）。
  for (const rel of dailyActions) {
    if (rel.startsWith(ENTRY_LOGICS_DIR) || rel.endsWith(LOGIC_SUFFIX)) {
      problems.push(
        `${README_REL} 的「双击入口速查」表列了逻辑脚本 ${rel} ——` +
          `它是入口背后的实现（同名不同层），不该作为「我想…就双击它」的落点`,
      );
    }
  }
}

checkPairs();
checkSingleSource();
checkReadmeEntryList();

if (problems.length > 0) {
  console.error("[ps1-consistency] 违规：");
  for (const p of problems) console.error("  - " + p);
  console.error("");
  console.error(`  规范：docs/standards/launch-and-build.md §9（跨平台模式）与 §9.5（跨平台动作对照表）`);
  process.exit(1);
}
console.log("[ps1-consistency] 跨平台动作对照与单点定义 OK ✓");
