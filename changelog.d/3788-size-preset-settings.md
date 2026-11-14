## Added

- 设置页新增「尺寸配置表」分区（#3788）：图片 / 视频两场景的「比例 × 分辨率」
  宽高表逐格可改，改完即存；每场景可一键恢复默认。
- 尺寸预设表的存取从浏览器 localStorage 改为**两层来源**：项目默认
  （`src/lib/media/size-presets.ts` 的 `DEFAULT_SIZE_PRESET_TABLE`，跟代码走）
  + 本机覆盖（`data/size-presets.json`，应用数据，随这台机器走），读取侧逐格
  合并；旧 localStorage 键在启动时一次性迁移到应用数据。服务端存储见
  `size-preset.server.ts`，客户端 store 经 `/api/size-presets` 同读同写。
