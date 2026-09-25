## Fixed

- **HomePage / VideoQueueModal 的宽 `Record<string, T>` 查表收窄为全函数，消除 ~12 处非空断言**：`KIND_CONFIG` 与 `STATUS_META` 此前按 `Record<string, …>` 声明，在 `noUncheckedIndexedAccess` 下每次查表都是 `T | undefined`，于是取值处逼出一串 `cfg!`（HomePage 卡片 7 处 + 占位卡 `KIND_CONFIG[kinds[i]!]!` 2 处）与 `meta!`（VideoQueueModal 状态徽标 4 处）。改为：把两张表收成**有限并集键**的 `Record`，再各包一个**全函数** `kindConfigOf(kind: string|null|undefined)` / `statusMetaFor(status: string)`——内部一次 `in` 守卫 + 固定兜底（generation / QUEUED），返回非空。调用点不再 `!`、也不再重复 `?? FALLBACK`；「宽字符串 → 归类或兜底」这一条判据收口到唯一一处。全库 `!` 总数 207 → 195，非空棘轮基线随之收紧。
