## Added

- **启动页新增「服务端动态」行（#4431）**：等待服务就绪是启动里最长的一段，
  此前画面上只有「等待服务就绪 12.7s（进行中）」一句。现在启动页每秒从**服务
  进程自己的输出**里挑出最近一条有信息量的行摆到进度文案下面——`▲ Next.js`
  横幅、`✓ Ready in …`、`[comfyui-lifecycle] ComfyUI 正在启动中，等待就绪…`、
  编译与报错行——「服务端此刻在做什么」一眼可读。健康探活的访问日志
  （`GET /api/health …`，每秒一拍）与 ComfyUI 拉起期的逐拍轮询（约 1.5s 一条）
  属高频噪声行，不进这一行（判据在壳侧 `shell_launch::latest_meaningful_server_line`，
  带用例）。新壳命令 `get_server_activity` 只读一份 Next 日志尾（8KB），启动页
  可常驻轮询；壳过旧（命令不存在）或服务还没输出时该行整体收起。紧凑档窗口
  高度 264 → 288（`SPLASH_WINDOW_SIZE` / `tauri.conf.json` / 页面兜底值三处同批）。
