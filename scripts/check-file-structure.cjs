// @ts-nocheck -- 提交门槛脚本:文件命名/组织硬规则(供 .githooks/pre-commit 调用)
/**
 * 文件组织硬规则(规范见 docs/standards/12-代码组织与文件结构.md):
 *   R1  src 下 .tsx 文件名必须 PascalCase(测试伙伴文件 X.test.tsx 同样以大写开头;
 *       豁免:src/app 下 Next 保留名、CONVENTION_EXEMPT 列出的库惯例文件、
 *       以及目录索引 index.tsx——§12.6 把 index 单列为「目录索引」命名约定)
 *   R2  src 下 .ts 文件名禁止 PascalCase(非组件模块一律 kebab-case)
 *   R3  禁止时间戳备份文件(\d{8}_\d{6} 模式)——版本回退用 git,不进 src
 *   R4  src/lib 下禁止 .tsx(12.5:lib 无 React)
 *   R5  (提示)src/components 下超 900 行的文件列入拆分候选,仅提醒不阻塞
 * 违反 R1-R4 以退出码 1 阻断提交。
 */
const fs = require("node:fs");
const path = require("node:path");

const problems = [];
const splitHints = [];

// Next.js App Router 保留文件名(框架强制小写,不可改名)——src/app 下豁免
const NEXT_RESERVED = new Set([
  "page", "layout", "error", "global-error", "loading", "not-found",
  "template", "default", "route", "manifest", "robots", "sitemap", "icon",
]);
// 库官方惯例文件(目录约定)
const CONVENTION_EXEMPT = new Set(["src/trpc/react.tsx"]);

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(tsx?|mjs|cjs|js)$/.test(e.name)) continue;
    const rel = p;
    const base = e.name.replace(/\.(tsx?|mjs|cjs|js)$/, "").replace(/\.test$/, "");
    if (/\d{8}_\d{6}/.test(e.name)) problems.push("R3 时间戳备份文件:" + rel);
    if (/\.(tsx|mjs|cjs|js)$/.test(e.name) && rel.startsWith("src/")) {
      if (e.name.endsWith(".tsx")) {
        /* §12.6 把「目录索引」单列为一种命名约定（index.tsx 组件 /
         *  index.ts 模块），它是 barrel，不承载组件实现，因此不受
         *  R1「组件文件须 PascalCase」约束。 */
        const isDirectoryIndex = base === "index";
        const reserved = (rel.startsWith("src/app/") && NEXT_RESERVED.has(base))
          || CONVENTION_EXEMPT.has(rel)
          || isDirectoryIndex;
        if (!reserved && !/^[A-Z]/.test(base)) problems.push("R1 组件文件须 PascalCase:" + rel);
        if (rel.startsWith("src/lib/")) problems.push("R4 lib 下禁止 .tsx:" + rel);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        if (/^[A-Z]/.test(base)) problems.push("R2 模块文件须 kebab-case:" + rel);
      }
      const lines = fs.readFileSync(p, "utf8").split("\n").length;
      if (rel.startsWith("src/components/") && lines > 900)
        splitHints.push(rel + " (" + lines + " 行,建议拆分)");
    }
  }
})("src");

if (splitHints.length) {
  console.log("[structure] 拆分候选(仅提醒):\n  " + splitHints.join("\n  "));
}
if (problems.length) {
  console.error("[structure] 违规(阻断提交):\n  " + problems.join("\n  "));
  console.error("规范见 docs/standards/12-代码组织与文件结构.md §12.6/§12.8");
  process.exit(1);
}
console.log("[structure] OK");
