#!/usr/bin/env node
/**
 * check-oxlint-zero-rules.mjs —— 「已清零 oxlint 规则集」回潮硬闸（ISSUE #3016；台账属 #2777）。
 *
 * 补的是这样一格：机械清零批（#2775 起）把一条条 oxlint 规则清到全仓 0 之后，
 * **没有任何东西在守** —— 下一批落地（#2917 一族）顺手就把同一形态带回来
 * （`unicorn/no-negated-condition` 在 #2977 清零后被 #3015 续清过一次、本单又清 14 处；
 * `perfectionist/sort-object-types` / `unicorn/numeric-separators-style` 由 #3037 续清）。
 * 「39 条已清零规则集」此前是人工复扫惯例、无在册清单；本单把它落成下面这份
 * ZERO_RULES（41 条 = 39 条全仓清零批 + #2776 的 eqeqeq / no-void），并配这条闸。
 *
 * **每清零一条新规则，就往 ZERO_RULES 加一行**（规则名 + 清零/续清的 issue 溯源）。
 * 判空三元的写法口径（`x === undefined ? 兜底 : 主路`，肯定侧在前）见规范 §13.5.32。
 *
 * ## 判据形态（为什么不是「把规则加进根级 oxlint.config.ts」）
 *
 * 根级 config 是评估尺（awesomeness 预设全量），把它收成闸 = 把未清零的存量一次端上来，
 * 与「按规则分批清零」的节奏相反（§13.5.32 的 L1 空格）。所以这里走的是**探针形态**：
 * 每次运行现生成一份临时配置（extends 同一预设、categories 全关、只抬清单内规则为
 * error），全仓 `--type-aware` 扫一遍，按 `plugin(rule)` 诊断码过滤 —— 预设里仍开着
 * 的规则级条目（categories 关不掉那一族）不会混进判决。
 *
 * 预设 `rules` 表里已有条目的（取它的选项、只抬 severity 为 error）与没条目的
 * （直接 `"error"`）都支持；`eslint/no-void` 按 #2776 的清零口径固定带
 * `{ allowAsStatement: true }`（语句位 `void foo();` 本来就合法）。
 *
 * 刻意不做的事：不 `--fix`（闸只判不改）、不判清单外的规则（那归清污批的节奏）、
 * 不把 eqeqeq 的 159 处台账禁用当命中（oxlint 原生禁用指令过滤后读数自然为 0，
 * 新增 `== null` 必须带台账禁用措辞，见 #2776 碎片）。
 *
 * ## 用法与退出码（三态，与 `.githooks` / `base-check.mjs` 同口径）
 *
 *   node scripts/check-oxlint-zero-rules.mjs              # 全仓判定（--type-aware）
 *   node scripts/check-oxlint-zero-rules.mjs <路径…>      # 契约自测档：只扫给定路径
 *
 *   0 = 清单内规则 0 命中；1 = 有回潮（逐条列 `文件:行:列`）；2 = **没跑起来**
 *   （oxlint 起不来 / 输出不是 JSON / 全仓档一份文件都没扫到）——「没跑起来」
 *   排在红前面：环境不可信时红与绿都不构成结论。
 *
 *   带路径参数时不挂 `--type-aware`：自测夹具在仓外临时目录、没有 tsconfig 可挂；
 *   负控因此只选语法级规则（`unicorn/no-negated-condition`），见
 *   `tests/check-oxlint-zero-rules.test.ts`。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import awesomeness from "oxlint-config-awesomeness";

import { resolveBinEntryByName } from "./package-bin-entry.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 已清零 oxlint 规则清单（本闸唯一登记面；新增 = 清零一条就往这里加一行）。
 * `issue` 记清零批与续清单的溯源；`options` 只在「清零时就不是预设默认选项」时写。
 * @type {{ rule: string, issue: string, options?: Record<string, unknown> }[]}
 */
