#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:零消费导出扫描(供 .githooks/pre-commit 与 CI 调用)
/**
 * 零消费导出扫描 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.16。
 *
 * 背景(ISSUE #573 第 9 项)：`core/result.ts` 的 89 行 `Result` 类型、零 `new`
 * 调用点的 7 个错误类、`core/events.ts` 的 `eventBus` —— 这批「为将来准备的
 * 抽象」在审查时全是**人工读出**的，没有任何判据。它们的代价是可数的：读代码
 * 的人以为它在工作（覆盖率里还占着行），而生产路径一次都走不到。
 *
 * 判据(实测「导出但零外部引用」566 个 —— 绝大多数是同文件内使用的 props 类型，
 * 因此**不是**「导出即死」)：
 *
 *   只扫 `src/lib/**`，且只认**值导出**（函数 / 常量 / 类 / 枚举）——
 *   `type` / `interface` 一律不看：它们大多是「同文件内使用的 props 类型」，
 *   正是那份 566 个清单里 90% 的来源，纳入只会把判据变成噪音。
 *   值导出在 `src/**`、`scripts/**`、`e2e/**`、`tests/**` 里除了自己的声明处
 *   之外零引用 ⇒ 判定为零消费，必须登记进基线棘轮。
 *
 * 为什么按**符号**记账（而不是按文件）：与重复块 / 函数长度 / 文件行数同口径，
 * 棘轮只许降不许升。登记项会**反向核对** —— 某个符号后来被接上线（或删掉），
 * 基线里那条必须跟着删，否则清单里会躺着一批已失效的条目（§18.4 的同款要求）。
 *
 * 为什么扫 `src/lib/**` 而不是全 `src/**`：`src/components/**` 的 `export` 大量
 * 供 shadcn 式「同域消费」与 barrel 转发，判据在那里必然误报；而 `src/lib` 是
 * 唯一被 `server` / `components` / `app` 共同依赖的地基，「零消费」在那里才是真
 * 问题（§18.2）。
 *
 * 用法:
 *   node scripts/check-dead-exports.cjs           # 检查(棘轮)
 *   node scripts/check-dead-exports.cjs --strict  # 基线未收紧也失败(CI 用)
 *   node scripts/check-dead-exports.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-dead-exports.cjs --report  # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const BASELINE = path.join(__dirname, ".dead-exports-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围:只看 lib 层(见头注)。 */
const SCAN_ROOT = path.join(SRC, "lib");
/** 引用方范围:应用源码 + 门槛脚本 + e2e。 */
const USAGE_ROOTS = ["src", "scripts", "e2e", "tests"];
const SKIP_RE = /\.(test|spec)\.(ts|tsx)$|\.d\.ts$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === ".git")
      continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 取出一个模块的**值导出**符号名。
 *
 * 刻意不认 `type` / `interface`（见头注），也不认 `export *`（转发形态，
 * 真正是否被消费由被转发模块自己判）。
 */
function exportedValues(src) {
  const out = [];
  const re =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  // `export { a, b as c }` 具名清单：只要别名（外部能引到的那个名字）
  const listRe = /^export\s*\{([^}]*)\}/gm;
  while ((m = listRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const alias = seg
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(alias)) out.push(alias);
    }
  }
  // 重导出 `export { x } from "./y"` 属转发，其消费方在被转发模块侧判定
  return out;
}

/** 全部引用方源码（拼接成一份文本，按词边界计数）。 */
function usageCorpus() {
  const files = [];
  for (const r of USAGE_ROOTS) walk(path.join(ROOT, r), files);
  return files.map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
}

function collect() {
  const corpus = usageCorpus();
  const dead = [];
  const checkedFiles = [];
  for (const file of walk(SCAN_ROOT)) {
    const rel = toPosix(path.relative(ROOT, file));
    if (SKIP_RE.test(rel)) continue;
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const names = exportedValues(src);
    if (!names.length) continue;
    checkedFiles.push(rel);
    for (const name of names) {
      const mentions = corpus.split(new RegExp(`\\b${name}\\b`)).length - 1;
      // 声明处自己也贡献 1 次计数；零消费 = 除声明外无人提及。
      if (mentions <= 1) dead.push(`${rel}#${name}`);
    }
  }
  return { dead: [...new Set(dead)].sort(), checkedFiles: checkedFiles.length };
}

function main() {
  const { dead, checkedFiles } = collect();

  if (REPORT_ONLY) {
    console.log(
      `扫描 ${checkedFiles} 个 src/lib 模块:零消费导出 ${dead.length} 个`,
    );
    for (const d of dead) console.log(`  · ${d}`);
    return;
  }

  let baseline = [];
  if (fs.existsSync(BASELINE)) {
    baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).symbols || [];
  }
  const known = new Set(baseline);
  const added = dead.filter((d) => !known.has(d));
  const removed = baseline.filter((d) => !dead.includes(d));

  if (UPDATE) {
    fs.writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          note: "src/lib 零消费值导出棘轮(规范 12.16);只许降不许升。--update 收紧。",
          symbols: dead,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`✓ 已写入基线:${dead.length} 个零消费导出`);
    if (removed.length) console.log(`  比上次减少 ${removed.length} 个`);
    return;
  }

  let failed = false;
  if (added.length) {
    console.error(
      `✗ 新增 ${added.length} 个零消费导出(src/lib 的值导出必须在生产路径被引用):`,
    );
    for (const d of added) console.error(`    ${d}`);
    console.error(
      "\n修法:① 真的要用 → 接线到消费方;② 暂时保留 → 加 changelog 说明并 --update" +
        "\n     (基线只许变短,登记等于承认留着一份没有消费方的抽象);③ 否则删掉。",
    );
    failed = true;
  }
  if (STRICT && removed.length) {
    console.error(
      `✗ 基线里 ${removed.length} 个符号已被消费/删除,请收紧基线:node scripts/check-dead-exports.cjs --update`,
    );
    failed = true;
  } else if (removed.length) {
    console.log(
      `提示:${removed.length} 个零消费导出已消失,可执行 node scripts/check-dead-exports.cjs --update 收紧基线`,
    );
  }

  if (!failed) {
    console.log(
      `✓ 无新增零消费导出(§12.16;基线 ${baseline.length} 个,当前 ${dead.length} 个,扫描 ${checkedFiles} 个模块)`,
    );
  }
  process.exit(failed ? 1 : 0);
}

main();
