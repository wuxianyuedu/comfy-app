## Fixed

- `pnpm ship --diagnose` / `--stage-log` 的取数面不含 `endStages` 那一族（#3047）：平台给的 id 是
  `stage-endStages-<n>`，掉在 `CONFIGURED_STAGE_ID`（`/^(stage-\d+|prepare)$/`）外面，而这一档从
  2026-10 起开始承载本仓判据（`PR 失败立案` / `令牌权限读数` / **`GitHub 镜像同步`** / 桌包档的
  `桌包失败立案`）。现场是 build `cnb-61a-1k6d4na5o`：`stage-endStages-2` 红在
  `Failed to connect to github.com port 443 after 21114 ms`、30.5s，而 `--diagnose` 只念了
  `类型检查` 一格、`--stage-log` 按格名与按 id 都退 2 —— 最后一格日志是手写一次性探针
  取回来的（`get-build-stage` 的 `content` 按数组读再剥 ANSI）。
  修法分开两个面：新增**可见性面** `diagnosable`（判决面的工作格 ∪ `endStages`）给「按名反查」
  与「补平台原话」用、`endFailed` 给诊断另起一行念（`红在 endStage：… · 不计入流水线判决`）；
  **判决面 `state` 与 `configured` 一字未改** —— 平台自己也不把 endStages 计入流水线状态，
  而这一档的语义本来就是「它坏了既不许把门禁的红洗成绿，也不许把自己的红叠进门禁的账」，
  出勤那句 `configured.length` 因此不会被顺带多算。
  同批把 §13.10.13 的两处口径补上（可见性面 vs 判决面、`--stage-log` 那个「比过 N 格」的 N）。
  复算：`tsc --noEmit` 0；改动四份 eslint 0；39 条已清零规则集全仓复扫（2421 份、
  `--type-aware`）0 命中；`tests/ci-build-readout.test.ts` 80 条（新增 5 条，三条已用变异打红：
  反查那一支改回 `configured` ⇒ 1 红、`diagnosable` 改成判决面 ⇒ 3 红、念那一行那支清空 ⇒ 1 红）。
