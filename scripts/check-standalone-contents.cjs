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
/** build-desktop.mjs 的组装结果（最终被编译期内嵌进 exe）。 */
const STATIC_DIR = path.join(ROOT, "src-tauri", "static");

/** 不该出现在 standalone 里的东西：[标签, 相对路径正则] */
const FORBIDDEN = [
  ["测试文件", /(^|\/)src\/.*\.test\.tsx?$/],
  ["变更碎片", /(^|\/)changelog\.d\/.*\.md$/],
  ["文档目录", /(^|\/)docs\/.*\.md$/],
  // 开发机私有输入：`.env` 会被 Next standalone 无条件复制，`db.sqlite` 由动态
  // 路径 tracing 带入（两者都实测复现）。它们随 static 被编译期内嵌进 exe ——
  // 密钥明文随包分发，开发库还会成为应用首次启动时读写的那个库（见
  // scripts/build-desktop.mjs 的「分发卫生」一节）。这里连同 SQLite 的 WAL/SHM
  // 边车文件一起拦。清单是**欠完备**的：新形态（如 `.env.*.local`）不会自动命中，
  // 真正的兜底是产物层数文件，不是清单本身。
  ["开发机私有输入", /(^|\/)\.env(\.[^/]*)?$/],
  ["开发库文件", /(^|\/)db\.sqlite(-wal|-shm)?$/],
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

/**
 * 数一份产物的文件并做同一份禁忌清单检查。
 * @param {string} dir 产物目录
 * @param {string} label 输出前缀
 * @returns {boolean} 是否发现违规
 */
function checkDir(dir, label) {
  const files = listFiles(dir, "", []);
  let failed = false;
  for (const [tag, re] of FORBIDDEN) {
    const hits = files.filter((f) => re.test(f));
    if (hits.length > 0) {
      failed = true;
      console.error(
        `[${label}] ${tag}不该进产物，却发现 ${hits.length} 个：\n  ` +
          hits.slice(0, 8).join("\n  ") +
          (hits.length > 8 ? `\n  …（其余 ${hits.length - 8} 个省略）` : ""),
      );
    }
  }
  if (!failed) {
    console.log(
      `[${label}] ✓ 产物干净（共 ${files.length} 个文件，无测试 / 文档 / 变更碎片 / 开发机私有输入）`,
    );
  }
  return failed;
}

function main() {
  let failed = false;

  if (fs.existsSync(STANDALONE)) {
    failed = checkDir(STANDALONE, "standalone") || failed;
  } else {
    console.log(
      "[standalone] 未找到 .next/standalone，跳过（本检查在 `pnpm build` 之后运行才有意义）",
    );
  }

  // src-tauri/static 是 build-desktop.mjs 的组装结果（最终被编译期内嵌进 exe），
  // 比 .next/standalone 更接近用户拿到的东西；存在就一起查。
  if (fs.existsSync(STATIC_DIR)) {
    failed = checkDir(STATIC_DIR, "static") || failed;
  }

  if (failed) {
    console.error(
      "\n[standalone] 请检查两处：① next.config.js 的 outputFileTracingExcludes" +
        "（键位必须在顶层，Next 16 已把它从 experimental 升为顶层键；写在旧位置" +
        "一个字都不会被读）；② scripts/build-desktop.mjs 的「分发卫生」剔除清单" +
        "（.env / db.sqlite* 只能靠显式删除，excludes 对 .env 实测无效）。规范 §7.2。",
    );
    return 1;
  }
  return 0;
}

process.exit(main());
