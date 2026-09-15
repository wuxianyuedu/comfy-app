#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:模块循环依赖扫描(供 .githooks/pre-commit 与 CI 调用)
/**
 * 模块循环依赖扫描 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.7。
 *
 * 背景(ISSUE #574)：`src/lib` 内含 2 个真实环(executor 家族 4 文件互相递归、
 * comfyui 状态探测 3 文件成环)，此前**只靠一句注释**「加载期是安全的」维持，
 * 没有任何测试。规范的 §12.7 长期只有两条原则、没有判据 —— 于是环可以随时长
 * 回来，而它的症状是「import 顺序变了就 `undefined is not a function`」，
 * 排查成本极高。
 *
 * 判据：把 `src/**` 的 import 图求**强连通分量**(Tarjan)。分量大小 > 1，或
 * 自环(文件 import 自己)，即判定为环。存量由棘轮基线
 * `scripts/.circular-deps-baseline.json` 记录，**只许降不许升**。
 *
 * 为什么用 SCC 而不是「找一条环路」：SCC 与遍历起点无关(结果稳定、可入基线)，
 * 且天然把「同一个环的不同走法」归成一个分量，不会把 A→B→A 与 A→C→A 报成
 * 两条 —— 那个数字会随遍历顺序漂移，做不了棘轮。
 *
 * 为什么现在这份图的解析是自己写的：
 *   仓库没有 madge / dependency-cruiser 这类依赖(不引新包)，而 `@/` `~/` 别名
 *   与扩展名省略(`./x` → `x.ts` / `x/index.ts`)必须和 tsconfig 一致 —— 20 行
 *   解析器比接一个包更容易保持「与仓库真实解析口径一致」。
 *   已知边界：只解析静态 import / export-from / 动态 `import("...")`，不追
 *   `require()` 与字符串拼接的路径(本仓库不使用)。
 *
 * 用法:
 *   node scripts/check-circular-deps.cjs           # 检查(棘轮)
 *   node scripts/check-circular-deps.cjs --strict  # 基线未收紧也失败(CI 用)
 *   node scripts/check-circular-deps.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-circular-deps.cjs --report  # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

/* 扫描根取 cwd(与 check-file-structure.cjs 同口径:门禁在仓库根被调用),
 * 基线取__dirname 旁(与脚本同目录,便于在临时工作区里被一并复制/断言)。 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const BASELINE = path.join(__dirname, ".circular-deps-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

/** 扫描目录(与门禁口径一致:只看应用源码,文档与脚本不参与)。 */
const SCAN_DIRS = ["src"];
/** 排除:用例、声明文件。用例之间雷同是正常的,声明文件没有运行时依赖。 */
const SKIP_RE = /\.(test|spec)\.tsx?$|\.d\.ts$/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !SKIP_RE.test(name)) out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/** 去掉注释,避免把注释里提到的 import 当成真实依赖。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 把 import 说明符解析成仓库内文件(相对仓库根的 POSIX 路径)。
 *
 * 与 tsconfig 的 `paths` 对齐:`@/` 与 `~/` 都指向 `src/`。扩展名省略按
 * `x.ts` / `x.tsx` / `x/index.ts` / `x/index.tsx` 依次尝试 —— 也就是 TS 的
 * 解析顺序。解析不到(第三方包、node 内建、资源文件)返回 null。
 */
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("~/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return toPosix(path.relative(ROOT, c));
  }
  return null;
}

/** 取一个文件的静态依赖集合(import / export-from / 动态 import())。 */
function depsOf(file) {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const deps = new Set();
  // import ... from "x" / export ... from "x"
  const fromRe = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
  // 裸副作用 import "x"
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  // 动态 import("x")
  const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [fromRe, bareRe, dynRe]) {
    let m;
    while ((m = re.exec(src))) {
      const resolved = resolveSpec(m[1], file);
      if (resolved) deps.add(resolved);
    }
  }
  return deps;
}

/** 构建邻接表。 */
function buildGraph() {
  const graph = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      graph.set(toPosix(path.relative(ROOT, file)), [...depsOf(file)]);
    }
  }
  return graph;
}

