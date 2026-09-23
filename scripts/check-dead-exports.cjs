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
 *   只扫「地基层」（`src/lib/**` + `src/trpc/**`，见下），且只认**值导出**
 *   （函数 / 常量 / 类 / 枚举）——
 *   `type` / `interface` 一律不看：它们大多是「同文件内使用的 props 类型」，
 *   正是那份 566 个清单里 90% 的来源，纳入只会把判据变成噪音。
 *   值导出在 `src/**`、`scripts/**`、`e2e/**` 里除了自己的声明处之外零引用，
 *   且不被同域单测锁住 ⇒ 判定为零消费，必须登记进基线棘轮。
 *
 * 为什么按**符号**记账（而不是按文件）：与重复块 / 函数长度 / 文件行数同口径，
 * 棘轮只许降不许升。登记项会**反向核对** —— 某个符号后来被接上线（或删掉），
 * 基线里那条必须跟着删，否则清单里会躺着一批已失效的条目（§18.4 的同款要求）。
 *
 * 为什么只扫「地基层」而不是全 `src/**`：`src/components/**` 的 `export` 大量
 * 供 shadcn 式「同域消费」与 barrel 转发，判据在那里必然误报；`src/lib` 与
 * `src/trpc` 才是被 `server` / `components` / `app` 共同依赖的地基，「零消费」
 * 在那里才是真问题（§18.2）。`src/trpc` 是 ISSUE #565 补进来的：`server.ts`
 * （RSC 的 api + HydrateClient 整条链路）全库零引用却长期活着，正因为原判据
 * 只扫 `src/lib` —— 客户端入口那个目录里躺着一条死链路，没有任何机器判据管它。
 *
 * ## 为什么「引用方集合」必须在本文件里显式列出（ISSUE #565 复议）
 *
 * 判据此前只拿**数量**说话：「symbol 在引用方范围里出现 <= 1 次」。可引用方
 * 范围只覆盖 `src` / `scripts` / `e2e` / `tests` —— **同一个模块自己的
 * `.test.ts` 不在里面**。于是「同文件单测锁住这个纯函数」的符号会被永久判成
 * 零消费（34 条基线的前身就是这么攒出来的），而写成注释「测试算是消费方」是
 * 一句**注释与判据相反**的承诺 —— 下一个人照注释写，只会再多一条不会生效的
 * 口径（§12.17 的同款教训）。
 *
 * 现在把「谁算消费方」显式写成两张表，两张表都是判据本身：
 *
 *   - `USAGE_ROOTS` —— 生产消费方（`src` / `scripts` / `e2e`），零引用即死；
 *   - `TEST_CONSUMER_EXT` —— **同域单测**（与声明处同目录的 `.test.ts`）也算
 *     消费方。纯函数被同域单测逐条锁住时，它的**可观察行为的确在跑**，
 *     称其「零消费」是错的；同时这条**不可能误伤真死代码** —— 真死代码
 *     不会有人为它写同域单测。
 *
 * 「测试算不算消费方」在 §12.16 已裁决：**算**（这是全仓唯一的口径）。
 *
 * ## 性能：判据一次成型，别再 O(符号数 × 全仓) 扫（本次优化）
 *
 * 旧实现每判一个导出，就把「全仓拼接语料」按 `\b名\b` 正则 split 一遍计数，且每
 * 个模块都重新 walk + 读一遍 `tests/` 找它的单测 —— 一次 `--report` 实测 57s（并行
 * 门禁里争抢 CPU 时飙到 114s）。判据不变的前提下换成**先建索引、再查表**：
 *   - `PROD_FREQ`：生产语料按词元**切一遍**建词频表，`mentions(名)` 退化成 O(1) 查表
 *     （对 `\w` 构成的标识符，与旧 `\b名\b` 计数逐字等价；含 `$` 的名字旧正则会因未转义
 *     的 `$` 锚点而基本不命中，词元表同样把它切成非完整词 → 行为一致）；
 *   - `TEST_FILES`：所有测试文件**预加载一次**（各自的词元 Set + 归一后的 import 说明符），
 *     模块↔单测的匹配只在内存里比对，不再每模块重读磁盘。
 * 「同基名测试即使没 import 也算消费方」这一旧语义与 `importsModule` 的模糊后缀匹配，
 * 均在 `matchedTestFilesOf` / `specsImport` 里原样保留；`tests/check-dead-exports.test.ts`
 * 的 18 例（含非空死集的夹具 + 真实仓库 `--strict`/`--verify`）即等价性证明。
 *
 * 用法:
 *   node scripts/check-dead-exports.cjs           # 检查(棘轮)
 *   node scripts/check-dead-exports.cjs --strict  # 基线未收紧也失败(CI 用)
 *   node scripts/check-dead-exports.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-dead-exports.cjs --report  # 只出清单不判失败(盘点用)
 * 用法示例：node scripts/check-dead-exports.cjs --verify <文件>#<符号>
 *                                                 # 单条精确复核(清单归零后仍能自证)
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
/** `--verify <rel>#<Symbol>`:单条精确复核。清单归零后「为空」不再能证明
 *  扫描器在工作(一个永远返回空的扫描器会让断言全绿,§12.16),所以留一条
 *  可对**指定符号**当场复核的通道 —— 注入式反向验证用它。 */
