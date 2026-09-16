## Removed

- **「首尾帧生视频」在模式选择器与模式契约里各出现两条（FLF2V / FL2V）**：两个 code 同义同名，面板上并排两行、看不出该选哪个。现只保留 **FLF2V**，删除 FL2V。`normalizeTaskType()` 增加「已删 code → 现存 code」别名表，库里若已按旧 `FL2V` 落过 `taskType` / `modes`，读取时归一到 `FLF2V`，工作流不会因模式码失效而丢掉首帧/尾帧口。新增两条回归测试：图类型表的 `(category, label)` 不得重复（同义 code 漏删会当场失败）、旧码归一。工作流名里带 `FL2V` 的启发式归类同样归到 FLF2V。
