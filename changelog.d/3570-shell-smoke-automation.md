## Added

- **真实 Tauri 壳冒烟自动化落地**（ISSUE #3570）：新增 `pnpm shell:smoke`
  （`scripts/shell-smoke.mjs` 入口编排 + `scripts/win32-shell-smoke.py` 观察脚本，
  只吃 Python 标准库，与 `win32-window-focus.py` 同族），在真实 Windows 会话里
  跑 release 版 `app.exe`（双击等价的完整用户路径），用 Win32 读数
  （`GetForegroundWindow` 前台归属、`IsWindowVisible` / `IsIconic`、Z 序链）与
  壳自持日志（`shown without stealing focus` / `activated` /
  `window-show diagnostics at exit`）交叉印证五个场景：不抢前台、交接后不重放、
  二次启动的最小动作、闪烁收口（FLASHW_STOP）、启动前台标记一次性消费。
  退出码三态（0 全过 / 1 有场景红 / 2 前提不成立），失败读数逐条可读、可直接贴单。
  它是**人工 / 按需档**（要在真实桌面会话起 GUI 进程），不进提交钩子；
  `docs/guides/TESTING.md` 的壳冒烟勾选项已勾上，规范 §11.10.4 同批登记。
