/**
 * 「这台构建机**能不能把这条流水线跑完**」的环境前提探针（ISSUE #1959）。
 *
 * ## 它补的是哪一格
 *
 * 流水线里已经有两步在最便宜的位置回答**缺件**（`工具链自证` / `Python 可用性`），
 * 而那两步答的都是**「命令在不在、起不起得来」**。本文件答的是它旁边的两格：
 *
 *   ① **在，但版本不对**——解释器够不着 Python 3.10，而门禁的 Python 侧与 E2E 的
 *      假 comfy-cli 都要它（本仓写明的唯一下限就是 3.10，
 *      `scripts/setup-comfy-cli-venv.ps1`）；
 *   ② **配错了**——`.cnb.yml` 里有 host 侧 PowerShell 认不了的语法面（`?.` / `??`
 *      是 pwsh 7 才有的），它们**不会在解析期报错**，只会在跑到那一步时整段炸。
 *
 * 两格有一个共同的形态，也正是用户那一句诉求的落点：**它们红得晚**。第 ① 格红在
 * 「单元测试」里那几条用例上（而它们按既有口径走 `env` 档跳过、**不会红**
 * ——缺件在日志里是隐身的），第 ② 格红在 `Install dependencies`（把它前面的预算
 * 白花掉之后）。而两格都**只要几秒**就能问出来。
 *
 * ## 与兄弟脚本的边界
 *
 *   · `ci-toolchain-selfcheck.mjs`         —— 「四件工具在不在」（缺件即非零退出）
 *   · `ci-toolchain-python.mjs`            —— 「哪个解释器能跑、弄不到时怎么弄到手」
 *   · `ci-toolchain-browser.mjs`           —— 「浏览器在不在、弄不到时怎么弄到手」
 *   · **本文件**                            —— 「在的那几件**版本够不够**」
 *                                             + 「配置**配错了没有**」
 *
 * 判据不重写：解释器怎么找走 `findPython()`（同一份候选表、同一个探针，§12.18），
 * 配置怎么解析复用 `tests/no-platform-ci-config.test.ts` 导出那一份（本地钩子与平台
 * 侧同一条判据，不造第二轮子）。本文件只负责**在流水线最前把它们跑一遍并给结论**。
 *
 * ## 为什么它是 `.mjs` 而不是 `node --test` 的一层
 *
 * 它要在流水线第二/三步上跑，那时 `node_modules` **还没有**（`Install dependencies`
 * 在它后面）—— 所以它必须只 import `node:*` 与仓内那两个同样「只 import `node:*`」的
 * `.mjs`，不能 import 任何依赖包、也不能 import `src/**`。
 * `tests/no-platform-ci-config.test.ts` 是 `.ts`，这里 import 不了 —— 那一段是
 * **文本解析**（正则 + 逐行扫），所以按仓里既有的口径收成两份文本副本（与
 * `check-app-port-vectors.cjs` ⇄ `python-candidates.ts` 同一处置），由用例逐项对账。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { findPython } from "./ci-toolchain-python.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根 —— 本脚本住在 `scripts/` 下。 */
export const ROOT = path.resolve(HERE, "..");

/**
 * `.cnb.yml` 里 host 侧 PowerShell **不认**的语法面 —— 与
 * `tests/no-platform-ci-config.test.ts` 的 `PS7_ONLY` **逐项同一份**（两份文本副本，
 * 由用例对账；`?.` / `??` 是实测过的两种：宿主是节点上的 `powershell` 5.1，
 * 而它解析不了这些，整段当场报错）。
 *
 * ⚠️ 两处的**报告面**刻意不同：那一条判据跑在开发机上、点的是**行号**（给人改配置用），
 * 这一份跑在构建机上、点的是**这一档的结论**（给日志读的人用）。判据本身（哪些算
 * 命中的写法）一字不差 —— 那才是「一处定义」要守的东西。
 */
