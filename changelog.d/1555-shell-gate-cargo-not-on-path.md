## Fixed

- **`shell-gate` 的 cargo 探针只认 PATH，把「没编出来」误报成「编不了」**（ISSUE #1555）：
  `scripts/shell-gate.mjs` 此前用 `whichCommand("cargo")` 判「这台机器能不能编壳」，
  而 CI / 容器镜像的 PATH 是**精修过**的 —— 实测本仓开发容器里 `which cargo` 为空，
  同一台机器上 `~/.cargo/bin/cargo` 与 `~/.rustup/toolchains/<版本>/bin/cargo` 都在。
  表现是改一行 Rust 就被拦下、提示去装 rustup，而 cargo 其实装好了。
  现在 `findCargo()` **PATH 优先、工具链默认安装位兜底**：`CARGO_HOME/bin` →
  `~/.cargo/bin` → `~/.rustup/toolchains/`（多工具链取版本号最大的那个）。
  PATH 那份仍是首选（用户可能自选工具链或用 distro 包管理器的），越过 PATH 猜 rustup
  才是第二选择；判据本身也**不许**退化成「递归整个磁盘」——回退面刻意只收这三处。
  找不到时的文案补上「已装却探不到」的指路（PATH 里加上 `$CARGO_HOME/bin`）。
  回归测试见 `tests/shell-gate.test.ts` 的「cargo 寻址」一组（假 home 真跑三层回退）。
