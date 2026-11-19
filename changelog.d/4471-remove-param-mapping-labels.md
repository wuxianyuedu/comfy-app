## Changed

- **删除 `ParamMapping.labels` 死通道**（#4471）：`parse` 恒给空、`serialize`
  不写、全部调用方传 `undefined`——生产不可达；且一旦启用行为是错的（按
  ioKey 在整个类型族候选池里取第一个命中，改「提示词」会连带改掉同族
  「负面提示词 / 时长 / 种子 / 尺寸子口」的卡名）。同批清理
  `buildParamEntries` 的 labels 参数与 override 分支、`clearModeWiring`
  的透传及测试断言。
