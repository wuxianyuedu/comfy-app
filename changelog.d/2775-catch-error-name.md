## Fixed

- oxlint `unicorn/catch-error-name` 全仓清零（1 处 / 1 份，ISSUE #2775）：
  `scripts/check-ci-yaml-parse.mjs` 的 `catch (err)` 改名 `catch (error)`
  （catch 参数块级作用域、块内仅一处引用，纯局部改名零语义）。

  #2775 机械队列其余三条当前树复扫均已 0 命中且预设已启用，无需再开：
  `unicorn/switch-case-braces`、`unicorn/prefer-string-raw`、`unicorn/prefer-number-properties`。

  验证：探针配置（关 categories、单开 4 条候选规则）全仓复扫 0 命中；
  `tests/ci-yaml-parse.test.ts` 3 例绿（负控制「断掉的别名引用 ⇒ 红」正好走这条 catch 分支）。