const ZERO_RULES = [
  // ── #2775 机械批清零（39 条）────────────────────────────────────
  { rule: "unicorn/catch-error-name", issue: "#2775" },
  { rule: "typescript/no-confusing-void-expression", issue: "#2775；#2918 续清" },
  { rule: "typescript/prefer-optional-chain", issue: "#2775；#3012 续清" },
  { rule: "typescript/no-unnecessary-template-expression", issue: "#2775；#3015 续清" },
  { rule: "unicorn/no-negated-condition", issue: "#2775；#2977 清零形态 / #3015、#3016 续清" },
  { rule: "unicorn/prefer-import-meta-properties", issue: "#2775" },
  { rule: "unicorn/relative-url-style", issue: "#2775" },
  { rule: "unicorn/prefer-dom-node-append", issue: "#2775" },
  { rule: "unicorn/prefer-dom-node-dataset", issue: "#2775" },
  { rule: "typescript/no-unnecessary-type-arguments", issue: "#2775；#2933" },
  { rule: "eslint/no-else-return", issue: "#2775" },
  { rule: "unicorn/prefer-string-starts-ends-with", issue: "#2775" },
  { rule: "unicorn/no-useless-fallback-in-spread", issue: "#2775" },
  { rule: "unicorn/consistent-existence-index-check", issue: "#2775" },
  { rule: "import/newline-after-import", issue: "#2775" },
  { rule: "react/jsx-boolean-value", issue: "#2775" },
  { rule: "unicorn/prefer-node-protocol", issue: "#2775" },
  { rule: "unicorn/no-hex-escape", issue: "#2775" },
  { rule: "eslint/prefer-template", issue: "#2775" },
  { rule: "eslint/operator-assignment", issue: "#2775" },
  { rule: "eslint/object-shorthand", issue: "#2775" },
  { rule: "eslint/prefer-object-has-own", issue: "#2775" },
  { rule: "react/jsx-curly-brace-presence", issue: "#2775" },
  { rule: "import/no-duplicates", issue: "#2775" },
  { rule: "eslint/no-negated-condition", issue: "#2775" },
  { rule: "unicorn/prefer-spread", issue: "#2775" },
  { rule: "unicorn/prefer-string-replace-all", issue: "#2775" },
  { rule: "unicorn/prefer-at", issue: "#2775" },
  { rule: "unicorn/text-encoding-identifier-case", issue: "#2775" },
  { rule: "eslint/unicode-bom", issue: "#2775" },
  { rule: "typescript/no-import-type-side-effects", issue: "#2775" },
  { rule: "unicorn/prefer-number-properties", issue: "#2775" },
  { rule: "unicorn/prefer-string-raw", issue: "#2775" },
  { rule: "unicorn/switch-case-braces", issue: "#2775" },
  { rule: "unicorn/numeric-separators-style", issue: "#2775；#3037 续清" },
  { rule: "typescript/consistent-type-definitions", issue: "#2775" },
  { rule: "perfectionist/sort-jsx-props", issue: "#2775" },
  { rule: "perfectionist/sort-interfaces", issue: "#2775" },
  { rule: "perfectionist/sort-object-types", issue: "#2775；#3037 续清" },
  // ── #2776 清零（2 条，台账禁用形态见各自碎片）───────────────────
  { rule: "eslint/eqeqeq", issue: "#2776 / #2922（159 处 `== null` 台账禁用）" },
  {
    rule: "eslint/no-void",
    issue: "#2776 / #2923（110 处台账禁用）",
    options: { allowAsStatement: true },
  },
];

/** 诊断码形如 `plugin(rule)`（实测 `unicorn(no-negated-condition)`），按它过滤。
 * @param {string} rule
 */
function diagnosticCode(rule) {
  const slash = rule.indexOf("/");
  return `${rule.slice(0, slash)}(${rule.slice(slash + 1)})`;
}

/**
 * 预设 `rules` 表里已有条目的保选项、只把 severity 抬成 error（categories 全关
 * 关不掉这种规则级条目，它们是预设作者的显式取舍）；没条目的用清单自带选项或裸 error。
 *
 * 预设键名与清单键名**不同拼法**：预设写 `@typescript-eslint/x` 与裸 `x`（eslint 核
 * 心规则），清单按 oxlint 诊断码拼法写 `typescript/x` 与 `eslint/x`。查预设条目要走
 * 别名族 —— 漏了这一步的实测代价：`typescript/consistent-type-definitions` 查不到
 * 预设的 `["error","type"]`，回落成默认选项 `"interface"`，全仓 1138 处假回潮。
 * `"off"` 条目按「没条目」处理（闸的职责就是把已清零规则抬回 error）。
 * @param {string} rule
 * @param {Record<string, unknown> | undefined} options
 */
