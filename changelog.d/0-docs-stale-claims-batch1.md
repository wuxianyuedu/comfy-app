## Fixed

- **一批「曾经真、现在不真」的文档陈述，全部对着现树复算过再改**（改法统一：删掉写死的
  数字/路径，指向唯一出处；**不新增任何数字**）。复算用的读数逐条写在下面。
- `docs/standards/launch-and-build.md`
  - `§1.5` 把壳侧用例数写成「`shell_launch.rs` 含 7 条单测」「`launch-diagnostics.ts`
    13 条单测」—— 现值 `grep -c '#\[test\]' src-tauri/src/shell_launch.rs` = **23**、
    `launch-diagnostics.test.ts` 的 `it(` = **14**。两处改成指向执行者（`cargo test` /
    那份用例文件），与 AGENTS 硬规则 5「条数随源码变动，别写死」同一个口径。
  - 编排分段那段的收尾句写「`run()` 回到约 340 行，主文件 753 行」——
    `wc -l scripts/dev-launcher.mjs` 现为 **828**。改成「回到各自硬闸之内」并点名两条闸门；
    上一句「一度 953 行 / 约 490 行」带「一度」标记，是取样记录，**保留原数**。
  - 「旧 `.ps1` 保留在 `dev-launcher.legacy.ps1` 只作对照」——该文件不在树上
    （`git log --all --diff-filter=A` 显示它 `ac544383` 加、`fbabbc25` 删）。改成「已不入库，
    形态对比转 `git log`」，行数与 19 处 Windows 调用那份读数照旧留着。
  - 排障表两行点名「浏览器形态的 `InAppTabStrip`」——`git grep InAppTabStrip -- src` 现在
    **0 命中**（组件已随页签形态改造删掉）。改成「每个标题行渲染点各挂一处，名单由
    `check-title-bar-clearance.cjs` 自己枚举」——门禁就是那条枚举的执行者，文档抄名单
    只会再漂一次（这次已经漂了）。
  - `§9.6` 与 `docs/standards/12` §12.4.6 **各抄了一份纯 ASCII 白名单表**，两份都停在
    三项，而权威定义那一行（`docs/reference-facts.md` 的 `comment.language.asciiOnly`）
    已是**四项**。两处手抄表删掉、只留指向；顺手纠正同一处的判据口径：
    `pnpm doc:check` 解析的是登记行，**不会**去比对别处正文里手抄的名单 —— 原文写着
    「核对『文档写的名单』与『脚本读的名单』一致」，那句话没有执行者（登记行四项、
    正文三项时它照样绿，这就是当场证伪）。
  - 排障表一行让人「改了启动器 `scripts/start_tauri_launcher.py` 必须用
    `tools\build\build-launcher.ps1` 重打包」——两个路径都不在树上（那条 Python 启动器链
    连同 `build-launcher*.ps1` 已全部移除，本章自己另处就写着这件事）。改成只剩「重编壳」。
- `docs/standards/11-测试与可观测性.md` / `docs/guides/TESTING.md` /
  `scripts/shell-gate.mjs` / `tests/shell-gate.test.ts`
  - 「壳里 **37 条** `#[test]`」这一句在四处被当现状引用，而 `src-tauri/src/**` 现在
    `#[test]` 合计 **54**（`detached_spawn` 4 + `lib.rs` 19 + `shell_launch` 23 +
    `single_instance` 8）。四处一律去掉条数、保留「`cargo test` 是唯一执行者」那句判断。
    `shell-gate.mjs` 里失败文案那句「壳侧单测是这 37 条的唯一执行者」同批改（无测试钉它，
    已核）。§13.5.3 里「本轮刚修过一次『壳里 37 条』，实测已经是 52」那行是**取样记录**，
    留着不改——它正是「别抄数字」那条结论的证据本身。
- `docs/standards/13-提交与-code-review.md`
  - `§13.5`「现状（两层）」表把本地写成「判据分 4 组并行跑 / 拦 tsc + eslint + 各棘轮」，
    把平台写成「PR 上的**全套**门禁」。现树：默认档只串行跑 D0 形态前置档，A/B/C/D 由
    `COMFY_HEAVY_GATES` 决定谁执行；PR 在场格数由 `.cnb.yml` 自己列。两格都改成口径 +
    指向清单，不再由文档代答「跑了什么」。
  - 同节那段门槛清单的引子写「C=一次 vitest」，而 C 组的本地执行者已撤、改由 PR 的
    `受影响用例` 一格跑同一条判决链（钩子里 `run_group C` 那行留着当登记）。逐行补上
    「执行者不在本地」与它为什么不许删（`tests/hook-affected-launch.test.ts` 钉入口形状）。
  - `freshness-gate` 那行写「三档都判今天自证过没有…当天动过就必须今天自证」——现树三档
    **都登记着 `ciStage`**，本地这一层只打读数、不拦（`scripts/freshness-ledger.mjs`）。
    同一行还写「钩子里不跑这**四**档」，而 `FRESHNESS_TRACKS` 是 **3** 条，一并改。
  - 「固定清单 77 份」四处都带 实测/复核/分布 取样语境，**不改成现值**（现值以
    `FIXED_STRUCTURAL_TESTS` 为准，本批实测 **90** 条）；只在第一处补一句「那是当时那份
    清单的份数」，免得读者拿取样当现状。
