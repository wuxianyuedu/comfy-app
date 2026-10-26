## Fixed

- `pnpm ship` 阶段 0 的依赖新鲜度那一格改读判据自己的 `--json` 原值，不再只看退出码：「依赖还没装」（`installDrift.state = no-install`）与「拿不到 git 状态」（`envBroken`）落 `2` 并各自给出对应出口，只有真漂移才保持 `1`。此前三种共用同一个非零码、被统一念成「新鲜度红了」——那正是硬规则 26 禁止的误读，后果是新克隆 / 评审容器 / NPC 工作区里整条 ship 链一步都走不了。
- 判据本体 `scripts/ship-core.mjs` 的 `readFreshnessState()` 给出五态（`clean` / `drift` / `no-install` / `env` / `unknown`），「没测」与「测出来是红的」在读数上分开；`tests/ship.test.ts` 补两面共十条用例（含「判据起不来不许念成红了」的负控制）。
- 同批记录一条用例层的坑：vitest 5 的 `-t <字串>` **不会跳过未命中的 `it()` 函数体**（未命中的用例 `result=null` / `mode=skip`，而函数体照跑），于是「筛着跑一组」得到的绿混着根本没断言过筛选目标的绿。新增用例因此在第一步就用 `TestRunner.getCurrentTest()?.result?.state` 自证「这次真跑了」。
