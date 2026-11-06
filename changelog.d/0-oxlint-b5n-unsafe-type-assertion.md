## Changed

- **B5 子批 14：20 份 / 71 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批全部落在 `lib/comfyui`：执行器链路（cli-stream / outputs / finalize / history / errors）、
  实例与安装发现（desktop-instance / executed-model / cpu-limit / graph-node-class /
  execution-graph / execution-shape / executor-dispatch / executor-ws / firstframe /
  importSource / custom-nodes-manifest），以及 4 份对应用例。
  修法仍是「运行时校验 + 类型守卫」：
  - 执行器：所有 `as JsonRecord` / `as Record<string, unknown>` 改 `isRecord` 守卫后直接读；
    `as string[]` 改 `isStringArray`（`Array.isArray` + `every` + `typeof`）；
    输出文件列表加 `isCollectedOutputFile`（`isRecord` + `typeof filename`）；
    历史条目加 `isComfyHistoryEntry`（`isRecord` + outputs/status 字段判型），非法值回落 `undefined`。
  - 实例与安装：`desktop-instance` 用 `isRecord` / `isPlainRecord` 逐层收窄（顺带删掉三处
    `eqeqeq` 逐行禁用）；`cpu-limit` 改 `CPU_LIMIT_MODES.find` 白名单收窄；`executor-ws`
    按 `Buffer.isBuffer` / `Array.isArray` / `Buffer.from` 三路转文本。
  - 用例：新增 `isRawNodesFixture` / `isFixtureResult` / `isOpenWebSocket` / `isCliProcHandle`
    等运行期守卫，守卫失败显式 `throw`；`launch-path` 改 `"error" in plan` 判别联合收窄。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 抛错行为。
- 台账：B5 行改「清账中（子批1–14：280 份 / 597 处已清）」。

Refs #3181
