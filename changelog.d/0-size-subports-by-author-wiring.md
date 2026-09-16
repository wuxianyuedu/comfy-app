## Changed

- 尺寸落点拆成六个子口（`size-width` / `size-height` / `size-aspect` /
  `size-megapixels` / `size-resolution` / `size-multiple`）：形态由**作者连到哪个
  子口**声明，不再从端口名猜（`width` / `aspect_ratio` / `resolution_preset`… 猜错
  就静默落错形状）；候选按类型收（数值 / COMBO 口）。对外契约仍是**一个**「尺寸」
  口 —— 工坊送来的 `values.size` 由运行期按子口身份派成各自认的形状。
- 「尺寸」算配置完成要**能定出宽高**：宽 + 高，或 比例 + 分辨率档，或
  比例 + 像素量 + 倍数。定不出来就是未配置：状态显示未配置、`ready=false`
  （工坊封装面板的执行 / 测试按钮禁用、生成前预检未就绪）—— 尺寸子口没连线禁止
  在工坊运行。
- 存量里那条 `size` 线**只读迁移**：按落点端口的旧分类归到对应子口（不回写落库，
  作者下次改线才写新键）。
- 修一处既有缺陷：`deriveEncapsulationStatus` 的调用方传的是**存库原始形状**
  （`{ source: { "mode:X": {…} } }`），而下游 `resolveMapping` /
  `manualTargetFor` 只认解析后的映射表 —— 落点一个都读不到（每个契约口都被读成
  「未配置」、`ready` 恒 false）。现在入口解析一次，两种形状都能吃。
