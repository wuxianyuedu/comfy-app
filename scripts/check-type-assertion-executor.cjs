#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:类型层断言的**执行者**在场(供 .githooks/pre-commit 调用)
/**
 * `expectTypeOf` / `assertType` 这类**类型层断言**在本仓库的唯一执行者是
 * `tsc --noEmit` —— 规范见 docs/standards/11-测试与可观测性.md §11.20。
 *
 * 为什么要有这条判据（ISSUE #1485 收尾轮）：`expectTypeOf` 是本仓库盘点
 * vitest 5 新能力时最后三条之一。它看起来「跟别的断言一样」，实测下来**完全不是**：
 *
 * ── ① 它在 vitest 里没有牙：错的断言照样报绿 ─────────────────────────────
 *
 * 实测（vitest 5.0.3，`pnpm exec vitest run`）：
 *
 *   用例里写：`it("…", () => { expectTypeOf<string>().toEqualTypeOf<number>(); })`
 *   跑出来是：`Test Files 1 passed | Tests 1 passed` —— **绿的**
 *
 * 同一次 `pnpm exec tsc --noEmit` 对那一行报（原文照抄）：
 *   `error TS2344: Type 'number' does not satisfy the constraint`
 *   `'"Expected: number, Actual: string"'`
 *
 * 原因是 vitest 默认**只擦类型、不做类型检查**（它把 TS 交给 rolldown 转译）。
 * 于是 `expectTypeOf` 是「类型层的判据 + 借 tsc 当执行者」，而**这一点在
 * 用例文件里看不出来**。
 *
 * ── ② `--typecheck` 救不了普通用例文件 ───────────────────────────────────
 *
 * 实测 `pnpm exec vitest --typecheck run <普通 .test.ts>`：**仍然绿**。
 * 因为 `--typecheck` 收的是 `typecheck.include`（默认 `**\/*.test-d.ts`），
 * 普通 `.test.ts` 根本不在它的收集面里 —— 也就是说「加了 `--typecheck`」
 * 并不等于「这份用例的类型断言有人跑」。本仓库 `vitest.config.ts` 的
 * `include` 也只匹配 `*.test.{ts,tsx}`，`.test-d.ts` **一份都不收**。
 *
 * ── ③ 唯一的执行者是 tsconfig 的 include 面 ─────────────────────────────
 *
 * 实测：`.test-d.ts` 里写一条错断言 → `vitest run` **「No test files found」**
 * （不进 vitest 收集面），而 `tsc --noEmit --listFiles` **能数到它两次**
 * （被真收进 program）。结论是反的：类型断言文件之所以有人管，
 * **不是**因为 vitest 认它，而是因为 `tsconfig.include` 里有 `**\/*.ts`。
 *
 * 这就带出一条**静默**失效路径，实测过：
 *
 *   把 `tsconfig.include` 从 `**\/*.ts` 收窄成 `src\/**\/*.ts`（测试文件出局）之后
 *     · `tsc --noEmit`   → 对测试文件里那条错断言**一个字都不说**
 *     · `vitest run`     → **仍然绿**
 *
 * ⇒ 全仓每一个 `expectTypeOf` 同时**变成装饰品**，而没有任何一处报错。
 * 这正是本仓库反复踩的那一族（§11.13.1 / §11.18.3.1「判据在场 ≠ 判据在跑」），
 * 只不过这次的判据写在**用例文件里**、执行者写在**构建配置里**。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *
 * 三件纯文本、零网络、< 1s：
 *
 *   ① **有站点就得有执行者**：扫到 `expectTypeOf(` / `assertType<` 站点时，
 *      `tsconfig.json` 的 `include` 必须仍然覆盖站点所在目录 —— 覆盖不了就报
 *      「这些断言没人跑」。这是把上面那条静默路径**钉在配置改动的当场**。
 *
 *   ② **站点不许落在 vitest 收不到的目录**：站点文件必须匹配
 *      `vitest.config.ts` 的 `include` **或** 是本判据认下的「只给 tsc 看的」
 *      `.test-d.ts`。落在两处之外的文件（改名前 / 挪到 excluded 目录）是
 *      「名义上有用例、实际上没人跑」。
 *
 *   ③ **判据自己不许静默降级**：解析不出 `include` / 扫不到任何站点时，
 *      分别判**失败**与**明确放行**（零站点是合法状态，本判据是纯闸门）——
 *      但**解析失败**必须报错，不能像 §11.18.3 首版那样「解析不到 → 空转照样 OK」。
 *
 * 用法：
 *   node scripts/check-type-assertion-executor.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-type-assertion-executor.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = new Set(process.argv.slice(2)).has("--report");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径。 */
