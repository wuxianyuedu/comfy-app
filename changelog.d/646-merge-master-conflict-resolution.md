## Fixed

- **PR #646 与 `master` 的合并冲突按「`master` 的别名门禁优先、被推翻的口径同步收口」解决**：
  唯一冲突在 `UseWorkshopPipelinePersistence.test.tsx` 的 import 区 —— `master` 的 ISSUE #640 把全库
  `@/` 别名统一为 `~/` 并加了 R13 门禁，本分支则在旧写法上新增了定妆照相关 import 与
  `vi.mock("~/lib/workshop/character-portrait-client")`。冲突处取 `~/` 写法，模块替换已由
  `use-character-portrait.test.ts` 全局 `vi.mock` 覆盖，本文件的局部 mock 随之去掉（留着是两份
  会各自漂移的判据）；`master` 另在 4 个 `use-workshop-pipeline.ts` 的 import 里做了同样的收口，
  与本分支的语义改动无重叠，故无新增冲突。
