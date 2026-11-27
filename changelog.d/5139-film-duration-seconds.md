## Fixed

- 成片时长不再把帧数当秒下发（#5139）：逐镜 params 同时落 `frames` 与 `duration`（秒 =
  帧数 ÷ fps），视频任务 values 一并下发两种单位，由端口按自己的落点挑；监看侧算
  `-t` / 字幕也用同一份秒值。无 duration 时按 frames / fps 折算，不再写死 81 帧。
