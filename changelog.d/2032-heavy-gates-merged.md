## Changed

- **平台侧十几条静态判据收进一格 `重档静态判据`，条目串行跑在
  `scripts/ci-heavy-gates.mjs` 里**（ISSUE #2032）：`生成态文档与源同步` /
  `API 文档生成物与源同步` / `文档引用与权威源一致` / `覆盖率上报` /
  `core 骨架单一事实源` / `零消费导出` / `core 出口纪律与基类纯度` / `格式化提交分离`
  不再各占一个 stage。

  立这个的现场是 `cnb-hpl-1k5a0s6ss`：`ESLint 零警告` 撞上平台单 stage 的 **20m 硬上限**
  被强杀（`任务超过最大执行时间而被强制关闭：20m0s`，脚本一行输出都没有），后面三十格
  整片 skipped；而同一台机、同一份工作区，`cnb-smq-1k59vlk3l` 上同一步是 305s 跑过的。
  差的不是判据变慢，是**前面每一格都在各付一次 job 开销与盘上扫描**。合并之后本次 job
  只付一次，而红了仍然逐条点名（每条的墙钟、退出码、输出都在同一份日志里），
  且不再是「一条红、后面全跳过」。

  - **判据一条没少**：每一条仍是原来那份脚本、那份参数（`--check --autofix` 那两条照旧）。
  - **这一格不收窄**：`ifModify` 按整格跳过，一格装十条时只能表达「十条一起跑 / 一起不跑」，
    而那十条的扫描面并不相同 —— 后者是「判据在场、结论静默变成放行」。
    `ci-incremental-gates.mjs` 的 `COMPOUND_EXECUTORS` 把这条做成机器判据。
  - **两张登记表改按条目名核对**：`INCREMENTAL_GATES` 与 `AUTOFIX_DUTIES` 里原来那几条
    随执行者变更删掉 / 换名，「哪一档会自己改工作区」「哪一格被收窄」仍然各只有一处出处；
    条目 ⇄ 入口 ⇄ 旗标两向核对由 `tests/ci-incremental-gates.test.ts` /
    `tests/ci-autofix-duties.test.ts` 判。
  - 同时修掉本 PR 的格式门禁红：`HistoryPanel.tsx` / `MaterialLibraryContent.tsx` /
    `editable-label.tsx` 三处类名顺序交给 `prettier-plugin-tailwindcss` 重排
    （只有顺序变，类名集合与行为未动）。

## Docs

- 规范 13 §13.5.18 补「聚合执行者」一节（为什么不收窄、收窄面的唯一出处去了哪儿），
  §13.5.19 的形态表与 §13.5.5 的执行者位置同步。
