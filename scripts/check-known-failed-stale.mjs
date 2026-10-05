#!/usr/bin/env node
/**
 * check-known-failed-stale.mjs — 「已知基线失败登记过期」判据（ISSUE #1282，D 档）
 *
 * 补的是 `KNOWN_FAILED_FILES` 这张表的**纪律空档**：它的注释从第一天起就写着
 * 「修好立刻删」，而**没有任何东西在判「这条登记是不是已经过期」** —— 纪律停在
 * 纸面，全靠人记得。现场就是这张表自己：
 *
 * `tests/theme-dark-token-cascade.test.ts` 在 2026-10-05 被登记（登记词还写错了
 * 根因），而它的真因（判据白名单漏了 `--color-card` 这种拼法）从来没人回头修。
 * 登记期间该文件**另外 17 条已经绿了的断言**一并被从增量面摘掉（粒度是文件），
 * 且没有任何东西会说「这条登记已经没在挡任何东西了」。这正是规范 §11.12 反复
 * 点名的那一族：**比红更糟的是静默跳过 —— 红会挡住提交，静默跳过什么都不会说。**
 *
 * 判据两条腿，都不可省：
 *
 *   ① **登记项必须在磁盘上、且是 git 跟踪的文件**（免费、必判）。
 *      文件被删/改名/搬目录之后，登记就成了一个**永远不匹配任何东西**的字符串 ——
 *      排除项静默失效，而表面上一切正常。历史现场同族：`scripts/run-tests.ps1`
 *      从 `.ps1` 源码里正则解析这份清单，改一次写法就让排除项静默变成空数组
 *      （见 `quality-gate-shared.mjs` 文件头）。文本级登记表必须有这一问。
 *
 *   ② **登记项必须真的还红着**（真跑，只在清单非空时付）。这一条是「过期」的本体：
 *      一条登记之所以有资格存在，仅因为它复现得出别线的红。一旦它变绿（别线把它
 *      修好了）或压根不红了，「留着」就只是把整个文件从增量面摘掉而已。
 *      判法是把**清单里的文件**交给 vitest 跑一遍 —— 清单按定义只有个位数条目，
 *      所以代价 = 这几份文件的运行时间，不是全量（§13.5.8 的「跑多少由改动面决定」）。
 *
 * **为什么不判「登记词里的根因写得对不对」**：那是一句自然语言，无法观测。
 * 上一条现场里登记词就是错的（写成「产物里没有 `.bg-card` 规则」，实测规则一直在、
 * 是判据的白名单漏了第三种拼法）。机器判不了散文，但能判**结论**（它现在还红吗），
 * 而结论错了散文必然跟着错 —— 把可判的那一维判死，比给散文再加一份会过期的清单强。
 *
 * 触发面（§13.5.8 的口径：不给无关提交加时间）：
 *   · 清单为空 → 立刻返回 0。**这是常态**，所以绝大多数提交零耗时、零输出。
 *   · 清单非空 → 判 ①+②。这一档本来就该付：只要有人在用这张表，就该有人在判它
 *     有没有过期。
 *
 * 用法：
 *   node scripts/check-known-failed-stale.mjs             # 判据（供 pre-commit D 组）
 *   node scripts/check-known-failed-stale.mjs --list      # 只打印当前登记项
 *   node scripts/check-known-failed-stale.mjs --self-test # 自证「量具没坏」：造一条假红
 *                                                         # 验判据说「还红着」，再删掉
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  KNOWN_FAILED_CASES,
  KNOWN_FAILED_FILES,
} from "./quality-gate-shared.mjs";

/**
 * 登记项给人看的一行一句。
 * @param {import("./quality-gate-shared.mjs").KnownFailedCase[]} cases
 * @returns {string}
 */
function describeCases(cases) {
  return cases.map((c) => `${c.file} :: ${c.fullName}`).join(" / ");
}

/**
 * vitest JSON 结果的**执行证据**（见 `judgeStillFailing` 第 ② 问）。
 *
 * `assertions` 是每条断言的「全名 + 状态」，判「红的是不是**登记的**那一条」靠它
 * （少了它，把全名指到同文件里一条已绿的用例上照样通过）。
 * @typedef {{files: {name: string, status: string}[], numTotalTests: number, assertions: {file: string, status: string, fullName: string}[]}} Evidence
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 登记项的**存在性**判决（免费那一维）。
 *
 * 抽成纯函数是为了让用例能直接喂形状：判据的「输入」是登记表 + 「这个路径存不存在」，
 * 所以这里只依赖调用方注入的 `exists`，不去碰磁盘（同 `visual-gate.mjs` 的 `runGate`，
 * 先例见 ISSUE #1356：源码文本断言不是执行记录）。
 *
 * @param {import("./quality-gate-shared.mjs").KnownFailedCase[]} registered 登记表内容
 * @param {(rel: string) => boolean} exists 该仓库相对路径是否存在且被 git 跟踪
 * @returns {{exitCode: number, problems: string[]}} 判决
 */
