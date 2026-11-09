#!/usr/bin/env node
/**
 * lint 判决档位的**阳性对照**（ISSUE #2541 三批之后的补闸；#2777 PR-B 切到 oxlint）。
 *
 * 「全仓 0 警」是**状态**，不是**能力**：它也可能来自「规则根本没生效」
 * （#2541 的本质就是那样 —— 一批 core 规则报了 0 条，而它们一条都没跑过）。
 * 本脚本回答的是另一件事：**这些规则现在真的会拦下违例吗？**
 *
 * 做法：造一批**已知违例**的样本文件 → 用**本仓的判决配置**
 * （`oxlint.parity.config.mjs`，与 `pnpm run lint:oxlint` 逐字同一条）真跑一次
 * oxlint → 断言每条目标规则都命中；同时放一份**干净样本**做反向对照
 * （闸若空转/过宽，干净样本也会红，或违例样本一条都不红，两种都要被看出来）。
 * 另有一格按 message 对拍：判决配置 `options.reportUnusedDisableDirectives` 报出的
 * 死 disable 诊断没有 code 字段，用「造死豁免 / 删掉死豁免」一对样本判它真在工作。
 *
 * 为什么必须落真文件而不是 `--stdin`：样本要按配置的**文件类档位**解析
 * （`tests/**` 走 TS 面、`scripts/**` 走 scripts 的 js 面），`--stdin` 拿不到那份
 * 路径语义。样本写在仓库内的常规目录（`tests/` 与 `scripts/` 各一个临时目录，
 * 跑完 `finally` 里删掉），文件名**不能以点开头**。
 *
 * 自测口（**这条闸自己的阳性对照**）：`--sabotage <ruleId>` 会把那条规则临时
 * 关掉再跑一遍 —— 既然是「守住」的对照，关掉之后它**必须红**。恒绿的对照等于
 * 没有对照。闸门走 oxlint 的 CLI `-A <rule>` 覆盖（优先级最高），不落临时配置。
 *
 * 用法：
 *   node scripts/eslint-gate-canary.mjs                     0 = 闸全在；1 = 有闸没拦；2 = 没跑起来
 *   node scripts/eslint-gate-canary.mjs --sabotage <ruleId> 必须退 1（断言「它会红」）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OXLINT_BIN = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
const OXLINT_CONFIG = path.join(ROOT, "oxlint.parity.config.mjs");

/* 样本：dir 面 + 文件名 + 内容 + 期望命中的规则。
 * 每条都对应判决配置里**已经开着的**规则 —— 只钉「正在守的那几条」。 */
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
    name: "control-regex.ts",
    rule: "no-control-regex",
    src: "export const re = /\\x00/;\n",
  },
  /* ⚠️ 已知缺口（#2777 PR-B 实测）：`unicorn/no-useless-length-check` 在 oxlint
   * 1.90 里是**注册但空实现**的规则 —— 官方形态
   * （`if (xs.length > 0 && xs.every(...))` / `xs.length === 0 || xs.some(...)`）
   * 一条都不命中，所以这里不再放样本（放进来只会说「闸没守住」，而它确实是
   * 上游没实现）。缺口登记在 `log/tools/eslint-oxlint-parity.md` 的 PR-B 章。 */
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

/* 反向对照：干净样本**必须 0 命中**。 */
const CLEAN_TS = "export const add = (a: number, b: number): number => a + b;\n";
/* 正控 / 负控（ISSUE #3438）：同一份代码只差那行死 disable 注释 —— 有它必须报出
 * 未使用指令，删掉必须 0 命中。这类诊断在 oxlint 的 JSON 里只有 message、没有 code，
 * 所以不能并进下面按规则名对拍的样本表，另按 message 归集。 */
const DEAD_DISABLE_SRC = "// oxlint-disable-next-line no-debugger\nexport const a = 1;\n";
const REMOVED_DISABLE_SRC = "export const a = 1;\n";
const UNUSED_DISABLE_MESSAGE = "Unused oxlint-disable directive";
/* 阴性对照：`no-undef` 对 scripts 面是**刻意关停**的（scripts 在 tsc 的
 * checkJs 判决面里），它不许反过来把 Node 全局判出来 —— 关停要真的生效。 */
const NO_UNDEF_SRC = "export const home = process.env.HOME;\n";

