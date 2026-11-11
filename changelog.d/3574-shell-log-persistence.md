## Fixed

- **壳自持日志（`log/current/shell/shell.log`）恢复整生命周期落盘，`navigate_to_app` / main window Finished 等壳侧导航行为重新可观测（#3574，#3559 排查被卡的主因）**：
  - **根因**：release 壳的 `log::` 经 tauri-plugin-log 的 Folder target 落盘，而它把文件句柄攥到进程退出；`current/` 的生命周期里有「整目录清空」（启动时编排器的崩溃补做 `recoverStaleCurrent` 会把壳先写进来的会话头当作上一次的残留、退出时的收包归档 `archiveCurrent`），Windows 上删除持句柄文件即时生效（Rust std 以含 `FILE_SHARE_DELETE` 打开），此后插件的所有写入落进一个已解除链接的句柄——**静默丢失**，壳日志冻在启动头 8 行（实测三次运行全数复现；本机复现归档包里恰好 9 行 + 清空时刻的 run.json）。Stdout/Stderr target 在 `windows_subsystem` 下由 std 对无效句柄**静默丢弃**（`handle_ebadf`），无害也无需动。
  - **修法**：壳自持日志改走自定义 fern 分发（fern 经 `tauri_plugin_log::fern` 复用，不新增依赖）+ 按次开合的 `ResilientShellLog` 写入器：每行按路径重开 → 追加 → 即关，目录被清了下一行自己重建；超过 40MB 整份重建（丢旧保新，等效原 KeepOne 的防无界意图）。插件的行格式化管线原样生效，行形态不变，面板/诊断零改动。
  - **路径口径对齐**：注释与用户可见文案里 9 处 `log/shell/…` 简写对齐到实际落盘的 `log/current/shell/shell.log`（lib.rs 诊断段标题、launch 失败提示、launch-diagnostics / app-service-exit / downstream-exit 的指路文案）。
  - 用例：Rust 侧新增「文件被清后下一行重建」「越限重建」两条回归（`cargo test`）；真机验证为「双击 self-launch → 壳日志出现 `navigate_to_app` 多次、行数随会话增长」。
