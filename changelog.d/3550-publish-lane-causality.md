## Changed

- **§7.7「发布那一格本地与平台同一个入口」按今天的执行者改回事实**（#3550）：#3504 把 CNB 桌包档
  收敛为「GA 派发·桌面成品包」之后，`scripts/publish-desktop-bundle.mjs` 只剩本地一个执行者
  （GA 侧走 `upload-artifact` + 滚动 `nightly` Release）。规范 §7.7 的发布形状段、§7.0 那张表行、
  `tools/scripts/build-all.ps1` 的注释与 `package-desktop.yml` 的头注同批改成「本地唯一入口 /
  平台侧不同形」，并把退役出处统一指向 §7.7 已有的那段，不再在 workflow 里另抄一份。
