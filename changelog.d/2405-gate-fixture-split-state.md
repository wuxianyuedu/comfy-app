## Fixed

门禁夹具 `tests/helpers/gate-repo.ts` 的 `run()` 不再把三类失败折成一个数：交出
`{ code, output, ran, status, spawnError, signal }` 六件，并提供 `expectGateRan()` 让
「判据判出违规」「脚本根本没跑起来」「被子进程信号杀」三类在账面上长得不一样
（口径同 §13.6.4「拿不到测量 ≠ 测量结果是红的」）。

现场是 ISSUE #2405：PR #2404 的 `受影响用例` 那一格红成
`expected false to be true`（`tests/test-it-each-gate.test.ts` 的 ②′），而本地同尺复算
`Tests 10 passed (10)` —— **那一跑属于哪一类，当时没有读数能分辨**，因为折叠它的那份夹具
只交出一个布尔：`execFileSync` 的 throw 里 `status` / `code` / `signal` 连取都没取，
而 node 报 `Cannot find module` 退的**也是 1**。这一格要买的是「下一次能分辨」。

按那张单的第 1 条口径（**不批量回填**，见 §13.10）只动两份：
`tests/test-it-each-gate.test.ts`（在 CI 上红过的那一份）与
`tests/test-waitfor-gate.test.ts`（#2329 那份参照实现 —— 实现抽进共享件之后它自己也不再留一份，
否则就是第 18 份副本）。其余 15 份同款夹具不动，谁被改动、谁红过，就把那一份改成这个形状。

两点边界要说清：`code` / `output` 两个字段**值一字未改**（成功只给 stdout，非 0 退出合并两条流
—— 违规原文常在 stderr），所以既有消费者的断言不必跟着改；而共享件里那条 spawn 错误原文
叫 `spawnError`（单子写的名字是 `code`，那个位置在共享件上早已被退出码占用）。
量具自己的四条口径由 `tests/gate-repo-run-facts.test.ts` 守着（含**正反两半**：
同码的两格必须一格 `ran=true`、一格 `ran=false`）。本单**不新写门禁** —— 那是夹具与用例
自己的形状，`check-*` 那一层不加判据（§12.20）。
