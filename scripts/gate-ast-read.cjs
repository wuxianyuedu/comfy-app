#!/usr/bin/env node
// @ts-nocheck -- 门禁扫描面的共用「读取 + 解析」（被 scripts/check-*.cjs 调用，自己不判成败）
/**
 * **共享解析层**：把「枚举扫描面 → 读文本 → `ts.createSourceFile`」这三步收成一份
 * 实现，判据只领解析结果、只写自己的 `visit`。
 *
 * ── 为什么该有这一层（口径见 §13.5.8.2「第四笔账」）────────────────────
 *
 * 有 6 份判据判的是**同一批文件**（`src/**` 的 `.ts`/`.tsx`，实测 1082 份 / 7.3MB），
 * 而每份都各自 `walk` + `readFileSync` + `ts.createSourceFile` 全量走一遍。
 * 实测（8 核，热缓存）三段成本：
 *
 *   · `walk` + `readFileSync` 全量：≈35ms（一遍）；
 *   · `ts.createSourceFile` 全量：**≈500ms（一遍）** ← 大头；
 *   · 各判据自己的 AST 遍历：≈52ms（一遍，62 万节点）—— **不在本层共享**。
 *
 * ── 共享的颗粒度：**只共享解析产物，不共享遍历、更不共享判定** ──────────
 *
 *   · **共享**：`SourceFile`。它是 `createSourceFile(fileName, text, target, …)` 的
 *     纯函数产物 —— 同一份文本 + 同一个 `ScriptTarget`/`ScriptKind` ⇒ 逐位相同，
 *     共享它**不引入跨判据的状态耦合**。
 *   · **不共享**：`visit`。它是每条判据自己的规则语义（`isNonNullExpression` /
 *     `isStateSetter` / `onClick` 接线…）。把它一起共享，就等于六条规则混进一个
 *     遍历器 —— 改一条规则的豁免要重新理解另外五条。这是 §13.5.8.2 里那句
 *     「缓存的是纯函数，不是『某条规则的计数』」的同一条边界。
 *   · 实测支撑：一次全遍历只 52ms，六次合计 318ms —— **它根本不是成本**，
 *     没有任何理由去动它。
 *
 * ── 单进程聚合，不是磁盘缓存 ──────────────────────────────────────────
 *
 * `SourceFile` 是不可序列化的大对象（1082 份 / 62 万节点），落盘 + 反序列化比
 * 重新解析更贵。所以省下的那一段只能靠「**同一个进程里解析一次、给多条规则各领
 * 一遍**」—— 见 `parseSources()` 的 `perSource` 回调面。
 *
 * ── 两条不许松的口径 ──────────────────────────────────────────────────
 *
 * 1. **本层只回答「解析好了没有」，不回答「算不算违规」**。判定与退出码仍归各自
 *    脚本 —— 共享层一旦开始判成败，六条判据的「逐条可分辨」就没了（§13.5.8.2 那
 *    张表要求每条判据各自可点名、各自可 `--report` / `--update`）。
 * 2. **`--staged` 短路点仍必须在 `require("typescript")` 之前**。解析被共享了
 *    ≠ 可以先解析再跳过：那样跳过档会从 35ms 打回 500ms+（§13.5.8.2 第一个坑）。
 *    本层**不替调用方做短路**，`require("./gate-ast-read.cjs")` 自己也不得在模块
 *    顶层 `require("typescript")`（惰性的 `tsOrNull()` 就是为这条存在的）。
 *
 * ── 与 `gate-scan-read.cjs` 的分工 ────────────────────────────────────
 *
 * `gate-scan-read.cjs` 管**读取**（条目消失竞态、暂存清单、`--staged` 短路器）；
 * 本层管**解析**，它的枚举与读取**转发给 `gate-scan-read.cjs`**，不另写一份
 * `readdirSync` / `readFileSync` —— 抄一份就会与那层的降级口径漂开，而漂开的
 * 形态是静默的（§12.12 孪生对、§12.18「写之前先查」）。
 */
const path = require("node:path");
const { readForScan, vanishedNote, walkForScan } = require("./gate-scan-read.cjs");

/** 默认只收 `.ts` / `.tsx`；要别的后缀由调用方传 `fileRe`。 */
const TS_FILE_RE = /\.tsx?$/;

/** 默认不收的文件：测试与声明文件（多数判据的口径，例外由调用方关掉）。 */
const DEFAULT_SKIP_FILE_RE = /\.test\.[cm]?[jt]sx?$/;

