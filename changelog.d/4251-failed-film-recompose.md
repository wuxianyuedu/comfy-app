## Fixed

- **FAILED 影片的「重新合成」不再静默空转**（#4251）：`claimComposing` 此前把
  `FAILED` 与 `COMPOSING/DONE/CANCELLED` 一起挡在认领条件外（#3867 防的是
  CANCELLED 抢跑），导致合成失败后装好 ffmpeg / 补齐镜头的用户点了「重新合成」
  没有任何反应，影片永久卡 FAILED。现在 `FAILED` 可被重新认领合成（显式恢复
  出口），`CANCELLED` 的抢跑保护保持不变。补仓储用例 1 例钉住两个方向。
