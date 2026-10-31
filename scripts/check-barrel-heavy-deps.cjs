#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:barrel 不得把重依赖拖进入口静态图(供 .githooks/pre-commit 调用)
/**
 * 入口包的**重依赖静态可达性**门禁 —— 规范见
 * docs/standards/12-代码组织与文件结构.md §12.19 与 02-性能规范.md §2.9。
 *
 * ## 立案现场
 *
 * `src/components/studio/index.ts` 是工作室组件库的 barrel，30 条转出口。
 * `src/app/workspace/page.tsx`（应用入口）**静态** import 了它取三件便宜东西
 * （`HomePage` / `AppShell` / `VideoQueueModal` / `AuroraBackground`）。而 barrel
 * 里同时转出 `./ProjectCanvas`（`@xyflow/react` 画布）与 `./FilmStudio`。
 *
 * 入口随后对同一批模块又写了一遍 `dynamic(() => import("…"))` —— 那一层懒加载
 * **是有效的**，但它拦不住另一条路：入口 → barrel → `ProjectCanvas.tsx` 是**静态**
 * 边，`@xyflow/react` 因此落在入口的静态可达图里。实测（2026-10-11，本仓）：
 * 从 `src/app/workspace/page.tsx` 沿**静态** `from "…"` 边可达 699 个模块，其中
 * `ProjectCanvas.tsx` / `FilmStudio.tsx` 在列，链是
 * `workspace/page.tsx -> components/studio/index.ts -> ProjectCanvas.tsx`。
 *
 * ## 为什么这条必须机器判
 *
 * ① **症状是静默的**：没有任何报错、没有任何既有判据变红，只是首屏多下载几百 KB
 *    （画布引擎 + 它的样式），以及 `pnpm analyze` 之前没人看得出来。
 * ② **最容易「修一半」**：把 `dynamic()` 写在入口处、barrel 不动 —— 看上去就是
 *    「已经懒加载了」，而真正的静态边还在（本条立案时仓库正是这个状态）。
 * ③ **回潮方式极其平常**：下一个人在 barrel 里转出一个新的重依赖模块、或者入口
 *    顺手从 barrel 多取一个名字，都会重新接上这条边，而两者单看都是正常写法。
 *
 * ## 判据（两格，都是「静态边」口径）
 *
 * **A. 入口在 barrel 的静态可达图里**
 *    对每条登记的 `entryPath`，沿**静态**模块边（`import … from`、
 *    `export … from`、裸 `import "x"`）做可达闭包；命中 `heavyDeps` 里任一依赖的
 *    模块即判红，并打印**整条链**（入口 → … → 命中模块），否则「红了但不知道谁拉的」。
 *    `import("…")` **不算边** —— 那正是懒加载要做的事，把它算进来会让判据永远红。
 *
 * **B. 静态可达的模块不得落在 `lazyMustBeDynamicFromEntry` 清单里**
 *    A 是「有没有真依赖」，B 是「这一条特定边上是不是还剩静态路径」。两条一起，
 *    「把 `dynamic()` 换成静态 import」与「barrel 里新增重依赖转出」都拦得住。
 *
 * ## 登记方式（`scripts/.barrel-heavy-deps.json`，与判据同目录）
 *
 * 清单**不是**「已知违规的白名单」，是**入口 × 重依赖 × 必须懒加载的模块**这三样
 * 的显式登记：新增一条 = 承认「这个入口不该静态拿到它」；判红时的修法是
 * ① 入口改走深路径（`~/components/studio/ProjectCanvas`）或继续 `dynamic()`，
 * ② barrel 停止转出（消费方从 1 个涨到 2 个以上再考虑），
 * ③ 该模块确实便宜 → 从 `heavyDeps` / 清单里移除并写清理由。
 *
 * 用法:
 *   node scripts/check-barrel-heavy-deps.cjs            # 检查（有命中即非零退出）
 *   node scripts/check-barrel-heavy-deps.cjs --report   # 只出可达面与命中（盘点用）
 *   node scripts/check-barrel-heavy-deps.cjs --json     # 机器读（供契约测试）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
/* 登记清单与脚本**同目录**（`scripts/`）。`__dirname` 在真实仓库里就是它；
 * 找不到时退回 `process.cwd()/scripts/` —— 判据的自测把脚本单独搬进临时工作区
 * （那里没有 `scripts/` 层级、`__dirname` 是工作区根），这一档要能读到工作区里
 * 那份夹具配置。两条路径都找不到就**明确报错**，不许静默按空清单放行。 */
const CONFIG_PATH = [
  path.join(__dirname, ".barrel-heavy-deps.json"),
  path.join(process.cwd(), "scripts", ".barrel-heavy-deps.json"),
].find((p) => fs.existsSync(p));
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const AS_JSON = ARGS.has("--json");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/** 去掉注释与字符串字面量里的噪声前先剥注释 —— 注释里写 `import "x"` 不构成依赖。 */
function stripComments(src) {
  return src.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*\/\/.*$/gm, "");
}

