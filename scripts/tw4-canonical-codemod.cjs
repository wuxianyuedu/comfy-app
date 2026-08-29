/**
 * Tailwind v4 canonical class codemod(一次性迁移脚本,保留备用):
 *   1. 透明度括号写法 /-[0.06] → /6(v4 任意百分比直接写,小数如 /1.5 同理)
 *   2. bg-gradient-to-X → bg-linear-to-X(v4 改名)
 *   3. -[var(--x)] → -(--x)(v4 CSS 变量简写)
 * 用法:node scripts/tw4-canonical-codemod.cjs <file...>
 * 只改字符串字面量里的类名模式,不解析 AST——模式足够特异,误伤风险低。
 */
const fs = require("node:fs");

for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, "utf8");
  let count = 0;
  const after = before
    .replace(/\/\[0\.(\d+)\]/g, (_, digits) => {
      count++;
      return "/" + String(parseFloat("0." + digits) * 100);
    })
    .replace(/bg-gradient-to-([a-z]+)/g, (_, dir) => {
      count++;
      return "bg-linear-to-" + dir;
    })
    .replace(/-\[var\(--([a-zA-Z0-9-]+)\)\]/g, (_, v) => {
      count++;
      return "-(--" + v + ")";
    });
  if (count) {
    fs.writeFileSync(file, after);
    console.log(count, file);
  }
}
