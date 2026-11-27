/**
 * version-set.mjs —— 三处版本号一次写入（ISSUE #5186）。
 *
 * `check-app-version.cjs` 只判三处相等、明确「不判该不该升」，且只有 `--report`：
 * 只升一处 ⇒ 安装包 / 更新判定静默停在旧版，而提交时守卫报「不相等」却不给修法。
 * 本入口在**人点名版本号**之后写三处并逐文件独立回读；是否该升仍由人判断。
 *
 * 用法：`pnpm version:set <MAJOR.MINOR.PATCH> [--check]`
 * 退码：0 = 三处已写且回读一致；1 = 回读不一致；2 = 用法错 / 文件读不出 / 版本形态不对。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** @type {Array<[string, RegExp]>} */
const FILES = [
  ["package.json", /(?<pre>"version"\s*:\s*")[^"]+(?<post>")/],
  ["src-tauri/tauri.conf.json", /(?<pre>"version"\s*:\s*")[^"]+(?<post>")/],
  ["src-tauri/Cargo.toml", /(?<pre>\bversion\s*=\s*")[^"]+(?<post>")/],
];

/**
 * 只替换版本号字段，不动其它排版。纯函数。
 *
 * @param {{text:string, pattern:RegExp, version:string}} input
 * @returns {{text:string, changed:boolean}}
 */
export function replaceVersion({ text, pattern, version }) {
  const next = String(text ?? "").replace(pattern, `$<pre>${version}$<post>`);
  return { text: next, changed: next !== text };
}

/** @param {string[]} argv */
function main(argv) {
  const check = argv.includes("--check");
  if (check) {
    const res = runGateStep(process.execPath, ["scripts/gates/check-app-version.cjs", "--report"], {
      cwd: ROOT,
      timeoutMs: 60_000,
      echo: true,
    });
    process.stdout.write(String(res.stdout ?? ""));
    return res.status ?? 2;
  }
  const version = argv[0];
  if (!version || !SEMVER_RE.test(version)) {
    process.stderr.write("用法：pnpm version:set <MAJOR.MINOR.PATCH> [--check]\n");
    return 2;
  }
  /** @type {Array<[string, RegExp]>} */
  const written = [];
  for (const [rel, pattern] of FILES) {
    const file = path.join(ROOT, rel);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      process.stderr.write(`[version:set] 读不到 ${rel} ⇒ 三处不写，避免半套状态。\n`);
      return 2;
    }
    const result = replaceVersion({ text, pattern, version });
    if (!result.changed) {
      process.stderr.write(`[version:set] ${rel} 里找不到版本号字段 ⇒ 三处不写。\n`);
      return 2;
    }
    fs.writeFileSync(file, result.text, "utf8");
    written.push([rel, pattern]);
  }
  for (const [rel, pattern] of written) {
    const back = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const matched = pattern.exec(back);
    const got = matched?.[2] ? back.slice(matched.index, matched.index + matched[0].length) : "";
    if (!got.includes(version)) {
      process.stderr.write(`[version:set] ${rel} 回读不到 ${version} ⇒ 不念「已写入」。\n`);
      return 1;
    }
  }
  process.stdout.write(`[version:set] 三处已写为 ${version}（逐文件回读一致）\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
