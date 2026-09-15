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

checkPairs();
checkSingleSource();

if (problems.length > 0) {
  console.error("[ps1-consistency] 违规：");
  for (const p of problems) console.error("  - " + p);
  console.error("");
  console.error(`  规范：docs/standards/launch-and-build.md §9（跨平台模式）与 §9.5（跨平台动作对照表）`);
  process.exit(1);
}
console.log("[ps1-consistency] 跨平台动作对照与单点定义 OK ✓");