function toErrorEntry(rule, options) {
  const presetRules = /** @type {Record<string, unknown> | undefined} */ (awesomeness.rules);
  const slash = rule.indexOf("/");
  const plugin = rule.slice(0, slash);
  const name = rule.slice(slash + 1);
  const aliases =
    plugin === "typescript"
      ? [rule, `@typescript-eslint/${name}`]
      : plugin === "eslint"
        ? [rule, name]
        : [rule];
  for (const key of aliases) {
    const existing = presetRules === undefined ? undefined : presetRules[key];
    if (Array.isArray(existing)) return ["error", ...existing.slice(1)];
  }
  if (options !== undefined) return ["error", options];
  return "error";
}

function buildRulesObject() {
  /** @type {Record<string, unknown>} */
  const rules = {};
  for (const { rule, options } of ZERO_RULES) rules[rule] = toErrorEntry(rule, options);
  return rules;
}

/**
 * ZERO_RULES 里挂在 oxlint **非内建** namespace 下的规则需要的 ESLint 插件包。
 * `eslint` / `typescript` / `unicorn` / `react` / `import` 是 oxlint 内建 namespace，
 * 不需要 jsPlugins；`perfectionist` 是 ESLint 插件，必须显式挂上（否则探针配置
 * 解析都不通过 —— `Plugin 'perfectionist' not found`）。
 */
const NON_NATIVE_PLUGINS = [{ prefix: "perfectionist", pkg: "eslint-plugin-perfectionist" }];

/**
 * 解析探针需要的 jsPlugins，返回写进配置的那几行（不需要时是空串）。
 *
 * specifier 写**绝对路径**：oxlint 按「配置文件位置」向上找 `node_modules` 来解析
 * npm 包名形态，而 pnpm 隔离布局下这些插件只存在于 `.pnpm` 子级 —— 顶层没有链接，
 * 从任何配置位置都够不到（实测包名形态恒 `Cannot find module`）。解析基准取
 * `oxlint-config-awesomeness` 的真身位置：它是这些插件的直接依赖（预设自己的
 * `jsPlugins` 也在用它们），从它所在的那层 `node_modules` resolve 恰好可达。
 * 解析不到就不写那一行 —— 让 oxlint 自己把「插件缺失」报出来（退 2 的形态），
 * 不在这里编一个静默降级。
 */
function jsPluginsLines() {
  const presetPkg = createRequire(import.meta.url).resolve(
    "oxlint-config-awesomeness/package.json",
  );
  const req = createRequire(presetPkg);
  const entries = [];
  for (const { prefix, pkg } of NON_NATIVE_PLUGINS) {
    if (!ZERO_RULES.some(({ rule }) => rule.startsWith(`${prefix}/`))) continue;
    const abs = req.resolve(pkg).replaceAll("\\", "/");
    entries.push(`{ name: ${JSON.stringify(prefix)}, specifier: ${JSON.stringify(abs)} }`);
  }
  if (entries.length === 0) return "";
  return `  jsPlugins: [${entries.join(", ")}],\n`;
}

/**
 * 探针配置每次运行现生成。落点是 `node_modules/.cache/`：gitignored、且 oxlint
 * 默认不扫 node_modules（放仓库根会被当成待扫源码）。
 *
 * ⚠️ 探针**不 extends 预设**（判据侧 `toErrorEntry()` 走的是 Node 侧对预设对象的
 * 读取，与这里无关）：extends 会把预设的整组 `jsPlugins`（`@nkzw/eslint-plugin`
 * 那一批）拖进来，而它们按**配置文件位置**解析 specifier，pnpm 隔离布局下
 * 顶层没有链接 ⇒ 从任何配置位置都够不到 ⇒ extends 挂在探针上等于让这一格
 * **永远停在「配置加载失败」（退 2）**。判据要判的是 ZERO_RULES 那 41 条
 * 有没有回潮：categories 全关 + 只抬清单内规则已经把预设的其余负载全部关掉了，
 * extends 在这里不带来任何在场诊断，只带来插件解析这个失败面 —— 等价化简掉；
 * 清单内**非内建** namespace 的插件由 `jsPluginsLines()` 按绝对路径显式挂上。
 */
