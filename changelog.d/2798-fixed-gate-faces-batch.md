## Changed

- **「受影响用例」档再补九条重档自测的输入面，并订正 `base-check` 那条面**（ISSUE #2798）。
  用户给的耗时榜里剩下的九条（`gate-executors` 70.9s、`check-merge-parents` 65.6s、
  `merge-changelog-anchor` 48.8s、`storybook-tsc-input` 45.3s、`eslint-exemption-staleness` 44.9s、
  `scripts-typecheck-ratchet` 44.2s、`precommit-timing` 44.0s、`ci-env-probe` 43.9s、
  `changelog-versions-gate` 43.8s，合计约 451s）与 #2022 / #2793 已登记的那批同形：临时工作区里
  真起子进程 / 真 git / 真渲染，import 图追不到。面按**实读的 IO** 逐条写（不是按业务印象），
  `tests/affected-tests.test.ts` 仍刻意不开面（自指），`tests/check-doc-references.test.ts`
  本来就走 import 图、不需要面。
- **`base-check` 的面去掉一条死模式、补上一处漏面**：`.githooks/**` 是 `WIDE_TRIGGERS` 的一格，
  任何钩子改动都会先把整档退回 `all`，那条模式永远到不了筛这一层；同时补上被测模块真正的
  三份直接依赖 `scripts/base-check/**`（`git-ref` / `hook-steps` / `verdict`），改它们时判据不再缺席。
- **判据新增一格「面里不许有整条被宽面覆盖的模式」**：唯一口径是 `affected-tests.mjs` 新导出的
  `wideReasonFor`，不在测试里另抄一份宽面清单。封闭名单随登记扩到 17 条（加一条仍要人来签字），
  并新增「九条各按自己的触发面回来、不把四条业务自检带起来」那一组。
