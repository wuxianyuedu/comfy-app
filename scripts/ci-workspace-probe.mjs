#!/usr/bin/env node
/**
 * `ci-workspace-probe.mjs` — 把「**这一跑的检出目录，是不是上一跑那个**」打成读数（恒退 0）。
 *
 * ## 它要回答的那一格
 *
 * 自托管节点上每次构建都要重新检出代码，这件事在本仓只有一个**数字**
 * （`Prepare` ≈31.5s，规范 §13.5.20 那张预算表），而它背后的**机制**从来没有读数：
 * 平台在宿主机上到底是
 *
 *   ① 每次新建一个 job 目录、`git init` + 全量 `fetch`（那 31.5s 是「从零搬对象库」的钱，
 *      想省只能让对象库常驻）；还是
 *   ② 复用同一个目录、只 `fetch` 增量（那 31.5s 里大头是 checkout 五千多个文件落盘 +
 *      Windows Defender 逐文件扫，而对象库已经在地上）；还是
 *   ③ 目录复用但 `.git` 被重建（省下的只有目录那半格）。
 *
 * **第一跑读数（`cnb-f3v-1k57a1o1l`，PR #2016）已经把这一格定成 ①**，而且不需要对照：
 * 工作区路径本身就带着本次流水线的 id —— `…\runner\<repoId>\cnb-f3v-1k57a1o1l-001~c5g\
 * workspace`，目录名按流水线生成 ⇒ 每次构建一个新目录；`.git` 与 `.git/FETCH_HEAD` 都在
 * 59s / 58s 前出现（与 `Prepare` 那 35.5s 对得上），HEAD detached、`refs/heads` 零条、
 * 浅克隆 false、对象库 57168 KiB（**≈56 MiB，不是开发机上那 130 MiB 的全量 —— 那一份
 * 含 99 个 pack、22178 个松散对象与所有本地分支，CI 取的是协商后的单 ref**）。同一跑里
 * `node_modules` / `.next` / `coverage` / `playwright-report` **四个都不在场** ⇒ 安装与
 * 生产构建都从冷态起，那两笔（59s / 131s）比克隆本身大。
 *
 * 这三种形态各有各的出路，而**现在没有任何一处读数能把它们分开** —— 于是「要不要上
 * 平台那个 `git.enable: false` 开关、自己 fetch 到一份常驻目录」这个问题只能靠猜。
 * 本档就是把这一格变成可见读数。
 *
 * ## 它顺手量的第二格（可能比克隆更贵）
 *
 * `node_modules` / `.next` / `coverage` 在构建**开始时**在不在、是什么时候来的。如果
 * 它们每次都是新的，那么这条路径上交的不止克隆那 31.5s：`Install dependencies` 的 59s
 * 是「从 store 重装」，`生产构建` 的 131s 是「冷缓存 `next build`」。那一格只有这里的
 * 磁盘出生时间能回答，平台日志给不出。
 * ⚠️ 那 131s 的读数是**它还在 PR 那一条上**的时候取的（2026-10-18 起构建只剩每日档，
 * §13.5.23）。这一档仍然要量 `.next`：形态①是**节点级**的，每日那一跑同样落在全新的
 * job 目录里 —— 而哪天把 `node_modules` / `.next` 挪进常驻目录（下一格的缓存方案），
 * 判「缓存有没有真的被复用」的就是这里这几个出生时间，不是别处。
 *
 * ## 为什么它是读数而不是判据（与 `镜像身份` 同一口径）
 *
 * 1. 它判的是**这台机器怎么被调度**，而那不是仓库能改的东西 —— 判红只会把「节点的
 *    形态」伪装成「这次 PR 的缺陷」；
 * 2. 第一跑**必然没有对照**（账本里还没有上一条），拿它当判据就是把第一次接入节点的
 *    一跑判红；
 * 3. 它给的结论要靠**两跑以上**才成立，而判据必须是单次可判的。
 *
 * 所以它做四件事：把磁盘上的事实打出来、把跨构建的历史记进**工作区之外**的账本、
 * 按历史给出①②③里的哪一种、以及给出下一动作。恒退 0。
 *
 * ## 两条硬约束
 *
 * - **账本写在工作区之外**：写进检出目录就成了未跟踪文件，会被结构门禁与
 *   `.gitignore` 那一套判；而它要的恰恰是「跨检出存活」，放进检出目录等于自己把它
 *   抹掉。落点由 `COMFYAPP_CI_PROBE_DIR` 给，缺省退到宿主的 `LOCALAPPDATA`。
 * - **输出预算**：平台单次构建日志硬上限 102400 字节（`.cnb.yml` 的覆盖率那一格就是
 *   为它而设的），所以这里只打**行**，不打目录清单；目录大小一律问 `git count-objects`
 *   要现成的数，不自己 `du`（`node_modules` 十几万个文件，逐文件 stat 会把这一档
 *   从秒级推到分钟级）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveGitDir } from "./git-dir.mjs";

/** 账本文件名（住在 `COMFYAPP_CI_PROBE_DIR` 或宿主 `LOCALAPPDATA` 下，**不在检出目录里**）。 */
export const LEDGER_FILE = "comfyapp-ci-workspace-probe.json";
/** 账本留多少条：够覆盖「同一台节点上连着推的几个提交 + 并行 PR」这一段对照。 */
const LEDGER_KEEP = 20;
/** 值一律不打印的名字族（`CNB_TOKEN` 那类凭据，硬规则 17）。 */
const SENSITIVE_ENV = /TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|AUTH/i;
/** 决定「自取检出够不够得着」的那几格；缺省只说明这台节点上平台没给，不说明不能自取。 */
const KEY_ENV = [
  "CNB_REPO_SLUG",
  "CNB_REPO_URL",
  "CNB_COMMIT",
  "CNB_BRANCH",
  "CNB_PULL_REQUEST_IID",
  "CNB_PIPELINE_ID",
  "CNB_JOB_ID",
];
/**
 * @typedef {{
 *   workspace: DirFact, gitDir: DirFact, fetchHead: DirFact,
 *   node_modules: DirFact, ".next": DirFact, coverage: DirFact,
 *   "playwright-report": DirFact,
 * }} ProbeFacts
 */

