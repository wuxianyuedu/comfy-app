## Fixed

- **bundle 预算闸 +4.6 KB 按例外流程认账**（ISSUE #2518）：基线 8b235623 之后 master 落了
  两笔客户端功能账 —— #2511（fr-sr 系列/季/集容器层，新增 `SeriesOrganizer`，单子的 A/B
  与 chunk 文案取证归到它 +1.5 KB）与 #2514（剧本评审与定向改写闭环，客户端面
  `ScriptReviewButton` / `use-script-review` 等 4 件）—— 合计 gzip 2191.7 → 2196.3 KB
  （本检出 HEAD `dd8d4647` 实测，文件数 224 不变）。认账不压回：两笔都是新功能面的正常
  体积；#2522（生图视觉评审）纯 server 面 0 客户端文件，不承担这笔。基线随本 PR 重写
  （`--update --allow-increase`，锚点 dd8d4647），判据一字不动。
