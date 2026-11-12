## Fixed

- **日志指路文案里的 `log/launcher/…` 简写统一对齐到实际落盘的 `log/current/launcher/…`（#3595）**：`#3574` 把 `log/shell/` 那批简写收掉之后，同一类残留还剩在启动链路这一侧 —— 用户可见的「启动相关的日志见…与 log/launcher/」、壳侧诊断段标题、启动器退出提示里的 `dev-launcher-stderr.log` 指向，以及注释与故事夹具里的 `dev-launcher.log` / `shell-launch.log` / `foreground-watch.log` / `dev-launcher-current.txt`。这些路径写于「一次运行一包」布局落地之前，用户照着找会指向一个不存在的目录；开发者读注释也会先拼错一次。
  - **改法**：`src/components` / `src/lib` / `scripts` / `src-tauri/src` / `.storybook` 与规范 §4 布局总表里的这批字面量逐处改成 `log/current/launcher/…`（或按语义保留「启动器」来源这种不带路径的指路）。只改文案与注释，路径常量与运行期行为一字未动。
  - **口径**：路径的唯一事实来源仍是 `src/lib/log/log-paths.ts`（应用侧）、`scripts/launcher-core/{run,log}.mjs`（编排侧）与 `src-tauri/src/shell_launch.rs`（壳侧）；本条只是让**指路的人**和**落盘的位置**说同一件事。
