/** tests/helpers/git-sandbox-env.ts — 测试进程/临时仓库必须剥掉的继承 git 环境（隔离核心，单一出处，§12.18）。错漏形态：`git commit` 会给钩子进程导出 `GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE`，而 pre-commit 的 C 组正在钩子里跑 `vitest`，于是继承进测试与其 spawn 的子进程；
 * 临时目录里 `git init` / `git add` 时操作对象就成了调用方的真仓库（探针写进真索引，下次建 tree 报 `invalid object` + `Error building trees`，报错不指向那条测试）。
 * 两处都用：`tests/setup.ts` 在 worker 启动时删掉（覆盖全部用例与子进程），`gate-repo.ts` 仍显式传（共享夹具须自带隔离）；不在钩子里时两处都是无操作。
 * 另两件事：宿主全局 `commit.gpgsign=true` 时临时仓库造不出提交（签名器缺失三联报错），故用 `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` 把「禁签名 + 身份」注入环境（一处生效、覆盖被测脚本内部起的 git，不写配置文件）；
 * 平台 PR 流水线还会继承 `CNB_PULL_REQUEST_TARGET_SHA` 等（ISSUE #2787），`resolveBaseRef()` 优先认它 ⇒ 判据拿真仓库 sha 算临时仓库改动面、沙箱里没这个对象而 fail-closed 退 2。同样剥掉，用例要造 PR 形状时自己显式给 `env`。 */

/** 必须剥掉的继承变量：全部是 `git` 给自己的子进程（含钩子）导出的「仓库定位」线索。 */
/* SAFETY: 类型断言已复核 */
export const GIT_INHERITED_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
] as const;

/**
 * 平台那一跑的 `CNB_*` 里**会被判据当成「改动面基线」读**的那几个（ISSUE #2787，机制见文件头第三类）。为什么不
 * 一律剥 `CNB_*`：本仓有用例**故意**读平台变量造形态（`CNB_PULL_REQUEST_IID`、`CNB_PULL_REQUEST` 那族判「这是
 * 不是 PR 事件」），一刀切会抽掉那些输入，且下次新增变量又要回来改清单。这里只点「会指向某个具体 sha / 提交」的
 * 那几个：临时仓库里必然不存在，判据只会 fail-closed 或更糟（拿别人的历史判自己）。⚠️ 新增消费者时两处同批：`scripts/changed-scope.mjs` 的 `resolveBaseRef()` / `reconcileSyntheticMergeFace()` 读了哪个键，这里就得有一条。 */
/* SAFETY: 类型断言已复核 */
export const PLATFORM_RUN_ENV_KEYS = [
  "CNB_PULL_REQUEST_TARGET_SHA",
  "CNB_PULL_REQUEST_MERGE_SHA",
  "CNB_COMMIT",
] as const;

/** 剥掉的**全部**继承键：git 那一族 + 平台改动面那一族。 */
/* SAFETY: 类型断言已复核 */
export const SANDBOX_STRIPPED_ENV_KEYS = [
  ...GIT_INHERITED_ENV_KEYS,
  ...PLATFORM_RUN_ENV_KEYS,
] as const;

/**
 * 临时仓库里的 git 身份（`GIT_CONFIG_*` 注入的 `user.email` / `user.name`）。值是**常量**而不是 `process.env`
 * 里那份：这些提交只活在测试自造的临时仓库、用例结束连目录一起删，不需要也不该继承调用方身份（真身份写进 dump
 * 只会泄密）。 */
/* SAFETY: 类型断言已复核 */
export const SANDBOX_GIT_IDENTITY = {
  email: "gate@example.com",
  name: "gate",
} as const;

/** 注入给**所有**沙箱内 git 进程的配置项（键 → 值）。①`commit.gpgsign` / `tag.gpgsign` 关掉（宿主全局签名时临时
 * 仓库没有密钥与签名器，`git commit` 当场失败，失败信息指不到夹具）；②`user.*` 一并给（容器里 HOME 指向不存在
 * 的目录时宿主身份读不到）；③换行三项（`core.autocrlf` / `core.safecrlf` + `advice.…`）：宿主开着 `autocrlf=true`
 * 时每次 `git add` 往 stderr 打 warning，几十次量级盖满 CI 日志（不改变结论却是最易被读成「真红」的噪音），口径
 * 定在规范 §13.7 的 LF 入库档；④`gc.auto=0`（夹具仓库几十字节，自动 gc 只添非确定性）。⚠️ 不加会被判据读到的项。 */
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

/**
 * 「剥掉继承的那一族，再落调用方显式给的那几项」—— 顺序是语义，收在这里只写一次。`extra` 里值为 `undefined`
 * 的键表示**明确不要**（剥掉之后也别再加回来）；返回新环境，不改入参。
 */
function injectAfterStrip(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of SANDBOX_STRIPPED_ENV_KEYS) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

/**
 * 给 `spawn` / `execFileSync` 用的、去掉了继承变量并注入沙箱 git 配置的环境。**`extra` 在剥之后落**（顺序是语义，
 * ISSUE #2799）：用例有时要把某一族当**被测输入**显式传进去，而 `CNB_PULL_REQUEST_TARGET_SHA` 恰在剥离清单里 ——
 * 先合并再剥会把调用方刚给的那份也删掉，于是「我明明传了」与「它说没有」同时成立、README 的「同名键处最后覆盖」
 * 也不再成立（实测平台形态 3 条 `expected 2 to be 0`，本机因恰有 `origin/master` 看不出）。剥的仍只是**继承来的**那份：不传就没有；返回可直接交给子进程的 `env`。 */
export function gitSandboxEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  /* 顺序是语义：**先剥、后落 `extra`**（见上）。 */
  return withSandboxGitConfig(injectAfterStrip(process.env, extra));
}

/**
 * 把 `sandboxGitConfig()` 以 git 的 `GIT_CONFIG_COUNT` 机制挂进一份环境（原地改并返回）。为什么不是 `git -c`：那要
 * 写在**每一个** `git` 调用点上（夹具的 `git()` / `commit()` 与被测判据脚本内部自己起的 git 都在内），环境这一层
 * 才是全都能盖住的那处。`GIT_CONFIG_COUNT` 是 git 2.31 起的稳定接口，键值同 `git -c`（命令行级优先级，压得住全局
 * `.gitconfig`）。已有的 `GIT_CONFIG_COUNT`（调用方注入的）**排在其后**保留：不覆盖、不丢；返回同一份 `env`。 */
export function withSandboxGitConfig(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
  for (const key of SANDBOX_STRIPPED_ENV_KEYS) {
    delete process.env[key];
  }
}
