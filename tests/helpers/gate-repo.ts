/**
 * tests/helpers/gate-repo.ts — 「门禁自测」搭临时仓库、跑真判据脚本的唯一写法。
 *
 * 为什么需要它：本仓库的 `tests/check-*.test.ts` / `tests/*-gate.test.ts`（实测 16 份）
 * 判的全是同一件事 —— **把 scripts/ 下的判据脚本当黑盒，在一个只放了被测文件的临时
 * 仓库里跑一次，看它拦不拦、报不报**。于是每一份都手抄了一遍同样的四件套：
 *
 *   ① `let workdir = ""` + `beforeEach` 里 `mkdtempSync` → `copyFileSync(脚本）`
 *      → 建几个被扫目录；
 *   ② `function run(args = [])`：`execFileSync(process.execPath, [join(workdir, …脚本), …])`
 *      包一层 `try/catch`，把子进程的 `{status, stdout, stderr}` 折成用例读的那两个数
 *      （共享件现在归一成六件 —— 下面「第四条收口理由」就是这件事为什么要六件）；
 *   ③ `function write(rel, content)`：`mkdirSync(join(full, ".."))` + `writeFileSync`；
 *   ④ `afterEach` 里 `rmSync(workdir, { recursive: true, force: true })`。
 *
 * ② 这 15 份**逐字相同、只差脚本路径**（§12.12 的字面孪生；全仓唯一同形的另一处是
 * 判据脚本自己的 `--report` 归一）。抄第十六遍时出错的方式是静默的：少写 `cwd`、
 * `status` 当 `1` 兜底、忘了 `stdio: pipe`（子进程 stderr 直接漏进 vitest 输出），
 * 而每份单看都「没毛病」。
 *
 * ## 四条收口理由（不是「短一点」）
 *
 * 1. **收尾由 vitest 保证**，不再靠手写 `afterEach`。fixture 的收尾挂在 `await use()`
 *    之后，用例中途 throw 也照样恢复（§11.16 对 `test.extend` 的那条口径）——
 *    手写 `afterEach` 是过程式的，新写一份忘了配就把临时目录留在 `tmpdir` 里。
 * 2. **工作区不再是模块级可变 `let`**。「这个文件当前的工作区」从「文件顶部一个会被
 *    反复改写的变量」变成用例签名里的入参，读用例时不必回溯 `beforeEach` 才敢确定
 *    `workdir` 此刻指向谁。
 * 3. **脚本落点（`scripts/` 还是仓库根）是显式入参**，不是各处复制时的偶然选择 ——
 *    它**是有语义的**：判据脚本有的用 `__dirname/..` 定扫描根（必须落在 `scripts/` 下），
 *    有的用 `process.cwd()`（落哪都一样）。这条差异收进 `dir` 选项，别再让第十六个人
 *    靠读脚本源码猜。
 * 4. **三件事实分开交，不在夹具层折叠**（ISSUE #2405）：旧形状是
 *    `catch { return { code: typeof e.status === "number" ? e.status : 1 } }` ——
 *    「判据判出违规（真红）」「脚本**没跑起来**（`ENOENT` / `ENOBUFS` / `Cannot find module`，
 *    它退的**也是 1**）」「被子进程信号杀」三类压成同一个数字，于是 `expect(code).toBe(1)`
 *    在第二类上**照样绿**、`expect(code).toBe(0)` 在第二类上红成「门禁拦了本该放行的形状」。
 *    `ran` + `status` + `spawnError` + `signal` 就是为了让这三类在账面上长得不一样，
 *    并由 `expectGateRan()` 单独判掉（口径同 §13.6.4「拿不到测量 ≠ 测量结果是红的」）。
 *    ⚠️ `code` / `output` 两个字段的**值一字未改**（成功仍只给 stdout）——
 *    这上面挂着全仓门禁自测的断言，改它们的读法等于改所有门禁自测，不在本单范围。
 *
 * ## 用法
 *
 * ```ts
 * import { defineGateRepo, expectGateRan } from "./helpers/gate-repo"; // 两件同取
 *
 * const { test, expect } = defineGateRepo({
 *   script: "check-function-length.cjs",   // scripts/ 下那份（相对仓库根写全路径）
 *   dirs: ["src"],                          // 被扫目录，建空的即可
 *   workdir: "function-length-gate",        // mkdtemp 前缀（默认为脚本名）
 * });
 *
 * test("超长函数被拦住", ({ repo }) => {
 *   repo.write("src/a.ts", "export function big() {…}");
 *   const r = repo.run();
 *   expectGateRan(r); // **先判「跑起来了」**，再判退码 —— 顺序反了就把②折回①
 *   expect(r.code, r.output).toBe(1);
 * });
 * ```
 *
 * ⚠️ **`repo` 是 per-test 的**（`scope: "test"`）：每一条用例拿到的是全新的空目录。
 * 这不是洁癖 —— 门禁脚本扫的是「工作区里有什么」，用例之间串文件会让「拦住了」变成
 * 「上一条的文件还在」。别把它升成 `file` / `worker` 档（实测也没收益：
 * mkdtemp + copy + rm 一轮 0.16ms，见规范 §11.16.1）。
 *
 * @module tests/helpers/gate-repo — 门禁自测的临时仓库 fixture（测试基建，不触碰 src 源码）
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, expect } from "vitest";

import { gitSandboxEnv, withSandboxGitConfig } from "./git-sandbox-env";

export { afterAll, afterEach, beforeAll, beforeEach, describe } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * 夹具工作区的**边界标记**：这个文件是被拷进临时仓库的，靠它把「临时仓库」与
 * 「夹具自己的检出」分开（ISSUE #2787）。
 *
 * 为什么需要它：`mkdtempSync(tmpdir(), …)` 建在系统临时目录下，而 `src/**` 的判据
 * 走 `require.resolve`／TS 的 `moduleResolution`，解析是**一路向上**的 —— 于是临时
 * 仓库里那份脚本会捡到**更上层目录**（`/tmp` 与它的祖先）里任意项目的 `node_modules`。
 * 现场（PR #2784）是 CI 的 `TMPDIR` 落在工作区**里面**，于是沙箱捡到了本仓自己的
 * `node_modules/pnpm-workspace.yaml`，`pnpm-workspace.yaml` 的 `packages` 里那句
 * `!scripts` 把脚本目录从工作区里剔掉，pnpm 转而在**仓库根**执行 —— 脚本的
 * `ROOT = process.cwd()` 就变成了真仓库：真仓库的 `HEAD`、真仓库的 `MERGE_HEAD`
 * 都不归这个用例管，红出来的是 `[format] 改动面没算出来：<真 sha> 的 diff 没跑起来`。
 * 本机 `/tmp` 在仓库外面，所以这一格本机永远绿、只有 CI 红。
 *
 * 落一份最小 `package.json` 之后这个目录就是**包根**，上溯到此为止（与 `installDep`
 * 那段「建目录 + 最小 package.json 就封住了解析边界」同一条判据）。
 */