/**
 * 注入面只收 fs 的那**四个动作**，而不是 `typeof fs`。
 *
 * 这不是洁癖：判据要能拿一份「只有这四个方法」的假文件系统进来。类型写成 `typeof fs`
 * 就等于要求假的那份补齐 98 个成员（或者满屏 `as never`），而这一档真用到的只有这四个。
 *
 * @typedef {{
 *   statSync: (target: string) => { birthtimeMs: number, mtimeMs: number },
 *   readFileSync: (target: string) => string,
 *   writeFileSync: (target: string, data: string) => void,
 *   mkdirSync: (target: string, options: { recursive: boolean }) => void,
 * }} FsLike
 */
/** @typedef {{ok: boolean, out: string}} RunResult */
/** @typedef {(cmd: string, args: string[], options?: { cwd?: string }) => RunResult} RunFn */
/** @typedef {{present: boolean, ageS: number | null, bornMs: number | null, from: string}} DirFact */
/** @typedef {{
 *   gitOk: boolean, head: string | null, detached: boolean | null,
 *   headRefs: number | null, commits: number | null, packKib: number | null,
 *   shallow: string | null, remotes: number | null,
 * }} GitFact */
/** @typedef {{
 *   atMs: number, cwd: string, head: string | null,
 *   gitBornMs: number | null, gitAgeS: number | null, nodeModulesBornMs: number | null,
 * }} ProbeEntry */

