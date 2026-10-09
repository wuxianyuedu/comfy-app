/**
 * tests/helpers/gate-repo.ts — 「门禁自测」搭临时仓库、跑真判据脚本的唯一写法。
 *
 * 为什么需要它：本仓库的 `tests/check-*.test.ts` / `tests/*-gate.test.ts`（实测 16 份）
 * 判的全是同一件事 —— **把 scripts/ 下的判据脚本当黑盒，在一个只放了被测文件的临时
 * 仓库里跑一次，看它拦不拦、报不报**。于是每一份都手抄了一遍同样的四件套：
 *
 *   ① `let workdir = ""` + `beforeEach` 里 `mkdtempSync` → `copyFileSync(脚本）`
 *      → 建几个被扫目录；
 *   ② `function run(args = [])`：`execFileSync(process.execPath, [join(workdir, …脚本), …])`，
 *      catch 里把 `{status, stdout, stderr}` 归一成 `{ code, output }`；
 *   ③ `function write(rel, content)`：`mkdirSync(join(full, ".."))` + `writeFileSync`；
 *   ④ `afterEach` 里 `rmSync(workdir, { recursive: true, force: true })`。
 *
 * ② 这 15 份**逐字相同、只差脚本路径**（§12.12 的字面孪生；全仓唯一同形的另一处是
 * 判据脚本自己的 `--report` 归一）。抄第十六遍时出错的方式是静默的：少写 `cwd`、
 * `status` 当 `1` 兜底、忘了 `stdio: pipe`（子进程 stderr 直接漏进 vitest 输出），
 * 而每份单看都「没毛病」。
 *
 * ## 三条收口理由（不是「短一点」）
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
 *
 * ## 用法
 *
 * ```ts
 * const { test, expect } = defineGateRepo({
 *   script: "check-function-length.cjs",   // scripts/ 下那份（相对仓库根写全路径）
 *   dirs: ["src"],                          // 被扫目录，建空的即可
 *   workdir: "function-length-gate",        // mkdtemp 前缀（默认为脚本名）
 * });
 *
 * test("超长函数被拦住", ({ repo }) => {
 *   repo.write("src/a.ts", "export function big() {…}");
 *   const { code, output } = repo.run();
 *   expect(code).toBe(1);
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
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base, expect } from "vitest";

export { afterAll, afterEach, beforeAll, beforeEach, describe } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 跑一次判据脚本的结果 —— `code` 是子进程退出码，`output` 是 stdout+stderr 合并。 */
export interface GateRunResult {
  code: number;
  output: string;
}

/** 一个临时的「门禁工作区」：`dir` 是它，`write` 往里放文件，`run` 在里面跑那个脚本。 */
export interface GateRepo {
  /** 临时仓库根的绝对路径（脚本的 `cwd`）。 */
  dir: string;
  /** 在工作区里写一个文件（自动建父目录），`rel` 是仓库相对路径。 */
  write: (rel: string, content: string) => void;
  /** 往工作区里建一个空目录（脚本按目录存在与否决定扫不扫时用）。 */
  mkdir: (rel: string) => void;
  /** 删掉工作区里的一个文件/目录（造「文件不在」那一档用）。 */
  remove: (rel: string) => void;
  /**
   * 在工作区里跑一次那个判据脚本。`args` 追加在脚本名之后。
   *
   * `overrides` 里的键**覆盖**夹具级 `env`；值为 `undefined` 表示"这次不设它"
   * （用来造「沙箱里既没有接缝、也没有 node_modules」那一档 —— 见 `check-format`
   * 的 fail-closed 用例）。这不是顺手开的口子：判据脚本的**环境本身就是被测输入**，
   * 只给一个固定 env 就等于让「没设这个变量」那一档永远测不到。
   */
  run: (
    args?: string[],
    overrides?: { env?: Record<string, string | undefined> },
  ) => GateRunResult;
  /** 从工作区里读回一个文件（判据会就地改文件时用）。 */
  read: (rel: string) => string;
  /**
   * 在工作区里跑一次 `git`（`cwd` 已指向它）。
   *
   * 为什么放在这里：分支守卫 / 格式棘轮这两份判据的**被测输入是 git 状态本身**
   * （HEAD 父提交数、基线是否被跟踪），所以夹具必须能造提交历史。收住这一层，
   * 各处的 `git(["config", "commit.gpgsign", "false"])` 这类「不配就会被宿主
   * 全局配置坑到」的前置就不会被漏抄。
   */
  git: (...args: string[]) => void;
  /** 造一次提交（`add -A` + commit）—— 上手身份与禁签名在本夹具里已配好。 */
  commit: (message: string) => void;
}

