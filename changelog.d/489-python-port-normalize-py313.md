## Fixed

- **Python 3.13+ 上「端口推导跨语言一致性」门禁必挂（pre-commit 9/9）**：`scripts/app_port.py` 的 `normalize_root_for_port` 只把「盘符路径 / UNC / `os.path.isabs` 为真」当绝对路径，而 Python 3.13 起 `ntpath.isabs()` 对「只有根、没有盘符」的路径返回 False（`os.path.isabs('/workspace')` → False）。于是 `/workspace`、`/home/dev/proj` 这类输入掉进 `abspath` 分支被拼上当前盘符（`f:/workspace`），与 Node `path.isAbsolute`、PowerShell `IsPathRooted`、Rust 原样处理的结论分歧 —— 四侧对同一输入端口不同（§1.1 要求逐字节一致），提交被门禁拦下。现在显式补上「根锚定（前导分隔符）= 绝对路径」判据，与其余三侧同义且不随 Python 版本变化；`python3`(3.14) / `python`(3.12) 两侧对同一份共享向量均通过。
