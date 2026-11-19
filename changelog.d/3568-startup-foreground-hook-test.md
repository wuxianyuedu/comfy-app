## Fixed

- **启动补前台 hook 的异步边界（ISSUE #3568，跟进 #3562）**：`useStartupForeground` 原先是 `void shouldActivateWindowOnLaunch().then(...)`，既没有卸载取消也没有 rejection 兜底。新增的回归用例把两条真实缺陷跑出来了：
  - **卸载后仍补前台**：壳命令是异步的，路由切页 / StrictMode 首轮清理会让组件在答复落地前卸载；答复随后落地仍会调 `activateMainWindow()`，把用户从刚切过去的窗口拉回来。现改为 `useEffect` 的 `cancelled` 守卫，卸载后不再发窗口动作。
  - **命令 reject 变成未处理 rejection**：现由 `try/catch` 静默降级，与 `desktop-shell-client` 的既有降级口径一致。
  - **StrictMode 反而丢掉补前台**：只加卸载守卫会让首轮 effect 消费掉壳的 `take_startup_activation()` 一次性标记、又因 cleanup 被取消，活着的第二轮拿到 `false`。现用 `useRef` 让**同一组件实例只问壳一次**、双跑 effect 共享同一份答复，并把「补唤」本身做成实例内一次性；真正的路由重挂是新实例，那一次壳答复必然是 `false`。
  - **判据**：新增 `src/components/studio/hooks/use-startup-foreground.test.ts` 6 条用例（true / false / 卸载重挂 / StrictMode / reject / 答复落地前卸载），mock `~/lib/shell/desktop-shell-client`；现行口径写进 `docs/standards/launch-and-build.md` §1.3.1 第 5 条。
  - 顺手校正两处 #3562 遗留的过时注释：`src/lib/shell/desktop-shell-client.ts` 与 `tests/check-file-structure.test.ts` 里「窗口只显示在任务栏并闪烁提示 / 进任务栏+闪烁」均改为现行口径。
