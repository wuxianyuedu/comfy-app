## Changed

- **快照收尾「先摘链、后摘 worktree」进规范 + 本机残骸清理**（ISSUE #2852）：
  base-check 本体的修复（`unlinkDependencies` 只摘 reparse point、顺序硬要求）早已在
  主干（a0f81c5fd，实测记录随测试入库），缺的是两件收尾：
  ① 规范 §13.6.2.1 的「两条环境口径」扩成三条——把「为什么顺序不可换」与
  「修复前遗留残骸要按同一顺序清」写成一处出处；
  ② 本机清掉 13 个 `comfy-base-check-*` 残骸目录（其中 6 条**活 junction** 指向
  另一份检出的 `node_modules`——修复前遗留，任何人 `rm -rf G:/Temp` 都会删穿那份
  检出），按安全序执行：`rmdir` 链接本体 → 再删目录，主树回读完好。
