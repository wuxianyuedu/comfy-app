## Fixed

- 启动页两个轮询命令（`get_launch_status` 250ms / `get_launch_log` 800ms）改为 async 形态：同步文件 IO 落到 Tauri 命令线程池执行，不再周期性占用主线程——编排器与启动期同盘刷日志时，启动页不再叠加 IO 延迟抖动。JS 侧调用契约不变。（#4272）
