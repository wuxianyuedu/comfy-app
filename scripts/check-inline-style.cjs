#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：视图层不得动态注入 <style>（供 .githooks/pre-commit 与 CI 调用）
/**
 * 内联样式注入门禁 —— 规范见 docs/standards/03-样式与-tailwind.md §3.5
 * （反模式速查表 T5）。
 *
 * 判据一句话：**渲染出的 JSX 里不得出现 `<style>`**。要注入 CSS，就放进
 * `globals.css`（或独立 `.css` 文件）——那是静态产物，构建期确定、可被提取、
 * 只注入一次；而写在组件里的 `<style>{CSS}</style>` 会随**每一次渲染**重新
 * 生成同一个 style 元素（React 的 diff 认不出「内容没变但节点是新的」），
 * 并且代码分割后同一份 CSS 可能被多份 chunk 各自注入。
 *
 * 本仓库踩过两次，形态一模一样（都是「组件私有 CSS 字符串 + 渲染时注入」）：
 *   · `WorkflowEditorCanvas`（已改，注释里留了 INLINED_STYLE 的说明）；
 *   · `studio/ui/CodeBlock` 的 `CODE_BLOCK_CSS`（已改，类名沿用 `cb-*`，
 *     纯搬迁到 `globals.css`）。
 * 「自己修完自己写注释」挡不住下一个人，所以这条要有机器判据。
 *
 * 允许的例外只有「CSS 是运行时才知道的值」——那种情况写 `style={{…}}`
 * 属性（React 的属性 diff 正常工作），而不是塞一个 <style> 元素。因此本
 * 脚本不做其他豁免：`src/**` 下任何 `.tsx` / `.ts` 渲染出的 `<style>` 都阻断。
 *
 * 反例（本脚本存在的理由）：
 *     例如  const CSS = `.x { color: red }`;
 *     反例：内联注入 <style>{CSS}</style> 的写法
 * 正例：
 *     // globals.css
 *     .x { color: red }
 *     // 组件
 *     正例：只写 <div className="x" />，样式走 globals.css
 *
 * 用法：node scripts/check-inline-style.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
/** 扫描 `src/**`，含组件、页面与 lib（.ts 里也可能用 createElement 造 style）。 */
const SCAN_DIR = "src";
/** `<style>` 元素（可带属性，如 `<style jsx>`）。 */
const INLINE_STYLE = /<style\b[^>]*>/;

/** 豁免：文件路径 → 理由。只有「注释/文档里必须引用被禁写法」才配进来。 */
const EXEMPT = new Map([
  // 反模式表与安全净化模块的注释里必然出现该字面量（它们是口径本身）
  ["src/lib/comfyui/markdown.ts", "HTML 净化白名单里列举 <style> 作为被剥离标签"],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
      walk(abs, out);
    } else if (/\.[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const problems = [];

for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const file = rel(abs);
  if (EXEMPT.has(file)) continue;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // 注释行不算（解释历史写法是允许的，判据是「渲染出」的 JSX）
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (!INLINE_STYLE.test(line)) return;
    problems.push(`${file}:${index + 1}  ${trimmed.slice(0, 120)}`);
  });
}

if (problems.length === 0) {
  console.log("[inline-style] ✓ 视图层无动态 <style> 注入（CSS 走 globals.css）");
  process.exit(0);
}

console.error(
  `[inline-style] 渲染出的 <style> 会随每次渲染重新注入（规范 03 §3.5 / 反模式 T5），` +
    `却发现 ${problems.length} 处：\n  ${problems.join("\n  ")}\n\n` +
    "修法：把那段 CSS 搬进 src/app/globals.css（类名保持原样，纯搬迁）；" +
    "只有「值在运行时才知道」的场景才用 style={{…}} 属性，不要塞 <style> 元素。",
);
process.exit(1);
