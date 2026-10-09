#!/usr/bin/env node
// @ts-nocheck -- 声明 ⇄ 读者的判据（供 .githooks/pre-commit 的 D 组调用）
/**
 * 「声明写得出来不算数，读的人在跑才算」这条口径的判据 —— 规范见
 * docs/standards/11-测试与可观测性.md §11.23。
 *
 * 为什么要有这一个：本仓库的「声明机制」是一个一个事故里长出来的
 * （判据自称在跑 / 条件性 skip / 已知基线失败登记 / 环境归属 / 并发隔离 /
 * 类型断言执行者 / 软断言语义 / 像素档……），每一种都自带一份台账与一条判据。
 * 后果有两个：
 *   ① 每种机制的规则写在各自的节里，**没有任何一处说得出「本仓库一共有哪些声明、
 *      各自的读者是谁」** —— 于是第 5 个人加一种新机制时，无处可查「我该登记什么」；
 *   ② 上一轮发现的现场：五处引用把这条口径的归属写成 §11.13.1，而 §11.13.1 的
 *      题目是「判据自己也不许依赖现生成、不入库的输入」、正文里**不含这条命题** ——
 *      **读者按引用走过去什么也找不到**。这正是本条口径要拦的病，只不过病在文档里。
 * 所以本判据的对象不是「某种机制的规则」，是**索引自己**：这条索引要么有读者、
 * 要么它自己就是第一个反例。
 *
 * 判据（纯文本、零网络、实测 < 1s）：
 *   ① **每一行点名的读者存在** —— 脚本 / 用例文件丢了或被改名 ⇒ 红；
 *   ② **每一行的执行者真在门禁链里** —— 双向：
 *      · `hook-step`：该标签必须出现在 `.githooks/pre-commit` 的 `run "…"` 步骤上
 *        （摘掉那一步 ⇒ 红，那正是「判据在场、没人敲它」）；
 *      · `fixed-test`：该文件必须在 `scripts/affected-tests.mjs` 的
 *        `FIXED_STRUCTURAL_TESTS` 里（离开固定清单 ⇒ 只在碰到它时才跑，不再是执行者）；
 *      · `npm-script`：`package.json` 的 `scripts` 里必须有这个入口名（入口被删 ⇒
 *        那条「按需召唤」的承诺没有任何东西能兑现 —— 与 `check-gate-executors.cjs`
 *        认 `package.json` 入口为执行者同口径，§11.23.2 第 1 条的「按需召唤」那一半）。
 *   ③ **索引自己不许静默降级** —— 解析不出 / 结构不对 / `carriers` 为空
 *      / 行数比记录的基线少 ⇒ 判失败，而不是「没有载体要查、于是放过」。
 *      同族先例：§11.18.3 首版那个 `include: []` 却退 0、§11.20.5 的同类口径。
 *   ④ **每一行必须点名规范节**（`section`）—— 「这条声明归哪个节管」不许留空，
 *      否则下一个人还是找不到规则在哪。
 *
 * 刻意不做（都写进 §11.23.4 了）：
 *   · 不判「某处声明该不该有」（收益判断，要实测）；
 *   · 不静态判「谁在读」（跨模块消费关系静态判会误报一片，而误报的判据活不过一次评审）；
 *   · 不给报告档要执行者（报告档恒 exit(0)，按定义不该有判定者，§13.5.12）；
 *   · 不复述各机制自己的规则（索引只登记「读者是谁」，规则归各自的节 —— §12.18）。
 *
 * 用法：
 *   node scripts/check-declaration-readers.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-declaration-readers.cjs --report   # 只出清单不判失败（盘点用）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const LEDGER = path.join(__dirname, ".declaration-readers.json");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");
const AFFECTED = path.join(ROOT, "scripts", "affected-tests.mjs");
const PACKAGE_JSON = path.join(ROOT, "package.json");

/**
 * 索引行数的下限 —— 它不是「正确值」，是**静默降级的地板**：
 * 解析规则失灵（字段改名 / 嵌套变形）时最容易退化成「解析出 0 行、于是全绿」。
 * 低于地板即判失败。会漂的读数不写死（§12.14）⇒ 只做**下限**，
 * 且新增载体时不必回来改它。
 */
const MIN_CARRIERS = 8;

const problems = [];
const report = [];

/* ── 读索引（判据自己不许静默降级） ─────────────────────────── */

