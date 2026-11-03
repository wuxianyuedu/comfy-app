## Fixed

**scripts-typecheck 判据的「筛不了入库清单」不再被静默折成「面 = 磁盘展开」**（ISSUE #2965）：
`trackedMjs()` 此前把「不是 git 顶层（真·夹具形态）」与「git 命令失败（真故障）」归成
同一个 `null`，后者一落进来，判决面就悄悄变成磁盘 glob 展开 —— 平台上「230 vs 229」
的红因此说不出来历。现在拆开：

- 新增 `trackedMjsDetailed()`：三分 `ok` / `not-git-top` / `error`（附 stderr 首行）。
- `main()` 拿到 `error` 当场退 2（没结论），并念出失败的那条 git 命令与 stderr 首行；
  只有 `not-git-top` 才走原来的「没按入库清单筛 ⇒ 面 = 磁盘展开原值」那一档。
- `trackedMjs()` 旧契约不变（两类失败仍都是 `null`），区分走 detailed 那一份。
- 用例补钉子：真仓库根 / 子目录 / 不存在目录三类形状各一条，外加「真 git 夹具 +
  索引损坏 ⇒ 退 2 且不许出现『没按入库清单筛』那句」的端到端一条。