const SCAN_DIRS = ["src", "tests"];
/** 站点所在文件：普通用例 + 只给 tsc 看的类型用例（两种都扫）。 */
const TEST_FILE_RE = /\.test\.tsx?$/;
const TYPE_ONLY_FILE_RE = /\.test-d\.tsx?$/;

/**
 * 类型层断言的站点。
 *
 * ⚠️ **折行形态要认**：prettier 会把长行折成
 * `expectTypeOf(\n  x,\n).toEqualTypeOf<…>()` —— 只认行内字面量会整片漏出
 * 扫描面，且漏得**静默**（同 §11.18.3.1 那条实测：`expect.soft` 的判据首版
 * 计数从 27 掉到 26，而判据照样报 OK）。
 */
const TYPE_ASSERTION_SITE_RE =
  /(?<![\w.$])(?:expectTypeOf|assertType)\s*[<(]/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (TEST_FILE_RE.test(e.name) || TYPE_ONLY_FILE_RE.test(e.name)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * 把**不是代码**的区间挖掉（换成等长空格，保持偏移）：行注释、块注释、
 * 单/双引号字符串、模板串。
 *
 * 为什么要挖：本判据自己的自测（`tests/type-assertion-gate.test.ts`）里
 * 写着**夹具字符串**，里面就有 `expectTypeOf(` —— 不挖字符串，判据就会去判
 * 自己的夹具（同族先例：`tests/comment-language.test.ts` 里那份
 * `"// @vitest-environment jsdom"`，把 ISSUE #1485 那轮的文件计数从 183 数成了 185）。
 *
 * 刻意**不处理正则字面量**：少挖一段的代价只是漏报，而漏报是可接受的方向
 * （§11.17.4 / §11.18.3.1 同一条教训）。
 */
function maskNonCode(src) {
  const out = src.split("");
  /** @type {string[]} "tmpl" = 模板串本体；"interp" = 它里面的 `${…}` */
  const stack = [];
  let braceDepth = 0;
  let i = 0;
  let mode = "code"; // 状态:代码 | 行注释 | 块注释 | 单引号 | 双引号 | 模板串

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (mode === "line") {
      if (ch === "\n") mode = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        mode = "code";
      } else {
        if (ch !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (mode === "sq" || mode === "dq") {
      const quote = mode === "sq" ? "'" : '"';
      if (ch === "\\") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === quote) mode = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      if (ch === "\\") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === "`") {
        mode = "code";
        out[i] = " ";
        i += 1;
        continue;
      }
      if (ch === "$" && next === "{") {
        stack.push("interp");
        braceDepth = 0;
        mode = "code";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch !== "\n") out[i] = " ";
      i += 1;
      continue;
    }
    // mode === "code"
    if (ch === "/" && next === "/") {
      mode = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (ch === "'") {
      mode = "sq";
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = "dq";
      i += 1;
      continue;
    }
    if (ch === "`") {
      mode = "tmpl";
      stack.push("tmpl");
      i += 1;
      continue;
    }
    if (stack.at(-1) === "interp") {
      if (ch === "{") braceDepth += 1;
      else if (ch === "}") {
        if (braceDepth === 0) {
          stack.pop();
          mode = "tmpl";
        } else braceDepth -= 1;
      }
    }
    i += 1;
  }
  return out.join("");
}

/**
 * 把 JSONC（带注释的 JSON，tsconfig.json 就是）里的注释挖掉。
 *
 * **不复用 `maskNonCode`**：它的字符串态会顺带处理模板串与 `${…}`，而
 * tsconfig 里没有模板串；更要紧的是它把注释挖成**空格**之后，`"**\/*.ts"` 这类
 * 条目里的 `*` 仍是原样 —— 那是我们**要读**的内容。这里只做「挖注释」这一件事，
 * 且**偏移不变**（挖成空格），免得后续要按偏移取行号时错位。
 *
 * 为什么编码这几十行而不是引 `jsonc-parser` / `strip-json-comments`：
 * 本判据要跑在 pre-commit D 组（每次提交），而多一条依赖要给 `pnpm-workspace.yaml`
 * 的 `allowBuilds` 记账（AGENTS 硬规则 8）。tsconfig 的注释形态只有行注释与块注释
 * 两种，且**不会出现在字符串里**（路径里不会有 `//` 开头）—— 判据口径足够简单。
 */
function blankJsonComments(src) {
  const out = src.split("");
  let i = 0;
  let mode = "code"; // 状态:代码 | 行注释 | 块注释 | 字符串
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (mode === "line") {
      if (ch === "\n") mode = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        mode = "code";
      } else {
        if (ch !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (mode === "str") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') mode = "code";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      // 注释的两字符开头也要挖掉 —— 只换模式不抹字符，`/*` 会留在 JSON 里
      // 变成一份解析不了的东西（首版就是这样，报的位置正好是注释的开头）。
      out[i] = " ";
      out[i + 1] = " ";
      mode = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      mode = "block";
      i += 2;
      continue;
    }
    if (ch === '"') {
      mode = "str";
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * 读 `tsconfig.json` 的 `include`。
 *
 * ⚠️ 刻意**不引入 JSON5 / tsconfig 解析器**（会多一条依赖），而是用最小的
 * 「挖注释 + 去尾逗号」预处理 + `JSON.parse`。
 * 解析不出来必须**抛**（由调用方判失败）：静默退回「没有 include」＝ 判据空转。
 */
function readTsconfigInclude() {
  const abs = path.join(ROOT, "tsconfig.json");
  let raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e) {
    throw new Error(`读不到 tsconfig.json：${e.message}`);
  }
  const stripped = blankJsonComments(raw).replace(/,(\s*[}\]])/g, "$1");
  let json;
  try {
    json = JSON.parse(stripped);
  } catch (e) {
    throw new Error(`解析 tsconfig.json 失败（挖注释后仍不是合法 JSON）：${e.message}`);
  }
  if (!Array.isArray(json?.include)) {
    throw new Error("tsconfig.json 的 `include` 不是数组（形状不在预期内）");
  }
  return json.include;
}

/**
 * 把 tsconfig 的一条 include 条目变成「相对仓库根的正则」。
 *
 * 只支持本仓库实际用到的形状：字面目录段、`*`、`**`、`*.ext`、`{ts,tsx}`。
 * 刻意不引 picomatch —— 但要**认不出来就抛**，不能静默不匹配
 * （§11.17.4.1 记过的那条：`(main)` 在 glob 里不转义 = 静默不匹配）。
 */
function includeEntryToRegExp(entry) {
  const norm = entry.split(path.sep).join("/");
  let re = "";
  for (let i = 0; i < norm.length; i += 1) {
    const ch = norm[i];
    if (ch === "*") {
      if (norm[i + 1] === "*") {
        // `**/` 可以匹配零层目录（TS 的语义），用 `(?:.*/)?` 表达
        if (norm[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
      continue;
    }
    if (ch === "{") {
      const end = norm.indexOf("}", i);
      if (end === -1) throw new Error(`include 条目里的 \`{\` 没有配套的 \`}\`：${entry}`);
      const alts = norm
        .slice(i + 1, end)
        .split(",")
        .map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      re += `(?:${alts.join("|")})`;
      i = end;
      continue;
    }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function main() {
  let include;
  try {
    include = readTsconfigInclude();
  } catch (e) {
    console.error(
      `[ERROR] 类型层断言判据**自己**没能解析出 tsconfig 的 include：${e.message}\n` +
        "判据解析失败一律判失败 —— 静默退回「没有 include」会让本判据空转、照样报 OK\n" +
        "（§11.20 的判据③，与 §11.18.3 首版那个 `include: []` 却退 0 的 bug 同族）。",
    );
    return 1;
  }
  if (include.length === 0) {
    console.error(
      "[ERROR] tsconfig 的 include 是空数组 —— 类型层断言必然没有执行者。",
    );
    return 1;
  }

  let includeRes;
  try {
    includeRes = include.map(includeEntryToRegExp);
  } catch (e) {
    console.error(`[ERROR] 解析 tsconfig 的 include 条目失败：${e.message}`);
    return 1;
  }

  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const offenders = [];
  const sites = [];
  let totalSites = 0;

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const masked = maskNonCode(fs.readFileSync(abs, "utf8"));
    const found = [...masked.matchAll(TYPE_ASSERTION_SITE_RE)];
    if (found.length === 0) continue;

    const typeOnly = TYPE_ONLY_FILE_RE.test(rel);
    /* 站点所在文件**有没有人跑它的类型断言**：判据是「在 tsconfig 的 include 面里」。
       这是本判据的核心 —— 执行者是构建配置，不是 vitest。 */
    const covered = includeRes.some((re) => re.test(rel));
    sites.push({ rel, count: found.length, covered, typeOnly });
    totalSites += found.length;

    if (!covered) {
      const lines = found.map(
        (m) => masked.slice(0, m.index).split("\n").length,
      );
      for (const line of lines) offenders.push({ rel, line, why: "不在 tsconfig 的 include 面里" });
    }
  }

  if (totalSites === 0) {
    console.log(
      "[type-assertion] OK —— 0 处 expectTypeOf/assertType 站点（本判据是纯闸门：对象是「下一次有人加类型层断言」）。",
    );
    return 0;
  }

  if (offenders.length === 0) {
    console.log(
      `[type-assertion] OK —— ${totalSites} 处类型层断言，全部落在 tsconfig 的 include 面里（执行者 = \`tsc --noEmit\`）。`,
    );
    return 0;
  }

  console.error(
    (REPORT_ONLY
      ? `[type-assertion] 盘点：${offenders.length} 处无执行者（--report 不判失败）`
      : `[ERROR] 有 ${offenders.length} 处类型层断言**没有执行者**`) + "：\n",
  );
  for (const o of offenders) console.error(`  · ${o.rel}:${o.line} —— ${o.why}`);
  console.error(
    "\n`expectTypeOf` / `assertType` 在 vitest 里**没有牙**：错的断言照样报绿" +
      "\n（实测 vitest 5.0.3：`expectTypeOf<string>().toEqualTypeOf<number>()` → Tests 1 passed）。" +
      "\n它们唯一的执行者是 `tsc --noEmit`，而 tsc 只按 `tsconfig.json` 的 include 面收文件 ——" +
      "\n所以站点一旦落到 include 面之外，全仓的断言会**同时变成装饰品，且没有任何一处报错**。" +
      "\n修法二选一：" +
      "\n  · 把该文件放回 include 面（通常是 `**/*.ts` 已经覆盖的 src/ 或 tests/）；" +
      "\n  · 确实是只给 tsc 看的类型用例 → 命名成 `.test-d.ts` 并确认仍落在 include 面里。" +
      "\n口径见 docs/standards/11-测试与可观测性.md §11.20。",
  );
  return REPORT_ONLY ? 0 : 1;
}

process.exit(main());
