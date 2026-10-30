#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：脚本档（`**/*.mjs`）的 tsc 判决面棘轮（供 .githooks/pre-commit 与聚合档调用）
/**
 * `check-scripts-typecheck.cjs` —— **`scripts/**` 里那份「从没被 import 的脚本」的类型层执行者**
 * （ISSUE #2524 / 规范 `docs/standards/13-提交与-code-review.md` §13.5.14）。
 *
 * ## 立案现场：死代码躺在主干上，`tsc` 一个字都不报
 *
 * `scripts/ci-daily-build.mjs` 里躺着两处死声明（`ARTIFACT_TIMEOUT_MS` 被 import 却从未
 * 使用、`const HERE` 定义后从未使用），`pnpm exec tsc --noEmit` 在主干上**全绿**。它们
 * 之所以现形，只是因为 ISSUE #2503 新增的 `scripts/publish-desktop-bundle.mjs` 里写了
 * 一行 `import { runContext } from "./ci-daily-build.mjs"` —— **唯一变量是那行 import**。
 *
 * ## 根因：主配置的 include 里根本没有 `**\/*.mjs`
 *
 * `tsconfig.json` 开了 `allowJs` + `checkJs`，`include` 列的是 `**\/*.ts` / `**\/*.tsx` /
 * `**\/*.cjs` / `**\/*.js` —— **没有 `**\/*.mjs`**。于是 `.mjs` 进 program 只有一条路：
 * **被某个在场文件 import 到**。一份由 `package.json` / 钩子 / 平台直接 `node` 起来的
 * 入口脚本永远不会被 import ⇒ 它整个不在判决面上：类型错误、`noUnusedLocals` 那条
 * 「死代码」判据，全都到不了它。
 *
 * 实测（2026-10-28 本机，`tsc --noEmit --listFiles`）：磁盘上非点目录的 `.mjs` 共
 * **210** 份，program 里在场的 **169** 份 ⇒ **41 份从来不在判决面上**
 * （`scripts/**` 40 份 + `e2e/**` 1 份）。把这 41 份收进来之后当场量出 **320** 处存量红
 * （31 份文件，登记时的读数）；合并并行那批 #2585（scripts 的 84 条死代码逐条清零）之后
 * 重测 **310 处 / 29 份**，最大一类 167 处 `TS7006` 隐式 any 参数，而 `TS6133`（声明了
 * 没用到）**账上归零** —— 本单点名的那一类死代码，落地当天就没有存量了。另有一处是真故障：
 * `scripts/quality-gate.mjs` 有四条 `fail(...)` 调用而那个名字在本文件从未声明
 * （`TS2304`）—— 那四条失败路径运行期抛的是 `ReferenceError`，不是它想打的那句话。
 *
 * ## 范围口径（本单要的那一句）
 *
 * **脚本档的判决面 = `tsconfig.scripts.json` 展开出来的 `**\/*.mjs` 全量**（按 TS 的 glob
 * 语义不穿以点开头的目录），**不是**「被 import 可达的那一部分」；可达性只是主
 * `tsconfig.json` 那一档的**顺带结果**，从来不是谁的决定。存量按实测**登记**（下方棘轮
 * 基线，只降不升），当场清零不在这一批 —— 理由写在基线的 `note` 与那张逐单跟进的账上。
 *
 * ## 这一档判什么
 *
 *   ① **判决面自证**（三条，缺一即判红/没结论，见 `faceProblems()`）：
 *      盘上走一遍得到的 `.mjs` 集合 ⊆ 配置展开出来的集合 ⊆ tsc 实际报回来的
 *      `--listFiles` 集合，且配置展开的集合**非空**。这一条是本案的正对因：
 *      「覆盖面比它自称的小」这件事，除了拿两套独立算法对账之外没有别的机器读法。
 *   ② **存量红只降不升**：按 `(文件, TS 码)` 记账，任一格子涨了 ⇒ 红；基线里没有的
 *      文件 / 码 ⇒ 红（**新增脚本零容忍**：新写的 `.mjs` 必须干净，不能顺手扩基线）。
 *   ③ **`--update` 只许收紧**：任何一格上涨都拒绝重写（不是「总量降了就行」——
 *      那样一份新文件的红能被另一文件的下降 smuggle 过去，与 ISSUE #2227 那一族同形）。
 *   ④ **被截断的一跑不许报绿**：实测（2026-10-28）一份 `.mjs` 里写了一行 TS 类型注解
 *      （`TS8010`）之后，**整跑只打出那一行**，其余 319 处一个字都不报 —— tsc 报完
 *      语法层的错就不做语义检查。所以「当前比基线少」有两种成因，机器必须分得开：
 *      「修好了」与「没判」。这一格红，且**拒绝按被截断的读数重写基线**（那等于
 *      把棘轮清空）。`TS6133`（声明了没用到）**刻意不算截断** —— 它就是本案要抓的
 *      那一类死代码，把它归进「没判」等于把判据最想要的读数扔掉。
 *
 * ## 判据自己不许静默降级（§11.23.3 同款）
 *
 * tsc 起不来、`typescript` 没装、输出里一行都解析不出来、`--listFiles` 是空的 ——
 * 一律 **退 2（没结论）**，而不是「读到 0 处 ⇒ 绿」。本判据要拦的病就是
 * 「覆盖面塌了而账面全绿」，它自己的失效形态必须与那**不**同。
 *
 * ## 刻意不做
 *
 *   · **不改 tsc 的严格度**：`tsconfig.scripts.json` 只写 `include`，`compilerOptions`
 *     全部 `extends` 主配置 —— 脚本档与应用档必须是同一把尺。
 *   · **不判 `.cjs` / `.js`**：那两种扩展名**本来就在**主配置 `include` 里（实测 82 份
 *     `.cjs` 全部在场且为零红），本案只补 `.mjs` 那一格。
 *   · **不在这里修存量**：320 处逐条清是另一张单（`changelog.d/` 与本单评论里都留了
 *     按文件的读数）；本批只负责「面在全仓 + 不许涨 + 当场量得出」。
 *
 * 用法：
 *   node scripts/check-scripts-typecheck.cjs            # 检查（棘轮 + 判决面自证）
 *   node scripts/check-scripts-typecheck.cjs --report   # 只出逐文件读数，不判失败
 *   node scripts/check-scripts-typecheck.cjs --update   # 把基线收紧到当前实测（只许降）
 *   node scripts/check-scripts-typecheck.cjs --no-run   # 只做判决面对账，不起 tsc（量具自检用）
 *
 * 退出码：0 = 通过；1 = 阻断（新增 / 判决面漏件）；2 = 没结论（tsc 没跑起来、输出解析不出）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/**
 * 判决面的根 = 被测的那棵树。默认是本仓库；用例可以把它指向一棵**临时夹具仓库**
 * （`COMFY_SCRIPTS_TYPECHECK_ROOT`，口径与 `render-doc-placeholders.cjs` 的
 * `DOC_RENDER_ROOT` 同一条，ISSUE #2415：**判据的用例不写真仓库**）。
 *
 * ⚠️ 只有「被测的那棵树」跟着换，**工具本体不换**：`typescript` 与它的 `lib/tsc.js`
 * 一律从这份脚本自己的仓库里取（下一行那两份路径），否则临时目录旁边没有
 * `node_modules`，测出来的会是「tsc 没装」而不是判据的结论。
 */
