/**
 * changelog-entry.mjs —— changelog 碎片的创建 / 清单 / 并入入口（ISSUE #5172）。
 *
 * 文件名 `<号|0>-<slug>.md`、首行 `## <段落>`、`0-` 无号出口与 `## Fixed` 要先立案，
 * 此前全靠人记；`ls changelog.d/` 也答不出「还剩哪些没并入」。校验与并入脚本已经存在，
 * 这里只把它们收成有名字的命令，不另写第二套判据。
 *
 * 用法：
 *   pnpm changelog:new <号|0> --section <Added|Changed|Fixed|Removed|Deprecated|Security> --slug <slug>
 *   pnpm changelog:list
 *   pnpm changelog:merge --check
 * 退码：0 = 成功；1 = 校验/并入失败；2 = 用法错 / 目标文件已存在。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "changelog.d");
export const SECTIONS = Object.freeze([
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
]);

/**
 * 碎片文件名。纯函数。
 *
 * @param {{number:string|number, slug:string}} input
 */
export function fragmentFileName({ number, slug }) {
  const n = String(number ?? "").trim();
  const s = String(slug ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return `${n}-${s}.md`;
}

/**
 * 读一份碎片的首行段落。
 * @param {string} file
 */
export function sectionOf(file) {
  const first = String(fs.readFileSync(file, "utf8").split(/\r?\n/)[0] ?? "").trim();
  return first.startsWith("## ") ? first.slice(3).trim() : "";
}

function listFragments() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => ({ file: f, section: sectionOf(path.join(DIR, f)) }));
}

/** @param {string[]} argv */
function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "new") {
    const number = rest[0];
    const sectionAt = rest.indexOf("--section");
    const slugAt = rest.indexOf("--slug");
    const section = sectionAt === -1 ? "" : String(rest[sectionAt + 1] ?? "");
    const slug = slugAt === -1 ? "" : String(rest[slugAt + 1] ?? "");
    if (!number || !/^(?:\d{2,}|0)$/.test(number) || !SECTIONS.includes(section) || !slug) {
      process.stderr.write(
        `用法：pnpm changelog:new <号|0> --section <${SECTIONS.join("|")}> --slug <slug>\n`,
      );
      return 2;
    }
    const name = fragmentFileName({ number, slug });
    const file = path.join(DIR, name);
    if (fs.existsSync(file)) {
      process.stderr.write(`[changelog:new] ${name} 已存在，拒绝覆盖。\n`);
      return 2;
    }
    fs.writeFileSync(file, `## ${section}\n- \n`, "utf8");
    process.stdout.write(`[changelog:new] ${path.relative(ROOT, file)}（首行 ## ${section}）\n`);
    const gate = runGateStep("node", ["scripts/gates/check-changelog-fragments.cjs"], {
      cwd: ROOT,
      timeoutMs: 60_000,
      echo: false,
    });
    if (gate.status !== 0) {
      process.stderr.write(`${gate.stdout}${gate.stderr}\n`);
      return 1;
    }
    return 0;
  }
  if (cmd === "list") {
    const rows = listFragments();
    for (const r of rows) {
      process.stdout.write(`${r.file} · ${r.section || "(段落缺失)"}\n`);
    }
    process.stdout.write(`[changelog:list] 未并入 ${rows.length} 份\n`);
    return 0;
  }
  if (cmd === "merge") {
    const check = rest.includes("--check");
    const res = runGateStep(
      "node",
      ["scripts/docs/merge-changelog-fragments.mjs", ...(check ? ["--check"] : [])],
      { cwd: ROOT, timeoutMs: 60_000, echo: true },
    );
    process.stdout.write(String(res.stdout ?? ""));
    process.stderr.write(String(res.stderr ?? ""));
    return res.status ?? 2;
  }
  process.stderr.write("用法：pnpm changelog:new|list|merge …\n");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
