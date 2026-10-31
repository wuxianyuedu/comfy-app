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
 *      定义在本文件的 PYTHON_MIN_VERSION，setup-comfy-cli-venv.mjs 引用它）；
 *   ② **配错了**——`.cnb.yml` 里有 host 侧 PowerShell 认不了的语法面（`?.` / `??`
 *      是 pwsh 7 才有的），它们**不会在解析期报错**，只会在跑到那一步时整段炸；
 *   ③ **配了一条这条路径根本不支持的路**——某个 stage 带了任务级 `image:`。自托管
 *      节点上没有 docker daemon，平台连「起容器」都做不到，那一格会在 **70ms** 内红在
 *      `Runner does not enable Docker` 上（实测 `cnb-cqk-1k550gpp2`，§13.5.3.4.1.3）。
 *      它与 ① 反着：① 是**静默少判**、③ 是**整条流水线在倒数第二步红**，而两者都是
 *      几秒钟就能问出来的事。
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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  browserExecutableExists,
  playwrightBrowsersRoot,
  playwrightReachabilityVerdicts,
  playwrightDownloadRoots,
} from "./ci-toolchain-browser.mjs";
import { codePageIsUtf8, readConsoleEncoding } from "./ci-console-encoding.mjs";
import { findPython } from "./ci-toolchain-python.mjs";

const HERE = import.meta.dirname;
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
    if (!inScript) {
      return;
    }
    if (trimmed === "") {
      return;
    }
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
 * 本仓写明的解释器下限 —— **Python 3.10**（ISSUE #2197 起唯一定义就是这里的
 * `PYTHON_MIN_VERSION`；`scripts/setup-comfy-cli-venv.mjs` 引用它，别处不许另抄）。
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
  if (!m) {
    return null;
  }
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
  if (!triple) {
    return { ok: false, triple: null };
  }
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
 * `.cnb.yml` 里某个 stage 那一项的原文（从它的 `- name:` 到下一项 / 更浅的键）。
 *
 * ## 为什么要有这份**文本副本**
 *
 * 这一段与 `tests/no-platform-ci-config.test.ts` 导出的 `stageBlock()` 是**同一个
 * 解析**，两份文本副本的理由与 `ps7OnlySyntaxIn` 逐字相同：那一条是 `.ts`，而本步跑在
 * `Install dependencies` **之前**（`node_modules` 那时还没有），import 不到。
 * 处置照旧 —— 两份文本 + 一条对账判据（`tests/ci-env-probe.test.ts` 逐项比命中面，
 * 漂了就红）。**报告面**刻意不同：那一条跑在开发机上（给人改配置用），这一份在
 * 构建机上（给这一步的判据用）。
 *
 * 按**缩进收口**而不是正则一次到底：stage 项里嵌着 `script: |` 块（里面是缩进更深的
 * 任意文本）与 `env:` 子映射，一次匹配很容易多吃或少吃 —— `stageBlock()` 的头注记过
 * 同一格。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {string} name stage 名
 * @returns {string | null} 找不到回 `null`（调用方据此只记读数，不判红）
 */
export function stageBlockIn(text, name) {
  const lines = String(text ?? "").split("\n");
  /* **活的 stage 优先；没有就看它是不是被注释掉了**（`COMFYAPP_CI_DISABLED_GATES`
   * 的停用形态）。停用不等于删除：那一项的 `env:` 仍是配置里一条**真的事实**
   * （人改的就是那一行），所以「这一步会拿到哪个下载根」在停用期间同样要答得出。
   * ⚠️ 这与 `tests/no-platform-ci-config.test.ts` 的 `stageBlock()` **同一口径** ——
   * 那份 `.ts` 侧的停用读取在 `commentedStageBlock()`（下面这一支是它的对等物）。 */
  const live = /^ {2}-\s+name:\s*(\S.*?)\s*$/;
  const commented = /^#\s+-\s+name:\s*(\S.*?)\s*$/;
  let start = -1;
  /** @type {(l: string) => string} */
  let strip = (l) => l;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const item = live.exec(raw);
    if (item?.[1] === name) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const item = commented.exec(lines[i] ?? "");
      if (item?.[1] === name) {
        start = i;
        strip = (l) => l.replace(/^#\s?/, "");
        break;
      }
    }
  }
  if (start < 0) {
    return null;
  }
  const out = [strip(lines[start] ?? "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    /* 下一个同级 stage 项（活的或注释态）/ 回到**未注释**的更浅键都算收尾
     * （空行不算 —— 配置里正文之间有空行）。⚠️ 判据不能写成「`^\S` 就收尾」：
     * 注释块里每一行都以 `#` 开头，那也是 `\S`。 */
    if (live.test(raw) || commented.test(raw) || (/^\S/.test(raw) && !raw.startsWith("#"))) {
      break;
    }
    out.push(strip(raw));
  }
  return out.join("\n");
}

