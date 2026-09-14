#!/usr/bin/env node
// @ts-nocheck -- 构建产物护栏（供 CI 在 `pnpm build` 之后调用）
/**
 * standalone 产物内容护栏 —— 规范见 docs/standards/launch-and-build.md §7.2。
 *
 * 背景（ISSUE #489）：`next build`（Turbopack）对无法静态收敛的动态路径访问
 * 会打 `Dynamic filesystem access causes tracing of the whole project`，并把
 * **整个项目**当作 server code 依赖复制进 `.next/standalone`。真正的防线是
 * `next.config.js` 的 `outputFileTracingExcludes`（工作在产物路径层面）。
 *
 * 但「清单还在」不等于「清单生效」——历史事故正是键位挂在 `experimental` 下
 * 一个字都没被读，却因为没有任何检查去数产物里的文件而无人察觉。
 * 本脚本在**构建之后**真去数 `.next/standalone`：测试文件 / 变更碎片 /
 * 文档目录绝不能出现在产物里（它们不可能是任何 server code 的运行时依赖）。
 *
 * 用法：node scripts/check-standalone-contents.cjs
 *   · 产物不存在时**跳过并不报错**（本脚本守的是构建结果，不是构建本身）
 *   · 发现不该有的文件时非零退出，并列出前若干个样本
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

/** 不该出现在 standalone 里的东西：[标签, 相对路径正则] */
const FORBIDDEN = [
  ["测试文件", /(^|\/)src\/.*\.test\.tsx?$/],
  ["变更碎片", /(^|\/)changelog\.d\/.*\.md$/],
  ["文档目录", /(^|\/)docs\/.*\.md$/],
];

function listFiles(dir, prefix, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue; // 断链（pnpm symlink 等），跳过
    }
    if (st.isDirectory()) listFiles(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

function main() {
  if (!fs.existsSync(STANDALONE)) {
    console.log(
      "[standalone] 未找到 .next/standalone，跳过（本检查在 `pnpm build` 之后运行才有意义）",
    );
    return 0;
  }
  const files = listFiles(STANDALONE, "", []);
  let failed = false;
  for (const [label, re] of FORBIDDEN) {
    const hits = files.filter((f) => re.test(f));
    if (hits.length > 0) {
      failed = true;
      console.error(
        `[standalone] ${label}不该进产物，却发现 ${hits.length} 个：\n  ` +
          hits.slice(0, 8).join("\n  ") +
          (hits.length > 8 ? `\n  …（其余 ${hits.length - 8} 个省略）` : ""),
      );
    }
  }
  if (failed) {
    console.error(
      "\n[standalone] 请检查 next.config.js 的 outputFileTracingExcludes " +
        "（键位必须在顶层，Next 16 已把它从 experimental 升为顶层键；" +
        "写在旧位置一个字都不会被读）。规范 §7.2。",
    );
    return 1;
  }
  console.log(
    `[standalone] ✓ 产物干净（共 ${files.length} 个文件，无测试 / 文档 / 变更碎片）`,
  );
  return 0;
}

process.exit(main());
