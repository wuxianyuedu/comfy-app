## Fixed

- 字体配置按 #3784 补充意见改为**按部分陈列 + 按部分各配一种**（#3794）：
  每档的当前字体栈按类分组陈列（西文/等宽首选、中文字体、系统回退——
  默认字体是什么一眼可见）；每个可配部分各一个单行输入（每部分一种字体，
  留空 = 该部分用默认）；系统回退为固定档不提供输入。新增 `fontGroupsOf` /
  `slotInputValue` / `stackWithSlotFont`（appearance-font-helpers.ts），
  上一轮的 `primaryFontOf` / `stackForPrimaryFont` 由槽位模型取代。
