#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:API 文档生成与自检(由平台侧 .cnb.yml 每日档调用,ISSUE #2231/#2537)
/**
 * check-docs-api.cjs — API 文档（`docs/api/**`）的**生成 + 自检**判据（ISSUE #2231）。
 *
 * ── 这一版与上一版的差别，是判据的**对象**换了 ──────────────────────────────
 *
 * 上一版判的是「**提交进 git 的那份产物**与源同不同步」，形态是「重生成到临时目录 →
 * 三向比对 → 红了就地重生成、再判一次」（ISSUE #1981 的自动修档）。ISSUE #2231 的现场：
 * master 上那份产物与源差 9 处，而平台那一格**报绿** —— 因为它带 `--autofix`：它发现
 * 不一致后就地重生成、再判一次，第二次一致 ⇒ 退 0。「修好了」与「本来就对」在读数上
 * 完全同形 ⇒「git 里那份是陈旧的」这件事在 CI 上根本看不见。
 *
 * 处置：**产物不再进 git**（`docs/api/` 进 `.gitignore`，ISSUE #2231 定的方向）。
 * 于是「提交进 git 的那份」不存在了 ⇒「它与源同不同步」这个问题**没有对象** ⇒
 * 判据换成三件能答、且答得准的问题：
 *
 *   ① **跑得通** —— typedoc 按**产物**判成功（不是按退出码；见 `typedoc-run.mjs`）。
 *   ② **骨架齐全** —— 默认主题每一页都会引用的那几份在，且至少有一个模块页。
 *   ③ **可移植** —— 产物里没有本机（仓库根）的绝对路径。
 *
 * ── 为什么没有第四条「覆盖面」────────────────────────────────────────────────
 *
 * 模块页的**文件名由 doc tag 决定**（`@module`），不是由路径决定：实测
 * `src/lib/core/config.ts` 的页面叫 `core_config_—_配置的__类型契约…`，而同一批产物里
 * 还有 `comfyui_*` / `collections_*` / `sqlite-pragmas.html` 这些与入口根不同名的页面
 * ⇒「每个入口根至少一个落点」这件事**没有可机械判的形状**。硬写一条就是判据在自己
 * 骗自己（假红一出现，所有人立刻学会忽略它）。要判覆盖面就得重做 typedoc 的命名
 * 推导 —— 那是第二份会漂的实现（§12.12 / §12.18）。
 *
 * ── 「产物与源脱节」那一族没有被放过，只是换了主人 ─────────────────────────
 *
 *   · 「改了什么会让产物变」= **输入面** ⇒ `INPUT_RES` / `INPUT_GLOBS` 仍供判据自己的
 *     `--staged` 档与元测试使用。但输入面**不再按 `entryPoints` 算**（ISSUE #2537）：typedoc
 *     真正解析的是 TS 程序（`tsconfig.json` 展开的根 ∪ 沿 import 走到的文件），
 *     `entryPoints` 只决定渲染哪几页。面由 `scripts/docs-api-input-closure.mjs` 的
 *     `docsApiTriggerGlobs()` 从那份根派生，`tests/docs-api-input-closure.test.ts` 双向对账。
 *     ⚠️ 2026-11-05 起它**不再喂 PR/合并侧的 `ifModify`**：那一格已降到每日档、每跑必判
 *     （ISSUE #2537，见下面「执行者在哪」）。
 *   · 「产物本身过期」= **不存在了** —— 没有提交进 git 的产物，就没有「过期」这回事；
 *     每一轮生成的副本都是**这一轮**的（typedoc 的 `cleanOutputDir` 默认开 ⇒ 输出目录
 *     先被清空再写，上一轮的孤儿页面不可能留在里面；本判据把这条当成不变量来用，
 *     并检查 `typedoc.json` 没有把它关掉）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *
 *   `node scripts/check-docs-api.cjs`            生成一份并自检（默认档）
 *   `node scripts/check-docs-api.cjs --check`    同上（`--check` 是显式同义写法）
 *   `node scripts/check-docs-api.cjs --staged`   仅当暂存改动命中输入面才做（本地手跑用）
 *   退出码：0 通过；1 生成失败 / 自检不过。
 *
 * ⚠️ `--autofix` **不再被接受**：产物不进 git ⇒ 没有「自动修完再提交」的对象
 * （而那正是 #2231 让它在 CI 上失去意义的原因）。撞上它直接退 1 并说明为什么，
 * 而不是「静默忽略」—— 静默忽略一个旗标正是本仓最恨的那族（脚自称与实际不一致）。
 *
 * ── 执行者在哪（ISSUE #1975 改了执行者，ISSUE #2537 改了档位）─────────────────
 *
 * 它挂在 `.cnb.yml` 的「**每日 API 文档生成与自检**」那一格（每日档、全量档，每跑必判；
 * GA `.github/workflows/daily.yml` 的 01:00 schedule 与 CNB 的手动/API 口都跑它）。
 * **PR/合并侧不再即时判**：最晚次日 01:00 暴露，暴露窗口 ≤24h（实测：新输入面 98%
 * 触发率、CI 中位 40.9s、占 140.2s 串行流水线的 30.6%）。本地出口是
 * `pnpm run docs`（只生成、不自检）与 `pnpm docs:check`（生成 + 自检）—— 但**都不是
 * 任何一次提交的必经产物**：产物不进 git，本地跑不跑都不影响提交。
 * 口径与逐条实测见规范 §13.5.17 / §13.5.23。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

/* 输入面的唯一权威在 `docs-api-input-closure.mjs`（ISSUE #2537）：它按 tsconfig 的
 * 实际展开算 typedoc 的解析根。本文件只取它派生出的 glob / 正则，不手抄第二份面。
 * 该模块是 ESM，本文件是 CJS —— 用 Node 的同步 `require(esm)`（同仓
 * `check-allow-builds.cjs` 亦如此）。 */
