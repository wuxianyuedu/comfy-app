/**
 * tests/helpers/gate-repo.ts — 门禁自测搭临时仓库、跑真判据脚本的唯一写法（16 份 `*-gate.test.ts` 手抄同一套
 * mkdtemp/copy/run/write/rm；漏 `cwd`、`status` 兜 1、漏 `stdio: pipe` 都静默）。收口：收尾交 vitest、工作区非模块级
 * `let`、脚本落点 `dir` 显式、三件事实分开交（`ran`/`status`/`spawnError`/`signal`，ISSUE #2405；`code`/`output` 值未改，`repo` per-test）。
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
 * 「这份沙箱能不能判」——平台档，与 `platform-fixtures` 的 `ON_WINDOWS` 同源：守卫文本要被
 * `tests/conditional-skip-registry.test.ts` 逐字认出（写完整表达式）。门禁自测必跑 git，Windows 节点上 git 索引锁让每条用例逼近 `testTimeout`（PR #2990 ×2 仍 60s）。
 * 判的是仓库脚本，超时给不出读数（§13.6.4）；收口在 `defineGateRepo` 的 `.skipIf`，代价是 Windows 那批整块不判、线索只有 `skipped`。
 */
export const SANDBOX_POSIX_ONLY = process.platform === "win32";

/**
 * 夹具工作区的**边界标记**：这份文件被拷进临时仓库，靠它把「临时仓库」与「夹具自己的检出」分开（ISSUE #2787）。
 * `mkdtempSync` 在系统临时目录，而 `src/**` 判据的 `require.resolve` 一路向上会捡到祖先目录的 `node_modules`（PR #2784：CI 的
 * `TMPDIR` 落在工作区里，捡到本仓 `pnpm-workspace.yaml`，`!scripts` 让 pnpm 转到仓库根、`ROOT` 变真仓库）；落最小 `package.json` 即成包根、上溯到此为止。
 */
const SANDBOX_PACKAGE_MARKER = '{"name":"gate-sandbox","private":true}\n';

/**
 * **按 `require("./x.cjs")` 递归补齐判据的同目录依赖**（临时仓库放好被测脚本之后调）：判据之间有依赖（`maskNonCode`、
 * `gate-scan-read.cjs`），缺一个的读数是 `MODULE_NOT_FOUND` + requireStack，像「判据坏了」其实是夹具少带。认两种同目录相对
 * 引用：CJS `require("./name.cjs")` 与 ESM `import/export … from "./name.mjs"`（含裸副作用）；落点在被引脚本目录，已存在的不覆盖（`place` 优先）。
 */
