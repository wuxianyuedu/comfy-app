## Changed

`ship-platform.mjs` 的 900 行硬闸落点先定后拆：**轮询那一格独立成 `scripts/ship-poll.mjs`**
（候选 A），而不是等下一笔改动撞上闸时临时找地方。

判据是**变化方向**：轮询跟着「一条 build 怎么被读、等多久才算没有结论」动（断流要看
「签名不变 **且** 没有一格在飞」、45 分钟墙钟预算），而留在 `ship-platform.mjs` 的三段
（取 PR / 判决 / 合并并回读）与阶段 8 的分支清理跟着「平台对我们动作的应答」动。
动手前的读数：`ship-platform.mjs` **898 行**（余量 2 行，比立案时的 887 更紧）；拆后
**709 行 / 223 行**，这一族下一次改动不再顶着闸走。

对外一行不变：命令行、退出码、打印原文与阶段顺序都没动，搬过去的 `pollUntilTerminal` /
`toShipBuildState` / `POLL_STALL_MAX` 是逐行搬移，用例只改了 import 那一行。

同批对齐的读数面（漏一处就是给下一个执行者留一份会过期的读数）：

- `scripts/ship.mjs` 文件头那张「这一族各自的职责」表与 project Skill `.qoder/skills/ship/SKILL.md`
  的模块列表都点名了新落点；
- `ship-close.mjs` / `ship-local.mjs` 文件头里「平台侧四段」的复述、`ci-build-readout.mjs`
  里列举调用点的那一句，一起改成新形状；
- `scripts/.gate-thresholds.json` 里 `POLL_STALL_MAX` 那条账的 `file` 跟着搬（判据按
  「文件 + 常量名」定位，不跟着搬它当场红）；
- 规范 §13.5.26 里「账可以点名 `ship-*.mjs`」举的例子从 `ship-platform.mjs` 换成
  `ship-poll.mjs`（被点名的那条数已经不在原文件里了）。
