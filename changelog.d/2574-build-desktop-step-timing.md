## Added

- **`scripts/build-desktop.mjs` 现在念得出每一步多久**（ISSUE #2574，P3）：装配那一大段
  （standalone 整树 `cpSync` → 顶层白名单剔除 → 载荷实体化 → 静态资源与启动页 → 体积护栏
  → 出厂计数）从第一步到最后一步过去**一个耗时都不念**，几百 MB 的一跳期间屏幕上没有任何
  新行 —— 在 CI 上长得和「卡死 / 超时前兆」一模一样，而脚本正在正常干活。本仓为此误判过
  一次（E2E 那格跑了 36 分钟被平台按 stage 超时 kill），当时能分辨「在跑」与「挂了」的只有
  平台那一格的 duration（整格一个数，且它是**毫秒** —— ISSUE #2442），脚本内部哪一步吃掉
  多少时间取不出来。现在念四行：
  `1/4 完成（耗时 …）`、`2/4 完成（耗时 …）`、`sidecar: … MB，复制耗时 …`、
  `4/4 完成（全程 …，不含 pnpm tauri build）`；`§装配` 那一跳另加一行
  `过 filter N 条、挡掉 M 条，耗时 …`（白名单在场时这两个数就是「挡得对不对」的证人；
  口径写死在注释与用例里：`filter` 对**每个将要复制的路径**各调一次，目录与文件都算，
  所以是条目数，**不许冒充文件数**），体积那一行也补了「数体积这一遍耗时 …」——
  全树遍历自己也是一次成本，过去和拷贝混在一起读不出来。
  **这些都是读数**：不参与退码、不改判定（与 `pnpm ship` 阶段 0 那三行同口径，用例专门钉住
  「时长不许进 `fail()` 的话术」）。时长格式化用的是 `src/lib/time-format.ts` 那一份
  `formatDurationMs`（脚本侧从 `.mjs` 引 `.ts` 的先例是 `scripts/ci-build-readout.mjs`），
  不在脚本里再写第二份（AGENTS 硬规则 24 / §12.18）。
- **文件头写死三条「不要这么修」**（本单逐条对着代码与配置核过，不是推测）：
  ① 不换 `fs.cp` 异步版 —— 本脚本是直线式一次执行，全文 `availableParallelism` / `cpus` /
  `setInterval` **零命中**，同步拷贝在这里不冻结任何东西；症状是「静默」，对症的是读数。
  ② 不加 `BUILD_MAX_PARALLELISM` 夹取 —— `build-desktop` 根本不用 `availableParallelism()`；
  用它的是 `scripts/ci-load.mjs` 的 `resolveCores()`，那里**优先读平台给的 `CNB_CPUS`**，
  已经比夹取更贴事实，且本仓 CI 是 Windows 节点、不是 cgroup 容器。
  ③ `force` / `dereference` 不为「表达意图」而全表钉死 —— 承重两处（standalone 整树、
  载荷实体化）已显式写 `dereference: true` 并带理由；四条拷贝调用都没写 `force`
  （`cpSync` 默认就是 `true`；写着 `force: true` 的三处都在 `rmSync` 上），而产物层
  `check-standalone-contents.cjs` **真数两层产物**（AGENTS 硬规则 18），「该带的被静默覆盖」
  当场红。`filter` 也早就在用且量过收益（省下 `src/` 11.7 MB + `changelog.d/` 3.3 MB
  与开发机私有输入；载荷实体化把 404 MB 压到 245 MB）—— 这不是「优化还没做」，是已做完并记账。
- **新执行者 `tests/build-desktop-step-readings.test.ts`（7 条）**，并登记进
  `scripts/fixed-structural-tests.mjs`：这条读的是**磁盘文本**，而 `build-desktop.mjs`
  不被任何测试 import ⇒ 改它不会把这条带进增量面；反过来「把读数删掉」「把时长塞进判定」
  也都不在任何改动面上 —— 不固定跑的话，它的表现不是红，是下次再撞「CI 上看起来像卡死」时
  屏幕里仍然只有体积、没有时刻。按**计时变量的归属**判而不是按步骤标号的字面位置判
  （`3/4` 那一跳的时长念在 `sidecar: …` 那一行里，拿标号逐字比就是钉行形状）。
  变异实测五组（每组改完都还原并逐字比对相同）：摘掉 2/4 的耗时 ⇒ 步骤那条红；
  把条目数改口成「文件」⇒ 口径那条红；在脚本里长出第二份时长格式化 ⇒ 唯一份那条红；
  把时长塞进 `fail()` 话术 ⇒ 「读数不参与退码」那条红；摘掉文件头三条里的一条 ⇒ 头部那条红。
  另在临时夹具上真跑过 `cpSync` + `filter` 这一段：`过 filter 7 条、挡掉 2 条`，
  产物里 `secretdir/` 与 `node_modules/.cache/` 都没进来 —— 计数与排除语义都对。
- **没有往规范里抄第二份**：`docs/standards/launch-and-build.md` §7 那一族记的是产物护栏与
  装配顺序，本单的三条「不要这么修」的**唯一出处是脚本文件头**（`scripts/build-desktop.mjs`），
  新执行者把「那三条还在不在」钉成可红的断言 —— 抄一份进规范就是给下一次改动留一条会脱钩的
  副本（AGENTS 硬规则 24 / §12.18；`check-doc-references.cjs` §3.6 那条「本节不抄 `main()`
  的清单」是同一条纪律的另一种形态）。
