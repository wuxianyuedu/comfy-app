## Fixed

- **双信号判据漏接最后一根线**（ISSUE #4146 的补丁）：#4152 那一笔的 `--add`
  暂存面漏点了 `use-dev-server-status.ts`——探活 hook 已供出 `processAlive`，
  但视图模型没把它递给 `deriveDevServerStatus`，判据永远收到 `undefined`（按
  「没有进程外信号」退化），双信号在界面上不生效。本笔把 `processAlive` 接进
  视图模型，`unresponsive` 软状态从此真正可达。