const SANDBOX_PACKAGE_MARKER = '{"name":"gate-sandbox","private":true}\n';

/**
 * **按 `require("./x.cjs")` 递归补齐判据的同目录依赖**（临时仓库里已放好那份脚本之后调）。
 *
 * 判据之间是有依赖的（`maskNonCode` 那一份，以及扫描面共用的 `gate-scan-read.cjs`），
 * 而临时仓库只放得下「被测那一份脚本」时，跑起来的读数是 `MODULE_NOT_FOUND` +
 * 一叠 requireStack —— 它长得像「判据坏了」，实际是夹具少带了一个文件。
 * 从前是每份用例自己写一行 `DEP`（`tests/test-sleep-gate.test.ts:42`），于是
 * 「加一层共用依赖」= 十几份用例各自记得补一遍，漏的那份不会报「忘带依赖」，
 * 只会报一条指向不存在的脚本名的红。
 *
 * **两种引用形态都认**（都必须是**同目录相对**：仓里判据之间的引用全是这一种）：
 *   · CJS：`require("./name.cjs")`；
 *   · ESM：`import … from "./name.mjs"` / `export … from "./name.mjs"`（含裸副作用
 *     `import "./name.mjs"`）。
 * 第二种是 tw4 那两份工具（`.mjs`）抽共享内核（`tw4-scan-core.mjs`）时才补的：
 * 只认 `require` 时它们跑起来就是 `ERR_MODULE_NOT_FOUND` + 一叠加载栈，
 * 长得像「判据坏了」，实际是夹具少带了一个文件（与第一段说的问题同一族）。
 *
 * 落点固定在被引脚本自己所在的目录。**已存在的目标不覆盖**（用例自己写的夹具优先，
 * 见 `place` 那条）。
 *
 * @param destScriptAbs 工作区里那份判据脚本的绝对路径
 * @param place 落盘一条源文件（**目标绝对路径** → 源码绝对路径）。
 *   `createGateRepo` 传它自己的收口版本（用例声明的 `copy` 已经占过的路径不再写）；
 *   直接调本函数的命令式调用点（`check-file-structure` / AST 聚合那几份）不传，
 *   退回「临时工作区里已经有的就不覆盖」——两者判据同一条，只是前者的「已经有的」
 *   还包含**同一轮刚要落的那些**（ISSUE #2380 记的那条双写）。
 */
