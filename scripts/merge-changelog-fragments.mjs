#!/usr/bin/env node
/**
 * merge-changelog-fragments.mjs —— 把 changelog.d 的碎片并入 CHANGELOG.md
 *
 * 碎片约定与理由见 changelog.d/README.md 与规范 13.10.5(ISSUE #408)。
 * 本脚本是碎片流程的「另一半」:碎片负责**并发不冲突**地收集,本脚本负责在
 * **发版/整理时**按 Keep a Changelog 的固定段落顺序拼进 [Unreleased]。
 *
 * ── 并入的位置由「来源锚」决定(规范 §13.10.6)──────────────────────────
 *
 * 落点此前是**硬编的**:`mergeInto()` 无条件找 `## [Unreleased]` 那一行、把内容贴在
 * 它正下方。后果是「碎片并入哪一段」取决于并的那一刻仓库是什么状态,与条目**实际
 * 属于哪个版本**无关 —— 而这一格此前一个判据都没有(`check-changelog-fragments.cjs`
 * 只管碎片形态、不管并入)。
 *
 * 现在每个待发段落带一行来源锚(`<!-- since: <commit> — <slug> -->`),并入时:
 *   · 把碎片的条目放进**锚最早**的那个待发段落 —— 锚写明「这一段里最早的条目是哪个
 *     提交带进来的」;
 *   · 把那个锚刷新成「本轮新增条目里最早的那一个」(缺省 = 当前 HEAD),于是锚总是
 *     「这些条目里最早的那个提交」,而不是写这条的人当时的 HEAD;
 *   · 段落本来没有锚时顺手补上 —— 并入的人手上正好有那个事实;段落的标题不动
 *     (`--release <版本>` 才把它定版成 `[x.y.z] - <今天>`)。
 *
 * 用法:
 *   node scripts/merge-changelog-fragments.mjs           并入待发段落并删除碎片
 *   node scripts/merge-changelog-fragments.mjs --check   只预览要并入的内容,不落盘
 *   node scripts/merge-changelog-fragments.mjs --anchor <commit>
 *                                                        显式指定本轮条目里最早的那个提交
 *   node scripts/merge-changelog-fragments.mjs --json    机器可读(并到哪一段、锚刷成什么)
 * 用法示例：node scripts/merge-changelog-fragments.mjs --release 0.2.0
 *                                                        并入后把待发段落定版为
 *                                                        [0.2.0] - <今天>
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRAGMENT_DIR = path.join(ROOT, "changelog.d");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");
/** Keep a Changelog 的固定段落顺序 —— 并入时按它重排,不按文件名字母序。 */
const SECTIONS = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
];
const IGNORED_FILES = new Set(["README.md"]);

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
/** 机器可读输出(`--json`):给用例与别的脚本读「并到哪一段、锚刷成了什么」。 */
const asJson = args.includes("--json");
const releaseIdx = args.indexOf("--release");
const releaseVersion = releaseIdx >= 0 ? args[releaseIdx + 1] : null;
if (releaseIdx >= 0 && !releaseVersion) {
  console.error("[merge-changelog] --release 需要版本号,如 --release 0.2.0");
  process.exit(1);
}
/* `--anchor <commit>`:本轮条目里**最早**的那个提交。缺省取当前 HEAD ——
 * 「并入这一刻」通常就是那一次提交(碎片是随那次改动一起写的,§13.10.4)。 */
const anchorIdx = args.indexOf("--anchor");
const anchorRevArg = anchorIdx >= 0 ? args[anchorIdx + 1] : null;
if (anchorIdx >= 0 && !anchorRevArg) {
  console.error("[merge-changelog] --anchor 需要提交引用,如 --anchor 9321411");
  process.exit(1);
}

/** 读取所有碎片,按段落聚合(段落内保持文件名字典序,保证输出稳定可复现)。 */
function readFragments() {
  if (!fs.existsSync(FRAGMENT_DIR)) return [];
  const files = fs
    .readdirSync(FRAGMENT_DIR)
    .filter((n) => n.endsWith(".md") && !IGNORED_FILES.has(n))
    .sort();
  const out = [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(FRAGMENT_DIR, name), "utf8");
    const lines = text.split("\n").map((l) => l.trimEnd());
    const first = lines.find((l) => l.trim() !== "");
    if (first === undefined) continue;
    const section = first.replace(/^#{1,6}\s*/, "").trim();
    if (!SECTIONS.includes(section)) {
      console.error(
        `[merge-changelog] 碎片 ${name} 首行不是段落标题(应为 ## Added / ## Fixed …)。` +
          `先跑 node scripts/check-changelog-fragments.cjs 修好再并入。`,
      );
      process.exit(1);
    }
    const body = lines
      .slice(lines.indexOf(first) + 1)
      .join("\n")
      .trim();
    if (!body) continue;
    out.push({ name, section, body });
  }
  return out;
}

