## Fixed

缓存槽读数的「超配额里被 TTL 挡着几个」不再把空壳数进去：`listSlots` 的 `heldByTtl`
按执行档同一份谓词（`isUselessShell`）剔掉「没有产物、没有指纹、没有锁、目录 mtime 过了
TTL」的那几个目录 —— 空壳没有邮票、看起来在闸门内，旧读数会把它们念成「可能正被人用、
所以留着」，而 `pruneSlots` 对它们本来就不看配额与邮票地回收。于是同一份盘上两句相反的
结论同时打印的问题消失，「超额几个」与「其中几个真被挡着」两个数不再与执行面差一个。

空壳谓词与写锁文件名一起搬到读数侧（`scripts/ci-cache-slot.mjs` 的 `isUselessShell` /
`SLOT_LOCK_FILE`），执行档从那里 import —— 依赖方向本来就是执行 → 读数，两处各写一份
正是这张单的现场（#2494）。回收行为一个字没变，`emptyCount` 的口径也没变。

用例钉住「读 ⇄ 执行同读数」：四个可用键 + 一个空壳、当前键未落盘时，
`heldByTtl` 与 `pruneSlots().held.length` 必须相等，且空壳出现在 `evicted` 里。