export function copyGateDeps(
  destScriptAbs: string,
  place?: (destAbs: string, sourceAbs: string) => void,
): void {
  const destDir = path.dirname(destScriptAbs);
  /** CJS 的 `require("./x.cjs")`（也认 `createRequire(…)("./x.cjs")` 那一形）、
   *  ESM 的 `import/export … from "./x.mjs"`。
   *
   *  **CJS 里 require 一个 ESM 模块**也是一形（Node 24 的 `require(esm)`）——
   *  `scripts/check-doc-mirror-pairing.cjs` 就是它：那条判据要 `changed-scope.mjs`
   *  的基线判决面（ISSUE #2265），而 `changed-scope.mjs` 是 ESM。
   *
   *  路径里允许 `/`（`./base-check/git-ref.mjs` 那一类）：`changed-scope.mjs` 的
   *  依赖链会伸进 `scripts/base-check/` 与 `scripts/launcher-core/`，只认平铺的名字
   *  ⇒ 沙箱里那份 `changed-scope.mjs` 会在 import 时炸掉（模块找不到），
   *  而那会表现成「这条判据在沙箱里红了」，与它真正在判的东西无关。 */
  const DEP_RES = [
    /require\w*\(\s*"\.\/([\w./-]+\.cjs)"\s*\)/g,
    /require\w*\(\s*"\.\/([\w./-]+\.mjs)"\s*\)/g,
    /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s+"\.\/([\w./-]+\.mjs)"/g,
    /(?:^|\n)\s*import\s+"\.\/([\w./-]+\.mjs)"/g,
  ];
  const pending = [destScriptAbs];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const abs = pending.shift()!;
    if (seen.has(abs)) {
      continue;
    }
    seen.add(abs);
    const src = readFileSync(abs, "utf8");
    const names = DEP_RES.flatMap((re) => [...src.matchAll(re)].map((m) => m[1]!));
    for (const name of names) {
      const source = path.join(REPO_ROOT, "scripts", name);
      const dest = path.join(destDir, name);
      if (!existsSync(source)) {
        continue;
      }
      /* 已存在的目标**不覆盖**（用例自己写的夹具 / `DEP` 那份优先），但仍然要**走进去**
       * 看它自己还有什么依赖 —— 只补「缺的文件」而不遍历已有文件，会在
       * 「脚本 A + 手工带上的 B」这种布局里漏掉 B 的传递依赖（实测就撞上过一次：
       * `check-test-sleep` 与 `check-test-concurrency` 都在场，而它们共用的
       * `gate-scan-read` 谁都没带进去）。 */
      if (!existsSync(dest)) {
        if (place) {
          /* 交出**绝对目标路径**而不是名字：`name` 是相对被引脚本所在目录的
           * （`./lockfile/lock-diff.mjs`），由 `place` 自己换算成工作区相对路径 ——
           * 只有它知道工作区根在哪（`copy` 的 `to` 本来就是工作区相对路径，
           * 两条来路的坐标系不同，收口在一处才换算得对）。 */
          place(dest, source);
        } else {
          /* 子目录（`./base-check/git-ref.mjs` 那一类）要先有目录，否则落盘就失败。 */
          mkdirSync(path.dirname(dest), { recursive: true });
          copyFileSync(source, dest);
          chmodSync(dest, 0o755);
        }
      }
      pending.push(dest);
    }
  }
}

/**
 * 「这些路径已经被谁写过了」—— **目录级**判断，不是整串相等。
 *
 * 为什么必须按目录算：用例声明的 `copy` 常整目录拷（`{ from: "scripts/lockfile", … }`），
 * 而依赖链要的是目录里的某一个文件（`scripts/lockfile/lock-diff.mjs`）。只比整串相等时
 * 两者永远不相交，于是那个文件被写两遍 —— 正是 ISSUE #2380 那条 NUL 填充的来源。
 *
 * 反方向也认：先落的是文件、后到的是它的父目录（`copy` 里同时列了单文件与它所在的
 * 目录时）→ 那条目录不许再整棵铺一遍，否则刚落的文件又被覆盖一次。
 */
function claims(initial: Array<string>): {
  add: (rel: string) => void;
  covers: (rel: string) => boolean;
} {
  const owned: Array<string> = [...initial].map(normalizeRel);
  return {
    covers: (rel) => {
      const target = normalizeRel(rel);
      return owned.some(
        (o) => target === o || target.startsWith(`${o}/`) || o.startsWith(`${target}/`),
      );
    },
    add: (rel) => {
      owned.push(normalizeRel(rel));
    },
  };
}