/**
 * `.cnb.yml` 里**带了任务级 `image:` 的 stage**（名字，按出现顺序；空数组 = 一格都没有）。
 *
 * ## 为什么这一条会红
 *
 * 自托管节点上**没有 docker daemon**，而任务级 `image:` 要求平台为这一格起一个独立
 * 容器 —— 它连第一步都做不到。实测（`cnb-cqk-1k550gpp2`，PR #2003 首跑）：
 *
 *     浏览器安装  error [70ms]  →  Runner does not enable Docker.
 *
 * 70 毫秒、脚本一行都没执行、前面三十三步全绿。所以本仓的形态是**整条宿主机直跑**，
 * 这条判据把「有人又加了一格」这件事在**最便宜的位置**（装依赖之前）拦下来 —— 而不是
 * 让它在整条流水线倒数第二步以一句英语报错收场。
 *
 * ## 解析不另写一份
 *
 * 走 `stageBlockIn()`（与本步别的用途同一个收口口径），只认 stage 那一层自己的键：
 * `env:` 里的同名键缩进更深，不会被算进来。判据面仍在
 * `tests/ci-image-identity.test.ts`（允许的名单逐格点名），这里只负责「红在便宜的位置」。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} 带 `image:` 的 stage 名
 */
export function stagesWithImage(text) {
  const lines = String(text ?? "").split("\n");
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const item = /^ {2}-\s+name:\s*(\S.*?)\s*$/.exec(lines[i] ?? "");
    const name = item?.[1];
    if (name === undefined) {
      continue;
    }
    const block = stageBlockIn(text, name);
    if (block === null) {
      continue;
    }
    const found = block.split("\n").some((raw) => /^ {4}image:\s*\S/.test(raw));
    if (found && !out.includes(name)) {
      out.push(name);
    }
  }
  return out;
}

/**
 * 装 Playwright 浏览器那一格在 `.cnb.yml` 里的**当前名字**（本文件唯一的出处）。
 *
 * 2026-10-19 它随「只判节点事实的格子不必每个 PR 都判」那次挪档从 PR 撤到每日档，
 * 名字带上「每日」前缀。这一步必须按**当下那个名字**去读它的 `env`：读不到就静默退回
 * 「量候选根」，而它唯一的职责是回答「**配置给的那一个根**到不到」—— 名字散在两份
 * 文件里写死，一定会漂到那种「不报错、只是换了个问题」的状态，所以这里出一个常量，
 * 判据 import 它（`tests/ci-env-probe.test.ts`）。
 */
export const BROWSER_INSTALL_STAGE = "每日浏览器安装";

/**
 * 某个 stage 的 `env:` 里某个键的**字面值**（去引号；找不到回 `null`）。
 *
 * 只看那一项自己的块（`stageBlockIn` 收的口），**不解析继承 / 锚点**：这一步要回答的
 * 是「浏览器那一格会拿到哪个下载根」（名字见 `BROWSER_INSTALL_STAGE`），而那一步的键
 * 就写在它自己的 `env:` 上（`.cnb.yml` 里逐字如此，
 * `tests/no-platform-ci-config.test.ts` 也判着它必须在）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {string} stage stage 名
 * @param {string} key `env` 里的键
 * @returns {string | null}
 */
