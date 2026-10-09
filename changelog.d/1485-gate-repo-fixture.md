## Changed

- **门禁自测的「临时仓库样板」收成一份共享件，并给它一条判据**（ISSUE #1485 / 规范 §11.16.1）。本仓库 60 余份 `tests/check-*.test.ts` / `tests/*-gate.test.ts` 判的是**同一件事**：把 `scripts/` 下的判据脚本当黑盒，在一个只放了被测文件的临时仓库里跑一次。此前每一份都手抄一遍同样的四件套 —— `mkdtempSync` + `let workdir` + 自己写的 `run(args)`（`execFileSync` 拉子进程、catch 里把 `{status, stdout, stderr}` 归一成 `{code, output}`）+ `afterEach` 里 `rmSync`。② 那 15 份**逐字相同、只差脚本路径**（§12.12 的字面孪生），而抄错的形态是**静默的**：少写 `cwd`、`status` 当 `1` 兜底、忘了 `stdio: pipe`（子进程 stderr 直接漏进 vitest 输出）。
  - 新件 `tests/helpers/gate-repo.ts`：`defineGateRepo({ script, dir, dirs, env, files, copy, setup })` 返回一个带 `repo` fixture 的 `test`。`repo` 暴露 `write` / `read` / `mkdir` / `remove` / `run` / `git` / `commit`。**收尾挂在 `use` 之后、由 vitest 保证**（用例中途 throw 也恢复），这是相对手写 `afterEach` 的实质收益（§11.16 那条口径）。
  - **迁了 13 份**：`check-overlay-z` / `check-void-floats` / `check-non-null-assertions` / `check-circular-deps` / `check-dead-exports` / `check-function-length` / `check-rust-function-length` / `check-code-duplication` / `check-ui-logic-separation` / `check-ui-primitives` / `comment-language` / `check-branch-guard` / `check-format`。**462 条用例全绿**（迁前迁后同一读数）。
  - 顺带收进夹具的：**权限位**。原先只有 2 份自己 `chmodSync(…, 0o755)`（理由写在各自的 `beforeEach` 里：受限 umask 下新建目录不可写、`--update` 落盘基线会 EACCES），另外 14 份**理论上暴露在同一档上** —— 收进夹具后对所有调用点成立（同族取舍见 `tests/helpers/symlink-dir.ts`）。
  - 顺手删掉两处真孪生：`check-function-length` / `check-rust-function-length` 里「造函数体但不写文件」的第二份辅助函数、以及各文件里逐份抄的 `const abs = join(workdir, …) + mkdirSync + writeFileSync` 三连（`repo.write` 自动建父目录）。

## Tests

- 新增 `scripts/check-gate-repo-boilerplate.cjs`（钩子 D 组，棘轮，纯文本 < 0.3s）。判的**不是**「这段代码该不该抽共用」（那是收益判断、静态判会误报一片，§12.18 明写别再为它写启发式扫描器），而是那个**具体形状**：`tmpdir()` + `execFileSync(` 的窗口里出现 `join(workdir` + **没有** import 共享件 —— 三条同时成立才判红。
- 基线是**「待迁的存量」，不是「本批不迁的赦免」**：留了三份没迁，理由都记在 `scripts/.gate-repo-boilerplate-baseline.json` 与 §11.16.1 —— `check-file-structure`（1758 行 / 90 条用例、大量直接 `writeFileSync` 造 Buffers）、`check-reformat-only`（git init + 软链 `node_modules` + 工作区之外的探针配置）、`gate-executors`（把**全部**判据脚本整目录拷过去，与「单脚本」模型不同形）。`--update` 只用于迁完一份之后把数字降下来。
- 参数化用例走 `it.for`、断言走 `expect.soft` 等既有口径不变；新增门禁自测 `tests/gate-repo-boilerplate-gate.test.ts` 进 C 组固定清单，九条口径各有执行者（手搓样板该拦；用了共享夹具 / 只造临时目录 / 拉别的可执行文件 / 夹具文件该放；棘轮上涨与 `--update` 放水该拦；首次建基线该放；`--report` 不判失败；真实仓库读数 == 基线）。

## Docs

- 规范 11 新增 **§11.16.1**（四件套表 / `defineGateRepo` 用法与选项 / 三条实质收益 / 判据与已知边界 / 「基线是待迁存量」/ 为什么不给夹具做 `file`、`worker` 档 —— 实测 `mkdtemp + copy + rm` 一轮 **0.16ms**，升档买不到墙钟，而 `scope: "test"` 是语义必需）。
- 规范 11 §11.23.3 的「声明 ⇄ 读者」索引补一行（`gate-repo-boilerplate`），与 `scripts/.declaration-readers.json` 逐行同源。
- `.githooks/pre-commit` D 组新增一步（步骤数 44 → 45，注释同步）。

## Fixed

- **清掉 `ada321cd` 落进 `master` 的 19 条 `tsc --noEmit` 错**（A 组硬闸已红，附录在这条线里因为它是「本轮动手时正好撞上」的）。`ada321cd`（PR #1553「全量 e2e 每日自证」）给 `FRESHNESS_TRACKS` 补了 `daily` / `skipHow`、给 `freshnessRecord` 补了 `skippedReason`、给 `checkFreshnessLedger` 的 `scope` 补了 `now`，但**没有同批更新 JSDoc 的 `@type`** —— `checkJs` 下这几处注解就是类型的事实来源。它落在干净 `master` 基线上（按 §13.6.2 复算过：同一条判据同一条红），而 PR 在平台侧是 squash 合并、不跑本地钩子，所以谁都没看见。**修法逐条**：`shell-gate.mjs` 的 `candidates` 补 JSDoc 类型谓词（`checkJs` 下 `typeof x === "string"` 不自动收窄数组元素类型）；`visual-baselines.mjs` 的 `freshnessRecord` / `freshnessTrack` / `checkFreshnessLedger` 各补上新字段（`daily` / `skipHow` 写在注解里不是装饰 —— 它们正是两条账真正的差异）；`tests/e2e-run.test.ts` 的 `parseSkip(["--skip", bad])` 里的 `undefined` 是**故意**喂的，补 `!` 而不是删用例。
- **补上 e2e 新鲜度账那条 stale 期望值**：`describe("两条新鲜度账同形但不同键")` 的「四个值各就各位」只钉了 `{ledger,key,label,run}`，同一批改动加的两栏没跟上。改成钉**六个**值并把测试名同步（`daily` / `skipHow` 正是「两条账长得一样」这个错觉的来源）。它在 C 组固定清单里 —— `KNOWN_FAILED_FILES` 那条机制只剔增量面、管不到固定清单，所以这条红是**每个人都撞得上**的。
