## Changed

- **P3 §5 第 2 期 · Phase 4-A2：孤儿回收（reaper）改宿主显式启动（ADR §14 D3）**：`reaper.ts` 顶层那行裸 `startReaper()` 删除、`startReaper` 变导出；`enqueue.ts` 不再以裸副作用 import 顺带带上 reaper —— 那条隐式耦合既是「谁起 reaper」在模块图上不可见的根源，也是历史上一次「删文件把回收静默关掉」的回归入口。启动点收敛成两处显式调用：Next 侧 = `src/instrumentation.ts` 的 `NEXT_RUNTIME === "nodejs"` 分支（Next 官方「每进程一次」钩子，Edge 分支不引 Node-only 模块），host 侧 = `scripts/executor-host.mjs` 注入链之后。顺带消掉一个名不副实：host 只要 `import` 这个模块就会起一个常驻 30s 循环，「一次性 Q2 扫表」其实是常驻回收；现在 host 的首扫走 `startReaper()` 内部那条先过 `isSchemaReady()` 的路径，不再裸调两条 sweeper（硬规则 16 的形态）。
- **`tests/reaper-side-effect.test.ts` 两条断言方向翻转，护栏动机以更强形式保留**：旧的问「模块自己有没有起」（`/^startReaper\(\);/m`），新的问「两个宿主的启动点还在不在、有没有人偷偷多出第二处」——Next 侧与 host 侧各断言「有且仅有一处」且必须落在 nodejs 分支内，并断言 `enqueue.ts` 不再裸副作用导入。少一处 = 回收静默失效（正是当年那次回归的形态），多一处 = 同进程两个常驻循环重复判决同一批行。签字口径里提到的 `stopReaper` **未落**：全仓至今没有任何停表需求，不造无人消费的口。

## Added

- **dev 冷启动的首扫延迟有了确定口径**：实测 Turbopack 会**懒编译** `instrumentation`，`✓ Ready` 之后约 40s 才跑完第一次回收（standalone 产物没有编译步骤，`register()` 随服务起即跑）。`docs/guide-executor-host.md` 的「崩溃恢复」条目按新的两处启动点重写并记下这条，同时把「冷启动后遗留行短暂仍在 `QUEUED`/`RUNNING` 属正常」写清 —— 免得下次被当成「reaper 没接上」再查一遍。
