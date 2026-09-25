## Fixed

- **custom-nodes SSE 事件从「全可选字段袋」改为按 `type` 判别的联合（消费端编译期收窄）**：`use-custom-nodes-settings.ts` 里 `SettingsStreamEvent` / `ParseStreamEvent` 此前是 14 个 `?:` 字段的松散 interface，消费端每个字段都要 `typeof ev.parent === "string"` / `typeof ev.discovered === "number"` 逐条手判（且拼错的 `type` 字面量会静默通过）。改为 `CustomNodesSettings/types.ts` 里的判别联合（探测流按 `discover_start|progress|discover_done|summary|error|done`、解析流按 `log|done`），`progress` 的 `phase` 收成上线实际三态；消费端 switch 收窄后去掉全部逐字段 `typeof`，字段类型由联合静态给出。行为不变（`use-custom-nodes-settings` / `SettingsParts` / `parsing` 67 用例全绿）。

> 服务端 `send(obj: unknown)` 与这些事件的收形（让 `type` 拼错、字段漂移在**发出侧**即编译不过）需要先把 payload 类型（ParseReport/DiscoveredSubpkg/SummaryPkg 等）从视图 `types.ts` 迁到 `src/lib`（server 不宜 import 视图），属独立一步，本 PR 先落地消费端判别联合。
