## Fixed

- **`check-test-todo.cjs` 不再被一份并发探针崩掉整个 D 组**（同族第 4 条，口径与
  `check-test-{sleep,waitfor,it-each}`（#1651）、`check-annotate-consumer`（#1665）一致）。
  现场不是推测：本仓一次**只改 markdown 的提交**被 D 组拦下，报错里没有站点、也没有任何
  人的改动，只有一个 Node 栈 ——
  `Error: ENOENT: no such file or directory, open '…tests\.setup-cleanup-probe-<pid>-<ts>.test.tsx'`。
  根因同前：`walk()` 列 `src|tests` 后逐个裸 `readFileSync`，而
  `tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造同名探针再删；同一工作树里
  两个 vitest 在跑时（并行会话，或本钩子的 C 组还没退干净），扫描正落在
  「列到名字、读时已没」那个窗口里。

## 口径

- 读不到 ⇒ `readForScan` 返回 `null`，由调用方计数；两条结论行都追加
  `⚠️ 另有 N 份文件在扫描期间消失（并发用例的临时探针），本轮未读`（N=0 时零输出）。
  **不静默跳过**：静默等于让判据在它其实没读过的目录上绿（§13.5.12 那一族）。
- 顺带把脚本尾部改成 `if (require.main === module) process.exit(main())` 并导出
  `readForScan` —— 此前它是**无条件** `process.exit(main())`，于是这份判据**没法被进程内
  测试**：`require` 它就把宿主测试进程一起带走。同族三条判据早就是这个形状，本条补齐。
- 扫描面、基线、棘轮数字一律未动；`test.todo` 站点数与台账登记数都不受影响
  （改的只是「读不到时怎么办」）。

## 验证

| 项                                             | 结果                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-test-todo.cjs`             | OK，输出与改前逐字一致（本轮无消失 ⇒ 不打那一行）                                                                                                                                                                                                                                  |
| `tests/test-todo-gate.test.ts`                 | 10 passed（+1 条「消失的文件」用例）                                                                                                                                                                                                                                               |
| **变异复核**                                   | 摘掉 `ENOENT → null` 那行 ⇒ 新用例当场红在 `Error: ENOENT …`；装回即绿                                                                                                                                                                                                             |
| 用例形态                                       | 走**进程内**调用导出的 `readForScan`，不在临时仓库里造「删文件的时机」（那是概率窗口）                                                                                                                                                                                             |
| 剩余同形状判据                                 | 现跑循环复算 = **7 份**（`check-dead-exports` / `check-gate-repo-boilerplate` / `check-soft-assertions` / `check-task-meta-consumer` / `check-test-concurrency` / `check-test-environment` / `check-type-assertion-executor`）；清单与循环都写在 `0-gate-scan-vanished-file.md` 里 |
| `tsc --noEmit` / `eslint` / `prettier --check` | 见下方提交（钩子全跑）                                                                                                                                                                                                                                                             |