export function copyGateDeps(
  destScriptAbs: string,
  place?: (destAbs: string, sourceAbs: string) => void,
): void {
  const destDir = path.dirname(destScriptAbs);
  /** CJS 的 `require("./x.cjs")`（也认 `createRequire(…)("./x.cjs")`）、ESM 的 `import/export … from "./x.mjs"`，以及
   *  CJS 里 `require` 一个 ESM（Node 24 的 `require(esm)`，`check-doc-mirror-pairing.cjs` 要 `changed-scope.mjs`，ISSUE #2265）。
   *  路径允许 `/`：`changed-scope.mjs` 依赖链伸进 `scripts/base-check/` 与 `launcher-core/`，只认平铺名会让沙箱 import 时炸。 */
  const DEP_RES = [
    /require\w*\(\s*"\.\/(?<dep>[\w./-]+\.cjs)"\s*\)/g,
    /require\w*\(\s*"\.\/(?<dep>[\w./-]+\.mjs)"\s*\)/g,
    /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s+"\.\/(?<dep>[\w./-]+\.mjs)"/g,
    /(?:^|\n)\s*import\s+"\.\/(?<dep>[\w./-]+\.mjs)"/g,
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
    const names = DEP_RES.flatMap((re) => [...src.matchAll(re)].map((m) => m.groups?.dep ?? ""));
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
 * 「这些路径已经被谁写过了」——按**目录级**祖先链判断，不是整串相等：`copy` 常整目录拷（`scripts/lockfile`），而依赖链
 * 要其中的 `lock-diff.mjs`，只比整串时两者永不相交 ⇒ 文件被写两遍（ISSUE #2380 的 NUL 填充来源）。反方向也认：先落
 * 文件、后到的是它的父目录时，目录不许再整棵铺一遍，否则刚落的文件又被覆盖。
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
 * 子进程「**根本没跑到判据**」那一档的形状（ISSUE #2405）：只看退出码必然误判 —— `node` 报 `Cannot find module`
 * 退的也是 **1**，与「判据判出违规」同码，于是「夹具没配齐 / 脚本没拷进去 / 输出超 `maxBuffer`」全长成「门禁红了一个」，
 * 而下一动作完全不同（修夹具 vs 修被测形状）。`base-check.mjs` 对这一族早写过同一条区分。
 */
const NOT_STARTED_RE =
  /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|ENOBUFS|maxBuffer|heap out of memory/i;

/**
 * 跑一次判据脚本的结果。⚠️ `code` 单独**不构成判决** ——「判出越界」与「根本没跑起来」退的是同一个 1，
 * 断言前先过 `expectGateRan()`，看 `ran`/`status`/`spawnError`/`signal`。
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
   * 两条流的**原始值**：`output` 的约定是「成功 ⇒ 只有 stdout；失败 ⇒ 两流合并」，于是「退 0 但要在 stdout 上念一句」
   * 那类判据（降档声明、跳过说明）没法用 `output` 判（话落到 stderr 时会假绿，也断言不了「不在 stdout」）。
   * 取原值即可，不改 `output` 那条既有约定（全仓门禁自测挂在那上面）。
   */
  raw: { stderr: string; stdout: string };
  /** 结束它的信号名（win32 上一般为 `null` —— 那一平台上终止不产生信号退出码）。 */
  signal: string | null;
  /** spawn 层的错误原文（取 `error.message` 头 80 字符；`error.code` 在类型上并不存在）。 */
  spawnError: string | null;
  /** 原样退出码（`null` = 被信号杀或没起来）。 */
  status: number | null;
};

/**
 * 「没跑起来」必须**先被单独判掉**（ISSUE #2405，形状取自 #2329）：失败消息里同时交出退出码、spawn 错误、信号与
 * 两条流原值 —— 只留 `expected 1 to be 0` 那种断言，红的原因读不出来（#2287 那一族）。判 `code === 0` 前先调它；
 * 判 `code === 1` **更要**先调 —— 没跑起来时 `code` 恰好也是 1。
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
   * 在工作区里跑一次 `git`（`cwd` 已指向它）：分支守卫 / 格式棘轮这两份判据的**被测输入是 git 状态本身**
   * （HEAD 父提交数、基线是否被跟踪），所以夹具必须能造提交历史。收住这一层，各处
   * `git(["config", "commit.gpgsign", "false"])`（不配就被宿主全局配置坑）这类前置就不会被漏抄。
   */
  git: (...args: Array<string>) => void;
  /**
   * 把一个**已安装依赖**放进工作区（建目录 + 最小 `package.json`）：临时工作区在 `os.tmpdir()` 下，祖先目录里可能有
   * 任意项目的 `node_modules`，而 Node 模块解析**一路向上**，「探针说解析得到」可能是从工作区外捡来的（§12.16）。
   * 装上 `package.json` 后这个目录就是完整包根，`require.resolve` 不再上溯；造「声明了却解析不到」时别把缺的那份装进来。
   */
  installDep: (name: string, version?: string) => void;
  /** 往工作区里建一个空目录（脚本按目录存在与否决定扫不扫时用）。 */
  mkdir: (rel: string) => void;
  /** 从工作区里读回一个文件（判据会就地改文件时用）。 */
  read: (rel: string) => string;
  /** 删掉工作区里的一个文件/目录（造「文件不在」那一档用）。 */
  remove: (rel: string) => void;
  /**
   * 在工作区里跑一次那个判据脚本（`args` 追加在脚本名之后）。`overrides` 的键**覆盖**夹具级 `env`，值为 `undefined` 表示「这次不设它」，
   * 用于「沙箱里既没接缝、也没 node_modules」那档 —— 脚本的**环境本身就是被测输入**，只给固定 env 等于让「没设这个变量」永远测不到。
   * `cwd` 给「同一个脚本在另一种检出形态里跑」（ISSUE #2785）：判据根取 `process.cwd()` 时，链接工作树与主检出的差别长在「`.git` 是目录还是文件」。
   */
  run: (
    args?: Array<string>,
    overrides?: { cwd?: string; env?: Record<string, string | undefined> },
  ) => GateRunResult;
  /** 在工作区里写一个文件（自动建父目录），`rel` 是仓库相对路径。 */
  write: (rel: string, content: string) => void;
};