export function checkRegistrations(registered, exists) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const c of registered) {
    const key = `${c.file} :: ${c.fullName}`;
    if (seen.has(key)) {
      problems.push(
        `${key} 在登记表里出现了两次 —— 重复登记说明有人顺手又加了一条。`,
      );
      continue;
    }
    seen.add(key);
    if (!exists(c.file)) {
      problems.push(
        `${c.file} 不存在（或被 git 忽略 / 未跟踪）—— 这条登记排除的用例在别的` +
          "检出上根本不在，等于一条只在提交者本机生效的静默失效。请删掉它，" +
          "或把路径改成文件现在的位置。",
      );
    }
  }
  return { exitCode: problems.length > 0 ? 1 : 0, problems };
}

/**
 * 「用例全名的存在性与唯一性」判决（ISSUE #1282 收尾，粒度收到用例）。
 *
 * 为什么**必须**判这两条：排除手段是 `vitest -t '<负前瞻正则>'`，而 `-t` 是一个
 * **全局**过滤器 —— 它不认识「这是哪个文件的用例」。于是：
 *
 *   ① 全名若在该文件里**找不到**（改名 / 挪进别的 describe / 拼错），模式匹配不到
 *      任何东西 ⇒ 登记不生效，那条红会继续挡提交（登记过期」的反面，但同样只能
 *      靠机器说）。
 *   ② 全名若不唯一（同一个全名在另一份文件里也有），那次运行会把那份文件里的
 *      **无关用例**一起静默跳过 —— 等于把一个静默失效换成另一个更难发现的静默
 *      失效，正是本判据要拦的那一类。
 *
 * 判法分两步，代价按登记项数量付（清单非空才走，见 `main`）：
 *
 *   1. **存在性**：`vitest list --json <out> --no-staticParse <登记的文件>`，拿
 *      **运行时**展开后的全名（`it.each` 的 `%s` 会展开成实际值）。用 vitest 自己
 *      的枚举而不是扫源码文本 —— 手写扫描器数不准（`describe` 链、跨行、参数化
 *      各是一种形态），而这条判据的全部价值就在于**准**。
 *   2. **唯一性**：候选文件 = `git grep -F -l '<叶子标题>'` 命中的测试文件（全名
 *      的其余部分由 `describe` 链拼出来，只有叶子标题在源码里是字面量）。再对
 *      候选**加上**登记文件跑一次 `vitest list --no-staticParse`，数整条全名在
 *      **几份文件**里出现。>1 即冲突。
 *
 * 前置条件（机器判，不靠自觉）：**用例标题必须是静态字面量**（叶子标题能在源码里
 * 被 `git grep` 到）。动态拼出来的标题扫不到候选，唯一性就没法判 —— 那种登记
 * 本来就该先把标题写成静态的。这一条由第 2 步的候选集为空判出来。
 *
 * @param {import("./quality-gate-shared.mjs").KnownFailedCase[]} registered
 * @param {(fullName: string) => string[]} leafCandidates 叶子标题 → 命中的测试文件（注入口）
 * @param {(files: string[]) => string[] | null} listFullNames 跑 `vitest list` 拿全名（注入口；null = 拿不到）
 * @returns {{exitCode: number, problems: string[]}}
 */
