#!/usr/bin/env node
/**
 * qoder-ignore.mjs — `.qoderignore`（Qoder 代码索引的排除表）的**唯一写出者**（ISSUE #2712）。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────────────
 *
 * 本仓真正重的树（`src-tauri/target` / `.next` / `python-venv` / `coverage` …）
 * **早就被 `.gitignore` 忽略了** —— 判据、`git`、`grep` 都不碰它们。但索引器不吃
 * `.gitignore`，它吃自己那份 `.qoderignore`；于是每台机器都要重新发现一遍「索引为什么这么贵」，
 * 并各自手写一份形状不一的表。这份脚本把那一次发现固定下来：拿到仓库执行
 * `pnpm qoder:ignore` 就装好，别人不必再猜。
 *
 * 最后一组（生成态镜像 / 历史归档）**不在上面那句话的量程里**：它们是入库的，`git` 与
 * `grep` 都碰得到，只是不该在索引里常驻两份。它不影响任何判据的根据换了另一条 ——
 * 判据读的是 git 清单与源码树，而 `.qoderignore` 只被索引器读。
 *
 * ── 三条形状约定 ──────────────────────────────────────────────────────────
 *
 *   · **人别手改产物**：`.qoderignore` 由这里渲染；「入库那份 ⇄ 工具会写的那份」由
 *     `tests/qoder-ignore.test.ts` 钉同批（它读磁盘文本，而 `.qoderignore` 不被任何代码
 *     import ⇒ 已登记进 `scripts/fixed-structural-tests.mjs`，否则改它不会进增量面）；
 *   · **不写绝对读数进产物**：体积是「这台机器、这一刻」的数（今天 `du` 出来的 GB 数
 *     明天就是一条过期陈述），所以产物里只写**为什么排除**，现场读数留在 #2712 正文；
 *   · **不碰别人的本地 git 状态**：一次也不往 `.git/info/exclude` 写东西 —— 那个文件
 *     是每台机器自己的，工具要能重复跑在任何人身上都不改变他的本地配置。
 *
 * 用法：
 *   pnpm qoder:ignore          写 / 刷新（内容相同 ⇒ 一个字节都不写）
 *   pnpm qoder:ignore --check  只比对：不一致退 1（缺文件也算不一致）
 *   pnpm qoder:ignore --print  把会写的内容打到标准输出（不落盘，评审时看着方便）
 *
 * 退出码：0 = 一致 / 已写好；1 = `--check` 发现不一致；2 = 没结论（写不进去）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HERE = path.join(ROOT, ".qoderignore");
const TAG = "[qoder-ignore]";

/**
 * 排除表本体：一份数据，三个出口（写 / 比对 / 打印）都渲染它。
 *
 * 每条 `why` 会进产物的注释 —— 一行没有理由的排除，下一个人只能猜它是不是漏配，
 * 而「猜」的结果通常是直接删掉那条（然后索引又贵回去）。
 *
 * @type {{section: string, entries: {pattern: string, why: string}[]}[]}
 */
export const IGNORE_SECTIONS = [
  {
    section: "依赖与构建产物",
    entries: [
      { pattern: "/node_modules/", why: "依赖树，全是第三方源码与打包产物" },
      { pattern: "/.next/", why: "Next 的构建与开发缓存（Turbopack 产物 + standalone）" },
      { pattern: "/out/", why: "Next 静态导出的产物" },
      { pattern: "/dist/", why: "打包输出目录" },
      { pattern: "/coverage/", why: "覆盖率报告（判据读它，索引不需要）" },
      { pattern: "/storybook-static/", why: "Storybook 静态站产物" },
      { pattern: "/test-results/", why: "Playwright 每次跑的产物" },
      { pattern: "/playwright-report/", why: "Playwright 的 HTML 报告" },
    ],
  },
  {
    section: "桌包（Tauri）",
    entries: [
      {
        pattern: "/src-tauri/target/",
        why: "Cargo 的 target 树：本仓最大的一棵，且内含第三方 Rust 源码",
      },
    ],
  },
  {
    section: "本机运行状态与临时物",
    entries: [
      { pattern: "/python-venv/", why: "ComfyUI 侧的 Python 虚拟环境（第三方包）" },
      { pattern: "/log/", why: "运行日志（按 §4 的布局落盘，滚动很快）" },
      { pattern: "/data/", why: "本机私有状态：备份、密钥材料、画布数据" },
      { pattern: "/run/", why: "运行期临时文件" },
      { pattern: "/temp/", why: "临时目录" },
      { pattern: "/db.sqlite", why: "本地数据库本体（WAL 辅助文件见下一行）" },
      { pattern: "/db.sqlite-*", why: "SQLite 的 -wal / -shm 运行时文件" },
    ],
  },
  {
    section: "生成物与工具缓存",
    entries: [
      {
        pattern: "/docs/api/",
        why: "TypeDoc 的生成物（几千份 .md；判据那一格会自己重新生成，不进 git）",
      },
      { pattern: "/.qoder/cache/", why: "Qoder 自己的缓存，不需要被索引" },
      {
        pattern: "/.codegraph/",
        why: "codegraph 的本地索引目录（`pnpm agent:index` 里由 `codegraph init` 生成；本机缓存，不入库）",
      },
      {
        pattern: "/.zvec-grep/",
        why: "zvec-grep 的工作区索引目录（`zg index` 生成；本机缓存，不入库）",
      },
      { pattern: "*.tsbuildinfo", why: "tsc 的增量构建信息文件" },
    ],
  },
  {
    section: "入库文字里刻意只出索引的那几份（留在库里给人读，不是漏配）",
    entries: [
      {
        pattern: "/docs/generated/",
        why: "docs/standards 各章的生成态镜像：入库给人读，而正文与源逐字重复 ⇒ 检索不必常驻两份",
      },
      {
        pattern: "/CHANGELOG-archive.md",
        why: "并入过的碎片全文归档：入库给人读，查一条历史变更走 grep/git，不必占着语义索引",
      },
    ],
  },
];