- `README.md`
  - 技术栈行写「Drizzle ORM + better-sqlite3」：生产链路 import 的是 `@libsql/client`
    （`src/server/db.ts`、`src/server/workshop/db.ts`、`src/lib/comfyui/host-runtime.ts`），
    `better-sqlite3` 在 **devDependencies**、全仓唯一 import 点是 `tests/helpers/test-db.ts`。
    驱动名删掉，改成「以 `src/server/db.ts` 的 import 为准」——不换成新硬编码。
    `docs/standards/01` 的 §1.10 标题同一条病；改标题会动锚点，已把仓内唯一一条入链
    （`docs/README.md` 的 `#110-…`）同批改写。
  - 「平台侧 CI 已随 ISSUE #623 删除，没有那一层兜底」——`.cnb.yml` 在册
    `跨平台动作对照` 一格（`node scripts/check-ps1-consistency.mjs`），那句话现在是反的。
    改成「本地钩子 + 平台同名那一格」，在场格数指向 `.cnb.yml`。
- `docs/reference-facts.md`
  - `path.dev-launcher` / `path.dev-launcher.mjs` 两行的说明写着「Windows 侧进程编排者
    （taskkill / Job Object）」与「Linux / macOS 侧编排者」——那是硬规则 12 明令拆掉的形态
    （`.ps1` 只做入口，编排全平台唯一一份 `dev-launcher.mjs`），而 `scripts/dev-launcher.ps1`
    里 `taskkill`/Job Object **只剩指向 `kill-process-tree.ts` 的注释**。登记表把禁用形态
    写成现状，比正文过期更危险——它是 `{{占位符}}` 的权威源。
  - 「守卫已随 `doc:check` 一起进 `.githooks/pre-commit`（D 组）」——钩子里
    没有任何 doc 步骤行（`grep -E '^\s*run "'` 反查为 0），执行者在 `.cnb.yml`
    「文档引用与权威源一致」（ISSUE #1975 挪走）。改成「本地这一格不随提交自动跑，改完
    要自己跑一次」。
  - 「共 **26 篇**」「01~17 章」：`SCOPED_DOCS.length` 现为 **31**（含 18 章与
    `docs/guides/ci-node-image.md`）。篇数删掉、指向 `SCOPED_DOCS` 本身。
- `docs/README.md`
  - 登记 `docs/guides/ci-node-image.md`（此前 `grep -c ci-node-image docs/README.md` = 0，
    而文件存在且已在 `SCOPED_DOCS` 里 —— 索引漏一份，读者就找不到它）。
  - 「索引维护日期：2026-08-27」删掉，改指向 `git log -- docs/README.md`。
  - `check-file-structure.cjs` / `pnpm check` 的「何时跑＝每次提交」改成「默认档不跑」
    （前者在 D 组、后者在 A/B 组，档位口径同 §13.5.25）。
  - 「今天目录里的几份……**都还有 ⬜ 未闭环条目**」逐份点名已不成立：
    `grep -c ⬜` 在 `2026-09-26-performance.md`、`2026-10-12-architecture-risk-review.md`、
    `2026-10-16-hook-baseline-map.md` 上都是 **0**，只有 `-performance-audit.md` 剩 10；
    而且第四份文件根本没被点名。改成「逐份还剩哪些条以各文件自己的状态图例为准」。
- `AGENTS.md` 硬规则 7 写「`ESLint 零警告` / `重档静态判据` / `受影响用例` 三格在 PR 流水线上
  在场」，而 `.cnb.yml` 的 `COMFYAPP_CI_GATES` 清单里**没有** `ESLint 零警告`——它 2026-10-19
  就撤到每日档（`每日 ESLint 零警告`，`tests/no-platform-ci-config.test.ts` 的
  `PR_MOVED_TO_DAILY` 钉着这一对）。规范 §13.5 已经写对了，只有 AGENTS 这层脱钩。改成
  「PR 上在场哪几格以 `COMFYAPP_CI_GATES` 为准、每日以 `COMFYAPP_CI_DAILY_GATES` 为准，
  本文不抄格名」，并把这次脱钩本身留作理由。
- **刻意没改**（判不了就别动）：`docs/standards/11` 那句「15 份枚举 `tests/` 的判据是
  `gate-scan-read` 的调用方」——`git grep -l gate-scan-read` 在 `scripts/` 侧是 40 份、
  其中按粗口径枚举 `tests` 的是 16 份，而「15 份」用的是文档自己的口径，复算不出等价
  判据；拿猜测替换猜测比留着更坏。另：`scripts/.file-size-baseline.json` 在 §11/§12/§13
  的三处引用都带「曾经 / 已下线 / 同构」自注，属正确的历史，不是过期现状。
- **这一族没有任何判据会红**：`check-doc-references.cjs` 只核 AGENTS.md 的路径与硬编码值、
  以及 `§NN.M` 标题锚点；文档正文里的手抄枚举、组件名、格名、条数全部在射程外。所以
  正解是**不抄清单**，而不是把它抄得更勤。
- 复算：`pnpm doc:render` 后 `docs/generated/**` 与源同批；`check-doc-references.cjs` 退 0；
  `tests/check-doc-references.test.ts` / `tests/docs-candidate-hygiene.test.ts` /
  `tests/shell-gate.test.ts` / `tests/doc-check-hook-wiring.test.ts` 全绿。
