## Changed

- **门禁扫描面的「读不到时怎么办」收成一处** = `scripts/gate-scan-read.cjs`
  （`readForScan` / `readdirForScan` / `walkForScan` / `vanishedNote`），15 份枚举 `tests/` 的判据全部改成调用它。

  **为什么这是一层地基**：`tests/` 里有自造自删的探针文件（`.setup-cleanup-probe-<pid>-<ts>.test.tsx` 等），
  而门禁读的是**工作树**。同一工作树里有两个 vitest 在跑（并行会话、或本钩子的 C 组还没退干净）时，
  判据会撞上两种窗口 —— ① 列到名字、读时已没；② 条目在两次 `readdir` 之间被删，枚举当场抛 `ENOENT`。
  两种都是同一个竞态，只补一种等于把门禁的一半赌在时序上。后果形态是 **D 组带着一个 Node 栈崩掉，
  报错里没有一个字指向本次改动**（`git blame` 指不到、`base-check` 也复算不出，因为 master 上没这个问题）。

  **收之前的真实分布**（`git grep` 逐份量，不是按记忆数）：

  | 形态 | 份数 | 名单 |
  | --- | --- | --- |
  | 已有私有容错（各写一份 `ENOENT → null`） | **5** | `check-test-sleep` / `check-test-waitfor` / `check-test-it-each` / `check-test-todo` / `check-annotate-consumer` |
  | 读那一步**完全没有兜底**（裸 `readFileSync`） | **7** | `check-dead-exports` / `check-gate-repo-boilerplate` / `check-soft-assertions` / `check-task-meta-consumer` / `check-test-concurrency` / `check-type-assertion-executor` / `check-gate-executors` |
  | 枚举那一步 `catch` 掉**所有**错误的静默降级 | **3** | `check-comment-language` / `check-test-environment`（walk 吞、读仍裸）/ `check-tsc-diagnostic-executors`（读写都吞且**不计数**） |

  后两档的区分要说清：**「有 `catch`」不等于「有容错」**。`check-tsc-diagnostic-executors` 那句
  `catch { continue }` 把所有错误连同 `EPERM` / 编码错一起吞成「这个文件没站点」，而且不计数 ——
  它比裸读更难发现：裸读会崩、会有人来问；它什么都不报，判据照样绿。

  顺带把四件事一起做掉了：

  1. **`annotate` 那一份是静默 `continue`** —— 它容错了，但不计数、不进结论行，于是「判据这一轮
     没读过某份文件」与「这份文件没有站点」读数完全一样。现在计数并进 OK/失败两条出口。
  2. **`check-test-environment` 一份文件读三遍**（三条判据各一遍）⇒ 一份消失的文件被记成三条「未读」。
     改成**每份只读一次**，消失数按文件计，顺带去掉两次重复 IO。
  3. **`check-dead-exports` 有第三种窗口**：它是 `readdirSync` 列名字 → 循环里 `fs.statSync(full)`，
     条目在两次 syscall 之间被删时 `statSync` 抛 `ENOENT`，而那行在 `try` 之外。共用枚举改走
     `withFileTypes`（同一次 `readdir` 带回类型，不多一次会失败的 syscall）。
  4. **六份棘轮在有文件没读到时拒绝 `--update`**（`check-dead-exports` / `check-comment-language` /
     `check-test-sleep` / `check-test-it-each` / `check-gate-repo-boilerplate` /
     `check-tsc-diagnostic-executors`）：少读一份就把存量报小，拿不完整的读数收紧基线 =
     让那些条目从此没人报得出。「只许降」的语义前提是两次读数覆盖同一张面。

## 一条订正：我此前报的这个数是错的

`changelog.d/0-gate-scan-vanished-file.md`（尚未并入 `CHANGELOG.md`）里写着「实测扫描面含 `tests` 的判据共
**15 份**，其中 **9 份**是同一个『`walk()` 列目录 + 裸 `readFileSync`』形状」，本会话后续又把它说成
「剩下 **7** 份」。**两个数都不成立**，错在判据不同一：那一次量的是「有没有同一段读文件代码」，
没把「枚举 `tests` 但读法不同」的 `check-comment-language` / `check-gate-executors` /
`check-tsc-diagnostic-executors` 算进「需要收」的一档，也没区分「有私有容错」与「容错是静默的」。
按这一刀的统一口径重测 = **人口 15 / 私有真容错 5 / 读那一步完全没兜底 7 / 枚举那一步静默吞掉所有错 3**，
`tests/gate-scan-read.test.ts` 的探测器现在把这 15 份**机器枚举**出来（不再是人数的名单），
并有一条地板断言（`readers.length >= 15` + 锚点 `check-test-sleep.cjs` 在场）证明探测器自己没漂。

