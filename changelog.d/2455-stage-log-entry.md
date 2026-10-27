## Added

- `pnpm ship --stage-log [<sn>] <格名|格 id>`：只读取回**某一格**的日志正文，绿跑也能用
  （ISSUE #2455）。以前这件事只能手工拼 `cnb build get-build-stage` 的四个参数 —— `sn` 要自己记、
  `pipelineId` 得按 `<sn>-001` 拼、`stageId` 要先在三十几格里按格名反查，而**拼错不报错**：
  别的格也有日志、也带行号，读起来同样像证据。#2445 那类「弃用警告清零没有」的验收恰恰只能看
  绿跑那一格，`--diagnose` 又只取红格（且排在「CI 红了」那条路上）。
- 反查**只认逐字**（格名或格 id，大小写与前后空白不算差异）：认不出 ⇒ 念「比过 N 格里没有逐字叫
  这个的格」并列出相近候选；命中多格 ⇒ 连 id 一起列出，两种都退 `2`，**不模糊匹配替你挑一格**。
  念的是格名 / 所属流水线 / `status` 原值 / 耗时（平台的 `duration` 是毫秒，按 #2442 那格口径印成
  人读的时长）/ 原话 / 正文（剥 ANSI、带完整日志行号）/ 完整日志链接。`0` 的含义是「正文取到了」，
  **不等于**「这一格绿了」。
- **不写第二套读取**：取数与归一仍走 `ci-build-readout.mjs`（`fetchBuildStatus` /
  `fetchStageDetail` / `normalizeStageContent`）；「要读哪一跑」的归属从 `ship-diagnose.mjs`
  收成一份 `resolveBuildSn()`，`--diagnose` 与 `--stage-log` 共用 ⇒ 同一跑不会给出两种答案。
  格名反查（`findStageMatches`）与「还没有终态」那格（`stageInFlight`）落在
  `ci-build-classify.mjs`（判断那一侧，零 IO）。互斥守卫的点名清单也收成一份
  （`ship-standalone.mjs` 的 `namedActions`）—— 两条只读动作各抄一份的漂移形态是
  「新加一枚旗标只补进一份」，于是那一跑会把两个动作一起接下来、屏幕上只念一个的结论。
- 同步登记：`scripts/ship.mjs` 文件头（用法全表 + 模块表）、规范 §13.10.13（第二个入口那段）、
  project Skill `.qoder/skills/ship/SKILL.md`（命令表 / 边界第 12 条 / 「结论从哪儿来」那张表）。
  用例在 `tests/ship.test.ts` 的 `--stage-log` 组与 `tests/ci-build-readout.test.ts` 的
  `findStageMatches` / `resolveBuildSn` 两组；判据侧做过变异自证（把逐字命中改成子串命中 ⇒
  「只给片段 ⇒ 零命中」与「空点名 ⇒ 什么都不判」两条立刻红，改回即绿）。
- 真机读数（不是只在假执行者上跑过）：对绿跑 `cnb-b49-1k5ueohbd` 按格名取「受影响用例」得
  163 行正文、耗时印成 `7m50s`；按 id `stage-9` 同一格同一读数；带空格的格名不给 `sn` 时按
  HEAD 归属；不存在的格名退 `2` 并念「33 格里没有」。
