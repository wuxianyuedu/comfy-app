## Fixed

- 桌包载荷两侧的 `src/` 逐文件白名单现在有一致性判据（ISSUE #2567）：`scripts/standalone-private-inputs.mjs` 的 `RUNTIME_SRC`（剔除侧）与 `scripts/check-standalone-contents.cjs` 的 `ALLOWED_SRC_FILES`（检查侧）此前靠人记得同改，漂移时只有 `next build` 之后的数产物那一跑才红、而那一跑不在 PR 档 ⇒ 漏登一侧的链节点会静默漏进 / 漏出产物（PR #2565 的 `pnpm-js-entry.ts` 就双侧都漏了，只因那一笔整体回滚才没出事故）。现在 `tests/dist-artifact-hygiene.test.ts` 的「两份白名单集合相同」旁边补一条 `RUNTIME_SRC ↔ ALLOWED_SRC_FILES` 的逐字对账（零成本、不读产物），新增跨宿主链节点时两侧被同时钉住。
