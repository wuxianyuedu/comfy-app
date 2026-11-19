## Fixed

- **Run 引擎起片启动失败补偿（#3962 / #3850）**：`execFilm` 在 `createFilmFromProject` 已落库但 `startFilm` 抛错时，尽力将已创建的 film 标记为失败后再释放 `filmStartedAt` 认领，避免遗留孤儿 PARSING/IDLE 影片行并允许规划器重试；原始错误与释放逻辑保持可见。
