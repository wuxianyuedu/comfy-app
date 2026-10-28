#!/usr/bin/env node
/**
 * eslint 档位的**阳性对照**（ISSUE #2541 三批之后的补闸）。
 *
 * 「全仓 0 警」是**状态**，不是**能力**：它也可能来自「规则根本没生效」
 * （#2541 的本质就是那样 —— tseslint 的 recommended 不含 core 面，于是
 * `no-control-regex` / `no-useless-assignment` / `preserve-caught-error`
 * 这些规则报了 0 条，而它们一条都没跑过）。本脚本回答的是另一件事：
 * **这些规则现在真的会拦下违例吗？**
 *
 * 做法（与 `scripts/spawn-shell-scan.mjs` 那道闸同形）：造一批**已知违例**的
 * 样本文件 → 用**本仓的配置**真跑一次 eslint → 断言每条目标规则都命中；
 * 同时放一份**干净样本**做反向对照（闸若空转/过宽，干净样本也会红，或
 * 违例样本一条都不红，两种都要被看出来）。
 *
 * 为什么必须落真文件而不是 `--stdin`：`eslint@10` 的 project service 要求
 * 文件在 tsconfig 的项目里（实测 `--stdin --stdin-filename` 会报
 * `was not found by the project service`），而 tsconfig 的 include 是
 * 「ts/tsx 全收 + `.storybook/**`」—— 所以样本写在仓库内的常规目录
 * （`tests/` 与 `scripts/` 各一个临时目录，跑完 `finally` 里删掉），
 * 文件名**不能以点开头**（TS 的 glob 默认跳过点目录，见 tsconfig 那条注释）。
 *
 * 自测口（**这条闸自己的阳性对照**）：`--sabotage <ruleId>` 会把那条规则临时
 * 关掉再跑一遍 —— 既然是「守住」的对照，关掉之后它**必须红**。恒绿的对照等于
 * 没有对照（跟「全仓 0 警」一样，也可能是它压根没判）。闸门走 eslint 的
 * CLI `--rule` 覆盖（优先级最高），不落任何临时配置文件，也就不碰工作树。
 *
 * 用法：
 *   node scripts/eslint-gate-canary.mjs                     0 = 闸全在；1 = 有闸没拦；2 = 没跑起来
 *   node scripts/eslint-gate-canary.mjs --sabotage <ruleId> 必须退 1（断言「它会红」）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ESLINT_BIN = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");

/* 样本：dir 面 + 文件名 + 内容 + 期望命中的规则。
 * 每条都对应本仓**已经开着的**规则 —— 只钉「正在守的那几条」，
 * 不把 eslint 的全部规则当目标（那是规则清单，不是闸的对照）。 */
const TS_SAMPLES = [
  {
    name: "useless-assignment.ts",
    rule: "no-useless-assignment",
    src: 'export function f(): string {\n  let v = "";\n  v = "a";\n  return v;\n}\n',
  },
  {
    name: "preserve-caught-error.ts",
    rule: "preserve-caught-error",
    src: 'export function f(): void {\n  try {\n    JSON.parse("x");\n  } catch (e) {\n    throw new Error(`解析失败：${String(e)}`);\n  }\n}\n',
  },
  {
    name: "unicorn-starts-with.ts",
    rule: "unicorn/prefer-string-starts-ends-with",
    src: "export const f = (s: string): boolean => /^a/.test(s);\n",
  },
  {
    name: "unicorn-new-array.ts",
    rule: "unicorn/no-new-array",
    src: "export const xs = new Array(3).fill(0);\n",
  },
  {
    name: "unicorn-useless-spread.ts",
    rule: "unicorn/no-useless-spread",
    src: "export const s = new Set([...new Set([1, 2])]);\n",
  },
  {
    name: "unicorn-length-check.ts",
    rule: "unicorn/no-useless-length-check",
    src: "export function f(xs: string[]): void {\n  if (xs.length > 0) {\n    for (const x of xs) console.info(x);\n  }\n}\n",
  },
  {
    name: "control-regex.ts",
    rule: "no-control-regex",
    src: "export const re = /\\x00/;\n",
  },
  {
    /* 全角空格（U+3000）在**代码位置**——注释与模板串里的由
     * skipComments / skipTemplates 放过，代码里的必须照拦。 */
    name: "irregular-whitespace.ts",
    rule: "no-irregular-whitespace",
    src: "export const a　= 1;\n",
  },
  {
    name: "useless-escape.ts",
    rule: "no-useless-escape",
    src: "export const re = /[\\.]/;\n",
  },
  {
    name: "regex-spaces.ts",
    rule: "no-regex-spaces",
    src: "export const re = /a  b/;\n",
  },
];

const SCRIPTS_SAMPLES = [
  {
    name: "unused-var.mjs",
    rule: "no-unused-vars",
    src: "const dead = 1;\nexport const live = 2;\n",
  },
];

/* 反向对照：干净样本**必须 0 命中** —— 否则这个闸要么过宽（什么都报），
 * 要么样本目录压根没进规则面（那才是真正要抓的「假绿」）。 */
const CLEAN_TS = "export const add = (a: number, b: number): number => a + b;\n";
/* 阴性对照：`no-undef` 对 scripts 面是**刻意关停**的（scripts 在 tsc 的
 * checkJs 判决面里），它不许反过来把 Node 全局判出来 —— 关停要真的生效。 */
const NO_UNDEF_SRC = "export const home = process.env.HOME;\n";

let SABOTAGE = "";
if (process.argv.includes("--sabotage")) {
  SABOTAGE = process.argv[process.argv.indexOf("--sabotage") + 1] ?? "";
  if (!SABOTAGE) {
    console.error("[eslint-canary] --sabotage 后面要跟一条规则名（关掉它之后这一格必须红）");
    process.exit(2);
  }
}

