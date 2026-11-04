/**
 * 三条策略守卫「迁到 oxlint 之后仍然真的会响」的对拍用例（#2777）。
 *
 * ── 为什么要这一份 ────────────────────────────────────────────────────────
 *
 * 这三条原先住在 `eslint.config.js`，由 `tests/router-error-envelope.test.ts` /
 * `tests/store-selector-shape.test.ts` 用 eslint 自带 `Linter` 做行为断言。
 * 迁到 `oxlint.parity.config.mjs` 后，执行者换了（oxlint 的 jsPlugin 通道），
 * 但**判据一个字都没变**：同一个 selector / 同一句 message。
 *
 * 「配置里写了」不等于「闸真的会响」（§11.7 / 台账 E2）。所以这一份直接拿
 * **真判决配置里的条目**喂给 **oxlint CLI 真跑一遍**：
 *
 *   ① 从 `oxlint.parity.config.mjs` 读规则条目（不在此重抄 selector / message）；
 *   ② 现生成一份只含这三条规则的最小探针配置（`node_modules/.cache/`，跑完即删）；
 *   ③ 在仓外临时目录造正反样本，断言命中集合与**文案逐字一致**。
 *
 * 另外两节钉「迁移本身」：`eslint.config.js` 里这三条已经删干净、只剩 14 条；
 * 两条规则的文件作用面（router 面排除 `*.test.ts`、drizzle 面只覆盖 components/features）
 * 仍按原样落在判决配置里 —— 少了任一面，「迁过去」就只是换了个文件写配置。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import eslintConfig from "../eslint.config.js";
import oxlintConfig from "../oxlint.parity.config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache");
const ROUTER_GLOB = "src/server/api/routers/**/*.ts";
const ROUTER_TEST_EXCLUDE = "src/server/api/routers/**/*.test.ts";

/** 一条规则条目：`["error", ...entries]`。 */
type RuleSetting = [string, ...Array<unknown>];
type Override = {
  excludeFiles?: Array<string> | string;
  files?: Array<string> | string;
  rules?: Record<string, unknown>;
};
type OxlintConfig = { overrides?: Array<Override> };
type EslintBlock = { files?: Array<string> | string; rules?: Record<string, unknown> };

const storeSelectorMessage =
  "store selector 里现拼对象字面量 = 每次 store 写入都返回新引用（字段没变也重渲染）。改成只返回原始值/稳定引用，或把派生下沉进 store；useShallow 是最后手段（规范 01 §1.2 / 07 §7.15.1）。";
const storeNewArrayMessage =
  "store selector 里用 .map/.filter/.slice 造新数组 = 每次求值都是新引用（字段没变也重渲染）。把它下沉进 store 或抽成 store 内的稳定切片（规范 01 §1.2）。";
const routerMessage =
  "router 里请抛 new TRPCError({ code, message })：裸 Error 会被 tRPC 归成 INTERNAL_SERVER_ERROR，客户端就分不出「不存在 / 越权 / 重名」（规范 §11.2.1 第七条、台账 E8）。";
const drizzleMessage = "UI/features 不得直接依赖 Drizzle orm,请经 src/lib/core 仓储访问数据。";

function overrides(): Array<Override> {
  const config = oxlintConfig as unknown as OxlintConfig;
  const list = config.overrides;
  expect(Array.isArray(list)).toBe(true);
  return list ?? [];
}

function filesOf(one: Override): Array<string> {
  const files = one.files;
  if (files === undefined) return [];
  return Array.isArray(files) ? files : [files];
}

/** 某条规则在**某一份作用面**上的条目（`files` 命中给定 glob 的那一档）。 */
function ruleEntries(rule: string, fileGlob: string): Array<unknown> {
  const block = overrides().find((one) => filesOf(one).includes(fileGlob));
  if (block === undefined) throw new Error(`判决配置里没有 ${fileGlob} 这一档`);
  const setting = block.rules?.[rule];
  expect(Array.isArray(setting), `${fileGlob} 那一档没有 ${rule}`).toBe(true);
  return (setting as RuleSetting).slice(1);
}

