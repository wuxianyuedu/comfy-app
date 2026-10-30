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