export function stageEnvValue(text, stage, key) {
  const block = stageBlockIn(text, stage);
  if (block === null) {
    return null;
  }
  /* `\s*` 而不是 `\s+`：**停用形态**里那一项的缩进已被压平（注释块按第 0 列读），
   * 键因此可能顶格出现。匹配面仍限在这一项自己的块内，不会串到别的 stage。 */
  const re = new RegExp(
    `^\\s*${key.replaceAll(/[.*+?^${}()|[\\]\\\\]/g, String.raw`\\$&`)}:\\s*(.+?)\\s*$`,
    "m",
  );
  const m = re.exec(block);
  if (!m?.[1]) {
    return null;
  }
  const raw = m[1].trim().replaceAll(/^["']|["']$/g, "");
  return raw === "" ? null : raw;
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
 * 把临时根补出来（幂等：已在就不动），返回「补成了没 / 为什么没补成」。
 *
 * 为什么由这一步做：落点写在 `.cnb.yml` 的**流水线级** env 里，而**配置指到哪儿，
 * 就该由谁把它建出来** —— 否则换台机器（或有人删了那个目录）之后，第一笔写临时
 * 文件的动作就 ENOENT，而那一句在日志里读不出「目录没了」。
 *
 * ⚠️ **只对绝对路径动手**：相对路径建出来的是「作业目录下的一个子目录」，
 * 那与「临时根」的语义不符（而配置里写相对路径本身就该由人改）。
 *
 * @param {string} dir
 * @returns {{ok: boolean, created: boolean, why: string}}
 */
export function ensureDir(dir) {
  const target = String(dir ?? "").trim();
  if (!target) {
    return { ok: false, created: false, why: "路径是空的" };
  }
  if (!path.isAbsolute(target)) {
    return { ok: false, created: false, why: "不是绝对路径" };
  }
  try {
    if (existsSync(target)) {
      return { ok: true, created: false, why: "已在" };
    }
    mkdirSync(target, { recursive: true });
    return { ok: true, created: true, why: "刚补出来" };
  } catch (error) {
    return {
      ok: false,
      created: false,
      why: /** @type {Error} */ (error).message,
    };
  }
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
 *   readEncodingImpl?: typeof readConsoleEncoding,
 *   runImpl?: (cmd: string, args: string[]) => {ok: boolean, out: string},
 *   browserPresentImpl?: typeof browserExecutableExists,
 *   reachabilityImpl?: typeof playwrightReachabilityVerdicts,
 *   env?: Record<string, string | undefined>,
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
  /* 编码读数的**注入面**（缺省问宿主；用例据此判「读到 936 会说什么」）。 */
  readEncodingImpl = readConsoleEncoding,
  runImpl = run,
  /* 浏览器那两格的注入面：缺省是那份**真**实现（与 `浏览器安装` 同源，
   * §12.18 不造第二轮子）。用例换掉它们 ⇒ 不出网、不碰真落点。 */
  browserPresentImpl = browserExecutableExists,
  reachabilityImpl = playwrightReachabilityVerdicts,
  env = process.env,
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

  /* ── ①′ 任务级 `image:`：这条路径根本不支持它 ──
   *
   * 与 ① 同一类（配置写错了），但形态相反：① 是静默少判、这一条是**整条流水线在倒数
   * 第二步红**，且那一格会在 70ms 内以一句英语收场（`Runner does not enable Docker`，
   * 见 `stagesWithImage()` 的头注）。放在这里是因为它读的是同一份配置文本、代价是零。 */
  if (configText !== null) {
    const withImage = stagesWithImage(configText);
    if (withImage.length > 0) {
      problems.push(
        `这些 stage 带了任务级 \`image:\`：${withImage.join(" / ")} —— ` +
          "自托管节点上**没有 docker daemon**，平台连「起容器」都做不到，这些格子会在 " +
          "70ms 内红在 `Runner does not enable Docker` 上（实测 cnb-cqk-1k550gpp2，" +
          "脚本一行都没执行）。\n" +
          "      下一动作：把那一行 `image:` 删掉（本仓的形态是整条宿主机直跑，" +
          "见规范 §13.5.3.4.1.3）；要「装好工具的现成环境」就走节点镜像计划 " +
          "`node scripts/ci-image-plan.mjs`，别在流水线里声明它。",
      );
    } else {
      notes.push("`.cnb.yml` 的 stage 一格都没带 `image:`（这条路径上没有 docker daemon）");
    }
  }

  /* ── ② 解释器的**版本**（不是在不在 —— 那一格归 `Python 可用性`）── */
  let python = null;
  try {
    python = findPythonImpl();
  } catch {
    /* 探测本身出错时**不是这一条要答的问题**（那一格同样归 `Python 可用性`），
     * 如实记一条读数、不判红 —— 本步骤不做「探测失败」的第二份判据。 */
    notes.push("解释器探测本身出错：本步不判它（缺件与探测失败归「Python 可用性」）");
  }
  if (python) {
    const floor = pythonVersionMeetsFloor(python.version);
    if (floor.triple === null) {
      notes.push(
        `解释器 ${python.path ?? python.command} 的版本号解析不出（原文：` +
          `${python.version}）—— 本步不据此判红（那是「不知道」，不是「不达标」）`,
      );
    } else if (floor.ok) {
      notes.push(
        `解释器 ${python.path ?? python.command} ${floor.triple.join(".")} ` +
          `满足 ≥ ${PYTHON_MIN_TEXT}`,
      );
    } else {
      problems.push(
        `解释器 ${python.path ?? python.command} 是 ${floor.triple.join(".")}，` +
          `低于本仓写明的下限 Python ${PYTHON_MIN_TEXT}（唯一定义：本文件的 PYTHON_MIN_VERSION）。\n` +
          "      它**不会让哪一步变红**：门禁的 Python 侧会以「探测不到」的名义退出比对、" +
          "几条真跑的用例走 `env` 档跳过并登记 —— 与「装好了」在日志里逐字同形。\n" +
          `      下一动作：在这台节点上装一个 ≥ ${PYTHON_MIN_TEXT} 的解释器并让构建账号的 ` +
          "PATH 看得见它（python.org 安装包勾「Add python.exe to PATH」；" +
          "默认的「Install for me only」只写安装者那个用户）。",
      );
    }
  } else {
    notes.push("这台机器上没有可用解释器：缺件那一格归「Python 可用性」，本步不重复判");
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
  /* ── ④ 编码读数（ISSUE #1959 / #1966：日志乱码那一格）──
   *
   * 这里打的是**两个代码页**：控制台输出代码页与宿主 ANSI 代码页（外加 `chcp` 原文）。
   * ⚠️ 它们**都不是「平台按什么解码」的答案** —— 2026-10-16 的两轮探针把前两个嫌疑人
   * 都否掉了（控制台换成 65001、ANSI 也换成 UTF-8，四行探针逐字未变），判读见
   * `ci-console-encoding.mjs` 头注与规范 §13.5.3.5。留着这两个读数是为了
   * **下一次不必再靠推断**：要否掉一个嫌疑人，先得量到它。
   *
   * **它是读数不是判据**：编码不对只让日志难读，不会让哪一步算错；把它判红等于
   * 拦住与之无关的变更。但它是**可机器读的**，所以放在这里随每一跑打出来 ——
   * 「这一跑的日志能不能读」不该靠人去猜。 */
  const encoding = readEncodingImpl();
  const encodingOk = codePageIsUtf8(encoding.codePage);
  const acp =
    encoding.ansiCodePage === null || encoding.ansiCodePage === undefined
      ? "没量到"
      : `${encoding.ansiCodePage}`;
  /* 「给不给下一动作」按读数分三档：**已经对了就不给**（否则话术自相矛盾 —— 一边说
   * 对齐、一边叫人去改），没量到也不给（不知道的东西不该配动作）。 */
  const codes =
    `控制台输出代码页 ${encodingOk === null ? "没量到（非 Windows 或探测失败）" : encoding.codePage}` +
    `（${encodingOk === null ? "不据此判任何东西" : encodingOk ? "UTF-8，与子进程的输出对齐" : "**非 UTF-8**"}）` +
    `；宿主 ANSI 代码页 ${acp}`;
  /* 那两条读数都**不是**平台侧解码的开关 —— 两样都换过一轮，日志一字未变好。 */
  const notTheSwitch =
    "\n      ⚠️ 上面这两个读数**都不是平台侧解码的开关**：控制台代码页与宿主 ANSI 代码页" +
    "都已经换过一轮，日志一个字没变好 —— 解码发生在**子进程输出那一跳**，判读见 §13.5.3.5。";
  if (encodingOk === null) {
    notes.push(`${codes}${notTheSwitch}`);
  } else {
    notes.push(
      `${codes}；chcp 读数 ${encoding.chcpRaw ?? "没量到"}` +
        (encodingOk
          ? notTheSwitch
          : "\n      下一动作：让流水线第一步先跑 " +
            "`node scripts/ci-console-encoding.mjs --apply`（「工具链自证」的第一步就是它）。" +
            notTheSwitch),
    );
  }

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

  /* ── ⑤ 浏览器那一格的**前提**（ISSUE #1959 用户诉求的落点）──
   *
   * 这一步是整条流水线上**最晚**才红的一格（`浏览器安装` 排在倒数第二步、E2E 之前），
   * 而它的前提只要几秒就能问出来。实测四跑都是这个形态：跑了十几到二十几分钟、
   * 前面三十步全绿，最后卡在下载上（`cnb-gt1-1k513ill4` / `cnb-g9d-1k515kvrq`）。
   *
   * 它答的**不是**「浏览器在不在」（那一格归 `浏览器安装`：缺件会去装、装完复验），
   * 而是**「这一趟装得成吗」**——判读分两支：
   *
   *   ① **落点上已经有那一件** ⇒ 无需网络（`--playwright-only` 会走「已装，跳过下载」），
   *      这一步给一条读数就放行；
   *   ② **落点上是空的** ⇒ **现在**量一次「下载根通不通」。全都不通就**当场红** ——
   *      因为那意味着第 31 步**必然**失败，而它在前面白花掉三十分钟之后才告诉你。
   *
   * ## 量的是**这一步会真用的那个根**，不是「某个还算通的根」（ISSUE #1966 的续集）
   *
   * `PLAYWRIGHT_DOWNLOAD_HOST` 设在 `.cnb.yml` 的 `浏览器安装` stage 上，本步的
   * stage 看不到它 —— 但本步**读得到那份配置**（上面判语法面时已经读了），所以这里
   * 先把那一行摘出来，再去量**它**。这条分岔是 `cnb-ald-1k51g8dt9` 那一跑买来的：
   *
   *     （这一步）下载根探测：…/binaries/playwright → HTTP 200   ← 裸 HEAD，报绿
   *     （30 分钟后）浏览器安装：从**同一个根**下载 … timed out after 120000ms（0 字节）
   *
   * 「某个根通」与「我们要用的那个根通」是**两个结论**，而这一步存在是为了回答后者
   * —— 前者绿着放行，正是它要防的那件事。所以配置里给了根时，判据是**那一个根**：
   * 它到不了就当场红，并把下一动作点成「换 `.cnb.yml` 里那一行」。
   *
   * 没给根时照旧铺开候选那一族 —— 那时「这台机器出得去这类域吗」正是要回答的问题。
   *
   * ⚠️ 与 `浏览器安装` 的失败分支**刻意不同**：那里是「装都装失败了，把五个域都量一遍
   * 供人定位」；这里是**前置判定**，只量真正会被用到的那一个（或候选那一族），
   * 因为它是判据、要快。
   *
   * ## 为什么它**不**在探测出「不通」时直接去装、也不替人换根
   *
   * 「不通」这件事不是这步骤能修的（网络在仓外），所以它的作用是**把结论提前**，
   * 而不是替 `浏览器安装` 做那一步 —— 职责边界与 `工具链自证` ⇄ `Python 可用性` 同形。
   * 也**不**自动改写配置：那等于把一次探测结论冒充成长期决定（这一节反复写过的边界）。
   * 它只回答「按现在的配置这一趟装得成吗」，并把能到的根列出来给人挑。 */
  try {
    const already = browserPresentImpl({ env });
    if (already.ok) {
      notes.push(
        `浏览器落点上已经有那一件（${already.out}）—— ` +
          "`" +
          BROWSER_INSTALL_STAGE +
          "` 会走「已装，跳过下载」，这一格不依赖网络",
      );
    } else {
      /* 配置里那一步会用的根（读不到那条配置 / 那个键时退回「按本步 env」的老口径
       * —— 那是「不知道」，不是「不达标」，见下面 catch 与 `problems` 那两条）。
       * ⚠️ 名字走 `BROWSER_INSTALL_STAGE` 一个出处：那一格 2026-10-19 从 PR 撤到每日档、
       * 名字加了前缀，写死的字符串会**静默**读不到根 ⇒ 这一步退回「量五个候选根」，
       * 于是它报的不再是「配置给的那一个到不到」，而它的全部职责就是回答那一句。 */
      const configuredHost = configText
        ? stageEnvValue(configText, BROWSER_INSTALL_STAGE, "PLAYWRIGHT_DOWNLOAD_HOST")
        : null;
      const roots = configuredHost ? [configuredHost] : playwrightDownloadRoots(env);
      /* 没给根时用候选那一族；给了根就只量它（配置给的那一个优先于本步 env ——
       * 那才是这一步真正要回答的对象）。
       *
       * ⚠️ 量的是**真资源**且**真取一小段字节**（`httpDownloadProbe` 的头注，ISSUE #1966
       * 与它的续集）：裸根对这几个地址都回 4xx，而 HEAD 又会把「大 body 取不下来」的
       * 链路判成好链路 —— 两次都让这一步**假绿**，把 30 分钟后的失败原样放行。
       * 三态里 `root` 是配置面（人会照着配 `PLAYWRIGHT_DOWNLOAD_HOST`），
       * `url` 是实测面，两个都打出来 —— 缺了 `root`，人对着一个 404 的资源路径
       * 不知道该改哪一行。 */
      const verdicts = reachabilityImpl(
        roots[0] ? { candidates: [roots[0]] } : { candidates: undefined },
      );
      const reachable = verdicts.filter((v) => v.ok);
      for (const v of verdicts) {
        notes.push(`下载根探测：${v.root ?? v.url} → ${v.verdict}`);
      }
      if (reachable.length === 0) {
        problems.push(
          /* 话术里的 stage 名一律取 `BROWSER_INSTALL_STAGE`：读不到配置那一步的根
           * 时，人照着红话去改的那一行必须**就是**这一格读的那一格。名字散在
           * 消息里写死，下一次挪档就会把人指到一个不存在的 stage 上。 */
          (configuredHost
            ? "浏览器落点是空的，而 `.cnb.yml` 给 `" +
              BROWSER_INSTALL_STAGE +
              "` 配的那个下载根" +
              `（${configuredHost}）**取不回字节** —— `
            : "浏览器落点是空的，而**一个下载根都到不了** —— ") +
            "`" +
            BROWSER_INSTALL_STAGE +
            "` 那一步排在倒数第二（E2E 之前），照这个读数它**必然**会在" +
            "那里失败，而那时前面三十步的预算已经花掉了。\n" +
            `      实测过的现场：${verdicts[0]?.root ?? "（没有候选）"} → ` +
            `${verdicts[0]?.verdict ?? "?"}\n` +
            "      下一动作（前两条在人不在仓）：\n" +
            (configuredHost
              ? "        · 把这台节点**真能到**的镜像根换到 `.cnb.yml` 的 `" +
                BROWSER_INSTALL_STAGE +
                "` stage 的 `PLAYWRIGHT_DOWNLOAD_HOST` 上 —— 就是上面" +
                "「下载根探测」那几行里判通的那一个；\n"
              : "        · 把这台节点**真能到**的镜像根配到 `.cnb.yml` 的 `" +
                BROWSER_INSTALL_STAGE +
                "` stage 的 `PLAYWRIGHT_DOWNLOAD_HOST` 上；\n") +
            "        · 或给节点配内网代理 / 放行镜像域；\n" +
            "        · 或**预先把 `chromium-headless-shell` 装进节点的落点** —— " +
            "装过一次之后这一格就再也不碰网络（长期存在的机器上这是最省事的一条）。",
        );
      } else {
        notes.push(
          `浏览器落点是空的，而${configuredHost ? "配置里那个根" : "下载根"}` +
            `有 ${reachable.length}/${verdicts.length} 条真取回了字节` +
            "（`" +
            BROWSER_INSTALL_STAGE +
            "` 那一步应该装得成）",
        );
      }
      if (configuredHost) {
        /* 配置里那一行只在「确实量了它」时点出来 —— 它是这一步与浏览器那一格之间
         * 唯一的事实对齐点，人改的就是这一行。 */
        notes.push(
          `上面量的是 \`.cnb.yml\` 给 \`${BROWSER_INSTALL_STAGE}\` 配的那个根：${configuredHost}`,
        );
      }
    }
  } catch (error) {
    /* 探测本身出错时**不判红**（同 Python 那条：那是「不知道」，不是「不达标」）——
     * 但它要留一条读数，否则这一步会看起来像「浏览器那一格没在判」。 */
    notes.push(
      `浏览器前提探测本身出错：${/** @type {Error} */ (error).message} —— ` +
        "本步不据此判红（那一格仍归 `" +
        BROWSER_INSTALL_STAGE +
        "`）",
    );
  }

  /* ── ⑥ 落点：临时根与浏览器根（写到哪儿去、那个目录在不在）──
   *
   * 这一格答的是「这一趟的临时文件写到哪儿去」—— 它是**配置**给的事实（`.cnb.yml`
   * 的流水线级 env 里的 `TEMP` / `TMP` / `PLAYWRIGHT_BROWSERS_PATH`），而**落点目录
   * 必须事先存在**：临时根不存在时 Node 的 `os.tmpdir()` 仍会把它当成临时目录返回，
   * 于是第一次写就 ENOENT —— 那不是「慢」，是「看不懂的红」（读不出「目录没了」）。
   *
   * 所以这一格做两件事：**补目录**（幂等，缺了才建）与**打印读数**（根在哪儿、在不在）。
   *
   * ⚠️ **刻意不判红**：落点不对的处置是「人改配置 / 人补目录」，不是「这一趟红」——
   * 与「浏览器根不通 ⇒ 当场红」那一条**刻意不同**（那条红的是**必然**失败的那一跳，
   * 而落点不存在这件事在多数形态下是「第一次写临时文件时才发现」，补上就没事了）。
   * 目录补不出来时（权限拒绝 / 盘符不存在）才进 `problems` —— 那才是真的跑不下去。 */
  const tempRoot = env.TEMP ?? env.TMP ?? "";
  if (tempRoot) {
    const ensured = ensureDir(tempRoot);
    if (ensured.ok) {
      notes.push(
        `临时根 ${tempRoot}` +
          (ensured.created ? "（原先不存在，这一格刚补出来）" : "（已在）") +
          `·TMP=${env.TMP ?? "(未设)"}`,
      );
    } else {
      problems.push(
        `临时根 ${tempRoot} 建不出来（${ensured.why}）—— 这一趟的临时文件无处可写，` +
          "下一动作：在节点上把这个目录建出来（或把 `.cnb.yml` 的 `TEMP` 改到一个已存在的目录）。",
      );
    }
  } else {
    notes.push("临时根没配（`TEMP` / `TMP` 都没设）—— 工具会退回系统默认的那个");
  }
  notes.push(`浏览器落点 ${playwrightBrowsersRoot({ env })}`);

  for (const note of notes) {
    log(`（${note}）`);
  }

  if (problems.length > 0) {
    logError("\n环境前提未满足（这些问题都**只要几秒**就能问出来，早问早改）：");
    for (const p of problems) {
      logError(`  ✗ ${p}`);
    }
    logError("\n背景与判读顺序见 docs/standards/13-提交与-code-review.md §13.5.3.9。");
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
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(envProbe());
}