export const PS7_ONLY_SYNTAX = [
  {
    pattern: /\?\./,
    what: "空条件运算符 `?.`",
    instead: "显式 `if ($x) { … }`",
  },
  {
    pattern: /\?\?/,
    what: "空合并运算符 `??`",
    instead: "显式 `if ($x) { … } else { … }`",
  },
  { pattern: /::new\(/, what: "静态构造 `::new(`", instead: "`New-Object`" },
  {
    pattern: /-AsHashtable\b/,
    what: "`-AsHashtable`",
    instead: "`ConvertFrom-Json` 后自行建表",
  },
];

/**
 * 逐行扫 `.cnb.yml` 的 `script: |` 块，找出 host 侧 PowerShell 认不了的写法。
 *
 * 按**缩进**收口（块内的正文比 `script:` 那一行更深；出现不比正文深的非空行 = 块结束），
 * 并先剥行内注释 —— 两件都是实测出来的：不按缩进收口会把块外的同形文本算进来，
 * 不剥注释会把**正当地写着 `?.` 的说明注释**判成违规（配置里那条 ⚠️ 就是这种）。
 *
 * 扫的**只有** `script: |` 块：`env:` 的值不经过 shell，`name:` / `timeout:` 更不是
 * 代码。判过了头等于把这条判据变成噪音。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} 人读的违规行（含行号与替代写法）；空数组 = 干净
 */
export function ps7OnlySyntaxIn(text) {
  /** @type {string[]} */
  const found = [];
  let inScript = false;
  /** 正文的首行缩进 —— 块结束由它判（`null` = 还没进正文） */
  /** @type {number | null} */
  let bodyIndent = null;
  const lines = String(text ?? "").split("\n");
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (/^\s*script:\s*\|/.test(raw)) {
      inScript = true;
      bodyIndent = null;
      return;
    }
    if (!inScript) return;
    if (trimmed === "") return;
    const indent = raw.length - raw.trimStart().length;
    if (bodyIndent === null) {
      if (indent === 0) {
        inScript = false;
        return;
      }
      bodyIndent = indent;
    } else if (indent < bodyIndent) {
      inScript = false;
      bodyIndent = null;
      return;
    }
    const code = raw.replace(/#.*$/, "");
    for (const { pattern, what, instead } of PS7_ONLY_SYNTAX) {
      if (pattern.test(code)) {
        found.push(`第 ${i + 1} 行：${what}（改用 ${instead}）`);
      }
    }
  });
  return found;
}

/**
 * 本仓写明的解释器下限 —— **Python 3.10**（`scripts/setup-comfy-cli-venv.ps1` 的
 * 「未找到解释器」提示里那一句，也是本仓唯一写明下限的地方）。
 *
 * 为什么这条下限要在流水线上判：版本不够时**没有任何一步会红** ——
 * `check-app-port-vectors.cjs` 探到解释器就把它拉进四侧比对（3.9 上那些纯函数语法
 * 直接 `SyntaxError`，报出来的是一句看不懂的 Python 栈）、那几条真跑的用例按既有口径
 * 走 `env` 档跳过并登记。也就是说「版本不对」与「装好了」在日志里**逐字同形**，
 * 而处置完全不同（去看那一步为什么失败 vs 什么都不用做）。
 */
export const PYTHON_MIN_VERSION = /** @type {[number, number]} */ ([3, 10]);

/** `PYTHON_MIN_VERSION` 的可读写法（话术里不许另抄一份数字）。 */
export const PYTHON_MIN_TEXT = `${PYTHON_MIN_VERSION[0]}.${PYTHON_MIN_VERSION[1]}`;

/**
 * 版本三元组比大小（`a < b` 为负）；解析不出时回 `null`（**不猜**）。
 *
 * @param {string} text 形如 `Python 3.12.2` 的输出
 * @returns {number[] | null}
 */
export function parseVersionTriple(text) {
  /* 大版本可以单写（`3` / `Python 3`）—— 缺的那几段按 0 算，与
   * `ci-toolchain-selfcheck.mjs` 的 `cmpVersion` 同口径。 */
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text ?? ""));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * 这个版本够不够本仓的下限。
 *
 * @param {string} text 版本输出原文
 * @returns {{ok: boolean, triple: number[] | null}}
 *          `triple: null` = **解析不出**（那是「不知道」，不是「不达标」——
 *          与 `ci-toolchain-python.mjs` 里「没量到 ≠ 不合格」同一口径）
 */
