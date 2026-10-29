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
 *
 * ## 第二件事：宿主全局开了签名时，临时仓库要造得出提交
 *
 * 构建机（以及本仓的 CNB 构建容器）全局 `.gitconfig` 里常带着
 * `commit.gpgsign = true` + `gpg.program = <平台专属签名器>`。临时仓库里既没有可用
 * 密钥、那个签名器也往往不在 PATH 上，于是 `git commit` **直接失败**，报的是签名器
 * 缺失的标准三联：`fatal: cannot run <signer>: …` / `error: gpg failed to sign the data` /
 * `fatal: failed to write commit object`。
 *
 * 报错一个字都不指向夹具 —— 实测在自托管 Windows 构建节点上，`merged-side-loss-gate`
 * 的 8 条用例就是这样整组红成「git commit 失败」，而同一份代码在本机全绿（本机那份
 * 签名器恰好在 PATH 上）。
 *
 * 修法不是在每个调用点补 `git -c commit.gpgsign=false`（**那是抄第二遍**，本仓已经
 * 抄出过三种写法：`git config commit.gpgsign false` / `-c` / `repo.commit` 的 `-c`
 * 三连，而 `repo.git("commit", …)` 那条直路一直漏着），而是用 git 自己的
 * `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` 机制把「禁签名 +
 * 身份」注入**环境**：凡经本函数起的 git 进程都拿得到，包括夹具起的那一次、被测判据
 * 脚本内部自己起的那些 —— 一处生效、无处可漏，且不占用任何配置文件的写权限。
 *
 * 身份同理：`user.name` / `user.email` 也一并注入，于是「宿主没配 git 身份」这一类
 * 噪声（容器里 HOME 指向不存在的目录时就是它）同样不必每个调用点各兜一遍。
 */

/** 必须剥掉的继承变量：全部是 `git` 给自己的子进程（含钩子）导出的「仓库定位」线索。 */
export const GIT_INHERITED_ENV_KEYS = /* SAFETY: 类型断言已复核 */ [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
] as const;

/**
 * 临时仓库里的 git 身份（`GIT_CONFIG_*` 注入的 `user.email` / `user.name`）。
 *
 * 值是**常量**而不是 `process.env` 里那一份：这些提交只活在测试自己造的临时仓库里、
 * 用例结束后连目录一起删，不需要、也不该继承调用方的身份（真身份写进 dump 只会泄密）。
 */
export const SANDBOX_GIT_IDENTITY = /* SAFETY: 类型断言已复核 */ {
  email: "gate@example.com",
  name: "gate",
} as const;

/**
 * 注入给**所有**沙箱内 git 进程的配置项（键 → 值）。
 *
 * 四组，各有各要压掉的那一类宿主配置：
 *
 * 1. `commit.gpgsign` / `tag.gpgsign` 关掉：宿主全局开了签名时，临时仓库里没有可用密钥
 *    与签名器，`git commit` 会当场失败（失败信息指不到夹具，见文件头）。
 * 2. `user.*` 一并给：容器里 HOME 指向不存在的目录时，宿主的全局身份也读不到。
 * 3. **换行三项**（`core.autocrlf` / `core.safecrlf` + `advice.…` 一族）：宿主若开着
 *    `core.autocrlf=true`，临时仓库里每一次 `git add` 都往 stderr 打一行
 *    `warning: in the working copy of '…', LF will be replaced by CRLF …`。测试夹具的
 *    `git add` 是几十次量级，于是那批 warning 盖满 CI 日志 —— 它**不改变任何结论**，
 *    却是 CI 里最容易被读成「真红」的那一种噪音。这里把仓库口径定在规范 §13.7 那一档
 *    （LF 入库、不做 autocrlf 改写），行为与 `git -c core.autocrlf=false add` 一致。
 *    `advice.…` 那一项压的是**其余** advice 出口（`addIgnoredFile` 等），
 *    临时仓库里它们同样只会变成噪音。
 * 4. `gc.auto=0`：夹具仓库总量几十个字节，自动 gc 只会给用例添非确定性。
 *
 * ⚠️ 不要往这里加「会被被测判据读到」的项 —— 这一层是**环境隔离**，不是判据输入。
 * （第 3 组是唯一贴着判据的：判据要验的正是「宿主开了 autocrlf 时夹具仍不出 warning」。）
 */
export function sandboxGitConfig(): Record<string, string> {
  return {
    "user.email": SANDBOX_GIT_IDENTITY.email,
    "user.name": SANDBOX_GIT_IDENTITY.name,
    "commit.gpgsign": "false",
    "tag.gpgsign": "false",
    "core.autocrlf": "false",
    "core.safecrlf": "false",
    "advice.addIgnoredFile": "false",
    "advice.detachedHead": "false",
    "gc.auto": "0",
  };
}

/** 给 `spawn` / `execFileSync` 用的、去掉了上述继承变量、并注入沙箱 git 配置的环境。
 * @param extra 追加的变量（在同名键处最后覆盖）
 * @returns 可直接交给子进程的 `env` */
export function gitSandboxEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of GIT_INHERITED_ENV_KEYS) delete env[key];
  return withSandboxGitConfig(env);
}

/**
 * 把 `sandboxGitConfig()` 以 git 的 `GIT_CONFIG_COUNT` 机制挂进一份环境（原地改并返回）。
 *
 * 为什么不是 `git -c`：那要写在**每一个** `git` 调用点上，而调用点既有夹具的
 * `git()` / `commit()`，也有被测判据脚本内部自己起的 git —— 环境这一层才是全都能盖住的
 * 那一处。`GIT_CONFIG_COUNT` 是 git 2.31 起的稳定接口，键值同 `git -c`（命令行级优先级，
 * 压得住全局 `.gitconfig`）。
 *
 * 已有的 `GIT_CONFIG_COUNT`（调用方自己注入的）会被**排在其后**保留：不覆盖、不丢。
 *
 * @param env 目标环境（会被原地改写）
 * @returns 同一份 `env`，方便链式使用
 */
export function withSandboxGitConfig(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const injected = sandboxGitConfig();
  const base = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  let index = base;
  for (const [key, value] of Object.entries(injected)) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
    index += 1;
  }
  env.GIT_CONFIG_COUNT = String(index);
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
