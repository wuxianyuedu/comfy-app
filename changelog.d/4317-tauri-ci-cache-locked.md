## Changed

**Tauri 的 CI 缓存与锁纪律按 #4317 收尾**

逐条核对 #4317 的建议与仓库现状：Node 侧缓存（setup-node `cache: pnpm` +
`--frozen-lockfile`）、npm 预编译的 `@tauri-apps/cli`、已入库且同步的
`Cargo.lock`、两处 rust-cache 本来就在 —— 这些已在场；本轮补三件缺的：

- 两处 `swatinem/rust-cache` 补 `cache-on-failure: true`：壳门禁 / 打包编译
  失败也把已编好的依赖留给下一跑，不再从零重来。
- `package-desktop.yml` 的 rust-cache 补 `workspaces: src-tauri`（仓根没有
  Cargo.toml，缺这份输入它只在根上吃 `cargo metadata` 的 exit 101）。
- 壳门禁的 `cargo test` 加 `--locked`：与 Node 侧 `--frozen-lockfile` 同一
  纪律——改了 Cargo.toml 必须同批更 Cargo.lock，漂移当场红（锁的同步已用
  `cargo metadata --locked` 实测）。

不采纳的部分（均有实测依据）：「换 Tauri 官方 apt 最小集」——#3580 实测官方
清单里 4 个模块永远探不到、对碰壳 PR 恒红，现清单是按编译期 `.pc` 反推的
最小集；「dtolnay/rust-toolchain」——两平台 runner 镜像自带工具链；「Node 24 /
setup-node@v4 / pnpm 10」——本仓钉 Node 26（engines）+ setup-node@v7 +
packageManager，降级即破坏工具链对齐。
