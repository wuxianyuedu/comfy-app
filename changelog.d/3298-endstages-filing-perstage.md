## Fixed

- **桌包失败立案格在 `endStages` 里恒读到自己「pending」⇒ 连红六次一张单没落**（ISSUE #3298）。
  根因在 `scripts/ci-pr-failure-issue.mjs` 那道「等构建列表终态」的门槛：立案格挂在
  `endStages`，执行时列表里当前这一跑的构建级 `status` 恒为 `pending`（要等整条流水线
  收尾才落终态），门槛恒真 ⇒ 每次只念一句「还没到终态」就收工，而它带 `--no-block`、
  退码不构成结论，于是「立案格在册、但恒不写」以绿的面貌留在清单里（桌包档 10-29 ~
  11-04 连红、`makensis 0x2`，`makensis` / `nsis` / `打包` 三个关键词全仓 0 命中）。
  修法取 ISSUE 的方案 1：**判「红没红」改认 `get-build-status` 的逐格读数**
  （`classifyBuildOutcome()`，与 `pnpm ship --diagnose` / 每日档同一份），删掉列表
  `status` 那道短路；列表这一侧只用来认「这一跑是谁 / 事件是什么」。主链 stages 在
  `endStages` 执行时已跑完、逐格状态已落定，立案格自己在飞那一格属 `endStages`
  可见性面、不进判决池；逐格还在跑 / 详情取不到落成 `running` / `unknown`，仍由既有
  `decideAction()` 判「不构成结论 ⇒ 不写」，没有第二套判据。
  顺手收掉同批两处：真写路径漏传 `lane` 会让建单用 PR 族前缀、与按档的去重键对不上
  （每次红都新建一张噪声单）；头注「读上一跑」是从每日档抄来的失真措辞，本格读的是
  自己这一跑。同批改 `tests/ci-pr-failure-issue.test.ts`：夹具允许造列表 `pending`
  的 `endStages` 现场，三条判据钉住「列表 pending + 逐格 error ⇒ 照常判红并念出要写」、
  「逐格也还在跑 ⇒ 仍不写」、「PR 档同形也不许被挡住」，并同步 `.cnb.yml` 两处锚点
  与 `ci-build-readout.mjs` 旁注里关于「等终态」的失真表述。
