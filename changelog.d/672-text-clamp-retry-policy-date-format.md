## Changed

按「同一件事的多种写法」再扫一轮，三条账各收成一处实现，三条判据都是硬闸（P44/P45/P46）：

- **「把一段文本按最大长度截断」→ `~/lib/text-clamp`**。上限、方向、省略标记三件事
  此前各写各的（600 / 2000 / 4000 / 8000 散落；方向有保留头部与保留**尾部**两种；
  标记有 `…` / `…(truncated)` / **什么都不加**）。出口把上限收成**带约束说明的具名常量**
  ——本条账要的不是「把数字改一样」，而是让「为什么这个数是这个数」只有一处能说清。
- **「一个异步动作重试几次、退避多久」→ `~/lib/retry-policy`**。WS 重连（指数退避 +
  上限）与 history 轮询 / Ollama 就绪（固定间隔 + 有界次数）此前各自内联，连三条停止
  探针的「等多久」都没有名字。出口给 `backoffDelayMs`（纯函数，只算时长）+ 六个具名
  策略；`maxAttempt` 显式注明它是 `2 ** attempt` 的**防溢出夹取**，不是「最多几次」。
- **「把一个日期写成可读格式」的日期档 → `~/lib/time-format`**。`YYYY-MM-DD` 三处各拼
  一遍、`MM-DD` 一份、`YYYY-MM-DD HH:mm:ss` **6 处逐字相同**、导出文件名一份。补
  `formatDate` / `formatShortDate` / `formatLocalStamp` / `formatCompactStamp` 四档。

### Fixed

- 顺手清掉 `runner-state` 里已成「零消费中转」的 `RECONNECT_BASE_MS` / `RECONNECT_MAX_MS`
  （`executor-ws` 已直接走 `WS_RECONNECT`），由 `check-dead-exports` 抓出。

判据：`check-ui-primitives.cjs` 新增 P44/P45/P46（硬闸，扫 `src/components` / `src/app`
/ `src/lib` / `src/server`），11 条契约用例（各判据阻断、合规不误伤、边界不误伤）。
规范同步 `16 §16.2.3`（判据表）+ `§16.2.4.48 ~ §16.2.4.50`（三条台账）。

行为不变：「只搬定义、不动取值」，各落点的截断长度 / 退避参数 / 日期形态一字未改。
