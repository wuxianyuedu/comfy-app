## Fixed

- **脚本档清账批 19：`scripts/generate-api-docs.mjs` 6 格清零，账从 20 处 / 5 份降到 13 处 / 3 份
  （ISSUE #2589 / 规范 §13.5.14.1；同批把批 18 留给 #2724 的那格证人按实测收紧）**：
  这一份是 `pnpm run docs`（生成 API 文档到 `docs/api/`）的入口。

  **两处修法都不在报红的那一行上**（这是本批值得记的形态）：

  - `generate-api-docs.mjs:83` 那两格 `TS2339: Property 'files' does not exist on type 'object'`
    的落点在**生产端** `typedoc-run.mjs` 的 `@returns`：它把 `before` / `after` 两个产物快照声明成
    `object`，而这两个值的全部用处就是被消费点读 `.files`（打
    `files before=/after=` 那句失败诊断）。改成 `ReturnType<typeof snapshotOutput>` ——
    **同一个文件里 `judgeRun` 的入参早就是这个引用**（`:136`），所以这不是新立一种写法，
    是把 `runTypedoc` 那一行没跟上。声明修好，消费点那两格自然消失，一个字没改。
    `object` 这种擦除比缺注解更坏：它看着像有类型，实际把三个字段全抹了，
    而消费点照样在读 —— 报红的位置与说谎的位置隔了一份文件。
  - `:57 / :58 / :61 / :62` 那四格 `TS18048: 'arg' is possibly 'undefined'` 收在**取的那一处**：
    `argv[i]` 在 `noUncheckedIndexedAccess` 下必然带 `| undefined`，而循环界 `i < argv.length`
    已经保证在界内。写法照 `scripts/dev.mjs` 里那个**同形状的** `parseArgs`
    （一行 `if (arg === undefined) continue;` + 注释写明保证在哪），不另创第三种；
    只需要收一次 —— `arg` 是 `const`，收窄会跟着进下面那个 `value()` 闭包。

  **顺手把批 18 留的那格证人收掉**：`db-push.mjs TS2322: 1 → 0`。批 18 那句「这一格留着的价值
  大于清掉它」到今天兑现 —— **ISSUE #2724 已由 #2735（`11141bc9`）真修掉**（注入点契约收成
  结构面 + `describeSpawnFailure()` 一份），所以账上那 1 格额度不再是证据而是**虚高**：
  留着它，`db-push.mjs` 以后重新长出一格 `TS2322` 判据一声不响。判据自己会念这件事
  （默认档实测打印 `检测到 1 格下降，请收紧基线：scripts/db-push.mjs TS2322: 1 → 0`），
  本批按它给的出口 `--update` 收紧；`--report` 那一档只念数、不催收口。

  **照出来一张新单（只立案，本批工作区不动它）**：**ISSUE #2740（P2）**
  —— 同一份 `parseArgs` 对坏输入全部静默：`--out` 缺值 ⇒ `out: ""` ⇒ `path.resolve(ROOT, "")`
  **就是仓库根**，typedoc 会被以 `--out <仓库根>` 起起来（整站 2844 份文件写进根上，
  而 `docs/api/` 已出库、根上那份不被忽略）；`--attempts` 缺值/非数/`0` ⇒ 沿用默认 3 不吭声；
  未知 `--*` ⇒ 一个字都不念。而 `main()` 挂在模块顶层 ⇒ **`import` 这份文件就真跑一遍 typedoc**
  （这次量 `parseArgs` 就付了一次全量生成，读数 `[OK] html generated: 2844 files`），
  于是那一格**结构上没有能红的执行者**。修法两条同批（第 2 条是第 1 条能被证明的前提）：
  照 #2709 已落地的形态拒绝坏输入 + 把自执行收进「被直接执行才跑」的守卫。
  本批只做类型，**行为一字未动**。

  凭据（四条）：
  ① `tests/typedoc-run.test.ts` **11 条全绿**（它走 `spawnImpl` 注入缝，不真跑 typedoc）、
  `tests/check-docs-api.test.ts` **20 条**、`tests/ci-incremental-gates.test.ts` **51 条**、
  `tests/scripts-typecheck-ratchet.test.ts` **11 条**（含「账本 `face`/`total` 与配置展开同数」那条）
  —— 四个文件串行 EXIT=0；
  ② 棘轮 `--update` 后复算 = **面 215 份 / 存量 13 处 / 3 份文件**
  （剩 `check-pending-merge-loss.mjs` 5、`db-migrate.mjs` 4、`git-dir-literal-scan.mjs` 4），
  本批零残留新格；
  ③ `node --check` 两份文件通过、`pnpm exec eslint` 对这两份零输出；
  ④ ⚠️ **`--out` 那条最坏路径没有真跑**（那会把整站产物写进仓库根）：
  实测到的是 `parseArgs(["--out"]) → out: ""` 与 `path.resolve(ROOT, "") === ROOT` 这两条原值，
  后面「typedoc 收到 `--out <根>`」是 `spawnTypedoc` 那行 `[entry, "--out", outDir]` 的直接算术。
  真跑成功分支的那一次（②的 2844 files）是 import 副作用带出来的，落 `docs/api/`、工作区没脏。
