## Fixed

- `tests/project-view-container.test.ts` 的两条用例在 `origin/master` 上是红的（全量档里
  `tests/project-view-container.test.ts (18 tests | 2 failed)`）。红不在本批改动上：
  ISSUE #1870 把 `mode-contract/ModeContractView.tsx` 的外壳从 `DocumentFrame` 换成
  `WorkspaceFrame`（模式清单收成左侧树形页签之后，文档型那层「整屏一条滚动条 + 居中窄栏」
  会让树随正文一起被推走），ISSUE #1871 又把容器内距下移到屏内 —— 两侧都在提交说明里写明了
  决定，但那张视图清单没跟着改，于是判据还在按文档型那一档要求它。
- 修法是**归位而不是放宽**：把这一屏从 `DOCUMENT_VIEWS` 挪进 `WORKSPACE_VIEWS`，它随即落到
  工作区型那组判据（引了 `WorkspaceFrame`、不自己写几何、不再叠第二条滚动）上。
  「传给容器的 className 必须带无变体 `px-`」这条对它**不再适用**而不是「被豁免」——
  那条判的是「居中列没封顶时左右留白归零」，这一屏没有居中列；留白的归属现在在屏内那一层，
  实测是 `ModeContractEditorView.tsx` 页眉与两栏容器上的 `px-4 sm:px-8`。
- 为什么单独一刀：这一格挡的是**全量单测档**，而它是这条线第 9 刀记账的前提（当天那一档
  跑不绿就没法记「跑过」）。与本批正文卫生的改动无关，所以不混在一个提交里。
