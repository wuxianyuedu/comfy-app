## Changed

- **B5 子批 4：20 份 / 78 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批集中在 API 路由与其测试（`src/app/api/**/route.test.ts`、`custom-nodes/route.ts`）以及
  settings 的 hooks（`use-settings-page*`）。修法仍是「运行时校验 + 类型守卫」：
  - `res.json()` / `JSON.parse` / `mock.calls[n]?.[k]` 先落 `unknown`，用 `isRecord` /
    `Array.isArray` / `typeof` 逐层收窄；形状不符时 `throw`（与旧断言后崩溃同一失败判定）。
  - `vi.mock` / `global.fetch` 桩改用 `vi.mocked(...)`，替代 `(x as Mock)` / `(x as any)`。
  - 枚举型（`"hash" | "scan"`、settings 分区 id、任务类型）改白名单 `find` / `Object.hasOwn` 谓词。
  - `new NextRequest(...) as NextRequest` 的多余断言直接删除；`as never` 那处改为真 `NextRequest`。
  - `ParseReport | null` / `ManifestSummary` / 错误信封改成文件内谓词收窄，不合法走既有 `null`/默认值出口。
  - 泛型 `jsonField<T>` 增加谓词参数，`ARTIFACT_TYPES` 型断言改谓词过滤。
- 语义未变：错误码、回话形状（正常数据）、日志话术与用例期望值均保持；没有新增 `as` / `!` /
  逐行禁用，没有放宽既有 overrides。
- `src/app/api/custom-nodes/route.ts` 按单文件行数上限拆出 `parse-guards.ts`（外部 JSON 谓词与
  `readDiscoveredPackages`），路由回到 879 行。
- 台账：B5 行改「清账中（子批1、2、4：80 份 / 166 处已清；子批3 在 #3249）」。
- 清账总账：#3181（本批挂 `Refs`）。

Refs #3181
