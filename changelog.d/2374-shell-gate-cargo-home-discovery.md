## Fixed

壳门禁「探不到 cargo」的最后一处盲区：**「装在哪」原先只从环境变量推**（ISSUE #2374）。

- 用户报的真路径是 `G:\.cargo\bin\cargo.exe`，探针却说三处全空 —— 因为候选表里
  `$CARGO_HOME/bin` 那一处随 `CARGO_HOME` 一起消失（它是**用户级**变量，服务账号 /
  容器 / 自托管 runner 的会话里通常是空的），而 `~/.cargo/bin` 只按 `os.homedir()` 求。
  「装在那个用户的 `.cargo\bin`」于是与「没装」逐字同形。
- 候选表补两条**事实来源**：rustup 的 `settings.toml` 里记着的 `cargo_home`
  （`$RUSTUP_HOME/settings.toml`，未设时读 `~/.rustup/settings.toml`），以及
  `USERPROFILE` / `HOME` 与 `os.homedir()` 不一致时的另一种 `~/.cargo/bin` 写法。
  仍然只产出**有限几个候选目录**，一个字节也不递归磁盘。
- 全落的诊断句不再只说「PATH 与 rustup 的默认安装位都没有」：现在把探过的四处点全
  （`CARGO_HOME/bin`、rustup 记着的 `cargo_home/bin`、`~/.cargo/bin`、
  `~/.rustup/toolchains`），并明说那是「没装 / 装在别处」，下一步是 `where cargo` 核一次。
- 寻址判据整段搬到 `scripts/shell-gate-cargo.mjs`（`shell-gate.mjs` re-export，
  调用方导入路径不变）：落这一笔时主文件 925 行，撞上 R5 的 900 行硬闸。
