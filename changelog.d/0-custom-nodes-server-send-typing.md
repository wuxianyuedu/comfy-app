## Fixed

- **custom-nodes SSE 的服务端 `send` 收形为协议联合（字段漂移在发出侧即编译不过）**：把 `/api/custom-nodes` route 里 `parse`/`discover` 两个流端点的 3 个 `send(obj: unknown)` 闭包（含下钻 helper 的 `send:` 形参）收形为 `SettingsStreamEvent` / `ParseStreamEvent`，发现缓存 `discoverCache` 的 `result` 由 `unknown[]` 收窄为 `DiscoveredSubpkg[]`。协议类型（PkgReport/ParseReport/DiscoveredSubpkg/SummaryPkg/SettingsResp + 两个事件联合）从视图 `CustomNodesSettings/types.ts` 上收到新的 `src/lib/comfyui/custom-nodes-stream`（server 与 view 共用地基），视图 types.ts 改为 re-export，既有 importer 路径不变。
- **收形过程逼出并修正了三处此前无人核对的线形事实**：`done` 事件的 `exitCode` 实为 `number | null`（进程未正常退出时为 null）、`summary` 事件实带 `settings` 字段（上一步 #23 已补联合）；`SummaryPkg.generatedAt` 对齐为 `string | null`（清单旧条目无时间戳）后，`byPath` 无需断言即直接兼容。解析器产出的 `parsed.packages` / 报告 JSON 在协议边界一次性 `as DiscoveredSubpkg[]` / `as ParseReport | null` 收窄。

## Added

- `src/lib/comfyui/custom-nodes-stream.ts`：custom-nodes 解析/探测的服务端↔前端共享协议类型与两个 SSE 事件判别联合的唯一源。