const REPO = path.resolve(__dirname, "..");
const ROOT = process.env.COMFY_SCRIPTS_TYPECHECK_ROOT
  ? path.resolve(process.env.COMFY_SCRIPTS_TYPECHECK_ROOT)
  : REPO;
const CONFIG_REL = "tsconfig.scripts.json";
/* 基线落点跟着 ROOT 走：夹具那一档必须能自己写一份基线，才测得出「上涨被拒」这一支。
 * 真仓库里 `ROOT === REPO`，这一句取到的正是 `scripts/.scripts-typecheck-baseline.json`。 */
const BASELINE = path.join(ROOT, "scripts", ".scripts-typecheck-baseline.json");
const TSC_ENTRY = path.join(REPO, "node_modules", "typescript", "lib", "tsc.js");
const RULE_VERSION = 1;
const TAG = "[scripts-typecheck]";

const ARGS = new Set(process.argv.slice(2));

/* ── 判决面：两套独立枚举 ─────────────────────────────────────────── */

/**
 * 用 typescript 自己的 glob 引擎展开配置（`include` + 继承来的 `exclude`），
 * 得到「这份配置声称要判哪些 `.mjs`」。**不在这里抄第二份 exclude 名单** ——
 * 抄一份就会与配置分叉，而分叉的表現正是「判据以为自己在判全量」。
 *
 * @param {typeof import("typescript")} ts
 * @returns {{ok: true, mjs: string[], excludes: string[]} | {ok: false, reason: string}}
 */