## 门禁自测的夹具：依赖不再靠每份用例自己记

`tests/helpers/gate-repo.ts` 新增导出 `copyGateDeps(destScriptAbs)`：按 `require("./name.cjs")`
**递归**把同目录依赖补进临时仓库（已存在的不覆盖，但仍走进去看它自己的依赖 —— 只补「缺的文件」
会漏掉「脚本 A + 手工带上的 B」里 B 的传递依赖，本刀实测撞上过一次）。

- `defineGateRepo` 复制完脚本自动调用它；
- **手搓临时仓库、还没迁进夹具的用例**里，7 份是「复制脚本 + 现成 `basename` 形状」
  （`test-sleep` / `test-waitfor` / `test-it-each` / `soft-assertion` / `test-concurrency` /
  `type-assertion` / `test-environment`），在各自 `copyFileSync` 之后调一句 `copyGateDeps(落点)`；
  另外 2 份（`gate-executors` / `gate-repo-boilerplate`）是**整目录**布局（前者把 68 份判据
  全复制进去、后者只放自己），它们的依赖不是「脚本的同名兄弟」而是这份共用件本身，
  所以是显式 `copyFileSync(gate-scan-read.cjs)` —— 注释写明「少了它会读成 MODULE_NOT_FOUND」。

  从前每份用例自己写一行 `DEP` —— 那种写法的失效方式不是「忘带依赖」报「忘带依赖」，
  而是 `MODULE_NOT_FOUND` + 一叠 requireStack，**读起来像「判据坏了」**。

## 回潮判据（`tests/gate-scan-read.test.ts`，已进 C 组固定清单）

两条形状 + 各自的合成负控制 + 一条量具自证：

- **A** 凡枚举 `tests/` 的 `scripts/check-*.cjs` 必须 `require("./gate-scan-read.cjs")`；
- **B** 吞 `ENOENT` 的那一句（`code === "ENOENT"`）在全仓 `scripts/*.cjs` 里**只许出现在共用件**
  —— 留第二份私有实现就是「改一处漏三处」的那个形状；
- 负控制：合成一份坏判据（两条探测器都必须抓到）+ 一份不枚举 `tests` 的（A 不许误伤）；
- 反向锚：共用件自己**必须**有那一句，否则 B 会因为「谁都没有」而空绿。

**这一层管不到的格子**（写在这里，别读成「都收口了」）：A 的判据是「枚举 `tests`」。
一份新判据若把扫描面写成 `["src"]`，它不在这条尺的射程里 —— 竞态的成因是**并发用例往 `tests/` 写自删探针**，
所以这个边界是有意为之，不是漏网。另一格：`check-tsc-diagnostic-executors.cjs`（§13.5.14 的类型层声明台账）
只核登台账里点名的文件，新加的 `gate-scan-read.cjs` 那份 JSDoc **不在它的账上** —— 本刀没有为它新增登记项。

## 验证

