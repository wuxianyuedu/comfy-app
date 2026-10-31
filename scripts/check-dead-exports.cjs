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
 *   且不被同域单测锁住 ⇒ 判定为零消费，**硬闸：命中即阻断**。
 *
 * ## 为什么是硬闸而不是棘轮
 *
 * 本判据此前是**棘轮**：存量按符号记进 `scripts/.dead-exports-baseline.json`，
 * `--update` 收紧、`--strict` 要求下降。但基线已于 §12.16 那轮复核后归零
 * （`symbols: []`，34 → 0：接线 3 / 删除 31，逐条口径见 §12.15），而棘轮在
 * 归零后只剩开销：`--update` 无事可做，基线文件却仍是一条「手改就能把新写的
 * 零消费导出登记成已知存量」的通道 —— 那正是硬闸类**本来没有**的中间态。
 *
 * 判据口径与扫描面一字未改，只把「有存量、逐批治理」那一层皮收掉：
 * **新写的零消费导出没有退出通道** —— 要么接上真实消费方，要么不要写。
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
 * 的 18 例（含非空死集的夹具 + 真实仓库的 `--verify`）即等价性证明。
 *
 * 用法:
 *   node scripts/check-dead-exports.cjs           # 检查(硬闸:命中即退 1)
 *   node scripts/check-dead-exports.cjs --report  # 只出清单不判失败(盘点用)
 * 用法示例：node scripts/check-dead-exports.cjs --verify <文件>#<符号>
 *                                                 # 单条精确复核(清单归零后仍能自证)
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  readForScan,
  skipUnlessStagedTouches,
  walkForScan,
  vanishedNote,
} = require("./gate-scan-read.cjs");
const { gateFail, gatePass, indentItems } = require("./ci-log.mjs");

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");
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
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

/**
 * 语料的文件形状：必须含 `.mjs` / `.cjs` —— `USAGE_ROOTS` 里 `scripts` 全是这两种后缀，而
 * 纯 Node 宿主经 `await import()` 消费地基层导出（实例：`scripts/executor-host.mjs`
 * 取 `src/lib/comfyui/host-runtime.ts` 的 `createHostRepo`）。只数 `.ts/.tsx` 会把
 * 「有消费方」判成零消费——与本文件头那句「值导出在 src/scripts/e2e 里零引用」
 * 相反（§12.17：注释与判据相反，下一个人照注释写只会多一条不生效的口径）。
 */
const CORPUS_FILE_RE = /\.(ts|tsx|mjs|cjs)$/;
/** 本判据额外不进去的目录（`gate-scan-read.cjs` 默认只跳 `node_modules`）。 */
const WALK_SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

/**
 * 枚举一棵语料树。**旧实现是「`readdirSync` 列名字 → 逐个 `fs.statSync`」**，那是这个
 * 竞态的**第三种窗口**：条目在两次 syscall 之间被删时 `statSync` 抛 `ENOENT`，而那行
 * 写在 `try` 之外 —— 共享枚举改走 `withFileTypes`，同一次 `readdir` 就带回类型，不多一次
 * 会失败的 syscall（口径与两种窗口都在 `gate-scan-read.cjs`）。
 */
function walk(dir, out = []) {
  out.push(...walkForScan(dir, CORPUS_FILE_RE, { skipDirs: WALK_SKIP_DIRS }));
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
  while ((m = re.exec(src))) {
    out.push(m[1]);
  }
  // `export { a, b as c }` 具名清单：只要别名（外部能引到的那个名字）
  const listRe = /^export\s*\{([^}]*)\}/gm;
  while ((m = listRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) {
        continue;
      }
      const alias = seg
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(alias)) {
        out.push(alias);
      }
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
    if (rel.startsWith("src/")) {
      keys.add(alias + rel.slice(4));
    }
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
      if (norm === key || key.endsWith(norm) || norm.endsWith(key)) {
        return true;
      }
    }
  }
  return false;
}

/* `--staged`（钩子用）＝ 输入面跳过（§13.5.8.2）。**必须放在两个预加载索引
 * （`PROD_FREQ` / `TEST_FILES`）之前** —— 那两个 IIFE 会把 `src` + `scripts` + `e2e`
 * 整个语料读一遍（实测 ≈340ms），放在 `main()` 里就白跳过了。
 * 输入面是声明层（`SCAN_ROOTS`）与消费方语料（`USAGE_ROOTS`）的并集：两边任一边
 * 被碰都要真判，所以根清单由这两个既有配置现算，不另抄一份（§12.18）。
 * `--verify`（单符号精确复核）与 `--report` 都不跳过。 */
if (STAGED && !REPORT_ONLY && !verifyArg) {
  skipUnlessStagedTouches({ roots: [...USAGE_ROOTS], tag: "[dead-exports]" });
}

// ── 预加载索引（判据不变，只是把「每判一次就重扫全仓」摊成一次成型）──────────

