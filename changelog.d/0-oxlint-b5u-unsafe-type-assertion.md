## Changed

- **B5 子批 21：20 份 / 46 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行；
  实扫 46 处与清单一致）。本批覆盖 `lib/workshop`（API 通道 / 角色画像 / 草稿完整性 / 草稿仓 /
  草稿同步 / 生成客户端 / 生成日志 / 模型模式契约 / 领域类型 / 运行服务）、`src/proxy.test.ts`
  与 `server/agent`（评审 / 运行引擎）用例。
  修法仍是「运行时校验 + 类型守卫」：
  - 对象读取：`isRecord` / `isPlainRecord` 逐层收窄；`JSON.parse` 结果先落 `unknown` 再收窄。
  - 字符串联合 / 词表：本地 `isShotType` / `isModeContractInputId` 守卫 + `some` / `Set` 判定，
    `types.ts` 抽出 `includesEnumValue<T>` 类型谓词。
  - 结构校验：`draft-store` 按 `isProjectMeta` + 三个数组守卫逐字段兜底；`generation-log.server`
    非法行 `continue`；`api-channel.server` 复用既有 `sanitizeChannel`。
  - 既有归一函数复用：`workflowIO` 两处改走 `parseWorkflowIOMap`，替代盲转型。
  - 用例：`proxy.test.ts` 用真 `NextRequest` 替身（`NextURL` 把 `127.0.0.1` 归一成 `localhost`，
    落点期望随之对齐，仍是完整 URL 精确断言）；`server/agent` 加 `assertRecordArray` /
    `assertContentParts` 等本地断言函数，mock 入参先落 `unknown` 再收窄。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 跳过 / 抛错行为。
- 台账：B5 行改「清账中（子批1–21：420 份 / 1044 处已清）」。

Refs #3181
