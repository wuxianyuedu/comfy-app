## Added

- **`src/lib/collections.ts` 分组桶原语（§12.18 复用优先）**：`getOrCreate(map, key, create)`（取桶、没有就建）与 `getOrThrow(map, key, msg)`（键按构造必存在，缺失给带上下文的报错而非静默 `!` 崩溃）。纯函数、零依赖、配单测（100% 覆盖门槛，纳入 `coverage.include` + `thresholds`，并登记 `check-file-structure.cjs` 的 `DOMAIN_EXEMPT` 顶层单例）。

## Fixed

- **三处 `map.get(k)!.push` 非空断言收口到 `getOrCreate` / `getOrThrow`**：`media/materials`（按文件夹）、`studio/history/history-list-derive`（按日期，本就是 has-check + set + get! 的内联 getOrCreate）、`ui/segment-popover`（按子组，order.push 移入 create 工厂 + 末尾 `order.map(getOrThrow)`）。全库 `!` 总数 211 → 207，非空棘轮基线随之收紧。
