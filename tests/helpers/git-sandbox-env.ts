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
 *
 * ## 第三类：**平台那一跑的改动面变量**（ISSUE #2787）
 *
 * `git` 会给钩子导出的只有上面那 7 个键；而平台那一跑还有另一族「只对当前这一跑
 * 成立」的读数 —— `CNB_PULL_REQUEST_TARGET_SHA` / `CNB_COMMIT` / `CNB_PULL_REQUEST_MERGE_SHA`
 * 等。它们不是 git 导出的，所以第一类清单收不到它们；但在**平台侧 PR 流水线**里
 * 它们确实会继承进测试进程，再继承进用例 spawn 的那份判据脚本。
 *
 * 后果比 git 那一族更隐蔽：`changed-scope.mjs` 的 `resolveBaseRef()` **优先认
 * `CNB_PULL_REQUEST_TARGET_SHA`**（那是 PR 事件的正确语义），于是临时仓库里那份判据
 * 脚本会拿**真实仓库的 sha** 去算临时仓库的改动面 —— 沙箱里根本没这个对象，判据
 * fail-closed 退 2。实测现场（PR #2784 的「受影响用例」那一格）是
 * `tests/check-format.test.ts` 的合并态收窄那两条：本机全绿、平台红成
 * `[format] 改动面没算出来：224a5a3d… 的 diff 没跑起来（浅克隆…）`，而那段文字一个字
 * 都不指向「你的环境里有个不属于这个沙箱的 sha」。
 *
 * ⇒ 与第一类同一处置：**剥掉**（子进程按 `process.env` 继承，删一次两处同时生效）。
 * 用例要造 PR 事件的形状时自己 `repo.run([...], { env: { … } })` 显式给 —— 那是被测输入，
 * 不是环境噪声。
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
 * 平台那一跑的 `CNB_*` 读数里，**会被判据当成「改动面基线」读**的那几个（ISSUE #2787，
 * 机制见文件头第三类）。
 *
 * 为什么不一律剥 `CNB_*`：本仓有用例**故意**读平台变量造形态（`CNB_PULL_REQUEST_IID`、
 * `CNB_PULL_REQUEST` 那一族判「这是不是 PR 事件」），一刀切会把那些用例的输入一起抽掉，
 * 且下一次新增变量又要回来改这张清单。这里只点「**会指向某一个具体 sha / 提交**」的那几个：
 * 临时仓库里它们必然不存在，判据只会 fail-closed 或者更糟 —— 拿别人的历史判自己。
 *
 * ⚠️ 新增消费者时两处同批：`scripts/changed-scope.mjs` 的 `resolveBaseRef()` /
 * `reconcileSyntheticMergeFace()` 读了哪个键，这里就得有一条。
 */
export const PLATFORM_RUN_ENV_KEYS = /* SAFETY: 类型断言已复核 */ [
  "CNB_PULL_REQUEST_TARGET_SHA",
  "CNB_PULL_REQUEST_MERGE_SHA",
  "CNB_COMMIT",
] as const;

/** 剥掉的**全部**继承键：git 那一族 + 平台改动面那一族。 */
export const SANDBOX_STRIPPED_ENV_KEYS = /* SAFETY: 类型断言已复核 */ [
  ...GIT_INHERITED_ENV_KEYS,
  ...PLATFORM_RUN_ENV_KEYS,
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

/**
 * 「剥掉继承的那一族，再落调用方显式给的那几项」—— 顺序是语义，收在这里只写一次。
 *
 * `extra` 里值为 `undefined` 的键表示**明确不要**（剥掉之后也别再加回来）。
 *
 * @param base 起始环境（通常是 `process.env`）
 * @param extra 调用方显式给的项
 * @returns 新环境（不改入参）
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
 * 「这一份沙箱**没有平台基座**」落在环境上的唯一写法（ISSUE #2797）。
 *
 * 为什么需要它：临时仓库是 `git init` 造的，平台那一跑给的 sha 在它里面根本不存在；
 * 而 `changed-scope.mjs` 的 `resolveBaseRef()` 优先认 `CNB_PULL_REQUEST_TARGET_SHA`
 * ⇒ 三点 diff 跑不动 ⇒ 判据 fail-closed 退 2。于是名字里写着「**本地那一档（没有平台
 * 旗标）**」的用例，在平台 PR 那一跑里验的其实是另一件事 —— 本机永远看不见
 * （本机没有那两个变量），平台上恒红。
 *
 * 为什么是**空串**而不是删键：判据那侧读的是 `env.X || 兜底链`。删键之后那个值本来就是
 * `undefined`，与「从没出现过」同形，而平台的环境会把它加回来；空串是一个**在场且
 * falsy** 的值，它说的是「这次运行确实没有平台基线」。
 *
 * `given` 里显式出现的键是**被测输入**，不许被这一档吃掉。
 *
 * @param env 目标环境（会被原地改写）
 * @param given 调用方显式给的变量（`gate-repo` 的 `overrides.env`）
 * @returns 同一份 `env`
 */
export function withNoPlatformBaseline(
  env: NodeJS.ProcessEnv,
  given: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  for (const key of PLATFORM_RUN_ENV_KEYS) {
    if (given[key] === undefined) {
      env[key] = "";
    }
  }
  return env;
}

/**
 * 给 `spawn` / `execFileSync` 用的、去掉了上述继承变量、并注入沙箱 git 配置的环境。
 *
 * **`extra` 在剥之后落**（顺序是语义，ISSUE #2799）：用例有时要把某一族当**被测输入**
 * 显式传进去（「目标 sha 只在 env 里」那类形状），而 `CNB_PULL_REQUEST_TARGET_SHA`
 * 恰好在剥离清单里 —— 先合并再剥会把调用方刚给的那一份也删掉，于是「我明明传了」与
 * 「它说没有」同时成立、README 里那句「在同名键处最后覆盖」也不再成立（实测：平台形态
 * 下 3 条 `expected 2 to be 0`，本机因为恰好有 `origin/master` 而看不出来）。
 *
 * 剥的仍然是**继承来的**那一份：不传就没有。
 *
 * @param extra 追加的变量（剥完之后落，同名键由此覆盖）
 * @returns 可直接交给子进程的 `env`
 */
export function gitSandboxEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  /* 顺序是语义：**先剥、后落 `extra`**（见上）。 */
  return withSandboxGitConfig(injectAfterStrip(process.env, extra));
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
