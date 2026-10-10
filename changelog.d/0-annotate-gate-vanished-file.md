## Fixed

- `scripts/check-annotate-consumer.cjs` 不再因为「枚举到读取之间文件消失了」而整条崩：
  `tests/` 里有自造自删探针的用例文件（`.setup-cleanup-probe-<pid>-<ts>.test.tsx`），
  提交撞上它的存活期时这道判据以一条 Node 栈 `ENOENT` 收场 —— 报错指向一个谁都没碰过的路径、
  本判据的结论一个字都没输出、提交被拦下却读不出原因。同一族的
  `check-test-sleep` / `check-it-each` 已经处理过这一档（各自的用例里有那条），本份是漏掉的一个。
  只认「已经不在了」这一种跳过；权限 / 编码这类**读得到的失败照旧冒出去**，
  否则兜底会把「判据读不到输入」变成静默放行。