export interface GateRepoOptions {
  /** `scripts/` 下那份判据脚本的文件名（如 `check-void-floats.cjs`）。 */
  script: string;
  /** 脚本在工作区里的落点：`"scripts"`（默认为此）或 `"root"`。 */
  dir?: "scripts" | "root";
  /** 预先建好的空目录（被扫目录）。 */
  dirs?: string[];
  /** `mkdtempSync` 的前缀；默认由脚本名推出来（去掉 `check-` 与扩展名）。 */
  workdir?: string;
  /**
   * 工作区里预先放好的文件（相对路径 → 内容）。
   *
   * 为什么需要：门禁脚本有的会 `await import("./doc-facts.cjs")` 去读文档事实、
   * 有的要读 `docs/` 下那一行白名单 —— 这些是**脚本真的依赖的输入**，
   * 由调用点声明比每处自己 `beforeEach` 里手动写更不容易漏（漏了的表现是
   * 脚本 exit 2、看起来像门禁坏了）。
   */
  files?: Record<string, string>;
  /**
   * 从源码仓库再拷贝进来的路径（`from` 是相对仓库根，`to` 是工作区相对路径；
   * 目录会递归拷）。`.cjs` / `.mjs` 这类**同级动态导入**的模块只能这么来。
   */
  copy?: Array<{ from: string; to: string }>;
  /**
   * 就绪之后再补一步 —— 需要 `git init` 的工作区（分支守卫 / 格式棘轮）用。
   *
   * 为什么收在这一层而不是各自 `beforeEach`：这两份的共同点是「先把临时仓库
   * `git init` 好、配上身份与 `gpgsign=false`」—— 抄第二遍时最容易漏的是
   * `commit.gpgsign=false`（宿主全局开了签名时 commit 直接失败，报错指不到夹具）。
   */
  setup?: (repo: GateRepo) => void;
  /**
   * 跑脚本时追加的环境变量。
   *
   * 为什么需要：少数判据脚本要 `NODE_PATH` 才找得到仓库的 `node_modules`
   * （如 `check-void-floats.cjs` 走 TS AST），而临时工作区旁边没有它。
   * 这不是「顺手多给一个口子」——它是**脚本真的依赖的输入**，收进选项比
   * 每处自己拼 `env` 更不容易漏（漏了的表现是脚本 exit 2，看起来像门禁坏了）。
   */
  env?: Record<string, string>;
}

/**
 * 造一个带 `repo` fixture 的 `test` —— 每个文件按自己的脚本调用一次。
 *
 * 返回的 `test` 仍是 `test.extend` 的产物，可以继续 `.extend` 出文件自己的夹具。
 * `describe` / `beforeEach` 这些不随 `extend` 变，所以调用点仍需从 vitest 取 ——
 * 本模块把它们**转发导出**，调用点一条 import 就够。
 */
export function defineGateRepo(options: GateRepoOptions) {
  const {
    script,
    dir = "scripts",
    dirs = [],
    workdir,
    env,
    files,
    copy,
    setup,
  } = options;
  const scriptSource = path.join(REPO_ROOT, "scripts", script);
  const scriptRel = dir === "scripts" ? path.join("scripts", script) : script;
  const prefix =
    workdir ?? script.replace(/^check-/, "").replace(/\.(c|m)?js$/, "");

  const test = base.extend<{ repo: GateRepo }>({
    repo: async ({}, use) => {
      const root = mkdtempSync(path.join(tmpdir(), `${prefix}-gate-`));
      const scriptDir = path.dirname(path.join(root, scriptRel));
      mkdirSync(scriptDir, { recursive: true });
      /* 权限位显式补齐：某些沙箱 / 受限 umask 下新建目录是 `drwxr-xr-x`，
       * 而门禁脚本会用 `--update` 就地落盘基线 —— 那一步会 EACCES 把用例
       * 误红成「门禁坏了」。这条理由与 `symlink-dir.ts` 同族（环境噪声，
       * 不是被测行为），所以收进共用件，而不是留给第十六个人再踩一次。 */
      chmodSync(scriptDir, 0o777);
      copyFileSync(scriptSource, path.join(root, scriptRel));
      chmodSync(path.join(root, scriptRel), 0o755);
      for (const d of dirs) mkdirSync(path.join(root, d), { recursive: true });

      const abs = (rel: string) => path.join(root, rel);
      const put = (rel: string, content: string) => {
        mkdirSync(path.dirname(abs(rel)), { recursive: true });
        writeFileSync(abs(rel), content);
      };
      for (const [rel, content] of Object.entries(files ?? {}))
        put(rel, content);
      for (const { from, to } of copy ?? []) {
        const dest = abs(to);
        mkdirSync(path.dirname(dest), { recursive: true });
        cpSync(path.join(REPO_ROOT, from), dest, { recursive: true });
      }

      const api: GateRepo = {
        dir: root,
        write: put,
        mkdir: (rel) => mkdirSync(abs(rel), { recursive: true }),
        remove: (rel) => rmSync(abs(rel), { recursive: true, force: true }),
        read: (rel) => readFileSync(abs(rel), "utf8"),
        git: (...args) => {
          execFileSync("git", args, { cwd: root, stdio: "ignore" });
        },
        commit: (message) => {
          /* `-c` 就地给身份与禁签名：宿主可能全局开了 `commit.gpgsign`，
           * 临时仓库里没有可用密钥 —— 那一档失败信息指不到夹具（同
           * `symlink-dir.ts` 那一族：环境噪声不该被读成被测行为）。 */
          execFileSync(
            "git",
            [
              "-c",
              "commit.gpgsign=false",
              "-c",
              "user.email=gate@example.com",
              "-c",
              "user.name=gate",
              "commit",
              "-qm",
              message,
            ],
            { cwd: root, stdio: "ignore" },
          );
        },
        run: (args = [], overrides) => {
          const callEnv: NodeJS.ProcessEnv = {
            ...process.env,
            ...env,
            ...overrides?.env,
          };
          for (const [k, v] of Object.entries(overrides?.env ?? {})) {
            if (v === undefined) delete callEnv[k];
          }
          try {
            const output = execFileSync(
              process.execPath,
              [abs(scriptRel), ...args],
              {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                env: callEnv,
              },
            );
            return { code: 0, output };
          } catch (error) {
            const e = error as {
              status?: number;
              stdout?: string;
              stderr?: string;
            };
            return {
              code: typeof e.status === "number" ? e.status : 1,
              output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
            };
          }
        },
      };
      setup?.(api);

      await use(api);

      /* 收尾挂在 `use` 之后 —— 用例中途 throw 也跑（这是相对手写 `afterEach` 的收益）。 */
      rmSync(root, { recursive: true, force: true });
    },
  });

  return { test, expect };
}