function readLedger() {
  if (!fs.existsSync(LEDGER)) {
    problems.push(
      `索引不存在：${path.relative(ROOT, LEDGER)} —— 本判据的对象就是它（规范 §11.23.3）`,
    );
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch (err) {
    problems.push(`索引不是合法 JSON：${err.message}`);
    return null;
  }
  const carriers = parsed?.carriers;
  if (!Array.isArray(carriers)) {
    problems.push(
      "索引里 `carriers` 不是数组（判据不许静默降级，见 §11.23.3）",
    );
    return null;
  }
  if (carriers.length < MIN_CARRIERS) {
    problems.push(
      `索引只有 ${carriers.length} 行，低于地板 ${MIN_CARRIERS} —— ` +
        "解析规则退化成「读出 0 行」时本判据会空转、照样报 OK（§11.23.3）",
    );
    return null;
  }
  return carriers;
}

/* ── 门禁链里的执行者取证（与 §13.5.12 同源的口径：只读步骤行） ── */

/** `.githooks/pre-commit` 里 `run "<标签>" <命令>` 的标签全表。 */
function hookStepLabels() {
  const src = fs.readFileSync(HOOK, "utf8");
  const out = new Set();
  // 步骤行形如：  run "标签" node scripts/x.cjs …
  for (const m of src.matchAll(/^\s*run\s+"([^"]+)"/gm)) out.add(m[1]);
  return out;
}

/**
 * `scripts/affected-tests.mjs` 的 `FIXED_STRUCTURAL_TESTS` 全表。
 *
 * **不按 `\[…\]` 非贪婪取**：那张表里全是**带散文的注释**，注释里就会出现
 * `[` / `]`（实测：第一个 `]` 落在注释中间，于是非贪婪取出的片段截断在那里，
 * 末几项整片漏掉 —— 表现是「表里明明有的用例被判成不在固定清单里」，
 * 也就是判据**自己**成了 §11.23 要拦的那种静默失效）。
 * 改成「定位数组起点 → 逐字符扫到配对的 `]`，字符串态跳过」。
 * @returns {Set<string> | null}
 */
function fixedStructuralTests() {
  const src = fs.readFileSync(AFFECTED, "utf8");
  const at = src.search(/FIXED_STRUCTURAL_TESTS\s*=\s*\[/);
  if (at < 0) return null;
  const open = src.indexOf("[", at);
  let depth = 0;
  let quote = null;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const body = src.slice(open + 1, end);
  return new Set([...body.matchAll(/"([^"\n]+)"/g)].map((x) => x[1]));
}

/**
 * `package.json` 的 `scripts` 入口名全表 —— 「按需召唤」那一类执行者的取证。
 *
 * 为什么它算执行者：§11.23.2 认的执行者之一就是「按需召唤」那一层（`pnpm <名>`
 * 入口）—— 它不是一个「文档里写着」的承诺，而是一条**真的能敲下去**的命令。
 * 入口名被删 / 被改名 ⇒ 那条声明再没有东西能兑现，与钩子步骤被摘掉同罪。
 *
 * 取不到 `package.json` 或它没有 `scripts` ⇒ 返回 `null`，由调用点判「判据不许
 * 静默降级」（不是「没有入口要查、于是放过」）。
 *
 * @returns {Set<string> | null}
 */
function npmScripts() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  } catch {
    return null;
  }
  const scripts = parsed?.scripts;
  if (!scripts || typeof scripts !== "object") return null;
  return new Set(Object.keys(scripts));
}

/* ── 主流程 ──────────────────────────────────────────────────── */

const carriers = readLedger();

if (carriers) {
  const labels = hookStepLabels();
  const fixed = fixedStructuralTests();
  const scripts = npmScripts();
  if (fixed === null) {
    problems.push(
      "解析不出 `FIXED_STRUCTURAL_TESTS`（scripts/affected-tests.mjs）—— " +
        "判据不许静默降级（§11.23.3）",
    );
  }
  if (scripts === null) {
    problems.push(
      "解析不出 `package.json` 的 `scripts` —— 判据不许静默降级（§11.23.3）",
    );
  }

  const seen = new Set();
  for (const c of carriers) {
    const id = c?.id ?? "(缺 id)";
    if (!c?.id || !c?.name || !c?.reader || !c?.section || !c?.executor) {
      problems.push(
        `索引行 ${id} 字段不全（需要 id / name / reader / section / executor）`,
      );
      continue;
    }
    if (seen.has(c.id)) problems.push(`索引里 id 重复：${c.id}`);
    seen.add(c.id);

    // ① 读者存在
    if (!fs.existsSync(path.join(ROOT, c.reader))) {
      problems.push(
        `「${c.name}」的读者不存在：${c.reader} —— ` +
          "声明写得出来不算数，读的人在跑才算（§11.23.1）",
      );
    }

    // ② 执行者真在门禁链里
    const ex = c.executor;
    if (ex.kind === "hook-step") {
      if (!labels.has(ex.label)) {
        problems.push(
          `「${c.name}」登记的执行者是钩子步骤「${ex.label}」，` +
            "而 `.githooks/pre-commit` 里没有这个标签 —— 判据在场、没人敲它（§11.23.2）",
        );
      }
    } else if (ex.kind === "fixed-test") {
      if (fixed === null) {
        // 上面已经报过解析失败，这里只跳过
      } else if (!fixed.has(ex.file)) {
        problems.push(
          `「${c.name}」登记的执行者 ${ex.file} 不在 FIXED_STRUCTURAL_TESTS 里 —— ` +
            "C 组固定清单里的用例才算执行者（§11.23.2）",
        );
      }
    } else if (ex.kind === "npm-script") {
      if (scripts === null) {
        // 上面已经报过解析失败，这里只跳过
      } else if (!scripts.has(ex.script)) {
        problems.push(
          `「${c.name}」登记的执行者是 package.json 入口「${ex.script}」，` +
            "而它不在 `scripts` 里 —— 按需召唤的入口没了，那条声明再没有东西能兑现（§11.23.2）",
        );
      }
    } else {
      problems.push(
        `「${c.name}」的 executor.kind 只能是 hook-step / fixed-test / npm-script`,
      );
    }

    report.push(
      `${c.id}\t§${c.section}\t读者 ${c.reader}\t执行者 ${
        ex.label ?? ex.file ?? `pnpm ${ex.script}`
      }`,
    );
  }
}

/* ── 输出 ────────────────────────────────────────────────────── */

if (REPORT_ONLY) {
  process.stdout.write(
    `声明 ⇄ 读者索引（${carriers?.length ?? 0} 行）：\n` +
      report.map((l) => "  " + l).join("\n") +
      "\n",
  );
  process.exit(0);
}

if (problems.length > 0) {
  console.error(
    `[declaration-readers] 声明 ⇄ 读者索引有 ${problems.length} 处问题（规范 §11.23）：\n` +
      problems.map((p) => "  · " + p).join("\n") +
      "\n",
  );
  process.exit(1);
}

process.stdout.write(
  `声明 ⇄ 读者：${carriers.length} 种声明的读者与执行者都在场\n`,
);
