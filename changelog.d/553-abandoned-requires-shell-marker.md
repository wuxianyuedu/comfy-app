## Fixed

- **启动失败定性不得由「壳也退出了」这种共同现象推断，只能由壳侧正标记决定**（ISSUE #553 后续）：Prebuilt 链路的收尾路径对三种成因给出完全一样的观察值（dev server `exit=0` + 壳退出 + `dev-launcher-stderr.log` 里只有几行壳的 INFO），所以「上一次启动是被关掉的启动页还是壳被顶掉」在现行日志下**无法判定**，任何「大概率是用户放弃」的措辞都会把真故障说成设计内行为。`scripts/dev-launcher.ps1` 一律先取 `$shellAbandoned`（壳写的 `exiting app (launch abandoned)`）再定性：有标记 = 用户放弃、不弹失败框；无标记 = 壳被外部终止、提示指向 `log/shell/shell.log`；`$shellAbandoned` 不再参与 `shell-terminated` 分支的判定（有标记时已被上一条分支拦下）。回归测试 `tests/dev-launcher-downstream-exit.test.ts` 增加「定性只认正标记」用例。
