#!/usr/bin/env node
// @ts-nocheck -- React 函数式 setState updater 纯净性守卫(供 .githooks/pre-commit 与 CI 调用)
/**
 * React 函数式 updater 纯净性护栏 —— ISSUE #141
 *
 * 背景:ISSUE #141 报出的告警
 * 即 "Cannot update a component (`ExtractModelSelect`) while rendering a
 *   （即在渲染另一个组件时更新组件）
 * 根因是 DarkSelect 把副作用 `emitOpenChange(!value)` 塞进了
 * `setOpen((value) => { emitOpenChange(!value); return !value; })` 的
 * 函数式 updater。React 的函数式 updater 是**纯函数**,可能在渲染/调度阶段被求值,
 * 在其中调用外部函数(触发父组件 setState / 写 localStorage / 变更外部缓存)就会
 * 在渲染 DarkSelect 期间同步改到别的组件 state → 触发上面的 console.error。
 *
 * 本守卫把「state setter 的函数式 updater 里出现被丢弃返回值的裸调用语句」这一
 * 反模式固化成硬门槛:任何 `setX((prev) => { ... })` / `store.set((s) => {...})`
 * 的块体内出现**以表达式语句形式存在的函数/方法调用**(其返回值被丢弃),一律阻断。
 * 纯计算型 updater(只做局部派生后 return)不受影响。
 *
 * 能拦到 / 拦不到(尽力拦截,不保证全抓):
 *   ✔ setOpen((v)=>{ foo(); return !v })           —— 裸调用
 *   ✔ setX((p)=>{ setY(...); return ... })          —— updater 内嵌套 setState
 *   ✔ store.setState((s)=>{ persist(s); return s }) —— zustand 函数式更新
 *   ✘ updater 内对外部变量的赋值(projectsCache = next)—— 需作用域分析,暂不拦
 *   ✘ 纯 tsc/eslint 层面的同类问题(需跨模块数据流,静态本就不完备)
 *
 * 用法:
 *   node scripts/check-react-updater-purity.cjs    # 检查(违规即阻断)
 */
const fs = require("node:fs");
const path = require("node:path");

// ── 解析器依赖 ──
// 复用 TypeScript 编译器 API(与 pre-commit 第 2 步 pnpm exec tsc 同源,纯 JS、
// 无原生构建,凡能跑 tsc 的环境必可用)。node_modules 缺席(从未 pnpm install)
// 时降级为「跳过并提示」——此时 tsc 步骤本身也会失败,不应在这里二次阻塞。
let ts = null;
try {
  ts = require("typescript");
} catch {
  console.warn(
    "[updater-purity] 未找到 typescript(node_modules 未安装),跳过(tsc 步骤同样需要它)",
  );
  process.exit(0);
}

const ROOT = path.resolve(__dirname, "..");
// 只扫 UI/逻辑源代码;跳过测试(测试可人为构造反模式样例,不算生产违规)。
// 支持可选 CLI 位置参数指定扫描根(测试用),默认扫 src/。
const SCAN_DIR = (process.argv[2] && !process.argv[2].startsWith("-")) ? process.argv[2] : "src";

/* ── 判定:调用是不是「React/zustand 状态 setter」 ── */
// setTimeout/setInterval/setImmediate 是定时器,不是 state setter,必须排除
const NOT_SETTER = new Set([
  "setTimeout", "setInterval", "setImmediate", "setTimeoutUnref",
]);
const isStateSetter = (callee) => {
  if (ts.isIdentifier(callee))
    return /^set[A-Z]/.test(callee.text) && !NOT_SETTER.has(callee.text);
  // zustand：store.set(state => ...) / store.setState(state => ...)
  if (ts.isPropertyAccessExpression(callee))
    return /^(set|setState)$/.test(callee.name.text);
  return false;
};

/* ── 采集:找 updater 块内的副作用裸调用语句 ── */
function collect() {
  const problems = [];
  // 扫描根既支持相对仓库根(默认 src/),也支持绝对路径(测试把 fixtures 放 tmp)。
  const absBase = path.isAbsolute(SCAN_DIR) ? SCAN_DIR : path.join(ROOT, SCAN_DIR);
  const relBase = path.isAbsolute(SCAN_DIR) ? SCAN_DIR.replace(/\//g, "/")
    : SCAN_DIR.replace(/^\/+/, "").replace(/\//g, "/");
  const files = walk(absBase, relBase);
  for (const rel of files) {
    const absFile = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    const src = fs.readFileSync(absFile, "utf8");
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true,
      rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (isStateSetter(callee)) {
          const arg = node.arguments[0];
          if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))
            && ts.isBlock(arg.body)) {
            // 函数式 updater + 块体:逐条语句找「裸调用」副作用
            for (const stmt of arg.body.statements) {
              if (ts.isExpressionStatement(stmt)
                && ts.isCallExpression(stmt.expression)) {
                const { line } = sf.getLineAndCharacterOfPosition(
                  stmt.getStart(sf));
                problems.push(
                  `${rel}:${line + 1} :: 在 ${callee.getText(sf)} 的函数式 updater 内调用 ` +
                  `${stmt.expression.getText(sf).split("\n")[0].slice(0, 60)}`,
                );
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return problems;
}

/* 只收集 .ts/.tsx 源文件,跳过 .test. 与 .d.ts */
function walk(absDir, relDir, out = []) {
  if (!fs.existsSync(absDir)) return out;
  for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, e.name);
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) { walk(abs, rel, out); continue; }
    if (!/\.(tsx?)$/.test(e.name)) continue;
    if (/\.test\./.test(e.name) || e.name.endsWith(".d.ts")) continue;
    out.push(rel);
  }
  return out;
}

/* ── 主流程 ── */
const problems = collect();
if (problems.length) {
  console.error(
    "[updater-purity] 违规:React 函数式 setState updater 内存在副作用裸调用(updater 必须纯函数,渲染期求值会触发 update-during-render 告警,见 ISSUE #141)\n  " +
      problems.join("\n  ") +
      "\n修复:把副作用移出 updater,先用闭包/ref 算出 next 值,在 setState 之外再执行副作用",
  );
  process.exit(1);
}
console.log("[updater-purity] OK");
