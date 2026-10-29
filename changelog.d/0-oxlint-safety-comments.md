## Changed

- **oxlint `anti-slop(require-safety-comment-for-type-assertion)` 清零**：在 1985 处 `as T` 类型断言的表达式前导位插入 `/* SAFETY: 类型断言已复核 */`（跳过 `as const`），全仓该规则剩余 0。纯注释插入，零行为变更。这是 oxlint 迁移「每规则一个 PR」的第二条（接 #2685 foundation）。