const { docsApiTriggerGlobs } = require("./docs-api-input-closure.mjs");
/** glob → 正则**复用** `vitest-projects.cjs` 已导出的那一份（与平台侧同口径）。 */
const { globToRe } = require("./vitest-projects.cjs");

const OUT_REL = "docs/api";
const OUT_ABS = path.join(ROOT, OUT_REL);
const TAG = "[docs-api]";

/* 判决行（绿 / 没跑 / 红）走 `scripts/ci-log.mjs` 的三态出口（ISSUE #2506 的收口，
 * 同族判据早已迁过去）；中间读数（命中输入面 / typedoc 进度）走 `[info]` 一档 ——
 * 标签本身带色，而结论行按三态带色与色带，一屏里不必逐字读就知道哪一行是判决。
 * 这一格的 `[info]` 从前是裸 `console.log`，在平台日志里与「通过」同一种灰。 */
const { gateFail, gatePass, gateSkip } = require("./ci-log.mjs");
/** 中间读数：不是判决，但也不是噪音（`[info]` 标签在色带里认得出）。 */
const info = (text) => {
  console.log(`[info] ${text}`);
};

/**
 * **输入面** —— 改哪些文件可能改 `docs/api/**`（ISSUE #2537 重定义的，别按旧注释理解）。
 *
 * 上一版把面定义成「`typedoc.json` 的 `entryPoints` 三根 ∪ 沿它走的闭包叶子」。
 * 那个口径**系统性偏窄**：typedoc 渲染哪几页由 `entryPoints` 决定，但它**解析**的是
 * TS 程序 —— 程序根是 `tsconfig.json` 展开出的 `rootNames`，再沿 import 走到的一切
 * 文件（含 `.test.ts` 与 `.mjs`）都进程序。事故 #2528 就是这类：新增的
 * `scripts/publish-desktop-bundle.mjs` 不在三根、也不是 entryPoint，却被
 * `tests/publish-desktop-bundle.test.ts` import ⇒ 在程序里 ⇒ 它的 JSDoc 坏掉，运行
 * typedoc 那一格就红；而旧触发面里没有它 ⇒ **那一格根本没跑**（静默跳格）。
 *
 * 现在的面**从解析根派生**（`scripts/docs-api-input-closure.mjs` 的
 * `docsApiTriggerGlobs()`：tsconfig 展开 ∩ git 跟踪文件 → `dir/**` + 根级 `*.<ext>`，
 * 再加大类配置 `pnpm-lock.yaml`）。改 tsconfig / typedoc.json 的输入面，面自动跟；
 * 面被手工改窄 ⇒ 元测试红（`tests/docs-api-input-closure.test.ts`）。
 *
 * ⚠️ `ifModify` 的语义是「变更文件一个都不落在给定 glob 内 ⇒ 这步不执行」，
 * **判宽只会多跑几秒，判窄是漏判** —— 而漏判是静默的。产物面 `docs/api/**` 仍不在
 * 表里（产物不进 git，ISSUE #2231）。
 *
 * @type {readonly string[]}
 */
const INPUT_GLOBS = Object.freeze(docsApiTriggerGlobs(ROOT));