/**
 * 真 fs 的**四动作薄壳**（不是 `fs` 本身）。
 *
 * 写成薄壳而不是把 `fs` 直接投成 `FsLike`：那要在两处用 `any`（一个类型转换、一个用例里的
 * `as never`），而本仓的类型规范那条是「禁 any」。薄壳顺带把 `readFileSync` 的
 * `string | Buffer` 收成 `string`，注入面与被注入面从此是同一个形状。
 *
 * @type {FsLike}
 */
const realFs = {
  statSync: (target) => fs.statSync(target),
  readFileSync: (target) => fs.readFileSync(target, "utf8"),
  writeFileSync: (target, data) => {
    fs.writeFileSync(target, data);
  },
  mkdirSync: (target, options) => {
    fs.mkdirSync(target, options);
  },
};

/**
 * `spawnSync` 的十行包装。与 `ci-toolchain-python.mjs` 里那份**刻意不共享**：
 * 这一档要在「Node 的模块链还没被证明可用」的机器上也能加载，共享换来的那点重复
 * 抵不上这条加载前提（同 `python-probe.mjs` 文件头记的那条理由）。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 * @returns {RunResult}
 */
export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    cwd: options.cwd,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0 && !r.error, out };
}

/**
 * 账本**目录**：显式给 → 宿主 `LOCALAPPDATA` → 用户目录下的 `.cache`。
 *
 * 单独导出的理由：这一族读数档（本文件与 `ci-workspace-provenance.mjs`）各自有自己的
 * 账本文件名，但**必须落同一个目录** —— 两本账分开退路，就会出现「同一台机上一个看得见
 * 上一个看不见」那种永远对不上的对照。
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function ledgerRoot(env = process.env) {
  return env.COMFYAPP_CI_PROBE_DIR || env.LOCALAPPDATA || path.join(os.homedir(), ".cache");
}

/**
 * 账本落点（`ledgerRoot()` + 本档的文件名）。
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function ledgerPath(env = process.env) {
  return path.join(ledgerRoot(env), LEDGER_FILE);
}

/**
 * 读账本；不存在 / 读不动 / 形状不对一律回空数组（读数不许因为自身故障而打不出正文）。
 *
 * 收成**泛型**而不是 `ProbeEntry`：这一对函数的机制是「追加一条、留最近 N 条、JSON 落盘」，
 * 与条目长什么样无关，而同一目录下现在住着第二本账（`ci-workspace-provenance.mjs` 的
 * `comfyapp-ci-workspace-provenance.json`）。类型写死成第一本的条目形状，第二本要么被迫
 * 伪造无关字段、要么各抄一份 append —— 两条都是把「共用一处实现」这件事付掉。
 *
 * @template T
 * @param {string} file
 * @param {FsLike} [fsLike]
 * @returns {T[]}
 */