/**
 * `require("typescript")` 的**惰性**入口。
 *
 * 单独拎出来是为了守住「短路在重活之前」：模块顶层 `require("typescript")` 会让
 * **任何**引入本层的脚本在启动时先付 ≈130ms —— 包括那个本该 35ms 就退出的跳过档。
 * 调用方在真正要解析时才调它，于是「跳过」这条路径一次模块加载都不发生。
 *
 * `node_modules` 缺席（从未 `pnpm install`）时返回 `null`，由调用方决定降级还是
 * 报错：`tsc` 那一步同样需要它，不该在这里二次阻塞（§13.6.3 的另一面）。
 *
 * @returns {typeof import("typescript") | null}
 */
function tsOrNull() {
  try {
    return require("typescript");
  } catch {
    return null;
  }
}

/**
 * 枚举扫描面上的一份 `SourceFile`（含相对路径与正文长度）。
 * @typedef {{ rel: string, abs: string, text: string, sourceFile: import("typescript").SourceFile }} ParsedSource
 */

/**
 * 「枚举 + 读 + 解析」一次，对每份源文件调一次 `perSource`。
 *
 * **这是本层的全部**：它不收集任何站点、不判任何违规、不 `process.exit`。
 * 调用方在 `perSource` 里写自己的规则，返回什么由调用方自己聚合
 * （本层不碰返回值，也不缓存它 —— 缓存「判定结果」正是 §13.5.8.2 拒绝的那件事）。
 *
 * @param {object} options
 * @param {string[]} options.roots 扫描根清单（相对 `root` 的 POSIX 路径）
 * @param {string} [options.root] 仓库根，默认 `process.cwd()`
 * @param {RegExp} [options.fileRe] 文件名过滤器，默认 `/\.tsx?$/`
 * @param {RegExp | null} [options.skipFileRe] 要跳过的文件名形态，默认跳 `.test.*`；
 *   传 `null` = 一个都不跳（多数判据的 `--with-tests` 档）
 * @param {boolean} [options.trimRel] 相对路径以扫描根为基准（默认以 `root` 为基准）
 * @param {(src: ParsedSource) => void} options.perSource 每份源文件调一次
 * @param {{ ts?: typeof import("typescript"), onMissingTs?: () => void }} [options.deps]
 *   测试注入面（默认惰性 `require("typescript")`）
 * @returns {{ files: number, missing: number }} `missing` = 扫描期间消失、本轮未读的条目数
 */
function parseSources({
  roots,
  root = process.cwd(),
  fileRe = TS_FILE_RE,
  skipFileRe = DEFAULT_SKIP_FILE_RE,
  trimRel = false,
  perSource,
  deps = {},
}) {
  const ts = deps.ts ?? tsOrNull();
  if (!ts) {
    if (deps.onMissingTs) {
      deps.onMissingTs();
    }
    return { files: 0, missing: 0 };
  }

  let files = 0;
  let missing = 0;
  for (const dir of roots) {
    const base = path.join(root, dir);
    for (const abs of walkForScan(base, fileRe)) {
      const name = path.basename(abs);
      if (skipFileRe?.test(name)) {
        continue;
      }
      if (name.endsWith(".d.ts")) {
        continue;
      }
      const text = readForScan(abs);
      /* 条目级消失（列到名字、读时已没）：不是「文件里没有站点」，是这一轮没读到，
       * 必须计数 —— 静默跳过等于让判据在它其实没读过的文件上假装绿。 */
      if (text === null) {
        missing += 1;
        continue;
      }
      const rel = (trimRel ? path.relative(base, abs) : path.relative(root, abs))
        .split(path.sep)
        .join("/");
      const display = trimRel ? `${dir}/${rel}` : rel;
      const sourceFile = ts.createSourceFile(
        display,
        text,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      files += 1;
      perSource({ rel: display, abs, text, sourceFile });
    }
  }
  return { files, missing };
}

/**
 * 一份文件的 AST 全遍历（前序、`forEachChild` 序）。
 *
 * 收在这里**不是**为了让六条规则共用一次遍历（那个实测只值 52ms/遍，见文件头），
 * 而是为了让「怎么走树」这一件小事只有一份实现 —— 各写一遍的形态是有人写
 * `forEachChild`、有人手写 `for (const c of node.getChildren())`，后者在 TSX 上
 * 会把 token 也走一遍。规则本身仍在各自的 `visit` 回调里。
 *
 * @param {import("typescript").Node} node 起点（通常传 `SourceFile`）
 * @param {(node: import("typescript").Node) => void} visit
 */
function visitEach(node, visit) {
  visit(node);
  node.forEachChild((child) => {
    visitEach(child, visit);
  });
}

module.exports = {
  TS_FILE_RE,
  parseSources,
  tsOrNull,
  visitEach,
  vanishedNote,
};