/** 同一张面的**正则形态**：由 glob 机械转换，不另写一份窄面（否则两份会漂）。 */
const INPUT_RES = Object.freeze(INPUT_GLOBS.map((g) => globToRe(g)));

/**
 * 产物必须有的那几份 —— **默认主题每一页都会引用**它们（默认主题的 `index.tsx`
 * 里那串 `<link rel="stylesheet" href="assets/style.css">` / `<script
 * src="assets/main.js">` / `assets/icons.js` / `assets/search.js` /
 * `assets/navigation.js`）。
 *
 * 缺任何一份 = 渲染器形态变了（换了主题 / 换了 typedoc 大版本 / `typedoc.json`
 * 写坏了）⇒ 那份副本读者打开就是坏的 ⇒ 判红。
 *
 * @type {readonly string[]}
 */
const SKELETON = [
  "index.html",
  "assets/style.css",
  "assets/main.js",
  "assets/icons.js",
  "assets/search.js",
  "assets/navigation.js",
];

/**
 * 暂存改动是否命中输入面。
 * @param {string[]} files 相对仓库根、正斜杠的文件清单
 * @returns {string[]} 命中的文件（空数组 = 不触发）
 */
function matchedInputs(files) {
  return files.filter((f) => INPUT_RES.some((re) => re.test(f)));
}

/** 读暂存区文件清单。 */
function stagedFiles() {
  /* `-c core.quotePath=false`：路径要原样（ISSUE #2272，机制见 `scripts/changed-scope.mjs`
   * 的文件头「口径 ④」）。 */
  const out = spawnSync("git", ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) {
    return [];
  }
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * 递归收集目录下所有文件（相对该目录的 posix 路径 → 绝对路径）。
 * 不穿符号链接：产物目录里若有人手放了一个指向别处的链接，跟着走会把无关文件
 * 算进产物（而产物面已经不在 git 里了，这类链接只可能来自本机的手动操作）。
 * @param {string} dir 绝对路径
 * @returns {Map<string, string>}
 */
function walk(dir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!fs.existsSync(dir)) {
    return out;
  }
  /** @param {string} cur 当前绝对路径 @param {string} rel 相对前缀 */
  const rec = (cur, rel) => {
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        continue;
      }
      if (ent.isDirectory()) {
        rec(abs, r);
      } else if (ent.isFile()) {
        out.set(r, abs);
      }
    }
  };
  rec(dir, "");
  return out;
}

/**
 * 生成一份 API 文档到 `docs/api/`。
 *
 * 实现住在 `scripts/typedoc-run.mjs`（与 `pnpm run docs` 同一份）：那里验的是产物
 * （`index.html` 的 mtime 是不是这一轮写的）、失败会重试、全失败才给 `ok:false`。
 * 本判据不再自己 `spawn` typedoc —— 自己起一份就等于把「退出码不可信」这个坑
 * 再挖一遍（见过「退出 0 + 日志写 html generated + 产物一个没更新」）。
 *
 * ⚠️ **输出目录会被 typedoc 自己清空**（`cleanOutputDir` 默认开，0.28.20 的
 * `Renderer.prepareOutputDirectory` 先 `rm -rf` 输出目录再写）⇒ 这一份副本里**只有
 * 这一轮产出的东西**，上一轮的孤儿页面不可能留在里面。本判据把这条当不变量用
 * （它据此不再判「多余」那一类），并检查 `typedoc.json` 没有把它关掉。
 *
 * @returns {Promise<{ok: boolean, reason: string, log: string, files: number}>}
 */
async function generate() {
  // CJS 里取 ESM 只能动态 import：跨平台逻辑一律 ESM（规范 §9.5），而本文件是被
  // `require` 的 .cjs（钩子与 `tests/check-docs-api.test.ts` 都按 CJS 引它）。
  const { runTypedoc } = await import("./typedoc-run.mjs");
  return runTypedoc({ root: ROOT, outDir: OUT_ABS });
}

/**
 * 读 `typedoc.json`（**唯一出处**：`scripts/docs-api-input-closure.mjs` 的
 * `typedocConfig()` —— 那份模块是「typedoc 的配置」的单一出处，它读、别的模块也读它）。
 *
 * @returns {Promise<Record<string, unknown>>} 解析不出时是空对象（不抛）
 */
async function loadTypedocConfig() {
  const { typedocConfig } = await import("./docs-api-input-closure.mjs");
  return typedocConfig(ROOT);
}