function configFace(ts) {
  const read = ts.readConfigFile(path.join(ROOT, CONFIG_REL), ts.sys.readFile);
  if (read.error) {
    return {
      ok: false,
      reason: `读不到 ${CONFIG_REL}：${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`,
    };
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    ROOT,
    undefined,
    path.join(ROOT, CONFIG_REL),
  );
  const mjs = parsed.fileNames
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => path.relative(ROOT, f).replaceAll("\\", "/"))
    .sort();
  if (!mjs.length) {
    return {
      ok: false,
      reason: `${CONFIG_REL} 展开出来**一份 .mjs 都没有** —— 那是「include 空了」，不是「没有错误」`,
    };
  }
  return {
    ok: true,
    mjs,
    /* 原始 exclude（`readConfigFile` 已经把 JSONC 的注释剥掉了）。它只用来回答
     * 「盘上这一份没进面，是刻意排除的还是漏了」—— 抄的是配置自己那份，不另立名单。 */
    excludes: (read.config?.exclude ?? []).map((e) => String(e)),
  };
}

/**
 * 这份检出里**入库的** `.mjs` 清单；取不到时返回 `null`（=「没筛」，不是「都不算」）。
 *
 * 为什么需要它（ISSUE #2681）：`configFace()` 走的是 TS 的 glob 引擎，它看的是
 * 「这台机器的这个目录此刻有什么」，于是任何落在非点目录、非 exclude 里的构建产物
 * 都会进面 —— 平台那一跑实测就比入库清单多 1 份，而红只给「212 vs 210」两个数
 * （「差一份」有两种相反的修法：新加入库脚本没记账 vs 磁盘上多了一份没入库的产物）。
 * 账本记的是**这份提交**里有多少脚本，所以比对口径也该按这份算。
 *
 * 三条形状：
 *   · `git ls-files` 用 args 数组直起（不开 shell —— `shell:true` 既触发 DEP0190
 *     也不转义参数，见 #2572 那条判据守的东西）；
 *   · **只在这棵树的 git 顶层就是它时才筛**：用例会把 ROOT 指到临时夹具目录，
 *     而夹具可能恰好落在某个仓库里 —— 那时 `ls-files` 返回的是**别人那份**的清单，
 *     拿它筛会把整面筛空（表现是「判决面 0 份」，比不筛坏得多）。顶层对不上就返回 `null`；
 *   · 取不到（没装 git / 不是仓库 / 超时）一律 `null` —— 「取不到」不等于「没有」。
 *
 * @param {string} root 被测的那棵树
 * @returns {Set<string> | null} 相对路径（正斜杠）集合；取不到时 `null`
 */
function trackedMjs(root) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
  });
  if (top.status !== 0 || !String(top.stdout ?? "").trim()) return null;
  /* 比 realpath：Windows 上盘符大小写与 8.3 形态都会让字符串不同而目录相同。 */
  const same = (p) => {
    try {
      return fs.realpathSync(p).replace(/\\/g, "/").toLowerCase();
    } catch {
      return path.resolve(p).replace(/\\/g, "/").toLowerCase();
    }
  };
  if (same(String(top.stdout).trim()) !== same(root)) return null;
  const listed = spawnSync("git", ["ls-files", "-z", "--", "*.mjs"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0 || listed.error) return null;
  return new Set(
    String(listed.stdout ?? "")
      .split("\0")
      .filter(Boolean)
      .map((f) => f.replaceAll("\\", "/")),
  );
}

/**
 * 「配置展开的那一份」⇄「入库的那一份」的唯一一次求交。
 *
 * 判据与用例共用它 —— 账上的 `face` 与判据读到的面必须是同一个数，两处各写一遍
 * 就是两份口径（§12.12，而这次的漂移恰好会伪装成「面与账不符」那种红）。
 *
 * @param {string[]} mjs `configFace()` 展开的结果（相对路径、正斜杠、已排序）
 * @param {Set<string> | null} tracked `trackedMjs()` 的结果
 * @returns {{face: string[], untracked: string[], filtered: boolean}}
 */
