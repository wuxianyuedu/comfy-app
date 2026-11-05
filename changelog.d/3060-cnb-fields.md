## Added

- 新增 `scripts/cnb-fields.mjs` —— `cnb … -v` 字段取法的单一出处（ISSUE #3060）：信封解包（`cnbData`）、缺键显式化（`readCnbField`：「data 缺键 X」与「信封形状不对」是两种 `ok:false`，从前它们在读数上长得一样——同一次会话两种写法对 `is_merged` 给出相反结论）、清单解包（`cnbRecords`：`data` 数组 / 分页双层 / 裸数组三种形状一份出口）。`ship-core`（readPullVerdict / pullRecordForBranch）、`ship-build`（readBuildVerdict）、`ship-claim` / `ship-close` / `ship-issue-new` 的取法点已收口到这一份；类型收窄走谓词不走断言（#3167 的 `no-unsafe-type-assertion` 口径）。§13.6 口径句同批补登记。