export function checkCaseNames(registered, leafCandidates, listFullNames) {
  /** @type {string[]} */
  const problems = [];
  for (const c of registered) {
    const leaf = leafOf(c.fullName);
    const candidates = leafCandidates(leaf);
    if (!candidates.includes(c.file)) {
      problems.push(
        `用例叶子标题「${leaf}」在登记的 ${c.file} 里找不到字面量 —— ` +
          "标题必须是**静态字面量**（动态拼出来的标题既扫不到候选，也没法判唯一性），" +
          "或全名拼错了（祖先标题与用例标题用 `\" > \"` 连接）。",
      );
      continue;
    }
    const others = candidates.filter((f) => f !== c.file);
    const names = listFullNames([c.file, ...others]);
    if (names === null) {
      problems.push(
        `拿不到 vitest 的用例枚举（\`vitest list --json --no-staticParse\`）—— ` +
          "没有执行证据就不许当通过处理（同本脚本第 ② 问的口径）。",
      );
      continue;
    }
    if (!names.includes(c.fullName)) {
      problems.push(
        `用例全名在 ${c.file} 的运行时枚举里不存在：「${c.fullName}」\n` +
          "        排查：用例被改名/挪进别的 describe，或全名拼错了。登记匹配不到" +
          "任何东西 ⇒ 排除不生效，那条红会继续挡提交。",
      );
      continue;
    }
    if (others.length > 0 && names.filter((n) => n === c.fullName).length > 1) {
      // `-t` 是全局过滤器，重名 = 另一份文件里的无关用例被一起静默跳过。
      problems.push(
        `用例全名「${c.fullName}」在同一次枚举里出现了多次（候选文件 ` +
          `${[c.file, ...others].join(" / ")}）—— \`-t\` 是全局过滤器，重名会把` +
          "另一份文件里的无关用例一起静默跳过（比红更糟）。改法：把这条用例的标题" +
          "改成全库唯一（它本来就是登记用的定位符）。",
      );
    }
  }
  return { exitCode: problems.length > 0 ? 1 : 0, problems };
}

/**
 * 全名的叶子标题（最后一段）。`" > "` 是 vitest `getFullName` 的默认分隔符；
 * 标题自身含 `" > "` 时取到的「叶子」会短一截，那种情况标题本就不适合当定位符。
 * @param {string} fullName
 * @returns {string}
 */
export function leafOf(fullName) {
  const parts = fullName.split(" > ");
  return parts[parts.length - 1] ?? fullName;
}

/**
 * 「哪些测试文件里出现过这个叶子标题字面量」——`git grep -F -l`，走 git 索引、很快。
 * @param {string} leaf
 * @returns {string[]}
 */
