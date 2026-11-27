/**
 * doc-stale-scan.mjs —— 文档陈旧候选的只读探针（ISSUE #5181）。
 *
 * 文档里的路径 / 反引号标识符 / `pnpm <名字>` / `path#slug` 锚点过期，过去每批
 * 都临时写一份探针（`changelog.d/0-docs-stale-*` 共 14 批）。本入口只出「候选 +
 * 行号 + 上下文 + 命中数」，**不自动改、不判缺陷** —— 零命中可能是框架名或历史自注，
 * 机器判不了，定性仍由人读语境（§12.18 末句：不新写启发式判缺陷）。
 *
 * 用法：`pnpm doc:stale-scan [docs/**] [--kind path|symbol|command|anchor|count] [--json]`
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "coverage", "log", "temp"]);
/* pnpm 内建动词不是 package.json 脚本，不能记成「陈旧」。 */
export const PNPM_BUILTINS = Object.freeze([
  "exec",
  "run",
  "install",
  "add",
  "remove",
  "update",
  "docs",
  "link",
  "unlink",
  "dlx",
  "create",
  "init",
]);

/**
 * 从一行正文里抽候选。纯函数，便于用例钉住形状。
 *
 * @param {{text:string, kind:string}} input
 * @returns {string[]}
 */
export function candidatesOf({ text, kind }) {
  const ticks = [...String(text ?? "").matchAll(/`(?<token>[^`]+)`/g)].map(
    (m) => m.groups?.token ?? "",
  );
  if (kind === "command") {
    return [...String(text ?? "").matchAll(/\bpnpm\s+(?<name>[a-z][\w:-]*)/g)].map(
      (m) => m.groups?.name ?? "",
    );
  }
  if (kind === "path") {
    return ticks.filter((t) => t.includes("/") || /\.(?:md|ts|tsx|mjs|cjs|json|toml|ps1)$/.test(t));
  }
  if (kind === "symbol") {
    return ticks.filter((t) => /^[A-Za-z_][\w.-]*$/.test(t));
  }
  if (kind === "anchor") {
    return ticks.filter((t) => /^.+#[\w-]+$/.test(t));
  }
  /* count：数字读数，只给候选不做比较。 */
  return [...String(text ?? "").matchAll(/\b(?<count>\d[\d,]*\s*(?:份|个|条|行))\b/g)].map(
    (m) => m.groups?.count ?? "",
  );
}

/**
 * 递归收 md 文件。
 * @param {string} dir
 * @param {string[]} [out]
 */
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) {
      continue;
    }
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/** @param {string[]} argv */
function main(argv) {
  const json = argv.includes("--json");
  const kindAt = argv.indexOf("--kind");
  const kind = kindAt === -1 ? "path" : String(argv[kindAt + 1] ?? "path");
  const paths = argv.filter((a, i) => !a.startsWith("--") && i !== kindAt + 1);
  if (!["path", "symbol", "command", "anchor", "count"].includes(kind)) {
    process.stderr.write("[doc:stale-scan] --kind 只认 path|symbol|command|anchor|count。\n");
    return 2;
  }
  const targets = paths.length > 0 ? paths : ["docs"];
  const scripts = new Set(
    Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {}),
  );
  /** @type {any[]} */
  const rows = [];
  for (const target of targets) {
    const full = path.resolve(ROOT, target);
    if (!fs.existsSync(full)) {
      process.stderr.write(`[doc:stale-scan] ${target} 不存在 ⇒ 输入面取不到（退 2）。\n`);
      return 2;
    }
    const files = fs.statSync(full).isDirectory() ? walk(full) : [full];
    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const token of candidatesOf({ text: line, kind })) {
          const verified =
            kind === "path"
              ? fs.existsSync(path.resolve(ROOT, token))
              : kind === "command"
                ? scripts.has(token) || PNPM_BUILTINS.includes(token)
                : null;
          rows.push({
            file: path.relative(ROOT, file),
            line: i + 1,
            kind,
            token,
            verified,
            context: line.trim().slice(0, 160),
          });
        }
      });
    }
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ kind, rows }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[doc:stale-scan] ${kind}：${rows.length} 条候选（只读，不判缺陷、不自动改）\n`,
    );
    for (const r of rows.slice(0, 200)) {
      process.stdout.write(
        `  ${r.file}:${r.line} · ${r.token}${r.verified === false ? " · 不在树" : ""} · ${r.context}\n`,
      );
    }
    if (rows.length > 200) {
      process.stdout.write(`  ……其余 ${rows.length - 200} 条用 --json 取全。\n`);
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
