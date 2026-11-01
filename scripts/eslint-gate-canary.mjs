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
/**
 * 这一趟起了几次 eslint —— **打出来**，由用例钉住次数。
 *
 * 为什么一个内部计数要露面：这一格的全部墙钟都长在「冷启动次数」上（单次约 30s），
 * 而"把两批文件并成一次调用"这件事在功能测试里**看不出来** —— 拆回去照样全绿，
 * 只是每次提交多付 30~50s。读数不露面，就会有人在半年后把它拆回去而没人知道。
 */
let ESLINT_CALLS = 0;
if (process.argv.includes("--sabotage")) {
  SABOTAGE = process.argv[process.argv.indexOf("--sabotage") + 1] ?? "";
  if (!SABOTAGE) {
    console.error("[eslint-canary] --sabotage 后面要跟一条规则名（关掉它之后这一格必须红）");
    process.exit(2);
  }
}

/**
 * 用本仓配置真跑一次 eslint（CLI 级，不走 API —— 覆盖的就是门禁走的那一跳）。
 *
 * @param {readonly string[]} files 样本文件的绝对路径
 * @returns {{diagnostics: {filePath: string, messages?: readonly {ruleId?: string}[]}[], status: number | null}}
 */
function runEslint(files) {
  ESLINT_CALLS += 1;
  const cliRules = SABOTAGE ? ["--rule", JSON.stringify({ [SABOTAGE]: "off" })] : [];
  const res = spawnSync(
    process.execPath,
    [ESLINT_BIN, "--format", "json", "--no-warn-ignored", ...cliRules, ...files],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) {
    throw new Error(`eslint 起不来：${res.error.message}`);
  }
  const text = (res.stdout ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`eslint 输出不是 JSON（退出码 ${res.status}）：${text.slice(0, 400)}`);
  }
  return { diagnostics: parsed, status: res.status };
}

/**
 * @param {{messages?: readonly {ruleId?: string}[]} | undefined} entry
 * @returns {Set<string | undefined>}
 */
function rulesOf(entry) {
  return new Set((entry?.messages ?? []).map((m) => m?.ruleId).filter(Boolean));
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
     * eslint 每次调用的 project service 冷启动才是开销大头（单次约 30s，量具与
     * 那一轮 A/B 只记在 `changelog.d/2862-*`，别往这里抄第二份），多付一次冷启动
     * 会让这条判据变成「受影响用例」格的新重夹具。
     * 规则在样本里 ⇒ 只跑那一组（要它红）；不在样本里 ⇒ 只跑 TS 组第一条
     * （要它照旧绿，证明闸门不误伤）。 */
    const inTs = TS_SAMPLES.find((s) => s.rule === SABOTAGE);
    const inScripts = SCRIPTS_SAMPLES.find((s) => s.rule === SABOTAGE);
    /* noUncheckedIndexedAccess 下 `TS_SAMPLES[0]` 是 T|undefined —— 索引里的
     * 第一份样本是**常量表**写死的，取不到是这张表被掏空，那属于本脚本自身的
     * 故障（不该靠 `??` 静默降级），所以这里显式断言而不是再兜一层。 */
    const firstTs = /** @type {(typeof TS_SAMPLES)[number]} */ (TS_SAMPLES[0]);
    const tsSet = SABOTAGE ? [inTs ?? firstTs] : TS_SAMPLES;
    const scriptSet = SABOTAGE ? (inScripts ? SCRIPTS_SAMPLES : []) : SCRIPTS_SAMPLES;

    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }

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

    /* TS 面与 scripts 面**并成一次 eslint 调用**（ISSUE #2862）。
     * 为什么这值得一刀：这一格的开销大头是 eslint 每次调用的 project service 冷启动
     * （本机非并发实测单次 30~40s —— 原写法默认档要付两次），而两批文件在 flat config 里
     * 各按自己的 `files` 面解析 —— 合成一次调用**不改变任何一份文件的判定**，只省掉一次冷启动。
     * 两份对照的落点照旧：`clean.ts` 永远跟着 TS 面进（它今天就在这一支里），
     * `node-global.mjs` 只在 scripts 面非空时进（sabotage 打的是 TS 侧规则时 scripts 集是空的，
     * 原实现也是直接跳过那一跳 —— 逐字保持原语义，不顺手放宽也不顺手收窄）。 */
    const lintTargets = [
      ...tsFiles.map((f) => f.abs),
      ...(tsFiles.length ? [cleanAbs] : []),
      ...scriptFiles.map((f) => f.abs),
      ...(scriptFiles.length ? [noUndefAbs] : []),
    ];
    const run = lintTargets.length
      ? runEslint(lintTargets)
      : { diagnostics: [], status: 0, files: 0 };

    const byFile = new Map();
    for (const entry of run.diagnostics) {
      byFile.set(path.resolve(entry.filePath), rulesOf(entry));
    }

    for (const f of [...tsFiles, ...scriptFiles]) {
      const rules = byFile.get(path.resolve(f.abs));
      if (!rules?.has(f.rule)) {
        misses.push(
          `${f.name}：期望命中 ${f.rule}，实际命中 ${rules ? [...rules].join(", ") || "（无）" : "（文件不在输出里 —— 规则面没覆盖到样本目录）"}`,
        );
      }
    }

    const cleanRules = byFile.get(path.resolve(cleanAbs));
    if (cleanRules && cleanRules.size > 0) {
      misses.push(`clean.ts（反向对照）不该有任何命中，实际：${[...cleanRules].join(", ")}`);
    }
    const noUndefRules = byFile.get(path.resolve(noUndefAbs));
    if (noUndefRules?.has("no-undef")) {
      misses.push("node-global.mjs（阴性对照）：no-undef 对 scripts 面是刻意关停的，不该命中");
    }

    const total = tsFiles.length + scriptFiles.length;
    if (misses.length > 0) {
      console.error(`[eslint-canary] ✗ ${misses.length}/${total} 条对照没守住：`);
      for (const m of misses) {
        console.error(`  · ${m}`);
      }
      console.error(
        `[eslint-canary] 读数含义：上面的规则**现在不会拦下它本该拦的东西** —— 全仓 0 警不能当成「这些规则在工作」。（eslint 调用 ${ESLINT_CALLS} 次）`,
      );
      return 1;
    }
    console.log(
      `[eslint-canary] ✓ ${total} 条阳性对照全部命中 + 反向/阴性对照干净（samples=${total}，eslint 调用 ${ESLINT_CALLS} 次）`,
    );
    for (const f of [...tsFiles, ...scriptFiles]) {
      console.log(`  · ${f.name} → ${f.rule}`);
    }
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
