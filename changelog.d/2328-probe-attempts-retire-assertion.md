## Fixed

master 自身红的连带（#2328）：#2192 把首帧看护的「PROBE_ATTEMPTS × PROBE_INTERVAL_MS」
（u32×u64 编译地雷）退役成 poll_clock 墙钟预算，但 `tests/check-file-structure.test.ts`
那条「两常量类型同档」还在断言旧常量存在。改钉新不变量：常数声明与相乘表达式
不得回潮、超时秒数必须来自 `clock.budget_secs()` —— #730 的事故记忆由注释与断言共同保住。