export function pythonVersionMeetsFloor(text) {
  const triple = parseVersionTriple(text);
  if (!triple) return { ok: false, triple: null };
  const [maj, min] = PYTHON_MIN_VERSION;
  const [major = 0, minor = 0] = triple;
  return { ok: major > maj || (major === maj && minor >= min), triple };
}

/**
 * `.cnb.yml` 的原文（读不到时回 `null` —— 调用方据它判红，不静默跳过）。
 *
 * @param {string} [root]
 * @returns {string | null}
 */
export function readPipelineConfig(root = ROOT) {
  return readTextFile(path.join(root, ".cnb.yml"));
}

/**
 * 读文本文件（读不到回 `null`；判据按「读不到 = 那一条没在判」处置）。
 *
 * @param {string} file
 * @returns {string | null}
 */
export function readTextFile(file) {
  try {
    /* 只走 `node:fs` 的同步读（本文件刻意不引任何依赖包，见文件头）。 */
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * 跑一条命令拿输出（`ok` 判退出码为 0）。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ok: boolean, out: string}}
 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return {
    ok: r.status === 0 && !r.error,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
  };
}

/**
 * 探针主体 —— 在**任何依赖安装之前**回答「这台机器能不能把这条流水线跑完」。
 *
 * 出口（`0` / `1`）与兄弟步骤同形：缺前提即非零退出。**范围刻意不扩**：这里只判
 * 「在的那几件版本够不够」与「配置有没有配错」，缺件（命令根本不在）那一半由
 * `工具链自证` / `Python 可用性` 答，重复判一遍只会让日志里多一份要同步的话术。
 *
 * @param {{
 *   root?: string,
 *   config?: string | null,
 *   findPythonImpl?: typeof findPython,
 *   runImpl?: (cmd: string, args: string[]) => {ok: boolean, out: string},
 *   log?: (line: string) => void,
 *   logError?: (line: string) => void,
 * }} [ports]
 * @returns {number} 退出码
 */
