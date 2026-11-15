## Fixed

- 工坊 ComfyUI 通道轮询超时单独报错并尽力中断在跑 prompt（#3878，审计源 #3848）：超时不再误报「任务完成但没有输出文件」；超时后向 `/api/interrupt` 发尽力取消，不再让该 prompt 无限消耗 GPU。
