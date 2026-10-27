## Changed

- `scripts/ci-build-readout.mjs` 按**变化方向**拆成三份（ISSUE #2526）：判断在
  `ci-build-classify.mjs`（新增 `progressReadout`，它本就是 JSON 的纯函数）、取数留在
  `ci-build-readout.mjs`、**念成给人看的那几行**（`formatOutcome` / `stageLogExcerpt` 与两份
  失败指纹表）移进新文件 `scripts/ci-build-print.mjs`。直接原因是一次量的读数：那份 **888 行**，
  `check-infra-file-size.cjs` 的 900 硬闸只剩 12 行 —— 与 #2189 / #2504 同一个出口「拆」，
  而这次是在顶闸之前拆，所以拆法还能按职责挑，不必就近切一段。
  拆完：readout **702** 行（余 198）、classify 514、print 215。
- **消费口一字未改**：沿用它原有的转发写法（`export { … }` 那一块），`ship-poll` /
  `ship-diagnose` / `ship-stage-log` / 两个失败立案脚本 / 独立 CLI 都照旧从
  `ci-build-readout.mjs` 导入。`describeFailedStages()` **刻意留下**：它边取正文边念
  （要多问一次 `get-build-stage`），搬到 print 那份就把「零 IO」的那一份变成也摸 IO 的。
- 行为面读数不变（同一跑不许给出两种答案）：`pnpm ship --diagnose cnb-sd5-1k5ui2bb3` 在**拆分
  前后各跑过一次**，两次话术逐字相同（「结论：绿（这一跑有结论）」+ 流水线那行）。独立 CLI
  `node scripts/ci-build-readout.mjs --sn cnb-sd5-1k5ui2bb3` **只在拆后跑过一次**（同一份两行）——
  所以「没改话术」这一格真正的执行者不是那一次手点，而是既有那 7 条逐字钉着 `formatOutcome`
  话术的用例（`读出来的那几行…` 3 条 / `formatOutcome：前缀可注入` 1 条 /
  `formatOutcome：running 那一支把进度念出来` 3 条），它们拆前拆后都绿。
  （这条订正本身是 #2526 收口时补的：上一版这句写成了「两个入口拆分前后各跑一次」，
  而我并没有在拆前跑过 CLI —— 见该单的回执评论。）
- 新增形状档 `tests/ci-build-readout.test.ts` 的「切分之后：ci-build 这一族的读数各只有一份定义」：
  钉「每个名字恰有一个定义点」+「搬走的那两个仍由 readout 转发、定义只在 print 那一份里」。
  这条不是凑数 —— `check-code-duplication.cjs` 的量程是 `src/**`，扫不到 `scripts/`，
  而这一族真漂移的形态是**账面全绿、两个入口给出两种话术**。写它时踩到自己一个坑并当场订正：
  转发块的正则不锚行首时会从 readout 文件头那句「见下面那个 `export { … }`」的**注释**起跳，
  把真的清单整块吞进去 —— 变异自证（把 `formatOutcome` 从清单删掉）当时**没红**，锚了行首才红。
- 同批订正规范：§13.5.27 那句「分类只有一份，在 `ci-build-readout.mjs`」早于本次就已失效
  （分类在上一轮就搬去 classify 了），这次连同三份的分工一起改写；§13.10.13 里「取数与归一
  只有一份」那格补上念文本的归属与转发关系。`docs/generated/` 镜像同批重生成。