/** 来源锚 —— `<!-- since: <commit> — <slug> -->`(规范 §13.10.6)。 */
const ANCHOR_RE = /<!--\s*since:\s*([0-9a-f]{7,40})\s*(?:—|--|-)\s*(.+?)\s*-->/;

/**
 * 这个标题是不是「待发段落」——`## [Unreleased]`,外加仓库自己写过的 `## [未发布]`。
 *
 * ⚠️ **带日期的 `## [x.y.z] - <日期>` 不算待发**。这一条与判据
 * (`check-changelog-versions.cjs` 的 `VERSION_RE` 那一段)同源,而它有一个**具体的**
 * 后果:把已定版的版本段落也算进来,并入的落点就会落到**已经切出去的那一版**上 ——
 * 新条目被记进一个已经发布的版本里,而那个版本号背后的日期是**过去**的。
 * (`--release` 把待发段落写成带日期的版本段落之后,下一次并入应当落在**新开的**
 * 待发段落上;仓库里没有待发段落时脚本报错,由人先开一个。)
 * @param {string} title
 */
function isPendingTitle(title) {
  return /^\[(?:unreleased|未发布)\]/i.test(title);
}

/**
 * 待发段落清单(**按来源锚最早者优先**排序 —— 锚写明「这一段里最早的条目是哪个提交
 * 带进来的」,所以并入的位置由锚决定,不由「谁排在文件最上面」决定)。
 *
 * 没有锚的待发段落也收进来:它们是**缺锚存量**,排在带锚的之后、按文件顺序。
 *
 * @param {string[]} lines
 * @returns {{start: number, title: string, rev: string | null, slug: string | null}[]}
 */
function pendingSections(lines) {
  const out = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m || !isPendingTitle(m[1])) return;
    /* 锚只认段落开头几行 —— 认成「段落里任意一行有 `<!-- since:`」会让正文里一句
     * **讨论锚本身**的话被当成本段落的锚。 */
    let rev = null;
    let slug = null;
    for (const probe of lines.slice(i + 1, i + 7)) {
      const a = ANCHOR_RE.exec(probe);
      if (a) {
        rev = a[1];
        slug = a[2];
        break;
      }
    }
    out.push({ start: i, title: m[1], rev, slug });
  });
  return out;
}

/**
 * 锚是不是一个真提交 —— **只读 git,零网络**。
 *
 * 取不到 `git` 本身(裸目录 / tarball 解包的检出 / 工具链缺失)时返回 `null`,按
 * 「判不了」处理并**说出来**,不静默当通过(同 §11.23.3 那条「判据不许静默降级」)。
 * @param {string} rev
 * @returns {boolean | null}
 */
function anchorIsCommit(rev) {
  try {
    childProcess.execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    try {
      childProcess.execFileSync("git", ["--version"], { stdio: "ignore" });
      return false;
    } catch {
      return null;
    }
  }
}

/**
 * 把碎片段落并进**带锚的那个待发段落**;返回新的 CHANGELOG 文本与落点读数。
 *
 * @param {string} changelogText
 * @param {{name: string, section: string, body: string}[]} fragments
 * @param {string | null} version
 * @param {string} anchorRev 本轮条目里最早的提交(刷新锚用)
 * @returns {{text: string, target: string, refreshed: boolean, anchor: string}}
 */
function mergeInto(changelogText, fragments, version, anchorRev) {
  const lines = changelogText.split("\n");
  const pending = pendingSections(lines);
  if (pending.length === 0) {
    throw new Error(
      "CHANGELOG.md 里找不到待发段落(既没有 `## [Unreleased]`、也没有未发布的 `[x.y.z]`)",
    );
  }

  /* 落点:带锚且锚最早的那个待发段落;一个带锚的都没有时退回文件里的第一个
   * (缺锚存量,并入时顺手补锚 —— 见下面的 `anchorLine`)。 */
  const anchored = pending.filter((p) => p.rev !== null);
  anchored.sort((a, b) => (a.rev < b.rev ? -1 : a.rev > b.rev ? 1 : 0));
  const target = anchored[0] ?? pending[0];

  const start = target.start;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;

  /* 解析该待发段落的各段落,与碎片合并(同一段落:现有在前,碎片在后)。 */
  const bucket = new Map();
  let current = null;
  for (const line of lines.slice(start + 1, end)) {
    const m = line.match(/^###\s+(.+)$/);
    if (m && SECTIONS.includes(m[1].trim())) {
      current = m[1].trim();
      if (!bucket.has(current)) bucket.set(current, []);
      continue;
    }
    if (current) bucket.get(current).push(line);
  }
  for (const f of fragments) {
    if (!bucket.has(f.section)) bucket.set(f.section, []);
    bucket.get(f.section).push("", f.body);
  }

  const rebuilt = [];
  for (const section of [
    ...SECTIONS,
    ...[...bucket.keys()].filter((s) => !SECTIONS.includes(s)),
  ]) {
    if (!bucket.has(section)) continue;
    const body = bucket
      .get(section)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!body) continue;
    rebuilt.push("", `### ${section}`, "", body);
  }

  const heading = version
    ? `## [${version}] - ${new Date().toISOString().slice(0, 10)}`
    : `## ${target.title}`;

  /* 锚刷成「本轮条目里最早的那一个」,并保留原来那句 slug(它是**这一段从哪儿开始**的
   * 那句话);本来就没锚的段落顺手补一句 —— 并入的人手上正好有这个事实。 */
  const refreshed = target.rev !== anchorRev;
  const slug =
    target.slug ??
    `并入 ${fragments.length} 个碎片,最早的一条来自 ${anchorRev}`;
  const anchorLine = `<!-- since: ${anchorRev} — ${slug} -->`;

  /* 旧锚不留第二行(锚是「这一段从哪儿开始」的唯一一句话),所以整段重建而不是
   * 往里插一行 —— 重建时顺带把段落内的多空行压掉,与原来那份的行为一致。 */
  return {
    text: [
      ...lines.slice(0, start),
      heading,
      anchorLine,
      ...rebuilt,
      "",
      ...lines.slice(end),
    ].join("\n"),
    target: target.title,
    refreshed,
    anchor: anchorRev,
  };
}

