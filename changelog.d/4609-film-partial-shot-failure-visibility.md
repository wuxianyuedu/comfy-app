## Fixed

- 成片编排里部分镜头失败仍静默合成出片（#4609）：监看侧只在「全部失败」才判
  FAILED，5 镜失败 2 镜的影片照样 DONE 出片，影片日志只有「所有镜头完成」，
  失败原因只落在 shot 行。现在 `composeFilm` 进合成前把失败镜头的序号与
  `task.error` 原因写进影片日志 warn，成片预览面板在 DONE 且有失败镜头时
  露出「N 镜失败，已用其余 M 镜合成」——缺段的片子从无声交付变成知情交付。
  `findExecutionProgressMany` 同批带上 `error` 列，失败原因随进度一轮批量取。