const verifyArg =
  process.argv.slice(2).find((a) => !a.startsWith("--") && a.includes("#")) ??
  "";

/** 扫描范围:地基层(见头注)——lib 纯工具层 + trpc 客户端入口层。 */
const SCAN_ROOTS = [path.join(SRC, "lib"), path.join(SRC, "trpc")];
/** 生产引用方范围:应用源码 + 门槛脚本 + e2e。**不含 tests** —— 测试另按
 *  「同域单测」判定(见 `TEST_CONSUMER_EXT` 与头注)。 */
const USAGE_ROOTS = ["src", "scripts", "e2e"];
/** 同域单测的后缀:与声明处同目录、同基名的测试文件。它们算消费方。 */
const TEST_CONSUMER_EXT = [".test.ts", ".test.tsx"];
const SKIP_RE = /\.(test|spec)\.(ts|tsx)$|\.d\.ts$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

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

/** 模块标识串：把所有可能的 import 写法归一成同一把钥匙。 */
function moduleKeys(absPathNoExt) {
  const rel = toPosix(path.relative(ROOT, absPathNoExt));
  const keys = new Set([rel, `./${path.posix.basename(rel)}`]);
  // `~/lib/x/y` 与 `@/lib/x/y` 两种别名都归一到 `src/lib/x/y`
  for (const alias of ["~/", "@/", "src/"]) {
    if (rel.startsWith("src/")) keys.add(alias + rel.slice(4));
  }
  return keys;
}