/** 统一成 `a/b/c` 形状（`path.join` 在 Windows 上给 `a\b\c`，比较时会对不上）。 */
function normalizeRel(rel: string): string {
  return rel
    .split(path.sep)
    .join("/")
    .replace(/^\.?\//, "");
}

/**
 * 子进程「**根本没跑到判据**」那一档的形状（ISSUE #2405）。
 *
 * 只看退出码必然误判：`node` 报 `Cannot find module` 退的也是 **1**，与「判据判出违规」
 * 逐字同码 —— 于是「夹具没配齐 / 脚本没拷进去 / 输出超 `maxBuffer`」全部长成「门禁红了一个」，
 * 而它的下一动作完全不同（修夹具 vs 修被测形状）。`scripts/base-check.mjs` 对这一族
 * 早就写过同一条区分（`Cannot find package|module` / `ERR_MODULE_NOT_FOUND` 那一档）。
 */
const NOT_STARTED_RE =
  /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|ENOBUFS|maxBuffer|heap out of memory/i;

/**
 * 跑一次判据脚本的结果。
 *
 * ⚠️ `code` 单独**不构成判决** —— 「判出越界」与「根本没跑起来」退的是同一个 1，
 * 断言前先过 `expectGateRan()`，看 `ran` / `status` / `spawnError` / `signal`。
 */
export type GateRunResult = {
  /** 退出码（`status` 取不到时兜 `1` —— **所以它单独不能当判决**，看 `ran`）。 */
  code: number;
  /** 跑成功时是 stdout；失败时是两条流合并（#2287：失败时哪一条有内容没人知道）。 */
  output: string;
  /**
   * 子进程**真的跑到过判据脚本**。`false` ⇒ 这一格**不构成判决**：
   * 既不许被读成「判据红了」，也不许被读成「这个形状放行了」（§13.6.4）。
   */
  ran: boolean;
  /**
   * 两条流**分开**的原值。
   *
   * 为什么需要它：`output` 的形状是「成功 ⇒ 只有 stdout；失败 ⇒ 两流合并」，
   * 于是「退 0 但要在 stdout 上念一句话」那类判据（降档声明、跳过说明）没法用
   * `output` 判 —— 那句要是只落在 stderr，`output` 里根本没有它，断言会假绿；
   * 反过来想断言「这句话**不在** stdout」也做不到。取两条流原值即可，不改 `output`
   * 那条既有约定（全仓门禁自测都挂在那上面）。
   */
  raw: { stderr: string; stdout: string; };
  /** 结束它的信号名（win32 上一般为 `null` —— 那一平台上终止不产生信号退出码）。 */
  signal: string | null;
  /** spawn 层的错误原文（取 `error.message` 头 80 字符；`error.code` 在类型上并不存在）。 */
  spawnError: string | null;
  /** 原样退出码（`null` = 被信号杀或没起来）。 */
  status: number | null;
}

/**
 * 「没跑起来」必须**先被单独判掉**（ISSUE #2405，形状取自 #2329 的参照实现）。
 * 失败消息里把退出码、spawn 错误、信号与两条流原值一起交出去 ——
 * 只留 `expected 1 to be 0` 那种断言，红的原因读不出来（#2287 那一族）。
 *
 * 用法：判「放行」那一类断言（`code === 0`）之前先 `expectGateRan(r)`；
 * 判「拦住」那类（`code === 1`）**更要**先调它 —— 没跑起来时 `code` 恰好也是 1。
 */
export function expectGateRan(r: GateRunResult): void {
  /** vitest 的 `expect` 在这里直接用（不依赖 fixture 实例）。 */
  expect(
    r.ran,
    `判据脚本**没跑起来**（status=${String(r.status)} · spawnError=${String(r.spawnError)} · ` +
      `signal=${String(r.signal)}）⇒ 这一格不构成判决，不是判据红。\n` +
      `--- 子进程两条流原值 ---\n${r.output}`,
  ).toBe(true);
}

/** 一个临时的「门禁工作区」：`dir` 是它，`write` 往里放文件，`run` 在里面跑那个脚本。 */
export type GateRepo = {
  /** 造一次提交（`add -A` + commit）—— 上手身份与禁签名在本夹具里已配好。 */
  commit: (message: string) => void;
  /** 临时仓库根的绝对路径（脚本的 `cwd`）。 */
  dir: string;
  /** 工作区里这个路径在不在（判「`--update` 到底有没有落盘」用，不必 `read` 再 catch）。 */
  exists: (rel: string) => boolean;
  /**
   * 在工作区里跑一次 `git`（`cwd` 已指向它）。
   *
   * 为什么放在这里：分支守卫 / 格式棘轮这两份判据的**被测输入是 git 状态本身**
   * （HEAD 父提交数、基线是否被跟踪），所以夹具必须能造提交历史。收住这一层，
   * 各处的 `git(["config", "commit.gpgsign", "false"])` 这类「不配就会被宿主
   * 全局配置坑到」的前置就不会被漏抄。
   */
  git: (...args: Array<string>) => void;
  /**
   * 把一个**已安装依赖**放进工作区（建目录 + 最小 `package.json`）。
   *
   * 为什么不能拿 `mkdir` 顶替：临时工作区在 `os.tmpdir()` 下面 —— 它的**祖先目录**
   * （`/tmp`、`<系统临时目录>`）里可能有任意项目的 `node_modules`，而 Node 的模块解析
   * 是**一路向上找**的，于是「探针说这个包解析得到」可能是从**工作区外**捡来的
   * （§12.16 同款：判据的输入边界没封住时，它给出的是环境噪声而不是被测结论）。
   * 装上 `package.json` 之后这个目录就是一个完整的包根，`require.resolve` 不再上溯。
   *
   * 造「声明了却解析不到」那一档时，**不要**把要缺的那一个也装进来 ——
   * 少了它就是缺件。
   */
  installDep: (name: string, version?: string) => void;
  /** 往工作区里建一个空目录（脚本按目录存在与否决定扫不扫时用）。 */
  mkdir: (rel: string) => void;
  /** 从工作区里读回一个文件（判据会就地改文件时用）。 */
  read: (rel: string) => string;
  /** 删掉工作区里的一个文件/目录（造「文件不在」那一档用）。 */
  remove: (rel: string) => void;
  /**
   * 在工作区里跑一次那个判据脚本。`args` 追加在脚本名之后。
   *
   * `overrides` 里的键**覆盖**夹具级 `env`；值为 `undefined` 表示"这次不设它"
   * （用来造「沙箱里既没有接缝、也没有 node_modules」那一档 —— 见 `check-format`
   * 的 fail-closed 用例）。这不是顺手开的口子：判据脚本的**环境本身就是被测输入**，
   * 只给一个固定 env 就等于让「没设这个变量」那一档永远测不到。
   *
   * `cwd` 是给**「同一个脚本在另一种检出形态里跑」**那一档用的（ISSUE #2785）：
   * 有些判据的根取的是 `process.cwd()`，而链接工作树与主检出的差别正好长在
   * 「那个根下面的 `.git` 是目录还是文件」上 —— 不换 cwd 就永远演不出那一形，
   * 脚本路径留在夹具里（它不需要出现在工作树里，`ROOT` 看的是 cwd）。
   */
  run: (
    args?: Array<string>,
    overrides?: { cwd?: string; env?: Record<string, string | undefined> },
  ) => GateRunResult;
  /** 在工作区里写一个文件（自动建父目录），`rel` 是仓库相对路径。 */
  write: (rel: string, content: string) => void;
}

export type GateRepoOptions = {
  /**
   * 从源码仓库再拷贝进来的路径（`from` 是相对仓库根，`to` 是工作区相对路径；
   * 目录会递归拷）。`.cjs` / `.mjs` 这类**同级动态导入**的模块只能这么来。
   *
   * ⚠️ **它与 `copyGateDeps` 会指到同一个落点**，而两条路径同时写一份文件是
   * Windows 上那份 NUL 填充脚本的来源（ISSUE #2380，见 `createGateRepo` 里那段）。
   * 现在由 `placeSources()` 一处收口：**一条路径只写一次**，后到的那条不许覆盖。
   */
  copy?: Array<{ from: string; to: string }>;
  /** 脚本在工作区里的落点：`"scripts"`（默认为此）或 `"root"`。 */
  dir?: "scripts" | "root";
  /** 预先建好的空目录（被扫目录）。 */
  dirs?: Array<string>;
  /**
   * 跑脚本时追加的环境变量。
   *
   * 为什么需要：少数判据脚本要 `NODE_PATH` 才找得到仓库的 `node_modules`
   * （如 `check-void-floats.cjs` 走 TS AST），而临时工作区旁边没有它。
   * 这不是「顺手多给一个口子」——它是**脚本真的依赖的输入**，收进选项比
   * 每处自己拼 `env` 更不容易漏（漏了的表现是脚本 exit 2，看起来像门禁坏了）。
   */
  env?: Record<string, string>;
  /**
   * 工作区里预先放好的文件（相对路径 → 内容）。
   *
   * 为什么需要：门禁脚本有的会 `await import("./doc-facts.cjs")` 去读文档事实、
   * 有的要读 `docs/` 下那一行白名单 —— 这些是**脚本真的依赖的输入**，
   * 由调用点声明比每处自己 `beforeEach` 里手动写更不容易漏（漏了的表现是
   * 脚本 exit 2、看起来像门禁坏了）。
   */
  files?: Record<string, string>;
  /** `scripts/` 下那份判据脚本的文件名（如 `check-void-floats.cjs`）。 */
  script: string;
  /**
   * 就绪之后再补一步 —— 需要 `git init` 的工作区（分支守卫 / 格式棘轮）用。
   *
   * 为什么收在这一层而不是各自 `beforeEach`：这两份的共同点是「先把临时仓库
   * `git init` 好、配上身份与 `gpgsign=false`」—— 抄第二遍时最容易漏的是
   * `commit.gpgsign=false`（宿主全局开了签名时 commit 直接失败，报错指不到夹具）。
   */
  setup?: (repo: GateRepo) => void;
  /** `mkdtempSync` 的前缀；默认由脚本名推出来（去掉 `check-` 与扩展名）。 */
  workdir?: string;
}

/**
 * 命令式地搭一个门禁工作区（`defineGateRepo` 的 fixture 与本模块的调用点共用这一层）。
 *
 * 为什么再开一个出口：跨多个判据的**同形判据**（「每一个棘轮的 `--update` 都拒涨」）
 * 需要在一个文件里循环换脚本 —— 而 `defineGateRepo` 是「一个文件绑一个脚本」的
 * （`test.extend` 的产物，按文件配 `script`）。把建工作区/收尾这两步抽成命令式，
 * fixture 只是它的一层包装，两侧共用同一份实现（抄第二份建法就会漏 `chmod` 那一条，
 * 表现是「沙箱里 `--update` 落盘 EACCES，用例红成像门禁坏了」）。
 *
 * 调用点**必须**在 `finally` 里 `dispose()`，或者用 `defineGateRepo` 那条路让 vitest 代管。
 */
export function createGateRepo(options: GateRepoOptions): GateRepoHandle {
  const { script, dir = "scripts", dirs = [], workdir, env, files, copy, setup } = options;
  const scriptSource = path.join(REPO_ROOT, "scripts", script);
  const scriptRel = dir === "scripts" ? path.join("scripts", script) : script;
  const prefix = workdir ?? script.replace(/^check-/, "").replace(/\.(c|m)?js$/, "");

  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-gate-`));
  /* 边界标记先落（上面 `SANDBOX_PACKAGE_MARKER` 那段）：它必须在任何「解析向上走」的
   * 判据起子进程**之前**就在盘上。 */
  writeFileSync(path.join(root, "package.json"), SANDBOX_PACKAGE_MARKER);
  const scriptDir = path.dirname(path.join(root, scriptRel));
  mkdirSync(scriptDir, { recursive: true });
  /* 权限位显式补齐：某些沙箱 / 受限 umask 下新建目录是 `drwxr-xr-x`，
   * 而门禁脚本会用 `--update` 就地落盘基线 —— 那一步会 EACCES 把用例
   * 误红成「门禁坏了」。这条理由与 `symlink-dir.ts` 同族（环境噪声，
   * 不是被测行为），所以收进共用件，而不是留给第十六个人再踩一次。 */
  chmodSync(scriptDir, 0o777);
  copyFileSync(scriptSource, path.join(root, scriptRel));
  chmodSync(path.join(root, scriptRel), 0o755);
  for (const d of dirs) {
    mkdirSync(path.join(root, d), { recursive: true });
  }

  const abs = (rel: string) => path.join(root, rel);
  const put = (rel: string, content: string) => {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), content);
  };
  for (const [rel, content] of Object.entries(files ?? {})) {
    put(rel, content);
  }
  /* 两条来路的源文件（用例声明的 `copy` + 按 import 追出来的同目录依赖）在这里
   * 一次落盘 —— **同一条路径只写一次**。
   *
   * 为什么不能「先 `copy` 再 `copyGateDeps`、或者反过来」了事：两者本来就指得到
   * 同一个落点（`copy` 常整目录拷 `{ from: "scripts/lockfile", … }`，而依赖链
   * 里写着 `./lockfile/lock-diff.mjs`），于是**只要两条路径都伸手，那个文件就被写
   * 两遍**。反过来的顺序在 Windows 节点上留下的是一份 **NUL 填充**的
   * `lock-diff.mjs`（`cpSync` 覆盖 `copyFileSync` 刚写过的那个文件），报错指向临时目录
   * 里的那一份、形态是 `SyntaxError: Invalid or unexpected token` —— 读起来像判据坏了，
   * 实际是夹具自己写重了（ISSUE #2380）。而正过来的顺序只是把这颗雷埋起来：
   * 判据将来在 `lockfile/` 里加一个 import，同一条路径又会被写两遍。
   *
   * 所以收口点不是顺序，是「谁拥有这条路径」：**用例声明的 `copy` / `files` 先落、
   * 拥有它**；依赖链只补**还没有人写过**的那些（判据新增一层依赖时照旧自动补齐）。
   * 落盘按「先到先写」计一次数，于是「同一路径写两遍」在结构上不可能再发生。
   *
   * 归属是**目录级**的（`claims()` 看祖先链）：`copy` 常只写 `scripts/lockfile/`
   * 这个**目录**，而依赖链要的是 `scripts/lockfile/lock-diff.mjs` —— 只比整串路径
   * 相等，那个文件就会被写第二遍，正是这条判据要拦下的形状。 */
  const claimed = claims(Object.keys(files ?? {}));
  /* 收口点：**一条工作区路径只写一次**。进来的两种传参坐标系不同（`copy` 给的是
   * 工作区相对路径、`copyGateDeps` 给的是绝对目标路径），这里统一折成工作区相对路径
   * 再判归属 —— 坐标系没收在一处时，「同一个文件写两遍」就永远判不出来。 */
  const place = (destAbs: string, sourceAbs: string) => {
    const rel = path.relative(root, destAbs);
    if (claimed.covers(rel)) {
      return;
    }
    claimed.add(rel);
    const dest = abs(rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(sourceAbs, dest, { recursive: true });
    /* 只有文件要补权限位：`--update` 那条路会就地落盘基线（与上面 `scriptDir`
     * 同一条理由 —— 受限 umask 下 EACCES 会被误读成「门禁坏了」）；补到目录上是
     * `EACCES`，所以判一下类型。 */
    if (statSync(dest).isFile()) {
      chmodSync(dest, 0o755);
    }
  };
  for (const { from, to } of copy ?? []) {
    place(abs(to), path.join(REPO_ROOT, from));
  }
  copyGateDeps(path.join(root, scriptRel), place);

  const api: GateRepo = {
    dir: root,
    write: put,
    mkdir: (rel) => mkdirSync(abs(rel), { recursive: true }),
    installDep: (name, version = "1.0.0") => {
      mkdirSync(abs(path.join("node_modules", name)), { recursive: true });
      put(
        path.join("node_modules", name, "package.json"),
        `{"name":"${name}","version":"${version}"}\n`,
      );
    },
    remove: (rel) => rmSync(abs(rel), { recursive: true, force: true }),
    read: (rel) => readFileSync(abs(rel), "utf8"),
    exists: (rel) => existsSync(abs(rel)),
    git: (...args) => {
      /* 显式传 `gitSandboxEnv()`：共享夹具要自带隔离，不假定调用它之前有人做过
       * 全局清理（`tests/setup.ts` 那一档覆盖用例，这里覆盖夹具的直接使用者）。
       * 「禁签名 + 身份」也在这份环境里（`withSandboxGitConfig`）—— 于是
       * `git("commit", …)` 这条直路与 `commit()` 走的是**同一处**判据，
       * 不再一处靠环境、一处靠 `-c` 三连。
       *
       * **失败时必须带上 git 自己的那句话**：此前这里是 `stdio: "ignore"`，
       * 于是「宿主没配 git 身份」「git 不在 PATH 上」这类**环境**故障在日志里
       * 只剩一句 vitest 的「命令失败」，读起来像夹具坏了 —— 正是本仓反模式表里
       * 「报错指不到夹具」的形态，只不过它藏的常常是**宿主机**（#1959 自托管节点
       * 首跑时，7 条超时/失败里有 5 条长得就是这样，而当时拿不到那句话，
       * 只能留作已知开口）。现在把 stderr 拼进抛出的消息里，让它当场可读。 */
      try {
        execFileSync("git", args, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: gitSandboxEnv(),
        });
      } catch (error) {
        const e = /* SAFETY: 类型断言已复核 */ error as {
          status?: number;
          stderr?: string;
          stdout?: string;
        };
        throw new Error(
          `夹具里 git ${args.join(" ")} 失败（cwd=${root}，退出码 ${e.status ?? "?"}）：` +
            `${(e.stderr ?? e.stdout ?? "").trim() || "git 没有输出"}`,
          { cause: error },
        );
      }
    },
    commit: (message) => {
      /* 只做 commit，**不**替调用点 `git add` —— `git add` 的粒度是用例的被测形状
       * 之一（`check-reformat-only` 与 `check-commit-claims` 都按暂存区判）。
       * 身份与禁签名由 `gitSandboxEnv()` 统一注入（见 `withSandboxGitConfig`），
       * 这里不再自己拼 `-c` 那三连。 */
      execFileSync("git", ["commit", "-qm", message], {
        cwd: root,
        stdio: "ignore",
        env: gitSandboxEnv(),
      });
    },
    run: (args = [], overrides) => {
      /* 基座环境先过 `gitSandboxEnv()`：被测判据自己也常调 git
       * （`readStagedPaths` / `git ls-files` 那一类），钩子里跑时同样不能
       * 让它看见调用方的 `GIT_DIR`。 */
      const callEnv: NodeJS.ProcessEnv = {
        ...gitSandboxEnv(env),
        ...overrides?.env,
      };
      for (const [k, v] of Object.entries(overrides?.env ?? {})) {
        if (v === undefined) {
          delete callEnv[k];
        }
      }
      /* 沙箱 git 配置**最后**再落一次：调用方的 `overrides.env` 里若恰好也有
       * `GIT_CONFIG_*`（合法用法），不能把这一层挤掉 —— 少了它被测判据脚本内部
       * 自己起的 git 就又回到「宿主开了签名 ⇒ 提交失败」那一档。 */
      withSandboxGitConfig(callEnv);
      /* `spawnSync` 而不是 `execFileSync`：后者在非零退出时只交出 `{status, stdout, stderr}`
       * 的一份错误，拿不到「被信号杀」那一格（ISSUE #2405 要分开的三件事之一）。
       * `code` / `output` 两格的**值与形状逐字保持原样**（成功 ⇒ stdout；失败 ⇒ 两流合并，
       * 退出码兜 `1`）—— 这上面挂着全仓门禁自测的断言，改它的读法就是改所有门禁自测。 */
      const res = spawnSync(process.execPath, [abs(scriptRel), ...args], {
        cwd: overrides?.cwd ?? root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: callEnv,
      });
      const stdout = res.stdout ?? "";
      const stderr = res.stderr ?? "";
      const both = `${stdout}${stderr}`;
      const status = typeof res.status === "number" ? res.status : null;
      return {
        code: status ?? 1,
        /* **退出码非 0 就合并两条流** —— 不是「只在 spawn 失败时合并」。
         * 本仓多数断言的形状是 `expect(code).toBe(1)` 之后再 `toContain(违规原文)`，
         * 而违规原文常常在 **stderr**（`console.error` 那一条路）。旧实现是
         * `execFileSync` 抛错才进 catch，非 0 退出**一定**抛 ⇒ 两条流天然被合过；
         * 换成 `spawnSync` 后非 0 退出**不算错误**（`res.error` 是 `undefined`），
         * 若照 `res.error` 判，这一格就静默只剩 stdout —— 于是消费者会红成
         * 「门禁没报出该有的那句话」，而它其实是夹具丢了 stderr
         * （硬规则 27 那句「效应不许只转述自己的 stdout」—— 丢 stderr 是这一族最重的事故）。 */
        output: status === 0 && !res.error ? stdout : both,
        raw: { stdout, stderr },
        ran: !res.error && status !== null && !NOT_STARTED_RE.test(both),
        status,
        spawnError: res.error ? res.error.message.slice(0, 80) : null,
        signal: res.signal ?? null,
      };
    },
  };
  setup?.(api);

  return {
    repo: api,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * `createGateRepo()` 的返回值：工作区 + **必须调用的收尾**。
 *
 * 为什么显式返回一个 `dispose` 而不是只给 `repo`：命令式调用点（跨判据的表驱动用例）
 * 不在 vitest 的 fixture 生命周期里，临时目录没人清 —— 让「收尾」是返回值的一部分，
 * 比在文档里写「记得 rmSync」可靠。
 */
export type GateRepoHandle = {
  dispose: () => void;
  repo: GateRepo;
}

/**
 * 造一个带 `repo` fixture 的 `test` —— 每个文件按自己的脚本调用一次。
 *
 * 返回的 `test` 仍是 `test.extend` 的产物，可以继续 `.extend` 出文件自己的夹具。
 * `describe` / `beforeEach` 这些不随 `extend` 变，所以调用点仍需从 vitest 取 ——
 * 本模块把它们**转发导出**，调用点一条 import 就够。
 */
export function defineGateRepo(options: GateRepoOptions) {
  const test = base.extend<{ repo: GateRepo }>({
    /* vitest 的 fixture 第一参必须是**解构形态**（传 `_fixtures` 会在运行时
     * FixtureParseError，实测）；而本 fixture 不依赖任何其它 fixture ——
     * 空解构是 API 约束，no-empty-pattern 在此属误报，禁用一行。
     * 台账：本仓此形态仅 tests/helpers 两文件四处（本处 + platform-fixtures ×3）。 */
    // eslint-disable-next-line no-empty-pattern
    repo: async ({}, use) => {
      /* 收尾挂在 `use` 之后 —— 用例中途 throw 也跑（这是相对手写 `afterEach` 的收益）。 */
      const handle = createGateRepo(options);
      await use(handle.repo);
      handle.dispose();
    },
  });

  return { test, expect };
}
