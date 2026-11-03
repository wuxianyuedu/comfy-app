## Fixed

- `scripts/ci-heavy-gates.mjs` 的两块 JSDoc 次序写反了（#3045，ISSUE #3032 落地笔的收尾）：
  带 `@param` / `@returns` 的那块落在 `RANGE_SCOPED` 的 `@type` 块之前，于是 `@type` 仍生效、
  而 `export function heavyGateArgv(argv, deps = {})` 上方紧接的是 `const RANGE_SCOPED = [...]`
  —— 标签已经用掉了，函数自己一个类型标注都没有 ⇒ 参数 implicit any、`deps` 退化成 `{}`、
  返回联合退化成 `{ok: boolean}`，调用侧 `resolved.reason` / `resolved.notRunCodes` 全成可选
  ⇒ `tsc --noEmit`（平台「类型检查」）与 `scripts/check-scripts-typecheck.cjs`（脚本档棘轮，
  基线 0 → 当前 2×3）在 **master 上常红**，当时四条开放 PR 全卡在同一处。
  修法只挪 doc 块次序、标签紧贴 `heavyGateArgv()`，判据本体与运行时行为一个字未改；
  本地 `tsc --noEmit` 与脚本档类型检查双双退 0。