| 项 | 结果 |
| --- | --- |
| **15 份判据的输出** | 与 `HEAD` 版本逐字一致（同一文件面上比：`git show HEAD:` 副本落进 `scripts/` 跑一次、当前版再跑一次）。⚠️ 第一版对照把副本**删掉后**才跑当前版，`check-comment-language` 因此报「扫描 1890 → 1889 个文件」—— 那是对照物自己进了扫描面，不是语义变化；改成两份同面跑之后一致。**变基到 `0f1ff3e1` 后这一条整重做一遍**（15/15 一致），并对唯一会数 `scripts/` 的那份用「两份临时副本同时在场」的对照法复测 —— `1893 = 干净树 1891 + 2 份副本`，数对得上才算这条成立 |
| 受影响用例面 | **19 份文件 / 280 passed**（`gate-scan-read` + 15 份各自的 gate 用例 + `affected-tests` + `ratchet-update-guards` + `deps-freshness-gate`）。⚠️ 这份清单与数在**变基后重测过**：上游 `bf945fff` 同时改了 `tests/helpers/gate-repo.ts`（新增 `installDep`）与 `check-test-environment.cjs`（按分档重写），两边能力都在场才算合对 —— 判据人口仍是 **15**、`ENOENT` 仍只有一处，两条都当场复量过 |
| **变异复核 A**（摘掉 `check-soft-assertions.cjs` 的依赖引用） | 当场红在 `这些判据枚举 tests/ 却不走共用读取器：check-soft-assertions.cjs`；装回即绿 |
| **变异复核 B**（往 `check-comment-language.cjs` 追加一份私有 `ENOENT` 容错） | 当场红在 `…只许出现在共用件里：check-comment-language.cjs`；`cp` 还原后 md5 与改前逐字节相同 |
| 读取器自身 15 条 | 含两条「不是空转」的对照：把目录当文件读**必须抛**（非 `ENOENT` 不许吞）、点开头的**文件**照收而点开头**目录**不收（写反了就等于判据在并发探针正在跑的那一刻转身不看） |
| `pnpm exec tsc --noEmit` | 0 error |
| eslint（新文件 + 改动过的 11 份） | 0 error / 0 warning |
| `check-code-duplication` / `check-function-length` / `check-file-structure --strict` | 0 对孪生 / 0 个超长函数 / OK |
| `check-gate-executors` | 68 份判据脚本 —— 判定型有执行者 65、按需召唤 2、报告型自称在跑 0 ✓（共用件无 `process.exit`，不是判定型，故不占这份账） |
| `check-tsc-diagnostic-executors` | 迁完之后报「三处声明行上涨」⇒ 按其出口读回 §11.20 / §11.16.1 / §13.5.14 与各自执行者，**手工**把 `.tsc-diagnostic-executors.json` 的 38→41 / 29→31 / 42→44 对齐（这一支刻意不给 `--update`：上涨的意思是「多了一处没人回答过的声明」）；改完 ✓ 8 条声明的执行者都在场 |
| `pnpm doc:gen` / `pnpm doc:check` | ✓（§11.16.1 新增这一层的口径与台账一行，生成态随源重生成，未手改生成物） |
| 格式化 | `scripts/gate-scan-read.cjs` 与 `tests/gate-scan-read.test.ts` 新文件 prettier-clean；改动的旧文件只把**自己那几行**改成 prettier 形状（`scripts/**` / `tests/**` 在格式棘轮的 `IGNORE_GLOBS` 里，跑 `--write` 会带出他人整文件重排） |
| 全量两档（日期滚到 10-11，昨天那两条账都是**豁免**、只替它们写下的那一天作证 ⇒ 今天真跑） | **e2e**：76 条里 **13 条 @critical 红 / 63 passed**（3.4m）⇒ 归属与逐条现场开进 **ISSUE #1727**（证据：本笔 `src` 与 `e2e` 与 `master` 逐字节相同、webServer 是新起而非复用旧实例 ⇒ 不是 §4.3 那一格）。**全量单测 + 覆盖率**：跑两遍，用例面 **677 files / 8504 passed 全绿**，红在四条门槛（`src/lib/core/**` 95.89<96、89.95<90；`src/lib/log/**` 98.97<100、85.17<86）⇒ **ISSUE #1728** 带文件级定位（最弱的一份 `log/app-runtime-log.ts`：语句 75%、分支 57%）。两条各记了一条**点名 issue 的 `--skip`**，账文件随本笔提交；**豁免不替那些红作证** |
| 依赖新鲜度（变基之后撞上的那一格） | 第一次提交被 C 组拦下：`tests/global-setup-cleanup.test.ts` 红，**隔离复跑同红 ⇒ 不是负载假红**。根因不在本刀 —— 上游 `bf945fff` 新加了 `happy-dom@20.14.6`，本地 `node_modules` 还是旧的，探针用例以 `ERR_MODULE_NOT_FOUND` 结束。`pnpm check:deps-freshness` 自己报「有漂移：+ happy-dom」，`pnpm install --frozen-lockfile`（10.6s）后该用例 2 passed、上面那 19/280 是在**修好的依赖树上重测的第二遍**（第一遍的数字不作数：它量在漂移的树上）。这一格正是 #1721 那条新判据要挡的形状 |
| `.githooks/pre-commit` | 见下方提交 |