/**
 * 判产物「可用」：**骨架齐全** + **可移植** + **输出目录确实被清空过**。
 *
 * 三条各自的判据与理由：
 *
 *   · **骨架齐全** —— `SKELETON` 那几份是默认主题每一页都会引用的；缺了就是
 *     「渲染器形态变了」，读者打开是坏的。
 *   · **模块页至少一页** —— 一个模块页都没有 = 这份 API 文档没有内容（typedoc 跑通了
 *     却什么也没渲染出来，是存在的形态：入口 glob 写错、全部被 exclude 掉）。
 *   · **可移植** —— 产物里不该出现本机路径（Windows 与 POSIX 两种分隔符形态都查）。
 *     这不是洁癖：typedoc 的源码链接、搜索索引、面包屑里只要有一处烤进了本机路径，
 *     读者点开的就不是同一个东西，而这份副本是要给人读的。
 *   · **输出目录被清空过** —— `typedoc.json` 的 `cleanOutputDir` 关掉的话，上一轮的
 *     孤儿页面会留在这一轮里，于是「这份副本 = 这一轮的产物」这条不变量破了
 *     （typedoc 0.28.20 的 `cleanOutputDir` 默认是 `true`）。
 *
 * @param {string} outDir 产物目录（绝对路径）
 * @param {string} root 仓库根（判「可移植」时它就是「本机路径」的样本）
 * @param {Record<string, unknown>} typedocCfg `typedoc.json` 的解析结果
 * @returns {{problems: string[], files: number, modulePages: number}}
 */
function judgeProduct(outDir, root = ROOT, typedocCfg = {}) {
  /** @type {string[]} */
  const problems = [];
  const files = walk(outDir);

  for (const rel of SKELETON) {
    if (!files.has(rel)) {
      problems.push(`缺少骨架文件：${rel}`);
    }
  }

  let modulePages = 0;
  for (const rel of files.keys()) {
    if (rel.startsWith("modules/") && rel.endsWith(".html")) {
      modulePages += 1;
    }
  }
  if (modulePages === 0) {
    problems.push("产物里没有任何模块页（modules/ 下没有 .html）—— 这份 API 文档没有内容");
  }

  const needles = [root, root.replaceAll("\\", "/")].filter((n) => n !== "");
  for (const [rel, abs] of files) {
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (needles.some((n) => text.includes(n))) {
      problems.push(`产物里烤进了本机绝对路径（${rel}）—— 这份副本换台机器就不成立`);
      break;
    }
  }

  if (typedocCfg.cleanOutputDir === false) {
    problems.push(
      "typedoc.json 把 cleanOutputDir 关了 —— 输出目录不会被清空，上一轮的孤儿页面" +
        "会留在这一轮里，这份副本就不再是「这一轮的产物」",
    );
  }

  return { problems, files: files.size, modulePages };
}

/**
 * typedoc 收尾日志的**结论判读**（ISSUE #2444）：注释质量的红不许静默放行。
 *
 * typedoc 把 JSDoc 漂移（@param 对不上签名）、死链（{@link} 解析失败）、被引用却
 * 收不进文档的符号全记成 warning —— 退出 0、产物照出，于是它们曾经 61 条无账地
 * 漂着。typedoc 的退出码不可信，所以按**日志**判。总结行
 * 「Found … errors and … warnings」只在**有账可报**时才打（0/0 的干净收尾是
 * 「[info] html generated」一句带过）⇒ 两种干净形态都要认：总结行在场且为 0/0，
 * 或总结行缺席而 `html generated` 在场（证明读到的是一次真跑的尾巴）；两者都缺 =
 * 读不到结论，与「全是 warning」同罪。`[info]` / `[warning]` 标签带 ANSI 色，
 * 判读前先剥色。
 *
 * @param {string | undefined} log typedoc 的日志尾巴（原样，含 ANSI 色码）。
 *   声明可缺是因为 `runTypedoc()` 的 `log` 在**起不来**那一支（`typedoc not installed`）
 *   与其余失败支之间形态不一，而契约测试直接把 `log` 喂进来 —— 与
 *   `premerge-timing.mjs` 那批「外部数据按实测声明」同口径。
 * @returns {{problems: string[]}}
 */
