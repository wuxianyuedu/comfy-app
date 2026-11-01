## Changed

oxlint `eslint/no-else-return` 全仓清零：3 处 / 2 份。

三处都在 `try` 里、`if` 分支**所有路径都以 `return` 结束**，去掉 `else` 后执行流等价；fixer 只删了 `else` 与花括号，缩进与留下的空行是手工收的（`ShotStudio.tsx` 的 14 行、`proc-detect.ts` 的两段 16 / 15 行）。

#2775