let SABOTAGE = "";
/** `--sabotage` 用的临时配置路径（落在仓库根：jsPlugins 按配置所在目录解析）。 */
let SABOTAGE_CONFIG = "";
/**
 * 这一趟起了几次 oxlint —— **打出来**，由用例钉住次数（拆回去会多付一次冷启动）。
 */
let OXLINT_CALLS = 0;
if (process.argv.includes("--sabotage")) {
  SABOTAGE = process.argv[process.argv.indexOf("--sabotage") + 1] ?? "";
  if (!SABOTAGE) {
    console.error("[lint-canary] --sabotage 后面要跟一条规则名（关掉它之后这一格必须红）");
    process.exit(2);
  }
}

/**
 * 用判决配置真跑一次 oxlint（CLI 级，覆盖的就是门禁走的那一跳）。
 *
 * @param {readonly string[]} files 样本文件的绝对路径
 * @returns {{diagnostics: {filename: string, code?: string, message?: string}[], status: number | null}}
 */
function runOxlint(files) {
  OXLINT_CALLS += 1;
  const res = spawnSync(
    process.execPath,
    [OXLINT_BIN, "--config", SABOTAGE_CONFIG || OXLINT_CONFIG, "--format", "json", ...files],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) {
    throw new Error(`oxlint 起不来：${res.error.message}`);
  }
  const text = (res.stdout ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`oxlint 输出不是 JSON（退出码 ${res.status}）：${text.slice(0, 400)}`);
  }
  return { diagnostics: parsed.diagnostics ?? [], status: res.status };
}

/**
 * oxlint 的 JSON 里规则名是 `<plugin>(<rule>)` 形状（如 `eslint(no-control-regex)`、
 * `unicorn(prefer-string-starts-ends-with)`）。样本表用的是 eslint 的写法
 * （core 规则裸名、插件规则 `plugin/rule`），这里归一成同一套。
 *
 * @param {string | undefined} code
 * @returns {string | undefined}
 */
function normalizeRule(code) {
  if (typeof code !== "string") {
    return undefined;
  }
  const m = /^(?<plugin>\w+)\((?<rule>.+)\)$/.exec(code);
  if (!m) {
    return code;
  }
  const plugin = m.groups?.plugin ?? "";
  const rule = m.groups?.rule ?? "";
  /* oxlint 把「core / eslint 插件」都记成 `eslint(...)`；TS 插件记成 `typescript(...)`。 */
  return plugin === "eslint" ? rule : `${plugin}/${rule}`;
}

