## Fixed

- **`scripts/check-commit-claims.mjs` 的 tsc 基线红**（承接 ISSUE #1605，随 #1617 一并修）。
  `b9a7ffc0` 引入的 `quoted` 回调与 `quotedMask` 返回值都缺类型标注，在 `checkJs: true` +
  `strict: true` 下 `pnpm exec tsc --noEmit` 报 `TS7006: Parameter 'm' implicitly has an
  'any' type` —— 这是**别线的红**（`git diff origin/master` 对该文件为空，干净 master 上
  同样报这一条），却挡在从 `master` 分出的**每一个**提交前面（§13.6.2）。就地补齐
  JSDoc 类型（`quotedMask` 的 `@returns {boolean[]}` 与 `quoted` 的 `@param`），
  不改任何运行期行为。
