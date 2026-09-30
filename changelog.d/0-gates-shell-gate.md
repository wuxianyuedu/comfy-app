## Added

- **桌面壳终于有提交门禁了：`scripts/shell-gate.mjs`**（接进 `.githooks/pre-commit` 的 D 组，
  判据由 `tests/shell-gate.test.ts` 锁；规范 §11.10.4 / AGENTS 硬规则 5 同步）。它补的是两条
  一直「只有文档口径」的洞：
  ① **壳里 37 条 `#[test]` 从不自动跑** —— `lib.rs` 18、`single_instance.rs` 8、
  `shell_launch.rs` 7、`detached_spawn.rs` 4，覆盖端口推导、单实例哈希分桶、进程回收、
  项目根上溯，而全仓没有任何一步执行 `cargo test`（它只出现在文档正文里）。表现是
  「Rust 侧改坏了，提交与本地钩子全绿」，要等下次出包或运行时才现形。
  ② **硬规则 5「改了壳必须重编」没有判据** —— 窗口配置与启动页是编译期内嵌的，只改源码
  不重编 = 跑旧二进制（历史黑屏事故来源），这条一直靠人记。
- **两步分开条件，不是一揽子**：`cargo test` 只在暂存改动里有 `src-tauri/src/*.rs` 时跑
  （实测本机冷 430s / 暖 40s，37 条本身只跑 0.07s，钱全在编译 —— 只改 conf 或启动页时
  不必付）；时效判据对四类壳输入都判（`tauri.conf.json` / `build.rs` / `src/` /
  `splash-assets/`）。没碰壳时这一步立刻返回 0，不给普通前端提交加一毫秒 —— 否则每个提交
  多等一次 Rust 编译，人就会去 `--no-verify`，判据反而归零。
- **时效判据复用现成的 `dev-launcher.mjs` 的 `shellStaleWarning()`**（§12.18，不写第二份
  比时间戳的逻辑），从「启动时打一条 WARN」升级成「本次提交改了壳而二进制没跟着重编 → 阻断」。
  ⚠️ **必须条件化**：该判据比 mtime，而 `git pull` / `checkout` / `stash` 会批量推进源码
  mtime —— 无条件阻断会让「拉了别人改壳的分支」把本地一个没动过壳的提交拦下来
  （`launcher-core/splash-assets.mjs` 里「内容没变就不写盘」就是在护这个数）。只有当暂存区里
  就是本次的壳改动时，这个比较才指向提交者自己。`cargo` 不在 PATH 时**不放行**，给 rustup 指路。
- 顺带纠一处假账：`shellStaleWarning` 的注释写着「判据与 `.ps1` 的 `Test-ShellFreshness` 同源」，
  而全仓已经没有那个函数（编排迁到 Node 时带走了）—— 改成指向真正的第二个消费方
  `scripts/shell-gate.mjs`。另把 §11.10.4 那份「壳 PR 合并前必须通过」的清单拆成
  **已机械化**与**仍是人工**两栏：启动冒烟（启动 / 协议 / 清理 / 日志出口）与「业务仍由
  Web 层覆盖」至今没有判据，别再混在一条看起来已闭环的清单里。
