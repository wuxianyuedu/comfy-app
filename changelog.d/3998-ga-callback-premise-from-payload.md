## Fixed

- GA 判决回调的两枚前提在自动档上恒空，CNB 主列读到「status 缺席」白等 70m（#3998）：
  `pr-gate.yml` 的 `CNB_PULL_REQUEST_MERGE_SHA` / `CNB_PULL_REQUEST_IID` 只读
  `client_payload`，而镜像格那一刻 CNB 侧的 `CNB_PULL_REQUEST_MERGE_SHA` 可以是空的
  （`resolveContext()` 刻意不阻断），payload 里便也是空串 ⇒ `ci-ga-verdict-callback.mjs`
  的 sha 判据 fail-closed 退 2，commit-status 从头到尾没被写过。同族的另一半是
  `github.event.inputs.x || github.event.client_payload.x` 这条写法在**自动档上也是空转**：
  GitHub 的 `||` 只在左侧为 null / false 时短路，`inputs` 键在 `repository_dispatch` 上
  存在且为空串（空串不算假）⇒ 永远取到空串。
- 修法两层、同指向一份字段名：workflow 改成先按 `github.event_name` 分形态再 `||`，并给
  `workflow_dispatch` 补 `merge_sha` input；`ci-ga-verdict-callback.mjs` 自己读
  `GITHUB_EVENT_PATH` 的 `client_payload`（取值顺序 旗标 → payload → 环境变量），
  `--sha` / `--pr` 仍是手跑复验的显式覆盖。
- 判据：`tests/ci-ga-verdict-callback.test.ts` 新增「前提取值口」一组（改动前那格红）；
  `tests/no-platform-ci-config.test.ts` 的 #3667 那一格从「钉 `inputs || client_payload`」
  改为钉「先分形态」的写法（原来钉的就是本条要拆掉的形状）。判决链、三态退码、`GA_VERDICT`
  折叠与 `质量门禁` 的承重锚一字未动。
