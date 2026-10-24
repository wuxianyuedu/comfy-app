## Fixed

「起一个真进程、判它退出码」那类用例，失败时**终于能说清为什么**（ISSUE #2287）。

这些断言原先把失败原因写成 `expect(r.status, r.stderr)`，而被检的脚本（`check-pnpm-available.mjs`
一族）按 §4 的口径把结论写在 **stdout**、stderr 是空的 —— 于是日志里只剩
`expected 1 to be +0`，一个字的原因都没有。2026-10-24 平台上那条链就是这么红的 7 格：
6 格没有任何原因读数，全靠唯一一条写了 `expect(r.status, out)` 的用例把原话带了出来。

- 11 处消息位改成仓内既有写法 `` `${r.stdout ?? ""}${r.stderr ?? ""}` ``：
  `tests/dev-launcher-toolchain-gate.test.ts` 5 处、`tests/linux-env-bootstrap.test.ts` 4 处、
  `tests/hook-affected-launch.test.ts` 2 处。判绿时行为一字未变，判红时两条流都进消息。
- **没有新增门禁**：`\.status, .*\.stderr\)` 那种正则会把「故意只判 stderr」的用例一起判红，
  而这条收益只在失败时显现 —— 按规范 §12.20「入口里不另立第二套判定」，改完这 11 处就是终点。