/** 判决配置里出现过的全部 `no-restricted-syntax` 条目（按 message 去重：
 *  router 专档会为了「层覆盖」再把 store 那两条带一遍，探针只需要一份）。 */
function syntaxEntries(): Array<{ message: string }> {
  const seen = new Map<string, { message: string }>();
  for (const one of overrides()) {
    const setting = one.rules?.["eslint-js/no-restricted-syntax"];
    if (!Array.isArray(setting)) continue;
    for (const entry of setting.slice(1) as Array<{ message?: string }>) {
      const message = entry.message;
      if (typeof message === "string") {
        seen.set(message, entry as { message: string });
      }
    }
  }
  expect(seen.size, "store 两条 + router 一条").toBe(3);
  return [...seen.values()];
}

/** 在 `node_modules/.cache/` 写一份只含三条策略的最小探针配置（跑完即删）。 */
function writeProbeConfig(probePath: string): void {
  const drizzleEntries = ruleEntries("eslint-js/no-restricted-imports", "src/components/**");
  const drizzleSetting: RuleSetting = ["error", ...drizzleEntries];
  const body = `// 本文件由 tests/oxlint-policy-rules.test.ts 每次运行现生成，勿手改。
export default {
  categories: {
    correctness: "off",
    suspicious: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
    pedantic: "off",
  },
  jsPlugins: [{ name: "eslint-js", specifier: "oxlint-plugin-eslint" }],
  rules: {
    "eslint-js/no-restricted-syntax": ${JSON.stringify(["error", ...syntaxEntries()])},
    "eslint-js/no-restricted-imports": ${JSON.stringify(drizzleSetting)},
  },
};
`;
  writeFileSync(probePath, body, "utf8");
}

/** 跑一次 oxlint，返回「文件名 → 诊断文案」的映射。 */
function runProbe(probeConfig: string, fixtures: Array<string>): Map<string, Array<string>> {
  const r = spawnSync(process.execPath, [OXLINT_BIN, "--config", probeConfig, "-f", "json", ...fixtures], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = r.stdout;
  expect(out, `oxlint 没输出 JSON：${r.stderr}`).toBeTruthy();
  const report = JSON.parse(out) as { diagnostics?: Array<{ filename?: string; message?: string }> };
  const map = new Map<string, Array<string>>();
  for (const diag of report.diagnostics ?? []) {
    const name = path.basename(diag.filename ?? "");
    const list = map.get(name) ?? [];
    list.push(diag.message ?? "");
    map.set(name, list);
  }
  return map;
}

describe("① oxlint 侧真的会响：store selector / router / drizzle 三条全在", () => {
  it("正反样本按原口径命中，文案逐字不变", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-policy-"));
    const probeConfig = path.join(CACHE_DIR, "oxlint-policy-probe.config.mjs");
    try {
      const samples: Record<string, string> = {
        "store-object.ts": "export const a = useShellTabs((s) => ({ tabs: s.tabs }));\n",
        "store-new-array.ts":
          "export const b = useLogCategoryStore((s) => s.items.filter((x) => x.enabled));\n",
        "store-ok.ts": "export const c = useShellTabs((s) => s.activeTabId);\n",
        "store-react-hook.ts": "const f = useMemo(() => ({ n: 1 }), []);\n",
        "router-bare.ts": 'export const d = () => {\n  throw new Error("x");\n};\n',
        "router-typeerror.ts": 'export const e = () => {\n  throw new TypeError("x");\n};\n',
        "router-trpc.ts":
          'export const f = () => {\n  throw new TRPCError({ code: "NOT_FOUND" });\n};\n',
        "import-drizzle.ts": 'import { eq } from "drizzle-orm";\nexport const g = eq;\n',
        "import-drizzle-sub.ts":
          'import { pgTable } from "drizzle-orm/pg-core";\nexport const h = pgTable;\n',
        "import-core.ts": 'import { listProjects } from "~/lib/core/projects";\nexport const i = listProjects;\n',
      };
      const fixtures: Array<string> = [];
      for (const [name, code] of Object.entries(samples)) {
        const file = path.join(dir, name);
        writeFileSync(file, code, "utf8");
        fixtures.push(file);
      }

      writeProbeConfig(probeConfig);
      const hits = runProbe(probeConfig, fixtures);

      expect(hits.get("store-object.ts")).toEqual([storeSelectorMessage]);
      expect(hits.get("store-new-array.ts")).toEqual([storeNewArrayMessage]);
      expect(hits.get("router-bare.ts")).toEqual([routerMessage]);
      expect(hits.get("router-typeerror.ts")).toEqual([routerMessage]);
      expect(hits.get("import-drizzle.ts")).toEqual([
        `'drizzle-orm' import is restricted from being used by a pattern. ${drizzleMessage}`,
      ]);
      expect(hits.get("import-drizzle-sub.ts")).toEqual([
        `'drizzle-orm/pg-core' import is restricted from being used by a pattern. ${drizzleMessage}`,
      ]);

      // 反向对照：合法形态一条都不报（闸过宽时这里会红）。
      expect(hits.has("store-ok.ts")).toBe(false);
      expect(hits.has("store-react-hook.ts")).toBe(false);
      expect(hits.has("router-trpc.ts")).toBe(false);
      expect(hits.has("import-core.ts")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(probeConfig)) rmSync(probeConfig, { force: true });
    }
  });
});

