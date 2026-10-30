## Fixed

- **脚本档清账批 20：`scripts/check-pending-merge-loss.mjs` 5 格清零（同批补上一条能红的用例），
  账从 13 处 / 3 份降到 8 处 / 2 份**（ISSUE #2589 / 规范 §13.5.14.1）：
  这一份是 `.githooks/prepare-commit-msg` 那一路的「整份取一侧」硬闸。

  四格是形参（`git(args, input)` ×2、`printBlockedTip(lost)`、以及 `lost.forEach((f) => …)`
  跟着掉的那格）。**`git()` 那一处不只是「补个注解」**：这份函数是**当值传进共用内核**的
  （`historyByFile(git, …)` / `resolveBlobs(git, specs)`），内核声明的契约是
  `(args: string[], input?: string) => (string | null)` —— 边界上留隐式 any，那份契约就被
  整个抹掉：少传一个参数、返回值折成别的形状，类型层一个字都不会报。这一格与 ISSUE #2724
  （`db-push-core` 的注入点契约）是同一族的两面：那边是**契约写得比实现宽**（要求注入者伪造
  没人读的字段），这边是**边界上不写契约**（契约在场但没人核）。

- **`hist.get(f)` 那一格顺手把它的生产端保证钉到单元层**（这一处是本批最值得记的）：
  遍历候选历史时 `for (const s of hist.get(f))` 在 `noUncheckedIndexedAccess` 下是
  「可能 undefined」。修法不是随手 `?? []` 把两种事实折成一件，而是**先找到那个保证在哪**：
  `merged-side-loss-git.mjs:118` 的 `historyByFile` 在入口按传进去的 `files`
  逐份预置空数组 ⇒ 键一定在。而回读用例时发现**这一格没有单元层的钉子**：
  现成那几条断言取的都是「日志里出现过」的文件，没有一条问「被要求、但一次都没出现的文件
  还有没有它的条目」。⇒ 本批补上那条（`tests/merged-side-loss-git.test.ts`），
  并做了一次变异证明，读出的后果比预期重：

  | 量                                  | 变异前后                                      |
  | ----------------------------------- | --------------------------------------------- |
  | 变异内容                            | 把预置那行改成 `new Map()`（只给日志里出现过的路径建条目） |
  | `tests/merged-side-loss-git.test.ts` | 4 条红（含新加那条：`expected undefined to deeply equal []`） |
  | `tests/pending-merge-loss-gate.test.ts` | 6 条红，其中 `① 某文件整份取非 HEAD 侧 → 阻断并指名文件` 报的是 **`expected +0 to be 1`** |
  | 含义                                | **撤掉那步预置，这条硬闸会把真的「整份取一侧」放行**（退 0 说成「无整份取一侧」），而不是崩给它看 |
  | 撤销变异后                          | 两份文件全绿（30 条，串行 EXIT=0）             |

  所以消费点那句 `?? []` 的注释里写清了保证在哪、以及谁钉着它 —— 不是「防它不在」。

- **补类型又一次不是纯减法**：给 `candidates` 写上 `Map<string, string[]>` 之后，
  下游那一格立刻现出 `TS2322: Type 'string[] | undefined' is not assignable to 'string[]'`
  —— `findEarlierVersion` 的 `historyShas` 收的是 `string[]`，之前 `candidates` 是
  `Map<any, any>`，那条边界从来没被核过。修法仍在调用点：收集候选的循环对每一份 `f of files`
  都无条件 `candidates.set(f, older)`，而消费循环遍历同一个数组 ⇒ 写 `?? []` 并在注释里
  指明保证在哪（把 `undefined` 递进内核才是拿「没这一格」冒充「没有候选」）。

  凭据（四条）：
  ① `tests/pending-merge-loss-gate.test.ts` + `tests/merged-side-loss-git.test.ts` +
  `tests/script-main-guard.test.ts` 串行 **30 条全绿**（前者是端到端起真脚本跑硬闸的那一档）；
  ② 变异证明如上表（改前红、撤销后绿，变异文件已 `git restore` 并与备份逐字对过）；
  ③ 棘轮 `--update` 后复算 = **面 215 / 存量 8 / 2 份**（剩 `db-migrate.mjs` 4、
  `git-dir-literal-scan.mjs` 4），本批零残留新格；
  ④ `node --check` 通过；`pnpm exec eslint` 对这两份零输出。
  ⚠️ 一条如实标注的边界：**本批这次提交本身不会走一遍那条硬闸** —— 它只在
  `MERGE_HEAD` 在场（真合并中）才判定，普通提交那一跳它直接放行；行为面由 ① 那 30 条承担。
