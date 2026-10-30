## Fixed

- **沙箱夹具不再继承平台那一跑的改动面变量（ISSUE #2787）**：`PR #2784` 的「受影响用例」
  那一格红了 2 条（`tests/check-format.test.ts` 的合并态收窄那组），而同一份代码本机全绿。
  现场读数是判据自己的 fail-closed 那句：

  ```
  [format] 改动面没算出来：224a5a3d80a640be6b7228eceeb176b4fa3730b8 的 diff 没跑起来
           （浅克隆 / 该 sha 不在本地对象库里；先 fetch 再跑）
  ```

  根因两层，都在**夹具**、都不在被测判据：

  ① **平台变量穿进了临时仓库**。`tests/helpers/git-sandbox-env.ts` 只剥 `git commit` 导出
  给钩子的那 7 个键，而 PR 流水线里 `CNB_PULL_REQUEST_TARGET_SHA` / `CNB_COMMIT` /
  `CNB_PULL_REQUEST_MERGE_SHA` 也一路继承进测试进程、再进用例 spawn 的判据脚本。
  `changed-scope.mjs` 的 `resolveBaseRef()` **优先认**第一个（那是 PR 事件的正确语义），
  于是临时仓库里那份脚本拿**真仓库的 sha** 去算自己的改动面 —— 沙箱里没有这个对象 ⇒ 退 2。
  ⇒ 清单拆成三栏（git 一族 / 平台改动面一族 / 两者并集），两个出口（`gitSandboxEnv()` 与
  `stripInheritedGitEnv()`）剥**同一张并集**。

  ② **临时仓库没有解析边界**。夹具建在 `os.tmpdir()` 下，而 `src/**` 的判据走
  `require.resolve` / TS `moduleResolution`，解析是**一路向上**的：CI 的 `TMPDIR` 落在工作区
  里面，沙箱于是捡到本仓的 `pnpm-workspace.yaml`，其 `packages` 的 `!scripts` 把脚本目录
  从工作区里剔掉、pnpm 转而在**仓库根**执行 —— 脚本的 `ROOT = process.cwd()` 就变成真仓库
  （真 `HEAD`、真 `MERGE_HEAD`，都不归这个用例管）。本机 `/tmp` 在仓库外，所以这一格
  只有 CI 能撞。⇒ 工作区根落一份最小 `package.json` 当边界标记（与 `installDep`
  那段「建目录 + `package.json` 就封住了解析边界」同一条判据）。

  两层的分工**实测过**（不是推断）：只撤 ① ⇒ 那 2 条当场红回现场那两行；只撤 ② ⇒ 本机仍绿。
  ① 有回归判据（`tests/git-sandbox-env.test.ts` 第 ④ 档，变异复演：撤掉并集那一行即红），
  ② 是夹具的边界修复、本机不可复现，记在这里供下一次 CI-only 红时对照。

  两处都不动判据：`changed-scope.mjs` / `check-format.cjs` 一个字没改。

## Fixed（第二现场：ISSUE #2788）

- **`check:premerge --only=claims` 在平台节点上取不到区间端点，那一段恒退 2**。第一轮修完
  沙箱那两条之后，同一格换了一种红：`[commit-claims] 取不到要审的提交：「<分叉点>..HEAD」`。

  两个来源各自没错，但**不在同一份对象库上**：`premerge-check.mjs` 的 `ROOT` 锚在**脚本自己的
  安装位置**（`path.resolve(HERE, "..")`），而 `runScript()` 也把子进程的 `cwd` 钉在那份检出上；
  `check-commit-claims.mjs` 的 `ROOT` 却是 `process.cwd()`。于是本入口若被 `cd` 进另一份检出跑，
  「算出来的分叉点」与「子进程找端点的那份仓库」是两个仓库 —— 端点在其中一份里根本不存在。

  修法：`claims` 那一格把口径收到一处 —— 锚点按 `process.cwd()` 算、子进程也按 `process.cwd()`
  起（`runScript()` 新增第 4 个可选 `cwd`，默认仍是 `ROOT`，`mergeLoss` 等既有各段一个字不动）。
  区间按 `--range` 显式交出去，不依赖子进程自己能不能读到 `CNB_PULL_REQUEST_TARGET_SHA`。

  判据：`tests/premerge-check.test.ts` 新增「平台那一格：目标 sha 只在 env 里时，`claims` 审的是
  **这批**而不是 `HEAD`」——在**没有任何 `master` 引用**的临时仓库里、目标 sha 只从 env 进来，
  整条链必须跑通并审到那一批。变异复演：只撤 `runScript()` 的 `cwd` 那一处 ⇒ 当场红成现场那行；
  恢复后全绿。
