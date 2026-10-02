## Added

- `scripts/shell-gate.mjs` 的**判决本身**有了执行者（ISSUE #1356）。此前
  `tests/shell-gate.test.ts` 真跑的只有两块：触发面 `decide()`（哪些文件算壳输入）与合并采纳过滤
  `dropAdoptedShellInputs()`（在临时 git 仓库里真造合并态）；而规范 §11.10.4 列的三条判决出口
  （`cargo test` 失败 / 没有 cargo / 壳二进制陈旧）加上「根本没编出壳」这一条，**一条都没被执行过**，
  顶着的是这样的断言：`expect(src).toContain("whichCommand")` 与
  `expect(src).toMatch(/return 1;\s*\n\s*\}\s*\n\s*if \(code !== 0\)/)` —— 抠源码文本。
  它的两向都不稳：加一行注释就红；把 `return 1` 挪进 helper、判决坏了却不红。
- 判决抽成可注入的纯入口 `runGate({ staged, root = ROOT, cargoRunner = runCargoTest })`，
  返回 `{ exitCode, steps }`；`main()` 只负责取清单、打印、把自己的退出码交给 `process.exit`。
  形状沿用 `check-dependency-audit.mjs` 的 `runAudit({ cwd, runner, fixtureFile })`（§12.18），
  注入只为让分支可测，**出厂行为不变**：改前改后同一条
  `node scripts/shell-gate.mjs --staged src-tauri/tauri.conf.json` 的输出逐字一致。
  `freshnessProblem(root = ROOT)` 接 root 是同一件事的另一半 —— 它此前被模块级 ROOT 钉死，夹具进不去。
- 新增 9 条用例（`runGate` 四条出口 + 顺序 + 单独可判 + CLI 传导）：没碰壳 ⇒ `steps` 为空且退 0；
  只改 conf 且 exe 新 ⇒ 0；只改 conf 且 exe 旧 ⇒ 1 且话术含 `二进制仍是旧的` 与
  `--features custom-protocol`；改 Rust 且没有 cargo ⇒ 1（**这条从文本断言变成真跑**）；
  改 Rust 且 cargo 退 7 ⇒ 交回 7 且**不再往下判时效**（顺序也是判据：编不过时时效消息会把真因
  挤成第二行，两笔钱不该一起花）；cargo 通过且 exe 新 ⇒ 两格 ok；没有 exe ⇒ 1 且给全重编命令；
  `freshnessProblem` 单测 newest/older；CLI 的退出码 == 同清单在进程内 `runGate` 的退出码
  （这条钉传导，且不依赖这台机器的壳新不新）。

## Fixed

- 那条抠源码文本的断言删掉（标题保留、实现换成真跑），并在原位写下「为什么不用文本断言顶」，
  免得下次有人觉得少了一条守卫。

## Verified

- 判据在真检出上**确实拦得住**（本条不是修坏，是补执行者）：
  `node scripts/shell-gate.mjs --staged src-tauri/tauri.conf.json` ⇒
  `✗ 本次提交改了桌面壳，但二进制仍是旧的（编译于 09-28 20:59，源码此后有改动）… 重编：
cd src-tauri && cargo build --release --features custom-protocol`，退 1。
  消息也**属实**、不是 mtime 抖动的假红：按四类输入逐个 stat，比 `target/release/app.exe`
  （`2026-09-28T12:59:50Z`）新的有 5 个，最新是 `2026-10-01T04:54:32Z src-tauri/src/lib.rs`。
- **变异验证三条，各自恰好红一条**：`freshnessProblem` 直接返回 `null` ⇒ 红 3 条
  （两条 runGate 陈旧/无 exe + 一条 freshnessProblem 单测）；cargo 缺失改成 `return 0` ⇒
  只红「没有 cargo 要退 1」那条；cargo 失败后去掉 `return` ⇒ 只红「退 7 且不再往下判时效」那条。
  还原后 22 条全过（此前 13 条）。
- `tsc --noEmit` / `eslint --max-warnings 0` / prettier 棘轮 / `doc:render` + `doc:check` 全过。
- 文档：规范 §11.10.4 那句「判据由 `tests/shell-gate.test.ts` 锁」按实测写清**锁的是哪两半**
  （触发面与合并采纳过滤一直是真跑；三条判决出口是这一刀才变成真跑的）。
- 仍然没有闭环、别当成的部分照原文留着：`src-tauri` 改动后的**启动冒烟**仍是人工清单
  （§11.10.4「仍然是人工的」那一块），本条不制造它已自动化的错觉。