function main() {
  if (!fs.existsSync(OXLINT_BIN)) {
    console.error("[lint-canary] 拿不到 oxlint 入口 ⇒ 这一格没有结论（退 2）");
    return 2;
  }
  if (!fs.existsSync(OXLINT_CONFIG)) {
    console.error("[lint-canary] 拿不到判决配置 oxlint.parity.config.mjs ⇒ 退 2");
    return 2;
  }
  const stamp = `${process.pid}-${Date.now()}`;
  const tsDir = path.join(ROOT, "tests", `lint-canary-${stamp}`);
  const scriptsDir = path.join(ROOT, "scripts", `lint-canary-${stamp}`);
  const dirs = [tsDir, scriptsDir];
  const misses = [];

  try {
    if (SABOTAGE) {
      /* CLI 的 `-A <rule>` 在本仓的判决配置上实测**不生效**（配置里显式写死
       * severity 时 CLI allow 覆盖不过去）。改用临时配置：在仓库根 import 基准
       * 配置、追加一条关掉目标规则的 override —— 落点必须是仓库根，否则
       * `jsPlugins` 的包名从配置文件所在目录解析不到。跑完 `finally` 里删掉。 */
      SABOTAGE_CONFIG = path.join(ROOT, `oxlint.canary-sabotage-${stamp}.mjs`);
      fs.writeFileSync(
        SABOTAGE_CONFIG,
        [
          'import base from "./oxlint.parity.config.mjs";',
          `const OFF = ${JSON.stringify(SABOTAGE)};`,
          'export default { ...base, overrides: [...base.overrides, { files: ["tests/lint-canary-*/**", "scripts/lint-canary-*/**"], rules: { [OFF]: "off" } }] };',
          "",
        ].join("\n"),
        "utf8",
      );
    }
    const inTs = TS_SAMPLES.find((s) => s.rule === SABOTAGE);
    const inScripts = SCRIPTS_SAMPLES.find((s) => s.rule === SABOTAGE);
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
    const deadDisableAbs = path.join(tsDir, "dead-disable.ts");
    fs.writeFileSync(deadDisableAbs, DEAD_DISABLE_SRC, "utf8");
    const removedDisableAbs = path.join(tsDir, "removed-disable.ts");
    fs.writeFileSync(removedDisableAbs, REMOVED_DISABLE_SRC, "utf8");
    const noUndefAbs = path.join(scriptsDir, "node-global.mjs");
    fs.writeFileSync(noUndefAbs, NO_UNDEF_SRC, "utf8");

    const scriptFiles = [];
    for (const s of scriptSet) {
      const p = path.join(scriptsDir, s.name);
      fs.writeFileSync(p, s.src, "utf8");
      scriptFiles.push({ ...s, abs: p });
    }

    /* TS 面与 scripts 面**并成一次 oxlint 调用**：两批文件在判决配置里各按自己的
     * `overrides.files` 解析 —— 合成一次调用不改变任何一份文件的判定。 */
    const lintTargets = [
      ...tsFiles.map((f) => f.abs),
      ...(tsFiles.length ? [cleanAbs] : []),
      deadDisableAbs,
      removedDisableAbs,
      ...scriptFiles.map((f) => f.abs),
      ...(scriptFiles.length ? [noUndefAbs] : []),
    ];
    const run = lintTargets.length ? runOxlint(lintTargets) : { diagnostics: [], status: 0 };

    const byFile = new Map();
    /** @type {Map<string, string[]>} */
    const messagesByFile = new Map();
    for (const entry of run.diagnostics) {
      const abs = path.resolve(ROOT, entry.filename);
      const set = byFile.get(abs) ?? new Set();
      const rule = normalizeRule(entry.code);
      if (rule) {
        set.add(rule);
      }
      byFile.set(abs, set);
      if (typeof entry.message === "string") {
        const list = messagesByFile.get(abs) ?? [];
        list.push(entry.message);
        messagesByFile.set(abs, list);
      }
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

    /* 死 disable 正控 / 负控（ISSUE #3438）：这一族诊断没有 code，只按 message 归集。
     * 两份样本内容只差那行注释，读数可直接对拍。 */
    const deadMessages = messagesByFile.get(path.resolve(deadDisableAbs)) ?? [];
    if (!deadMessages.some((m) => m.includes(UNUSED_DISABLE_MESSAGE))) {
      misses.push(
        `dead-disable.ts（正控）：造的死 disable 指令没被报出来 ⇒ options.reportUnusedDisableDirectives 没生效或被摘掉（实际：${deadMessages.join(" | ") || "（无诊断）"}）`,
      );
    }
    const removedMessages = messagesByFile.get(path.resolve(removedDisableAbs)) ?? [];
    if (removedMessages.length > 0) {
      misses.push(
        `removed-disable.ts（负控）：删掉死豁免后不该有任何命中，实际：${removedMessages.join(" | ")}`,
      );
    }

    /* +2：上面那对按 message 对拍的正控 / 负控样本。 */
    const total = tsFiles.length + scriptFiles.length + 2;
    if (misses.length > 0) {
      console.error(`[lint-canary] ✗ ${misses.length}/${total} 条对照没守住：`);
      for (const m of misses) {
        console.error(`  · ${m}`);
      }
      console.error(
        `[lint-canary] 读数含义：上面的规则**现在不会拦下它本该拦的东西** —— 全仓 0 警不能当成「这些规则在工作」。（oxlint 调用 ${OXLINT_CALLS} 次）`,
      );
      return 1;
    }
    console.log(
      `[lint-canary] ✓ ${total} 条阳性对照全部命中 + 反向/阴性对照干净（samples=${total}，oxlint 调用 ${OXLINT_CALLS} 次）`,
    );
    for (const f of [...tsFiles, ...scriptFiles]) {
      console.log(`  · ${f.name} → ${f.rule}`);
    }
    console.log(
      `  · dead-disable.ts → ${UNUSED_DISABLE_MESSAGE}（正控）/ removed-disable.ts → 0 命中（负控）`,
    );
    return 0;
  } finally {
    if (SABOTAGE_CONFIG) {
      try {
        fs.rmSync(SABOTAGE_CONFIG, { force: true });
      } catch {
        console.warn(`[lint-canary] ⚠ 临时配置没删掉：${SABOTAGE_CONFIG}`);
      }
    }
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        console.warn(`[lint-canary] ⚠ 临时样本目录没删掉：${dir}`);
      }
    }
  }
}

process.exit(main());