/**
 * 与 tsconfig 的 `paths` 对齐的说明符解析：`@/` `~/` → `src/`，相对按引用方位置，
 * 扩展名省略按 TS 的解析顺序（`x.ts` / `x.tsx` / `x/index.ts` / `x/index.tsx`）。
 * 解析不到（第三方包 / Node 内建 / 资源文件）返回 null —— 那是**外部边**，
 * 由 `heavyDeps` 在「命中模块的 import 文本」上另判。
 */
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith("~/")) {
    base = path.join(SRC, spec.slice(2));
  } else if (spec.startsWith("@/")) {
    base = path.join(SRC, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  for (const c of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return toPosix(path.relative(ROOT, c));
    }
  }
  return null;
}

/** 一次读盘，静态边与外部依赖都从这里取（避免同一文件读两遍、两处口径漂移）。 */
const FILE_CACHE = new Map();
function readSrc(absFile) {
  if (!FILE_CACHE.has(absFile)) {
    try {
      FILE_CACHE.set(absFile, stripComments(fs.readFileSync(absFile, "utf8")));
    } catch {
      FILE_CACHE.set(absFile, "");
    }
  }
  return FILE_CACHE.get(absFile);
}

/**
 * 静态依赖：`import … from "x"` / `export … from "x"` / 裸副作用 `import "x"`。
 * **刻意不认** `import("x")`（`dynamic()` 的形态）—— 见头注「判据」一节。
 */
function staticSpecs(src) {
  const out = new Set();
  /* ⚠️ 三条口径，每条都对应一次实测或一个真后果：
   *
   * ① **不许跨过 `(`** —— `import("x")` 是懒加载、不是静态边。`[^;]*?` 这种放任
   *    写法会把 `React.lazy(() => import("x"))` 里的说明符一起吃掉（实测：给
   *    `json-viewer` 加上 `React.lazy` 包装层之后，判据仍报「静态可达」）。
   * ② **`import type` / `export type` 不算边** —— 它们在编译后被完全擦除。
   *    本条的立案现场有一半恰恰是类型（`canvas-store` 只借一个 `Edge` 类型），
   *    不排除这一档就等于把「纯类型依赖」当成运行时依赖，判据会长期带假阳性。
   *    这一格也是最容易写错的：`import type { X } from "y"` 与
   *    `import { X } from "y"` 的文本几乎一样，而只有后者是真边。
   * ③ 裸副作用 `import "x"` 单独一条正则（它没有 `from`）。 */
  for (const m of src.matchAll(
    /\b(?:import|export)\s(?!type\s)[^;=(]*?\bfrom\s*["']([^"']+)["']/g,
  )) {
    out.add(m[1]);
  }
  for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    out.add(m[1]);
  }
  return [...out];
}

/** 入口的静态可达闭包：{ 相对路径 -> 上一跳 }（上一跳用来打印整条链）。 */
function staticClosure(entryRel) {
  const entryAbs = path.join(ROOT, entryRel);
  const parent = new Map([[entryRel, null]]);
  const queue = [entryAbs];
  while (queue.length > 0) {
    const cur = queue.pop();
    const curRel = toPosix(path.relative(ROOT, cur));
    for (const spec of staticSpecs(readSrc(cur))) {
      const resolved = resolveSpec(spec, cur);
      if (resolved === null || parent.has(resolved)) {
        continue;
      }
      parent.set(resolved, curRel);
      queue.push(path.join(ROOT, resolved));
    }
  }
  return parent;
}

/** 从闭包的 parent 表里还原「入口 → 命中模块」的整条链。 */
function chainTo(parent, entryRel, target) {
  const chain = [target];
  let cur = parent.get(target);
  while (cur) {
    chain.push(cur);
    if (cur === entryRel) {
      break;
    }
    cur = parent.get(cur);
  }
  return chain.reverse();
}

/**
 * 一个模块**真引用**的裸包说明符（`import` / `export … from` / 裸副作用 / `require`），
 * **不含** `import type`（编译后擦除，见头注与 `staticSpecs` ②）。
 *
 * 返回去重的说明符原文（`@xyflow/react`、`@xyflow/react/dist/style.css` 各算一条，
 * 由调用方按前缀比对）。`import()` 里的说明符也算 —— 那是懒加载，它满足「这个模块
 * 依赖它」，只是**不构成**从入口到它的静态边；而本函数判断的是「命中模块自己有没有
 * 引这个重依赖」，两件事分开。
 */
