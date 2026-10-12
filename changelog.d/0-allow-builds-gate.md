## Added

- **给 AGENTS 硬规则 8 补上了它缺的那个执行者**（新增 `scripts/check-allow-builds.cjs`、
  接线在 `.githooks/pre-commit` 的 D 组、规范 §13.5.15、自测 `tests/check-allow-builds.test.ts`）：
  判「每个**已安装**且带 `preinstall` / `install` / `postinstall` 的包，都在
  `pnpm-workspace.yaml` 的 `allowBuilds` 里有一条显式条目」。这条此前只被当**输入**读两次
  （`check-deps-freshness.mjs` 判新鲜度、`check-type-assertion-executor.cjs` 解释为什么不引
  `jsonc-parser`），没有任何一处判过「在不在名单里」。
  **为什么值得每次提交都响**：漏登记的人当场看不出来（他自己的 `node_modules` 早装好了），
  第一次复现是下一个人跑非交互 `pnpm install --frozen-lockfile` 那一刻的
  `ERR_PNPM_IGNORED_BUILDS` —— 故障点与改动点不同人、中间还隔一次安装，而同族先例
  `check-app-version.cjs` 守的正是这一形状。
  **口径照 pnpm 自己抄**：它按**包名**批准（所以同名多版本共享一条条目），对名单里没有的
  构建脚本直接失败而不是警告；`true`（批准）与 `false`（显式拒绝）都算回答过，漏答才红。
  **刻意不判的两档**：① 名单里当前没有构建脚本的**反向条目**——现状 11 条里 8 条属于这种
  正当形态（`better-sqlite3` 显式 `false` 是因为 v13 改成随包附带 `prebuilds/`、却仍带
  `gypfile` 会触发一次必然失败又毫无产物的 `node-gyp rebuild`；`@prisma/*` 给可选 peer 覆盖
  留位），反向判红等于误报一片（§11.18.4）；② 该批准还是该拒绝——那是发布判断，
  与「同步更新名单」不是同一件事（§12.18）。
  **判据存量实测**：本仓 `node_modules/.pnpm` 1377 个安装条目里只有 **3 个**带构建脚本
  （`esbuild` / `core-js-pure` / `unrs-resolver`），**三个都已在名单里** ⇒ 存量 0，
  所以这一档**直接上硬闸、不配棘轮基线**（不必先还一笔旧账）。
  **缺依赖判红而不是跳过**：把「读不到扫描面」写成静默 `exit(0)`，判据会在一份依赖都没读的
  情况下报绿，那是 §13.5.12 那一族里最坏的一种；话术按硬规则 26 直接给出
  `pnpm install --frozen-lockfile` 那一条出口。
  **成本实测**：4.5s，零网络、零子进程，与 `check-non-null-assertions.cjs` /
  `check-comment-language.cjs` 同档（同为全树扫描那一类），不是离群值 —— 但正因为它是
  全树扫描，钩子里那一步带 `--staged`：**只在本次提交动了依赖面时才扫**（未命中打印
  「未触及依赖面」，与真扫过的 OK 可分；读不到暂存清单走 `exit 2` 而不是冒充跳过）。
  这与 ISSUE #1747 给 D 组两步全库扫描定的口径同源，也是 §13.5.12 那句「无条件挂上昂贵
  的判据 ⇒ 所有人开始 `--no-verify` ⇒ 判据归零」的直接推论。

- **依赖面清单抽成 `scripts/dependency-face.mjs`**（`check-deps-freshness.mjs` 改为 import 它）：
  两个消费者问的是同一个问题（「这次提交动没动依赖声明与安装规则」），所以共用一份；
  但没有直接 `import` 那份判据本体 —— 它的模块图带着 `lockfile/lock-diff.mjs`、
  `launcher-core/worktree.mjs` 一串下游，为一个三项常量拖进整条链，代价表现在门禁自测的
  临时工作区上（少拷一个就是 `ERR_MODULE_NOT_FOUND`，读起来像被测判据坏了）。
  就地抄第二份则是另一头的错：清单将来加第四项时本判据静默漏判（§12.12）。
  ⚠️ 它与 `check-docs-api.cjs` 的 `INPUT_RES` **刻意不共用**（那一份问的是 typedoc
  产物的输入面，含 `src/lib|server|trpc/**`），沿用的正是 `matchedDependencyFiles()`
  文件头里那条既有口径。