function grepLeaf(leaf) {
  const r = spawnSync(
    "git",
    ["grep", "-F", "-l", "--", leaf, "tests", "src"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 },
  );
  // `git grep` 无命中时 exit 1（不是错误）；别的非零才算拿不到读数。
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git grep 失败（exit ${r.status ?? "信号"}）`);
  }
  return String(r.stdout ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 跑 `vitest list --json <out> --no-staticParse <files>` 拿**运行时**展开的全名。
 * 拿不到（起不来 / 解析不了）返回 `null`（调用方据此判「没有执行证据」）。
 * @param {string[]} files
 * @returns {string[] | null}
 */
function listFullNames(files) {
  const out = path.join(ROOT, "node_modules", ".cache", "known-failed-list.json");
  fs.rmSync(out, { force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const entry = vitestEntry();
  const r = spawnSync(
    process.execPath,
    [entry, "list", "--json", out, "--no-staticParse", ...files],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20 },
  );
  if (r.error) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(out, "utf8"));
    if (!Array.isArray(raw)) return null;
    return raw.map((t) => t.name).filter((n) => typeof n === "string");
  } catch {
    return null;
  }
}

/**
 * 「这条登记还红着吗」的判决（真跑那一维）。
 *
 * **三问，顺序即优先级**：① 量具起没起来；② 有没有执行证据（真跑了几个用例）；
 * ③ 跑完的结论红不红。第 ② 问不可省：退出码同时承载「跑完且红」与「压根没跑」，
 * 只读它就会把后者读成前者（本脚本第一版就栽在这，见 `resultFile()` 的注释）。
 *
 * @param {import("./quality-gate-shared.mjs").KnownFailedCase[]} registered 登记表内容
 * @param {{status: number | null, stdout: string, stderr: string, error?: Error}} runResult
 *        「只跑这些文件」的 vitest 结果（由调用方注入，便于用例喂夹具）
 * @param {string} commandLine 回显给用户的那条真实命令
 * @param {Evidence | null} evidence vitest 写下的 JSON 结果（null = 没写出来 / 解析不了 = 没跑过）
 * @returns {{exitCode: number, problems: string[], failedFiles: string[]}} 判决
 */
export function judgeStillFailing(
  registered,
  runResult,
  commandLine,
  evidence,
) {
  /** @type {string[]} */
  const problems = [];
  if (runResult.error) {
    // 「命令没起来」与「跑完但非零退出」必须分开报（§13.5 同族：ISSUE #576 的形态）——
    // `status ?? 1` 只给一个退出码等于没说原因，而这里的退出码非零**恰好是期望值**
    // （登记项就该红），所以起不来会被误读成「判据通过」。这是本判据最容易骗过自己的位置。
    const errCode = /** @type {{code?: string}} */ (runResult.error).code;
    problems.push(
      `起 vitest 失败（${errCode ?? "UNKNOWN"}）：${runResult.error.message}\n` +
        `        实际命令：${commandLine}\n` +
        "        判据需要「登记项真的跑红」这个读数，量具都起不来时不许当通过处理。",
    );
    return { exitCode: 1, problems, failedFiles: [] };
  }

  // ② 执行证据：没有结果文件 / 里面 0 个用例 = 这场根本没跑。
  // 此时退出码非零是「命令坏了」而不是「用例红了」，绝不许当通过。
  const ranTests = evidence?.numTotalTests ?? 0;
  if (evidence === null || ranTests === 0) {
    problems.push(
      "拿不到执行证据：vitest 没有写出结果文件，或里面一条用例都没有 —— " +
        "说明这场压根没跑起来（参数/环境坏了），**不是**「登记项红了」。\n" +
        `        实际命令：${commandLine}\n` +
        "        退出码在这里同时承载两种事实（跑完且红 / 根本没跑），只读它会得到假绿。\n" +
        "        自查：node scripts/check-known-failed-stale.mjs --self-test（它造一条真红的探针）。",
    );
    return { exitCode: 1, problems, failedFiles: [] };
  }

  // ③ 跑完了，看结论。全绿 = 这张登记已经过期。
  if (runResult.status === 0) {
    problems.push(
      `登记项全部跑绿了（真跑了 ${ranTests} 条用例，0 失败）—— ` +
        "这张登记表**已经过期**：那条红已经修好，留着它只是把这几条用例从门禁面摘掉。\n" +
        "        规范 §11.12 第 3 条：既有失败被修复后，把该条登记从 `KNOWN_FAILED_CASES` 删除，\n" +
        "        让它回到门禁里被强制拦截，避免悄悄退化。\n" +
        `        修法：编辑 scripts/quality-gate-shared.mjs（${describeCases(registered)}），\n` +
        "        删掉已修好的条目；若列表清空，`KNOWN_FAILED_CASES` 应为空数组。",
    );
    return { exitCode: 1, problems, failedFiles: [] };
  }

  // ④ 红的是不是**登记的那一条**（不只是「这个文件里有红」）。
  // 少了这一问，把全名指到同文件里一条已绿的用例上照样能通过 —— 而那正是这套
  // 机制最要紧的读数：登记存在的唯一资格就是「这一条现在红着」。
  const failedNames = new Set(
    (evidence.assertions ?? [])
      .filter((a) => a.status === "failed")
      .map((a) => `${a.file} :: ${a.fullName}`),
  );
  /** @type {string[]} */
  const notRed = [];
  for (const c of registered) {
    if (!failedNames.has(`${c.file} :: ${c.fullName}`)) notRed.push(describeCase(c));
  }
  if (notRed.length > 0) {
    problems.push(
      `这些登记项**自己那条没红**（同文件里别的用例红不算）：\n` +
        notRed.map((l) => `          ${l}`).join("\n") +
        "\n        说明这条红已经修好（登记过期），或全名指的是一条绿的用例。\n" +
        "        规范 §11.12 第 3 条：修好后把该条登记从 `KNOWN_FAILED_CASES` 删除。",
    );
    return { exitCode: 1, problems, failedFiles: [] };
  }

  // 红着 = 登记有资格存在。顺带把「红的是哪几份文件」记进日志。
  const failed = (evidence.files ?? []).filter((f) => f.status === "failed");
  return { exitCode: 0, problems, failedFiles: failed.map((f) => f.name) };
}

/**
 * 一行一句（判据话术用）。
 * @param {import("./quality-gate-shared.mjs").KnownFailedCase} c
 * @returns {string}
 */
function describeCase(c) {
  return `${c.file} :: ${c.fullName}`;
}

/**
 * vitest 的 JSON 结果文件落点（**执行证据**，见 `judgeStillFailing` 的第 ② 问）。
 *
 * 为什么非要它：本判据要的读数是「跑完、且有一条红」，而**「跑完」与「没跑起来」
 * 都会给出非零退出码**。这台量具第一次自己就栽在这上面 —— 参数写了个 vitest 5
 * 已经删掉的 `--reporter=basic`，vitest 以 status 1 退出、一行用例都没跑，而判据
 * 把那个 1 读成了「登记项还红着」⇒ 一条假绿。这正是本脚本注释里警告过的那个坑
 * （「起不来会被误读成判据通过」），而当时的 `r.error` 守卫抓不到它：子进程**正常
 * 退出**了、只是退非零，`spawnSync` 不填 `error`。
 *
 * ⇒ 只有「有结果文件 + 文件里有用例」才算跑过。这一问必须来自 vitest 自己写下的
 * 结构化产物，不能来自退出码（退出码同时承载两种截然不同的事实）。
 */
function resultFile() {
  return path.join(ROOT, "node_modules", ".cache", "known-failed-stale.json");
}

/**
 * 读 vitest 写下的 JSON 结果。读不出（文件不在 / 不是 JSON）⇒ `null`，
 * 即「没有执行证据」（见 `judgeStillFailing` 第 ② 问）。
 * @returns {Evidence | null}
 */
function readEvidence() {
  try {
    /** @type {{testResults?: unknown, numTotalTests?: unknown}} */
    const raw = JSON.parse(fs.readFileSync(resultFile(), "utf8"));
    /** @type {{name: string, status: string, assertionResults?: {ancestorTitles?: string[], title: string, status: string}[]}[]} */
    const files = Array.isArray(raw.testResults)
      ? /** @type {typeof files} */ (raw.testResults)
      : [];
    return {
      files,
      numTotalTests:
        typeof raw.numTotalTests === "number" ? raw.numTotalTests : 0,
      // 每条断言的**全名 + 状态**：判「红的是不是登记的那一条」要靠它。
      // 全名按 vitest 的口径拼（`ancestorTitles` 与 `title` 用 `" > "` 连接），
      // 与 `-t` 匹配的 `fullTestName` 是同一个字符串。
      assertions: files.flatMap((f) =>
        (f.assertionResults ?? []).map((a) => ({
          file: relFromAbs(f.name),
          status: a.status,
          fullName: [...(a.ancestorTitles ?? []), a.title].join(" > "),
        })),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * vitest 的 JSON 报告里 `name` 是**绝对路径**，登记表用的是仓库相对路径 —— 换算一下
 * 才能对上（用 `path.relative`，别手拼 `ROOT + "/"`：Windows 上是反斜杠）。
 * @param {string} abs
 * @returns {string}
 */
function relFromAbs(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

/**
 * vitest 的 ESM 入口（经 `import.meta.resolve` 解析，不写死 `node_modules/vitest/…`）。
 *
 * pnpm 布局下真身在 `.pnpm/vitest@<ver>…/`、顶层只是链接；直拼路径会在某次版本
 * 升级后静默指向不存在的文件（同 `run-affected-tests.mjs` 的口径）。
 * @returns {string}
 */
function vitestEntry() {
  const pkg = import.meta.resolve("vitest/package.json");
  const bin = JSON.parse(fs.readFileSync(fileURLToPath(pkg), "utf8")).bin;
  const rel = typeof bin === "string" ? bin : bin.vitest;
  return fileURLToPath(new URL(rel, pkg));
}

/**
 * 只跑登记表里的文件。
 *
 * `--no-file-parallelism`：清单按定义只有个位数条目，并行省不下什么，而串行能让
 * 「红/绿」的归因确定（§11.13：判红先隔离重跑定性）。这一档量的正是「这些文件
 * 各自红不红」，杂音越少越好。
 *
 * @param {string[]} files 要跑的文件（用 `KNOWN_FAILED_FILES` 派生量，不是登记表本身）
 * @returns {{status: number | null, stdout: string, stderr: string, error?: Error, commandLine: string}}
 */
function runRegistered(files) {
  const entry = vitestEntry();
  const out = resultFile();
  // 先删旧结果：留在那儿的上一轮结果会被当成这一轮的执行证据 ⇒ 假读数。
  fs.rmSync(out, { force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [
    "run",
    "--no-file-parallelism",
    "--reporter=dot",
    "--reporter=json",
    "--outputFile.json",
    out,
    ...files,
  ];
  const commandLine = `${process.execPath} ${entry} ${args.join(" ")}`;
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ...(r.error ? { error: r.error } : {}),
    commandLine,
  };
}

/**
 * 该路径是否存在且被 git 跟踪（用 `git ls-files --error-unmatch` 一次问清）。
 *
 * 为什么不只用 `fs.existsSync`：「登记了但没提交」的文件在别人检出上不存在，
 * 于是这条排除项**只在提交者本机生效** —— 那是同一族的静默失效，且更难发现。
 * @param {string} rel
 * @returns {boolean}
 */
function isTracked(rel) {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", rel], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--list")) {
    if (KNOWN_FAILED_CASES.length === 0) console.log("（空）");
    else for (const line of describeCases(KNOWN_FAILED_CASES).split(" / ")) console.log(line);
    return 0;
  }

  if (argv.includes("--self-test")) {
    // 「量具没坏」：造一条必然红的假登记，确认判据①说它在、判据②说它还红着；
    // 再用一条必然绿的当对照组。缺这一步时，判据在「vitest 起不来」也会沉默地绿。
    const red = "tests/known-failed-stale-probe.test.ts";
    fs.writeFileSync(
      path.join(ROOT, red),
      'import { expect, it } from "vitest";\nit("probe", () => expect(1).toBe(2));\n',
      "utf8",
    );
    try {
      const r = runRegistered([red]);
      // 自证用的登记项：文件 + 那条真红用例的全名（`-t` 的口径是运行时全名，
      // 这里 `it("probe")` 在顶层 describe 之外 ⇒ 全名就是 `probe`）。
      const j = judgeStillFailing(
        [{ file: red, fullName: "probe", why: "自证探针" }],
        r,
        r.commandLine,
        readEvidence(),
      );
      const ok = j.exitCode === 0;
      console.log(
        ok
          ? "  [ok] 自证：一条真红的登记被判为「还红着」（量具没坏）"
          : `  ✗ 自证失败：真红的登记没被判成「还红着」（量具坏了）——\n${j.problems.join("\n")}`,
      );
      return ok ? 0 : 1;
    } finally {
      fs.rmSync(path.join(ROOT, red), { force: true });
    }
  }

  // 常态：清单为空 ⇒ 零耗时、零输出（§13.5.8：不给无关提交加时间）。
  if (KNOWN_FAILED_CASES.length === 0) {
    console.log("  [ok] KNOWN_FAILED_CASES 为空 —— 没有登记项会过期");
    return 0;
  }

  console.log(
    `[known-failed-stale] 清单非空（${KNOWN_FAILED_CASES.length} 项），判「登记有没有过期」：`,
  );

  const existence = checkRegistrations(KNOWN_FAILED_CASES, isTracked);
  for (const p of existence.problems) console.error(`  ✗ ${p}`);
  if (existence.exitCode !== 0) {
    console.error(
      "  [known-failed-stale] 登记表里有指向不存在文件的条目，先修这一层（真跑没有意义）。",
    );
    return 1;
  }
  console.log("  [ok] 每个登记项都指向一个被 git 跟踪的真实文件");

  const naming = checkCaseNames(KNOWN_FAILED_CASES, grepLeaf, listFullNames);
  for (const p of naming.problems) console.error(`  ✗ ${p}`);
  if (naming.exitCode !== 0) {
    console.error(
      "  [known-failed-stale] 登记项的全名对不上/不唯一，先修这一层（真跑没有意义）。",
    );
    return 1;
  }
  console.log(
    "  [ok] 每个登记项的全名都在它的文件里、且全库唯一（`-t` 是全局过滤器，这是前提）",
  );

  const result = runRegistered(KNOWN_FAILED_FILES);
  const judged = judgeStillFailing(
    KNOWN_FAILED_CASES,
    result,
    result.commandLine,
    readEvidence(),
  );
  if (judged.exitCode !== 0) {
    // 把 vitest 的真实输出带出来：判据说「全绿」时，读的人需要能自己确认那不是
    // 「一条都没跑到」。只打结论等于把人挡在证据外面（同 §11.13 的复算要求）。
    const tail = (result.stdout + result.stderr)
      .split(/\r?\n/)
      .slice(-25)
      .join("\n");
    console.error(`  ✗ ${judged.problems.join("\n")}`);
    console.error(
      `  ── vitest 输出（末 25 行，命令：${result.commandLine}）──`,
    );
    console.error(tail);
    return 1;
  }

  console.log(
    `  [ok] ${judged.failedFiles.length} 份文件红着（登记项确实复现得出红，不是过期登记）`,
  );
  return 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
