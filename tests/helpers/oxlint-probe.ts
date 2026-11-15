/**
 * tests/helpers/oxlint-probe.ts —— 「规则条目 ⇄ 真 oxlint 行为」的最小探针。
 *
 * #2777 / #3157 起 eslint 退役，判据的行为验证改由**真 CLI** 承担（此前用 eslint 的
 * `Linter` 跑最小片段）。做法：把入参规则写进临时配置、样本写进临时目录、跑一次
 * `oxlint -f json`，返回「文件名 → 诊断文案」。配置里只开 jsPlugin `eslint-js`、
 * 其余类别全关，避免默认规则制造噪声。跑完即删，不留缓存。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isRecord, isUnknownArray } from "~/lib/is-record";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** oxlint JSON 报告的 diagnostics 守卫（B5 清账）：filename / message 都可选串。 */
function isDiagnostics(value: unknown): value is Array<{ filename?: string; message?: string }> {
  return (
    isUnknownArray(value) &&
    value.every(
      (d) =>
        isRecord(d) &&
        (d.filename === undefined || typeof d.filename === "string") &&
        (d.message === undefined || typeof d.message === "string"),
    )
  );
}
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
/** 探针配置必须住在仓库内：`jsPlugins` 的 specifier 按**配置所在目录**解析。 */
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache");

/** 探针只判入参那几条，默认类别一律关掉。 */
const OFF_CATEGORIES = {
  correctness: "off",
  suspicious: "off",
  perf: "off",
  style: "off",
  restriction: "off",
  nursery: "off",
  pedantic: "off",
};

/**
 * 用真 oxlint 跑一组样本；同一次调用内所有样本共付一份配置求值。
 *
 * @param rules 规则名 → 条目（与判决配置里的形状相同）
 * @param samples 文件名（含扩展名）→ 源码
 * @returns 「文件名 → 诊断文案」；没命中的文件不在映射里
 */
export function probeRules(
  rules: Record<string, unknown>,
  samples: Record<string, string>,
): Map<string, Array<string>> {
  const dir = mkdtempSync(path.join(tmpdir(), "oxlint-probe-"));
  const probeConfig = path.join(CACHE_DIR, `${path.basename(dir)}.config.mjs`);
  try {
    const body = {
      categories: OFF_CATEGORIES,
      jsPlugins: [{ name: "eslint-js", specifier: "oxlint-plugin-eslint" }],
      rules,
    };
    writeFileSync(probeConfig, `export default ${JSON.stringify(body, null, 2)};\n`, "utf8");

    const fixtures: Array<string> = [];
    for (const [name, code] of Object.entries(samples)) {
      const file = path.join(dir, name);
      writeFileSync(file, code, "utf8");
      fixtures.push(file);
    }

    const r = spawnSync(
      process.execPath,
      [OXLINT_BIN, "--config", probeConfig, "-f", "json", ...fixtures],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (!r.stdout) {
      throw new Error(`oxlint 探针没输出 JSON（exit ${String(r.status)}）：${r.stderr}`);
    }

    const reportParsed: unknown = JSON.parse(r.stdout);
    const diagnostics: unknown = isRecord(reportParsed) ? reportParsed.diagnostics : [];
    if (!isDiagnostics(diagnostics)) {
      throw new Error(`oxlint 探针的 JSON 报告形状变了：${r.stdout.slice(0, 200)}`);
    }
    const report = { diagnostics };
    const map = new Map<string, Array<string>>();
    for (const diag of report.diagnostics ?? []) {
      const name = path.basename(diag.filename ?? "");
      const list = map.get(name) ?? [];
      list.push(diag.message ?? "");
      map.set(name, list);
    }
    return map;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(probeConfig, { force: true });
  }
}
