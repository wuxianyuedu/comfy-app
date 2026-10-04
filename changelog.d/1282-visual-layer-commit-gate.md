## Added

- **「改像素层的提交必须显式跑一次 vitest」从文档口径变成硬判据**（规范 §11.8 / §13.5，
  `scripts/visual-gate.mjs`，pre-commit D 组）。触发面与 `shell-gate.mjs` 同族：只有暂存改动
  命中 `e2e/visual/**` 或 `playwright.config.ts` 时才做事，普通提交零输出、零耗时。
- **它判的是「这次提交带不带像素判决」，不是「你有没有手跑 vitest」**——后者是一句无法观测
  的话。判据落在「本次要跑的清单里 `tests/visual-baseline-pairing.test.ts` 在不在」：像素层有
  改动而那条判据不在清单里 = 本次提交不带着任何像素层判决进历史，直接阻断并给出修法。
  清单读的是与 C 组**同一份唯一出处**（`affected-tests.mjs` 的 `resolveAffectedTests` 与
  `FIXED_STRUCTURAL_TESTS`，§12.18），所以「有人把这条判据从固定清单里摘掉」当场被拦，
  而不是等到下一次像素层出事才发现判据没有执行者。**本步不另起一次 vite**（C 组已经起了，
  钩子那一档只起一次冷启）。
- 判据由 `tests/visual-gate.test.ts` 钉住（9 条）：触发面的窄/宽两头、`runGate` 的放行与阻断
  **两条分支真跑**（不是抠源码文本，先例 ISSUE #1356）、清单与唯一出处同源、以及「这一步真的
  接在钩子里」的按行解析断言（同 §13.5.8「在场判据要解析、不要 `toContain`」）。

## Fixed

- **规范 §11.8 那句 ⚠️ 的旧口径过期了**：它写「`tests/visual-baseline-pairing.test.ts` 只在
  `pnpm test`（vitest）里跑」—— 事实上它自 #6538809 起就是固定守护清单的成员（每次提交都跑）。
  现在改写为门禁的实际形状，并把「要拦的动作」写清楚：拿 e2e 的通过数当像素层结论。
  `--grep @critical` 一条视觉用例都不含（视觉 spec 没有 `@critical` 标签，而 §11.7 按需验证
  清单点名的正是它），跑绿了证明不了像素层没坏。

## Docs

- §13.5 的钩子判据清单登记这一步；`docs/guides/TESTING.md` 的「已知边界」把「E2E / 视觉没有
  自动执行者」拆成两条：E2E 仍是手动档，视觉那层有本地判据 —— 同时说明它判的是**基线齐全 /
  入库 / 平台登记**，不是「界面像素有没有变形」，后者仍要 `pnpm test:visual` 手动跑。
