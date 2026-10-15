## Fixed

- 懒加载分块失败的自愈（`src/lib/shell/lazy-chunk-recovery.ts`）不再是一次性的：判据从
  「标记写过就不再刷」改成**冷却窗口**（`RELOAD_COOLDOWN_MS`，60 秒）。此前的标记经
  `writeStorageItem` 落在 `localStorage`、且全库没有任何地方清它，于是「本会话刷一次」
  在实现上退化成**「这台浏览器一辈子只刷一次」**——第一次自愈之后，dev server 每重建一次
  （换一批分块）都会回到裸的 `ChunkLoadError`（现场：点开「设置」等懒加载屏整屏崩，而
  那个「会自动刷新一次」的兜底再也不出现）。现在窗口内不刷第二次（刷新死循环照旧防住），
  隔得比窗口久的就是新的一轮故障，自愈机会还给。
- 补一条判据钉住这个失效（`lazy-chunk-recovery.test.ts`）：冷却窗口之外再撞一次仍会刷，
  用例走假时钟，另在 `afterEach` 还原真实时钟。
