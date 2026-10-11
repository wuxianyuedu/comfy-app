## Fixed

- **自编排链路里应用起不来（PR #1732 修复双窗口后的回归）**：上一步把「壳已查过端口族」
  在 `launchedByShell` 下整段跳过，但壳的单实例判据（`single_instance::another_instance_running`
  的命名互斥量）**只认「有没有别的壳在跑」、从不碰端口**——它看不到「上一次启动残留的
  `next dev` 还占着 3790 这种互斥量已释放、只剩端口占用的现场」。`reconcilePort` 才是回收
  本检出端口残留的**唯一入口**，跳过它后新 dev server 撞 `EADDRINUSE` 立刻退出，编排器随之
  `await [dev]` 解析为 1 整体退出（现象：两个窗口没了，应用也起不来）。
  - 修法：`dev-launcher.mjs` 步骤 4 的端口判据（含回收）**不再因 `launchedByShell` 跳过**——
    单实例才「只问一次」（壳拉起编排器前问过一次，编排器不再重复），端口族残留回收必须
    每次都跑，因为残留是**上一次**启动留下的，不在本次启动的单一实例假设里。
  - 规范 §1.7 改写：端口族回收只能由编排器做（壳侧不收端口），并补「跳过它 = 撞残留 =
    应用起不来」的现场说明。

## Tests

- `tests/dev-launcher-toolchain-gate.test.ts`：端口族用例改为钉死 `reconcilePort` 必须
  始终运行、不再有按 `launchedByShell` 跳过端口判据的分支。

## Docs

- 规范 §1.7：标题与表格改为「端口族回收只能由编排器做」，删除「编排器侧按 launchedByShell
  放行」的旧表述；`docs/generated` 已重新渲染。