function splitTrackedFace(mjs, tracked) {
  if (tracked === null) return { face: mjs, untracked: [], filtered: false };
  const face = [];
  /** @type {string[]} */
  const untracked = [];
  for (const f of mjs) (tracked.has(f) ? face : untracked).push(f);
  return { face, untracked, filtered: true };
}

/**
 * 独立走一遍盘：仓库里所有**非点目录**下的 `.mjs`。这是判据自己的「应该有多少」，
 * 与配置展开那一份对账才得出「面有没有漏」。
 *
 * 剪枝只按 TS 的 glob 语义那一条（`**\/` 不穿以点开头的目录）；`exclude` 那一侧
 * **拿配置里的原值**判「这份没进面是不是刻意的」。方向是不对称的：盘上有、配置里
 * 没有 ⇒ 只有落在 exclude 覆盖的顶层里才算说得通，其余一律算漏件（那正是本案的病：
 * 覆盖面自己缩了而账面没人念）。
 *
 * @param {string[]} configList 配置展开的那一份
 * @param {string[]} excludes 配置里的 exclude 原值
 */
function diskFace(configList, excludes = []) {
  const inConfig = new Set(configList);
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        walk(abs);
      } else if (e.isFile() && e.name.endsWith(".mjs")) {
        out.push(rel);
      }
    }
  };
  walk(ROOT);
  out.sort();
  const excludedTop = new Set(
    excludes.map((e) => String(e).replace(/^\*\*\//, "").split("/")[0]),
  );
  const missed = out.filter(
    (rel) => !inConfig.has(rel) && !excludedTop.has(rel.split("/")[0]),
  );
  return { all: out, missed };
}

/**
 * 判决面对账。返回问题清单；空数组 = 面是完整的。
 *
 * @param {{ok: true, mjs: string[], excludes: string[]} | {ok: false, reason: string}} cfg
 * @param {{listed: string[]}} ran tsc 实际报回来的 program 文件清单
 * @param {string[]} [face] 入库的那一份（第②问用它；第①问坚持用未筛的 `cfg.mjs` ——
 *        「include 有没有被改窄」是配置的问题，与磁盘上落了什么产物无关）
 */
function faceProblems(cfg, ran, face = cfg.ok ? cfg.mjs : []) {
  const problems = [];
  if (!cfg.ok) {
    return [cfg.reason];
  }
  const { missed } = diskFace(cfg.mjs, cfg.excludes);
  if (missed.length) {
    problems.push(
      `判决面漏了这些 .mjs（盘上有、配置没收到）：\n` +
        missed.map((f) => `    · ${f}`).join("\n") +
        `\n  要么 ${CONFIG_REL} 的 include 被改窄了，要么它落进了一个新的 exclude 条目`,
    );
  }
  if (ran.listed.length) {
    const listed = new Set(
      ran.listed
        .map((f) => path.relative(ROOT, f).replaceAll("\\", "/"))
        .filter(Boolean),
    );
    const notRun = face.filter((f) => !listed.has(f));
    if (notRun.length) {
      problems.push(
        `配置声称在判、tsc 却没报回来这些文件（⇒ 这一跑不可信）：\n` +
          notRun.slice(0, 10).map((f) => `    · ${f}`).join("\n") +
          (notRun.length > 10 ? `\n    · …共 ${notRun.length} 份` : ""),
      );
    }
  }
  return problems;
}

/* ── 跑 tsc 与解析 ───────────────────────────────────────────────── */

/**
 * 起一次 `tsc -p tsconfig.scripts.json`。命令形态与 `类型检查` 那一格一致（直接跑
 * 包真身的 `lib/tsc.js`）：`node_modules/.bin` 下的垫片在 Windows 上起不来是老坑，
 * 这里不重蹈。`--pretty false` 让每行都是可解析的 `path(line,col): error TSxxxx:`。
 *
 * @returns {{ok: true, code: number, output: string} | {ok: false, reason: string}}
 */
function runTsc() {
  if (!fs.existsSync(TSC_ENTRY)) {
    return {
      ok: false,
      reason: `跑不到 typescript 本体（缺 ${path.relative(ROOT, TSC_ENTRY)}）—— 先 pnpm install`,
    };
  }
  const r = spawnSync(
    process.execPath,
    [TSC_ENTRY, "-p", CONFIG_REL, "--noEmit", "--pretty", "false", "--listFiles"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.error) {
    return { ok: false, reason: `tsc 没跑起来：${r.error.message}` };
  }
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!output.trim()) {
    return {
      ok: false,
      reason: `tsc 一行输出都没有（退 ${r.status}）—— 空输出读不出「判过了」，不构成绿`,
    };
  }
  return { ok: true, code: r.status ?? 1, output };
}

const DIAG_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

/**
 * 把 tsc 的输出切成「诊断行」与 `--listFiles` 那一段。
 *
 * 顺序由 tsc 决定（诊断在前、文件清单在后），这里**不靠顺序**也能分：命中
 * `DIAG_RE` 的是诊断，其余是路径。解析不出一行诊断而 tsc 退非零 ⇒ 形状变了，
 * 那是判据自己该红，而不是「0 处存量」的绿。
 *
 * @param {string} output
 */
function parseOutput(output) {
  /** @type {{rel: string, code: string, line: number}[]} */
  const diags = [];
  /** @type {string[]} */
  const listed = [];
  let unparsed = 0;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = DIAG_RE.exec(line);
    if (m) {
      diags.push({
        rel: m[1].replaceAll("\\", "/"),
        code: m[4],
        line: Number(m[2]),
      });
      continue;
    }
    /* `--listFiles` 报的是绝对路径；其余散文行（比如 next 插件的提示）忽略并计数。 */
    if (path.isAbsolute(line.replace(/^"|"$/g, ""))) listed.push(line);
    else unparsed += 1;
  }
  return { diags, listed, unparsed };
}

