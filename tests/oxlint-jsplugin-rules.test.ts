/**
 * 2 条 jsPlugin 规则「迁到 oxlint 之后仍然真的会响」的对拍用例（#2777 退役前置）。
 *
 * ── 为什么要这一份 ────────────────────────────────────────────────────────
 *
 * `react/no-deprecated` 与 `@next/next/no-location-assign-relative-destination`
 * 原先住在 `eslint.config.js`，现在由 `oxlint.parity.config.mjs` 的 jsPlugin 通道执行：
 * 前者复用 `eslint-plugin-react`，后者复用 `@next/eslint-plugin-next`。
 *
 * 但「配置里写了」不等于「闸真的会响」（§11.7）—— 本仓已经因为 oxlint 缺 `plugins`
 * 静默失效过 72 条规则。所以这里沿用 `tests/oxlint-policy-rules.test.ts` 的做法：
 *
 *   ① 从**真判决配置**读条目（jsPlugins / globals / settings / 两条规则）；
 *   ② 现生成一份最小探针配置（`node_modules/.cache/`，跑完即删）；
 *   ③ 在仓外临时目录造正反样本，断言命中集合与**文案逐字一致**。
 *
 * 另有「两份配置清单一致」一节：判决配置与全量评估尺（`oxlint.config.ts`）必须声明
 * 同一组 jsPlugin 别名、同一档 globals、同一个 react 版本与同一份规则清单 ——
 * 少了任一面，IDE 用的评估尺与 CI 用的判决面就会各说各话。
 *
 * `react-hooks/config` 与 `gating` **不在**这份清单里：两引擎无 options 时均 0 诊断，
 * 本仓不传编译器 options，迁上来是纯空转且让全仓 lint 从 34s 涨到 64s（+80%）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";

import rulerConfig from "../oxlint.config.ts";
import oxlintConfig from "../oxlint.parity.config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache");
/** 两份配置里承接这两条规则的档位（glob 与判决配置的 TS 档逐字一致）。 */
const TS_GLOB = "src/**/*.{ts,tsx,mts,cts}";
const DEPRECATED_RULE = "react-js/no-deprecated";
const LOCATION_RULE = "nextjs-js/no-location-assign-relative-destination";

/** `eslint-plugin-react` 的 no-deprecated 原文（版本号进文案，升级规则包时会在这里红）。 */
const DEPRECATED_MESSAGES: Record<string, string> = {
  "find-dom-node.tsx":
    "React.findDOMNode is deprecated since React 0.14.0, use ReactDOM.findDOMNode instead",
  "react-dom-render.tsx":
    "ReactDOM.render is deprecated since React 18.0.0, use createRoot instead, see https://reactjs.org/link/switch-to-createroot",
  "legacy-lifecycle.tsx":
    "componentWillMount is deprecated since React 16.9.0, use UNSAFE_componentWillMount instead, see https://reactjs.org/docs/react-component.html#unsafe_componentwillmount. Use https://github.com/reactjs/react-codemod#rename-unsafe-lifecycles to automatically update your components.",
};

/** `@next/eslint-plugin-next` 的 no-location 原文（表达式按源码文本回填）。 */
function locationMessage(expression: string): string {
  return `Do not use \`${expression}\` to navigate to internal Next.js pages. Use \`redirect()\` in the render phase, or \`useRouter().push()\` in Client Components' event handlers instead. See: https://nextjs.org/docs/messages/no-location-assign-relative-destination`;
}

type JsPlugin = { name?: string; specifier?: string };
type ConfigBlock = {
  files?: Array<string> | string;
  globals?: Record<string, string>;
  jsPlugins?: Array<JsPlugin>;
  overrides?: Array<ConfigBlock>;
  rules?: Record<string, unknown>;
  settings?: { react?: { version?: string } };
};

/** 两份配置的消费形状守卫（B5 清账）：jsPlugins / overrides 逐层对型。 */
function isConfigBlock(value: unknown): value is ConfigBlock {
  if (!isRecord(value)) {
    return false;
  }
  const pluginsOk =
    value.jsPlugins === undefined ||
    (isUnknownArray(value.jsPlugins) && value.jsPlugins.every((p) => isRecord(p)));
  const overridesOk =
    value.overrides === undefined ||
    (isUnknownArray(value.overrides) && value.overrides.every(isConfigBlock));
  return pluginsOk && overridesOk;
}

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

