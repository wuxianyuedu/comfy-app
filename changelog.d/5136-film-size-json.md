## Fixed

- 成片画幅不再被静默换成默认竖版（#5136）：`filmProject.size` 是 text 列、存 JSON 形态的
  尺寸表达，`toSizeSpec` 此前把 JSON 串当旧式 `"1280x720"` 解析、认不出就回落 3:4 默认档；
  现在先按 JSON 形态解析再落回宽高文本老路，非法 JSON 不抛。同批补数量与归一口径用例。
