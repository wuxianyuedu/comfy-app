#!/usr/bin/env node
/**
 * merge-changelog-fragments.mjs —— 把 changelog.d 的碎片并入 CHANGELOG.md
 *
 * 碎片约定与理由见 changelog.d/README.md 与规范 13.10.5(ISSUE #408)。
 * 本脚本是碎片流程的「另一半」:碎片负责**并发不冲突**地收集,本脚本负责在
 * **发版/整理时**按 Keep a Changelog 的固定段落顺序拼进 [Unreleased]。
 *
 * 用法:
 *   node scripts/merge-changelog-fragments.mjs           并入 [Unreleased] 并删除碎片
 *   node scripts/merge-changelog-fragments.mjs --check   只预览要并入的内容,不落盘
 * 用法示例：node scripts/merge-changelog-fragments.mjs --release 0.2.0
 *                                                        并入后把 [Unreleased] 定版为
 *                                                        [0.2.0] - <今天>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRAGMENT_DIR = path.join(ROOT, "changelog.d");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");
/** Keep a Changelog 的固定段落顺序 —— 并入时按它重排,不按文件名字母序。 */
const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const IGNORED_FILES = new Set(["README.md"]);

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const releaseIdx = args.indexOf("--release");
const releaseVersion = releaseIdx >= 0 ? args[releaseIdx + 1] : null;
if (releaseIdx >= 0 && !releaseVersion) {
  console.error("[merge-changelog] --release 需要版本号,如 --release 0.2.0");
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
          `先跑 node scripts/check-changelog-fragments.cjs 修好再并入。`
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

/** 把碎片段落并进 [Unreleased] 正文;返回新的 CHANGELOG 文本。 */
function mergeInto(changelogText, fragments, version) {
  const lines = changelogText.split("\n");
  const start = lines.findIndex((l) => /^##\s*\[Unreleased\]/.test(l));
  if (start < 0) throw new Error("CHANGELOG.md 里找不到 `## [Unreleased]` 段落");
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;

  // 解析现有 [Unreleased] 的各段落,与碎片合并(同一段落:现有在前,碎片在后)
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
  for (const section of [...SECTIONS, ...[...bucket.keys()].filter((s) => !SECTIONS.includes(s))]) {
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
    : "## [Unreleased]";
  return [...lines.slice(0, start), heading, ...rebuilt, "", ...lines.slice(end)].join("\n");
}

const fragments = readFragments();
if (!fragments.length) {
  console.log("[merge-changelog] changelog.d/ 里没有碎片,无需并入。");
  process.exit(0);
}
const bySection = fragments.reduce((acc, f) => ((acc[f.section] ??= []).push(f.name), acc), {});
console.log(
  `[merge-changelog] 待并入 ${fragments.length} 个碎片:` +
    Object.entries(bySection)
      .map(([s, ns]) => `\n  ${s}: ${ns.join(", ")}`)
      .join("")
);
if (checkOnly) {
  console.log("[merge-changelog] --check:未改动任何文件。");
  process.exit(0);
}
const before = fs.readFileSync(CHANGELOG, "utf8");
const after = mergeInto(before, fragments, releaseVersion);
fs.writeFileSync(CHANGELOG, after);
for (const f of fragments) fs.rmSync(path.join(FRAGMENT_DIR, f.name));
console.log(
  `[merge-changelog] ✓ 已并入 CHANGELOG.md${releaseVersion ? ` 并定版 ${releaseVersion}` : ""},` +
    `删除 ${fragments.length} 个碎片。`
);