export type GateRepoOptions = {
  /**
   * 从源码仓库再拷进来的路径（`from` 相对仓库根，`to` 工作区相对路径；目录递归拷），`.cjs`/`.mjs` 这类**同级动态
   * 导入**的模块只能这么来。⚠️ 它与 `copyGateDeps` 会指到同一个落点，两条路径同写一份文件正是 Windows 上 NUL 填充的
   * 来源（ISSUE #2380）；现由 `placeSources()` 收口：**一条路径只写一次**，后到的不覆盖。
   */
  copy?: Array<{ from: string; to: string }>;
  /** 脚本在工作区里的落点：`"scripts"`（默认为此）或 `"root"`。 */
  dir?: "scripts" | "root";
  /** 预先建好的空目录（被扫目录）。 */
  dirs?: Array<string>;
  /**
   * 跑脚本时追加的环境变量：少数判据要 `NODE_PATH` 才找得到仓库 `node_modules`（如 `check-void-floats.cjs` 走 TS
   * AST），而临时工作区旁边没有它。这是**脚本真的依赖的输入**，收进选项比每处自己拼 `env` 更不容易漏
   * （漏了的表现是脚本 exit 2，看起来像门禁坏了）。
   */
  env?: Record<string, string>;
  /**
   * 工作区里预先放好的文件（相对路径 → 内容）：门禁脚本有的 `await import("./doc-facts.cjs")` 读文档事实、有的读
   * `docs/` 下那一行白名单 —— 这些是**脚本真的依赖的输入**，由调用点声明比每处 `beforeEach` 手动写更不容易漏
   * （漏了的表现是脚本 exit 2、看起来像门禁坏了）。
   */
  files?: Record<string, string>;
  /** `scripts/` 下那份判据脚本的文件名（如 `check-void-floats.cjs`）。 */
  script: string;
  /**
   * 就绪之后再补一步 —— 需要 `git init` 的工作区（分支守卫 / 格式棘轮）用。收在这一层是因为两份都要「先
   * `git init`、配身份与 `gpgsign=false`」，而抄第二遍最容易漏 `commit.gpgsign=false`（宿主全局开了签名时
   * commit 直接失败、报错指不到夹具）。
   */
  setup?: (repo: GateRepo) => void;
  /** `mkdtempSync` 的前缀；默认由脚本名推出来（去掉 `check-` 与扩展名）。 */
  workdir?: string;
};

/**
 * 命令式地搭一个门禁工作区（`defineGateRepo` 的 fixture 与本模块的调用点共用这一层）：跨判据的同形判据要在同一
 * 文件里循环换脚本，而 `defineGateRepo` 是「一个文件绑一个脚本」。建工作区/收尾抽成命令式、fixture 只是包装 ——
 * 抄第二份建法会漏 `chmod`（`--update` 落盘 EACCES）；调用点**必须**在 `finally` 里 `dispose()`，或让 vitest 代管。
 */