/** 「列到名字、读时已没」的文件数 —— 这一轮没读过它们，结论行必须带这个数。 */
let vanishedFiles = 0;

/** 生产语料的词元 → 出现次数（切一遍 src/scripts/e2e），替代逐符号 regex-split 全仓。 */
const PROD_FREQ = (() => {
  const freq = new Map();
  const files = [];
  for (const r of USAGE_ROOTS) {
    walk(path.join(ROOT, r), files);
  }
  for (const f of files) {
    const raw = readForScan(f);
    if (raw === null) {
      vanishedFiles += 1;
      continue;
    }
    const toks = stripComments(raw).match(/\w+/g);
    if (!toks) {
      continue;
    }
    for (const t of toks) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
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
    if (seen.has(abs)) {
      return;
    }
    seen.add(abs);
    const raw = readForScan(abs);
    if (raw === null) {
      vanishedFiles += 1;
      return;
    }
    const src = stripComments(raw);
    list.push({
      rel: toPosix(path.relative(ROOT, abs)),
      tokens: new Set(src.match(/\w+/g) || []),
      specs: importSpecs(src),
    });
  };
  for (const f of walk(path.join(ROOT, "tests"))) {
    if (TEST_FILE_RE.test(f)) {
      push(f);
    }
  }
  for (const root of SCAN_ROOTS) {
    for (const f of walk(root)) {
      if (TEST_FILE_RE.test(f)) {
        push(f);
      }
    }
  }
  return list;
})();

/** 该模块的「消费测试文件」：① 同基名直连测试（存在即算，旧语义）∪ ② import 了它的测试。
 *  返回其词元并集所在的文件列表；调用方按符号名查词元是否命中。 */
function matchedTestFilesOf(relPath) {
  const base = relPath.replace(/\.tsx?$/, "");
  const wanted = moduleKeys(path.join(ROOT, base));
  const directRel = new Set();
  for (const ext of TEST_CONSUMER_EXT) {
    directRel.add(toPosix(path.relative(ROOT, path.join(ROOT, `${base}${ext}`))));
    directRel.add(
      toPosix(path.relative(ROOT, path.join(ROOT, "tests", `${path.basename(base)}${ext}`))),
    );
  }
  const hits = [];
  for (const tf of TEST_FILES) {
    if (directRel.has(tf.rel) || specsImport(tf.specs, wanted)) {
      hits.push(tf);
    }
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
  if (prod > 1) {
    return { dead: false, why: `生产消费方引用 ${prod - 1} 处` };
  }
  const hits = matchedTestFilesOf(relPath);
  const testMentions = hits.reduce((n, tf) => n + (tf.tokens.has(name) ? 1 : 0), 0);
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
    if (SKIP_RE.test(rel)) {
      continue;
    }
    const raw = readForScan(file);
    if (raw === null) {
      vanishedFiles += 1;
      continue;
    }
    const src = stripComments(raw);
    const names = exportedValues(src);
    if (!names.length) {
      continue;
    }
    checkedFiles.push(rel);
    // 消费测试文件集合按模块算一次（旧实现是拼测试语料，此处取词元命中等价）。
    let testHits = null;
    for (const name of names) {
      if (prodMentions(name) > 1) {
        continue;
      }
      testHits ??= matchedTestFilesOf(rel);
      if (testHits.some((tf) => tf.tokens.has(name))) {
        continue;
      }
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
    console.log(`${verdict.dead ? "零消费" : "有消费"}  ${relPath}#${name}  (${verdict.why})`);
    process.exit(0);
  }

  const { dead, checkedFiles } = collect();
  const note = vanishedNote(vanishedFiles);

  if (REPORT_ONLY) {
    gatePass(
      "零消费导出",
      `扫描 ${checkedFiles} 个模块：零消费导出 ${dead.length} 个（只出清单）` + note,
      {
        subject: "地基层",
      },
    );
    for (const line of indentItems(dead)) {
      console.log(line);
    }
    return;
  }

  /* 「消失数」必须进结论：少读一份就会把 `dead` 报小 —— 看着像「干净」，实际是这一轮
     没读。（口径在 `gate-scan-read.cjs`：只降级 ENOENT、不许静默。） */
  if (dead.length) {
    gateFail("零消费导出", dead, {
      subject: "地基层",
      detail: `${dead.length} 个零消费导出`,
      hint:
        "修法：① 真的要用 → 接线到消费方；② 确认是死代码 → 删掉（§12.15 第二条：留着的理由\n" +
        "必须写得出「谁在什么时候用它」，「以后可能会用」不是理由）。\n" +
        "本判据是硬闸（无基线、无 --update）：零消费导出的存量已清零，新增即阻断。" +
        note,
    });
    process.exit(1);
  }

  gatePass("零消费导出", `扫描 ${checkedFiles} 个模块：命中 0 条` + note, {
    subject: "地基层",
  });
}

main();