const parityParsed: unknown = oxlintConfig;
const rulerParsed: unknown = rulerConfig;
if (!isConfigBlock(parityParsed) || !isConfigBlock(rulerParsed)) {
  throw new Error("oxlint 两份配置的形状变了 —— 重读配置再改这份守卫");
}
const PARITY = parityParsed;
const RULER = rulerParsed;

function filesOf(block: ConfigBlock): Array<string> {
  const files = block.files;
  if (files === undefined) return [];
  return Array.isArray(files) ? files : [files];
}

/** 取某份配置里承接这 2 条规则的档（判决配置与评估尺都按 `TS_GLOB` 定位）。 */
function tsBlockOf(config: ConfigBlock): ConfigBlock {
  const block = (config.overrides ?? []).find((one) => filesOf(one).includes(TS_GLOB));
  if (block === undefined) throw new Error(`配置里没有 ${TS_GLOB} 这一档`);
  return block;
}

/** package.json 里 react 的实际版本（去掉 `^` / `~` 前缀）。 */
function packageReactVersion(): string {
  const match = /"react"\s*:\s*"[^\d]*(?<version>[\d.]+)"/.exec(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  if (match?.groups?.version === undefined) throw new Error("package.json 里读不到 react 版本");
  return match.groups.version;
}

/** 在 `node_modules/.cache/` 写一份只含这 2 条规则的最小探针配置（跑完即删）。
 *  这里只取 2 个别名是探针夹具的范围（§① 只考这两条规则）；
 *  「两份配置同一组别名」的整组合同在 §② 单独对拍，别在这里复用。 */
function writeProbeConfig(probePath: string): void {
  const plugins = PARITY.jsPlugins ?? [];
  const used = plugins.filter(
    (plugin) => plugin.name === "react-js" || plugin.name === "nextjs-js",
  );
  expect(used.map((plugin) => plugin.name)).toEqual(["nextjs-js", "react-js"]);
  const globals = tsBlockOf(PARITY).globals ?? {};
  const rules = tsBlockOf(PARITY).rules ?? {};
  const body = `// 本文件由 tests/oxlint-jsplugin-rules.test.ts 每次运行现生成，勿手改。
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
  jsPlugins: ${JSON.stringify(used)},
  globals: ${JSON.stringify(globals)},
  settings: { react: { version: ${JSON.stringify(packageReactVersion())} } },
  rules: {
    ${JSON.stringify(LOCATION_RULE)}: ${JSON.stringify(rules[LOCATION_RULE])},
    ${JSON.stringify(DEPRECATED_RULE)}: ${JSON.stringify(rules[DEPRECATED_RULE])},
  },
};
`;
  writeFileSync(probePath, body, "utf8");
}

/** 跑一次 oxlint，返回「文件名 → 诊断文案」的映射。 */
function runProbe(probeConfig: string, fixtures: Array<string>): Map<string, Array<string>> {
  const r = spawnSync(
    process.execPath,
    [OXLINT_BIN, "--config", probeConfig, "-f", "json", ...fixtures],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const out = r.stdout;
  expect(out, `oxlint 没输出 JSON：${r.stderr}`).toBeTruthy();
  const reportParsed: unknown = JSON.parse(out);
  const diagnostics: unknown = isRecord(reportParsed) ? reportParsed.diagnostics : [];
  if (!isDiagnostics(diagnostics)) {
    throw new Error(`oxlint 的 JSON 报告形状变了：${out.slice(0, 200)}`);
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
}

describe("① oxlint 侧真的会响：no-deprecated / no-location 两条全在", () => {
  it("正反样本按原口径命中，文案逐字不变", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-jsplugin-"));
    const probeConfig = path.join(CACHE_DIR, "oxlint-jsplugin-probe.config.mjs");
    try {
      const samples: Record<string, string> = {
        "find-dom-node.tsx": "export const a = () => React.findDOMNode(null);\n",
        "react-dom-render.tsx": "ReactDOM.render(null, null);\n",
        "legacy-lifecycle.tsx":
          "export class Legacy extends Component {\n  componentWillMount() {}\n}\n",
        "deprecated-ok.tsx": "export const b = () => ReactDOM.createRoot(null);\n",
        "location-relative.ts": 'export const c = () => {\n  location.href = "/relative";\n};\n',
        "location-assign.ts": 'export const d = () => {\n  window.location.assign("/other");\n};\n',
        "location-absolute.ts":
          'export const e = () => {\n  location.href = "https://example.com/a";\n};\n',
        "location-router.ts": 'export const f = () => {\n  router.push("/settings");\n};\n',
      };
      const fixtures: Array<string> = [];
      for (const [name, code] of Object.entries(samples)) {
        const file = path.join(dir, name);
        writeFileSync(file, code, "utf8");
        fixtures.push(file);
      }

      writeProbeConfig(probeConfig);
      const hits = runProbe(probeConfig, fixtures);

      expect(hits.get("find-dom-node.tsx")).toEqual([DEPRECATED_MESSAGES["find-dom-node.tsx"]]);
      expect(hits.get("react-dom-render.tsx")).toEqual([
        DEPRECATED_MESSAGES["react-dom-render.tsx"],
      ]);
      expect(hits.get("legacy-lifecycle.tsx")).toEqual([
        DEPRECATED_MESSAGES["legacy-lifecycle.tsx"],
      ]);
      expect(hits.get("location-relative.ts")).toEqual([locationMessage("location.href")]);
      expect(hits.get("location-assign.ts")).toEqual([locationMessage("window.location.assign()")]);

      // 反向对照：合法形态一条都不报（闸过宽时这里会红）。
      expect(hits.has("deprecated-ok.tsx")).toBe(false);
      expect(hits.has("location-absolute.ts")).toBe(false);
      expect(hits.has("location-router.ts")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(probeConfig)) rmSync(probeConfig, { force: true });
    }
  });
});

describe("② 两份 oxlint 配置的清单逐字一致", () => {
  it("jsPlugin 别名、globals、文件档、react 版本与两条规则都同源", () => {
    const parityBlock = tsBlockOf(PARITY);
    const rulerBlock = tsBlockOf(RULER);

    // 文件头合同的「同一组 jsPlugin 别名」按**整组**逐字对拍（#3440）：
    // 只挑 2 个别名比对，会漏掉判决面新增 / 评估尺缺失的别名
    // （`unused-imports` 曾在判决面存在而评估尺缺失，被旧写法放过）。
    const parityPlugins = (PARITY.jsPlugins ?? []).map((plugin) => [plugin.name, plugin.specifier]);
    const rulerPlugins = (RULER.jsPlugins ?? []).map((plugin) => [plugin.name, plugin.specifier]);
    expect(parityPlugins).toEqual([
      ["boundaries", "eslint-plugin-boundaries"],
      ["eslint-js", "oxlint-plugin-eslint"],
      ["nextjs-js", "@next/eslint-plugin-next"],
      ["react-js", "eslint-plugin-react"],
      ["unused-imports", "eslint-plugin-unused-imports"],
    ]);
    expect(rulerPlugins).toEqual(parityPlugins);

    expect(filesOf(rulerBlock)).toEqual(filesOf(parityBlock));
    expect(rulerBlock.globals).toEqual(parityBlock.globals);
    expect(Object.keys(parityBlock.globals ?? {})).toEqual([
      "document",
      "globalThis",
      "location",
      "self",
      "window",
    ]);

    expect(parityBlock.rules?.[LOCATION_RULE]).toBe("error");
    expect(parityBlock.rules?.[DEPRECATED_RULE]).toBe("error");
    expect(rulerBlock.rules?.[LOCATION_RULE]).toBe("error");
    expect(rulerBlock.rules?.[DEPRECATED_RULE]).toBe("error");
    // `unused-imports/no-unused-imports` 也两处同源（#3440 后续跟开）。
    const UNUSED_IMPORTS_RULE = "unused-imports/no-unused-imports";
    expect(parityBlock.rules?.[UNUSED_IMPORTS_RULE]).toBe("error");
    expect(rulerBlock.rules?.[UNUSED_IMPORTS_RULE]).toBe("error");

    const expectedVersion = packageReactVersion();
    expect(PARITY.settings?.react?.version).toBe(expectedVersion);
    expect(RULER.settings?.react?.version).toBe(expectedVersion);
  });
});