export function createGateRepo(options: GateRepoOptions): GateRepoHandle {
  const { script, dir = "scripts", dirs = [], workdir, env, files, copy, setup } = options;
  const scriptSource = path.join(REPO_ROOT, "scripts", script);
  const scriptRel = dir === "scripts" ? path.join("scripts", script) : script;
  const prefix = workdir ?? script.replace(/^check-/, "").replace(/\.(?:c|m)?js$/, "");

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
  /* 两条来路的源文件（用例声明的 `copy` + 按 import 追出来的同目录依赖）在这里一次落盘 —— **同一条路径只写一次**。
   * 为什么不能只定「先 copy 再 copyGateDeps」的顺序：两者本来就指得到同一落点（整目录 `scripts/lockfile` vs 依赖链里的
   * `./lockfile/lock-diff.mjs`），两条路径都伸手就写两遍 —— 反序在 Windows 留下 NUL 填充的 `lock-diff.mjs`
   * （`SyntaxError`，像判据坏了，实为夹具写重，ISSUE #2380）；正序只是埋雷。所以收口点是「谁拥有这条路径」：
   * 用例声明的 `copy`/`files` 先落并拥有，依赖链只补还没人写过的；归属按 `claims()` 的目录级祖先链算。 */
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
    remove: (rel) => {
      rmSync(abs(rel), { recursive: true, force: true });
    },
    read: (rel) => readFileSync(abs(rel), "utf8"),
    exists: (rel) => existsSync(abs(rel)),
    git: (...args) => {
      /* 显式传 `gitSandboxEnv()`：共享夹具自带隔离，不假定调用前有人做过全局清理（`tests/setup.ts` 覆盖用例，
       * 这里覆盖夹具的直接使用者）；「禁签名 + 身份」也在 `withSandboxGitConfig` 里，于是 `git("commit", …)` 直路与
       * `commit()` 同一处判据。**失败必须带上 git 自己那句话**：此前 `stdio: "ignore"`，环境故障（没配身份、git 不在
       * PATH）只剩一句「命令失败」，像夹具坏了 —— 正是「报错指不到夹具」（#1959 自托管节点首跑 7 条里 5 条如此）。
       * 现在把 stderr 拼进抛出消息，当场可读。 */
      try {
        execFileSync("git", args, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: gitSandboxEnv(),
        });
      } catch (error) {
        /* SAFETY: 类型断言已复核 */
        const e = error as {
          status?: number;
          stderr?: string;
          stdout?: string;
        };
        throw new Error(
          `夹具里 git ${args.join(" ")} 失败（cwd=${root}，退出码 ${e.status ?? "?"}）：${
            (e.stderr ?? e.stdout ?? "").trim() || "git 没有输出"
          }`,
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
      // oxlint-disable-next-line no-unnecessary-condition -- spawnSync 起不来时 stdout 运行时为 null，保留两流合一的原始形状
      const stdout = res.stdout ?? "";
      // oxlint-disable-next-line no-unnecessary-condition -- 同上：stderr 运行时也可能为 null
      const stderr = res.stderr ?? "";
      const both = `${stdout}${stderr}`;
      const status = typeof res.status === "number" ? res.status : null;
      return {
        code: status ?? 1,
        /* **退出码非 0 就合并两条流**，不是「只在 spawn 失败时合并」：多数断言是 `expect(code).toBe(1)` 后
         * `toContain(违规原文)`，而原文常在 **stderr**。旧 `execFileSync` 抛错才进 catch、非 0 一定抛 ⇒ 天然合过；
         * 换 `spawnSync` 后非 0 不算错误（`res.error` 是 `undefined`），照它判就静默只剩 stdout —— 消费者红成
         * 「门禁没报出那句话」，其实夹具丢了 stderr（硬规则 27「效应不许只转述自己的 stdout」）。 */
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
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * `createGateRepo()` 的返回值：工作区 + **必须调用的收尾**。显式返回 `dispose` 是因为命令式调用点（跨判据的
 * 表驱动用例）不在 vitest fixture 生命周期里、临时目录没人清 —— 让收尾是返回值的一部分，比在文档里写「记得 rmSync」可靠。
 */
export type GateRepoHandle = {
  dispose: () => void;
  repo: GateRepo;
};

/**
 * 造一个带 `repo` fixture 的 `test` —— 每个文件按自己的脚本调用一次。返回的 `test` 仍是 `test.extend` 的产物，
 * 可继续 `.extend`；`describe`/`beforeEach` 不随 `extend` 变，故本模块把它们**转发导出**，调用点一条 import 就够。
 */
export function defineGateRepo(options: GateRepoOptions) {
  /* **返回值必须单独接住**（实测踩过）：「求值了但没用」看起来像生效了，
   * 而 `.skipIf()` 恰恰是返回一个新的携带 `skip` 的 test —— 丢掉它等于什么都没做。
   * 单独一行接住，`no-unused-expressions` 那一族也就没有话说了。 */
  const declared = base.extend<{ repo: GateRepo }>({
    /* vitest 的 fixture 第一参必须是**解构形态**（传 `_fixtures` 会在运行时
     * FixtureParseError，实测）；而本 fixture 不依赖任何其它 fixture ——
     * 空解构是 API 约束，no-empty-pattern 在此属误报，禁用一行。
     * 台账：本仓此形态仅 tests/helpers 两文件四处（本处 + platform-fixtures ×3）。 */
    // oxlint-disable-next-line no-empty-pattern
    repo: async ({}, use) => {
      /* 收尾挂在 `use` 之后 —— 用例中途 throw 也跑（这是相对手写 `afterEach` 的收益）。 */
      const handle = createGateRepo(options);
      await use(handle.repo);
      handle.dispose();
    },
  });
  const test = declared.skipIf(SANDBOX_POSIX_ONLY);

  return { test, expect };
}
