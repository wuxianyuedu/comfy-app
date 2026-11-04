## Changed

- **清掉 oxlint T1 的 B1 存量：`no-use-before-define`（`functions: false`）48 份 / 75 处**。
  这些是 `const` / `class` 在被定义之前就被引用（TDZ 真隐患），逐文件把声明前移到首次使用
  之前；`lifecycle-exit.ts` 的 `stop ⇄ tick ⇄ handle` 三向环改用持有对象解环，行为等价。
  判决面 `oxlint.parity.config.mjs` 同步删掉 B1 的 48 条文件级豁免（新代码不再豁免），
  台账 `docs/audits/2026-11-04-oxlint-t1-burndown.md` 标为已清。
- 顺带补一条既有存量挂账：`tests/progress-heartbeat.test.ts` 1 处 `no-await-in-loop`
  （该文件在探针之后入库），记入 B2，不逐行禁用。