/** 产物文件的头注：为什么存在、怎么重新生成、改了要怎么生效。 */
const HEADER = [
  "# .qoderignore —— Qoder 代码索引的排除表（格式同 .gitignore）",
  "#",
  "# 这份文件由 `node scripts/qoder-ignore.mjs` 生成，**不要手改**：",
  "#   pnpm qoder:ignore          写 / 刷新（幂等）",
  "#   pnpm qoder:ignore --check  比对「入库这份 ⇄ 工具会写的那份」，不一致退 1",
  "# 它只影响索引器的扫描面，**不影响任何判据**：门禁读的是 git 清单与源码树。",
  "# 绝大多数条目本来也被 .gitignore 忽略着；最后一组是**入库**文件（生成态镜像、历史归档）：",
  "# 它们给人读、被配对门禁判同批，只是不该进索引 —— 那是刻意的「只出索引」，不是漏配。",
  "# ⚠️ 改完要重启 Qoder CN 进程才生效（编辑文件本身不会热加载）。",
  "",
];

/**
 * 渲染 `.qoderignore` 全文。纯函数：不读盘、不写盘，所以「会写成什么」可被判据直接问。
 *
 * @returns {string} 以 LF 结尾的完整文件内容
 */
export function renderIgnore() {
  const lines = [...HEADER];
  for (const { section, entries } of IGNORE_SECTIONS) {
    lines.push(`# ${section}`);
    for (const { pattern, why } of entries) {
      lines.push(`# ${why}`, pattern);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 两份内容的行级差异（人读摘要，不是 unified diff）。
 *
 * 只做「逐行比」+「集合差」两件事：幂等判定要的是**逐字节相同**，而读的人要的是
 * 「到底动了哪几行」—— 顺序换了也如实报成「一增一删」，不假装它是移动。
 *
 * @param {string} current 盘上现有内容（缺文件时给空串）
 * @param {string} wanted `renderIgnore()` 的结果
 * @returns {{same: boolean, added: string[], removed: string[]}}
 */
export function diffIgnore(current, wanted) {
  const a = current.split("\n");
  const b = wanted.split("\n");
  if (a.join("\n") === b.join("\n")) {
    return { same: true, added: [], removed: [] };
  }
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    same: false,
    added: b.filter((l) => !setA.has(l)),
    removed: a.filter((l) => !setB.has(l)),
  };
}

/**
 * @param {string[]} [argv]
 * @returns {number} 退出码
 */
export function main(argv = process.argv.slice(2)) {
  const wanted = renderIgnore();
  if (argv.includes("--print")) {
    process.stdout.write(wanted);
    return 0;
  }
  let current = "";
  let missing = false;
  try {
    current = fs.readFileSync(HERE, "utf8");
  } catch {
    missing = true;
  }
  const delta = diffIgnore(missing ? "" : current, wanted);
  if (delta.same) {
    process.stdout.write(`${TAG} ✓ .qoderignore 已是工具会写的那一份，没动任何字节\n`);
    return 0;
  }
  if (argv.includes("--check")) {
    const where = missing ? "文件不存在" : "内容与工具输出不一致";
    process.stderr.write(
      `${TAG} ✗ ${where}。差 ${delta.added.length} 增 / ${delta.removed.length} 删：\n${
        [...delta.added.map((l) => `  + ${l}`), ...delta.removed.map((l) => `  - ${l}`)]
          .slice(0, 20)
          .join("\n")
        }\n  修法：pnpm qoder:ignore 后把结果一并提交（人别手改产物）。\n`,
    );
    return 1;
  }
  try {
    fs.writeFileSync(HERE, wanted, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(/** @type {{code: string}} */ (error).code)
        : "UNKNOWN";
    process.stderr.write(`${TAG} 写不进去（${code}）：${HERE} —— 这是「没跑成」，不是「已装好」\n`);
    return 2;
  }
  process.stdout.write(
    `${TAG} ${missing ? "已生成" : "已刷新"} .qoderignore（+${delta.added.length} / -${delta.removed.length} 行）\n` +
      `${TAG} ⚠️ 要重启 Qoder CN 进程才生效。\n`,
  );
  return 0;
}

// oxlint-disable-next-line typescript/no-unnecessary-condition -- 直接执行判据：以 REPL / 无脚本入口方式入场时 argv[1] 运行时为 undefined
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await main());
}
