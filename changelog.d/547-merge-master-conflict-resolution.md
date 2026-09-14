## Fixed

- **PR #547 与 `master` 的合并冲突按「两侧都留、后到者让号」解决**（ISSUE #536）。
  两轮冲突都在「版本号与门禁序号」这类共享坐标上，不在业务逻辑里，两侧改动均为真实新增。

  **第一轮（`master` = 598a541）**：唯一冲突在 `docs/README.md` 第 12 章索引摘要行 ——
  本分支补了「含 Rust 壳 12.13.1」，`master`（ISSUE #535）补了「含小函数跨层复制 12.12.1」。
  两个子节在规范正文里并存无冲突，故索引摘要取并集。

  **第二轮（`master` = f3af73a，ISSUE #534 ComfyUI 端口口径）**：
  - `.githooks/pre-commit`：`master` 在重复块门禁之前插入了新的第 11 步
    （`check-comfyui-port-contract.cjs`），与本分支新增的第 13 步（Rust 函数长度）
    撞序号。解法是**保留两侧、按实际执行顺序统一重排**：端口口径 → 跨文件重复块 →
    函数长度（TS/TSX）→ 函数长度（Rust），并把全部步骤的进度标记由 `n/13` 收口为 `n/14`。
  - `docs/standards/13-提交与-code-review.md`：门禁清单同步为上述 4 条的并集（去重同一条目的
    两种注释写法），与钩子顺序一致。
  - `docs/README.md` 第 12 章索引摘要沿用第一轮的并集结果。
  其余文件（`src-tauri/src/lib.rs`、`scripts/check-rust-function-length.cjs`、
  `scripts/check-comfyui-port-contract.cjs` 等）由 git 自动合并，未做额外改动。
