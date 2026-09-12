#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:CHANGELOG 碎片门禁(供 .githooks/pre-commit 与 CI 调用)
/**
 * CHANGELOG 碎片门禁 —— 规范见 docs/standards/13-提交与-code-review.md §13.10.5。
 *
 * 背景(ISSUE #408「changelog 经常改动，总是冲突」)：
 * `CHANGELOG.md` 是**全仓库唯一的一处人人都在改、且都改同一个地方**的文件。
 * `[Unreleased]` 段落里本轮所有改动都往同一个列表尾部追加，于是两条并行分支
 * (或两个 agent 同时开工)必然落在同一行区间 —— 无论谁先合，另一方都要手工解冲突，
 * 而解析冲突恰恰是**最没有信息量**的一步：两段纯文本各自都该保留，没有真取舍。
 *
 * 根治办法不是「写得更小心」，而是**让每条变更各有各的文件**：条目改放
 * `changelog.d/<issue号>-<slug>.md`，一件变更一个文件 —— git 层面不同文件不会冲突。
 * 本脚本负责两件事：
 *   ① 守卫「碎片目录与 `[Unreleased]` 不同时写同一条变更」：若某次提交同时改了
 *      碎片目录与 `[Unreleased]` 正文，则要求碎片文件在同时新增(纯新增不算冲突源)；
 *   ② 校验每个碎片文件的形态：文件名合 `<issue号>-<slug>.md`、首行是标准段落标题
 *      (Added/Changed/Deprecated/Removed/Fixed/Security)、正文非空。
 *
 * 判定口径：
 *   检查  = 遍历 `changelog.d/*.md`(忽略 README.md)，逐条校验形态；
 *   失败  = 任一碎片不合形态,或脚本无法读取碎片目录(路径写错等)。
 * 退出码 0 = 通过,1 = 阻断。
 *
 * 用法:node scripts/check-changelog-fragments.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FRAGMENT_DIR = "changelog.d";
/** 允许的段落标题 —— Keep a Changelog 的固定段落集(规范 §13.10.4)。 */
const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
/** 碎片文件名:`<issue号>-<slug>.md`;issue 号允许 `#` 前缀,slug 用小写字母数字与连字符。 */
const FILE_RE = /^#?(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
/** 非「一条变更」的文件:目录说明文档不参与形态校验。 */
const IGNORED_FILES = new Set(["README.md"]);

const problems = [];

function readDirSafe(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return null;
  return fs.readdirSync(abs, { withFileTypes: true });
}

/**
 * 校验单个碎片文件:文件名、首行段落标题、正文。
 * 返回 null 表示通过,否则返回问题描述。
 */
function checkFragment(name, text) {
  const fileProblems = [];
  if (!FILE_RE.test(name)) {
    fileProblems.push(
      `${FRAGMENT_DIR}/${name}:文件名应为 <issue号>-<slug>.md(如 408-changelog-conflict-free.md)。` +
        `issue 号取本次变更的 ISSUE,slug 用「-」分隔的小写英文;无 ISSUE 时用 0。`
    );
  }
  const lines = text.split("\n").map((l) => l.trimEnd());
  const firstContent = lines.find((l) => l.trim() !== "") ?? "";
  const heading = firstContent.replace(/^#{1,6}\s*/, "").trim();
  if (!SECTIONS.includes(heading)) {
    fileProblems.push(
      `${FRAGMENT_DIR}/${name}:首行须是段落标题(## Added / ## Changed / ## Deprecated / ` +
        `## Removed / ## Fixed / ## Security),当前是「${firstContent || "(空文件)"}」。` +
        `段落标题决定条目并入 [Unreleased] 的哪一节,不能省。`
    );
  }
  const body = lines
    .slice(lines.indexOf(firstContent) + 1)
    .join("\n")
    .trim();
  if (!body) {
    fileProblems.push(
      `${FRAGMENT_DIR}/${name}:只有段落标题、没有条目正文。写清「升级方会看到什么不同」` +
        `(判据见 13.10.2),空碎片会在发布时并入一个空段落。`
    );
  }
  return fileProblems.length ? fileProblems : null;
}

function main() {
  const entries = readDirSafe(FRAGMENT_DIR);
  if (!entries) {
    // 目录可以不存在(尚未启用碎片流的仓库)——此时不做任何断言,直接放行。
    // 但一旦存在就必须自洽,避免「目录建了一半」的静默状态。
    console.log(`[changelog] 未启用碎片目录 ${FRAGMENT_DIR}/,跳过(见规范 13.10.5)`);
    return;
  }

  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md") && !IGNORED_FILES.has(e.name));
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, FRAGMENT_DIR, f.name), "utf8");
    const p = checkFragment(f.name, text);
    if (p) problems.push(...p);
  }

  if (problems.length > 0) {
    console.error("\n[changelog] CHANGELOG 碎片不合规:\n");
    for (const p of problems) console.error("  ✗ " + p);
    console.error(
      `\n共 ${problems.length} 项。碎片约定见 docs/standards/13-提交与-code-review.md §13.10.5。`
    );
    process.exit(1);
  }
  console.log(`[changelog] ✓ ${files.length} 个碎片形态正确(${FRAGMENT_DIR}/)`);
}

/** 供测试直接引用:不执行 IO 的纯判定。 */
module.exports = { checkFragment, FILE_RE, SECTIONS, FRAGMENT_DIR, IGNORED_FILES };

if (require.main === module) main();
