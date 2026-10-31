## Changed

- oxlint `perfectionist/sort-object-types` 补齐全仓面（#2893）：6 处 / 4 份，全部是
  类型成员按字母序重排（纯声明顺序，不影响类型或运行时）：
  `src/server/api/routers/series-generation.ts`（2）、
  `tests/affected-launch-separation.test.ts`（2）、`tests/helpers/gate-repo.ts`（1）、
  `tests/no-platform-ci-config.test.ts`（1）。
- 这批命中是清零之后由后续提交带回来的（现场见 #2893）；在 #2777 把 oxlint 接进
  CI 之前，按同一「一规则一 PR」口径逐条重清。