/**
 * Tarjan 求强连通分量(迭代实现,避免深图递归爆栈)。
 *
 * 返回每个「成环」的分量(已排序的文件名数组)。分量大小 > 1 即环;大小 1 时
 * 只有自环(文件 import 自己)才算 —— 那也是环,而且是最容易被忽略的一种。
 */
function findCycles(graph) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];
  let counter = 0;

  const nodes = [...graph.keys()].sort();
  for (const start of nodes) {
    if (index.has(start)) continue;
    // 显式栈:[节点, 下一个待访问的邻居下标]
    const work = [[start, 0]];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (work.length) {
      const frame = work[work.length - 1];
      const [node, i] = frame;
      const neighbors = graph.get(node) || [];
      if (i < neighbors.length) {
        frame[1] = i + 1;
        const next = neighbors[i];
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          work.push([next, 0]);
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), index.get(next)));
        }
        continue;
      }
      // 邻居访问完:回填 low,必要时弹分量
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const comp = [];
        let popped;
        do {
          popped = stack.pop();
          onStack.delete(popped);
          comp.push(popped);
        } while (popped !== node);
        const selfLoop = comp.length === 1 && (graph.get(comp[0]) || []).includes(comp[0]);
        if (comp.length > 1 || selfLoop) cycles.push(comp.sort());
      }
    }
  }
  // 稳定排序:让基线 diff 只反映真实变化
  return cycles.sort((a, b) => a.join("\n").localeCompare(b.join("\n")));
}

function main() {
  const graph = buildGraph();
  const cycles = findCycles(graph);
  const current = cycles.map((c) => c.join("|"));

  if (REPORT_ONLY) {
    if (cycles.length === 0) {
      console.log("✓ 无模块循环依赖(§12.7)");
      return;
    }
    console.log(`发现 ${cycles.length} 组循环依赖:`);
    for (const c of cycles) {
      console.log(`\n  环(${c.length} 个文件):`);
      for (const f of c) console.log(`    ${f}`);
    }
    return;
  }

  let baseline = [];
  if (fs.existsSync(BASELINE)) {
    baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).cycles || [];
  }

  const known = new Set(baseline);
  const added = current.filter((c) => !known.has(c));
  const removed = baseline.filter((c) => !current.includes(c));

  if (UPDATE) {
    fs.writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          // 说明:键是「同一环内的文件按字典序 join('|')」——与遍历起点无关,
          // 因此基线稳定。只许下降:消除一个环就 --update 收紧一次。
          note: "模块循环依赖棘轮(规范 12.7);只许降不许升。--update 收紧。",
          cycles: current,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`✓ 已写入基线:${current.length} 组循环依赖`);
    if (removed.length) console.log(`  比上次减少 ${removed.length} 组`);
    return;
  }

  let failed = false;
  if (added.length) {
    console.error(`✗ 新增 ${added.length} 组模块循环依赖(规范 12.7 禁止):`);
    for (const c of added) {
      const files = c.split("|");
      console.error(`\n  环(${files.length} 个文件):`);
      for (const f of files) console.error(`    ${f}`);
    }
    console.error(
      "\n修法:把「谁都不依赖」的公共部分下沉成叶子模块(类型下沉到类型模块,动作改为回调注入)," +
        "\n     让依赖方向单向;参见 §12.7 与 ISSUE #574 的断环实例。",
    );
    failed = true;
  }

  if (STRICT && removed.length) {
    console.error(
      `✗ 基线里 ${removed.length} 组环已不存在,请收紧基线:node scripts/check-circular-deps.cjs --update`,
    );
    failed = true;
  } else if (removed.length) {
    console.log(
      `提示:${removed.length} 组环已消除,可执行 node scripts/check-circular-deps.cjs --update 收紧基线`,
    );
  }

  if (!failed) {
    console.log(
      `✓ 无新增模块循环依赖(§12.7;基线 ${baseline.length} 组,当前 ${current.length} 组)`,
    );
  }
  process.exit(failed ? 1 : 0);
}

main();
