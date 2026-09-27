## Fixed

- **清空 `KNOWN_FAILED_FILES` 里四条过期登记，把被静默跳过的用例放回提交增量层**（规范 §11.12 要求「修好就立刻删」，清单自身注释也写着「留着 = 永久静默跳过，退化不会再被发现」）。逐个串行复跑全部为绿：`tests/check-file-structure.test.ts`（79 passed；它的两条红——陈旧壳判据与 splash 三副本——由 #1168 修掉）、`tests/dev-launcher-toolchain-gate.test.ts` 与 `tests/dev-launcher-downstream-exit.test.ts`（由 `11f302e7` 四类根因分治修掉）、`tests/turbopack-tracing-excludes.test.ts`（产物侧断言在无 `.next/standalone` 时按既有设计自行跳过，其余 16 条绿）。登记清单的粒度是**文件**，所以这四条红早已不存在、跳过却还在生效——被摘掉的是门禁脚本的回归套件与三条线的用例，比红更糟的是它什么都不会说（清单自己的自检只验「登记的路径还存在」，不验「确实还红」）。同批的 `tests/theme-token-single-source.test.ts` 已由该线自己删登记，本刀不重复。
- 清单头部补上再登记的门槛：先按规范 §13.6.2 用 `git worktree` 复算 master 基线确证是别线的红，再确认那条门禁在别处有没有更强的执行者，并注明归属与谁来修。