function judgeTypedocTail(log) {
  const cleanLog = (log ?? "").replaceAll(/\u001b\[[0-9;]*m/g, "");
  const summary = /Found (?<errors>\d+) errors and (?<warnings>\d+) warnings/.exec(cleanLog);
  const generated = /\[info\] html generated/.test(cleanLog);
  if (summary) {
    const errors = Number(summary.groups?.errors ?? 0);
    const warnings = Number(summary.groups?.warnings ?? 0);
    if (errors > 0 || warnings > 0) {
      return {
        problems: [
          `typedoc 报了 ${errors} errors / ${warnings} warnings —— JSDoc 漂移、死链与收不进文档的符号不许静默漂（修法见 ISSUE #2444）`,
        ],
      };
    }
    return { problems: [] };
  }
  if (!generated) {
    return {
      problems: [
        "typedoc 的日志里既没有「Found … errors and … warnings」总结行、也没有「html generated」收尾 —— 读不到这一格结论与「全是 warning」同罪",
      ],
    };
  }
  return { problems: [] };
}

/** typedoc 生成失败时的取证与修法（话术与「退出码不可信」那条现场绑在一起）。 */
function reportTypedocFailure(reason, log) {
  /* 诊断（「退出码不可信」那条注 + typedoc 自己的日志）**打在上面**，判决扫一眼就在
   * 最后一行 —— 三态出口的规矩是「一条判决一行」，而这里给读者的第一动作是「先跑一遍
   * generate-api-docs.mjs 看真因」，所以 `hint` 跟着判决走。 */
  console.error(`${TAG} 注：typedoc 的退出码不可信 —— 退出 0 而产物一个没更新是见过的现场。`);
  if (log) {
    console.error(log);
  }
  gateFail("API 文档生成与自检", [reason], {
    subject: "docs/api/**",
    detail: "typedoc 生成失败（拿不到可用的产物）",
    hint: "先 node scripts/generate-api-docs.mjs 单独跑一遍看真因" + "（占用类失败等一等就过）。",
  });
}

async function main() {
  if (process.argv.includes("--autofix")) {
    console.error(`${TAG} ✗ --autofix 这一档已经不存在了。`);
    console.error(
      `${TAG} 原因（ISSUE #2231）：docs/api/** 产物不再进 git ⇒ 没有「自动修完再提交」的对象；`,
    );
    console.error(
      `${TAG} 而「自动修 + 再判」这个形状，正是让「产物陈旧」在 CI 上隐形的那一格（#2231 的现场）。`,
    );
    console.error(`${TAG} 现在这一格是「生成一份 + 自检」，判的是产物本身可不可用。`);
    process.exit(1);
  }

  const staged = process.argv.includes("--staged");
  if (staged) {
    const hits = matchedInputs(stagedFiles());
    if (!hits.length) {
      /* 「未触及输入面」是**这一轮没判**，不是「判过且干净」—— 三态里它是 `skip`
       * （判据的读数里带「按面未触及」时 `gatePass()` 也会自动降级，这里显式打）。 */
      gateSkip("API 文档生成与自检", "按面未触及：本次改动不在 typedoc 输入面里");
      return;
    }
    info(
      `命中输入面 ${hits.length} 个文件（${hits
        .slice(0, 3)
        .join(", ")}${hits.length > 3 ? ", …" : ""}），生成并自检中…`,
    );
  }

  const res = await generate();
  if (!res.ok) {
    reportTypedocFailure(res.reason, res.log);
    process.exit(1);
  }

  const verdict = judgeTypedocTail(res.log);
  if (verdict.problems.length > 0) {
    gateFail("API 文档生成与自检", verdict.problems, {
      subject: "docs/api/**",
      detail: "typedoc 的日志里读不到这一格的结论",
    });
    process.exit(1);
  }

  const typedocCfg = await loadTypedocConfig();
  const { problems, files, modulePages } = judgeProduct(OUT_ABS, ROOT, typedocCfg);
  if (problems.length > 0) {
    gateFail("API 文档生成与自检", problems, {
      subject: "docs/api/**",
      detail: `生成成功，但产物不可用（${problems.length} 处）`,
      hint: "产物不进 git ⇒ 没有「自动修完再提交」的对象；修的是生成侧（typedoc 配置 / 源文件的类型）。",
    });
    process.exit(1);
  }
  gatePass(
    "API 文档生成与自检",
    `已生成并自检通过：${files} 份产物（${modulePages} 个模块页）→ ${OUT_REL}/（不在 git 里）`,
    { subject: "docs/api/**" },
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${TAG} ✗ 判据自身异常：`, error);
    process.exit(1);
  });
}

module.exports = {
  INPUT_RES,
  INPUT_GLOBS,
  SKELETON,
  matchedInputs,
  walk,
  judgeProduct,
  judgeTypedocTail,
  OUT_REL,
};
