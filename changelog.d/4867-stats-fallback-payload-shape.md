## Fixed

- 底部状态栏不再把「ComfyUI 进程在跑但状态接口读不到」谎报成「ComfyUI 未运行」（#4867）：`/api/comfy/stats` 的降级包此前只有 `{online:false, processAlive}`，缺客户端形状收窄（`isComfyStatsPayload`）必查的 vram/ram 数值字段——整个回包被判「形状不合法」抛掉，`processAlive` 随之丢失，store 把「进程在跑」记成完整失读，连续三拍后状态栏恒显「未运行」。现降级包带全零数值字段，进程在跑时 store 按「在线结论保持」渲染（数据置 stale）；真离线才显示「ComfyUI 未运行，显存/内存暂不可用」。现场：ComfyUI 自身 `/system_stats` 持续 500（ComfyUI 0.45.5 + comfy-aimdo，外部依赖问题，待其侧重启/升级观察）。