/** 本地 HEAD 的短哈希 —— 缺省锚(`--anchor` 可覆盖)。 */
function headRev() {
  return childProcess
    .execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    })
    .trim();
}

const fragments = readFragments();
if (!fragments.length) {
  console.log("[merge-changelog] changelog.d/ 里没有碎片,无需并入。");
  process.exit(0);
}
const bySection = fragments.reduce(
  (acc, f) => ((acc[f.section] ??= []).push(f.name), acc),
  {},
);
console.log(
  `[merge-changelog] 待并入 ${fragments.length} 个碎片:` +
    Object.entries(bySection)
      .map(([s, ns]) => `\n  ${s}: ${ns.join(", ")}`)
      .join(""),
);

/* 锚:**本轮条目里最早的那个提交**。显式给的优先,否则取当前 HEAD —— 碎片是随那次
 * 改动一起写的(§13.10.4),所以「并入这一刻」通常就是那个提交;在合并批次 / 发版批次里
 * 并时用 `--anchor` 显式给出更早的那个。 */
let anchorRev = anchorRevArg;
if (anchorRev === null) {
  try {
    anchorRev = headRev();
  } catch (err) {
    console.error(
      `[merge-changelog] 取不到当前 HEAD(${err.message})—— 并入必须知道「这一轮条目里` +
        `最早的是哪个提交」,请用 --anchor <commit> 显式给出(裸目录 / tarball 解包的检出)`,
    );
    process.exit(1);
  }
}
if (!/^[0-9a-f]{7,40}$/.test(anchorRev)) {
  console.error(
    `[merge-changelog] --anchor 必须是一个提交对象(收到「${anchorRev}」)—— 锚是给别人` +
      `复算用的,写日期或写分支名等于没有锚(规范 §13.10.6)`,
  );
  process.exit(1);
}
/* 锚指不存在的提交 = 一条**假的**来源(判据 `check-changelog-versions.cjs` 会当场拦),
 * 这里在落盘之前就拦下来:并进去之后再发现,账上已经多了一条查不到出处的记录。 */
const anchorOk = anchorIsCommit(anchorRev);
if (anchorOk === false) {
  console.error(
    `[merge-changelog] --anchor ${anchorRev} 在本仓库历史里解析不出提交 —— 锚是` +
      `「这一段从哪儿开始」的唯一依据,写一个查不到的引用等于伪造出处(规范 §13.10.6)`,
  );
  process.exit(1);
}
if (anchorOk === null) {
  console.warn(
    "[merge-changelog] 取不到 git(裸目录 / tarball 解包的检出):锚按原样写入、**没有校验**",
  );
}

const before = fs.readFileSync(CHANGELOG, "utf8");
const merged = mergeInto(before, fragments, releaseVersion, anchorRev);
const summary = {
  target: merged.target,
  anchor: anchorRev,
  refreshed: merged.refreshed,
  fragments: fragments.map((f) => f.name),
};
if (checkOnly) {
  console.log(
    `[merge-changelog] --check:将并入「## ${merged.target}」、锚 → ${anchorRev}` +
      `${merged.refreshed ? "(变了)" : "(未变)"};未改动任何文件。`,
  );
  if (asJson) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}
fs.writeFileSync(CHANGELOG, merged.text);
for (const f of fragments) fs.rmSync(path.join(FRAGMENT_DIR, f.name));
console.log(
  `[merge-changelog] ✓ 已并入「## ${merged.target}」` +
    `${releaseVersion ? ` 并定版 ${releaseVersion}` : ""},` +
    `锚 → ${anchorRev}${merged.refreshed ? "" : "(未变)"},` +
    `删除 ${fragments.length} 个碎片。`,
);
if (asJson) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
