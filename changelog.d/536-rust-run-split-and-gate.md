## Changed

- **Rust 壳的 `run()` 从 278 行拆到 79 行，只剩「环境解析 → Builder 装配 → 启动步骤 → 进入事件循环」**：`src-tauri/src/lib.rs` 的 `run()`（全项目最长的后端函数）此前把单实例判定、窗口创建、启动页尺寸、加载完成时的窗口交接、关启动页即放弃、启动页看门狗、standalone sidecar 启动、托盘创建与运行期事件回调全塞在一个函数里。现在按职责切成命名步骤 —— `setup_splash_window`（收事件 + 定尺寸居中）、`create_main_window`（建隐藏主窗）、`on_main_page_finished`（加载完成的交接判定，含「忽略 about:blank / 内部错误页」与 TCP 可达性二次校验）、`install_splash_close_handler`（关启动页 = 放弃启动并退出）、`spawn_splash_watchdog`（custom-protocol 看门狗，dev 下留空实现使调用点不必按 feature 分叉）、`setup_standalone_runtime`（release 下按启动模式起 sidecar + 启动页缺失兜底）、`handle_run_event`（退出回收 sidecar + 任务栏未打开日志）。`run()` 本体保留为**装配清单**，行为逐字不变，原先承载「为什么这么做」的注释随各自逻辑一起搬到新函数上。

## Added

- **Rust 侧函数长度门禁**（`scripts/check-rust-function-length.cjs`，规范新增 §12.13.1）：§12.13 的 TS/TSX 门禁（`check-function-length.cjs`）**扫不到 Rust** —— 于是上面那个 278 行的 `run()` 在「函数该不该拆」这件事上**没有任何机器信号**，这正是 ISSUE #536 P4 里那条「Rust 侧没有函数长度门禁」的缺口。新门禁扫 `src-tauri/src/**`，按**文件**的「超阈值函数数」记棘轮（`scripts/.rust-function-length-baseline.json`，当前 **0**），只许降不许升。
- **阈值取 120 而非 JS 侧的 400**：两侧代码的「自然长度」不同 —— TS/TSX 有大量 JSX 与类型声明，单个组件函数几百行尚可读；Rust 侧是结构化编排，120 行已属该拆。用 400 会让本次要修的 `run()`（278 行）整段落在阈值下面，门禁在、却对目标实例一声不吭。判定细节补了 Rust 特有的两种字面量：**`r#"…"#` 原始字符串**里的括号、以及 **`'` 的两义性**（字符字面量 `'x'` 要跳过，生命周期 `'a` / `&'a str` 不能当引号，否则状态机错位）；泛型尖括号（`Vec<Option<T>>`）与 JSX 同理由「只认 `()` `{}` `[]`」保证不参与配对。
- 新门禁接入 `pre-commit`（第 13 步）与 CI（`Rust function length ratchet`，`--strict`）；回归测试 `tests/check-rust-function-length.test.ts`（10 例，含「字符串 / 字符字面量 / 注释里的括号不参与配对」「生命周期与泛型尖括号不破坏配对」「同一文件再长出第二个超长函数仍算上升」等反向验证）。