export function envProbe({
  root = ROOT,
  /* 配置文本的**注入面**：缺省按 `root` 读盘，用例据此判「命中了会怎样」而
   * 不必造一个真仓库（与 `findPythonImpl` / `runImpl` 同一处置）。 */
  config = undefined,
  findPythonImpl = findPython,
  runImpl = run,
  log = console.log,
  logError = console.error,
} = {}) {
  /** 缺前提的条目（非零退出的依据）。 */
  const problems = [];
  /** 只是读数的条目（打印，不放行也不拦）。 */
  const notes = [];

  /* ── ① 配置的语法面：`.cnb.yml` 里 host 侧 PowerShell 认不了的东西 ──
   *
   * 这一条排在最前，因为它是**这一步唯一能在解析期断言的**：写错的那段是流水线自己
   * 的配置，一旦命中，跑到那一步时整段当场报错（平台读到的是一句
   * 「表达式或语句中包含意外的标记」，而红的位置是**几十步之后**）。 */
  const configText = config === undefined ? readPipelineConfig(root) : config;
  if (configText === null) {
    problems.push(
      `读不到仓库根的 .cnb.yml（root=${root}）—— 这一步判的是那份配置的语法面，` +
        "读不到就等于它一条都没判。",
    );
  } else {
    const bad = ps7OnlySyntaxIn(configText);
    if (bad.length > 0) {
      problems.push(
        "`.cnb.yml` 里有宿主的 Windows PowerShell（5.1）认不了的语法面：\n" +
          bad.map((l) => `      ${l}`).join("\n") +
          "\n      —— 它们**不会在解析期报错**，只会在跑到那一步时整段炸。" +
          "宿主是节点上的默认 powershell（pwsh 7 才认 `?.` / `??`）。",
      );
    } else {
      notes.push("`.cnb.yml` 的 script 块只用宿主 PowerShell 认的语法面");
    }
  }

  /* ── ② 解释器的**版本**（不是在不在 —— 那一格归 `Python 可用性`）── */
  let python = null;
  try {
    python = findPythonImpl();
  } catch {
    /* 探测本身出错时**不是这一条要答的问题**（那一格同样归 `Python 可用性`），
     * 如实记一条读数、不判红 —— 本步骤不做「探测失败」的第二份判据。 */
    notes.push(
      "解释器探测本身出错：本步不判它（缺件与探测失败归「Python 可用性」）",
    );
  }
  if (python) {
    const floor = pythonVersionMeetsFloor(python.version);
    if (floor.triple === null) {
      notes.push(
        `解释器 ${python.path ?? python.command} 的版本号解析不出（原文：` +
          `${python.version}）—— 本步不据此判红（那是「不知道」，不是「不达标」）`,
      );
    } else if (!floor.ok) {
      problems.push(
        `解释器 ${python.path ?? python.command} 是 ${floor.triple.join(".")}，` +
          `低于本仓写明的下限 Python ${PYTHON_MIN_TEXT}（scripts/setup-comfy-cli-venv.ps1）。\n` +
          "      它**不会让哪一步变红**：门禁的 Python 侧会以「探测不到」的名义退出比对、" +
          "几条真跑的用例走 `env` 档跳过并登记 —— 与「装好了」在日志里逐字同形。\n" +
          `      下一动作：在这台节点上装一个 ≥ ${PYTHON_MIN_TEXT} 的解释器并让构建账号的 ` +
          "PATH 看得见它（python.org 安装包勾「Add python.exe to PATH」；" +
          "默认的「Install for me only」只写安装者那个用户）。",
      );
    } else {
      notes.push(
        `解释器 ${python.path ?? python.command} ${floor.triple.join(".")} ` +
          `满足 ≥ ${PYTHON_MIN_TEXT}`,
      );
    }
  } else {
    notes.push(
      "这台机器上没有可用解释器：缺件那一格归「Python 可用性」，本步不重复判",
    );
  }

  /* ── ③ pnpm 能不能**真跑起仓库的脚本**（不是在不在）──
   *
   * `工具链自证` 已经答过「pnpm 起得来」（`pnpm -v` 退 0）。这里再往前一格：
   * 拿一条**真的会读 `package.json`** 的 pnpm 子命令跑一次 —— `pnpm -v` 只证明
   * 垫片起得来，而 `Install dependencies` 与后面每一步用的是另一条路
   * （`pnpm run` / `pnpm exec`，要读 package.json、要解析 workspace）。
   *
   * 它是**为了这一步自己的第二条判据**：`.cnb.yml` 在脚本调用点写的是裸 `node`
   * （`node scripts/…`），而 `engines.node` 的范围由「工具链自证」判 —— 这一条不
   * 去重判它，只把 pnpm 交给它的那句「起不来」**在装依赖之前**问出来。 */
  const pnpmProbe = runImpl("pnpm", ["--version"]);
  if (pnpmProbe.ok) {
    notes.push(`pnpm 报版本：${pnpmProbe.out.split("\n")[0]}`);
  } else {
    notes.push(
      "pnpm 在这一步下起不来（裸名字，Node 不认 PATHEXT）—— " +
        "它是**读数**不是本步的判据：`工具链自证` 用的是按形态解析的那份探针，" +
        "两者结论不一致时以那一步为准。",
    );
  }

  for (const note of notes) log(`（${note}）`);

  if (problems.length > 0) {
    logError(
      "\n环境前提未满足（这些问题都**只要几秒**就能问出来，早问早改）：",
    );
    for (const p of problems) logError(`  ✗ ${p}`);
    logError(
      "\n背景与判读顺序见 docs/standards/13-提交与-code-review.md §13.5.3.9。",
    );
    return 1;
  }
  log("\n环境前提通过 ✓");
  return 0;
}

/* 只在被直接执行时跑 —— 判「是不是直接执行」用**两侧都过 `path.resolve` 的比较**，
 * 不许拼 `file://${argv[1]}`：`import.meta.url` 在 Windows 上是 `file:///F:/…/x.mjs`
 * （三斜杠 + 正斜杠），拼出来的那份是 `file://F:\…\x.mjs` —— **恒不相等**，
 * 于是这一段一次都不跑、**退出码恒 0 且一行输出都没有**（`工具链自证` /
 * `Python 可用性` 在自托管节点上就栽在这上面：两步双双空转，缺 Python 一路滑到
 * 18 分钟后的 E2E 才暴露）。判据见 `tests/script-main-guard.test.ts`。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(envProbe());
}
