/**
 * tests/helpers/git-sandbox-env.ts — 测试进程/临时仓库必须剥掉的继承 git 环境。
 *
 * **这是本仓库测试夹具的隔离核心，收在这一处，不在每份用例里各写一份清单**（§12.18）。
 *
 * ## 为什么会污染
 *
 * `git commit` 会给它的钩子进程导出 `GIT_DIR`（以及 `GIT_INDEX_FILE` /
 * `GIT_WORK_TREE`）。而 pre-commit 的 C 组正是在钩子里跑 `vitest`，于是这份环境
 * 一路继承进测试进程、再继承进测试自己 spawn 的子进程。
 *
 * 只要用例在一个临时目录里跑 `git init` / `git add`，带着那份环境时**操作对象就不是
 * 临时仓库，而是调用方的真仓库**：探针文件被写进真仓库的索引，下一次建 tree 直接报
 * `invalid object '<那个路径>' for '<那个路径>'` + `Error building trees`——
 * 谁提交都提不动，而报错一个字都不指向那条测试。
 *
 * 机制可复现（不依赖任何具体测试）：给父仓库设 `GIT_DIR`，在别的目录 `git init` +
 * `git add -A`，父仓库索引立刻多出临时目录里的那些条目。
 *
 * ## 为什么两处都用它
 *
 * - `tests/setup.ts` 在 worker 启动时就从 `process.env` 里删掉它们 —— 这一处覆盖
 *   **所有**用例（实测 20 份用例文件自己起临时 git 仓库，逐个改不叫收口叫扩散），
 *   并且顺带覆盖它们 spawn 的子进程（子进程按 `process.env` 继承）；
 * - 夹具 `tests/helpers/gate-repo.ts` 仍然显式传 `gitSandboxEnv()` —— 共享夹具要
 *   自带隔离，不能假定调用它之前有人做过全局清理（它也被直接用在小工具里）。
 *
 * 正常跑 `pnpm test`（不在钩子里）时这些变量本就不存在，两处都是无操作 ——
 * 所以这一手在两个方向上都安全：不在钩子里无差别，在钩子里是唯一正确行为。
 */

/** 必须剥掉的继承变量：全部是 `git` 给自己的子进程（含钩子）导出的「仓库定位」线索。 */
export const GIT_INHERITED_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
] as const;

/** 给 `spawn` / `execFileSync` 用的、去掉了上述继承变量的环境。
 * @param extra 追加的变量（在同名键处最后覆盖）
 * @returns 可直接交给子进程的 `env` */
export function gitSandboxEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of GIT_INHERITED_ENV_KEYS) delete env[key];
  return env;
}

/** 就地从 `process.env` 删掉这些键 —— 测试 worker 启动时调用一次。
 *
 * 为什么改全局而不是每个 spawn 传 `env`：本仓库有用例把 git 环境透传给**被测判据
 * 脚本**，脚本内部又自己起 git；逐个 spawn 传 `env` 要改的地方比这份清单长得多，
 * 漏一个就是漏一个只在钩子里才复现的污染。删一次 `process.env` 对两者同时生效。 */
export function stripInheritedGitEnv(): void {
  for (const key of GIT_INHERITED_ENV_KEYS) delete process.env[key];
}