describe("② 迁移完成：eslint 侧只剩 14 条，不再承载这三条", () => {
  it("eslint.config.js 的规则名集合恰为 14 条，且不含 no-restricted-*", () => {
    const blocks = eslintConfig as unknown as Array<EslintBlock>;
    const names = new Set<string>();
    for (const block of blocks) {
      for (const name of Object.keys(block.rules ?? {})) names.add(name);
    }
    expect(names.size).toBe(14);
    expect(names.has("no-restricted-syntax")).toBe(false);
    expect(names.has("no-restricted-imports")).toBe(false);
    expect(names.has("react/no-deprecated")).toBe(true);
    expect(names.has("@next/next/no-location-assign-relative-destination")).toBe(true);
  });

  it("三条规则的原文只住在判决配置里（eslint 侧不再有 selector / patterns 条目）", () => {
    const eslintSource = readFileSync(path.join(ROOT, "eslint.config.js"), "utf8");
    expect(eslintSource).not.toContain("selector:");
    expect(eslintSource).not.toContain("drizzle-orm");
  });
});

describe("③ 文件作用面与原来一致", () => {
  it("router 专档仍排除 *.test.ts（夹具要模拟裸 Error）", () => {
    const block = overrides().find((one) => filesOf(one).includes(ROUTER_GLOB));
    expect(block, `判决配置里没有 ${ROUTER_GLOB} 这一档`).toBeDefined();
    const exclude = block?.excludeFiles;
    expect(Array.isArray(exclude) ? exclude : [exclude]).toContain(ROUTER_TEST_EXCLUDE);
  });

  it("drizzle 档只覆盖 components / features", () => {
    const entries = ruleEntries("eslint-js/no-restricted-imports", "src/components/**");
    const options = entries[0] as { patterns?: Array<{ group?: Array<string> }> };
    expect(options.patterns?.[0]?.group).toEqual(["drizzle-orm", "drizzle-orm/*"]);
    const scoped = overrides().filter((one) => filesOf(one).includes("src/components/**"));
    expect(scoped).toHaveLength(1);
    expect(filesOf(scoped[0] ?? {})).toEqual(["src/components/**", "src/features/**"]);
  });
});
