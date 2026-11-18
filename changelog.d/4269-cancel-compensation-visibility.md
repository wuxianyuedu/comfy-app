## Fixed

- 补偿取消子任务失败不再静默：取消影片（cancelFilm）与首帧等待失败（firstframe）两条补偿路径的撤单失败现在会留 warn 日志。此前撤单失败无痕迹，任务会照常在 ComfyUI 侧执行——白烧 GPU，并占满 MAX_CONCURRENCY=1 的唯一执行槽、阻塞后续全部出图任务。（#4269）