export function readLedger(file, fsLike = realFs) {
  try {
    const parsed = JSON.parse(fsLike.readFileSync(file));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 写账本（追加一条、留最近 `LEDGER_KEEP` 条）。落盘目录不存在时先建出来。
 *
 * @template T
 * @param {string} file
 * @param {T} entry
 * @param {FsLike} [fsLike]
 */
export function writeLedger(file, entry, fsLike = realFs) {
  const next = [...readLedger(file, fsLike), entry].slice(-LEDGER_KEEP);
  fsLike.mkdirSync(path.dirname(file), { recursive: true });
  fsLike.writeFileSync(file, `${JSON.stringify(next, null, 1)}\n`);
  return next.length;
}

/**
 * 年龄的读法：秒 / 分 / 天三档。
 *
 * 这一档的价值全在那个年龄上，而「4923662s 前」这种读数人算不出来是几天 ——
 * 开发检出上尤其如此（盘上的目录本来就几十岁了）。秒只在「就是这一两分钟内」这一档保留，
 * 那正是 CI 上要看的量级。
 *
 * @param {number | null | undefined} ageS
 */
export function fmtAge(ageS) {
  if (ageS === null || ageS === undefined) {
    return "-";
  }
  const n = Number(ageS);
  if (!Number.isFinite(n)) {
    return "-";
  }
  if (n < 90) {
    return `${n}s`;
  }
  if (n < 3600) {
    return `${Math.round(n / 60)}m`;
  }
  if (n < 86400) {
    return `${Math.round(n / 3600)}h`;
  }
  return `${Math.round(n / 86400)}d`;
}

/**
 * 对照行里「这一次是哪一台 job」的写法：**父目录名 + 最后一段**，不是只取 basename。
 *
 * 第二跑读数当场暴露的缺陷：平台把每个 job 都检出成 `…\\<流水线 id>~<随机段>\\workspace`，
 * 最后一段**恒等于 `workspace`** —— 只取 basename 时两跑并排就是 `workspace / workspace`，
 * 而这一行的全部用处正是让人看出「这是两个不同目录」。有区分度的那一半在父目录上
 * （`cnb-f3v-1k57a1o1l-001~c5g` vs `cnb-f5b-1k57bgqol-001~ttf`），所以那里取两段。
 *
 * @param {string} cwd
 */
export function jobLabel(cwd) {
  const p = String(cwd);
  return path.join(path.basename(path.dirname(p)), path.basename(p));
}

/**
 * 一个目录的在场性与「它是多久以前出现的」。
 *
 * `birthtimeMs` 在部分文件系统上是 0，那时退回 `mtimeMs` 并如实标出用的哪一个 ——
 * 这一档的全部价值就是那个年龄，取不到要说，不能假装取到了。
 *
 * @param {string | null} target
 * @param {number} nowMs
 * @param {FsLike} [fsLike]
 * @returns {DirFact}
 */
export function dirFact(target, nowMs, fsLike = realFs) {
  /** @type {DirFact} */
  const absent = { present: false, ageS: null, bornMs: null, from: "-" };
  if (target == null) {
    return absent;
  }
  /** @type {{birthtimeMs: number, mtimeMs: number} | null} */
  let st;
  try {
    st = fsLike.statSync(target);
  } catch {
    return absent;
  }
  if (!st) {
    return absent;
  }
  const born = st.birthtimeMs || st.mtimeMs;
  return {
    present: true,
    ageS: Math.max(0, Math.round((nowMs - born) / 1000)),
    bornMs: born,
    from: st.birthtimeMs ? "birth" : "mtime",
  };
}

/**
 * 检出这一侧的 git 读数：HEAD 形状、历史深度、对象库大小、有没有 remote、是不是浅克隆。
 *
 * 只问 git 现成的数，不自己数盘（见文件头那条输出预算）。remote 的 **URL 一律不打**：
 * 平台给的 clone 地址可能带凭据，而这里要的只是「有没有配 remote」这一格。
 *
 * @param {string} cwd
 * @param {RunFn} [runCmd]
 * @returns {GitFact}
 */
export function gitReadout(cwd, runCmd = run) {
  /** @type {(args: string[]) => RunResult} */
  const git = (args) => runCmd("git", args, { cwd });
  /** @type {GitFact} */
  const out = {
    gitOk: false,
    head: null,
    detached: null,
    headRefs: null,
    commits: null,
    packKib: null,
    shallow: null,
    remotes: null,
  };
  const sha = git(["rev-parse", "HEAD"]);
  if (!sha.ok) {
    return out;
  }
  out.head = sha.out.slice(0, 12);
  out.detached = !git(["symbolic-ref", "-q", "HEAD"]).ok;
  const refs = git(["for-each-ref", "--format=%(refname)", "refs/heads"]);
  out.headRefs = refs.ok ? refs.out.split("\n").filter(Boolean).length : null;
  const count = git(["rev-list", "--count", "HEAD"]);
  out.commits = count.ok ? Number(count.out) : null;
  const packs = git(["count-objects", "-v"]);
  const sizePack = /^size-pack:\s*(\d+)/m.exec(packs.out);
  out.packKib = sizePack ? Number(sizePack[1]) : null;
  const shallow = git(["rev-parse", "--is-shallow-repository"]);
  out.shallow = shallow.ok ? shallow.out : null;
  const remote = git(["remote"]);
  out.remotes = remote.ok ? remote.out.split("\n").filter(Boolean).length : null;
  out.gitOk = true;
  return out;
}

/**
 * `CNB_*` 那几格：变量名全列，值只给非敏感的那几个；敏感项只报「在场 + 长度」。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function envReadout(env = process.env) {
  const names = Object.keys(env)
    .filter((k) => k.startsWith("CNB_"))
    .sort();
  const lines = [`CNB_* 变量 ${names.length} 个：${names.join(" ") || "（一个都没有）"}`];
  for (const name of KEY_ENV) {
    const value = env[name];
    if (value === undefined) {
      lines.push(`  -- ${name} 不在场`);
      continue;
    }
    lines.push(
      SENSITIVE_ENV.test(name)
        ? `  ** ${name} 在场（长度 ${value.length}，值不打）`
        : `  ok ${name} = ${value}`,
    );
  }
  const sensitive = names.filter((name) => SENSITIVE_ENV.test(name) && !KEY_ENV.includes(name));
  /* 有界：平台一次能给几十上百个变量，而这里要答的只有「凭据在不在、够不够得着自取」
   * 那一格。全名已经在第一行打过了，逐条只点到够定位的量。 */
  for (const name of sensitive.slice(0, 10)) {
    lines.push(`  ** ${name} 在场（敏感族，长度 ${String(env[name]).length}，值不打）`);
  }
  if (sensitive.length > 10) {
    lines.push(`  …另有 ${sensitive.length - 10} 个敏感族变量，同上不打值`);
  }
  return lines;
}

/**
 * 跨构建对照的结论：①每次新目录 / ②同目录同对象库 / ③同目录但对象库被重建。
 *
 * `history` 是**不含本次**的历史。这里刻意不用「上一条历史」做对照而要用**全部历史**：
 * 并行 PR 各自落在不同目录上、同一 PR 的连续两次推送才会落回同一目录，只比「上一条」
 * 会把前者读成「每次新检出」。只有全部历史里一条都不重合，才说得出「这台节点每次
 * 都是从零检出」。
 *
 * @param {ProbeEntry[]} history
 * @param {ProbeEntry} current
 * @returns {string[]}
 */
export function reuseVerdict(history, current) {
  if (history.length === 0) {
    return ["结论·未定：账本里没有比本次更早的一条，没有对照。同一台节点上再跑一轮就有了。"];
  }
  const sameDir = history.filter((e) => e.cwd === current.cwd);
  if (sameDir.length === 0) {
    return [
      `结论·①每次新目录：此前 ${history.length} 次没有一个落在本次这个目录上`,
      "  → 对象库每次从零搬起；要省这一跳，只有「平台不检出 + 自己 fetch 到一份常驻目录」",
      "    （平台侧那个开关是 Pipeline 级的 `git.enable: false`，官方语义「指定是否拉取代码」）",
      "  ※ 走那条路要**同批**补一条会红的断言：`git rev-parse HEAD` 必须等于本次事件检出的",
      "    那个 sha。变量要对着 `CNB_PULL_REQUEST_MERGE_SHA` 判 —— 第一跑实测 HEAD 是 merge",
      "    提交（d399bd34…），而 `CNB_COMMIT` 给的是源分支 head（f2325166…），两者不同：拿错",
      "    变量会把绿的一跑判成红。少了这条断言，「这一跑跑的是哪份源码」就没有任何执行者 ——",
      "    那正是这条路此前被判死的那一格（规范 §13.5.3.4.2），不是风格问题。",
      `  对照：${history
        .slice(-6)
        .map((e) => jobLabel(e.cwd))
        .join(" / ")}`,
    ];
  }
  /* `sameDir` 非空由上面那个分支保证，但下标取值的类型仍是 `ProbeEntry | undefined`。
   * 兜到 `current` 而不是断言非空：真走到那一支就是「读不出对照」，那时报②（同目录、
   * 对象库没变 → 别动检出层）比编一个③出来更不打扰人。 */
  const last = sameDir.at(-1) ?? current;
  if (Number(last.gitBornMs) === Number(current.gitBornMs)) {
    return [
      `结论·②同目录且 .git 没被重建（同一份对象库活了 ${sameDir.length + 1} 次构建）`,
      "  → 平台已经在做增量 fetch；那笔克隆时间的大头不在网络搬包，而在 checkout 落盘",
      "  → 那么 `git.enable` 这一档动不了真正的成本，别为它改检出层",
    ];
  }
  return [
    `结论·③同目录但 .git 被重建（本次 .git 现于 ${fmtAge(current.gitAgeS)} 前，` +
      `上一次同目录那跑现于 ${fmtAge(last.gitAgeS)} 前）`,
    "  → 目录活着、对象库每次从零 —— 常驻目录已经有一半，缺的那一半是别把 .git 清掉",
  ];
}

/**
 * 缓存侧的读数：`node_modules` 与 `.next` 在构建开始时**在不在**。
 *
 * 只判这两件，合成结论里不带上 `coverage` / `playwright-report`：那两件按当前配置
 * 本来就可能整条路径都不产出（`单元测试` 停用、Playwright 没开 video），把它们
 * 算进「冷不冷」等于用一件不存在的事实下一句结论。它们仍然逐件打在场性，只是不进结论。
 *
 * @param {ProbeFacts} facts
 * @returns {string[]}
 */
export function cacheVerdict(facts) {
  const lines = [];
  lines.push(
    facts.node_modules?.present
      ? `缓存侧·node_modules 在场（${fmtAge(facts.node_modules.ageS)} 前出现）→ 这一跑的安装不是从零起`
      : "缓存侧·node_modules 不在场 → 这一跑的安装是从零装起，那一档是净成本",
  );
  lines.push(
    facts[".next"]?.present
      ? `缓存侧·.next 在场（${fmtAge(facts[".next"].ageS)} 前出现）→ 构建带着上一轮的产物图`
      : "缓存侧·.next 不在场 → 构建冷缓存起。※ 这一格现在只在每日那一跑才产 `.next`" +
          "（2026-10-18 起 PR 那条不跑构建，§13.5.23）—— 所以 PR 上读到「不在场」不构成结论，" +
          "它真正要回答的是「常驻缓存目录有没有生效」（下一格的那笔账）",
  );
  return lines;
}

/**
 * 组装要打印的每一行。所有外部依赖都可注入，所以判据不需要真机。
 *
 * @param {{cwd?: string, env?: Record<string, string | undefined>, nowMs?: number,
 *          run?: RunFn, fs?: FsLike, ledger?: string,
 *          gitDirOf?: (root: string) => string | null}} [io]
 * @returns {string[]}
 */
export function workspaceProbeLines(io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const nowMs = io.nowMs ?? Date.now();
  const runCmd = io.run ?? run;
  const fsLike = io.fs ?? realFs;
  const file = io.ledger ?? ledgerPath(env);
  const gitDirOf = io.gitDirOf ?? resolveGitDir;
  const git = gitReadout(cwd, runCmd);
  // 本仓检出在哪：走权威解析（认链接工作树里 `.git` 是个文件的情形），不硬拼
  // 检出子目录（硬拼在 worktree 上指向那个文件）。不在 git 检出里时
  // `gitDir` 为 null，`dirFact` 对 null 走「absent」分支（try/catch 吞掉 statSync(null)）。
  const gitDir = gitDirOf(cwd);
  /** @type {ProbeFacts} */
  const facts = {
    workspace: dirFact(cwd, nowMs, fsLike),
    gitDir: dirFact(gitDir, nowMs, fsLike),
    fetchHead: dirFact(gitDir ? path.join(gitDir, "FETCH_HEAD") : null, nowMs, fsLike),
    node_modules: dirFact(path.join(cwd, "node_modules"), nowMs, fsLike),
    ".next": dirFact(path.join(cwd, ".next"), nowMs, fsLike),
    coverage: dirFact(path.join(cwd, "coverage"), nowMs, fsLike),
    "playwright-report": dirFact(path.join(cwd, "playwright-report"), nowMs, fsLike),
  };

  /** @type {ProbeEntry} */
  const entry = {
    atMs: nowMs,
    cwd,
    head: git.head ?? null,
    gitBornMs: facts.gitDir.bornMs ?? null,
    gitAgeS: facts.gitDir.ageS ?? null,
    nodeModulesBornMs: facts.node_modules.bornMs ?? null,
  };
  const lines = [];
  lines.push("== 检出与工作区 ==");
  lines.push(`cwd                 ${cwd}`);
  /** @type {(f: DirFact) => string} */
  const age = (f) => (f.present ? `在场，${fmtAge(f.ageS)} 前出现（取的是 ${f.from}）` : "不在场");
  lines.push(`.git                ${age(facts.gitDir)}`);
  lines.push(`.git/FETCH_HEAD     ${age(facts.fetchHead)}`);
  if (git.gitOk) {
    lines.push(
      `HEAD                ${git.head} ${git.detached ? "(detached)" : "(有分支)"}` +
        `  refs/heads ×${git.headRefs}  历史 ${git.commits} 提交  浅克隆 ${git.shallow}`,
    );
    lines.push(
      `对象库              ${git.packKib} KiB（git count-objects 现成的数）  remote ×${git.remotes}`,
    );
  } else {
    lines.push("HEAD                git 读不到 —— 这一跑的工作区不是 git 检出（读数照打，不判红）");
  }
  /* 四件逐条点名而不是套循环：键写死在这里，`facts` 就是那份有固定形状的常量，
   * 不用 `Record<string, …>` 把每个读取都推成「possibly undefined」。 */
  lines.push(`node_modules        ${age(facts.node_modules)}`);
  lines.push(`.next               ${age(facts[".next"])}`);
  lines.push(`coverage            ${age(facts.coverage)}`);
  lines.push(`playwright-report   ${age(facts["playwright-report"])}`);

  lines.push("");
  lines.push("== 自取检出的前提（只报在场性）==");
  lines.push(...envReadout(env));

  let ledgerNote;
  /** 账本里**比本次更早**的那几条 —— 对照只能拿它们做，本次自己不算证据。 */
  /** @type {ProbeEntry[]} */
  let history = [];
  try {
    history = readLedger(file, fsLike);
    const kept = writeLedger(file, entry, fsLike);
    ledgerNote = `（账本 ${kept} 条）`;
  } catch (error) {
    ledgerNote = `（账本写不进去：${error && /** @type {Error} */ (error).message} —— 只打磁盘侧读数）`;
  }
  lines.push("");
  lines.push(`== 跨构建对照 ${ledgerNote}==`);
  lines.push(`账本 ${file}`);
  const all = [...history, entry];
  all.slice(-6).forEach((e, i, arr) => {
    const self = i === arr.length - 1 ? "  ← 本次" : "";
    lines.push(
      `  ${new Date(Number(e.atMs)).toISOString()}  ${jobLabel(e.cwd)}` +
        `  HEAD ${String(e.head ?? "-").slice(0, 8)}  .git ${fmtAge(e.gitAgeS)} 前${self}`,
    );
  });
  lines.push("");
  lines.push("== 结论（读数，不判红绿）==");
  lines.push(...reuseVerdict(history, entry));
  lines.push(...cacheVerdict(facts));
  return lines;
}

/* 判「是不是直接执行」的写法与 `python-probe.mjs` 逐字相同：拼 `file://${argv[1]}`
 * 在 Windows 上恒不相等，于是本脚本一行都不打就退 0 —— 而它存在的意义正是把这一格打出来。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  for (const line of workspaceProbeLines()) {
    console.log(line);
  }
  process.exit(0);
}
