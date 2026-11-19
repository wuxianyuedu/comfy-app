## Fixed

- **`run.json` 的临时文件名固定成 `run.json.tmp`，两个进程并发写必有一个 `rename` 当场 ENOENT（#3663）**：`startRun` / `patchRun` 的写方本来就是多个进程（编排器记 pid、壳记退出码，各写 run.json 的一半），而临时名不带进程区分 ⇒ 先 rename 的把那份 tmp 移走、后到的 rename 直接抛 `ENOENT`。CI 上的现场是「受影响用例」那一格：`tests/shell-gate.test.ts` 与 `tests/cross-platform-launcher.test.ts` 被两个 worker 同时加载，而它们 import 的 `dev-launcher.mjs` 在模块顶层就 `startRun(ROOT)`。
  - **改法**：临时名改成 `run.json.<pid>.tmp`（与 `dev-launcher-session.mjs` 的 pid 后缀同一口径）；`rename` 在 Windows 上撞到「目标正被对方替换」时（实测 `EPERM`）做有限次重试，仍失败才收掉自己那份临时文件再抛。
  - **判据**：`tests/log-run-layout.test.ts` 新增一条确定性回归 —— 场上先放一份固定名 `.tmp`，本进程写完 run.json 后它必须原样还在（固定名的实现会把它覆盖并 rename 走，正是「被并发方抢走」那一件事）。
