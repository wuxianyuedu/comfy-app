## Fixed

- **「加入资产库」不再必失败**（#4917）：历史页任务卡把产物沉淀进资产库时，
  `copyIntoAssetStore` 把来源产物地址（`/api/generated/<taskId>/…`）错按**资产子层根**
  （`generated/assets/`）解析，解出 `generated/assets/<taskId>/…` 这个不存在的位置，
  每张都「来源文件不存在」→ 整批零入库 → 界面只回一句「资产入库失败」。现在来源按
  **产物根**（`generated/`）解析、资产子层根只管复制目标，普通任务与项目任务
  （`projects/<pid>/<taskId>/`）两种产物形态都可入库；补了不 mock 文件层的回归用例
  （路由测试此前整体 mock 掉 asset-store，这层真实实现从未被测过）。
