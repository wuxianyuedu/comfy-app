## Fixed

- **tw4 两份硬闸的行为自检在 Windows 检出上恒红，把每一个本地提交都拦下**：那两格断言写的是
  `expect(r.output).toContain("src/Dirty.tsx")`，而两份工具打的是 `path.relative()` 的结果 ——
  Windows 上是 `src\Dirty.tsx`，于是**点名点到了、断言却读不到**。这一族用例要钉的是
  「判定档退 1 且点出是哪个文件」，分隔符从来不是判据的一部分。
  改成 `namesFile(output, "src/Dirty.tsx")`（读回时把 `\` 归一成 `/`），两条断言共用这一个出口。
- **为什么它能落进 master 而没人当场发现**：PR 在平台侧 squash 合并、不跑本地钩子，而 ISSUE #623
  之后没有 CI 兜底 —— 硬闸类判据须为 0、没有「带病通行」的中间态，所以这类红会拦住从它分出的
  每一个提交。同族的另一条已登记在台账（R12-01「判据不许假定读者的 git 配置」），
  这一条是它的姊妹：**判据也不许假定读者的路径分隔符**。
- 实测：`pnpm exec vitest run tests/tw4-hardgate-behaviour.test.ts` 在本机（win32）
  改前 2 failed / 6 passed，改后 **8 passed**。