function runtimeDepsOf(modRel) {
  const src = readSrc(path.join(ROOT, modRel));
  const out = new Set();
  const bare = (spec) => {
    if (!spec || spec.startsWith(".") || spec.startsWith("~/") || spec.startsWith("@/")) {
      return;
    }
    if (spec.startsWith("node:")) {
      return;
    }
    out.add(spec);
  };
  /* 静态：import / export … from（排除 `import type`）。 */
  for (const m of src.matchAll(
    /\b(?:import|export)\s(?!type\s)[^;=(]*?\bfrom\s*["']([^"']+)["']/g,
  )) {
    bare(m[1]);
  }
  /* 裸副作用 import "x"。 */
  for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    bare(m[1]);
  }
  /* 动态 `import("x")` 与 `require("x")` —— 懒加载也算「这个模块引了它」。 */
  for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
    bare(m[1]);
  }
  return [...out];
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function main() {
  const config = loadConfig();
  const { entries = [], heavyDeps = [], lazyMustBeDynamicFromEntry = [] } = config;

  const findings = [];
  const reports = [];

  for (const entryRel of entries) {
    if (!fs.existsSync(path.join(ROOT, entryRel))) {
      findings.push({
        kind: "entry-missing",
        entry: entryRel,
        message: `登记为入口的 ${entryRel} 不存在 —— 登记项会静默失效（改路径 / 删文件时同批改这里）。`,
      });
      continue;
    }
    const parent = staticClosure(entryRel);
    const reachable = [...parent.keys()];
    reports.push({ entry: entryRel, reachable: reachable.length });

    /* 只读「静态可达模块自己的 import 文本」，用来判它是不是重依赖的落点。
     * 判据刻意看**模块文本**而不是 `node_modules` 里真解析：解析要跑 Node 的
     * 解析算法、还要处理 pnpm 的软链，代价远大于收益 —— 而形态（谁 import 了
     * `@xyflow/react`）在本仓是稳定的、可直接 grep 的事实。 */
    for (const modRel of reachable) {
      if (modRel === entryRel) {
        continue;
      }
      /* 只看**真引用**：`import` / `require` / 裸副作用 import 里的说明符。
       * 不能用「文件里出现过这个字符串」判 —— `import type { X } from
       * "@xyflow/react"` 同样含这个串，而它编译后被完全擦除（与上面
       * `staticSpecs` 的 ② 是同一口径）。本判据的立案现场就有一半是类型。 */
      const deps = runtimeDepsOf(modRel);
      for (const dep of heavyDeps) {
        if (!deps.some((d) => d === dep || d.startsWith(`${dep}/`))) {
          continue;
        }
        findings.push({
          kind: "heavy-dep-static-reachable",
          entry: entryRel,
          module: modRel,
          dep,
          chain: chainTo(parent, entryRel, modRel),
        });
      }
    }

    for (const lazyRel of lazyMustBeDynamicFromEntry) {
      if (!parent.has(lazyRel)) {
        continue;
      }
      findings.push({
        kind: "lazy-module-statically-reachable",
        entry: entryRel,
        module: lazyRel,
        chain: chainTo(parent, entryRel, lazyRel),
      });
    }
  }

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify({ reports, findings }, null, 2)}\n`);
    process.exit(findings.length > 0 ? 1 : 0);
  }

  for (const r of reports) {
    console.log(`  入口 ${r.entry}：静态可达 ${r.reachable} 个模块`);
  }
  if (REPORT_ONLY) {
    console.log(
      `\n重依赖登记 ${heavyDeps.length} 条 / 必须懒加载模块 ${lazyMustBeDynamicFromEntry.length} 条，命中 ${findings.length} 处`,
    );
  }

  if (findings.length === 0) {
    console.log(
      `\n✓ 入口静态图里没有重依赖（登记入口 ${entries.length} 个；规范 §12.19 / 02 §2.9）。`,
    );
    return;
  }

  console.error(`\n✗ 入口的**静态**可达图里出现了不该有的东西（${findings.length} 处）：\n`);
  for (const f of findings) {
    if (f.kind === "entry-missing") {
      console.error(`  · ${f.message}`);
      continue;
    }
    const kind =
      f.kind === "heavy-dep-static-reachable" ? `重依赖 ${f.dep}` : "按设计必须懒加载的模块";
    console.error(`  · 入口 ${f.entry} 静态拿到 ${f.module}（${kind}）`);
    console.error(`    链：${f.chain.join(" -> ")}`);
  }
  console.error(
    "\n修法（任选其一，按「谁更靠近入口」排）：" +
      "\n  ① 入口改走深路径（`~/components/studio/ProjectCanvas`）而不是 barrel —— " +
      "\n     `dynamic()` 从深路径取，静态图里就不会有这一跳；" +
      "\n  ② barrel 停止转出该模块（消费方 ≥2 再考虑转出）；" +
      "\n  ③ 该模块确实便宜 → 从 .barrel-heavy-deps.json 的 heavyDeps / 清单里移除并写清理由。" +
      "\n  注意：在入口补一层 `dynamic()` **不算修好** —— 静态边还在（这正是本条立案时的现场）。" +
      "\n  规范 §12.19 / 02 §2.9。\n",
  );
  process.exit(1);
}

main();
