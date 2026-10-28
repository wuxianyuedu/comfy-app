## Fixed

**桌包那一档（02:00 / 手点）带上壳工具链那一对变量，并把 `$env:CARGO_HOME\bin` 前置到 `Path`**（ISSUE #2549）。
今天 02:00 那一跑（`cnb-5j8-1k5v8acjd`）红在 `打包·壳工具链自证`（2.2s），后面三格整片 `skipped`
⇒ 当天没有桌面成品包，也没有发布那一格的任何读数。

- 根因是**执行账号的不是同一份环境**：runner 服务 `orange-runner` 跑在 `LocalSystem`，
  而 `CARGO_HOME`（`G:\.cargo`）与 `G:\.cargo\bin` 都是**用户级**的变量与 PATH 项 ——
  与 Python / pnpm 那两次（ISSUE #1961 / #1959）是同一条岔路；
- `重档静态判据` 那一格早就为同一件事配过这一对值，桌包那一档（ISSUE #2503）新加的两格
  **没有带** ⇒ 同一个根因在这一档原样复现。现在那一对值收进 `.cargo-env` 锚点，三处共用一份；
- 只给变量还不够：探针与 `pnpm tauri build` 都是**按名字**起 `cargo` 的，所以这两格额外
  把 `$env:CARGO_HOME\bin` 前置到 `Path`；
- `--rust-only` 缺件时补一份取证读数（PATH 原文 / 那对变量的值 / `$CARGO_HOME\bin` 的命中），
  于是「这个账号看不见」与「这台机没装」在日志里不再逐字同形。

未动的一面：这一跑仍然**不装**任何东西 —— 壳工具链不是 pnpm 依赖，装它走 rustup。

附带一笔（同一批改动、同一份判据带出来的）：给 `--rust-only` 补取证时本文件涨破 900 行
（`check-infra-file-size.cjs` 的硬闸，§12.6 R5），按 Python / 浏览器那两次的同一条边界
把 pnpm 探测与取证（`pnpmPathValue` / `pnpmPathEntries` / `findPnpm` / `pnpmForensics` /
`isFileOnDisk`）拆到 `scripts/ci-toolchain-pnpm.mjs` —— selfcheck 留编排与打印，
那份留机制；仍然只用 node 内建、不 import 仓库内模块。
