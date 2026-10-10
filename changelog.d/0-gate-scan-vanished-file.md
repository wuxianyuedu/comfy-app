## Fixed

- **三条「测试层」判据不再因为一份并发探针而整机崩掉**（`check-test-sleep.cjs` /
  `check-test-waitfor.cjs` / `check-test-it-each.cjs`）。现场：本仓提交被 D 组拦下，
  报错不是站点而是 Node 栈 ——
  `Error: ENOENT: no such file or directory, open '…\tests\.setup-cleanup-probe-244724-1791606669965.test.tsx'`，
  指向的文件谁的改动里都没有。根因是这三条都按 `walk()` 列 `src`/`tests`/`e2e` 再
  逐个 `readFileSync`，而 `tests/global-setup-cleanup.test.ts` 会在 `tests/` 下**临时造**
  `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删掉 —— 同一份工作树里有两个 vitest 在跑
  （并行会话，或本钩子的 C 组还没退干净）时，扫描就落在「列到名字、读时已经没了」那个
  窗口里。`.test.tsx` 恰好命中三条判据的扫描面，所以**每次并发提交都会撞**。

## 口径

- **消失 = 返回 `null`，由调用方计数**，不是抛、也不是静默跳过：一个已经不存在的文件里
  没有站点可言（不该算违规），但「这一轮有 N 份没读到」必须让看的人知道 —— 静默跳过就是
  §13.5.12 那一族「判据自称在跑、实际没跑」的入口。三条判据的结论行都追加了
  `⚠️ 另有 N 份文件在扫描期间消失（并发用例的临时探针），本轮未读`（N=0 时一个字不打，
  普通提交零噪声）。
- **没动扫描面、没动基线、没动任何棘轮数字**：三条判据在本仓当前树上一处站点都不报，
  改的只是「读不到时怎么办」。
- **只收了这三条**。扫描面含 `tests` 的判据共 **15 份**，其中与本轮同形状（`walk()` 列目录 +
  裸 `readFileSync(abs)`）的有 9 份：`check-annotate-consumer` / `check-dead-exports` /
  `check-gate-repo-boilerplate` / `check-soft-assertions` / `check-task-meta-consumer` /
  `check-test-concurrency` / `check-test-environment` / `check-test-todo` /
  `check-type-assertion-executor`；另 3 份扫 `tests` 但不是这个读法
  （`check-comment-language` / `check-gate-executors` / `check-tsc-diagnostic-executors`）。
  本轮撞上的就是这三条 —— 它们按 `.test.tsx` 命中，而探针恰好叫这个名字。
  **那份清单是会被收短的**：写下 9 之后，`4887f1f1`（#1665）收了 `check-annotate-consumer`、
  另一笔收了 `check-test-todo`，当前实测剩 **7 份**。所以别引用这个数，现跑：
  ```bash
  for f in scripts/check-*.cjs; do
    grep -q '"tests"' "$f" || continue
    n=$(grep -c 'readFileSync(abs' "$f"); e=$(grep -c ENOENT "$f")
    [ "$n" -gt 0 ] && [ "$e" -eq 0 ] && echo "仍裸读: $f ($n 处)"
  done
  ```
  **把这 8 份一起收进共享读取器（`readForScan()`）是另一刀**：那是多份文件同一个形状的事，
  顺手改会把「谁在有证据地拦」糊成一团；要么按现场逐条收（#1665 走的就是这条），要么一次收完
  并给那份共享读取器配它自己的判据与用例。两边都得能答出「读不到的时候，谁在数」。

## 验证

| 项 | 结果 |
| --- | --- |
| 三条判据在干净树上 | 各自 OK，输出与改前逐字一致（无消失 ⇒ 不打那一行） |
| `tests/test-{sleep,waitfor,it-each}-gate.test.ts` | 31 passed（每份各 +1 条新用例） |
| **变异复核** | 摘掉 `check-test-it-each.cjs` 的那条 `ENOENT → null` ⇒ 新用例当场红在 `Error: ENOENT …`；装回即绿 |
| 用例形态 | 走**进程内**调用导出的 `scanFile`，不在临时仓库里造「删文件的时机」—— 那是一次概率窗口，判据不许长在上面 |
| `tsc --noEmit` / `eslint` / `prettier --check` | 0 error / 0 warning / 干净（只点名本次改的文件） |
| `.githooks/pre-commit` | 见下方提交 |
