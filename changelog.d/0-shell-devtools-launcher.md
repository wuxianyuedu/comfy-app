## Added

- **桌面壳的开发者工具入口（按钮 + 快捷键）**：排查渲染 / 脚本性能用。此前壳里
  **没有任何打开 DevTools 的入口**——Tauri 的 `open_devtools()` 门在
  `#[cfg(any(debug_assertions, feature = "devtools"))]` 后面，而本仓库的壳一律是
  `cargo build --release` 编的（`debug_assertions` 恒为 false），也没有任何代码去调它，
  所以桌面包里按任何键都开不了开发者工具。
  - 新增 cargo feature `devtools = ["tauri/devtools"]`，让该方法在 release 构建里也存在；
    调试时手动带上 `cargo build --release --features custom-protocol,devtools`。
  - 新增两个壳命令：`open_devtools`（开 main 窗口的 DevTools）与 `devtools_available`
    （能力查询）。`open_devtools` **写了两份**（带 feature 的实现 + 不带时的存根）：
    `generate_handler!` 是编译期展开的静态清单，少任一份另一种构建就编译不过。
  - 前端收口 `src/lib/shell/desktop-shell-client.ts` 的 `openDevtools()` /
    `devtoolsAvailable()`（`@tauri-apps/api` v2 **没有** `openDevtools()` 方法，
    所以走应用自有命令；视图层不直接 `invoke`，AGENTS 硬规则 9）。
  - 入口：顶栏 `⌄` → 应用菜单 →「开发者工具」，快捷键 `⌘/Ctrl+Shift+I` 与 `F12`
    （经 `useHotkey` 基元，规范 §16.2.4.23 / P20 唯一出口）。
  - **发布壳里入口整个不出现**：能力为 false 时既不渲染菜单项、也不注册快捷键 ——
    强于「渲染出来点一下报『未启用』」。浏览器里同样不注册，Ctrl/⌘+Shift+I 与 F12
    保持浏览器自己的行为不被 `preventDefault` 抢走。

## Docs

- 规范 §5 / `launch-and-build.md` 的重编命令补一句：`devtools` 是可选 feature，
  日常发布流程（`custom-protocol`）不带它。