function runEslint(files) {
  const cliRules = SABOTAGE ? ["--rule", JSON.stringify({ [SABOTAGE]: "off" })] : [];
  const res = spawnSync(
    process.execPath,
    [ESLINT_BIN, "--format", "json", "--no-warn-ignored", ...cliRules, ...files],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) throw new Error(`eslint 起不来：${res.error.message}`);
  const text = (res.stdout ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`eslint 输出不是 JSON（退出码 ${res.status}）：${text.slice(0, 400)}`);
  }
  return { diagnostics: parsed, status: res.status };
}

function rulesOf(entry) {
  return new Set((entry?.messages ?? []).map((m) => m.ruleId).filter(Boolean));
}

function main() {
  if (!fs.existsSync(ESLINT_BIN)) {
    console.error("[eslint-canary] 拿不到 eslint 入口 ⇒ 这一格没有结论（退 2）");
    return 2;
  }
  const stamp = `${process.pid}-${Date.now()}`;
  const tsDir = path.join(ROOT, "tests", `eslint-canary-${stamp}`);
  const scriptsDir = path.join(ROOT, "scripts", `eslint-canary-${stamp}`);
  const dirs = [tsDir, scriptsDir];
  const misses = [];

  try {
    /* `--sabotage` 是给「这一格自己」做阳性对照用的，只跑**最小集** ——
     * eslint 每次调用的 project service 冷启动才是开销大头（沙箱实测单跑
     * 一次 ~24s），全量 6 次会让这条判据变成「受影响用例」格的新重夹具。
     * 规则在样本里 ⇒ 只跑那一组（要它红）；不在样本里 ⇒ 只跑 TS 组第一条
     * （要它照旧绿，证明闸门不误伤）。 */
    const inTs = TS_SAMPLES.find((s) => s.rule === SABOTAGE);
    const inScripts = SCRIPTS_SAMPLES.find((s) => s.rule === SABOTAGE);
    const probeTs = SABOTAGE ? inTs ?? TS_SAMPLES[0] : undefined;
    const tsSet = SABOTAGE ? [probeTs] : TS_SAMPLES;
    const scriptSet = SABOTAGE ? (inScripts ? SCRIPTS_SAMPLES : []) : SCRIPTS_SAMPLES;

    for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

    const tsFiles = [];
    for (const s of tsSet) {
      const p = path.join(tsDir, s.name);
      fs.writeFileSync(p, s.src, "utf8");
      tsFiles.push({ ...s, abs: p });
    }
    const cleanAbs = path.join(tsDir, "clean.ts");
    fs.writeFileSync(cleanAbs, CLEAN_TS, "utf8");
    const noUndefAbs = path.join(scriptsDir, "node-global.mjs");
    fs.writeFileSync(noUndefAbs, NO_UNDEF_SRC, "utf8");

    const scriptFiles = [];
    for (const s of scriptSet) {
      const p = path.join(scriptsDir, s.name);
      fs.writeFileSync(p, s.src, "utf8");
      scriptFiles.push({ ...s, abs: p });
    }

    /* TS 面一次调用（含干净样本）；scripts 面一次调用（含 no-undef 阴性样本）。
     * sabotage 模式下 scripts 组通常是空集 ⇒ 这一跳直接跳过。 */
    const tsRun = runEslint([...tsFiles.map((f) => f.abs), cleanAbs]);
    const scriptRun = scriptFiles.length
      ? runEslint([...scriptFiles.map((f) => f.abs), noUndefAbs])
      : { diagnostics: [], status: 0 };

    const byFile = new Map();
    for (const entry of [...tsRun.diagnostics, ...scriptRun.diagnostics]) {
      byFile.set(path.resolve(entry.filePath), rulesOf(entry));
    }

    for (const f of [...tsFiles, ...scriptFiles]) {
      const rules = byFile.get(path.resolve(f.abs));
      if (!rules || !rules.has(f.rule)) {
        misses.push(`${f.name}：期望命中 ${f.rule}，实际命中 ${rules ? [...rules].join(", ") || "（无）" : "（文件不在输出里 —— 规则面没覆盖到样本目录）"}`);
      }
    }

    const cleanRules = byFile.get(path.resolve(cleanAbs));
    if (cleanRules && cleanRules.size > 0) {
      misses.push(`clean.ts（反向对照）不该有任何命中，实际：${[...cleanRules].join(", ")}`);
    }
    const noUndefRules = byFile.get(path.resolve(noUndefAbs));
    if (noUndefRules && noUndefRules.has("no-undef")) {
      misses.push("node-global.mjs（阴性对照）：no-undef 对 scripts 面是刻意关停的，不该命中");
    }

    const total = tsFiles.length + scriptFiles.length;
    if (misses.length > 0) {
      console.error(`[eslint-canary] ✗ ${misses.length}/${total} 条对照没守住：`);
      for (const m of misses) console.error(`  · ${m}`);
      console.error("[eslint-canary] 读数含义：上面的规则**现在不会拦下它本该拦的东西** —— 全仓 0 警不能当成「这些规则在工作」。");
      return 1;
    }
    console.log(`[eslint-canary] ✓ ${total} 条阳性对照全部命中 + 反向/阴性对照干净（samples=${total}）`);
    for (const f of [...tsFiles, ...scriptFiles]) console.log(`  · ${f.name} → ${f.rule}`);
    return 0;
  } finally {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 删不掉也要说清楚：残留样本会污染工作树与下一次 tsc */
        console.warn(`[eslint-canary] ⚠ 临时样本目录没删掉：${dir}`);
      }
    }
  }
}

process.exit(main());