/**
 * 按 `(文件, TS 码)` 归堆 —— 行号不进账本：加一行注释就会把所有格子错位，
 * 而行号对「谁多了一个新的类型错误」这个问题没有信息量。
 *
 * @param {{rel: string, code: string}[]} diags
 */
function tally(diags) {
  /** @type {Record<string, Record<string, number>>} */
  const files = {};
  for (const d of diags) {
    const rel = path.isAbsolute(d.rel)
      ? path.relative(ROOT, d.rel).replaceAll("\\", "/")
      : d.rel;
    files[rel] ??= {};
    files[rel][d.code] = (files[rel][d.code] ?? 0) + 1;
  }
  const total = diags.length;
  return { files, total };
}

/* ── 基线 ───────────────────────────────────────────────────────── */

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch (e) {
    return { __broken: `基线文件不是合法 JSON：${e.message}` };
  }
}

/**
 * @param {ReturnType<typeof tally>} cur
 * @param {number} faceSize
 */
function writeBaseline(cur, faceSize) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ruleVersion: RULE_VERSION,
    note:
      "脚本档（`tsconfig.scripts.json` 展开的 `**/*.mjs`）里 tsc 报出的存量红，按 `(文件, TS 码)` " +
      "记账的**棘轮**，只许降不许升（ISSUE #2524 / 规范 §13.5.14.1）。登记时实测 320 处 / 31 份；" +
      "合并并行那批 #2585（scripts 的 84 条死代码逐条清零）之后重测 310 处 / 29 份 —— 其中 " +
      "`TS6133`（声明了没用到）已被那一批当场清零、**账上 0 格**，所以本档从一开始就不给死代码留额度。" +
      "**剩下的已由 ISSUE #2589 按文件逐份清零，本档现在是空账**（`files` 为 `{}`、`total` 为 0）：" +
      "它不再登记任何「已知欠账」，任何一格出现都是新增 ⇒ 红。清账那一份一份的因果与凭据在 " +
      "ISSUE #2589 的批记录评论与提交信息（主语前缀「脚本档清账批」）里 —— 那里也是「为什么" +
      "当初不当场清零」那句话的出处：把「覆盖面收口」与「改动面最大的一次脚本重写」押进同一张单，" +
      "改动跑挂了会被读成「扩面这件事不该做」，两件事的结论再也分不开。读数由 " +
      "`pnpm check:scripts-types -- --report` 现算（`--report` 只念数；「账面高于实跑、请收紧」" +
      "那句在默认档里）。规则版本变了必须同步改脚本常数。",
    face: faceSize,
    total: cur.total,
    files: cur.files,
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/* ── main ─────────────────────────────────────────────────────────── */

