## Fixed

- 门禁自测夹具 `tests/helpers/gate-repo.ts`：src/ 下重名的 .ts 依赖不再被静默按「遍历先见者」解析（会指错真源，比缺件更难排查）。索引构建抽成 `buildRuntimeSourceIndex`：遇到重名 basename 从索引剔除并标记 ambiguous，`copyGateDeps` 命中时向 stderr 给一句可读告警、不再自动补齐——缺件可归因，并指路 `GateRepoOptions.copy` 显式拷贝。注释里「只收全 src 唯一名」的意图自此有实现与用例背书。（#4702）
