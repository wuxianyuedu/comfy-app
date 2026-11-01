## Fixed

`scripts/.scripts-typecheck-baseline.json` 的 `face` 从 228 改成 230（ISSUE #2947）。

该字段是「`tsconfig.scripts.json` 展开出多少份 `.mjs`」的手写副本，用例判它必须等于实测展开数。
一天里它被落下两次：`e56dc88f`（#2931）新增 `scripts/premerge-timing.mjs`，`26a3c3ed`（#2948）
新增 `scripts/suspended-gate-tests.mjs` —— 两次都只加了文件、没改这份副本。于是从第一次起
`tests/scripts-typecheck-ratchet.test.ts` 在主干上就是红的，**每一条从它分出的 PR** 都要在
「固定结构用例」那一格先撞它一次，失败行还像是「你新加了脚本没记账」。

`face` 不该手写这件事由 #2947 承接（连同「由生成器写入」的改造）；本碎片只记这次把账补上。