/**
 * @typedef {{args?: Set<string>, update?: boolean, report?: boolean, noRun?: boolean,
 *   runTsc?: () => ({ok: true, code: number, output: string} | {ok: false, reason: string}),
 *   readBaseline?: () => unknown, writeBaseline?: (cur: object, face: number) => void}} CheckIo
 */

/**
 * @param {CheckIo} [io] 用例注入点（`runTsc` 与基线读写）；不传就是 CLI 那一档。
 *   有了它，「上涨要红」「被截断的一跑不许写基线」「面漏件要红」这三条都能在**不动
 *   真实工作区、不付 18 秒**的前提下跑真分支 —— 与 `render-doc-placeholders.cjs`
 *   把输入输出根注入到夹具上（ISSUE #2415）是同一条口径：**判据的用例不写真仓库**。
 */
function main(io = {}) {
  const args = io.args ?? ARGS;
  const isUpdate = io.update ?? args.has("--update");
  const isReport = io.report ?? args.has("--report");
  const noRun = io.noRun ?? args.has("--no-run");
  const run = io.runTsc ?? runTsc;
  const loadBase = io.readBaseline ?? readBaseline;
  const saveBase = io.writeBaseline ?? writeBaseline;

  /** @type {typeof import("typescript")} */
  let ts;
  try {
    ts = require("typescript");
  } catch (e) {
    console.error(`${TAG} ✗ 取不到 typescript（判决面对账要用它自己的 glob 引擎）：${e.message}`);
    return 2;
  }

  const cfg = configFace(ts);
  if (!cfg.ok) {
    console.error(`${TAG} ✗ ${cfg.reason}`);
    return 2;
  }
  /* 账上那个 `face` 记的是「**这份提交**里有多少脚本」，所以比对前先按入库清单求交
   * （ISSUE #2681：`configFace` 走磁盘 glob，平台上落进工作区的构建产物会把它顶大 1 份，
   * 而红只给「212 vs 210」两个数 —— 那份多出来的东西谁都没提交过，也就没人能据此行动）。
   * 求交只动「算不算进账/判不判它的红」这一半；「include 有没有被改窄」那条对账
   * （下面 `faceProblems` 的第①问）仍拿**未筛**的那一份 —— 它判的是配置，不是磁盘。 */
  const { face, untracked, filtered } = splitTrackedFace(cfg.mjs, trackedMjs(ROOT));
  console.log(
    `${TAG} 判决面：${CONFIG_REL} 展开 ${cfg.mjs.length} 份 .mjs（入库的 ${face.length} 份；脚本档全量，不是可达闭包）`,
  );
  if (!filtered) {
    /* 只有「这一棵树的 git 顶层不是它自己」才走到这里 —— 临时夹具那一档的形状。
     * 必须念出来：不筛 ⇒ 面 = 磁盘展开，此时「面 ⇄ 账」那条比对的口径与真仓库不同。 */
    console.log(
      `${TAG} （没按入库清单筛：这棵树不是它自己的 git 顶层 ⇒ 面 = 磁盘展开原值）`,
    );
  }
  if (untracked.length) {
    console.log(
      `${TAG} 面外未入库 ${untracked.length} 份（磁盘上有、git 清单里没有 ⇒ 不进账、` +
        `它们的红也不记账，但逐景点名）：\n` +
        untracked.map((f) => `    · ${f}`).join("\n"),
    );
  }

  const ran = noRun ? { ok: true, code: 0, output: "" } : run();
  if (!ran.ok) {
    console.error(`${TAG} ✗ ${ran.reason}`);
    return 2;
  }
  const parsed = noRun
    ? { diags: [], listed: cfg.mjs.map((f) => path.join(ROOT, f)), unparsed: 0 }
    : parseOutput(ran.output);
  const { diags, listed } = parsed;
  if (!listed.length) {
    console.error(
      `${TAG} ✗ 输出里没有 \`--listFiles\` 那一段（解析不出在场清单）—— 面没法自证，不算绿`,
    );
    return 2;
  }

  const problems = faceProblems(cfg, { listed }, face);
  if (problems.length) {
    console.error(`${TAG} ✗ 判决面不自证：\n  ` + problems.join("\n  "));
    return 1;
  }
  if (noRun) {
    console.log(
      `${TAG} 只做判决面对账（--no-run：没起 tsc，这一跑**不构成**「类型层过了」）`,
    );
    return 0;
  }

  /* 未入库那份的报错**不并进账**（否则一份没人提交的产物能凭空地涨棘轮），但念出来：
   * 「不判它」与「看不见它」是两句话 —— 后者会让下一次同类污染再次无名。 */
  const untrackedSet = new Set(untracked);
  const toRel = (f) =>
    path.isAbsolute(f) ? path.relative(ROOT, f).replaceAll("\\", "/") : f;
  const judged = diags.filter((d) => !untrackedSet.has(toRel(d.rel)));
  if (judged.length !== diags.length) {
    const offFace = new Map();
    for (const d of diags) {
      const rel = toRel(d.rel);
      if (!untrackedSet.has(rel)) continue;
      offFace.set(rel, (offFace.get(rel) ?? 0) + 1);
    }
    console.log(
      `${TAG} 面外读数（未入库，不记账）：${[...offFace]
        .map(([f, n]) => `${f} ${n} 处`)
        .join("、")}`,
    );
  }
  const cur = tally(judged);
  /* 语法 / 配置层的报错会让 tsc **收工**：实测（2026-10-28，拿一份带类型注解的 `.mjs`
   * 探针站在这一档上）整跑只打出一行 `TS8010`，其余 319 处**一个都不报** —— 不是它们
   * 没了，是语义检查那一跳根本没发生。少了这一格读数，「基线 320 → 当前 1」会被念成
   * 「你修好了 319 处」，而它真正的意思是「这一跑没判」。*/
  /* 只认**实测过的**两类，且严格限死在四位数段：`TS1xxx`（语法）与 `TS8xxx`
   * （JS 文件里写了 TS 语法）。两条例外都是踩出来的：
   *   · `TS18047` / `TS18048` 是 `strictNullChecks` 的**语义**报错（五位），把它们
   *     当成语法 ⇒ 一份干净的仓库会被自己判成「这一跑没判」（实测第一版就错在这里）；
   *   · `TS6133`（声明了没用到）**刻意不算截断** —— 它就是本案要抓的那一类死代码，
   *     把它归进「没判」等于把判据最想要的读数扔掉。 */
  const SYNTAX_CODE = /^(?:TS1\d{3}|TS8\d{3})$/;
  const masked = Object.entries(cur.files).flatMap(([f, codes]) =>
    Object.keys(codes)
      .filter((c) => SYNTAX_CODE.test(c))
      .map((c) => `${f} ${c}`),
  );
  console.log(
    `${TAG} 实跑：program 内 ${listed.length} 份文件，脚本档报错 ${cur.total} 处 / ${Object.keys(cur.files).length} 份文件`,
  );
  if (masked.length) {
    console.error(
      `${TAG} ✗ 这一跑里有语法 / 配置层的报错（${masked.slice(0, 5).join("、")}${masked.length > 5 ? ` 等 ${masked.length} 处` : ""}）——\n` +
        `${TAG}   tsc 报完这些就**不做语义检查**（实测），所以上面那份清单只是判决面 ${face.length} 份里的一部分，\n` +
        `${TAG}   少掉的格子是「没判」而不是「已修」。先把语法修掉再谈这一档的结论。`,
    );
  }

  if (isReport) {
    const rows = Object.entries(cur.files)
      .map(([f, codes]) => ({
        f,
        n: Object.values(codes).reduce((a, b) => a + b, 0),
        codes,
      }))
      .sort((a, b) => b.n - a.n);
    for (const r of rows) {
      const detail = Object.entries(r.codes)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${c}×${n}`)
        .join(" ");
      console.log(`  · ${String(r.n).padStart(4)}  ${r.f}  (${detail})`);
    }
    return 0;
  }

  const baseline = loadBase();
  if (baseline && baseline.__broken) {
    console.error(`${TAG} ✗ ${baseline.__broken}`);
    return 2;
  }

  if (isUpdate) {
    if (masked.length) {
      console.error(
        `${TAG} ✗ 拒绝 --update：这一跑被语法 / 配置层的报错**截断**了（见上面那行），\n` +
          `${TAG}   照它重写基线等于把「没判」的那几百格当成「已修」—— 棘轮会当场被清空。\n` +
          `${TAG}   先把语法报错修掉，再 --update。`,
      );
      return 1;
    }
    const grows = [];
    if (baseline && baseline.ruleVersion === RULE_VERSION) {
      for (const [rel, codes] of Object.entries(cur.files)) {
        for (const [code, n] of Object.entries(codes)) {
          const base = baseline.files?.[rel]?.[code] ?? 0;
          if (n > base) grows.push(`    · ${rel} ${code}: 基线 ${base} → 当前 ${n}`);
        }
      }
    }
    if (grows.length) {
      console.error(
        `${TAG} ✗ 拒绝 --update：棘轮只许降。下面这些格子比基线**多**（不是总量比较——\n` +
          `${TAG}   总量降了也可能夹带一份新文件的红，那正是要拦的方向）：\n` +
          grows.join("\n") +
          `\n${TAG}   先把它改掉，再跑 --update 把基线收紧到当前实测；确属判据变更（现为 ` +
          `${TAG}   ruleVersion=${RULE_VERSION}）才先改脚本里的常数，再跑 --update。`,
      );
      return 1;
    }
    saveBase(cur, face.length);
    console.log(
      `${TAG} 基线已重写：面 ${face.length} 份 / 存量 ${cur.total} 处 / ${Object.keys(cur.files).length} 份文件`,
    );
    return 0;
  }

  if (!baseline) {
    console.error(
      `${TAG} ✗ 基线未建立 —— 当前 ${cur.total} 处。先跑 node scripts/check-scripts-typecheck.cjs --update。`,
    );
    return 2;
  }
  if (baseline.ruleVersion !== RULE_VERSION) {
    console.error(
      `${TAG} ✗ 基线判据版本不一致（基线 v${baseline.ruleVersion} → 脚本 v${RULE_VERSION}）：\n` +
        `${TAG}   判据变了，旧数字不再是同一个量。请 --update（前提是新读数已审）。`,
    );
    return 1;
  }

  const grows = [];
  for (const [rel, codes] of Object.entries(cur.files)) {
    for (const [code, n] of Object.entries(codes)) {
      const base = baseline.files?.[rel]?.[code] ?? 0;
      if (n > base) {
        grows.push(
          `    · ${rel} ${code}: 基线 ${base} → 当前 ${n}（新增 ${n - base} 处）`,
        );
      }
    }
  }
  if (grows.length) {
    console.error(
      `${TAG} ✗ 脚本档新增类型错误 / 死代码（ISSUE #2524 / 规范 §13.5.14）：\n` +
        grows.join("\n") +
        `\n${TAG}   这一档的面是全量 \`**/*.mjs\`，**新写的脚本零容忍**（基线里没有的格子就是新增）。\n` +
        `${TAG}   修法是把它写干净（补 JSDoc 类型 / 加守卫 / 删死声明），**不许用 \`--update\`** 把\n` +
        `${TAG}   新增的格子登记成「已知」；确实改不动的，请单独立单、在评审里写清理由，\n` +
        `${TAG}   再由那张单决定怎么处理，而不是在这里抬账。`,
    );
    return 1;
  }

  const dropped = [];
  for (const [rel, codes] of Object.entries(baseline.files ?? {})) {
    for (const [code, base] of Object.entries(codes)) {
      const n = cur.files?.[rel]?.[code] ?? 0;
      if (n < base) dropped.push(`  ${rel} ${code}: ${base} → ${n}`);
    }
  }
  if (dropped.length && !masked.length) {
    console.log(
      `${TAG} 检测到 ${dropped.length} 格下降，请收紧基线：\n  ` +
        dropped.join("\n  ") +
        `\n  执行 node scripts/check-scripts-typecheck.cjs --update`,
    );
  }
  if (masked.length) {
    /* 走到这里说明那些语法报错的格子**都在基线里**（否则上面的 `grows` 已经拦下了），
     * 但这一跑的清单是不可信的 —— 不许报绿。 */
    console.error(`${TAG} ✗ 有语法层报错 ⇒ 这一跑的读数不完整，判红（没判 ≠ 绿，§13.6.2）`);
    return 1;
  }
  console.log(
    `${TAG} ✓ 判决面 ${face.length} 份 / 存量 ${cur.total} 处（基线 ${baseline.total}）`,
  );
  return 0;
}

/* 导出给用例与聚合档（单条脚本行为不变）。 */
module.exports = {
  main,
  configFace,
  trackedMjs,
  splitTrackedFace,
  diskFace,
  faceProblems,
  parseOutput,
  tally,
  runTsc,
  CONFIG_REL,
  BASELINE,
  RULE_VERSION,
};

if (require.main === module) process.exit(main());