function writeProbeConfig() {
  const cacheDir = path.join(ROOT, "node_modules", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const configPath = path.join(cacheDir, "oxlint-zero-rules.config.mjs");
  const body = `// 本文件由 scripts/check-oxlint-zero-rules.mjs 每次运行现生成，勿手改。
// 不 extends 预设（jsPlugins 的 specifier 从配置位置解析，pnpm 隔离布局下够不到
// @nkzw —— 见生成方 check-oxlint-zero-rules.mjs 的 writeProbeConfig 注释）。
import { defineConfig } from "oxlint";

export default defineConfig({
${jsPluginsLines()}  categories: {
    correctness: "off",
    suspicious: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
    pedantic: "off",
  },
  rules: ${JSON.stringify(buildRulesObject(), null, 2)},
});
`;
  writeFileSync(configPath, body, "utf8");
  return configPath;
}

function main() {
  const paths = process.argv.slice(2);
  const configPath = writeProbeConfig();
  /* 直起包真身（#2572 同一条路）：`.bin/oxlint.cmd` 只有 cmd.exe 解释得动，
   * 挂 `shell: true` 去起它撞的是 Node 26 的 DEP0190（spawn-shell-scan 那条
   * 硬闸当场红 —— 这一笔修的正是它）。`resolveBinEntryByName("oxlint")` 按垫片名
   * 解析（不按依赖名：oxlint 的 bin 键与依赖名同名，这里两者恰好一致，
   * 但口径上仍按名字走，与 ci-run-tool 同一份地基）。 */
  const entry = resolveBinEntryByName("oxlint", { root: ROOT });
  if (entry === null) {
    console.error(
      "[没跑起来] 解析不到 oxlint 的包真身入口 —— 要么没装（先 `pnpm install`），要么 pnpm 换了垫片写法。自查：`node scripts/package-bin-entry.mjs --by-name oxlint`",
    );
    process.exit(2);
  }
  const args = ["--config", configPath, "--format", "json"];
  // 全仓档（不传路径）才挂 --type-aware，与历次复扫口径一致；契约自测档扫的是
  // 仓外临时夹具，没有 tsconfig 可挂，且负控只选语法级规则（见文件头）。
  if (paths.length === 0) {
    args.push("--type-aware");
  } else {
    args.push(...paths);
  }
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 的 error 只会是 Error 或 undefined，!== null 是防守形态
  if (res.error !== undefined && res.error !== null) {
    console.error(`[没跑起来] oxlint 进程没起来：${res.error.message}`);
    process.exit(2);
  }
  // oxlint 有诊断时退 1，所以 status 不是判决面；判决面只有 stdout 是不是 JSON。
  let report;
  try {
    report = JSON.parse(String(res.stdout));
  } catch {
    console.error("[没跑起来] oxlint 输出不是 JSON（配置加载失败一类）。stderr 头部：");
    console.error(String(res.stderr).slice(0, 2000));
    process.exit(2);
  }
  const files = typeof report.number_of_files === "number" ? report.number_of_files : 0;
  if (paths.length === 0 && files === 0) {
    console.error("[没跑起来] 全仓档扫到 0 份文件 —— 「一条都没判」不许读成「0 命中」。");
    process.exit(2);
  }
  const codes = new Set(ZERO_RULES.map(({ rule }) => diagnosticCode(rule)));
  const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  const hits = diagnostics.filter((/** @type {{ code?: unknown }} */ d) =>
    codes.has(/** @type {string} */ (d.code)),
  );
  if (hits.length > 0) {
    console.error(
      `已清零 oxlint 规则集回潮：${hits.length} 处命中（清单 ${ZERO_RULES.length} 条，溯源见 scripts/check-oxlint-zero-rules.mjs 的 ZERO_RULES）：`,
    );
    for (const d of hits) {
      const span = Array.isArray(d.labels) && d.labels.length > 0 ? d.labels[0].span : undefined;
      const where =
        span === undefined ? String(d.filename) : `${d.filename}:${span.line}:${span.column}`;
      console.error(`  ${where}  ${String(d.code)}  ${String(d.message).split("\n")[0]}`);
    }
    console.error(
      "修法：按该规则清零批的既有形态改写（读数与形态见对应 changelog 碎片），不是抬基线、不是加禁用。",
    );
    process.exit(1);
  }
  console.log(
    `[ok] 已清零 oxlint 规则集 ${ZERO_RULES.length} 条全仓 0 命中（扫描 ${files} 份文件）。`,
  );
}

main();
