## Fixed

- **壳日志面板的 UTF-8 字节切片 panic**（#4212）：`tail_log_file_since_marker` 的字节
  截断点落在多字节字符（中文 3 字节/字）中间时 `joined[cut..]` 当场 panic——启动页
  每 800ms 轮询这条命令，正常启动越过日志分簿上限即可触发。截断点现在回退到字符边界。
- 同命令改用既有的 `read_tail_bytes` 只读尾部（此前 `std::fs::read` 整文件读入，
  shell.log 上限 40MB，主线程每 800ms 一次）；会话标记在尾部窗口之外时由双重截断
  收敛到同一条尾部。补 Rust 测试 3 例（多字节截断不 panic / 尾窗口不带回旧会话 /
  既有 marker 行为回归）。
