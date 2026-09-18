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
 *   值导出在 `src/**`、`scripts/**`、`e2e/**`、`tests/**` 里除了自己的声明处
 *   之外零引用 ⇒ 判定为零消费，必须登记进基线棘轮。
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
const verifyArg = process.argv.slice(2).find((a) => !a.startsWith("--") && a.includes("#")) ?? "";

/** 扫描范围:地基层(见头注)——lib 纯工具层 + trpc 客户端入口层。 */
const SCAN_ROOTS = [path.join(SRC, "lib"), path.join(SRC, "trpc")];
/** 生产引用方范围:应用源码 + 门槛脚本 + e2e。**不含 tests** —— 测试另按
 *  「同域单测」判定(见 `TEST_CONSUMER_EXT` 与头注)。 */
const USAGE_ROOTS = ["src", "scripts", "e2e"];
/** 同域单测的后缀:与声明处同目录、同基名的测试文件。它们算消费方。 */
const TEST_CONSUMER_EXT = [".test.ts", ".test.tsx"];
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

/** 全部**生产**引用方源码（拼接成一份文本，按词边界计数）。 */
function usageCorpus() {
  const files = [];
  for (const r of USAGE_ROOTS) walk(path.join(ROOT, r), files);
  return files.map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
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

/** 该模块**被它的**单测覆盖时，返回测试源码（不含则空串）。
 *
 *  判定只看一件事：**有没有测试文件 import 了这个模块** —— 与测试文件叫什么
 *  名字、放在哪个目录无关。三种既成布局都能命中（实测三种都在用，只认一种
 *  就会让另外两类模块被误判为零消费）：
 *
 *    ① 同目录同基名  `src/lib/x/y.ts`  ⇄ `src/lib/x/y.test.ts`
 *    ② 集中目录同基名 `src/lib/x/y.ts`  ⇄ `tests/y.test.ts`
 *    ③ 集中目录异名   `src/lib/workshop/generation-log.ts`
 *                       与 tests/workshop-generation-log.test.ts 配对
 *
 *  为什么按「import 了它」而不是按「全 tests/ 一起算」：后者等于把整个测试
 *  目录都当消费方 —— 任何被任何测试**提到过名字**的符号都不再是零消费，
 *  判据会退化成「有没有人写过这个名字」。按 import 关系判定则是精确的：
 *  `parseGenerationLogLine`（被 `tests/workshop-generation-log.test.ts` 逐条
 *  锁住）正确认作消费方，而 `shouldReportReady` 这类**没有任何测试文件
 *  import 它所在模块**的符号仍留在清单上。
 *
 *  也仍然**不可能**误伤真死代码：真死代码不会有人为它写测试。 */
function testConsumersOf(relPath) {
  const base = relPath.replace(/\.tsx?$/, "");
  const wanted = moduleKeys(path.join(ROOT, base));
  // ① 同目录同基名 / ② 集中目录同基名：直接命中，无需扫
  const direct = [];
  for (const ext of TEST_CONSUMER_EXT) {
    direct.push(path.join(ROOT, `${base}${ext}`));
    direct.push(path.join(ROOT, "tests", `${path.basename(base)}${ext}`));
  }
  const hits = direct.filter((full) => fs.existsSync(full));
  // ③ 其余：扫全部测试文件，看谁 import 了本模块
  for (const file of walk(path.join(ROOT, "tests"))) {
    if (!/\.(test|spec)\.(ts|tsx)$/.test(file)) continue;
    if (hits.includes(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (importsModule(src, wanted)) hits.push(file);
  }
  // `src/lib/**` 内的测试文件（同目录但不同基名）也一并算
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      if (!/\.(test|spec)\.(ts|tsx)$/.test(file)) continue;
      if (hits.includes(file) || file === path.join(ROOT, relPath)) continue;
      const src = fs.readFileSync(file, "utf8");
      if (importsModule(src, wanted)) hits.push(file);
    }
  }
  return hits
    .map((full) => stripComments(fs.readFileSync(full, "utf8")))
    .join("\n");
}

/** 源码里是否 import 了目标模块（只看 import / from 说明符，不认注释）。 */
function importsModule(src, wantedKeys) {
  const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec || !spec.startsWith(".") && !spec.startsWith("~") && !spec.startsWith("@") && !spec.startsWith("src/")) {
      continue;
    }
    const norm = spec.replace(/\.tsx?$/, "").replace(/^src\//, "");
    for (const key of wantedKeys) {
      if (norm === key || key.endsWith(norm) || norm.endsWith(key)) return true;
    }
  }
  return false;
}

/** 某符号在该文本里出现了几次（词边界计数）。 */
function mentions(text, name) {
  return text.split(new RegExp(`\\b${name}\\b`)).length - 1;
}

/** 判定一个符号是否零消费，返回判定依据（供 `--verify` 打印）。 */
function classify(relPath, name) {
  const prod = usageCorpus();
  const prodMentions = mentions(prod, name);
  // 声明处自己也贡献 1 次计数；生产侧除声明外无人提及才继续看测试。
  if (prodMentions > 1) return { dead: false, why: `生产消费方引用 ${prodMentions - 1} 处` };
  const test = testConsumersOf(relPath);
  const testMentions = test ? mentions(test, name) : 0;
  if (testMentions > 0) {
    return { dead: false, why: `同域单测引用 ${testMentions} 处` };
  }
  return { dead: true, why: "生产与同域单测均零引用" };
}

function collect() {
  const dead = [];
  const checkedFiles = [];
  const files = SCAN_ROOTS.flatMap((root) => walk(root));
  const prodCorpus = usageCorpus();
  for (const file of files) {
    const rel = toPosix(path.relative(ROOT, file));
    if (SKIP_RE.test(rel)) continue;
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const names = exportedValues(src);
    if (!names.length) continue;
    checkedFiles.push(rel);
    const testCorpus = testConsumersOf(rel);
    for (const name of names) {
      if (mentions(prodCorpus, name) > 1) continue;
      if (testCorpus && mentions(testCorpus, name) > 0) continue;
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
