## Fixed

- **桌包（standalone）里内嵌服务没了，界面仍然说不出原因**（ISSUE #1692 的 sidecar 档）。前一版把「应用服务为什么断了」的原因交给旁证人落 `run/app-service-exit.json`，但只补了 dev / prebuilt 那条链（`scripts/dev-launcher.mjs` 的收尾定性）。桌包这一档走的是另一条链：壳活着、内嵌 server 没了，用户看到的是「窗口还在、页面全连不上」——原因一样无处可问，而带退出码的事实就在壳的手上。
  - 写入方补在壳侧：`shell_launch::write_sidecar_exit_record` 写在 `spawn_sidecar` 的 `CommandEvent::Terminated` 分支里（**这个事件是唯一带着退出码的地方**），落点与字段名和 Node 侧逐字相同，成因取 `sidecar`。
  - 与 Node 侧同一取向的两条：**退出码拿不到就写 `null`，不写 0**（0 是「正常退出」这个具体结论，编出来会把故障说成正常）；**写失败静默**（这条记录是排障体验，不是启动的必要条件，不该反过来把壳带崩）。项目根为空（安装目录里没有检出）时同样静默跳过，界面退回「没有原因可讲」。
  - 跨侧同源判据随之扩到第三处字面量：`tests/app-service-exit-contract.test.ts` 现在把 `src-tauri/src/shell_launch.rs` 也读进来核——文件名、字段名、成因取值各一条（Rust 源码是**读文本**核，编译期保证由 `shell-gate` 的 `cargo test` 在改了壳输入时承担，两边各管一段）。变异核过：改 Rust 侧文件名 / 成因取值 / 删一个字段名 → 各自精确红一条。

## Tests

- `src-tauri/src/shell_launch.rs` 的 `mod tests` 新增 5 条（`cargo test`，由提交门禁的 `shell-gate` 执行）：落点是 `run/app-service-exit.json` 且与 `launch-status.json` 同级、记录无 BOM 且七个字段齐全、**拿不到退出码写 `null` 不写 0**、项目根为空时静默返回 `false`、`sidecar_exit_reason` 只陈述事实（「未拿到退出码」与退出码 0 必须是两句不同的话）。
- `tests/app-service-exit-contract.test.ts` 新增 4 条：Rust 侧文件名与 Node 侧逐字相同、字段名与 TS 的读取键同源、成因取值落在 TS 联合类型里、终止事件那一支里真的落盘且写侧不出现「拿不到就编一个 0」。变异核验见上。
