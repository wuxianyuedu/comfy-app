## Changed

- **B5 子批 3：20 份 / 30 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  覆盖 `src/app/(main)/settings/components/*` 的四格回调与三份测试替身，以及
  `scripts/launcher-core/*`、`scripts/premerge-{check,proof}.mjs`、`scripts/freshness-{gate,ledger}.mjs`、
  `scripts/ship-claim.mjs` 等工具链。修法仍是「运行时校验 + 类型守卫」：
  - 基元组件出参先落 `unknown`，再按白名单 `find(candidate => candidate === next)` 或字面量
    `=== "dark" || === "light"` 收窄；白名单外的值不再写回（UI 行为与文案未变）。
  - 测试替身用本地类型谓词（`isRecord` + 分区实际读取的字段）收窄，替代 `unknown as`。
  - `JSON.parse` / `spawnSync().stdout` / 注入面回话先落 `unknown`，再 `isRecord` / `typeof` /
    `"code" in` 逐层收窄；错误码用 `error instanceof Error` / errno 守卫读取。
  - `dns.lookup` 包装层两个入口共用同一实现（`patchLookup` 的参数/返回按 `any` 收窄），
    `dns.promises.lookup` 的赋值不再经 `any` 强转；`opt.*Bad` 经 `isStringArray` 谓词。
  - `premerge-check` 的未知段形态、`never` 兜底与 `stdout` 注入回调都改成显式分支/注解。
- 语义未变：判红/退码口径、日志话术、退出码均逐条保持；没有新增 `as` / `!` / 逐行禁用，
  没有放宽既有 overrides。
- 台账：B5 行改「清账中（子批1–3：60 份 / 118 处已清）」；`freshness-ledger.mjs` / `premerge-check.mjs`
  两行的存量处数按实探修正（3→4、2→3，提取时各少计 1 处，本批实清 30 处）。
- 清账总账：#3181（本批挂 `Refs`）。

Refs #3181
