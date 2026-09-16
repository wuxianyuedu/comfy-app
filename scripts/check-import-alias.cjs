#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:import 别名统一(供 .githooks/pre-commit 与 CI 调用)
/**
 * import 别名门禁 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.2 与
 * docs/standards/16-shadcn-ui与表单校验.md §16.2。
 *
 * 背景(ISSUE #640)：本仓库的别名约定是 **`~` 前缀**（`~/lib/utils`、
 * `~/components/ui/button`），`tsconfig.json` 的 `paths` 里 `~/*` 列在最前，
 * `components.json` 的四个 alias 也全是 `~/`。但 `@/*` 同时在 `paths` 里 ——
 * 它是 create-t3-app 脚手架留下的历史项，于是 `@/` 也能编译、也能跑，
 * **没有任何反馈**。
 *
 * 结果就是「别名漂移」：仓库里 `@/` 与 `~/` 长期并存（ISSUE #640 时点 573 处
 * `@/`、2 518 处 `~/`）。它单独看每一处都「没毛病」，代价有两个：
 *   ① 同一件事有两种写法，新人（与 AI 生成器）照最近的邻居抄，漂移面积自己变大;
 *   ② `shadcn add <comp>` 生成的组件默认写 `@/`（§16.3 已点名），
 *      `src/components/ui/**` 因此是漂移的高发区 —— 而 ui/ 是「工具生成、
 *      不手改」的目录，靠人去改不现实。
 * 所以判据必须机器化 —— 本仓库的既有口径是「判据不接门禁就等于没有判据」。
 *
 * 判定口径(刻意简单，宁少误报)：
 *   扫描 `src/**` 与 `e2e/**` 的 .ts/.tsx，逐行找**静态模块说明符**：
 *     行内出现   `from "<spec>"`  →  spec 以 `@/` 开头即违规
 *     行内出现   `import("<spec>")`、`require("<spec>")`、`vi.mock("<spec>")`
 *                →  同一判据
 *   行号与原文一并打印，方便直接改。
 *
 * 豁免:
 *   · 整行注释(`//` `*` `/*`)——注释里写「旧写法是 @/…」是**该留的 Why**,
 *     把它也当成违规会逼着人删掉解释漂移来由的注释(§12.4.1)。
 *   · 行内代码片段里的反引号引用（如 `` `@/lib/endpoints` ``）——同上，
 *     它们出现在注释里，已被上一条覆盖。
 *
 * 用法:node scripts/check-import-alias.cjs
 *      node scripts/check-import-alias.cjs --root <dir>   # 指定扫描根(自测用)
 */
const fs = require("node:fs");
const path = require("node:path");

/** 扫描范围:应用源码与 e2e。`scripts/` 是 .mjs/.cjs 工具脚本区,不用 TS 别名。 */
const SCAN_DIRS = ["src", "e2e"];
const SOURCE_EXT = /\.(ts|tsx)$/;

/** 别名判据:模块说明符以 `@/` 开头。 */
const AT_ALIAS = /^(?:\.\.?\/)+.*|@\//;
const SPEC_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bvi\.(?:mock|importActual|doMock)\s*\(\s*["']([^"']+)["']/g,
];

/** 整行注释:不参与判定(注释里解释漂移来由是 §12.4.1 要求的内容)。 */
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const problems = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else if (SOURCE_EXT.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

function scanFile(abs, rel) {
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    const seen = new Set();
    for (const re of SPEC_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const spec = m[1] ?? "";
        if (!spec.startsWith("@/")) continue;
        if (seen.has(spec)) continue;
        seen.add(spec);
        problems.push(
          rel + ":" + (i + 1) + " 别名用 @/ 而非 ~/ → " + spec + "\n    → " + line.trim(),
        );
      }
    }
  });
}

/* ── 入口 ──────────────────────────────────────────────── */

const args = process.argv.slice(2);
let root = path.resolve(__dirname, "..");
const rootIdx = args.indexOf("--root");
if (rootIdx !== -1 && args[rootIdx + 1]) root = path.resolve(args[rootIdx + 1]);

for (const dir of SCAN_DIRS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    scanFile(file, path.relative(root, file).split(path.sep).join("/"));
  }
}

if (problems.length) {
  console.error("[alias] 违反「统一用 ~ 前缀」(规范 §12.2 / §16.2):\n  " + problems.join("\n  "));
  console.error(
    "把 `@/…` 改成 `~/…` 即可。`@/*` 只是脚手架留下的 paths 历史项,仍可编译但非本仓库约定;" +
      "`shadcn add` 生成的组件默认写 `@/`,新增后须顺手改(§16.3)。",
  );
  process.exit(1);
}
console.log("[alias] OK");