/** 从源码抽出**归一后的 import 说明符**（与旧 `importsModule` 同一过滤 + 归一）。 */
function importSpecs(src) {
  const out = [];
  const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (
      !spec ||
      (!spec.startsWith(".") &&
        !spec.startsWith("~") &&
        !spec.startsWith("@") &&
        !spec.startsWith("src/"))
    ) {
      continue;
    }
    out.push(spec.replace(/\.tsx?$/, "").replace(/^src\//, ""));
  }
  return out;
}

/** 归一说明符集合是否命中某模块的钥匙（复刻旧 `importsModule` 的三分支模糊匹配）。 */
function specsImport(specs, wantedKeys) {
  for (const norm of specs) {
    for (const key of wantedKeys) {
      if (norm === key || key.endsWith(norm) || norm.endsWith(key)) return true;
    }
  }
  return false;
}

// ── 预加载索引（判据不变，只是把「每判一次就重扫全仓」摊成一次成型）──────────

/** 生产语料的词元 → 出现次数（切一遍 src/scripts/e2e），替代逐符号 regex-split 全仓。 */
const PROD_FREQ = (() => {
  const freq = new Map();
  const files = [];
  for (const r of USAGE_ROOTS) walk(path.join(ROOT, r), files);
  for (const f of files) {
    const toks = stripComments(fs.readFileSync(f, "utf8")).match(/\w+/g);
    if (!toks) continue;
    for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
})();

/** 所有测试文件预加载一次：`{ rel, tokens:Set(词元), specs:归一 import 说明符 }`。
 *  覆盖 tests/ 与地基层内的测试文件（去重）——与旧 `testConsumersOf` 的取集合一致。 */
const TEST_FILES = (() => {
  const seen = new Set();
  const list = [];
  const push = (file) => {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    list.push({
      rel: toPosix(path.relative(ROOT, abs)),
      tokens: new Set(src.match(/\w+/g) || []),
      specs: importSpecs(src),
    });
  };
  for (const f of walk(path.join(ROOT, "tests")))
    if (TEST_FILE_RE.test(f)) push(f);
  for (const root of SCAN_ROOTS)
    for (const f of walk(root)) if (TEST_FILE_RE.test(f)) push(f);
  return list;
})();

/** 该模块的「消费测试文件」：① 同基名直连测试（存在即算，旧语义）∪ ② import 了它的测试。
 *  返回其词元并集所在的文件列表；调用方按符号名查词元是否命中。 */
function matchedTestFilesOf(relPath) {
  const base = relPath.replace(/\.tsx?$/, "");
  const wanted = moduleKeys(path.join(ROOT, base));
  const directRel = new Set();
  for (const ext of TEST_CONSUMER_EXT) {
    directRel.add(
      toPosix(path.relative(ROOT, path.join(ROOT, `${base}${ext}`))),
    );
    directRel.add(
      toPosix(
        path.relative(
          ROOT,
          path.join(ROOT, "tests", `${path.basename(base)}${ext}`),
        ),
      ),
    );
  }
  const hits = [];
  for (const tf of TEST_FILES) {
    if (directRel.has(tf.rel) || specsImport(tf.specs, wanted)) hits.push(tf);
  }
  return hits;
}

/** 某符号在生产侧出现几次（词表 O(1)，与旧 `\b名\b` 计数等价）。 */
function prodMentions(name) {
  return PROD_FREQ.get(name) || 0;
}

/** 判定一个符号是否零消费，返回判定依据（供 `--verify` 打印）。 */
function classify(relPath, name) {
  const prod = prodMentions(name);
  // 声明处自己也贡献 1 次计数；生产侧除声明外无人提及才继续看测试。
  if (prod > 1) return { dead: false, why: `生产消费方引用 ${prod - 1} 处` };
  const hits = matchedTestFilesOf(relPath);
  const testMentions = hits.reduce(
    (n, tf) => n + (tf.tokens.has(name) ? 1 : 0),
    0,
  );
  if (testMentions > 0) {
    return { dead: false, why: `同域单测引用 ${testMentions} 处` };
  }
  return { dead: true, why: "生产与同域单测均零引用" };
}

function collect() {
  const dead = [];
  const checkedFiles = [];
  const files = SCAN_ROOTS.flatMap((root) => walk(root));
  for (const file of files) {
    const rel = toPosix(path.relative(ROOT, file));
    if (SKIP_RE.test(rel)) continue;
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const names = exportedValues(src);
    if (!names.length) continue;
    checkedFiles.push(rel);
    // 消费测试文件集合按模块算一次（旧实现是拼测试语料，此处取词元命中等价）。
    let testHits = null;
    for (const name of names) {
      if (prodMentions(name) > 1) continue;
      testHits ??= matchedTestFilesOf(rel);
      if (testHits.some((tf) => tf.tokens.has(name))) continue;
      dead.push(`${rel}#${name}`);
    }
  }
  return { dead: [...new Set(dead)].sort(), checkedFiles: checkedFiles.length };
}

function main() {
  if (verifyArg) {
    const [relPath, name] = verifyArg.split("#");
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) {
      console.log(`✗ ${relPath} 不存在`);
      process.exit(1);
    }
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    if (!exportedValues(src).includes(name)) {
      console.log(`✗ ${relPath} 没有值导出 ${name}`);
      process.exit(1);
    }
    const verdict = classify(relPath, name);
    console.log(
      `${verdict.dead ? "零消费" : "有消费"}  ${relPath}#${name}  (${verdict.why})`,
    );
    process.exit(0);
  }

  const { dead, checkedFiles } = collect();

  if (REPORT_ONLY) {
    console.log(
      `扫描 ${checkedFiles} 个地基模块(src/lib + src/trpc):零消费导出 ${dead.length} 个`,
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
          note: "地基层(src/lib + src/trpc)零消费值导出棘轮(规范 12.16);只许降不许升。--update 收紧。",
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
      `✗ 新增 ${added.length} 个零消费导出(地基层 src/lib + src/trpc 的值导出必须在生产路径被引用):`,
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
