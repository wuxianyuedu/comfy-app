## Fixed

- **勾选「保活（应用退出后不关闭）」后，一关应用 ComfyUI 仍然跟着没了**：被保活的服务**仍在壳的 Job Object 里**。壳给编排器挂了 `KILL_ON_JOB_CLOSE` 的 job（壳被硬杀时的 OS 级兜底），而 job 成员身份在**进程创建时继承** —— 原有的 powershell `Start-Process` 中介只做到了「树级 `taskkill /T` 遍历不到」（目标成为孤儿），job 这一层没解决：壳一退出、job 关闭，整棵树（含 ComfyUI）当场终止。逃出去需要两半配合，缺一不可：父 job 允许（`JOB_OBJECT_LIMIT_BREAKAWAY_OK`）+ 创建时请求（`CREATE_BREAKAWAY_FROM_JOB`），而后者 `child_process.spawn` 与 `Start-Process` 都传不了。

  修法（规范 §3.4 记了判据与硬规则 3 的边界）：`shell_launch.rs` 的 job 补 `BREAKAWAY_OK`；新增壳的 **CLI 形态** `app.exe --spawn-detached --cmd <exe> --arg … --out … --err …`（`src-tauri/src/detached_spawn.rs`）当脱离 job 的中介 —— 它带该标志创建目标，成功打 `pid=`、失败写 stderr 并返回 1，与旧中介契约一致；壳把自身路径经 `COMFYAPP_SHELL_EXE` 发布给下游（编排器 → dev server），`process-launch.ts` 的 Windows keepAlive 分支据此优先走它，拿不到时（如 `pnpm tauri dev`：那时没有 job 要逃）退回 `Start-Process`。**改 `src-tauri/src/**` 后必须重编壳**（`cd src-tauri && cargo build --release --features custom-protocol`）。
